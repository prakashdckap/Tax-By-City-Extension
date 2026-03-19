#!/usr/bin/env node
/**
 * Local test for hello-api (no deploy needed).
 * Run: node test-local.js
 */
const { main } = require('./index.js');

async function run() {
  console.log('=== 1. No auth (expect 401) ===');
  const noAuth = await main({ __ow_method: 'GET' });
  console.log('Status:', noAuth.statusCode, 'Body:', JSON.stringify(noAuth.body, null, 2));
  console.log('');

  console.log('=== 2. With Basic auth (expect 200) ===');
  const basic = Buffer.from('user:pass').toString('base64');
  const withAuth = await main({
    __ow_method: 'GET',
    __ow_headers: { authorization: `Basic ${basic}` }
  });
  console.log('Status:', withAuth.statusCode, 'Body:', JSON.stringify(withAuth.body, null, 2));
  console.log('');

  console.log('=== 3. OPTIONS (expect 200) ===');
  const opts = await main({ __ow_method: 'OPTIONS' });
  console.log('Status:', opts.statusCode);
}

run().catch((e) => { console.error(e); process.exit(1); });
