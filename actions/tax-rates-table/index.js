/**
 * Tax Rates Table API
 * GET /tax-rates-table — returns tax_rates collection from App Builder Database.
 *
 * No npm dependencies: uses only Node built-ins (https, Buffer, URL, JSON).
 * Deploy by zipping this file only (no node_modules).
 *
 * Auth: get-db-token via raw invoke; Basic auth from params.RUNTIME_AUTH_BASE64
 * or __ow_headers.authorization. Pass ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET as params.
 */

const https = require('https');

const REGION = 'amer';
const NAMESPACE = process.env.__OW_NAMESPACE || '3676633-taxbycity-stage';
const COLLECTION = 'tax_rates';
const APIHOST = 'https://adobeioruntime.net';
const RAW_GET_DB_TOKEN_URL = process.env.RAW_GET_DB_TOKEN_URL || `${APIHOST}/api/v1/namespaces/${NAMESPACE}/actions/tax-by-city/get-db-token?result=true&blocking=true`;
const DB_FIND_URL = `https://storage-database-${REGION}.app-builder.int.adp.adobe.io/v1/collection/${COLLECTION}/find`;

const DEFAULT_RUNTIME_AUTH_BASE64 = process.env.RUNTIME_AUTH_BASE64 || 'YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';

function getBasicAuth(params) {
  if (params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64) {
    return params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64;
  }
  const h = params.__ow_headers || {};
  const auth = h.authorization || h.Authorization;
  if (auth && typeof auth === 'string' && auth.startsWith('Basic ')) {
    return auth.substring(6).trim();
  }
  return DEFAULT_RUNTIME_AUTH_BASE64;
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
        res.on('data', (chunk) => (response += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(response);
            if (res.statusCode >= 400) {
              return reject(new Error(json.message || response || `HTTP ${res.statusCode}`));
            }
            resolve(json);
          } catch (e) {
            reject(new Error(response || e.message));
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getAccessToken(params) {
  const clientId = params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET required (params or env)');
  }
  const basicAuth = getBasicAuth(params);
  const res = await httpsPost(
    RAW_GET_DB_TOKEN_URL,
    { Authorization: `Basic ${basicAuth}` },
    { ADOBE_CLIENT_ID: clientId, ADOBE_CLIENT_SECRET: clientSecret }
  );
  const result = res?.response?.result || res?.result || res;
  if (result?.statusCode >= 400) {
    throw new Error(result?.body?.message || result?.body?.error || 'Token request failed');
  }
  const token = result?.body?.access_token || result?.access_token;
  if (!token) throw new Error('No access_token in get-db-token response');
  return token;
}

async function fetchTaxRates(token, limit, skip) {
  const res = await httpsPost(
    DB_FIND_URL,
    {
      Authorization: `Bearer ${token}`,
      'x-runtime-namespace': NAMESPACE
    },
    { filter: {}, options: { limit, skip } }
  );
  const data = res?.data;
  if (Array.isArray(data)) return data;
  if (data && (data.cursor?.firstBatch || data.documents)) {
    return data.cursor?.firstBatch || data.documents;
  }
  return [];
}

async function main(params) {
  const method = params.__ow_method || params.method || 'GET';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    const limit = Math.min(Math.max(0, parseInt(params.limit, 10) || 100), 1000);
    const skip = Math.max(0, parseInt(params.skip, 10) || 0);

    const token = await getAccessToken(params);
    const items = await fetchTaxRates(token, limit, skip);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: {
        status: 'Success',
        count: items.length,
        data: items
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: {
        status: 'Error',
        message: error && error.message ? error.message : String(error)
      }
    };
  }
}

exports.main = main;
