/**
 * Test the deployed DBToken action via web URL.
 * Run: node test-dbtoken-web.js
 *
 * If you get 401, pass a Bearer token (e.g. from aio auth:token or generate-token):
 *   BEARER_TOKEN=eyJ... node test-dbtoken-web.js
 *
 * Env: AIO_RUNTIME_NAMESPACE, DBTOKEN_ACTION_NAME (default: DBToken), BEARER_TOKEN
 */

const https = require('https');

const NAMESPACE = process.env.AIO_RUNTIME_NAMESPACE || '3676633-taxbycity-stage';
const ACTION_NAME = process.env.DBTOKEN_ACTION_NAME || 'DBToken';
const BASE_URL = `https://${NAMESPACE}.adobeioruntime.net/api/v1/web/${ACTION_NAME}`;

const headers = { 'Content-Type': 'application/json' };
if (process.env.BEARER_TOKEN) {
  headers['Authorization'] = 'Bearer ' + process.env.BEARER_TOKEN;
}

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: options.method || 'POST',
        headers: { ...headers, ...options.headers }
      },
      (res) => {
        let data = '';
        res.on('data', (ch) => { data += ch; });
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, body: JSON.parse(data || '{}') });
          } catch (_) {
            resolve({ statusCode: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body || '{}');
    req.end();
  });
}

async function main() {
  console.log('Testing DBToken action at:', BASE_URL);
  if (process.env.BEARER_TOKEN) {
    console.log('Using BEARER_TOKEN from env');
  } else {
    console.log('No BEARER_TOKEN set. If you get 401, get a token and run:');
    console.log('  BEARER_TOKEN=<token> node test-dbtoken-web.js');
    console.log('  Or: node test-get-db-token.js  # then copy access_token and set BEARER_TOKEN');
  }
  try {
    const res = await request(BASE_URL, { method: 'POST' }, '{}');
    console.log('Status:', res.statusCode);
    console.log('Response:', JSON.stringify(res.body, null, 2));
    if (res.body && res.body.access_token) {
      console.log('Token (first 24 chars):', res.body.access_token.substring(0, 24) + '...');
    }
    if (res.statusCode === 401) {
      console.log('\n401 = auth required. Get a token: node test-get-db-token.js, then BEARER_TOKEN=... node test-dbtoken-web.js');
    }
    if (res.statusCode >= 400) {
      process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
