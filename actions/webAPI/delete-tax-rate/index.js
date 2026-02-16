/**
 * Delete Tax Rate - Calls delete-tax-rate API internally
 * POST /delete-tax-rate
 * Deletes tax rate from App Builder database
 */

const axios = require('axios');

async function main(params) {
  
  try {
    // Handle OPTIONS preflight request for CORS (Adobe I/O Runtime handles CORS automatically for web actions)
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

    // Handle POST requests
    if (method !== 'POST') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Method not allowed. Only POST requests are supported.'
        }
      };
    }

    // Log incoming params for debugging
    console.log('webAPI delete-tax-rate - Received params:', JSON.stringify({
      method: params["__ow_method"],
      hasBody: !!params["__ow_body"],
      bodyType: typeof params["__ow_body"],
      id: params.id,
      _id: params._id,
      hasQuery: !!params["__ow_query"]
    }, null, 2));

    // Parse request body
    let requestBody = {};
    if (params["__ow_body"]) {
      try {
        // If body is base64 encoded, decode it
        if (typeof params["__ow_body"] === 'string') {
          requestBody = JSON.parse(Buffer.from(params["__ow_body"], 'base64').toString());
        } else {
          requestBody = params["__ow_body"];
        }
      } catch (e) {
        // If not base64, try parsing directly
        try {
          requestBody = typeof params["__ow_body"] === 'string' 
            ? JSON.parse(params["__ow_body"]) 
            : params["__ow_body"];
        } catch (e2) {
          requestBody = params["__ow_body"];
        }
      }
    }
    
    // Also check params directly (for web actions, params might be passed directly)
    if (params.id || params._id) {
      requestBody.id = requestBody.id || params.id || params._id;
    }
    if (params.region) {
      requestBody.region = requestBody.region || params.region;
    }
    
    // Also check query parameters
    const queryParams = params["__ow_query"] || {};
    if (typeof queryParams === 'string') {
      const urlParams = new URLSearchParams(queryParams);
      for (const [key, value] of urlParams.entries()) {
        if (!requestBody[key]) {
          requestBody[key] = value;
        }
      }
    } else if (typeof queryParams === 'object') {
      Object.assign(requestBody, queryParams);
    }
    
    console.log('webAPI delete-tax-rate - Parsed requestBody:', JSON.stringify(requestBody, null, 2));

    // Validate required fields
    if (!requestBody.id && !requestBody._id) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'id or _id is required in request body'
        }
      };
    }

    // Call delete-tax-rate API internally - using exact format as specified
    try {
      // Use the delete-tax-rate-action (which is the actual delete implementation)
      // This is configured in app.config.yaml as delete-tax-rate-action
      const deleteTaxRateUrl = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/tax-by-city/delete-tax-rate-action?blocking=true&result=true';
      
      // Log which URL we're using and request body
      console.log('webAPI delete-tax-rate - Calling action:', deleteTaxRateUrl);
      console.log('webAPI delete-tax-rate - Request body:', JSON.stringify({ id: requestBody.id || requestBody._id }, null, 2));
      
      // Prepare request with id and optional region
      const data = JSON.stringify({
        id: requestBody.id || requestBody._id,
        region: requestBody.region || 'amer'
      });

      const config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: deleteTaxRateUrl,
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
        },
        data: data
      };

      const response = await axios.request(config);
      
      // Extract the response data - when calling with ?result=true&blocking=true,
      // response.data contains the action's return value which is { statusCode, headers, body }
      let responseData = response.data;
      
      // Log the full response for debugging
      console.log('Delete tax rate response:', JSON.stringify(responseData, null, 2));
      
      // Check if the response contains an error
      if (responseData && responseData.body) {
        // If body has an error status, return it with appropriate status code
        if (responseData.body.status === 'Error') {
          // Preserve the original status code (404, 400, etc.)
          const statusCode = responseData.statusCode || 400;
          return {
            statusCode: statusCode,
            headers: {
              'Content-Type': 'application/json'
            },
            body: responseData.body
          };
        }
        responseData = responseData.body;
      } else if (responseData && typeof responseData === 'object' && responseData.statusCode) {
        // If it has statusCode, it's the full response format - preserve it
        const statusCode = responseData.statusCode;
        responseData = responseData.body || { status: 'Success', message: 'Tax rate deleted successfully' };
        
        // If the original response had an error status code, preserve it
        if (statusCode !== 200) {
          return {
            statusCode: statusCode,
            headers: {
              'Content-Type': 'application/json'
            },
            body: responseData
          };
        }
      }
      
      // Ensure body is always a plain object (not array, not null)
      if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData)) {
        responseData = Array.isArray(responseData) 
          ? { status: 'Success', data: responseData }
          : (responseData || { status: 'Success', message: 'Tax rate deleted successfully' });
      }
      
      // Return the response in correct web action format
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: responseData
      };
    } catch (apiError) {
      console.error('Error calling delete-tax-rate API:', apiError);
      const errorDetails = {
        message: apiError.message || String(apiError),
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data
      };
      console.error('Error details:', JSON.stringify(errorDetails, null, 2));
      
      return {
        statusCode: apiError.response?.status || 500,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'Failed to delete tax rate',
          error: errorDetails
        }
      };
    }
  } catch (error) {
    console.error('Error in delete-tax-rate:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
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
    // Merge headers (Adobe I/O Runtime handles CORS automatically for web actions)
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: {
        'Content-Type': 'application/json',
        ...(result.headers || {})
      },
      body: result.body || {}
    };
    
    // Ensure Content-Type is always present
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
