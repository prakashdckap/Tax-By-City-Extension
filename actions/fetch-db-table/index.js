/**
 * Fetch App Builder Database Table - Returns documents from any App Builder DB collection.
 * GET or POST /fetch-db-table
 *
 * Auth:
 * - The web URL requires a Bearer token with scopes [additional_info.roles, read_organizations] (platform rule).
 * - Pass Authorization: Bearer <token>. Get the token by: (1) raw invoke of generate-token with Basic auth, or (2) aio auth:token.
 * - If no Bearer is sent but the action has clientId/clientSecret (default params), the action generates a token for the DB
 *   (this path is used when invoking via raw API with Basic auth; the web gateway still requires Bearer for the web URL).
 *
 * Query/body params:
 * - collection (required): Collection/table name
 * - filter: JSON object for MongoDB-style filter (default {})
 * - limit: Max results (default 100, use 0 for no limit, max 1000)
 * - skip: Number to skip (default 0)
 * - sort: JSON object for sort, e.g. { "created_at": -1 }
 * - region: Database region (amer, emea, apac) - default: amer
 */

const https = require('https');
const libDb = require('@adobe/aio-lib-db');

const DEFAULT_REGION = 'amer';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPE = 'adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage';
const DB_SERVICE_URL_TEMPLATE = 'https://storage-database-<region>.app-builder.int.adp.adobe.io';

function getBearerToken(params) {
  const headers = params.__ow_headers || {};
  const auth = headers.authorization || headers.Authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.substring(7).trim();
  }
  return null;
}

function hasServiceCredentials(params) {
  const clientId = params.clientId || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.clientSecret || process.env.ADOBE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
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
    // Fallback: IMS token (if lib is updated to accept token)
    let accessToken;
    if (hasServiceCredentials(params)) {
      accessToken = await getServiceTokenDirect(params);
    } else {
      const bearerToken = getBearerToken(params);
      if (bearerToken) accessToken = bearerToken;
      else throw new Error('No DB auth: set runtimeNamespace and runtimeAuth (or __OW_NAMESPACE/__OW_API_KEY) or clientId/clientSecret.');
    }
    const db = await libDb.init({ token: accessToken, region });
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

  ['collection', 'filter', 'limit', 'skip', 'sort', 'region'].forEach(key => {
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
  const collectionName = query.collection;

  if (!collectionName || typeof collectionName !== 'string' || !collectionName.trim()) {
    throw new Error('Missing required parameter: collection');
  }
  if (isNaN(limit) || limit < 0 || limit > MAX_LIMIT) {
    throw new Error(`limit must be 0 or between 1 and ${MAX_LIMIT}`);
  }
  if (isNaN(skip) || skip < 0) {
    throw new Error('skip must be a non-negative number');
  }

  return { collectionName: collectionName.trim(), filter, sort, limit, skip, region };
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
    const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || '3676633-taxbycity-stage';
    let bearerToken = getBearerToken(params);
    if (!bearerToken && hasServiceCredentials(params)) {
      bearerToken = await getServiceTokenDirect(params);
    }

    let items;
    if (bearerToken) {
      const findOptions = {};
      if (limit) findOptions.limit = limit;
      if (skip) findOptions.skip = skip;
      if (sort && typeof sort === 'object' && Object.keys(sort).length) findOptions.sort = sort;
      const raw = await dbFindWithBearerToken(namespace, region, bearerToken, collectionName, filter, findOptions);
      items = Array.isArray(raw) ? raw : (raw?.cursor?.firstBatch || raw?.documents || []);
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
    const message = error.message || String(error);
    const statusCode = message.includes('Missing') || message.includes('Invalid') ? 400 : 500;
    return {
      statusCode,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: { status: 'Error', message }
    };
  }
}

exports.main = main;
