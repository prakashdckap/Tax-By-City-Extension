const axios = require('axios');
const { getRuntimeApiHost, getRuntimeAuthBase64, getRuntimeNamespace } = require('../lib/config');

async function main(params) {
  console.log('[DEBUG] ========== save-tax-rate START ==========');
  console.log('[DEBUG] Received params keys:', Object.keys(params));
  console.log('[DEBUG] __ow_method:', params["__ow_method"]);
  console.log('[DEBUG] __ow_body type:', typeof params["__ow_body"]);
  console.log('[DEBUG] __ow_body length:', params["__ow_body"] ? (typeof params["__ow_body"] === 'string' ? params["__ow_body"].length : 'object') : 'null');
  console.log('[DEBUG] params.taxRate exists:', !!params.taxRate);
  console.log('[DEBUG] params.region:', params.region);
  
  try {
    // Parse request body
    // For web actions, body comes in __ow_body
    // It can be: base64 encoded string, JSON string, or already parsed object
    let requestBody = {};
    
    if (params["__ow_body"]) {
      const body = params["__ow_body"];
      console.log('[DEBUG] Processing __ow_body, type:', typeof body);
      
      // If it's already an object, use it directly
      if (typeof body === 'object' && !Array.isArray(body)) {
        console.log('[DEBUG] Body is already an object');
        requestBody = body;
      } else if (typeof body === 'string') {
        console.log('[DEBUG] Body is string, length:', body.length);
        // Try base64 decode first (most common for web actions)
        try {
          const decoded = Buffer.from(body, 'base64').toString('utf-8');
          console.log('[DEBUG] Base64 decoded successfully, decoded length:', decoded.length);
          requestBody = JSON.parse(decoded);
          console.log('[DEBUG] JSON parsed from base64 successfully');
        } catch (e1) {
          console.log('[DEBUG] Base64 decode failed:', e1.message);
          // If base64 fails, try parsing as JSON string
          try {
            requestBody = JSON.parse(body);
            console.log('[DEBUG] JSON parsed directly from string successfully');
          } catch (e2) {
            console.log('[DEBUG] JSON parse failed:', e2.message);
            // If both fail, it's not valid JSON
            requestBody = {};
          }
        }
      }
    } else if (params.taxRate || params.region) {
      console.log('[DEBUG] Using params directly (not __ow_body)');
      // Body might be passed directly in params
      requestBody = {
        taxRate: params.taxRate || {},
        region: params.region || process.env.DEFAULT_REGION || ''
      };
    }
    
    console.log('[DEBUG] Parsed requestBody:', JSON.stringify(requestBody, null, 2));

    // Validate required fields
    if (!requestBody.taxRate) {
      console.log('[DEBUG] ERROR: taxRate is missing in requestBody');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          success: false,
          message: 'taxRate is required',
          debug: {
            receivedParams: Object.keys(params),
            parsedRequestBody: requestBody
          }
        }
      };
    }

    console.log('[DEBUG] Validation passed, preparing to call manage-tax-rate');

    // Generate Basic auth (same as working example)
    const runtimeAuthBase64 = getRuntimeAuthBase64(params);
    const authHeader = runtimeAuthBase64 ? `Basic ${runtimeAuthBase64}` : null;

    // Call manage-tax-rate API (exactly like working example)
    const data = JSON.stringify(requestBody);
    console.log('[DEBUG] Request data to manage-tax-rate:', data.substring(0, 200) + '...');
    
    const config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: `${getRuntimeApiHost(params)}/api/v1/namespaces/${encodeURIComponent(getRuntimeNamespace(params))}/actions/manage-tax-rate?result=true&blocking=true`,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader
      },
      data: data
    };

    console.log('[DEBUG] Calling manage-tax-rate API...');
    const response = await axios.request(config);
    console.log('[DEBUG] manage-tax-rate response status:', response.status);
    console.log('[DEBUG] manage-tax-rate response data type:', typeof response.data);
    console.log('[DEBUG] manage-tax-rate response data:', JSON.stringify(response.data, null, 2).substring(0, 500));

    // Handle error responses
    if (response.status >= 400) {
      console.log('[DEBUG] ERROR: manage-tax-rate returned error status:', response.status);
      let errorMessage = 'Request failed';
      if (response.data) {
        if (response.data.body && response.data.body.message) {
          errorMessage = response.data.body.message;
        } else if (response.data.message) {
          errorMessage = response.data.message;
        } else if (typeof response.data === 'string') {
          errorMessage = response.data;
        }
      }
      console.log('[DEBUG] Returning error response with status:', response.status);
      return {
        statusCode: response.status,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          success: false,
          message: errorMessage
        }
      };
    }

    console.log('[DEBUG] Processing successful response from manage-tax-rate');
    
    // Extract body from response (manage-tax-rate returns web action format)
    let responseData = response.data;
    console.log('[DEBUG] Initial responseData type:', typeof responseData);
    console.log('[DEBUG] responseData has body property:', !!responseData?.body);
    
    if (response.data && response.data.body) {
      console.log('[DEBUG] Extracting body from response.data.body');
      responseData = response.data.body;
    } else if (response.data && typeof response.data === 'object') {
      console.log('[DEBUG] Using response.data directly');
      responseData = response.data;
    }

    console.log('[DEBUG] responseData after extraction:', JSON.stringify(responseData, null, 2).substring(0, 500));
    console.log('[DEBUG] responseData type:', typeof responseData, 'isArray:', Array.isArray(responseData), 'isNull:', responseData === null);

    // Ensure body is always a plain object (not null, not array)
    if (!responseData || typeof responseData !== 'object' || Array.isArray(responseData) || responseData === null) {
      console.log('[DEBUG] responseData needs normalization');
      responseData = Array.isArray(responseData) 
        ? { data: responseData }
        : (responseData && typeof responseData === 'object' ? responseData : { success: true });
      console.log('[DEBUG] Normalized responseData:', JSON.stringify(responseData, null, 2).substring(0, 500));
    }

    // Ensure body is JSON serializable
    try {
      const serialized = JSON.stringify(responseData);
      console.log('[DEBUG] responseData is JSON serializable, length:', serialized.length);
    } catch (e) {
      console.log('[DEBUG] ERROR: responseData not serializable:', e.message);
      responseData = { success: true, message: 'Tax rate processed' };
    }

    const finalResponse = {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: responseData
    };

    console.log('[DEBUG] Final response structure:', JSON.stringify({
      statusCode: finalResponse.statusCode,
      headers: finalResponse.headers,
      bodyType: typeof finalResponse.body,
      bodyKeys: finalResponse.body ? Object.keys(finalResponse.body) : 'null'
    }, null, 2));
    
    console.log('[DEBUG] ========== save-tax-rate END (SUCCESS) ==========');
    return finalResponse;

  } catch (error) {
    console.log('[DEBUG] ========== ERROR CAUGHT ==========');
    console.log('[DEBUG] Error type:', error.constructor.name);
    console.log('[DEBUG] Error message:', error.message);
    console.log('[DEBUG] Error stack:', error.stack);
    console.log('[DEBUG] Error response status:', error.response?.status);
    console.log('[DEBUG] Error response data:', JSON.stringify(error.response?.data, null, 2));
    console.log('[DEBUG] ========== ERROR END ==========');
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: {
        success: false,
        error: error.message || 'Internal server error',
        debug: {
          errorType: error.constructor.name,
          responseStatus: error.response?.status,
          responseData: error.response?.data
        }
      }
    };
  }
}

exports.main = main;
