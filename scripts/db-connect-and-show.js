#!/usr/bin/env node
/**
 * Generate token and connect to App Builder Database, then show collection values.
 * Follows: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/database
 *
 * 1. Generate IMS token (via deployed DBToken action or env).
 * 2. Initialize aio-lib-db with { token, region } (region must match app.config.yaml).
 * 3. Connect, query collection, print values.
 *
 * Usage:
 *   # Token from deployed DBToken (set namespace and Basic auth)
 *   RUNTIME_NAMESPACE=3676633-taxbycity-stage RUNTIME_AUTH='ns:key' node scripts/db-connect-and-show.js
 *
 *   # Or pass token directly
 *   ACCESS_TOKEN='eyJ...' node scripts/db-connect-and-show.js
 *
 *   # Optional: different collection or region
 *   COLLECTION=tax_rates REGION=amer node scripts/db-connect-and-show.js
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');

const DEFAULT_NAMESPACE = '3676633-taxbycity-stage';
const DEFAULT_REGION = 'amer';
const DEFAULT_COLLECTION = 'tax_rates';
const DB_TOKEN_URL_TEMPLATE = 'https://adobeioruntime.net/api/v1/namespaces/<namespace>/actions/DBToken?result=true&blocking=true';

async function getTokenFromDBToken() {
  const namespace = process.env.RUNTIME_NAMESPACE || DEFAULT_NAMESPACE;
  const auth = process.env.RUNTIME_AUTH;
  if (!auth) {
    throw new Error('Set RUNTIME_AUTH (namespace:key) to get token from DBToken, or set ACCESS_TOKEN');
  }
  const url = DB_TOKEN_URL_TEMPLATE.replace('<namespace>', namespace);
  const res = await axios.post(url, {}, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${Buffer.from(auth).toString('base64')}` },
    timeout: 15000
  });
  const raw = res.data;
  const result = raw?.response?.result ?? raw?.result ?? raw;
  const body = result?.body ?? result;
  const token = body?.access_token || null;
  if (!token) throw new Error('No access_token in DBToken response');
  return token;
}

async function main() {
  const region = process.env.REGION || process.env.AIO_DB_REGION || DEFAULT_REGION;
  const collectionName = process.env.COLLECTION || DEFAULT_COLLECTION;

  console.log('--- Generate token and connect to App Builder Database ---\n');
  console.log('Region (must match app.config.yaml):', region);
  console.log('Collection:', collectionName);

  let accessToken = process.env.ACCESS_TOKEN || process.env.BEARER_TOKEN;
  if (!accessToken) {
    console.log('\n1. Getting token from DBToken action...');
    accessToken = await getTokenFromDBToken();
    console.log('   Token received (length:', accessToken.length, ')');
  } else {
    console.log('\n1. Using ACCESS_TOKEN / BEARER_TOKEN from env');
  }

  const namespace = process.env.RUNTIME_NAMESPACE || DEFAULT_NAMESPACE;
  console.log('\n2. Initializing aio-lib-db with token, region, and namespace (per Adobe docs)...');
  // aio-lib-db requires namespace (runtime workspace) for DB requests; pass via ow.namespace or __OW_NAMESPACE
  const db = await libDb.init({ token: accessToken, region, ow: { namespace } });

  console.log('3. Connecting and querying collection...');
  const client = await db.connect();
  const collection = client.collection(collectionName);
  const docs = await collection.find({}).limit(100).toArray();
  await client.close();

  console.log('\n--- Values in', collectionName, '---\n');
  console.log('Count:', docs.length);
  console.log(JSON.stringify(docs, null, 2));
  return docs;
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
