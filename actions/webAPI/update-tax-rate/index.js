/*
 * Update Tax Rate (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Flow: Magento PUT /V1/taxRates → ABDB updateOne. Body: { _id | id, region?, taxRate }.
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

const COLLECTION_NAME = 'tax_rates';

/* --------------------------------------------------------------------------
 * MAGENTO CONFIG (params first, then env — same as create-tax-rate webAPI)
 * -------------------------------------------------------------------------- */
function getMagentoConfig(params = {}) {
  const p = (k) => (params[k] != null ? params[k] : process.env[k]);
  const commerceDomain = p('MAGENTO_COMMERCE_DOMAIN');
  const instanceId = p('MAGENTO_INSTANCE_ID');
  const clientId = p('ADOBE_CLIENT_ID');
  const clientSecret = p('ADOBE_CLIENT_SECRET');
  const tokenUrl = p('ADOBE_TOKEN_URL');
  const scope = p('ADOBE_SCOPE');
  const accessToken = p('MAGENTO_ACCESS_TOKEN');

  if (!commerceDomain || !clientId || !clientSecret) {
    throw new Error('Missing Magento / Adobe config: set MAGENTO_COMMERCE_DOMAIN, ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET');
  }

  return {
    commerceDomain,
    instanceId: instanceId || '',
    clientId,
    clientSecret,
    tokenUrl: tokenUrl || 'https://ims-na1.adobelogin.com/ims/token/v3',
    scope:
      scope ||
      'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api',
    accessToken
  };
}

/* --------------------------------------------------------------------------
 * AUTH
 * -------------------------------------------------------------------------- */
