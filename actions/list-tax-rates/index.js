/**
 * List tax rates from App Builder Database.
 * GET or POST /list-tax-rates
 *
 * Collection and token are obtained inside the action (not from payload):
 * - Collection: TAX_RATES_COLLECTION ('tax_rates'), overridable via env TAX_RATES_COLLECTION.
 * - Token: obtained by calling the token generation action (get-db-token or DBToken) with the request's Basic auth; fallback to service credentials if bound.
 *
 * Invoke with Basic auth (namespace:key). Optional payload/query params:
 * - filter: MongoDB-style filter (default {})
 * - limit: Max results (default 100, max 1000)
 * - skip: Number to skip (default 0)
 * - sort: Sort object, e.g. { "created_at": -1 }
 * - region: Database region (default: amer)
 */

const https = require('https');
const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');

const DEFAULT_REGION = 'amer';
const DEFAULT_NAMESPACE = '3676633-taxbycity-stage';
/** Collection name used for tax rates; defined in code, not from payload. */
const TAX_RATES_COLLECTION = process.env.TAX_RATES_COLLECTION || 'tax_rates';
/** Fallback Basic auth (base64) for calling token action when not in params/headers; override with RUNTIME_AUTH_BASE64 or DEFAULT_RUNTIME_AUTH_BASE64. */
const DEFAULT_RUNTIME_AUTH_BASE64 = process.env.DEFAULT_RUNTIME_AUTH_BASE64 || 'YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';
const APIHOST = 'https://adobeioruntime.net';
/** Build token generation action URLs for a namespace. Package action (get-db-token) has app.config inputs; DBToken is root action. */
function getTokenActionUrls(namespace) {
  const ns = namespace || DEFAULT_NAMESPACE;
  return [
    process.env.GET_DB_TOKEN_URL || `${APIHOST}/api/v1/namespaces/${ns}/actions/tax-by-city/get-db-token?result=true&blocking=true`,
    process.env.DB_TOKEN_URL || `${APIHOST}/api/v1/namespaces/${ns}/actions/DBToken?result=true&blocking=true`
  ];
}
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPE = 'adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage';
const DB_SERVICE_URL_TEMPLATE = 'https://storage-database-<region>.app-builder.int.adp.adobe.io';

