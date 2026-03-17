/**
 * Call fetch-db-table so that you only need Basic auth.
 * The web URL requires a Bearer token with [additional_info.roles, read_organizations] (platform rule).
 * This script: 1) Gets a token via raw invoke of generate-token (Basic auth), then 2) Calls fetch-db-table web URL with Bearer.
 *
 * Usage:
 *   node call-with-basic-auth.js
 *   BASIC_AUTH=base64 node call-with-basic-auth.js
 *
 * Set BASIC_AUTH to your Runtime Basic auth (namespace:api_key in base64), or it uses the default below.
 */
require('dotenv').config();
const https = require('https');

const BASIC_AUTH = process.env.BASIC_AUTH || (process.env.AIO_runtime_auth ? Buffer.from(process.env.AIO_runtime_auth).toString('base64') : 'YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=');
const NAMESPACE = process.env.AIO_runtime_namespace || '3676633-taxbycity-stage';
const APIHOST = process.env.AIO_runtime_apihost || 'https://adobeioruntime.net';
const WEB_BASE = `https://${NAMESPACE}.adobeioruntime.net/api/v1/web/tax-by-city`;

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: { ...headers, 'Content-Length': body ? Buffer.byteLength(body) : 0 }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ statusCode: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken() {
  const fullUrl = APIHOST + '/api/v1/namespaces/' + NAMESPACE + '/actions/token?blocking=true&result=true';
  const body = JSON.stringify({
    clientId: process.env.ADOBE_CLIENT_ID || '02cacbf78e8b4e8d8cfe2f1eaa886c30',
    clientSecret: process.env.ADOBE_CLIENT_SECRET || 'p8e-bcWG43HfBj2eKQ5okV4JmLWkcZtI1oBd',
    scope: 'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage'
  });
  const r = await request('POST', fullUrl, {
    'Content-Type': 'application/json',
    'Authorization': 'Basic ' + BASIC_AUTH
  }, body);
  const token = r.data?.result?.body?.access_token || r.data?.body?.access_token || r.data?.access_token;
  if (!token) throw new Error('No token: ' + JSON.stringify(r.data));
  return token;
}

async function main() {
  const body = JSON.stringify({ collection: 'tax_rates', limit: 10 });
  let token;
  try {
    token = await getToken();
  } catch (e) {
    console.error('Get token failed:', e.message);
    process.exit(1);
  }
  const r = await request('POST', WEB_BASE + '/fetch-db-table', {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  }, body);
  console.log(JSON.stringify(r.data, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
