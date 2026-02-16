/**
 * Get Tax Rate Action - Retrieve tax rate from App Builder Database
 * Queries tax rates based on country, state, zipcode, and optional city
 * 
 * GET /get-tax-rate - Get tax rate by location
 */

const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';

/**
 * Initialize database connection
 */
async function initDb(region = DEFAULT_REGION) {
  try {
    const db = await libDb.init({ region });
    const client = await db.connect();
    const collection = await client.collection(COLLECTION_NAME);
    return { client, collection };
  } catch (error) {
    // Check if it's a database-related error by checking error name or message
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Find tax rate by location
 */
async function findTaxRateByLocation(country, state, zipcode, city = null, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
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
    // Parse request body if present
    let body = null;
    if (params["__ow_body"]) {
      try {
        body = typeof params["__ow_body"] === 'string' 
          ? JSON.parse(params["__ow_body"]) 
          : params["__ow_body"];
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
    const taxRateResult = await findTaxRateByLocation(country, state, zipcode, city, region);

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

