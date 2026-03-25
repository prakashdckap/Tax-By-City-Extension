/**
 * Get tax rate by location (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Queries ABDB by country, state, optional zipcode/city; best-match logic matches legacy get-tax-rate.
 * Optional pagination (limit / skip / page) applies when multiple documents are returned.
 *
 * Accepted location fields (any one name per dimension):
 *   Country: country_id | country | tax_country_id
 *   Region:  region_id | state | tax_region_id (numbers coerced to string; DB may store string or number)
 *   Postcode: postcode | zipcode | tax_postcode
 *   City:    city
 */

const libDb = require('@adobe/aio-lib-db');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');
const { getParamOrEnv, getTaxRatesCollection } = require('../lib/config');

const COLLECTION_NAME = getTaxRatesCollection();
const DEFAULT_LIMIT = Number.parseInt(getParamOrEnv({}, 'DEFAULT_LIMIT', ''), 10);
const MAX_LIMIT = Number.parseInt(getParamOrEnv({}, 'MAX_LIMIT', ''), 10);

async function initDbWithCtx(dbCtx, region = DEFAULT_REGION) {
  const { bearerToken, namespace } = dbCtx;
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(COLLECTION_NAME);
  return { client, collection };
}

function pickNonOwParams(params) {
  const o = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') o[k] = v;
  }
  return o;
}

/**
 * Merge query string, top-level params, and JSON body (body wins).
 */
function mergeInputs(params) {
  const query = {};
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      for (const [k, v] of q.entries()) {
        if (v !== undefined && v !== '') query[k] = v;
      }
    } catch (e) {
      console.warn('get-tax-rate: __ow_query parse:', e?.message || e);
    }
  }

  let body = null;
  if (params.__ow_body) {
    const raw = params.__ow_body;
    if (typeof raw === 'string') {
      try {
        body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      } catch {
        body = JSON.parse(raw);
      }
    } else if (typeof raw === 'object' && !Array.isArray(raw)) {
      body = raw;
    }
  }

  const flat = pickNonOwParams(params);
  return { ...query, ...flat, ...(body && typeof body === 'object' ? body : {}) };
}

function firstNonEmpty(merged, keys) {
  for (const k of keys) {
    const v = merged[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      return String(v).trim();
    }
  }
  return undefined;
}

/** Map Magento-style and legacy keys to canonical strings for the query. */
function resolveLocationParams(merged) {
  const country = firstNonEmpty(merged, ['country_id', 'country', 'tax_country_id']);
  const stateRaw = firstNonEmpty(merged, ['region_id', 'state', 'tax_region_id']);
  const state = stateRaw;
  const zipRaw = firstNonEmpty(merged, ['postcode', 'zipcode', 'tax_postcode']);
  const zipcode = zipRaw || null;
  const cityRaw = merged.city;
  const city =
    cityRaw !== undefined && cityRaw !== null && String(cityRaw).trim() !== ''
      ? String(cityRaw).trim()
      : null;
  const region = merged.region || DEFAULT_REGION;
  return { country, state, zipcode, city, region };
}

function regionIdFilterValue(state) {
  if (!state) return { $in: [null, ''] };
  const s = String(state).trim();
  const n = Number(s);
  if (!Number.isNaN(n) && Number.isInteger(n) && String(n) === s) {
    return { $in: [s, n] };
  }
  return s;
}

function buildFilterAndMatch(country, state, zipcode, city) {
  const filter = { tax_country_id: country };
  if (state) {
    filter.tax_region_id = regionIdFilterValue(state);
  } else {
    filter.tax_region_id = { $in: [null, ''] };
  }
  if (zipcode) {
    filter.tax_postcode = { $in: [zipcode, '*'] };
  }
  if (city) {
    filter.city = city;
  }
  filter.status = { $ne: false };
  return filter;
}

function pickBestMatch(results, zipcode, city) {
  if (!results || results.length === 0) return null;
  if (!zipcode && !city) return results;
  let bestMatch = null;
  if (city) {
    const cityMatch = results.find((r) => r.city === city);
    if (cityMatch) bestMatch = cityMatch;
  }
  if (!bestMatch && zipcode) {
    const exactZipMatch = results.find((r) => r.tax_postcode === zipcode && r.tax_postcode !== '*');
    if (exactZipMatch) bestMatch = exactZipMatch;
  }
  return bestMatch || results;
}

