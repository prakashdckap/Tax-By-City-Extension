/**
 * Get Taxes - Calls list-tax-rates API internally
 * GET /get-taxes
 * Returns tax rates from list-tax-rates API
 */

const axios = require('axios');

async function main(params) {
  try {
    // Handle OPTIONS preflight request for CORS
    // Web actions receive method in __ow_method (may be uppercase or lowercase)
    const method = (params["__ow_method"] || params.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      // For web actions, Adobe I/O Runtime handles OPTIONS automatically
      // But we can still return a response to be safe
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {}
      };
    }

    // Handle GET requests (accept both GET and get)
    if (method !== 'GET') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Method not allowed. Only GET requests are supported.'
        }
      };
    }

    // Parse query params (from __ow_query when UI calls get-taxes?limit=0) - default limit=0 = all records
    let limit = 0;
    let page = 1;
    if (params['__ow_query']) {
      const q = typeof params['__ow_query'] === 'string' ? params['__ow_query'] : '';
      const parsed = new URLSearchParams(q);
      if (parsed.has('limit')) limit = parseInt(parsed.get('limit'), 10) || 0;
      if (parsed.has('page')) page = parseInt(parsed.get('page'), 10) || 1;
    }
    if (isNaN(limit) || limit < 0) limit = 0;

    // Call list-tax-rates API internally - pass limit=0 to get ALL records (no limit)
    try {
      const listTaxRatesUrl = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/list-tax-rates?result=true&blocking=true';

      const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: listTaxRatesUrl,
        headers: {
          'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=',
          'Content-Type': 'application/json'
        },
        data: { limit, page }
      };

      const response = await axios.request(config);
      
      // Extract the body from the response if it's wrapped
      let taxRatesData = response.data;
      if (response.data && response.data.body) {
        taxRatesData = response.data.body;
      } else if (response.data && typeof response.data === 'object') {
        taxRatesData = response.data;
      }
      
      // Return the tax rates data
      // Ensure body is always an object (web actions require this)
      let responseBody = taxRatesData;
      if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
        responseBody = Array.isArray(responseBody) 
          ? { status: 'Success', data: responseBody }
          : (responseBody || { status: 'Success' });
      }
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
          // CORS headers are handled automatically by Adobe I/O Runtime for web actions
        },
        body: responseBody
      };
    } catch (apiError) {
      console.error('Error calling list-tax-rates API:', apiError);
      const errorDetails = {
        message: apiError.message || String(apiError),
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data
      };
      console.error('Error details:', JSON.stringify(errorDetails, null, 2));
      
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Failed to fetch tax rates',
          error: errorDetails
        }
      };
    }
  } catch (error) {
    console.error('Error in get-taxes:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Internal server error',
        error: error.message
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
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Invalid response format from action'
        }
      };
    }
    
    // Ensure all required fields exist
    // For web actions, Adobe I/O Runtime handles CORS automatically
    // We only need to set Content-Type and ensure response format is correct
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: {
        'Content-Type': 'application/json',
        // Only set CORS headers if not already present (to avoid duplicates)
        ...(result.headers || {})
      },
      body: result.body || {}
    };
    
    // Remove duplicate CORS headers - let platform handle them
    // But ensure Content-Type is always set
    if (!finalResult.headers['Content-Type']) {
      finalResult.headers['Content-Type'] = 'application/json';
    }
    
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

