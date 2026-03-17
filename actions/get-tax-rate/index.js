/**
 * Get Tax Rate Action - Retrieve tax rate from App Builder Database
 * Queries tax rates based on country, state, zipcode, and optional city
 *
 * All credentials and URLs from app.config.yaml (action inputs) or env only.
 * DB auth: try Runtime (ow) first, then token from generate-token action (generate-token
 * reads its own credentials from config/env), then IMS fallback from get-tax-rate params/env.
 */

const https = require('https');
const libDb = require('@adobe/aio-lib-db');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';
const DB_SCOPE = 'adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage';

/** Build generate-token web URL from config/env only. No hardcoded URLs. */
function getGenerateTokenUrl(params) {
  const url = params.GENERATE_TOKEN_URL || process.env.GENERATE_TOKEN_URL;
  if (url) return url;
  const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE;
  if (namespace) {
    return `https://${namespace}.adobeioruntime.net/api/v1/web/tax-by-city/generate-token`;
  }
  return null;
}

function hasServiceCredentials(params) {
  const clientId = params.clientId || params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.clientSecret || params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
  return !!(clientId && clientSecret);
}

/**
 * Get access token by calling the generate-token action.
 * Generate-token gets clientId, clientSecret, tokenUrl from its own app.config inputs or env.
 * We only pass scope (DB scope) so the token works for App Builder DB.
 */
