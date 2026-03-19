/**
 * Get Tax Rate Action - Retrieve tax rate from App Builder Database
 * Queries tax rates based on country, state, zipcode, and optional city
 *
 * Correct raw invoke URL (default package):
 *   https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/get-tax-rate?result=true&blocking=true
 *
 * DB auth: try Runtime (ow) first, then raw get-db-token (same as list-tax-rates), then generate-token, then IMS.
 */

const https = require('https');
const libDb = require('@adobe/aio-lib-db');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';
const DEFAULT_NAMESPACE = '3676633-taxbycity-stage';
const DB_SCOPE = 'adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage';

/** Raw invoke URL for get-db-token (default package). Pass ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET in body. Same as list-tax-rates/tax-rates-table. */
const RAW_GET_DB_TOKEN_URL = process.env.RAW_GET_DB_TOKEN_URL || `https://adobeioruntime.net/api/v1/namespaces/${DEFAULT_NAMESPACE}/actions/get-db-token?result=true&blocking=true`;

const DEFAULT_RUNTIME_AUTH_BASE64 = process.env.DEFAULT_RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64 || 'YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';

const DB_SERVICE_URL_TEMPLATE = 'https://storage-database-<region>.app-builder.int.adp.adobe.io';

/** Call App Builder DB find API with Bearer token (same as list-tax-rates). */
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

/**
 * Get token via raw invoke of get-db-token with Basic auth and ADOBE_CLIENT_ID/ADOBE_CLIENT_SECRET in body (same as list-tax-rates/tax-rates-table).
 * @param {Object} params - Action params
 * @returns {Promise<string|null>} access_token or null
 */
function getTokenFromGetDbTokenRaw(params) {
  return new Promise((resolve) => {
    const basicAuth = params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64 ||
      (() => {
        const h = params.__ow_headers || {};
        const auth = h.authorization || h.Authorization;
        return (auth && typeof auth === 'string' && auth.startsWith('Basic ')) ? auth.substring(6).trim() : null;
      })() ||
      DEFAULT_RUNTIME_AUTH_BASE64;
    const clientId = params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
    const clientSecret = params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return resolve(null);
    }
    const body = JSON.stringify({ ADOBE_CLIENT_ID: clientId, ADOBE_CLIENT_SECRET: clientSecret });
    const u = new URL(RAW_GET_DB_TOKEN_URL);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Basic ${basicAuth}`
        }
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const result = json?.response?.result || json?.result || json;
            if (result?.statusCode >= 400) {
              return resolve(null);
            }
            const token = result?.body?.access_token || result?.access_token;
            resolve(token || null);
          } catch (_) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

/** Build generate-token web URL from config/env only. No hardcoded URLs. */
function getGenerateTokenUrl(params) {
  const url = params.GENERATE_TOKEN_URL || process.env.GENERATE_TOKEN_URL;
  if (url) return url;
  const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE;
  if (namespace) {
    return `https://${namespace}.adobeioruntime.net/api/v1/web/tax-by-city/generate-token`;
  }
  return null;
}

