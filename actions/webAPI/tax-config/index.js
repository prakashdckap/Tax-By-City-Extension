/**
 * Tax configuration (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Persists settings in App Builder Database collection `tax_config` (single logical document: config_key=default).
 * Operations match legacy tax-config: GET / UPDATE / ENABLE / DISABLE + health when operation omitted.
 * UPDATE also calls Adobe Commerce ACCS `POST /V1/oope_tax_management/tax_integration` when
 * `oop_tax_calculation_enabled` is saved (requires Commerce domain, instance id, and IMS token with commerce.accs).
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken } = require('@adobe/aio-lib-core-auth');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

const COLLECTION_NAME = 'tax_config';
const CONFIG_KEY = 'default';

const DEFAULT_CONFIG = {
  tax_by_city_enabled: true,
  fallback_to_magento: true,
  cache_enabled: true,
  cache_ttl: 3600,
  /** When true, saving config calls ACCS `POST /V1/oope_tax_management/tax_integration` to activate OOP tax. */
  oop_tax_calculation_enabled: false
};

const OOP_TAX_INTEGRATION_CODE = 'tax-by-city';
const OOP_TAX_INTEGRATION_TITLE = 'Tax by city';

function pget(obj, key) {
  if (!obj) return process.env[key];
  const v = obj[key] != null && obj[key] !== '' ? obj[key] : null;
  return v != null && v !== '' ? v : process.env[key];
}

function normalizeCommerceHost(domain) {
  return String(domain || '')
    .trim()
    .replace(/\.admin\.commerce\.adobe\.com$/i, '.api.commerce.adobe.com');
}

/**
 * Magento / ACCS REST — same IMS client_credentials shape as sync-tax-rates.
 * ADOBE_SCOPE (or env) must include `commerce.accs` for Adobe Commerce as a Cloud Service.
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

async function resolveCommerceAccessTokenForOop(params, mergeInputs) {
  const flat = { ...process.env, ...params, ...(mergeInputs || {}) };
  const explicit = pget(flat, 'accessToken') || pget(flat, 'MAGENTO_ACCESS_TOKEN');
  if (explicit) return String(explicit).trim();
  try {
    const ims = buildMagentoImsParams(flat);
    if (!ims.clientId || !ims.clientSecret) return null;
    const tokenRes = await generateAccessToken(ims);
    if (tokenRes && tokenRes.access_token) return tokenRes.access_token;
  } catch (e) {
    console.warn('tax-config: OOP tax IMS token failed:', e?.message || e);
  }
  return null;
}

/**
 * Create/update out-of-process tax integration on Adobe Commerce (ACCS) REST.
 * @see https://developer.adobe.com/commerce/extensibility/starter-kit/checkout/tax-reference/
 */
async function pushOopTaxIntegrationToCommerce(params, mergeInputs, savedConfig) {
  const active = savedConfig.oop_tax_calculation_enabled === true;
  const domain = normalizeCommerceHost(
    pget(mergeInputs, 'magento_commerce_domain') || savedConfig.magento_commerce_domain || pget(params, 'MAGENTO_COMMERCE_DOMAIN')
  )
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
  const instanceId = String(
    pget(mergeInputs, 'magento_instance_id') || savedConfig.magento_instance_id || pget(params, 'MAGENTO_INSTANCE_ID') || ''
  ).trim();

  if (!domain) {
    return { success: false, skipped: true, message: 'Set Commerce domain in Configuration (magento_commerce_domain)' };
  }
  if (/\.api\.commerce\.adobe\.com$/i.test(domain) && !instanceId) {
    return {
      success: false,
      skipped: true,
      message: 'Adobe Commerce SaaS REST requires instance id in the URL. Set magento_instance_id in Configuration.'
    };
  }

  const token = await resolveCommerceAccessTokenForOop(params, mergeInputs);
  if (!token) {
    return {
      success: false,
      skipped: true,
      message:
        'Could not obtain Commerce OAuth token. Set ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, and ADOBE_SCOPE (include commerce.accs) on the tax-config action.'
    };
  }

  const base = instanceId ? `https://${domain}/${instanceId}` : `https://${domain}`;
  const url = `${base}/V1/oope_tax_management/tax_integration`;
  const body = {
    tax_integration: {
      code: OOP_TAX_INTEGRATION_CODE,
      title: OOP_TAX_INTEGRATION_TITLE,
      active,
      stores: ['default'],
      credit_memo_tax_enabled: false
    }
  };

  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Store: 'default'
      },
      validateStatus: () => true,
      timeout: 60000
    });
    if (res.status >= 200 && res.status < 300) {
      return { success: true, statusCode: res.status, data: res.data, active };
    }
    const msg =
      res.data && typeof res.data === 'object'
        ? JSON.stringify(res.data)
        : String(res.data || res.statusText || res.status);
    return { success: false, statusCode: res.status, message: msg, active };
  } catch (e) {
    return {
      success: false,
      message: e.response?.data ? JSON.stringify(e.response.data) : e.message || String(e),
      active
    };
  }
}

async function initDbWithCtx(dbCtx, region = DEFAULT_REGION) {
  const { bearerToken, namespace } = dbCtx;
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(COLLECTION_NAME);
  return { client, collection };
}

function pickNonOw(params) {
  const o = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') o[k] = v;
  }
  return o;
}