async function generateAccessToken(config) {
  const response = await axios.post(config.tokenUrl, null, {
    params: {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
      scope: config.scope
    },
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  return response.data.access_token;
}

async function getAccessToken(config) {
  return config.accessToken || generateAccessToken(config);
}

/* --------------------------------------------------------------------------
 * MAGENTO
 * -------------------------------------------------------------------------- */
const US_STATE_TO_REGION_ID = {
  'AL': 1, 'AK': 2, 'AS': 3, 'AZ': 4, 'AR': 5, 'AF': 6, 'AA': 7, 'AC': 8, 'AE': 9, 'AM': 10, 'AP': 11,
  'CA': 12, 'CO': 13, 'CT': 14, 'DE': 15, 'DC': 16, 'FM': 17, 'FL': 18, 'GA': 19, 'GU': 20, 'HI': 21,
  'ID': 22, 'IL': 23, 'IN': 24, 'IA': 25, 'KS': 26, 'KY': 27, 'LA': 28, 'ME': 29, 'MH': 30, 'MD': 31,
  'MA': 32, 'MI': 33, 'MN': 34, 'MS': 35, 'MO': 36, 'MT': 37, 'NE': 38, 'NV': 39, 'NH': 40, 'NJ': 41,
  'NM': 42, 'NY': 43, 'NC': 44, 'ND': 45, 'MP': 46, 'OH': 47, 'OK': 48, 'OR': 49, 'PW': 50, 'PA': 51,
  'PR': 52, 'RI': 53, 'SC': 54, 'SD': 55, 'TN': 56, 'TX': 57, 'UT': 58, 'VT': 59, 'VI': 60, 'VA': 61,
  'WA': 62, 'WV': 63, 'WI': 64, 'WY': 65
};

function getMagentoRegionId(stateCodeOrId, countryId = 'US') {
  if (!stateCodeOrId || stateCodeOrId === '' || stateCodeOrId === '*' || stateCodeOrId === 'ALL') {
    return 0;
  }
  if (typeof stateCodeOrId === 'number') {
    return stateCodeOrId;
  }
  if (typeof stateCodeOrId === 'string' && /^\d+$/.test(stateCodeOrId)) {
    return parseInt(stateCodeOrId, 10);
  }
  if (countryId === 'US' && typeof stateCodeOrId === 'string') {
    const normalizedStateCode = stateCodeOrId.trim().toUpperCase();
    return US_STATE_TO_REGION_ID[normalizedStateCode] || 0;
  }
  return 0;
}

function formatMagentoTaxRatePayload(data, existingData) {
  const country = data.tax_country_id || 'US';
  const rate = Number(data.rate) || 0;
  
  let stateCode = '*';
  let regionId = 0;
  
  if (data.tax_region_id && data.tax_region_id !== '' && data.tax_region_id !== '*' && data.tax_region_id !== 'ALL') {
    if (typeof data.tax_region_id === 'number') {
      regionId = data.tax_region_id;
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === data.tax_region_id);
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0];
      }
    } else if (typeof data.tax_region_id === 'string' && /^\d+$/.test(data.tax_region_id)) {
      regionId = parseInt(data.tax_region_id, 10);
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === regionId);
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0];
      }
    } else if (typeof data.tax_region_id === 'string' && /^[A-Z]{2,3}$/i.test(data.tax_region_id)) {
      stateCode = data.tax_region_id.toUpperCase();
      regionId = getMagentoRegionId(stateCode, country);
    } else {
      stateCode = data.tax_region_id.toUpperCase();
      regionId = getMagentoRegionId(stateCode, country);
    }
  } else {
    regionId = 0;
    stateCode = '*';
  }
  
  // CRITICAL: For UPDATE, only include code if it's different from existing
  const existingCode = existingData?.code || existingData?.tax_identifier || null;
  const newCode = data.code || null;
  const codeMatches = existingCode && newCode && String(existingCode).trim() === String(newCode).trim();
  
  // Handle ZIP range parsing if tax_postcode contains a range format (e.g., "90001-90006")
  let zipFrom = data.zip_from;
  let zipTo = data.zip_to;
  
  if (!zipFrom && !zipTo && data.tax_postcode && data.zip_is_range) {
    // Try to parse range from tax_postcode if zip_from/zip_to not provided
    const rangeMatch = data.tax_postcode.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      zipFrom = rangeMatch[1];
      zipTo = rangeMatch[2];
    }
  }
  
  // Get region name
  let regionName = null;
  if (stateCode && stateCode !== '*') {
    const stateNames = {
      'AK': 'Alaska', 'AL': 'Alabama', 'AR': 'Arkansas', 'AZ': 'Arizona', 'CA': 'California',
      'CO': 'Colorado', 'CT': 'Connecticut', 'DC': 'District of Columbia', 'DE': 'Delaware',
      'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'IA': 'Iowa', 'ID': 'Idaho',
      'IL': 'Illinois', 'IN': 'Indiana', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
      'MA': 'Massachusetts', 'MD': 'Maryland', 'ME': 'Maine', 'MI': 'Michigan', 'MN': 'Minnesota',
      'MO': 'Missouri', 'MS': 'Mississippi', 'MT': 'Montana', 'NC': 'North Carolina', 'ND': 'North Dakota',
      'NE': 'Nebraska', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NV': 'Nevada',
      'NY': 'New York', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania',
      'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
      'UT': 'Utah', 'VA': 'Virginia', 'VT': 'Vermont', 'WA': 'Washington', 'WI': 'Wisconsin',
      'WV': 'West Virginia', 'WY': 'Wyoming'
    };
    regionName = stateNames[stateCode] || stateCode;
  }
  
  const payload = {
    tax_country_id: country,
    rate: rate,
    tax_region_id: regionId,
    tax_postcode: data.tax_postcode || '*',
    zip_is_range: data.zip_is_range ? 1 : 0,
    titles: [
      {
        store_id: '0',
        value: `${regionName || 'All'} - ${rate}%`
      }
    ]
  };
  
  // If zip_is_range is true, include zip_from and zip_to
  if (data.zip_is_range) {
    if (zipFrom) {
      payload.zip_from = zipFrom;
    }
    if (zipTo) {
      payload.zip_to = zipTo;
    }
  }
  
  // Only include code if it's different from existing (to avoid "code already exists" error)
  if (!codeMatches && newCode) {
    payload.code = newCode;
  }
  
  if (regionId > 0 && regionName) {
    payload.region_name = regionName;
  }
  
  return payload;
}

/**
 * Resolve numeric tax rate id from Magento when ABDB row only has code / tax_identifier (legacy sync).
 * GET /V1/taxRates/search with filter field=code.
 */
async function findMagentoTaxRateIdByCode(params, code) {
  if (!code || String(code).trim() === '') return null;
  const config = getMagentoConfig(params);
  const token = await getAccessToken(config);
  const base = `https://${config.commerceDomain}/${config.instanceId}/V1/taxRates/search`;
  const searchParams = {
    'searchCriteria[filterGroups][0][filters][0][field]': 'code',
    'searchCriteria[filterGroups][0][filters][0][value]': String(code).trim(),
    'searchCriteria[filterGroups][0][filters][0][condition_type]': 'eq',
    'searchCriteria[pageSize]': 20
  };
  try {
    const response = await axios.get(base, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      params: searchParams
    });
    const items = response.data?.items || [];
    if (!items.length) return null;
    const id = items[0].id;
    if (id != null && !Number.isNaN(Number(id))) {
      console.log(`Resolved Magento tax rate id ${id} from code search (${code})`);
      return Number(id);
    }
  } catch (e) {
    console.warn('findMagentoTaxRateIdByCode failed:', e.response?.data || e.message);
  }
  return null;
}

