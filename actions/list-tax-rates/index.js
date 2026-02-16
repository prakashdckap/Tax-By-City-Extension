/**
 * List Tax Rates - Returns tax rates from App Builder Database
 * GET /list-tax-rates
 * 
 * Query Parameters:
 * - limit: Number of results per page (default: 20, max: 1000)
 * - page: Page number (default: 1)
 * - country: Filter by country code (optional)
 * - state: Filter by state/region code (optional)
 * - zipcode: Filter by zipcode (optional)
 * - city: Filter by city name (optional)
 * - region: Database region (amer, emea, apac) - default: amer
 */

const libDb = require('@adobe/aio-lib-db');
const { DbError } = require('@adobe/aio-lib-db');

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
    if (error instanceof DbError) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Find tax rates with filters and pagination
 */
async function findTaxRates(filter = {}, options = {}, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const { limit, skip, sort } = options;
    let cursor = collection.find(filter);
    
    if (sort) {
      cursor = cursor.sort(sort);
    }
    
    if (skip) {
      cursor = cursor.skip(skip);
    }
    
    if (limit) {
      cursor = cursor.limit(limit);
    }
    
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

/**
 * Count tax rates matching filter
 */
async function countTaxRates(filter = {}, region = DEFAULT_REGION) {
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    const cursor = collection.find(filter);
    const results = await cursor.toArray();
    return results.length;
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

async function main(params) {
  try {
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

    // Only handle GET requests
    if (method !== 'GET') {
      return {
        statusCode: 405,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Method not allowed. Only GET requests are supported.'
        }
      };
    }

    // Log incoming parameters for debugging
    console.log('list-tax-rates: Received params', {
      method,
      hasQuery: !!params["__ow_query"],
      queryType: typeof params["__ow_query"],
      directParams: Object.keys(params).filter(k => !k.startsWith('__ow_'))
    });

    // Parse query parameters - web actions can have them in __ow_query or directly in params
    let queryParams = {};
    
    // First, try to get from __ow_query (web action format)
    if (params["__ow_query"]) {
      if (typeof params["__ow_query"] === 'string') {
        try {
          const urlParams = new URLSearchParams(params["__ow_query"]);
          for (const [key, value] of urlParams.entries()) {
            queryParams[key] = value;
          }
        } catch (e) {
          console.warn('Error parsing __ow_query:', e);
        }
      } else if (typeof params["__ow_query"] === 'object') {
        queryParams = { ...params["__ow_query"] };
      }
    }
    
    // Also check params directly (fallback for direct invocation)
    // Merge params into queryParams, but don't overwrite existing values
    const directParams = ['limit', 'page', 'country', 'state', 'zipcode', 'city', 'region'];
    directParams.forEach(key => {
      if (params[key] !== undefined && queryParams[key] === undefined) {
        queryParams[key] = params[key];
      }
    });
    
    // Get parameters with proper defaults
    const limitValue = queryParams.limit || params.limit;
    const limit = limitValue ? parseInt(limitValue, 10) : 20;
    const pageValue = queryParams.page || params.page;
    const page = pageValue ? parseInt(pageValue, 10) : 1;
    const country = queryParams.country || params.country;
    const state = queryParams.state || params.state;
    const zipcode = queryParams.zipcode || params.zipcode;
    const city = queryParams.city || params.city;
    const region = queryParams.region || params.region || DEFAULT_REGION;

    // Validate limit
    if (limit < 1 || limit > 1000) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'limit must be between 1 and 1000'
        }
      };
    }

    // Build filter
    const filter = {};
    if (country) filter.tax_country_id = country;
    if (state) filter.tax_region_id = state;
    if (zipcode) filter.tax_postcode = zipcode;
    if (city) filter.city = city;

    // Calculate pagination
    const pageSize = limit;
    const currentPage = page;
    const skip = (currentPage - 1) * pageSize;

    // Get total count and results with error handling
    let totalItems = 0;
    let items = [];
    
    try {
      [totalItems, items] = await Promise.all([
        countTaxRates(filter, region),
        findTaxRates(filter, {
          limit: pageSize,
          skip: skip,
          sort: { created_at: -1 }
        }, region)
      ]);
    } catch (dbError) {
      console.error('Database error in list-tax-rates:', dbError);
      throw new Error(`Database error: ${dbError.message || String(dbError)}`);
    }

    // Convert ObjectId to string for JSON response
    const paginatedItems = items.map(item => {
      const result = { ...item };
      if (result._id) {
        result._id = result._id.toString();
      }
      return result;
    });

    const totalPages = Math.ceil(totalItems / pageSize);

    const response = {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        data: paginatedItems,
        pagination: {
          page: currentPage,
          limit: pageSize,
          total: totalItems,
          totalPages: totalPages,
          hasNext: currentPage < totalPages,
          hasPrev: currentPage > 1
        }
      }
    };

    // Ensure body is always an object (not array, not null)
    if (!response.body || typeof response.body !== 'object' || Array.isArray(response.body)) {
      response.body = Array.isArray(response.body) 
        ? { status: 'Success', data: response.body }
        : (response.body || { status: 'Success' });
    }

    console.log('list-tax-rates: Returning response', {
      statusCode: response.statusCode,
      dataCount: response.body.data?.length || 0,
      total: response.body.pagination?.total || 0
    });

    return response;
  } catch (error) {
    console.error('Error listing tax rates:', error);
    console.error('Error stack:', error.stack);
    
    // Ensure error response is always valid
    const errorResponse = {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error fetching tax rates from database',
        error: error.message || String(error)
      }
    };

    // Ensure body is always an object
    if (!errorResponse.body || typeof errorResponse.body !== 'object') {
      errorResponse.body = { status: 'Error', message: String(error) };
    }

    return errorResponse;
  }
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
          'Access-Control-Allow-Origin': '*',
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
      headers: result.headers || {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
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
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: error.message || 'Internal server error'
      }
    };
  }
}

exports.main = wrappedMain;