function getServiceTokenViaGenerateToken(params) {
  return new Promise((resolve, reject) => {
    const generateTokenUrl = getGenerateTokenUrl(params);
    if (!generateTokenUrl) {
      reject(new Error('GENERATE_TOKEN_URL or __OW_NAMESPACE required (app.config inputs or env)'));
      return;
    }
    const body = JSON.stringify({
      scope: params.ADOBE_SCOPE || process.env.ADOBE_SCOPE || DB_SCOPE
    });
    const u = new URL(generateTokenUrl);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const payload = json.body || json;
          const token = payload.access_token;
          if (token) resolve(token);
          else reject(new Error(payload.message || payload.error || 'No access_token from generate-token'));
        } catch (e) {
          reject(new Error(data || e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/** Fallback: generate token via IMS client_credentials (used if generate-token endpoint fails). */
const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
function getServiceTokenDirect(params) {
  return new Promise((resolve, reject) => {
    const clientId = params.clientId || params.ADOBE_CLIENT_ID || process.env.ADOBE_CLIENT_ID;
    const clientSecret = params.clientSecret || params.ADOBE_CLIENT_SECRET || process.env.ADOBE_CLIENT_SECRET;
    const scope = params.scope || process.env.ADOBE_SCOPE || DB_SCOPE;
    if (!clientId || !clientSecret) {
      reject(new Error('ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET required'));
      return;
    }
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope
    }).toString();
    const u = new URL(IMS_TOKEN_URL);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.access_token) resolve(json.access_token);
          else reject(new Error(json.error_description || json.error || 'No access_token'));
        } catch (e) {
          reject(new Error(data || e.message));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Initialize database: try Runtime (ow) auth first, then service token (client_credentials).
 * Avoids "Oauth token is not valid" when invoked with Basic auth (no IMS context).
 */
async function initDb(params, region = DEFAULT_REGION) {
  const namespace = params.__OW_NAMESPACE || params.runtimeNamespace || process.env.__OW_NAMESPACE;
  const auth = params.__OW_API_KEY || params.runtimeAuth || process.env.__OW_API_KEY;
  if (namespace && auth) {
    const db = await libDb.init({ ow: { namespace, auth }, region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  }
  if (getGenerateTokenUrl(params)) {
    try {
      const token = await getServiceTokenViaGenerateToken(params);
      const db = await libDb.init({ token, region });
      const client = await db.connect();
      const collection = await client.collection(COLLECTION_NAME);
      return { client, collection };
    } catch (e) {
      if (hasServiceCredentials(params)) {
        const token = await getServiceTokenDirect(params);
        const db = await libDb.init({ token, region });
        const client = await db.connect();
        const collection = await client.collection(COLLECTION_NAME);
        return { client, collection };
      }
      throw e;
    }
  }
  if (hasServiceCredentials(params)) {
    const token = await getServiceTokenDirect(params);
    const db = await libDb.init({ token, region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  }
  throw new Error('Database auth failed: set GENERATE_TOKEN_URL or __OW_NAMESPACE (for generate-token), or ADOBE_CLIENT_ID/ADOBE_CLIENT_SECRET in app.config/env');
}

/**
 * Find tax rate by location
 */
async function findTaxRateByLocation(country, state, zipcode, city = null, region = DEFAULT_REGION, params = {}) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(params, region);
    client = dbClient;
    
    // Build filter
    const filter = {
      tax_country_id: country
    };
    
    // Include state if provided
    if (state) {
      filter.tax_region_id = state;
    } else {
      // If state is not provided, match records with no state
      filter.tax_region_id = { $in: [null, ''] };
    }
    
    // Include zipcode if provided (optional)
    if (zipcode) {
      // Check for exact match or wildcard '*'
      filter.tax_postcode = { $in: [zipcode, '*'] };
    }
    // If zipcode is not provided, don't filter by zipcode (match any)
    
    // Include city if provided (optional)
    if (city) {
      filter.city = city;
    }
    // If city is not provided, we'll match records with or without city
    
    // Only get active tax rates
    filter.status = { $ne: false };
    
    // Find matching tax rates (could be multiple)
    const results = await collection.find(filter).toArray();
    
    if (results.length === 0) {
      return null;
    }
    
    // If zipcode or city provided, try to find the best match
    // Otherwise, return all matching records
    if (zipcode || city) {
      // Prioritize:
      // 1. Exact city match (if city was provided)
      // 2. Exact zipcode match (not '*') - if zipcode was provided
      let bestMatch = null;
      
      if (city) {
        // Prefer exact city match
        const cityMatch = results.find(r => r.city === city);
        if (cityMatch) {
          bestMatch = cityMatch;
        }
      }
      
      if (!bestMatch && zipcode) {
        // Prefer exact zipcode match over wildcard (only if zipcode was provided)
        const exactZipMatch = results.find(r => r.tax_postcode === zipcode && r.tax_postcode !== '*');
        if (exactZipMatch) {
          bestMatch = exactZipMatch;
        }
      }
      
      // If best match found, return it; otherwise return all results
      return bestMatch || results;
    }
    
    // No zipcode or city provided - return all matching records
    return results;
  } catch (error) {
    // Check if it's a database-related error by checking error name or message
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

async function main(params) {
  // Handle OPTIONS preflight request for CORS
  const method = params["__ow_method"] || params.method || 'GET';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }
  try {
    // Parse request body if present (supports base64-encoded __ow_body from Runtime/web actions)
    let body = null;
    if (params["__ow_body"]) {
      try {
        const raw = params["__ow_body"];
        if (typeof raw === 'string') {
          try {
            body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
          } catch (_) {
            body = JSON.parse(raw);
          }
        } else {
          body = raw;
        }
      } catch (e) {
        console.error('Error parsing body:', e);
        return {
          statusCode: 400,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
          },
          body: {
            status: 'Error',
            message: 'Invalid JSON in request body: ' + e.message
          }
        };
      }
    }

    // Get parameters from body, params, or query string
    const country = body?.country || body?.tax_country_id || params.country || params.tax_country_id || params["__ow_query"]?.country;
    const state = body?.state || body?.tax_region_id || params.state || params.tax_region_id || params["__ow_query"]?.state;
    const zipcode = body?.zipcode || body?.tax_postcode || body?.postcode || params.zipcode || params.tax_postcode || params.postcode || params["__ow_query"]?.zipcode || params["__ow_query"]?.postcode;
    const city = body?.city || params.city || params["__ow_query"]?.city || null;
    const region = body?.region || params.region || DEFAULT_REGION;

    // Validate required parameters
    if (!country) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'country (tax_country_id) parameter is required'
        }
      };
    }

    if (!state) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'state (tax_region_id) parameter is required'
        }
      };
    }

    // zipcode is optional - no validation needed

    // Find tax rate(s)
    const taxRateResult = await findTaxRateByLocation(country, state, zipcode, city, region, params);

    if (!taxRateResult || (Array.isArray(taxRateResult) && taxRateResult.length === 0)) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Not Found',
          message: 'Tax rate not found for the provided location',
          searchCriteria: {
            country,
            state,
            zipcode: zipcode || 'not provided',
            city: city || 'not provided'
          }
        }
      };
    }

    // Check if result is array (multiple records) or single object
    const isArray = Array.isArray(taxRateResult);
    const taxRates = isArray ? taxRateResult : [taxRateResult];

    // Convert ObjectId to string for all records
    const processedData = taxRates.map(rate => {
      const result = { ...rate };
      if (result._id) {
        result._id = result._id.toString();
      }
      return result;
    });

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        message: isArray 
          ? `${taxRates.length} tax rate(s) found` 
          : 'Tax rate found',
        count: taxRates.length,
        data: isArray ? processedData : processedData[0]
      }
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error retrieving tax rate',
        error: error.message
      }
    };
  }
}

exports.main = main;

