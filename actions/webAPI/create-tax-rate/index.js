/*
 * Create Tax Rate (Web API) — same connection/auth as calculate-tax-rate: ../lib/auth-runtime.js
 * (Basic/Bearer → IMS or get-db-token). Flow: Magento create → ABDB insert (legacy create-tax-rate behavior).
 * Note: create has no list-style pagination; body carries the taxRate payload (filter/sort are N/A here).
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

const COLLECTION_NAME = 'tax_rates';

/* --------------------------------------------------------------------------
 * MAGENTO CONFIG (reads from params first, then process.env)
 * -------------------------------------------------------------------------- */
function getMagentoConfig(params = {}) {
  const p = (k) => params[k] != null ? params[k] : process.env[k];
  const commerceDomain = p('MAGENTO_COMMERCE_DOMAIN');
  const instanceId = p('MAGENTO_INSTANCE_ID');
  const clientId = p('ADOBE_CLIENT_ID');
  const clientSecret = p('ADOBE_CLIENT_SECRET');
  const tokenUrl = p('ADOBE_TOKEN_URL');
  const scope = p('ADOBE_SCOPE');
  const accessToken = p('MAGENTO_ACCESS_TOKEN');

  if (!commerceDomain || !clientId || !clientSecret) {
    throw new Error('Missing Magento / Adobe config: set MAGENTO_COMMERCE_DOMAIN, ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET in action params or env');
  }

  return {
    commerceDomain,
    instanceId: instanceId || '',
    clientId,
    clientSecret,
    tokenUrl: tokenUrl || 'https://ims-na1.adobelogin.com/ims/token/v3',
    scope: scope || 'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api',
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

function formatMagentoTaxRatePayload(data) {
  const country = data.tax_country_id || 'US';
  const rate = Number(data.rate) || 0;
  const customCode = data.code || '';
  
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
  
  // Generate code if not provided
  let code = data.code || null;
  if (!code) {
    if (stateCode === '*' && customCode) {
      code = `${country}-${stateCode}-${customCode}`;
    } else if (stateCode === '*') {
      code = `${country}-${stateCode}-${rate}`;
    } else {
      code = `${country}-${stateCode}-${rate}`;
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
  
  const payload = {
    tax_country_id: country,
    rate: rate,
    tax_region_id: regionId,
    tax_postcode: data.tax_postcode || '*',
    zip_is_range: data.zip_is_range ? 1 : 0,
    code: code,
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
  
  if (regionId > 0 && regionName) {
    payload.region_name = regionName;
  }
  
  return payload;
}

async function createInMagento(data, params = {}) {
  const config = getMagentoConfig(params);
  const token = await getAccessToken(config);
  const url = `https://${config.commerceDomain}/${config.instanceId}/V1/taxRates`;

  try {
    const payload = formatMagentoTaxRatePayload(data);
    const response = await axios.post(url, { taxRate: payload }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    // Log the full response to see what Magento returns
    console.log('📥 Magento CREATE Response:', JSON.stringify(response.data, null, 2));
    
    // Extract numeric ID - Magento might return it in different fields
    const numericId = response.data?.id || 
                     response.data?.tax_calculation_rate_id ||
                     response.data?.tax_rate_id ||
                     null;
    
    console.log('🔍 Extracted Numeric ID:', numericId);
    
    return {
      taxIdentifier: response.data?.tax_identifier || response.data?.code || numericId || null,
      response: response.data,
      numericId: numericId
    };
  } catch (error) {
    console.error('Magento API Error:', error.response?.data || error.message);
    const magentoError = new Error(
      `Request failed with status code ${error.response?.status || 'unknown'}. ` +
      `Details: ${JSON.stringify(error.response?.data || error.message)}`
    );
    magentoError.statusCode = error.response?.status || 500;
    magentoError.magentoResponse = error.response?.data;
    throw magentoError;
  }
}

/* --------------------------------------------------------------------------
 * DATABASE (token from resolveAuthAndNamespace — same IMS/ABDB path as calculate-tax-rate webAPI)
 * -------------------------------------------------------------------------- */

async function insertTaxRate(data, region, dbCtx) {
  const { bearerToken, namespace } = dbCtx;
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(COLLECTION_NAME);
  try {
    const result = await collection.insertOne({
      ...data,
      created_at: new Date(),
      updated_at: new Date()
    });
    return result.insertedId;
  } finally {
    try {
      await client.close();
    } catch (closeErr) {
      console.warn('create-tax-rate (webAPI): client.close warning', closeErr?.message || closeErr);
    }
  }
}

function parseCreateBody(params) {
  let body = {};
  if (params.__ow_body) {
    try {
      try {
        body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString());
      } catch {
        body = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
      }
    } catch (e) {
      throw new Error('Invalid JSON in request body: ' + e.message);
    }
  }
  if (!body.taxRate && params.taxRate) {
    body = { ...params };
  }
  return body;
}

/* --------------------------------------------------------------------------
 * MAIN
 * -------------------------------------------------------------------------- */
async function runCreateFlow(params, dbCtx) {
  const body = parseCreateBody(params);
  const region = body.region || DEFAULT_REGION;
  const taxRate = body.taxRate;

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

  const magento = await createInMagento(taxRate, params);

  const formatTaxIdentifier = (country, state, rate, customCode) => {
    if (state === '*' && customCode) {
      return `${country}-${state}-${customCode}`;
    } else if (state === '*') {
      return `${country}-${state}-${rate}`;
    } else {
      return `${country}-${state}-${rate}`;
    }
  };

  let taxIdentifier =
    magento.taxIdentifier ||
    magento.response?.tax_identifier ||
    magento.response?.code ||
    taxRate.tax_identifier ||
    taxRate.code ||
    null;

  if (taxIdentifier && typeof taxIdentifier === 'number') {
    const country = taxRate.tax_country_id || 'US';
    const state =
      !taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*'
        ? '*'
        : taxRate.tax_region_id;
    const rate = Number(taxRate.rate) || 0;
    const customCode = taxRate.code || '';
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  } else if (!taxIdentifier) {
    const country = taxRate.tax_country_id || 'US';
    const state =
      !taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*'
        ? '*'
        : taxRate.tax_region_id;
    const rate = Number(taxRate.rate) || 0;
    const customCode = taxRate.code || '';
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  }

  const magentoNumericId =
    magento.numericId ||
    magento.response?.id ||
    magento.response?.tax_calculation_rate_id ||
    magento.response?.tax_rate_id ||
    null;

  console.log('💾 Storing magento_tax_rate_id:', magentoNumericId);

  const finalTaxRate = {
    ...taxRate,
    tax_identifier: taxIdentifier,
    code: taxRate.code || null,
    magento_tax_rate_id: magentoNumericId,
    tax_region_id: taxRate.tax_region_id || null
  };

  const id = await insertTaxRate(finalTaxRate, region, dbCtx);

  return {
    statusCode: 201,
    headers: CORS,
    body: {
      status: 'Success',
      id,
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
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
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
    return await runCreateFlow(params, dbCtx);
  } catch (error) {
    console.error('create-tax-rate (webAPI):', error);
    const statusCode = error.statusCode && error.statusCode < 600 ? error.statusCode : 500;
    return {
      statusCode,
      headers: CORS,
      body: {
        status: 'Error',
        message: error.message || 'Internal server error',
        magentoResponse: error.magentoResponse
      }
    };
  }
}

exports.main = main;