async function updateInMagento(data, identifier, existingData, params = {}) {
  const config = getMagentoConfig(params);
  const token = await getAccessToken(config);
  
  // Identifier can be numeric ID or code (string)
  // Try numeric first, but accept string codes too
  let taxRateId = identifier;
  if (typeof identifier === 'string' && /^\d+$/.test(identifier)) {
    taxRateId = parseInt(identifier, 10);
  }

  // CRITICAL: Magento API requires PUT to /V1/taxRates (without ID in URL)
  // The ID must be included in the request body as part of the taxRate object
  const url = `https://${config.commerceDomain}/${config.instanceId}/V1/taxRates`;
  
  console.log(`🔗 Updating Magento tax rate with identifier: ${identifier} (resolved to: ${taxRateId})`);
  console.log(`🔗 URL: ${url} (ID will be in request body)`);

  try {
    const payload = formatMagentoTaxRatePayload(data, existingData);
    
    // CRITICAL: Include the ID in the payload (Magento API requirement)
    if (taxRateId && typeof taxRateId === 'number') {
      payload.id = taxRateId;
    } else if (taxRateId) {
      // If it's a string code, we can't use it as numeric ID
      // But we'll try to include it if it's numeric
      const numericId = parseInt(taxRateId, 10);
      if (!isNaN(numericId)) {
        payload.id = numericId;
      }
    }
    
    // CRITICAL: Magento requires 'code' field for updates
    // Use existing code if new code matches (to avoid "code already exists" error)
    // Otherwise use the new code, or fall back to existing code if no new code provided
    const existingCode = existingData?.code || existingData?.tax_identifier || null;
    const newCode = payload.code || data.code || null;
    
    if (existingCode && newCode && String(existingCode).trim() === String(newCode).trim()) {
      // Code matches - use existing code to avoid "already exists" error
      payload.code = existingCode;
      console.log(`✅ Using existing code (${existingCode}) to avoid "code already exists" error`);
    } else if (!payload.code && existingCode) {
      // No new code provided, use existing code
      payload.code = existingCode;
      console.log(`✅ Using existing code (${existingCode}) as no new code provided`);
    } else if (payload.code) {
      // New code provided and different - use it
      console.log(`✅ Using new code (${payload.code})`);
    } else {
      // No code at all - this will cause an error, but we'll let Magento handle it
      console.log('⚠️  Warning: No code provided for update');
    }
    
    console.log(`📤 PUT payload (with id in body):`, JSON.stringify(payload, null, 2));
    
    const response = await axios.put(url, { taxRate: payload }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    return {
      taxIdentifier: response.data?.tax_identifier || response.data?.code || response.data?.id || taxIdentifier,
      response: response.data
    };
  } catch (error) {
    console.error('Magento API Error:', error.response?.data || error.message);
    console.error('URL used:', url);
    console.error('Tax Rate ID used:', taxRateId);
    const magentoError = new Error(
      `Request failed with status code ${error.response?.status || 'unknown'}. ` +
      `Details: ${JSON.stringify(error.response?.data || error.message)}. ` +
      `URL: ${url}, Tax Rate ID: ${taxRateId}`
    );
    magentoError.statusCode = error.response?.status || 500;
    magentoError.magentoResponse = error.response?.data;
    throw magentoError;
  }
}

/* --------------------------------------------------------------------------
 * DATABASE (IMS + namespace — same as create-tax-rate webAPI)
 * -------------------------------------------------------------------------- */
async function initDbWithCtx(dbCtx, region = DEFAULT_REGION) {
  const { bearerToken, namespace } = dbCtx;
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(COLLECTION_NAME);
  return { client, collection };
}

async function findTaxRateDb(dbCtx, filter, region) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    return await collection.findOne(filter);
  } finally {
    if (client) await client.close();
  }
}

async function updateTaxRateDb(dbCtx, filter, data, region) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;
    const result = await collection.updateOne(filter, {
      $set: { ...data, updated_at: new Date() }
    });
    return result.modifiedCount > 0;
  } finally {
    if (client) await client.close();
  }
}

