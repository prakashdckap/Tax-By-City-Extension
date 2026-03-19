/**
 * Delete Tax Rate Action - Delete tax rate from Magento and App Builder Database
 * Deletes tax rate by ID from both Magento Commerce and the tax_rates collection
 * 
 * POST /delete-tax-rate - Delete tax rate by ID
 */

require('dotenv').config();

const axios = require('axios');
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient;
const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';

/**
 * Initialize database connection with IMS token (per App Builder DB docs).
 */
async function initDb(params = {}, region = DEFAULT_REGION) {
  try {
    const token = await generateAccessToken(params);
    const db = await libDb.init({ token: token.access_token, region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  } catch (error) {
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get Magento configuration from environment variables
 */
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

/**
 * Generate access token for Magento API (IMS client credentials)
 */
async function getImsAccessToken(config) {
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

/**
 * Get access token (use cached or generate new)
 */
async function getAccessToken(config) {
  return config.accessToken || getImsAccessToken(config);
}

/**
 * Delete tax rate from Magento
 */
async function deleteFromMagento(taxIdentifier, region = DEFAULT_REGION) {
  if (!taxIdentifier) {
    console.log('No tax_identifier found, skipping Magento delete');
    return { success: true, skipped: true };
  }

  try {
    const config = getMagentoConfig();
    const token = await getAccessToken(config);
    
    const url = `https://${config.commerceDomain}/${config.instanceId}/V1/taxRates/${taxIdentifier}`;

    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return { success: true, deleted: true };
  } catch (error) {
    console.error('Magento delete error:', error.response?.data || error.message);
    console.error('URL used:', url);
    console.error('Tax Rate ID used:', taxIdentifier);
    // If Magento delete fails, we still want to delete from DB
    // But log the error for debugging
    const magentoError = new Error(
      `Magento delete failed with status ${error.response?.status || 'unknown'}. ` +
      `Details: ${JSON.stringify(error.response?.data || error.message)}. ` +
      `URL: ${url}, Tax Rate ID: ${taxIdentifier}`
    );
    magentoError.statusCode = error.response?.status || 500;
    magentoError.magentoResponse = error.response?.data;
    throw magentoError;
  }
}

/**
 * Find tax rate by ID (to get tax_identifier before deletion)
 */
async function findTaxRateById(taxRateId, region = DEFAULT_REGION, params = {}) {
  let client;
  try {
    console.log('[DEBUG] findTaxRateById - Looking for ID:', taxRateId, 'type:', typeof taxRateId);
    const { client: dbClient, collection } = await initDb(params, region);
    client = dbClient;
    
    // Convert string ID to ObjectId
    let objectId;
    try {
      objectId = new ObjectId(taxRateId);
      console.log('[DEBUG] findTaxRateById - Converted to ObjectId:', objectId.toString());
    } catch (error) {
      console.log('[DEBUG] findTaxRateById - ObjectId conversion failed:', error.message);
      throw new Error(`Invalid tax rate ID format: ${error.message}`);
    }
    
    // Find the tax rate
    console.log('[DEBUG] findTaxRateById - Querying database with ObjectId:', objectId.toString());
    const taxRate = await collection.findOne({ _id: objectId });
    console.log('[DEBUG] findTaxRateById - Query result:', taxRate ? 'FOUND' : 'NOT FOUND');
    if (taxRate) {
      console.log('[DEBUG] findTaxRateById - Found tax rate:', JSON.stringify({
        _id: taxRate._id?.toString(),
        city: taxRate.city,
        tax_identifier: taxRate.tax_identifier
      }, null, 2));
    }
    
    // Return null if not found (don't throw error)
    return taxRate || null;
  } catch (error) {
    // Check if it's a "not found" error
    if (error.message && error.message.includes('Document not found')) {
      return null;
    }
    // Check if it's a database-related error
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      // If it's a "not found" database error, return null instead of throwing
      if (error.message.includes('not found') || error.message.includes('Document not found')) {
        return null;
      }
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Delete tax rate by ID (from both Magento and Database)
 */
async function deleteTaxRateById(taxRateId, region = DEFAULT_REGION, params = {}) {
  let client;
  try {
    // First, find the tax rate to get tax_identifier
    console.log('[DEBUG] delete-tax-rate - Searching for tax rate with ID:', taxRateId);
    const taxRate = await findTaxRateById(taxRateId, region, params);
    console.log('[DEBUG] delete-tax-rate - Tax rate found:', taxRate ? 'YES' : 'NO');
    
    if (!taxRate) {
      console.log('[DEBUG] delete-tax-rate - Tax rate not found, returning error');
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found',
        magento: { success: true, skipped: true }
      };
    }
    
    console.log('[DEBUG] delete-tax-rate - Tax rate found:', JSON.stringify({
      _id: taxRate._id?.toString(),
      tax_identifier: taxRate.tax_identifier,
      city: taxRate.city,
      tax_country_id: taxRate.tax_country_id
    }, null, 2));

    // Delete from Magento first (use numeric ID if available, fallback to tax_identifier)
    let magentoResult = { success: true, skipped: true };
    
    // Prefer numeric ID for Magento deletion (Magento API requires numeric ID)
    const magentoId = taxRate.magento_tax_rate_id || 
                     taxRate.magento_id || 
                     taxRate.id ||
                     null;
    
    if (magentoId) {
      try {
        // Use numeric ID for Magento deletion
        magentoResult = await deleteFromMagento(magentoId, region);
        console.log('Magento delete result:', magentoResult);
      } catch (magentoError) {
        console.error('Magento delete failed, but continuing with DB delete:', magentoError.message);
        // Continue with DB delete even if Magento delete fails
        magentoResult = { success: false, error: magentoError.message };
      }
    } else if (taxRate.tax_identifier) {
      // Fallback to tax_identifier if numeric ID not available
      // Note: This may fail if Magento requires numeric ID
      try {
        magentoResult = await deleteFromMagento(taxRate.tax_identifier, region);
        console.log('Magento delete result (using tax_identifier):', magentoResult);
      } catch (magentoError) {
        console.error('Magento delete failed (using tax_identifier), but continuing with DB delete:', magentoError.message);
        magentoResult = { success: false, error: magentoError.message };
      }
    } else {
      console.log('No magento_tax_rate_id or tax_identifier found, skipping Magento delete');
    }

    // Delete from database
    const { client: dbClient, collection } = await initDb(params, region);
    client = dbClient;
    
    // Convert string ID to ObjectId
    let objectId;
    try {
      objectId = new ObjectId(taxRateId);
    } catch (error) {
      throw new Error(`Invalid tax rate ID format: ${error.message}`);
    }
    
    // Delete the tax rate from database
    const result = await collection.deleteOne({ _id: objectId });
    
    if (result.deletedCount === 0) {
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found in database',
        magento: magentoResult
      };
    }
    
    return {
      success: true,
      deletedCount: result.deletedCount,
      magento: magentoResult
    };
  } catch (error) {
    // Check if it's a "not found" error
    if (error.message && (error.message.includes('not found') || error.message.includes('Document not found'))) {
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found',
        magento: { success: true, skipped: true }
      };
    }
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
  // Handle OPTIONS preflight request for CORS (same as create/update pattern)
  const method = (params["__ow_method"] || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {}
    };
  }

  try {
    console.log('[DEBUG] delete-tax-rate - Received params keys:', Object.keys(params));
    console.log('[DEBUG] delete-tax-rate - __ow_body type:', typeof params["__ow_body"]);
    console.log('[DEBUG] delete-tax-rate - params.id:', params.id);
    console.log('[DEBUG] delete-tax-rate - params._id:', params._id);
    console.log('[DEBUG] delete-tax-rate - Full params:', JSON.stringify(params, null, 2).substring(0, 500));
    
    // Parse request body if present
    // For web actions, body comes in __ow_body as base64 encoded string when Content-Type is application/json
    // For direct action calls, body is passed directly in params
    let body = null;
    
    // First check if params has id/_id directly (direct action call - most common)
    if (params.id || params._id) {
      console.log('[DEBUG] delete-tax-rate - ID found directly in params');
      body = { id: params.id || params._id, region: params.region || DEFAULT_REGION };
    } else if (params["__ow_body"]) {
      const bodyData = params["__ow_body"];
      console.log('[DEBUG] delete-tax-rate - Processing __ow_body, type:', typeof bodyData);
      
      // If it's already an object, use it directly
      if (typeof bodyData === 'object' && !Array.isArray(bodyData)) {
        console.log('[DEBUG] delete-tax-rate - Body is already an object');
        body = bodyData;
      } else if (typeof bodyData === 'string') {
        console.log('[DEBUG] delete-tax-rate - Body is string, length:', bodyData.length);
        // Try base64 decode first (most common for web actions)
        try {
          const decoded = Buffer.from(bodyData, 'base64').toString('utf-8');
          console.log('[DEBUG] delete-tax-rate - Base64 decoded successfully');
          body = JSON.parse(decoded);
        } catch (e1) {
          console.log('[DEBUG] delete-tax-rate - Base64 decode failed, trying direct JSON parse');
          // If base64 fails, try parsing as JSON string
          try {
            body = JSON.parse(bodyData);
            console.log('[DEBUG] delete-tax-rate - JSON parsed successfully');
          } catch (e2) {
            console.error('Error parsing body:', e2);
            return {
              statusCode: 400,
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                status: 'Error',
                message: 'Invalid JSON in request body: ' + e2.message
              }
            };
          }
        }
      }
    }

    console.log('[DEBUG] delete-tax-rate - Parsed body:', JSON.stringify(body, null, 2));

    // Get parameters from body, params, or query string
    const taxRateId = body?.id || body?._id || params.id || params._id || params["__ow_query"]?.id || params["__ow_query"]?._id;
    const region = body?.region || params.region || params["__ow_query"]?.region || DEFAULT_REGION;
    
    console.log('[DEBUG] delete-tax-rate - Extracted taxRateId:', taxRateId);
    console.log('[DEBUG] delete-tax-rate - Extracted region:', region);

    // Validate required parameters
    if (!taxRateId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'id or _id parameter is required',
          debug: {
            receivedParams: Object.keys(params),
            paramsId: params.id,
            params_id: params._id,
            bodyId: body?.id,
            body_id: body?._id
          }
        }
      };
    }

    // Delete the tax rate
    const result = await deleteTaxRateById(taxRateId, region, params);

    if (result.success) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Success',
          message: 'Tax rate deleted successfully from database and Magento',
          deletedCount: result.deletedCount,
          magento: result.magento
        }
      };
    } else {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: result.message || 'Tax rate not found',
          deletedCount: result.deletedCount
        }
      };
    }
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error deleting tax rate',
        error: error.message
      }
    };
  }
}

// Wrap main for web actions (same pattern as create-tax-rate and update-tax-rate)
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
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
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
