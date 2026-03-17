#!/usr/bin/env node
/**
 * Test fetch-db-table. Set BEARER_TOKEN env or pass as first arg.
 * Usage: BEARER_TOKEN=xxx node test-fetch.js
 *    or: node test-fetch.js <token>
 */
const https = require('https');

const token = process.env.BEARER_TOKEN || process.argv[2];
const url = 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/fetch-db-table';

if (!token) {
  console.error('Set BEARER_TOKEN or pass token as first arg.');
  process.exit(1);
}

const body = JSON.stringify({ collection: 'tax_rates', limit: 2 });
const u = new URL(url);

const req = https.request({
  hostname: u.hostname,
  path: u.pathname + u.search,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Authorization': 'Bearer ' + token
  }
}, (res) => {
  let data = '';
  res.on('data', (c) => { data += c; });
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      console.log(JSON.stringify(JSON.parse(data), null, 2));
    } catch {
      console.log(data);
    }
  });
});

req.on('error', (e) => console.error(e));
req.write(body);
req.end();
