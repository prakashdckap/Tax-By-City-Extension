/*
 * Manage Tax Rate Action (Web Action Safe)
 * Flow:
 * 1. Create / Update tax rate in Magento Commerce
 * 2. Persist tax rate in App Builder Database (only if Magento succeeds)
 */

require('dotenv').config();

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';

/* --------------------------------------------------------------------------
 * MAGENTO CONFIG (ENV ONLY)
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
    tokenUrl:
      ADOBE_TOKEN_URL || 'https://ims-na1.adobelogin.com/ims/token/v3',
    scope:
      ADOBE_SCOPE ||
      'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api',
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

/**
 * Magento US State Code to Region ID Mapping
 * Based on Magento's standard region_id values for US states
 */
const US_STATE_TO_REGION_ID = {
  'AL': 1, 'AK': 2, 'AS': 3, 'AZ': 4, 'AR': 5, 'AF': 6, 'AA': 7, 'AC': 8, 'AE': 9, 'AM': 10, 'AP': 11,
  'CA': 12, 'CO': 13, 'CT': 14, 'DE': 15, 'DC': 16, 'FM': 17, 'FL': 18, 'GA': 19, 'GU': 20, 'HI': 21,
  'ID': 22, 'IL': 23, 'IN': 24, 'IA': 25, 'KS': 26, 'KY': 27, 'LA': 28, 'ME': 29, 'MH': 30, 'MD': 31,
  'MA': 32, 'MI': 33, 'MN': 34, 'MS': 35, 'MO': 36, 'MT': 37, 'NE': 38, 'NV': 39, 'NH': 40, 'NJ': 41,
  'NM': 42, 'NY': 43, 'NC': 44, 'ND': 45, 'MP': 46, 'OH': 47, 'OK': 48, 'OR': 49, 'PW': 50, 'PA': 51,
  'PR': 52, 'RI': 53, 'SC': 54, 'SD': 55, 'TN': 56, 'TX': 57, 'UT': 58, 'VT': 59, 'VI': 60, 'VA': 61,
  'WA': 62, 'WV': 63, 'WI': 64, 'WY': 65
};

/**
 * Convert state code to numeric region ID for Magento
 * @param {string|number} stateCodeOrId - State code (e.g., "AK", "NY") or numeric ID
 * @param {string} countryId - Country ID (e.g., "US")
 * @returns {number} Numeric region ID or 0 for "all"
 */
function getMagentoRegionId(stateCodeOrId, countryId = 'US') {
  if (!stateCodeOrId || stateCodeOrId === '' || stateCodeOrId === '*' || stateCodeOrId === 'ALL') {
    return 0; // 0 means "all regions" in Magento
  }

  // If it's already a number, return it (might already be a region ID)
  if (typeof stateCodeOrId === 'number') {
    return stateCodeOrId;
  }

  // If it's a string that looks like a number, convert it
  if (typeof stateCodeOrId === 'string' && /^\d+$/.test(stateCodeOrId)) {
    return parseInt(stateCodeOrId, 10);
  }

  // If it's a state code (like "AK", "NY"), convert to numeric ID
  if (countryId === 'US' && typeof stateCodeOrId === 'string') {
    const normalizedStateCode = stateCodeOrId.trim().toUpperCase();
    return US_STATE_TO_REGION_ID[normalizedStateCode] || 0;
  }

  return 0; // Default to "all regions"
}