function parseUpdateBody(params) {
  let body = {};
  if (params.__ow_body) {
    const raw = params.__ow_body;
    try {
      if (typeof raw === 'string') {
        try {
          body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        } catch {
          body = JSON.parse(raw);
        }
      } else if (typeof raw === 'object' && !Array.isArray(raw)) {
        body = raw;
      }
    } catch (e) {
      throw new Error('Invalid JSON in request body: ' + e.message);
    }
  }
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      if (q.has('_id')) body._id = body._id || q.get('_id');
      if (q.has('id')) body._id = body._id || q.get('id');
      if (q.has('region')) body.region = body.region || q.get('region');
    } catch (e) {
      console.warn('update-tax-rate: __ow_query', e?.message || e);
    }
  }
  const flat = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') flat[k] = v;
  }
  const merged = { ...flat, ...body };
  if (!merged.taxRate && params.taxRate) {
    merged.taxRate = params.taxRate;
  }
  return merged;
}

/* --------------------------------------------------------------------------
 * MAIN
 * -------------------------------------------------------------------------- */
async function runUpdateFlow(params, dbCtx) {
  let body;
  try {
    body = parseUpdateBody(params);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: { status: 'Error', message: e.message || 'Invalid request body' }
    };
  }

  const region = body.region || DEFAULT_REGION;
  const taxRate = body.taxRate;
  const docId = body._id || body.id;

  if (!taxRate) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'taxRate is required'
      }
    };
  }

  if (!docId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: '_id or id is required for update'
      }
    };
  }

  let existing;
  try {
    existing = await findTaxRateDb(dbCtx, { _id: new ObjectId(String(docId)) }, region);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: e.message || 'Invalid _id format'
      }
    };
  }

  if (!existing) {
    return {
      statusCode: 404,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Tax rate not found'
      }
    };
  }

  console.log('🔍 Existing tax rate from DB:', JSON.stringify({
    _id: existing._id,
    magento_tax_rate_id: existing.magento_tax_rate_id,
    magento_id: existing.magento_id,
    id: existing.id,
    tax_identifier: existing.tax_identifier,
    code: existing.code
  }, null, 2));

  // Get update identifier (prefer numeric ID, fallback to code/tax_identifier)
  // Try numeric ID first, but if that fails, we'll try using the code
  const updateIdentifier = existing.magento_tax_rate_id || 
                           existing.magento_id || 
                           existing.id ||
                           null;

  // If we don't have numeric ID, try to get it from tax_identifier if it's numeric
  let numericIdentifier = updateIdentifier;
  if (!numericIdentifier && existing.tax_identifier) {
    // Check if tax_identifier is actually a numeric ID stored as string
    if (/^\d+$/.test(String(existing.tax_identifier))) {
      numericIdentifier = parseInt(existing.tax_identifier, 10);
    }
  }

  // Legacy rows: resolve id from Magento by tax code (same as Admin "Tax Identifier")
  if (!numericIdentifier) {
    const lookupCode = existing.code || existing.tax_identifier;
    const resolved = await findMagentoTaxRateIdByCode(params, lookupCode);
    if (resolved) {
      numericIdentifier = resolved;
    }
  }

  // CRITICAL: Magento API requires numeric ID in the request body for updates
  if (!numericIdentifier) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: `Cannot update tax rate: no numeric Magento ID and no matching tax rate in Magento for code "${existing.code || existing.tax_identifier || ''}". Sync from Magento or ensure the rate exists in Commerce with the same code. Existing record: ${JSON.stringify({ magento_tax_rate_id: existing.magento_tax_rate_id, magento_id: existing.magento_id, id: existing.id, tax_identifier: existing.tax_identifier, code: existing.code })}`
      }
    };
  }
  
  // Ensure it's a number
  let identifierToUse = numericIdentifier;
  if (typeof numericIdentifier !== 'number') {
    identifierToUse = parseInt(numericIdentifier, 10);
    if (isNaN(identifierToUse)) {
      return {
        statusCode: 400,
        headers: CORS,
        body: {
          status: 'Error',
          message: `Invalid identifier format: ${numericIdentifier}. Magento requires a numeric ID for updates.`
        }
      };
    }
  }
  
  console.log(`🔍 Using numeric identifier for Magento update: ${identifierToUse}`);

  // Merge existing with new data (exclude code if it matches)
  const existingCode = existing.code || existing.tax_identifier || null;
  const newCode = taxRate.code || null;
  const codeMatches = existingCode && newCode && String(existingCode).trim() === String(newCode).trim();
  
  const mergedData = { ...existing };
  Object.keys(taxRate).forEach(key => {
    if (key === 'code' && codeMatches) {
      return; // Skip code if it matches
    }
    mergedData[key] = taxRate[key];
  });
  
  if (codeMatches) {
    delete mergedData.code;
  }

  // Update in Magento (numeric ID in body per Magento API)
  const magento = await updateInMagento(mergedData, identifierToUse, existing, params);

  // Format tax identifier
  const formatTaxIdentifier = (country, state, rate, customCode) => {
    if (state === '*' && customCode) {
      return `${country}-${state}-${customCode}`;
    } else if (state === '*') {
      return `${country}-${state}-${rate}`;
    } else {
      return `${country}-${state}-${rate}`;
    }
  };

  let taxIdentifier = magento.taxIdentifier || 
                     magento.response?.tax_identifier || 
                     magento.response?.code ||
                     taxRate.tax_identifier ||
                     existing.tax_identifier ||
                     null;

  // Recalculate tax identifier based on NEW values (not existing)
  // Use taxRate values first, fallback to existing only if taxRate doesn't have the field
  const country = taxRate.tax_country_id !== undefined ? taxRate.tax_country_id : (existing.tax_country_id || 'US');
  const rate = taxRate.rate !== undefined ? Number(taxRate.rate) : Number(existing.rate || 0);
  const customCode = taxRate.code !== undefined ? taxRate.code : (existing.code || '');
  
  // Determine state: if taxRate.tax_region_id is explicitly set (even if empty), use it
  // Empty string, null, '*', or 'ALL' all mean "all states" (*)
  let state = '*';
  if (taxRate.tax_region_id !== undefined) {
    if (taxRate.tax_region_id === '' || taxRate.tax_region_id === null || taxRate.tax_region_id === '*' || taxRate.tax_region_id === 'ALL') {
      state = '*'; // All states
    } else {
      state = taxRate.tax_region_id; // Specific state
    }
  } else {
    // taxRate.tax_region_id is undefined, use existing value
    if (!existing.tax_region_id || existing.tax_region_id === '' || existing.tax_region_id === 'ALL' || existing.tax_region_id === '*') {
      state = '*';
    } else {
      state = existing.tax_region_id;
    }
  }
  
  // Recalculate tax identifier with new values
  if (taxIdentifier && typeof taxIdentifier === 'number') {
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  } else if (!taxIdentifier || taxIdentifier === existing.tax_identifier) {
    // Recalculate if no identifier or if it matches existing (might need update)
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  }

  // Extract numeric ID from Magento
  const magentoNumericId = magento.response?.id || 
                           magento.response?.tax_calculation_rate_id ||
                           existing.magento_tax_rate_id ||
                           null;

  // Update in database
  // Normalize tax_region_id: empty string, null, '*', or 'ALL' all mean "all states"
  let normalizedRegionId = existing.tax_region_id;
  if (taxRate.tax_region_id !== undefined) {
    if (taxRate.tax_region_id === '' || taxRate.tax_region_id === null || taxRate.tax_region_id === '*' || taxRate.tax_region_id === 'ALL') {
      normalizedRegionId = ''; // Empty string means "all states"
    } else {
      normalizedRegionId = taxRate.tax_region_id;
    }
  }
  
  // Build final tax rate object with all updated fields
  // Remove 'id' field from taxRate as it's not a database field (it's the MongoDB _id)
  const { id, ...taxRateWithoutId } = taxRate;
  
  // Start with existing data, then override with new values from taxRate
  // This ensures all fields are updated, including null values to clear fields
  const finalTaxRate = {
    ...existing,
    ...taxRateWithoutId,
    // Override with calculated/normalized values
    tax_identifier: taxIdentifier,
    magento_tax_rate_id: magentoNumericId,
    tax_region_id: normalizedRegionId,
    // Ensure code is handled correctly (use new if provided, otherwise keep existing)
    code: taxRate.code !== undefined ? taxRate.code : existing.code
  };

  await updateTaxRateDb(dbCtx, { _id: existing._id }, finalTaxRate, region);

  return {
    statusCode: 200,
    headers: CORS,
    body: {
      status: 'Success',
      magento,
      tax_identifier: taxIdentifier
    }
  };
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }
  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Method not allowed. Use POST.' }
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
    return await runUpdateFlow(params, dbCtx);
  } catch (error) {
    console.error('update-tax-rate (webAPI):', error);
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return {
      statusCode,
      headers: CORS,
      body: {
        status: 'Error',
        message: error.message || 'Error updating tax rate',
        ...(error.magentoResponse ? { magentoResponse: error.magentoResponse } : {})
      }
    };
  }
}

exports.main = main;
