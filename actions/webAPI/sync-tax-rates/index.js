const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken } = require('@adobe/aio-lib-core-auth');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime');
const { findTaxRates, insertTaxRate, updateTaxRate } = require('../tax-rate/db-helper');

const TAX_RATES_COLLECTION = 'tax_rates';
const SYNC_HISTORY_COLLECTION = 'sync_history';

function parseBody(params) {
  if (params.__ow_body) {
    try {
      return typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
    } catch (_) {}
  }
  return params;
}

function parseQuery(params) {
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    const out = {};
    const qs = new URLSearchParams(params.__ow_query);
    for (const [k, v] of qs.entries()) out[k] = v;
    return out;
  }
  return {};
}

function pget(params, key) {
  return params[key] != null ? params[key] : process.env[key];
}

function normalizeImsParamsForToken(params) {
  const merged = { ...params };
  if (merged.orgId == null && merged.ADOBE_ORG_ID != null) merged.orgId = merged.ADOBE_ORG_ID;
  if (merged.clientId == null && merged.ADOBE_CLIENT_ID != null) merged.clientId = merged.ADOBE_CLIENT_ID;
  if (merged.clientSecret == null && merged.ADOBE_CLIENT_SECRET != null) merged.clientSecret = merged.ADOBE_CLIENT_SECRET;
  if (merged.scopes == null && merged.ADOBE_SCOPE != null) {
    const s = merged.ADOBE_SCOPE;
    if (Array.isArray(s)) merged.scopes = s;
    else if (typeof s === 'string') merged.scopes = s.split(/[,\s]+/).filter(Boolean);
  }
  return merged;
}

/**
 * Magento REST must use Commerce-capable OAuth (client_credentials from ADOBE_* on the action),
 * or an explicit accessToken in the POST body. Do NOT use Authorization: Bearer from the browser —
 * that is Adobe IMS user token and is not valid for Magento /V1/taxRates.
 */
async function resolveMagentoAccessToken(params) {
  const explicit = pget(params, 'accessToken');
  if (explicit) return explicit;
  try {
    const tokenRes = await generateAccessToken(normalizeImsParamsForToken(params));
    if (tokenRes && tokenRes.access_token) return tokenRes.access_token;
  } catch (_) {}
  return null;
}

async function getMagentoConfig(params) {
  const commerceDomain = pget(params, 'commerceDomain') || pget(params, 'MAGENTO_COMMERCE_DOMAIN');
  const instanceId = pget(params, 'instanceId') || pget(params, 'MAGENTO_INSTANCE_ID') || '';
  const accessToken = await resolveMagentoAccessToken(params);
  if (!commerceDomain || !accessToken) {
    throw new Error('commerceDomain and accessToken are required (can use env MAGENTO_COMMERCE_DOMAIN + ADOBE_* or Authorization: Bearer)');
  }
  return { commerceDomain, instanceId, accessToken };
}

function sanitizeMagentoRate(row) {
  const identifier = row.tax_identifier || row.code || null;
  if (!identifier) return null;
  const rate = Number(row.rate);
  if (!Number.isFinite(rate)) return null;
  return {
    tax_identifier: String(identifier),
    code: row.code || String(identifier),
    magento_tax_rate_id: row.id || row.tax_calculation_rate_id || null,
    tax_country_id: row.tax_country_id || 'US',
    tax_region_id: row.region_code || row.tax_region_id || '',
    tax_postcode: row.tax_postcode || '*',
    rate,
    city: null,
    zip_is_range: false,
    zip_from: null,
    zip_to: null,
    status: row.status !== false,
    synced_from_magento: true
  };
}

function classifyStatus(updated, inserted, failed) {
  if (failed > 0 && (updated > 0 || inserted > 0)) return 'partial';
  if (failed > 0) return 'error';
  return 'success';
}

function buildMagentoTaxRatesSearchUrl(config) {
  const domain = String(config.commerceDomain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const inst = String(config.instanceId || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const base = inst ? `https://${domain}/${inst}` : `https://${domain}`;
  return `${base}/V1/taxRates/search?searchCriteria[currentPage]=1&searchCriteria[pageSize]=500`;
}

async function fetchMagentoTaxRates(config) {
  const url = buildMagentoTaxRatesSearchUrl(config);
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

async function insertSyncHistory(dbCtx, history) {
  const db = await libDb.init({ token: dbCtx.bearerToken, region: DEFAULT_REGION, ow: { namespace: dbCtx.namespace } });
  const client = await db.connect();
  try {
    const collection = await client.collection(SYNC_HISTORY_COLLECTION);
    await collection.insertOne({
      ...history,
      created_at: new Date().toISOString()
    });
  } finally {
    await client.close();
  }
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }
  if (method !== 'POST' && method !== 'GET') {
    return { statusCode: 405, headers: CORS, body: { status: 'Error', message: 'Use GET or POST' } };
  }

  try {
    const payload = { ...parseQuery(params), ...parseBody(params), ...params };
    const auth = await resolveAuthAndNamespace(params);
    if (auth.error) return { statusCode: auth.error.statusCode, headers: CORS, body: auth.error.body };
    const dbCtx = { bearerToken: auth.accessToken, namespace: auth.namespace };

    const magentoConfig = await getMagentoConfig(payload);
    const magentoRates = await fetchMagentoTaxRates(magentoConfig);

    const normalized = magentoRates.map(sanitizeMagentoRate).filter(Boolean);
    const existing = await findTaxRates({}, { limit: 5000 }, DEFAULT_REGION, dbCtx);
    const existingMap = new Map(
      (Array.isArray(existing) ? existing : [])
        .filter((x) => x && x.tax_identifier)
        .map((x) => [String(x.tax_identifier), x])
    );

    let inserted = 0;
    let updated = 0;
    let failed = 0;
    const errors = [];

    for (const rate of normalized) {
      try {
        const prev = existingMap.get(rate.tax_identifier);
        if (prev) {
          await updateTaxRate(
            { _id: prev._id },
            {
              $set: {
                ...rate,
                source_sync_mode: 'magento-to-extension',
                last_synced_at: new Date().toISOString()
              }
            },
            DEFAULT_REGION,
            dbCtx
          );
          updated += 1;
        } else {
          await insertTaxRate(
            {
              ...rate,
              source_sync_mode: 'magento-to-extension',
              last_synced_at: new Date().toISOString()
            },
            DEFAULT_REGION,
            dbCtx
          );
          inserted += 1;
        }
      } catch (e) {
        failed += 1;
        errors.push({ tax_identifier: rate.tax_identifier, error: e.message });
      }
    }

    const historyRow = {
      timestamp: new Date().toISOString(),
      mode: 'magento-to-extension',
      status: classifyStatus(updated, inserted, failed),
      synced: inserted + updated,
      failed,
      total: normalized.length,
      inserted,
      updated,
      collection: TAX_RATES_COLLECTION
    };
    await insertSyncHistory(dbCtx, historyRow);

    return {
      statusCode: 200,
      headers: CORS,
      body: {
        status: 'Success',
        message: `Magento sync finished. Synced ${historyRow.synced}, failed ${failed}.`,
        data: {
          ...historyRow,
          errors
        }
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS,
      body: { status: 'Error', message: error.message || String(error) }
    };
  }
}

exports.main = main;