function formatMagentoTaxRatePayload(data, operation = 'CREATE', existingData = null) {
  // Format code: if custom code provided, use it; otherwise format as country-state-rate
  const country = data.tax_country_id || 'US'
  const rate = Number(data.rate) || 0
  // Check if code was explicitly removed (because it matched existing)
  const codeWasRemoved = data._codeRemoved === true || (operation === 'UPDATE' && existingData && !data.hasOwnProperty('code') && (existingData.code || existingData.tax_identifier))
  // CRITICAL: If code was removed, don't use data.code even if it exists
  const customCode = codeWasRemoved ? '' : (data.code || '')
  
  // Get numeric region ID for Magento (required!)
  // First, determine if we have a state code or numeric ID
  let stateCode = '*'
  let regionId = 0
  
  if (data.tax_region_id && data.tax_region_id !== '' && data.tax_region_id !== '*' && data.tax_region_id !== 'ALL') {
    // Check if it's already a numeric ID
    if (typeof data.tax_region_id === 'number') {
      regionId = data.tax_region_id
      // We need to reverse lookup the state code from the numeric ID
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === data.tax_region_id)
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0]
      }
    } else if (typeof data.tax_region_id === 'string' && /^\d+$/.test(data.tax_region_id)) {
      // String that looks like a number
      regionId = parseInt(data.tax_region_id, 10)
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === regionId)
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0]
      }
    } else if (typeof data.tax_region_id === 'string' && /^[A-Z]{2,3}$/i.test(data.tax_region_id)) {
      // It's a state code (like "AK", "NY")
      stateCode = data.tax_region_id.toUpperCase()
      regionId = getMagentoRegionId(stateCode, country)
    } else {
      // Try to treat it as a state code
      stateCode = data.tax_region_id.toUpperCase()
      regionId = getMagentoRegionId(stateCode, country)
    }
  } else {
    // Empty or "*" means all regions
    regionId = 0
    stateCode = '*'
  }
  
  // Format code: if custom code exists, use it directly; otherwise auto-generate
  // For UPDATE operations: only include code if it's different from existing code
  // IMPORTANT: Use data.code first (user-provided custom code), then customCode, then auto-generate
  // BUT: If codeWasRemoved is true, we MUST NOT use data.code even if it exists
  let code = null
  let shouldIncludeCode = true
  
  // CRITICAL: If code was explicitly removed (set to undefined) because it matched existing,
  // do NOT auto-generate a new code - we want to exclude it from the payload
  if (codeWasRemoved) {
    code = undefined
    shouldIncludeCode = false
  } else if (data.hasOwnProperty('code') && data.code !== undefined && data.code !== null) {
    // Only use data.code if it exists and wasn't removed
    code = data.code
  }
  // For UPDATE: Check if code matches existing BEFORE auto-generating
  // This prevents auto-generating a code that matches the existing one
  else if (operation === 'UPDATE' && existingData && !code && !codeWasRemoved) {
    // If no code provided, check if auto-generated code would match existing
    const autoGeneratedCode = customCode || `${country}-${stateCode}-${rate}`
    const existingCode = existingData.code || existingData.tax_identifier || null
    if (existingCode && autoGeneratedCode && String(existingCode).trim() === String(autoGeneratedCode).trim()) {
      // Auto-generated code matches existing, don't include it
      code = undefined
      shouldIncludeCode = false
    } else {
      code = autoGeneratedCode
    }
  } else if (!code && !codeWasRemoved) {
    // For CREATE or if code doesn't match, auto-generate
    // BUT: Don't auto-generate if code was explicitly removed
    code = customCode || `${country}-${stateCode}-${rate}`
  }
  
  // For UPDATE: Check if code is the same as existing code
  // If same, don't include it in payload to avoid "code already exists" error
  // IMPORTANT: Check even if code is null/undefined (might have been removed)
  // BUT: Skip this check if codeWasRemoved is already true (we've already determined it matches)
  if (operation === 'UPDATE' && existingData && !codeWasRemoved) {
    // Get existing code from multiple possible fields
    const existingCode = existingData.code || existingData.tax_identifier || null
    // Get new code - check data.code first (original input), then code variable
    // But if codeWasRemoved is true, we should skip this check
    const newCode = (data.hasOwnProperty('code') && data.code !== undefined) ? data.code : (code || null)
    
    // Normalize both codes for comparison (trim whitespace, handle null/undefined)
    const normalizedExisting = existingCode ? String(existingCode).trim() : null
    const normalizedNew = newCode ? String(newCode).trim() : null
    
    if (normalizedExisting && normalizedNew && normalizedExisting === normalizedNew) {
      // Code hasn't changed, don't include it in the payload
      shouldIncludeCode = false
      code = undefined
      // Also mark as removed to prevent any further processing
      data._codeRemoved = true
    }
  }
  
  // Get region name for display (if we have state code)
  // Magento requires the FULL state name (e.g., "Alaska", "New York") not just the code
  let regionName = null
  if (stateCode && stateCode !== '*') {
    // Map state codes to full names (Magento requires full names)
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
    }
    regionName = stateNames[stateCode] || stateCode
  }
  
  // IMPORTANT: Magento requires BOTH tax_region_id (numeric) AND region_name (full name)
  // The numeric ID is what Magento uses internally, but region_name helps with mapping
  
  // Magento Commerce API payload structure
  // Based on Magento's API, tax_region_id must be numeric (0 for all, or specific region ID)
  // region_name should be the full state name (e.g., "Alaska", "New York")
  const payload = {
    tax_country_id: country,
    rate: rate,
    tax_region_id: regionId, // Numeric region ID (0 for all, or 2 for Alaska, 43 for New York, etc.)
    tax_postcode: data.tax_postcode || '*',
    zip_is_range: data.zip_is_range ? 1 : 0,
    titles: [
      {
        store_id: '0',
        value: `${regionName || 'All'} - ${rate}%`
      }
    ]
  };
  
  // Only include code if it's defined and should be included
  // For CREATE: always include code
  // For UPDATE: only include if code has changed
  // CRITICAL: For UPDATE operations, if code hasn't changed, we MUST NOT include it
  // to avoid Magento's "Code already exists" error
  if (codeWasRemoved || (operation === 'UPDATE' && !shouldIncludeCode)) {
    delete payload.code;
  } else if (code !== undefined && shouldIncludeCode && !codeWasRemoved) {
    payload.code = code;
  } else {
    delete payload.code;
  }
  
  // Magento requires BOTH tax_region_id (numeric) AND region_name (full state name)
  if (regionId > 0 && regionName) {
    payload.region_name = regionName;
  }
  
  return payload;
}

