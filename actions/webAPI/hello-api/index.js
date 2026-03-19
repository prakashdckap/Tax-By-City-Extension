/**
 * Hello API - Returns tax_rates. Uses the same action security as other Runtime web actions:
 * 1. Collect Basic auth from the request (Authorization header).
 * 2. Validate credentials against Runtime API credentials (RUNTIME_USERNAME/RUNTIME_PASSWORD or RUNTIME_AUTH_BASE64).
 * Same credentials used to invoke actions via the Runtime API secure this endpoint (timing-safe comparison).
 */

const https = require('https');
const crypto = require('crypto');

const REGION = 'amer';
const COLLECTION = 'tax_rates';
const NAMESPACE = process.env.__OW_NAMESPACE || '3676633-taxbycity-stage';
const DB_FIND_URL = `https://storage-database-${REGION}.app-builder.int.adp.adobe.io/v1/collection/${COLLECTION}/find`;

function httpsPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body != null ? JSON.stringify(body) : '';
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let response = '';
        res.on('data', (chunk) => (response += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(response);
            if (res.statusCode >= 400) reject(new Error(json.message || response || `HTTP ${res.statusCode}`));
            else resolve(json);
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

function normalizeId(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  if (out._id != null) out._id = (out._id && out._id.$oid) ? out._id.$oid : (out._id.toString ? out._id.toString() : String(out._id));
  return out;
}

async function fetchTaxRates(accessToken, limit = 1000) {
  const res = await httpsPost(DB_FIND_URL, { Authorization: `Bearer ${accessToken}`, 'x-runtime-namespace': NAMESPACE }, { filter: {}, options: { limit } });
  const data = res?.data;
  const rows = Array.isArray(data) ? data : (data?.cursor?.firstBatch || data?.documents || []);
  return rows.map(normalizeId);
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff'
};

function jsonBody(obj) {
  return typeof obj === 'string' ? obj : JSON.stringify(obj);
}

/** Timing-safe comparison of two strings (via SHA-256 hashes) to prevent timing attacks. */
function secureCompare(a, b) {
  if (a == null || b == null) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  if (ha.length !== hb.length) return false;
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Resolve expected Basic auth (base64) using the same mechanism as other actions:
 * RUNTIME_AUTH_BASE64, or Base64(RUNTIME_USERNAME:RUNTIME_PASSWORD). These are the Runtime API credentials.
 */
function getExpectedBasicAuthBase64(params) {
  const base64 = params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64;
  if (base64 && typeof base64 === 'string' && base64.trim()) return base64.trim();
  const username = params.RUNTIME_USERNAME || process.env.RUNTIME_USERNAME;
  const password = params.RUNTIME_PASSWORD || process.env.RUNTIME_PASSWORD;
  if (username != null && password != null) {
    return Buffer.from(`${String(username)}:${String(password)}`, 'utf-8').toString('base64');
  }
  return null;
}

async function main(params) {
  try {
    const method = (params.__ow_method || params.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      return { statusCode: 200, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' }, body: jsonBody({}) };
    }
    if (method !== 'GET' && method !== 'POST') {
      return { statusCode: 405, headers: CORS, body: jsonBody({ status: 'Error', error: 'Method not allowed' }) };
    }

    // 1. Collect Basic auth from the request (action security: same as other web actions)
    const auth = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Basic ')) {
      return { statusCode: 401, headers: { ...CORS, 'WWW-Authenticate': 'Basic realm="Tax API"' }, body: jsonBody({ status: 'Error', error: 'Unauthorized' }) };
    }
    const providedBase64 = auth.slice(6).trim();

    // 2. Validate credentials against Runtime API credentials (same as save-tax-rate, list-tax-rates, etc.)
    const expectedBase64 = getExpectedBasicAuthBase64(params);
    if (!expectedBase64) {
      return { statusCode: 503, headers: CORS, body: jsonBody({ status: 'Error', error: 'Service unavailable' }) };
    }
    if (!secureCompare(providedBase64, expectedBase64)) {
      return { statusCode: 401, headers: { ...CORS, 'WWW-Authenticate': 'Basic realm="Tax API"' }, body: jsonBody({ status: 'Error', error: 'Unauthorized' }) };
    }

    let token = null;
    let tax_rates = [];
    let tokenError = null;
    try {
      const { generateAccessToken } = require('@adobe/aio-lib-core-auth');
      const tokenResult = await generateAccessToken(params);
      token = (tokenResult && tokenResult.access_token) || null;
      if (token) {
        try {
          tax_rates = await fetchTaxRates(token);
        } catch (fetchErr) {
          tokenError = (fetchErr && fetchErr.message) || 'fetchTaxRates failed';
        }
      } else {
        tokenError = 'generateAccessToken returned no access_token';
      }
    } catch (err) {
      tokenError = (err && err.message) || 'generateAccessToken failed';
    }

    const body = {
      status: 'Success',
      tax_rates,
      count: tax_rates.length,
      timestamp: new Date().toISOString()
    };
    if (tokenError && !token) {
      console.warn('hello-api: token/fetch failed', tokenError);
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: jsonBody(body)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: CORS,
      body: jsonBody({ status: 'Error', error: (err && err.message) || 'Internal error' })
    };
  }
}

exports.main = main;
