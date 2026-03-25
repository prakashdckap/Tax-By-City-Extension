const libDb = require('@adobe/aio-lib-db');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime');
const { getDefaultRegion, getSyncHistoryCollection } = require('../lib/config');

function parseQuery(params) {
  const query = {};
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    const sp = new URLSearchParams(params.__ow_query);
    for (const [k, v] of sp.entries()) query[k] = v;
  }
  return query;
}

function parseBody(params) {
  if (params.__ow_body) {
    try {
      return typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
    } catch (_) {}
  }
  return {};
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, headers: CORS, body: { status: 'Error', message: 'Use GET or POST' } };
  }

  try {
    const auth = await resolveAuthAndNamespace(params);
    if (auth.error) return { statusCode: auth.error.statusCode, headers: CORS, body: auth.error.body };
    const region = getDefaultRegion(params) || DEFAULT_REGION;
    const collectionName = getSyncHistoryCollection(params);
    if (!collectionName) {
      return {
        statusCode: 500,
        headers: CORS,
        body: { status: 'Error', message: 'SYNC_HISTORY_COLLECTION is not configured.' }
      };
    }
    const db = await libDb.init({
      token: auth.accessToken,
      region,
      ow: { namespace: auth.namespace }
    });
    const client = await db.connect();
    try {
      const collection = await client.collection(collectionName);
      const body = parseBody(params);
      const isRecord = method === 'POST' && (body.record === true || body.operation === 'record');

      if (isRecord) {
        const doc = {
          timestamp: body.timestamp || new Date().toISOString(),
          mode: String(body.mode || ''),
          status: String(body.status || 'unknown'),
          synced: Number(body.synced) || 0,
          failed: Number(body.failed) || 0,
          total: Number(body.total) || 0,
          collection: body.collection || 'manual'
        };
        await collection.insertOne({ ...doc, created_at: new Date().toISOString() });
        return {
          statusCode: 200,
          headers: CORS,
          body: { status: 'Success', message: 'Recorded', data: doc }
        };
      }

      const q = parseQuery(params);
      const limit = Math.min(Math.max(parseInt(q.limit || params.limit || '20', 10) || 20, 1), 200);
      const rows = await collection.find({}).sort({ timestamp: -1 }).limit(limit).toArray();
      return {
        statusCode: 200,
        headers: CORS,
        body: { status: 'Success', data: rows, count: rows.length }
      };
    } finally {
      await client.close();
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: CORS,
      body: { status: 'Error', message: error.message || String(error) }
    };
  }
}

exports.main = main;
