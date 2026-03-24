/**
 * Tax configuration (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Persists settings in App Builder Database collection `tax_config` (single logical document: config_key=default).
 * Operations match legacy tax-config: GET / UPDATE / ENABLE / DISABLE + health when operation omitted.
 */

const libDb = require('@adobe/aio-lib-db');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

const COLLECTION_NAME = 'tax_config';
const CONFIG_KEY = 'default';

const DEFAULT_CONFIG = {
  tax_by_city_enabled: true,
  fallback_to_magento: true,
  cache_enabled: true,
  cache_ttl: 3600
};

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
      const config = await writeConfig(dbCtx, region, merged.config);
      return {
        statusCode: 200,
        headers: CORS,
        body: config
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
