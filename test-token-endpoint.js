/**
 * Test OpenWhisk "token" action endpoint.
 * GET = action metadata; POST with blocking = invoke and get result.
 * Usage: node test-token-endpoint.js
 * Optional: set ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET (or use .env) to test token generation.
 */
try { require('dotenv').config(); } catch (_) {}
const axios = require('axios');

const BASE = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions';
const AUTH = 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';

async function testGet() {
  console.log('--- GET (action metadata) ---');
  const r = await axios.get(`${BASE}/token`, {
    headers: { Authorization: AUTH },
    maxBodyLength: Infinity,
  });
  console.log('Status:', r.status);
  const data = r.data;
  console.log('Keys:', Object.keys(data));
  if (data.exec?.code) console.log('exec.code length:', data.exec.code.length, '(base64)');
}

async function testPostInvoke(body = {}) {
  console.log('\n--- POST (invoke action, blocking) ---');
  const r = await axios.post(
    `${BASE}/token?blocking=true&result=true`,
    body,
    {
      headers: {
        Authorization: AUTH,
        'Content-Type': 'application/json',
      },
      maxBodyLength: Infinity,
    }
  );
  console.log('Status:', r.status);
  const result = r.data?.result || r.data;
  const bodyOut = result?.body ?? result;
  console.log(JSON.stringify(bodyOut, null, 2));
  if (bodyOut?.access_token) console.log('Token length:', bodyOut.access_token.length);
}

async function main() {
  try {
    await testGet();
    const clientId = process.env.ADOBE_CLIENT_ID;
    const clientSecret = process.env.ADOBE_CLIENT_SECRET;
    if (clientId && clientSecret) {
      await testPostInvoke({ clientId, clientSecret });
    } else {
      await testPostInvoke({});
      console.log('\n(Set ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET to test token generation.)');
    }
  } catch (e) {
    console.error('Error:', e.response?.status, e.response?.data || e.message);
  }
}

main();