function buildMagentoUrl(domain, instanceId, identifier = null) {
  const base = `https://${domain}/${instanceId}/V1/taxRates`;
  return identifier ? `${base}/${identifier}` : base;
}

async function syncToMagento(data, operation, taxIdentifier = null, existingData = null) {
  const config = getMagentoConfig();
  const token = await getAccessToken(config);

  const url = buildMagentoUrl(
    config.commerceDomain,
    config.instanceId,
    operation === 'UPDATE' ? taxIdentifier : null
  );

  try {
    const payload = formatMagentoTaxRatePayload(data, operation, existingData);
    
    // Final safety check: For UPDATE operations, if code matches existing, remove it
    if (operation === 'UPDATE' && existingData && payload.hasOwnProperty('code')) {
      const existingCode = existingData.code || existingData.tax_identifier || null;
      const payloadCode = payload.code;
      if (existingCode && payloadCode && String(existingCode).trim() === String(payloadCode).trim()) {
        delete payload.code;
      }
    }
    
    const response = await axios({
      method: operation === 'UPDATE' ? 'put' : 'post',
      url,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      data: {
        taxRate: payload
      }
    });

    // Extract tax_identifier from Magento response
    // Magento returns tax_identifier or code in the response
    const magentoTaxIdentifier = response.data?.tax_identifier || 
                                 response.data?.code ||
                                 response.data?.id ||
                                 taxIdentifier;

    return {
      taxIdentifier: magentoTaxIdentifier,
      response: response.data
    };
  } catch (error) {
    console.error('Magento API Error:', error.response?.data || error.message);
    // Preserve the original error with status code
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
async function initDb(region) {
  const db = await libDb.init({ region });
  const client = await db.connect();
  return { client, collection: client.collection(COLLECTION_NAME) };
}

async function insertTaxRate(data, region) {
  const { client, collection } = await initDb(region);
  const result = await collection.insertOne({
    ...data,
    created_at: new Date(),
    updated_at: new Date()
  });
  await client.close();
  return result.insertedId;
}

async function updateTaxRate(filter, data, region) {
  const { client, collection } = await initDb(region);
  const result = await collection.updateOne(filter, {
    $set: { ...data, updated_at: new Date() }
  });
  await client.close();
  return result.modifiedCount > 0;
}

async function findTaxRate(filter, region) {
  const { client, collection } = await initDb(region);
  const doc = await collection.findOne(filter);
  await client.close();
  return doc;
}

/* --------------------------------------------------------------------------
 * MAIN (WEB ACTION SAFE)
 * -------------------------------------------------------------------------- */
async function main(params) {
  const method = params.__ow_method || 'POST';

  let body = {};

  /* ---------- Case 1: Normal action invocation ---------- */
  if (params.__ow_body) {
    body =
      typeof params.__ow_body === 'string'
        ? JSON.parse(params.__ow_body)
        : params.__ow_body;
  }

  /* ---------- Case 2: Web Action (CRITICAL FIX) ---------- */
  if (!body.taxRate && params.taxRate) {
    body = params;
  }

  const region = body.region || DEFAULT_REGION;
  const taxRate = body.taxRate;

  if (!taxRate) {
    return {
      statusCode: 400,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'taxRate is required',
        receivedKeys: Object.keys(params)
      }
    };
  }

  /* ---------------- CREATE ---------------- */
  if (method === 'POST') {
    const magento = await syncToMagento(taxRate, 'CREATE');

    // Extract tax_identifier from Magento response
    let taxIdentifier = magento.taxIdentifier || 
                       magento.response?.tax_identifier || 
                       magento.response?.code ||
                       taxRate.tax_identifier ||
                       taxRate.code ||
                       null;

    // Helper function to format tax identifier
    const formatTaxIdentifier = (country, state, rate, customCode) => {
      if (state === '*' && customCode) {
        return `${country}-${state}-${customCode}`;
      } else if (state === '*') {
        return `${country}-${state}-${rate}`;
      } else {
        return `${country}-${state}-${rate}`;
      }
    };

    // If taxIdentifier is a number (Magento ID), format it properly
    if (taxIdentifier && typeof taxIdentifier === 'number') {
      const country = taxRate.tax_country_id || 'US';
      const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') ? '*' : taxRate.tax_region_id;
      const rate = Number(taxRate.rate) || 0;
      const customCode = taxRate.code || '';
      taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
    } else if (!taxIdentifier) {
      // Generate tax_identifier if not provided
      const country = taxRate.tax_country_id || 'US';
      const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') ? '*' : taxRate.tax_region_id;
      const rate = Number(taxRate.rate) || 0;
      const customCode = taxRate.code || '';
      taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
    }

    // Extract numeric ID from Magento response (required for future UPDATE operations)
    const magentoNumericId = magento.response?.id || 
                             magento.response?.tax_calculation_rate_id ||
                             null;
    
    // Preserve the original tax_region_id from input (don't let Magento response overwrite it)
    // Magento may return tax_region_id: 0 even when a state is selected
    const finalTaxRate = {
      ...taxRate,
      tax_identifier: taxIdentifier,
      code: taxRate.code || null,
      // Store numeric ID from Magento for future UPDATE operations
      magento_tax_rate_id: magentoNumericId,
      // Always preserve the original tax_region_id from the input
      tax_region_id: taxRate.tax_region_id || null
    };

    const id = await insertTaxRate(finalTaxRate, region);

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        id,
        magento,
        tax_identifier: taxIdentifier
      }
    };
  }

  /* ---------------- UPDATE ---------------- */
  if (method === 'PUT') {
    if (!body._id) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: { 
          status: 'Error',
          message: '_id is required for update' 
        }
      };
    }

    const existing = await findTaxRate(
      { _id: new ObjectId(body._id) },
      region
    );

    if (!existing) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json'
        },
        body: { 
          status: 'Error',
          message: 'Tax rate not found' 
        }
      };
    }

    // For UPDATE: If code hasn't changed, exclude it from the merged data
    // to avoid "code already exists" error from Magento
    // Check ALL possible code fields to ensure we catch matches
    const existingCode = existing.code || existing.tax_identifier || null
    const newCode = taxRate.code || taxRate.tax_identifier || null
    
    // Normalize both codes for comparison
    const normalizedExisting = existingCode ? String(existingCode).trim() : null
    const normalizedNew = newCode ? String(newCode).trim() : null
    const codeMatches = normalizedExisting && normalizedNew && normalizedExisting === normalizedNew
    
    // Prepare merged data, excluding code if it matches
    // IMPORTANT: Start with existing data, then overlay taxRate
    // But if code matches, we MUST NOT include it
    const mergedData = { ...existing }
    
    // Overlay taxRate data, but exclude code if it matches
    Object.keys(taxRate).forEach(key => {
      if (key === 'code' && codeMatches) {
        // Skip code if it matches existing - don't add it to mergedData at all
        return
      }
      mergedData[key] = taxRate[key]
    })
    
    if (codeMatches) {
      // Code hasn't changed, ensure it's not in merged data
      delete mergedData.code
      // Also remove tax_identifier if it matches (defensive)
      if (mergedData.tax_identifier === normalizedExisting) {
        delete mergedData.tax_identifier
      }
      // Mark that code was intentionally removed
      mergedData._codeRemoved = true
      // Verify code is actually gone
      if (mergedData.hasOwnProperty('code') || mergedData.code !== undefined) {
        delete mergedData.code
        mergedData._codeRemoved = true
      }
    }
    
    // For UPDATE, we need to use the numeric ID from Magento if available
    // Otherwise, use tax_identifier (code) as fallback
    // Magento API requires the numeric ID in the URL for UPDATE operations
    const updateIdentifier = existing.magento_tax_rate_id || 
                             existing.magento_id || 
                             existing.id ||
                             existing.tax_identifier ||
                             null;
    
    if (!updateIdentifier) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Cannot update tax rate: missing identifier. Tax rate must have been synced from Magento or created via API.'
        }
      };
    }
    
    // CRITICAL: If we're using the code as the identifier (not a numeric ID),
    // we MUST NOT include the code in the payload, as Magento will use the identifier from the URL
    const isUsingCodeAsIdentifier = updateIdentifier === existing.code || 
                                    updateIdentifier === existing.tax_identifier ||
                                    (typeof updateIdentifier === 'string' && !/^\d+$/.test(updateIdentifier));
    
    // ALWAYS remove code if it matches existing (regardless of identifier type)
    if (codeMatches || isUsingCodeAsIdentifier) {
      // Completely remove the code property
      const { code, ...mergedDataWithoutCode } = mergedData
      Object.assign(mergedData, mergedDataWithoutCode)
      delete mergedData.code
      mergedData._codeRemoved = true
      // Verify code is actually gone
      if (mergedData.hasOwnProperty('code') || mergedData.code !== undefined) {
        // Final attempt: recreate object without code
        const finalMergedData = {}
        Object.keys(mergedData).forEach(key => {
          if (key !== 'code') {
            finalMergedData[key] = mergedData[key]
          }
        })
        Object.assign(mergedData, finalMergedData)
        delete mergedData.code
        mergedData._codeRemoved = true
      }
    }
    return {
      status: 'Success',
      existing,
      updateIdentifier
    };

    const magento = await syncToMagento(
      mergedData,
      'UPDATE',
      updateIdentifier,
      existing
    );

    // Extract tax_identifier from Magento response
    let taxIdentifier = magento.taxIdentifier || 
                       magento.response?.tax_identifier || 
                       magento.response?.code ||
                       taxRate.tax_identifier ||
                       existing.tax_identifier ||
                       null;

    // Helper function to format tax identifier
    const formatTaxIdentifier = (country, state, rate, customCode) => {
      if (state === '*' && customCode) {
        return `${country}-${state}-${customCode}`;
      } else if (state === '*') {
        return `${country}-${state}-${rate}`;
      } else {
        return `${country}-${state}-${rate}`;
      }
    };

    // If taxIdentifier is a number (Magento ID), format it properly
    if (taxIdentifier && typeof taxIdentifier === 'number') {
      const country = taxRate.tax_country_id || existing.tax_country_id || 'US';
      const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') 
        ? ((!existing.tax_region_id || existing.tax_region_id === 'ALL' || existing.tax_region_id === '*') ? '*' : existing.tax_region_id)
        : taxRate.tax_region_id;
      const rate = Number(taxRate.rate) || Number(existing.rate) || 0;
      const customCode = taxRate.code || existing.code || '';
      taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
    } else if (!taxIdentifier) {
      // Generate tax_identifier if not provided
      const country = taxRate.tax_country_id || existing.tax_country_id || 'US';
      const state = (!taxRate.tax_region_id || taxRate.tax_region_id === 'ALL' || taxRate.tax_region_id === '*') 
        ? ((!existing.tax_region_id || existing.tax_region_id === 'ALL' || existing.tax_region_id === '*') ? '*' : existing.tax_region_id)
        : taxRate.tax_region_id;
      const rate = Number(taxRate.rate) || Number(existing.rate) || 0;
      const customCode = taxRate.code || existing.code || '';
      taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
    }

    // Extract numeric ID from Magento response (required for UPDATE operations)
    const magentoNumericId = magento.response?.id || 
                             magento.response?.tax_calculation_rate_id ||
                             existing.magento_tax_rate_id ||
                             null;
    
    // Preserve the original tax_region_id from input (don't let Magento response overwrite it)
    const finalTaxRate = {
      ...taxRate,
      tax_identifier: taxIdentifier,
      code: taxRate.code || existing.code || null,
      // Store numeric ID from Magento for UPDATE operations
      magento_tax_rate_id: magentoNumericId,
      // Always preserve the original tax_region_id from the input, or keep existing if not provided
      tax_region_id: taxRate.tax_region_id !== undefined ? taxRate.tax_region_id : existing.tax_region_id
    };

    await updateTaxRate(
      { _id: existing._id },
      finalTaxRate,
      region
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        magento,
        tax_identifier: taxIdentifier
      }
    };
  }

  return {
    statusCode: 405,
    headers: {
      'Content-Type': 'application/json'
    },
    body: { message: 'Method not allowed' }
  };
}

// Wrap main to ensure proper response format for web actions
async function wrappedMain(params) {
  try {
    const result = await main(params);
    
    // Ensure result is always a valid web action response
    if (!result || typeof result !== 'object') {
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Invalid response format from action'
        }
      };
    }
    
    // Ensure all required fields exist
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: {
        'Content-Type': 'application/json',
        ...(result.headers || {})
      },
      body: result.body || {}
    };
    
    // Ensure body is always an object
    if (!finalResult.body || typeof finalResult.body !== 'object' || Array.isArray(finalResult.body)) {
      finalResult.body = Array.isArray(finalResult.body) 
        ? { status: 'Success', data: finalResult.body }
        : (finalResult.body || { status: 'Success' });
    }
    
    return finalResult;
  } catch (error) {
    console.error('Error in wrappedMain:', error);
    // Preserve the original status code if it's a Magento API error (400, 404, etc.)
    // Otherwise default to 500 for internal errors
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return {
      statusCode: statusCode,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: error.message || 'Internal server error',
        error: process.env.LOG_LEVEL === 'debug' ? error.stack : undefined
      }
    };
  }
}

exports.main = wrappedMain;
