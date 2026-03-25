/**
 * List tax rates (Web API) — same security model as hello-api:
 * 1) Require Basic auth; validate against RUNTIME_USERNAME/RUNTIME_PASSWORD (or RUNTIME_AUTH_BASE64).
 * 2) IMS access token via @adobe/aio-lib-core-auth generateAccessToken (include-ims-credentials).
 * 3) Query App Builder Database with filter / limit / skip / sort / region (same behavior as actions/list-tax-rates).
 */

const https = require('https');
const crypto = require('crypto');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken } = require('@adobe/aio-lib-core-auth');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff'
};

function getRuntimeConfig(params = {}) {
  const defaultRegion = String(params.DEFAULT_REGION || process.env.DEFAULT_REGION || '').trim();
  const defaultLimit = Number.parseInt(params.DEFAULT_LIMIT || process.env.DEFAULT_LIMIT, 10);
  const maxLimit = Number.parseInt(params.MAX_LIMIT || process.env.MAX_LIMIT, 10);
  const taxRatesCollection = String(
    params.TAX_RATES_COLLECTION || process.env.TAX_RATES_COLLECTION || ''
  ).trim();

  return {
    defaultRegion,
    defaultLimit,
    maxLimit,
    taxRatesCollection
  };
}

function getConfigValidationError(config) {
  if (!config.defaultRegion) return 'DEFAULT_REGION is not configured.';
  if (Number.isNaN(config.defaultLimit)) return 'DEFAULT_LIMIT must be configured as an integer.';
  if (Number.isNaN(config.maxLimit)) return 'MAX_LIMIT must be configured as an integer.';
  if (!config.taxRatesCollection) return 'TAX_RATES_COLLECTION is not configured.';
  return null;
}

function secureCompare(a, b) {
  if (a == null || b == null) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  if (ha.length !== hb.length) return false;
  return crypto.timingSafeEqual(ha, hb);
}

function getExpectedBasicAuthBase64(params) {
  const base64 = params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64;
  if (base64 && typeof base64 === 'string' && base64.trim()) return base64.trim();

  const aioRuntimeAuth = process.env.AIO_runtime_auth || '';
  if (aioRuntimeAuth.trim()) {
    const rawValue = aioRuntimeAuth.trim();
    // `.env` may store runtime auth as `namespace:secret`; convert it to Basic auth format.
    if (rawValue.includes(':')) {
      return Buffer.from(rawValue, 'utf-8').toString('base64');
    }
    return rawValue;
  }

  const username = (params.RUNTIME_USERNAME || process.env.RUNTIME_USERNAME || '').trim();
  const password = (params.RUNTIME_PASSWORD || process.env.RUNTIME_PASSWORD || '').trim();
  if (username && password) {
    return Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
  }
  return null;
}

/** Map app.config ADOBE_* inputs to names @adobe/aio-lib-core-auth expects (orgId, clientId, clientSecret, scopes). */
function normalizeImsParamsForToken(params) {
  const merged = { ...params };
  if (merged.orgId == null && merged.ADOBE_ORG_ID != null) merged.orgId = merged.ADOBE_ORG_ID;
  if (merged.clientId == null && merged.ADOBE_CLIENT_ID != null) merged.clientId = merged.ADOBE_CLIENT_ID;
  if (merged.clientSecret == null && merged.ADOBE_CLIENT_SECRET != null) merged.clientSecret = merged.ADOBE_CLIENT_SECRET;
  if (merged.scopes == null && merged.ADOBE_SCOPE != null) {
    const s = merged.ADOBE_SCOPE;
    if (Array.isArray(s)) merged.scopes = s;
    else if (typeof s === 'string') {
      try {
        merged.scopes = JSON.parse(s);
      } catch {
        merged.scopes = s.split(/[,\s]+/).filter(Boolean);
      }
    }
  }
  return merged;
}

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

