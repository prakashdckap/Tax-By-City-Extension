/**
 * Invoke DBToken via Runtime API (raw invoke) with Basic auth.
 * Use this when the web URL returns 401 or 404 with Basic auth.
 *
 * Raw invoke URL (no "web" in path) accepts Basic auth (namespace:auth_key).
 *
 * Run: node invoke-raw-axios.js
 * Set AUTH_BASE64 or WSK_AUTH (namespace:key, will be base64-encoded).
 */

const axios = require('axios');

const NAMESPACE = process.env.AIO_RUNTIME_NAMESPACE || '3676633-taxbycity-stage';
const AUTH_BASE64 = process.env.AUTH_BASE64 || (() => {
  const auth = process.env.WSK_AUTH;
  if (auth) return Buffer.from(auth, 'utf8').toString('base64');
  return null;
})();

const RAW_URL = `https://adobeioruntime.net/api/v1/namespaces/${NAMESPACE}/actions/DBToken?result=true&blocking=true`;

const config = {
  method: 'post',
  url: RAW_URL,
  maxBodyLength: Infinity,
  headers: {
    'Content-Type': 'application/json',
    ...(AUTH_BASE64 && { 'Authorization': `Basic ${AUTH_BASE64}` })
  },
  data: {}
};

axios.request(config)
  .then((response) => {
    const data = response.data;
    // Raw invoke returns activation result: { response: { result: ... } } or direct result
    const result = data.response?.result ?? data.result ?? data;
    const body = result?.body ?? result;
    if (body && body.access_token) {
      console.log('Status:', result.statusCode || body.status);
      console.log('access_token (first 24 chars):', body.access_token.substring(0, 24) + '...');
      console.log(JSON.stringify(body, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  })
  .catch((error) => {
    console.error(error.response?.data ?? error.message);
  });
