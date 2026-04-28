/**
 * Fetch Tax Rates from App Builder Database (Sample Runtime Action)
 *
 * Connects to the App Builder database (aio-lib-db) and fetches tax rates from
 * the tax_rates collection. Use this as a reference for building runtime actions
 * that read from App Builder database storage.
 *
 * Reference: list-tax-rates action (same collection and init pattern).
 * Docs: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/db-runtime-actions
 *
 * GET or POST
 * Query/body params (optional):
 *   - country: Filter by country code (tax_country_id)
 *   - state:   Filter by state/region (tax_region_id)
 *   - zipcode: Filter by zip (tax_postcode)
 *   - city:    Filter by city
 *   - limit:   Max results (default 50, max 500)
 *   - region:  Database region (amer, emea, apac); default amer
 *
 * Response: { status: 'Success', data: [...], count }
 */

const libDb = require('@adobe/aio-lib-db');
const { DbError } = require('@adobe/aio-lib-db');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Initialize App Builder database and return client + collection.
 * Uses workspace credentials in Runtime; region from config or param.
 */
async function initDb(region = DEFAULT_REGION) {
  try {
    const db = await libDb.init({ region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  } catch (error) {
    if (error instanceof DbError) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Fetch tax rates with optional filters and limit.
 */
async function fetchTaxRates(filter = {}, options = {}, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;

    const { limit = DEFAULT_LIMIT } = options;
    const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT), MAX_LIMIT);

    let cursor = collection.find(filter).sort({ created_at: -1 }).limit(safeLimit);
    const results = await cursor.toArray();
    return results;
  } catch (error) {
    if (error instanceof DbError) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

function parseBody(params) {
  if (params.body && typeof params.body === 'object') return params.body;
  const raw = params['__ow_body'];
  if (!raw) return null;
  try {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      } catch {
        return JSON.parse(raw);
      }
    }
    return raw;
  } catch {
    return null;
  }
}

function parseQuery(params) {
  const q = params['__ow_query'];
  if (!q) return {};
  if (typeof q === 'object') return q;
  const out = {};
  try {
    const urlParams = new URLSearchParams(q);
    for (const [key, value] of urlParams.entries()) {
      out[key] = value;
    }
  } catch (_) {}
  return out;
}

async function main(params) {
  const method = (params['__ow_method'] || params.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400',
      },
      body: {},
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = parseBody(params) || {};
    const query = parseQuery(params);
    const source = method === 'POST' ? body : query;

    const country = source.country || params.country;
    const state = source.state || params.state;
    const zipcode = source.zipcode || params.zipcode;
    const city = source.city || params.city;
    const limit = source.limit || params.limit || DEFAULT_LIMIT;
    const region = source.region || params.region || DEFAULT_REGION;

    const filter = {};
    if (country) filter.tax_country_id = String(country).trim();
    if (state) filter.tax_region_id = String(state).trim();
    if (zipcode) filter.tax_postcode = String(zipcode).trim();
    if (city) filter.city = String(city).trim();

    const items = await fetchTaxRates(filter, { limit }, region);

    const data = items.map((item) => {
      const doc = { ...item };
      if (doc._id) doc._id = doc._id.toString();
      return doc;
    });

    return {
      statusCode: 200,
      headers,
      body: {
        status: 'Success',
        data,
        count: data.length,
      },
    };
  } catch (error) {
    console.error('fetch-tax-rates-db error:', error);
    return {
      statusCode: 500,
      headers,
      body: {
        status: 'Error',
        message: 'Failed to fetch tax rates from App Builder database',
        error: (error.message || String(error)).slice(0, 500),
      },
    };
  }
}

async function wrappedMain(params) {
  try {
    const result = await main(params);
    if (!result || typeof result !== 'object') {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'Error', message: 'Invalid response from action' },
      };
    }
    return {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: { 'Content-Type': 'application/json', ...(result.headers || {}) },
      body: result.body || {},
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { status: 'Error', message: e.message || 'Internal server error' },
    };
  }
}

exports.main = wrappedMain;