function hasServiceCredentials(params) {
  const clientId = params.clientId || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.clientSecret || process.env.ADOBE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Get namespace from Basic auth (username is typically the namespace). Decodes base64 and returns the part before ':'.
 */
function getNamespaceFromBasicAuth(basicAuthBase64) {
  if (!basicAuthBase64 || typeof basicAuthBase64 !== 'string') return null;
  try {
    const decoded = Buffer.from(basicAuthBase64.trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const username = colon >= 0 ? decoded.substring(0, colon).trim() : decoded.trim();
    return username || null;
  } catch (_) {
    return null;
  }
}

/**
 * Get token from the token generation action (get-db-token or DBToken).
 * Uses Basic auth from request or RUNTIME_AUTH_BASE64. Calls the token action in the namespace from the auth username so credentials match.
 * @param {Object} params - Request params (__ow_headers for Authorization, __OW_NAMESPACE for fallback URL)
 * @returns {Promise<{token: string, namespace: string}|null>} { token, namespace } or null; namespace is the one used for the token (use for DB call)
 */
async function getTokenFromTokenAction(params) {
  const headers = params.__ow_headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  const basicAuth = params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64 ||
    (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Basic ') ? authHeader.substring(6).trim() : null) ||
    DEFAULT_RUNTIME_AUTH_BASE64;
  if (!basicAuth) return null;
  // Prefer namespace from Basic auth (username) so token and DB workspace match; fallback to action's namespace
  const namespaceFromAuth = getNamespaceFromBasicAuth(basicAuth);
  const actionNamespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE;
  const namespacesToTry = namespaceFromAuth && namespaceFromAuth !== actionNamespace
    ? [namespaceFromAuth, actionNamespace]
    : [namespaceFromAuth || actionNamespace];
  const opts = { method: 'post', headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${basicAuth}` }, data: {}, timeout: 15000 };
  for (const ns of namespacesToTry) {
    const urls = getTokenActionUrls(ns);
    for (const url of urls) {
      try {
        const res = await axios.request({ ...opts, url });
        const raw = res.data;
        const result = raw?.response?.result ?? raw?.result ?? raw;
        const body = result?.body ?? result;
        const token = body?.access_token || null;
        if (token) return { token, namespace: ns };
      } catch (_) {
        /* try next URL */
      }
    }
  }
  return null;
}

/** Call App Builder DB API with Bearer token (same token that works for aio app db status). */
function dbFindWithBearerToken(namespace, region, bearerToken, collectionName, filter, options) {
  const baseUrl = DB_SERVICE_URL_TEMPLATE.replace(/<region>/gi, (region || DEFAULT_REGION).toLowerCase());
  const path = `/v1/collection/${encodeURIComponent(collectionName)}/find`;
  const body = JSON.stringify({ filter: filter || {}, options: options || {} });
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = https.request({
      hostname: u.hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${bearerToken}`,
        'x-runtime-namespace': namespace
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) {
            reject(new Error(json.message || data || `HTTP ${res.statusCode}`));
            return;
          }
          if (json.success && json.data !== undefined) resolve(json.data);
          else reject(new Error(json.message || 'Invalid DB response'));
        } catch (e) {
          reject(new Error(data || e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function getServiceTokenDirect(params) {
  return new Promise((resolve, reject) => {
    const clientId = params.clientId || process.env.ADOBE_CLIENT_ID;
    const clientSecret = params.clientSecret || process.env.ADOBE_CLIENT_SECRET;
    const scope = params.scope || process.env.ADOBE_SCOPE || DEFAULT_SCOPE;
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: scope
    }).toString();

    const u = new URL(IMS_TOKEN_URL);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(json.error_description || json.error || data || 'No access_token'));
        } catch (e) {
          reject(new Error(data || e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function initDb(params, region = DEFAULT_REGION) {
  try {
    // aio-lib-db uses Runtime Basic auth (namespace:apikey), not IMS token. See lib/init.js and apiRequest.js.
    const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE;
    const auth = params.__OW_API_KEY || params.runtimeAuth || process.env.__OW_API_KEY;
    if (namespace && auth) {
      const db = await libDb.init({ ow: { namespace, auth }, region });
      const client = await db.connect();
      return { client, db };
    }
    // Fallback: IMS token from token action or service credentials
    let tokenResult = await getTokenFromTokenAction(params);
    let accessToken = tokenResult ? tokenResult.token : null;
    let ns = tokenResult ? tokenResult.namespace : (params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE);
    if (!accessToken && hasServiceCredentials(params)) {
      accessToken = await getServiceTokenDirect(params);
      ns = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE;
    }
    if (!accessToken) {
      throw new Error('No DB auth: invoke with Basic auth (namespace:key) so the token action can be called, or set runtimeNamespace and runtimeAuth, or clientId/clientSecret.');
    }
    const db = await libDb.init({ token: accessToken, region, ow: { namespace: ns } });
    const client = await db.connect();
    return { client, db };
  } catch (error) {
    console.error('fetch-db-table initDb failed:', error?.message, error?.name, error?.code);
    if (error && error.name === 'DbError') {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

function parseParams(params) {
  const method = String(params['__ow_method'] || params.method || 'get').toUpperCase();
  let query = {};

  if (method === 'GET' && params['__ow_query']) {
    try {
      const q = typeof params['__ow_query'] === 'string'
        ? new URLSearchParams(params['__ow_query'])
        : null;
      if (q) {
        for (const [k, v] of q.entries()) {
          if (v !== undefined && v !== '') query[k] = v;
        }
      }
    } catch (e) {
      console.warn('Error parsing __ow_query:', e);
    }
  }

  if (method === 'POST' && params['__ow_body']) {
    try {
      const body = typeof params['__ow_body'] === 'string'
        ? JSON.parse(params['__ow_body']) : params['__ow_body'];
      if (body && typeof body === 'object') {
        Object.assign(query, body);
      }
    } catch (e) {
      console.warn('Error parsing __ow_body:', e);
    }
  }

  ['filter', 'limit', 'skip', 'sort', 'region'].forEach(key => {
    if (params[key] !== undefined && params[key] !== '' && query[key] === undefined) {
      query[key] = params[key];
    }
  });

  let filter = {};
  if (query.filter) {
    try {
      filter = typeof query.filter === 'string' ? JSON.parse(query.filter) : query.filter;
    } catch (e) {
      throw new Error(`Invalid filter JSON: ${e.message}`);
    }
  }

  let sort = null;
  if (query.sort) {
    try {
      sort = typeof query.sort === 'string' ? JSON.parse(query.sort) : query.sort;
    } catch (e) {
      throw new Error(`Invalid sort JSON: ${e.message}`);
    }
  }

  const limit = query.limit !== undefined && query.limit !== ''
    ? parseInt(query.limit, 10) : DEFAULT_LIMIT;
  const skip = query.skip !== undefined && query.skip !== ''
    ? parseInt(query.skip, 10) : 0;
  const region = query.region || DEFAULT_REGION;

  if (isNaN(limit) || limit < 0 || limit > MAX_LIMIT) {
    throw new Error(`limit must be 0 or between 1 and ${MAX_LIMIT}`);
  }
  if (isNaN(skip) || skip < 0) {
    throw new Error('skip must be a non-negative number');
  }

  return { collectionName: TAX_RATES_COLLECTION, filter, sort, limit, skip, region };
}

async function main(params) {
  try {
    const method = String(params['__ow_method'] || params.method || 'get').toUpperCase();
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
          'Access-Control-Max-Age': '86400'
        },
        body: {}
      };
    }
    if (method !== 'GET' && method !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: { status: 'Error', message: 'Method not allowed. Use GET or POST.' }
      };
    }

    const { collectionName, filter, sort, limit, skip, region } = parseParams(params);
    const actionNamespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE;
    // Token from code: token action (uses Basic auth username as namespace for URL); use that namespace for DB so token and DB workspace match
    let tokenResult = await getTokenFromTokenAction(params);
    let bearerToken = tokenResult ? tokenResult.token : null;
    let dbNamespace = tokenResult ? tokenResult.namespace : actionNamespace;
    if (!bearerToken && hasServiceCredentials(params)) {
      bearerToken = await getServiceTokenDirect(params);
      dbNamespace = actionNamespace;
    }

    let items;
    const findOptions = {};
    if (limit) findOptions.limit = limit;
    if (skip) findOptions.skip = skip;
    if (sort && typeof sort === 'object' && Object.keys(sort).length) findOptions.sort = sort;

    if (bearerToken) {
      try {
        const raw = await dbFindWithBearerToken(dbNamespace, region, bearerToken, collectionName, filter, findOptions);
        items = Array.isArray(raw) ? raw : (raw?.cursor?.firstBatch || raw?.documents || []);
      } catch (err) {
        if (err.message && err.message.includes('Missing required scope')) {
          const retryResult = await getTokenFromTokenAction(params);
          if (retryResult) {
            const raw = await dbFindWithBearerToken(retryResult.namespace, region, retryResult.token, collectionName, filter, findOptions);
            items = Array.isArray(raw) ? raw : (raw?.cursor?.firstBatch || raw?.documents || []);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    } else {
      const { client, db } = await initDb(params, region);
      const collection = await client.collection(collectionName);
      let cursor = collection.find(filter);
      if (sort && typeof sort === 'object' && Object.keys(sort).length) cursor = cursor.sort(sort);
      if (skip) cursor = cursor.skip(skip);
      if (limit) cursor = cursor.limit(limit);
      items = await cursor.toArray();
      await client.close();
    }

    const data = (Array.isArray(items) ? items : []).map(item => {
      const doc = JSON.parse(JSON.stringify(item, (_, v) => {
        if (v && typeof v === 'object' && v.$oid) return v.$oid;
        if (v && typeof v === 'object' && v.$date) return typeof v.$date === 'object' && v.$date.$numberLong ? parseInt(v.$date.$numberLong, 10) : v.$date;
        if (v && typeof v === 'object' && (v.$numberLong !== undefined || v.$numberInt !== undefined)) return parseInt(v.$numberLong || v.$numberInt, 10);
        if (v && typeof v === 'object' && v.$numberDouble !== undefined) return parseFloat(v.$numberDouble, 10);
        return v;
      }));
      if (doc._id && typeof doc._id === 'object') doc._id = doc._id.toString?.() || String(doc._id);
      return doc;
    });

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: {
        status: 'Success',
        collection: collectionName,
        data,
        count: data.length
      }
    };
  } catch (error) {
    console.error('fetch-db-table error:', error);
    let message = error.message || String(error);
    const statusCode = message.includes('Missing') || message.includes('Invalid') ? 400 : 500;
    if (message.includes('Missing required scope') || message.includes('Oauth token is not valid')) {
      message += '. Ensure the Developer Console project has Adobe App Builder Data Services enabled and the token (or get-db-token/DBToken) requests scopes adobeio.abdata.read, adobeio.abdata.write.';
    }
    return {
      statusCode,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: { status: 'Error', message }
    };
  }
}

exports.main = main;