function parsePagination(merged) {
  let limit =
    merged.limit !== undefined && merged.limit !== '' ? parseInt(String(merged.limit), 10) : DEFAULT_LIMIT;
  let skip =
    merged.skip !== undefined && merged.skip !== '' ? parseInt(String(merged.skip), 10) : 0;
  const pageVal =
    merged.page !== undefined && merged.page !== '' ? parseInt(String(merged.page), 10) : NaN;
  if (!Number.isNaN(pageVal) && pageVal > 0 && limit > 0) {
    const explicitSkip = merged.skip !== undefined && merged.skip !== '';
    if (!explicitSkip) skip = (pageVal - 1) * limit;
  }
  if (Number.isNaN(limit) || limit < 0) limit = DEFAULT_LIMIT;
  if (Number.isNaN(skip) || skip < 0) skip = 0;
  limit = Math.min(limit, MAX_LIMIT);
  return { limit, skip };
}

function applyPaginationToResult(taxRateResult, merged) {
  if (!Array.isArray(taxRateResult)) return taxRateResult;
  const { limit, skip } = parsePagination(merged);
  return taxRateResult.slice(skip, skip + limit);
}

function normalizeDoc(doc) {
  const out = JSON.parse(
    JSON.stringify(doc, (_, v) => {
      if (v && typeof v === 'object' && v.$oid) return v.$oid;
      if (v && typeof v === 'object' && v.$date) {
        return typeof v.$date === 'object' && v.$date.$numberLong
          ? parseInt(v.$date.$numberLong, 10)
          : v.$date;
      }
      if (v && typeof v === 'object' && (v.$numberLong !== undefined || v.$numberInt !== undefined)) {
        return parseInt(v.$numberLong || v.$numberInt, 10);
      }
      if (v && typeof v === 'object' && v.$numberDouble !== undefined) {
        return parseFloat(v.$numberDouble, 10);
      }
      return v;
    })
  );
  if (out._id && typeof out._id === 'object') out._id = out._id.toString?.() || String(out._id);
  return out;
}

async function findTaxRateByLocation(country, state, zipcode, city, region, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;

    const filter = buildFilterAndMatch(country, state, zipcode, city);
    const results = await collection.find(filter).toArray();

    if (results.length === 0) return null;
    return pickBestMatch(results, zipcode, city);
  } catch (error) {
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (closeErr) {
        console.warn('get-tax-rate: client.close', closeErr?.message || closeErr);
      }
    }
  }
}

async function runGetFlow(params, dbCtx) {
  let merged;
  try {
    merged = mergeInputs(params);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: { status: 'Error', message: e.message || 'Invalid request body' }
    };
  }

  const { country, state, zipcode, city, region } = resolveLocationParams(merged);

  if (!country) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'country is required (send country_id, country, or tax_country_id)'
      }
    };
  }

  if (!state) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'region is required (send region_id, state, or tax_region_id)'
      }
    };
  }

  const taxRateResult = await findTaxRateByLocation(country, state, zipcode, city, region, dbCtx);

  if (!taxRateResult || (Array.isArray(taxRateResult) && taxRateResult.length === 0)) {
    return {
      statusCode: 404,
      headers: CORS,
      body: {
        status: 'Not Found',
        message: 'Tax rate not found for the provided location',
        searchCriteria: {
          country_id: country,
          region_id: state,
          postcode: zipcode || 'not provided',
          city: city || 'not provided'
        }
      }
    };
  }

  const paginated = applyPaginationToResult(taxRateResult, merged);
  const isArray = Array.isArray(paginated);
  const taxRates = isArray ? paginated : [paginated];
  const processedData = taxRates.map((rate) => normalizeDoc(rate));

  const totalBeforePage = Array.isArray(taxRateResult) ? taxRateResult.length : 1;
  const { limit, skip } = parsePagination(merged);
  const meta =
    isArray && totalBeforePage > 0
      ? {
          total: totalBeforePage,
          limit,
          skip,
          returned: processedData.length
        }
      : undefined;

  return {
    statusCode: 200,
    headers: CORS,
    body: {
      status: 'Success',
      message: isArray ? `${processedData.length} tax rate(s) found` : 'Tax rate found',
      count: processedData.length,
      ...(meta ? { pagination: meta } : {}),
      data: isArray ? processedData : processedData[0]
    }
  };
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  if (method !== 'GET' && method !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Method not allowed. Use GET or POST.' }
    };
  }

  const authResult = await resolveAuthAndNamespace(params);
  if (authResult.error) {
    const e = authResult.error;
    return {
      statusCode: e.statusCode,
      headers: { ...CORS, ...(e.statusCode === 401 ? { 'WWW-Authenticate': 'Basic realm="Tax API"' } : {}) },
      body: e.body
    };
  }

  const dbCtx = { bearerToken: authResult.accessToken, namespace: authResult.namespace };

  try {
    return await runGetFlow(params, dbCtx);
  } catch (error) {
    console.error('get-tax-rate (webAPI):', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Error retrieving tax rate',
        error: error.message
      }
    };
  }
}

exports.main = main;