function mergeInputs(params) {
  const query = {};
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      for (const [k, v] of q.entries()) {
        if (v !== undefined && v !== '') query[k] = v;
      }
    } catch (e) {
      console.warn('tax-config: __ow_query', e?.message || e);
    }
  }
  let body = {};
  if (params.__ow_body) {
    const raw = params.__ow_body;
    try {
      if (typeof raw === 'string') {
        try {
          body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        } catch {
          body = JSON.parse(raw);
        }
      } else if (typeof raw === 'object' && !Array.isArray(raw)) {
        body = raw;
      }
    } catch (e) {
      throw new Error('Invalid JSON in request body: ' + e.message);
    }
  }
  const flat = pickNonOw(params);
  return { ...query, ...flat, ...body };
}

function stripInternal(doc) {
  if (!doc || typeof doc !== 'object') return {};
  const { _id, config_key, created_at, updated_at, ...rest } = doc;
  return rest;
}

/** ABDB findOne throws "Document not found" when no row matches; findArray returns []. */
function allErrorText(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const parts = [
    err.message,
    err.reason,
    err.description,
    err.response?.data?.message,
    err.body && (typeof err.body === 'string' ? err.body : err.body?.message)
  ];
  return parts.filter(Boolean).join(' ');
}

function isDocumentNotFoundError(err) {
  const msg = allErrorText(err) || String(err);
  return (
    /document not found/i.test(msg) ||
    (/findOne/i.test(msg) && /not found/i.test(msg))
  );
}

/** Prefer findArray — avoids ABDB findOne throwing on empty result. */
async function findConfigDocOrNull(collection, filter) {
  try {
    const rows = await collection.findArray(filter, { limit: 1 });
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0];
  } catch (e) {
    if (isDocumentNotFoundError(e)) return null;
    throw e;
  }
}

async function readConfig(dbCtx, region) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    const doc = await findConfigDocOrNull(collection, { config_key: CONFIG_KEY });
    const merged = { ...DEFAULT_CONFIG, ...stripInternal(doc) };
    return merged;
  } finally {
    if (client) await client.close();
  }
}

async function writeConfig(dbCtx, region, patch) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    const existing = await findConfigDocOrNull(collection, { config_key: CONFIG_KEY });
    const next = {
      ...DEFAULT_CONFIG,
      ...(existing ? stripInternal(existing) : {}),
      ...patch,
      config_key: CONFIG_KEY,
      updated_at: new Date()
    };
    if (!existing) {
      next.created_at = new Date();
    }
    await collection.updateOne(
      { config_key: CONFIG_KEY },
      { $set: next },
      { upsert: true }
    );
    return { ...DEFAULT_CONFIG, ...stripInternal(next) };
  } finally {
    if (client) await client.close();
  }
}

async function runTaxConfigFlow(params, dbCtx) {
  let merged;
  try {
    merged = mergeInputs(params);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: { status: 'Error', message: e.message || 'Invalid request' }
    };
  }

  const region = merged.region || params.region || DEFAULT_REGION;
  const operation = merged.operation != null ? String(merged.operation).trim() : '';

  if (!operation) {
    const config = await readConfig(dbCtx, region);
    return {
      statusCode: 200,
      headers: CORS,
      body: { status: 'ok', config }
    };
  }

  const op = operation.toUpperCase();

  switch (op) {
    case 'GET':
    case 'GET_CONFIG': {
      const config = await readConfig(dbCtx, region);
      return {
        statusCode: 200,
        headers: CORS,
        body: config
      };
    }

    case 'PUT':
    case 'UPDATE': {
      if (!merged.config || typeof merged.config !== 'object') {
        return {
          statusCode: 400,
          headers: CORS,
          body: { status: 'Error', message: 'config is required for UPDATE operation' }
        };
      }
      const patch = { ...merged.config };
      const effectiveForOop = { ...DEFAULT_CONFIG, ...patch };
      const oopResult = await pushOopTaxIntegrationToCommerce(params, { ...merged, ...patch }, effectiveForOop);
      if (oopResult && !oopResult.skipped) {
        patch.oop_tax_integration_last_sync_at = new Date().toISOString();
        patch.oop_tax_integration_last_sync_ok = oopResult.success === true;
        patch.oop_tax_integration_last_sync_message = oopResult.success
          ? `HTTP ${oopResult.statusCode}`
          : String(oopResult.message || '').slice(0, 500);
      }
      const config = await writeConfig(dbCtx, region, patch);
      return {
        statusCode: 200,
        headers: CORS,
        body: { ...config, oop_tax_integration: oopResult }
      };
    }

    case 'ENABLE': {
      const config = await writeConfig(dbCtx, region, { tax_by_city_enabled: true });
      return {
        statusCode: 200,
        headers: CORS,
        body: config
      };
    }

    case 'DISABLE': {
      const config = await writeConfig(dbCtx, region, { tax_by_city_enabled: false });
      return {
        statusCode: 200,
        headers: CORS,
        body: config
      };
    }

    default:
      return {
        statusCode: 400,
        headers: CORS,
        body: { status: 'Error', message: `Unsupported operation: ${operation}` }
      };
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
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  if (method !== 'GET' && method !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Method not allowed. Use GET or POST.' }
    };
  }

  const authResult = await resolveAuthAndNamespace(params);
  if (authResult.error) {
    const e = authResult.error;
    return {
      statusCode: e.statusCode,
      headers: { ...CORS, ...(e.statusCode === 401 ? { 'WWW-Authenticate': 'Basic realm="Tax API"' } : {}) },
      body: e.body
    };
  }

  const dbCtx = { bearerToken: authResult.accessToken, namespace: authResult.namespace };

  try {
    return await runTaxConfigFlow(params, dbCtx);
  } catch (error) {
    console.error('tax-config (webAPI):', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: error.message || 'server error'
      }
    };
  }
}

exports.main = main;
