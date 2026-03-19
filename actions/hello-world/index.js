/**
 * Hello World - Returns hello message, token from generateAccessToken, and tax_rates table rows.
 * Uses that token to fetch tax_rates from App Builder Database (no separate get-db-token).
 * Ensure action has include-ims-credentials and ADOBE_CLIENT_ID / ADOBE_CLIENT_SECRET in app.config.
 */

const https = require('https');
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient;

const REGION = 'amer';
const COLLECTION = 'tax_rates';
const DB_FIND_URL = `https://storage-database-${REGION}.app-builder.int.adp.adobe.io/v1/collection/${COLLECTION}/find`;

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
            if (res.statusCode >= 400) reject(new Error(json.message || response || `HTTP ${res.statusCode}`));
            else resolve(json);
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

function normalizeId(doc) {
  if (!doc || typeof doc !== 'object') return doc;
  const out = { ...doc };
  if (out._id != null) {
    out._id = (out._id && out._id.$oid) ? out._id.$oid : (out._id.toString ? out._id.toString() : String(out._id));
  }
  return out;
}

async function fetchTaxRates(accessToken, namespace, limit = 1000) {
  const res = await httpsPost(
    DB_FIND_URL,
    {
      Authorization: `Bearer ${accessToken}`,
      'x-runtime-namespace': namespace
    },
    { filter: {}, options: { limit } }
  );
  const data = res?.data;
  const rows = Array.isArray(data) ? data : (data?.cursor?.firstBatch || data?.documents || []);
  return rows.map(normalizeId);
}

async function main(params) {
  const token = await generateAccessToken(params);
  const namespace = params.__OW_NAMESPACE || process.env.__OW_NAMESPACE || '3676633-taxbycity-stage';
  let data = [];
  try {
    data = await fetchTaxRates(token.access_token, namespace);
  } catch (err) {
    console.warn('fetchTaxRates failed:', err?.message);
  }
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: {
      status: 'Success',
      tax_rates: data,
      count: data.length
    }
  };
}

exports.main = main;
