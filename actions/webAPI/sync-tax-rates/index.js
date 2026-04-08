const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken } = require('@adobe/aio-lib-core-auth');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime');
const {
  getDefaultRegion,
  resolveTaxRatesCollectionName,
  resolveSyncHistoryCollectionName
} = require('../lib/config');
const { findTaxRates, insertTaxRate, updateTaxRate } = require('../tax-rate/db-helper');

const TAX_CONFIG_COLLECTION = 'tax_config';
const TAX_CONFIG_KEY = 'default';

/** Match tax-config / Adobe web: __ow_body may be base64(JSON) or raw JSON string. */
function parseBody(params) {
  if (!params.__ow_body) return {};
  const raw = params.__ow_body;
  try {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      } catch {
        return JSON.parse(raw);
      }
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  } catch (_) {
    /* ignore */
  }
  return {};
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

/** OpenWhisk injects __ow_* on params; spreading params into payload breaks token/config merging. */
function pickNonOw(params) {
  const o = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') o[k] = v;
  }
  return o;
}

/** Same merge order as tax-config: query + action inputs + JSON body (body wins). */
function mergePayload(params) {
  return { ...parseQuery(params), ...pickNonOw(params), ...parseBody(params) };
}

function pget(params, key) {
  return params[key] != null && params[key] !== '' ? params[key] : process.env[key];
}

/** Commerce Cloud: REST lives on *.api.commerce.adobe.com, not *.admin.commerce.adobe.com */
function normalizeCommerceHost(domain) {
  return String(domain || '')
    .trim()
    .replace(/\.admin\.commerce\.adobe\.com$/i, '.api.commerce.adobe.com');
}

function resolveCommerceDomain(params) {
  const raw =
    pget(params, 'commerceDomain') ||
    pget(params, 'MAGENTO_COMMERCE_DOMAIN') ||
    pget(params, 'magento_commerce_domain') ||
    '';
  return normalizeCommerceHost(raw);
}

function resolveInstanceId(params) {
  const v =
    pget(params, 'instanceId') ||
    pget(params, 'MAGENTO_INSTANCE_ID') ||
    pget(params, 'magento_instance_id') ||
    '';
  return String(v).trim();
}

/**
 * When the UI only saved Magento settings to tax_config (or env lacks instance id), pull defaults from ABDB.
 */
async function readTaxConfigMagentoPatch(dbAuth, region) {
  const db = await libDb.init({
    token: dbAuth.bearerToken,
    region,
    ow: { namespace: dbAuth.namespace }
  });
  const client = await db.connect();
  try {
    const collection = await client.collection(TAX_CONFIG_COLLECTION);
    const rows = await collection.findArray({ config_key: TAX_CONFIG_KEY }, { limit: 1 });
    if (!Array.isArray(rows) || !rows.length) return null;
    const doc = rows[0];
    const patch = {};
    if (doc.magento_commerce_domain) patch.magento_commerce_domain = doc.magento_commerce_domain;
    if (doc.magento_instance_id != null && doc.magento_instance_id !== '') {
      patch.magento_instance_id = String(doc.magento_instance_id).trim();
    }
    return Object.keys(patch).length ? patch : null;
  } finally {
    await client.close();
  }
}

/**
 * IMS client_credentials for Magento REST — same shape as delete-tax-rate / create-tax-rate.
 * IMPORTANT: ADOBE_SCOPE is often a JSON *string* (array); splitting on commas breaks scopes and Magento returns 5xx.
 */