function hasServiceCredentials(params) {
  const clientId = params.clientId || params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.clientSecret || params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Get access token by calling the generate-token action.
 * Generate-token gets clientId, clientSecret, tokenUrl from its own app.config inputs or env.
 * We only pass scope (DB scope) so the token works for App Builder DB.
 */
function getServiceTokenViaGenerateToken(params) {
  return new Promise((resolve, reject) => {
    const generateTokenUrl = getGenerateTokenUrl(params);
    if (!generateTokenUrl) {
      reject(new Error('GENERATE_TOKEN_URL or __OW_NAMESPACE required (app.config inputs or env)'));
      return;
    }
    const body = JSON.stringify({
      scope: params.ADOBE_SCOPE || process.env.ADOBE_SCOPE || DB_SCOPE
    });
    const u = new URL(generateTokenUrl);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const payload = json.body || json;
          const token = payload.access_token;
          if (token) resolve(token);
          else reject(new Error(payload.message || payload.error || 'No access_token from generate-token'));
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

/** Fallback: generate token via IMS client_credentials (used if generate-token endpoint fails). */
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
function getServiceTokenDirect(params) {
  return new Promise((resolve, reject) => {
    const clientId = params.clientId || params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
    const clientSecret = params.clientSecret || params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
    const scope = params.scope || process.env.ADOBE_SCOPE || DB_SCOPE;
    if (!clientId || !clientSecret) {
      reject(new Error('ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET required'));
      return;
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope
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
          else reject(new Error(json.error_description || json.error || 'No access_token'));
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

/**
 * Initialize database: try Runtime (ow) auth first, then raw get-db-token (same as list-tax-rates), then generate-token, then IMS client_credentials.
 */
async function initDb(params, region = DEFAULT_REGION) {
  const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE;
  const auth = params.__OW_API_KEY || params.runtimeAuth || process.env.__OW_API_KEY;
  if (namespace && auth) {
    const db = await libDb.init({ ow: { namespace, auth }, region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  }
  // Try raw get-db-token with client id/secret in body (same as list-tax-rates / tax-rates-table)
  const tokenFromGetDbToken = await getTokenFromGetDbTokenRaw(params);
  if (tokenFromGetDbToken) {
    const db = await libDb.init({ token: tokenFromGetDbToken, region, ow: { namespace } });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  }
  if (getGenerateTokenUrl(params)) {
    try {
      const token = await getServiceTokenViaGenerateToken(params);
      const db = await libDb.init({ token, region, ow: { namespace } });
      const client = await db.connect();
      const collection = await client.collection(COLLECTION_NAME);
      return { client, collection };
    } catch (e) {
      if (hasServiceCredentials(params)) {
        const token = await getServiceTokenDirect(params);
        const db = await libDb.init({ token, region, ow: { namespace } });
        const client = await db.connect();
        const collection = await client.collection(COLLECTION_NAME);
        return { client, collection };
      }
      throw e;
    }
  }
  if (hasServiceCredentials(params)) {
    const token = await getServiceTokenDirect(params);
    const db = await libDb.init({ token, region, ow: { namespace } });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  }
  throw new Error('Database auth failed: set ADOBE_CLIENT_ID/ADOBE_CLIENT_SECRET (for get-db-token), or GENERATE_TOKEN_URL/__OW_NAMESPACE, or Runtime ow auth');
}

/** Build filter and apply best-match logic (shared by token path and libDb path). */
function buildFilterAndMatch(country, state, zipcode, city) {
  const filter = { tax_country_id: country };
  if (state) {
    filter.tax_region_id = state;
  } else {
    filter.tax_region_id = { $in: [null, ''] };
  }
  if (zipcode) {
    filter.tax_postcode = { $in: [zipcode, '*'] };
  }
  if (city) {
    filter.city = city;
  }
  filter.status = { $ne: false };
  return filter;
}

function pickBestMatch(results, zipcode, city) {
  if (!results || results.length === 0) return null;
  if (!zipcode && !city) return results;
  let bestMatch = null;
  if (city) {
    const cityMatch = results.find(r => r.city === city);
    if (cityMatch) bestMatch = cityMatch;
  }
  if (!bestMatch && zipcode) {
    const exactZipMatch = results.find(r => r.tax_postcode === zipcode && r.tax_postcode !== '*');
    if (exactZipMatch) bestMatch = exactZipMatch;
  }
  return bestMatch || results;
}

/** Find via DB REST API with Bearer token (same as list-tax-rates). */
async function findTaxRateByLocationWithToken(params, country, state, zipcode, city, region) {
  const token = await getTokenFromGetDbTokenRaw(params);
  if (!token) return null;
  const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE || DEFAULT_NAMESPACE;
  const filter = buildFilterAndMatch(country, state, zipcode, city);
  const raw = await dbFindWithBearerToken(namespace, region, token, COLLECTION_NAME, filter, { limit: 100 });
  const results = Array.isArray(raw) ? raw : (raw?.cursor?.firstBatch || raw?.documents || []);
  if (results.length === 0) return null;
  return pickBestMatch(results, zipcode, city);
}

/**
 * Find tax rate by location
 */
async function findTaxRateByLocation(country, state, zipcode, city = null, region = DEFAULT_REGION, params = {}) {
  // Prefer token + DB REST API (same as list-tax-rates); avoids libDb 401 on token auth
  const tokenResult = await findTaxRateByLocationWithToken(params, country, state, zipcode, city, region);
  if (tokenResult !== null) return tokenResult;

  let client;
  try {
    const { client: dbClient, collection } = await initDb(params, region);
    client = dbClient;

    const filter = buildFilterAndMatch(country, state, zipcode, city);
    const results = await collection.find(filter).toArray();

    if (results.length === 0) return null;
    return pickBestMatch(results, zipcode, city);
  } catch (error) {
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.warn('get-tax-rate: client.close warning', closeErr?.message || closeErr);
      }
    }
  }
}

async function main(params) {
  // Handle OPTIONS preflight request for CORS
  const method = params["__ow_method"] || params.method || 'GET';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }
  try {
    // Parse request body if present (supports base64-encoded __ow_body from Runtime/web actions)
    let body = null;
    if (params["__ow_body"]) {
      try {
        const raw = params["__ow_body"];
        if (typeof raw === 'string') {
          try {
            body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
          } catch (_) {
            body = JSON.parse(raw);
          }
        } else {
          body = raw;
        }
      } catch (e) {
        console.error('Error parsing body:', e);
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: {
            status: 'Error',
            message: 'Invalid JSON in request body: ' + e.message
          }
        };
      }
    }

    // Get parameters from body, params, or query string
    const country = body?.country || body?.tax_country_id || params.country || params.tax_country_id || params["__ow_query"]?.country;
    const state = body?.state || body?.tax_region_id || params.state || params.tax_region_id || params["__ow_query"]?.state;
    const zipcode = body?.zipcode || body?.tax_postcode || body?.postcode || params.zipcode || params.tax_postcode || params.postcode || params["__ow_query"]?.zipcode || params["__ow_query"]?.postcode;
    const city = body?.city || params.city || params["__ow_query"]?.city || null;
    const region = body?.region || params.region || DEFAULT_REGION;

    // Validate required parameters
    if (!country) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'country (tax_country_id) parameter is required'
        }
      };
    }

    if (!state) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'state (tax_region_id) parameter is required'
        }
      };
    }

    // zipcode is optional - no validation needed

    // Find tax rate(s)
    const taxRateResult = await findTaxRateByLocation(country, state, zipcode, city, region, params);

    if (!taxRateResult || (Array.isArray(taxRateResult) && taxRateResult.length === 0)) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Not Found',
          message: 'Tax rate not found for the provided location',
          searchCriteria: {
            country,
            state,
            zipcode: zipcode || 'not provided',
            city: city || 'not provided'
          }
        }
      };
    }

    // Check if result is array (multiple records) or single object
    const isArray = Array.isArray(taxRateResult);
    const taxRates = isArray ? taxRateResult : [taxRateResult];

    // Normalize BSON-style fields (_id, dates, numbers) for API response
    const normalizeDoc = (doc) => {
      const out = JSON.parse(JSON.stringify(doc, (_, v) => {
        if (v && typeof v === 'object' && v.$oid) return v.$oid;
        if (v && typeof v === 'object' && v.$date) return typeof v.$date === 'object' && v.$date.$numberLong ? parseInt(v.$date.$numberLong, 10) : v.$date;
        if (v && typeof v === 'object' && (v.$numberLong !== undefined || v.$numberInt !== undefined)) return parseInt(v.$numberLong || v.$numberInt, 10);
        if (v && typeof v === 'object' && v.$numberDouble !== undefined) return parseFloat(v.$numberDouble, 10);
        return v;
      }));
      if (out._id && typeof out._id === 'object') out._id = out._id.toString?.() || String(out._id);
      return out;
    };
    const processedData = taxRates.map(rate => normalizeDoc(rate));

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        message: isArray 
          ? `${taxRates.length} tax rate(s) found` 
          : 'Tax rate found',
        count: taxRates.length,
        data: isArray ? processedData : processedData[0]
      }
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error retrieving tax rate',
        error: error.message
      }
    };
  }
}

exports.main = main;

