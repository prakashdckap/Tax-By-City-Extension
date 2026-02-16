/**
 * Get Tax Percentage Action
 * Returns tax percentage for a specific location (country, state, zipcode, optional city)
 * GET /get-tax-percentage?country=US&state=CA&zipcode=90210&city=Los%20Angeles&commerceDomain=...&accessToken=...
 */

const axios = require('axios');

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
    // Parse query parameters
    let queryParams = {};
    
    if (params["__ow_query"]) {
      if (typeof params["__ow_query"] === 'string') {
        const urlParams = new URLSearchParams(params["__ow_query"]);
        queryParams = {};
        for (const [key, value] of urlParams.entries()) {
          queryParams[key] = value;
        }
      } else {
        queryParams = params["__ow_query"];
      }
    }
    
    // Get parameters from query or direct params
    const country = queryParams.country || params.country;
    const state = queryParams.state || params.state;
    const zipcode = queryParams.zipcode || params.zipcode;
    const city = queryParams.city || params.city;
    
    const commerceDomain = queryParams.commerceDomain || params.commerceDomain;
    const instanceId = queryParams.instanceId || params.instanceId || queryParams.tenantId || params.tenantId;
    
    // Get access token from headers or params
    let authHeader = params["__ow_headers"]?.["authorization"] || params["__ow_headers"]?.["Authorization"];
    let accessToken = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      accessToken = authHeader.replace(/^Bearer\s+/i, '');
    } else {
      const headers = params["__ow_headers"] || {};
      accessToken = headers["x-commerce-token"] || headers["x-access-token"] || 
                  headers["X-Commerce-Token"] || headers["X-Access-Token"] ||
                  queryParams.accessToken || params.accessToken ||
                  queryParams.bearerToken || params.bearerToken ||
                  queryParams.token || params.token;
    }

    const orgId = params["__ow_headers"]?.["x-gw-ims-org-id"] || queryParams.orgId || params.orgId || 'C116239B68225A790A495C96@AdobeOrg';
    const basicAuth = queryParams.runtimeBasicAuth || params.runtimeBasicAuth || 
                     'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';

    // Validate required parameters
    if (!commerceDomain) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'commerceDomain parameter is required'
        }
      };
    }

    if (!accessToken) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Access token is required. Provide it via Authorization header or accessToken parameter'
        }
      };
    }

    // Validate location parameters
    if (!country) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'country parameter is required'
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
          message: 'state parameter is required'
        }
      };
    }

    if (!zipcode) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'zipcode parameter is required'
        }
      };
    }

    // Search for tax rates matching the location
    const searchCriteria = {
      tax_country_id: country,
      tax_postcode: zipcode,
      region_name: state
    };

    const requestData = {
      operation: 'searchTaxRates',
      commerceDomain: commerceDomain,
      instanceId: instanceId,
      accessToken: accessToken,
      searchCriteria: searchCriteria
    };

    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/manage-tax?result=true&blocking=true',
      headers: { 
        'x-gw-ims-org-id': orgId, 
        'authorization': basicAuth,
        'Content-Type': 'application/json'
      },
      data: JSON.stringify(requestData)
    };

    const response = await axios.request(config);
    const items = response.data?.body?.items || response.data?.body?.data?.items || response.data?.items || [];
    
    // Filter by city if provided (Note: Magento API doesn't support city filtering directly)
    // This would need to be handled by extension_attributes or a custom field
    let matchingRates = items;
    if (city) {
      // For now, we return all matching rates and let the client filter
      // In production, you might want to filter by extension_attributes.city
      matchingRates = items;
    }

    // Find the most specific match (exact zipcode match preferred)
    let bestMatch = null;
    if (matchingRates.length > 0) {
      // Prefer exact zipcode match
      const exactMatch = matchingRates.find(rate => rate.tax_postcode === zipcode);
      bestMatch = exactMatch || matchingRates[0];
    }

    if (bestMatch) {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Success',
          country: country,
          state: state,
          zipcode: zipcode,
          city: city || null,
          taxPercentage: parseFloat(bestMatch.rate) || 0
        }
      };
    } else {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Not Found',
          message: 'No tax rate found for the specified location',
          country: country,
          state: state,
          zipcode: zipcode,
          city: city || null
        }
      };
    }
  } catch (error) {
    console.error('Error getting tax percentage:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error retrieving tax percentage',
        error: error.message,
        errorDetails: error.response ? {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        } : null
      }
    };
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
        ? { data: finalResult.body }
        : (finalResult.body || {});
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