function buildMagentoImsParams(payload) {
  const clientId = pget(payload, 'ADOBE_CLIENT_ID') || pget(payload, 'IMS_OAUTH_S2S_CLIENT_ID');
  const clientSecret = pget(payload, 'ADOBE_CLIENT_SECRET') || pget(payload, 'IMS_OAUTH_S2S_CLIENT_SECRET');
  const orgId = pget(payload, 'ADOBE_ORG_ID') || pget(payload, 'IMS_OAUTH_S2S_ORG_ID');
  const scopeRaw =
    pget(payload, 'ADOBE_SCOPE') ||
    pget(payload, 'ADOBE_SCOPE_EXTENDED') ||
    pget(payload, 'IMS_OAUTH_S2S_SCOPES');

  const merged = { clientId, clientSecret, orgId };
  if (scopeRaw == null || scopeRaw === '') return merged;

  if (Array.isArray(scopeRaw)) {
    merged.scopes = scopeRaw;
  } else if (typeof scopeRaw === 'string') {
    try {
      merged.scopes = JSON.parse(scopeRaw);
    } catch {
      merged.scopes = scopeRaw
        .split(/[,\s]+/)
        .map((x) => x.replace(/^["'\[\]]+|["'\]]+$/g, '').trim())
        .filter(Boolean);
    }
  }
  return merged;
}

/**
 * Magento REST must use Commerce-capable OAuth (client_credentials from ADOBE_* on the action),
 * or an explicit accessToken in the POST body. Do NOT use Authorization: Bearer from the browser —
 * that is Adobe IMS user token and is not valid for Magento /V1/taxRates.
 */
async function resolveMagentoAccessToken(params) {
  const explicit = pget(params, 'accessToken') || pget(params, 'MAGENTO_ACCESS_TOKEN');
  if (explicit) return explicit;
  try {
    const ims = buildMagentoImsParams(params);
    if (!ims.clientId || !ims.clientSecret) return null;
    const tokenRes = await generateAccessToken(ims);
    if (tokenRes && tokenRes.access_token) return tokenRes.access_token;
  } catch (e) {
    console.warn('sync-tax-rates: generateAccessToken failed:', e?.message || e);
  }
  return null;
}

async function getMagentoConfig(params) {
  const commerceDomain = resolveCommerceDomain(params)
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const instanceId = resolveInstanceId(params);
  const accessToken = await resolveMagentoAccessToken(params);
  if (!commerceDomain || !accessToken) {
    throw new Error(
      'Magento commerce domain and OAuth token are required. Set commerceDomain / instanceId in the request, tax-config in ABDB, or MAGENTO_COMMERCE_DOMAIN (+ instance id) on the action.'
    );
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

function buildMagentoTaxRatesSearchBaseUrl(config) {
  const domain = String(config.commerceDomain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const inst = String(config.instanceId || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (/\.api\.commerce\.adobe\.com$/i.test(domain) && !inst) {
    throw new Error(
      'Adobe Commerce SaaS REST needs instanceId in the path (…/instanceId/V1/…). Set magento_instance_id in Configuration or instanceId in the request.'
    );
  }
  const base = inst ? `https://${domain}/${inst}` : `https://${domain}`;
  return `${base}/V1/taxRates/search`;
}

async function fetchMagentoTaxRates(config) {
  const url = buildMagentoTaxRatesSearchBaseUrl(config);
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    params: {
      'searchCriteria[currentPage]': 1,
      'searchCriteria[pageSize]': 500
    },
    timeout: 120000,
    validateStatus: () => true
  });
  if (response.status >= 400) {
    const detail =
      typeof response.data === 'string'
        ? response.data.slice(0, 500)
        : JSON.stringify(response.data || {}).slice(0, 500);
    throw new Error(`Magento taxRates search HTTP ${response.status}: ${detail}`);
  }
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

async function insertSyncHistory(dbCtx, history, params) {
  const region = String(getDefaultRegion(params) || DEFAULT_REGION || '').trim();
  if (!region) {
    throw new Error('DEFAULT_REGION is not configured on the action (required for sync history).');
  }
  const historyCollection = resolveSyncHistoryCollectionName(params);
  const db = await libDb.init({
    token: dbCtx.bearerToken,
    region,
    ow: { namespace: dbCtx.namespace }
  });
  const client = await db.connect();
  try {
    const collection = await client.collection(historyCollection);
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
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Use GET or POST' }
    };
  }

  try {
    let payload = mergePayload(params);
    const auth = await resolveAuthAndNamespace(params);
    if (auth.error) {
      return {
        statusCode: auth.error.statusCode,
        headers: CORS,
        body: auth.error.body
      };
    }
    const dbRegion = String(getDefaultRegion(payload) || DEFAULT_REGION || '').trim();
    if (!dbRegion) {
      return {
        statusCode: 500,
        headers: CORS,
        body: {
          status: 'Error',
          message: 'DEFAULT_REGION is not configured on the sync-tax-rates action.'
        }
      };
    }

    const domainBefore = resolveCommerceDomain(payload);
    const instanceBefore = resolveInstanceId(payload);
    if (!domainBefore || !instanceBefore) {
      try {
        const fromCfg = await readTaxConfigMagentoPatch(
          { bearerToken: auth.accessToken, namespace: auth.namespace },
          dbRegion
        );
        if (fromCfg) payload = { ...fromCfg, ...payload };
      } catch (e) {
        console.warn('sync-tax-rates: could not load tax_config defaults', e?.message || e);
      }
    }

    const ratesCollectionName = resolveTaxRatesCollectionName(payload);
    const dbCtx = {
      bearerToken: auth.accessToken,
      namespace: auth.namespace,
      collectionName: ratesCollectionName
    };

    const magentoConfig = await getMagentoConfig(payload);
    const magentoRates = await fetchMagentoTaxRates(magentoConfig);

    const normalized = magentoRates.map(sanitizeMagentoRate).filter(Boolean);
    const existing = await findTaxRates({}, { limit: 5000 }, dbRegion, dbCtx);
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
            dbRegion,
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
            dbRegion,
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
      collection: ratesCollectionName
    };
    await insertSyncHistory(dbCtx, historyRow, payload);

    const MAX_ERRORS_IN_RESPONSE = 100;
    const errorsTruncated = errors.length > MAX_ERRORS_IN_RESPONSE;
    const errorsOut = errorsTruncated ? errors.slice(0, MAX_ERRORS_IN_RESPONSE) : errors;

    return {
      statusCode: 200,
      headers: CORS,
      body: {
        status: 'Success',
        message: `Magento sync finished. Synced ${historyRow.synced}, failed ${failed}.`,
        data: {
          ...historyRow,
          errors: errorsOut,
          errorsTotal: errors.length,
          errorsTruncated
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
