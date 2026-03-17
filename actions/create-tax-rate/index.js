/*
 * Create Tax Rate Action
 * Flow:
 * 1. Create tax rate in Magento Commerce
 * 2. Persist tax rate in App Builder Database (only if Magento succeeds)
 */

require('dotenv').config();

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';

/* --------------------------------------------------------------------------
 * MAGENTO CONFIG
 * -------------------------------------------------------------------------- */
function getMagentoConfig() {
  const {
    MAGENTO_COMMERCE_DOMAIN,
    MAGENTO_INSTANCE_ID,
    ADOBE_CLIENT_ID,
    ADOBE_CLIENT_SECRET,
    ADOBE_TOKEN_URL,
    ADOBE_SCOPE,
    MAGENTO_ACCESS_TOKEN
  } = process.env;

  if (!MAGENTO_COMMERCE_DOMAIN || !ADOBE_CLIENT_ID || !ADOBE_CLIENT_SECRET) {
    throw new Error('Missing Magento / Adobe environment variables');
  }

  return {
    commerceDomain: MAGENTO_COMMERCE_DOMAIN,
    instanceId: MAGENTO_INSTANCE_ID,
    clientId: ADOBE_CLIENT_ID,
    clientSecret: ADOBE_CLIENT_SECRET,
    tokenUrl: ADOBE_TOKEN_URL || 'https://ims-na1.adobelogin.com/ims/token/v3',
    scope: ADOBE_SCOPE || 'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api',
    accessToken: MAGENTO_ACCESS_TOKEN
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

async function createInMagento(data) {
  const config = getMagentoConfig();
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
 * DATABASE
 * -------------------------------------------------------------------------- */
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient;

async function initDb(params, region) {
  const token = await generateAccessToken(params);
  const db = await libDb.init({ token: token.access_token, region });
  const client = await db.connect();
  return { client, collection: client.collection(COLLECTION_NAME) };
}

async function insertTaxRate(data, region, params) {
  const { client, collection } = await initDb(params, region);
  const result = await collection.insertOne({
    ...data,
    created_at: new Date(),
    updated_at: new Date()
  });
  await client.close();
  return result.insertedId;
}

/* --------------------------------------------------------------------------
 * MAIN
 * -------------------------------------------------------------------------- */
async function main(params) {
  let body = {};

  if (params.__ow_body) {
    body = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
  }

  if (!body.taxRate && params.taxRate) {
    body = params;
  }

  const region = body.region || DEFAULT_REGION;
  const taxRate = body.taxRate;

  if (!taxRate) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: {
        status: 'Error',
        message: 'taxRate is required'
      }
    };
  }

  // Create in Magento
  const magento = await createInMagento(taxRate);

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
                     taxRate.code ||
                     null;

  if (taxIdentifier && typeof taxIdentifier === 'number') {
    const country = taxRate.tax_country_id || 'US';
    const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') ? '*' : taxRate.tax_region_id;
    const rate = Number(taxRate.rate) || 0;
    const customCode = taxRate.code || '';
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  } else if (!taxIdentifier) {
    const country = taxRate.tax_country_id || 'US';
    const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') ? '*' : taxRate.tax_region_id;
    const rate = Number(taxRate.rate) || 0;
    const customCode = taxRate.code || '';
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  }

  // Extract numeric ID from Magento (check both response and numericId field)
  const magentoNumericId = magento.numericId ||
                           magento.response?.id || 
                           magento.response?.tax_calculation_rate_id ||
                           magento.response?.tax_rate_id ||
                           null;
  
  console.log('💾 Storing magento_tax_rate_id:', magentoNumericId);

  // Save to database
  const finalTaxRate = {
    ...taxRate,
    tax_identifier: taxIdentifier,
    code: taxRate.code || null,
    magento_tax_rate_id: magentoNumericId,
    tax_region_id: taxRate.tax_region_id || null
  };

  const id = await insertTaxRate(finalTaxRate, region, params);

  return {
    statusCode: 201,
    headers: { 'Content-Type': 'application/json' },
    body: {
      status: 'Success',
      id,
      magento,
      tax_identifier: taxIdentifier
    }
  };
}

// Wrap main for web actions
async function wrappedMain(params) {
  try {
    const result = await main(params);
    
    if (!result || typeof result !== 'object') {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'Error', message: 'Invalid response format from action' }
      };
    }
    
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 201,
      headers: {
        'Content-Type': 'application/json',
        ...(result.headers || {})
      },
      body: result.body || {}
    };
    
    if (!finalResult.body || typeof finalResult.body !== 'object' || Array.isArray(finalResult.body)) {
      finalResult.body = Array.isArray(finalResult.body) 
        ? { status: 'Success', data: finalResult.body }
        : (finalResult.body || { status: 'Success' });
    }
    
    return finalResult;
  } catch (error) {
    console.error('Error in wrappedMain:', error);
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return {
      statusCode: statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: {
        status: 'Error',
        message: error.message || 'Internal server error'
      }
    };
  }
}

exports.main = wrappedMain;