/** Basic username is often the OAuth credential id (UUID). App Builder Database needs the I/O Runtime namespace (e.g. 3676633-taxbycity-stage). */
function looksLikeOAuthCredentialId(username) {
  if (!username || typeof username !== 'string') return false;
  const s = username.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body != null ? JSON.stringify(body) : '';
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers
        }
      },
      (res) => {
        let response = '';
        res.on('data', (chunk) => {
          response += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(response);
            if (res.statusCode >= 400) {
              reject(new Error(json.message || response || `HTTP ${res.statusCode}`));
            } else {
              resolve(json);
            }
          } catch (_) {
            reject(new Error(response));
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function parseParams(params, config) {
  const method = String(params.__ow_method || params.method || 'get').toUpperCase();
  let query = {};

  if (method === 'GET' && params.__ow_query) {
    try {
      const q = typeof params.__ow_query === 'string' ? new URLSearchParams(params.__ow_query) : null;
      if (q) {
        for (const [k, v] of q.entries()) {
          if (v !== undefined && v !== '') query[k] = v;
        }
      }
    } catch (e) {
      console.warn('Error parsing __ow_query:', e);
    }
  }

  if (method === 'POST' && params.__ow_body) {
    try {
      const body = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
      if (body && typeof body === 'object') Object.assign(query, body);
    } catch (e) {
      console.warn('Error parsing __ow_body:', e);
    }
  }

  ['filter', 'limit', 'skip', 'sort', 'region', 'page'].forEach((key) => {
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

  let limit = query.limit !== undefined && query.limit !== '' ? parseInt(query.limit, 10) : config.defaultLimit;
  let skip = query.skip !== undefined && query.skip !== '' ? parseInt(query.skip, 10) : 0;
  const region = query.region || config.defaultRegion;

  const pageVal = query.page !== undefined && query.page !== '' ? parseInt(query.page, 10) : NaN;
  if (!Number.isNaN(pageVal) && pageVal > 0 && limit > 0) {
    const explicitSkip = query.skip !== undefined && query.skip !== '';
    if (!explicitSkip) skip = (pageVal - 1) * limit;
  }

  if (Number.isNaN(limit) || limit < 0 || limit > config.maxLimit) {
    throw new Error(`limit must be 0 or between 1 and ${config.maxLimit}`);
  }
  if (Number.isNaN(skip) || skip < 0) {
    throw new Error('skip must be a non-negative number');
  }

  return { collectionName: config.taxRatesCollection, filter, sort, limit, skip, region };
}

function normalizeDocuments(items) {
  const raw = Array.isArray(items) ? items : items?.cursor?.firstBatch || items?.documents || [];
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const doc = JSON.parse(
      JSON.stringify(item, (_, v) => {
        if (v && typeof v === 'object' && v.$oid) return v.$oid;
        if (v && typeof v === 'object' && v.$date) {
          return typeof v.$date === 'object' && v.$date.$numberLong
            ? parseInt(v.$date.$numberLong, 10)
            : v.$date;
        }
        if (v && typeof v === 'object' && (v.$numberLong !== undefined || v.$numberInt !== undefined)) {
          return parseInt(v.$numberLong || v.$numberInt, 10);
        }
        if (v && typeof v === 'object' && v.$numberDouble !== undefined) return parseFloat(v.$numberDouble, 10);
        return v;
      })
    );
    if (doc._id && typeof doc._id === 'object') {
      doc._id = doc._id.toString?.() || String(doc._id);
    }
    return doc;
  });
}

async function dbFindWithBearerToken(config, namespace, region, bearerToken, collectionName, filter, findOptions) {
  const resolvedRegion = String(region || config.defaultRegion || '').trim();
  let client;
  try {
    const db = await libDb.init({ token: bearerToken, region: resolvedRegion, ow: { namespace } });
    client = await db.connect();
    const collection = await client.collection(collectionName);

    let cursor = collection.find(filter || {});
    if (findOptions?.sort && typeof findOptions.sort === 'object' && Object.keys(findOptions.sort).length) {
      cursor = cursor.sort(findOptions.sort);
    }
    if (findOptions?.skip) {
      cursor = cursor.skip(findOptions.skip);
    }
    if (findOptions?.limit) {
      cursor = cursor.limit(findOptions.limit);
    }

    return await cursor.toArray();
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.warn('list-tax-rates: client.close warning', closeErr?.message || closeErr);
      }
    }
  }
}

async function main(params) {
  try {
    const config = getRuntimeConfig(params);
    const configError = getConfigValidationError(config);
    if (configError) {
      return {
        statusCode: 500,
        headers: CORS,
        body: { status: 'Error', message: configError }
      };
    }

    const method = (params.__ow_method || params.method || 'GET').toUpperCase();
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
        headers: { ...CORS, 'Access-Control-Allow-Origin': '*' },
        body: { status: 'Error', message: 'Method not allowed. Use GET or POST.' }
      };
    }

    const { collectionName, filter, sort, limit, skip, region } = parseParams(params, config);

    const auth = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
    let namespace =
      params.__OW_NAMESPACE ||
      process.env.__OW_NAMESPACE ||
      process.env.AIO_runtime_namespace ||
      params.__ow_headers?.['x-runtime-namespace'] ||
      params.__ow_headers?.['X-Runtime-Namespace'] ||
      '';

    if (auth && typeof auth === 'string' && auth.startsWith('Basic ')) {
      const providedBase64 = auth.slice(6).trim();
      const expectedBase64 = getExpectedBasicAuthBase64(params);
      if (!expectedBase64) {
        return {
          statusCode: 500,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'Runtime auth is not configured. Set RUNTIME_AUTH_BASE64, AIO_runtime_auth, or RUNTIME_USERNAME/RUNTIME_PASSWORD.'
          }
        };
      }
      if (!secureCompare(providedBase64, expectedBase64)) {
        return {
          statusCode: 401,
          headers: { ...CORS, 'WWW-Authenticate': 'Basic realm="Tax API"' },
          body: { status: 'Error', error: 'Unauthorized' }
        };
      }
      const namespaceFromAuth = getNamespaceFromBasicAuth(providedBase64);
      if (namespaceFromAuth && !looksLikeOAuthCredentialId(namespaceFromAuth)) {
        namespace = namespaceFromAuth;
      }
      if (!namespace) {
        return {
          statusCode: 400,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'Cannot resolve Runtime namespace (Basic username should be the namespace, or set __OW_NAMESPACE).'
          }
        };
      }
    } else if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
      const userToken = auth.replace(/^Bearer\s+/i, '').trim();
      if (!userToken) {
        return { statusCode: 401, headers: CORS, body: { status: 'Error', error: 'Unauthorized' } };
      }
      const hdrNs =
        params.__ow_headers?.['x-runtime-namespace'] || params.__ow_headers?.['X-Runtime-Namespace'];
      if (hdrNs && String(hdrNs).trim()) namespace = String(hdrNs).trim();
      if (!namespace) {
        return {
          statusCode: 400,
          headers: CORS,
          body: {
            status: 'Error',
            message:
              'Cannot resolve Runtime namespace for UI calls (send x-runtime-namespace header, e.g. 3676633-taxbycity-stage).'
          }
        };
      }
      // User Bearer proves IMS login; App Builder DB still needs client_credentials token (below).
    } else {
      return {
        statusCode: 401,
        headers: { ...CORS, 'WWW-Authenticate': 'Basic realm="Tax API"' },
        body: {
          status: 'Error',
          error: 'Unauthorized',
          message: 'Send Authorization: Basic (Runtime API credentials) or Bearer (Adobe IMS token).'
        }
      };
    }

    let accessToken = null;
    try {
      const tokenRes = await generateAccessToken(normalizeImsParamsForToken(params));
      accessToken = tokenRes && tokenRes.access_token;
    } catch (err) {
      console.error('list-tax-rates (webAPI): generateAccessToken failed', err?.message || err);
      return {
        statusCode: 502,
        headers: CORS,
        body: {
          status: 'Error',
          message: (err && err.message) || 'Failed to obtain service token for App Builder Database'
        }
      };
    }
    if (!accessToken) {
      return {
        statusCode: 502,
        headers: CORS,
        body: { status: 'Error', message: 'No access_token from generateAccessToken' }
      };
    }

    const findOptions = {};
    if (limit) findOptions.limit = limit;
    if (skip) findOptions.skip = skip;
    if (sort && typeof sort === 'object' && Object.keys(sort).length) findOptions.sort = sort;

    let raw;
    try {
      raw = await dbFindWithBearerToken(config, namespace, region, accessToken, collectionName, filter, findOptions);
    } catch (err) {
      let message = err.message || String(err);
      const statusCode =
        message.includes('Missing') || message.includes('Invalid') || message.includes('must be') ? 400 : 500;
      if (message.includes('Missing required scope') || message.includes('Oauth token is not valid')) {
        message +=
          '. Ensure App Builder Data Services scopes (e.g. adobeio.abdata.read) and correct namespace.';
      }
      return { statusCode, headers: { ...CORS, 'Access-Control-Allow-Origin': '*' }, body: { status: 'Error', message } };
    }

    const data = normalizeDocuments(raw);

    return {
      statusCode: 200,
      headers: { ...CORS, 'Access-Control-Allow-Origin': '*' },
      body: {
        status: 'Success',
        collection: collectionName,
        data,
        count: data.length
      }
    };
  } catch (error) {
    console.error('list-tax-rates (webAPI):', error);
    const message = error.message || String(error);
    const statusCode = message.includes('Missing') || message.includes('Invalid') ? 400 : 500;
    return {
      statusCode,
      headers: { ...CORS, 'Access-Control-Allow-Origin': '*' },
      body: { status: 'Error', message }
    };
  }
}

exports.main = main;
