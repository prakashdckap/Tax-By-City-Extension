/**
 * Generate Adobe Access Token Action
 * Generates an access token using Adobe IMS for Magento API authentication
 * 
 * POST /generate-token - Generate access token
 */

// Load environment variables from .env file
require('dotenv').config();

const axios = require('axios');
const qs = require('qs');

/**
 * Generate access token using Adobe IMS
 */
async function generateAccessToken(params, body) {
  // Get credentials from params, body, or environment variables
  const clientId = body?.clientId || params.clientId || process.env.ADOBE_CLIENT_ID;
  const clientSecret = body?.clientSecret || params.clientSecret || process.env.ADOBE_CLIENT_SECRET;
  const tokenUrl = body?.tokenUrl || params.tokenUrl || process.env.ADOBE_TOKEN_URL || 'https://ims-na1.adobelogin.com/ims/token/v3';
  const scope = body?.scope || params.scope || process.env.ADOBE_SCOPE || 'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api,read_client_secret,manage_client_secrets,event_receiver_api';
  
  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Client Secret are required for token generation');
  }
  
  const data = qs.stringify({
    'client_id': clientId,
    'client_secret': clientSecret,
    'grant_type': 'client_credentials',
    'scope': scope
  });
  
  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: tokenUrl,
    headers: { 
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: data
  };
  
  try {
    const response = await axios.request(config);
    if (response.data && response.data.access_token) {
      return response.data.access_token;
    } else {
      throw new Error('Token generation failed: No access_token in response');
    }
  } catch (error) {
    console.error('Error generating access token:', error.message);
    if (error.response) {
      throw new Error(`Token generation failed: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

async function main(params) {
  // Handle OPTIONS preflight request for CORS
  const method = params["__ow_method"] || params.method || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    // Parse request body
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

    // Generate access token
    const accessToken = await generateAccessToken(params, body);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        message: 'Access token generated successfully',
        access_token: accessToken,
        token_type: 'Bearer'
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
        message: 'Error generating access token',
        error: error.message
      }
    };
  }
}

exports.main = main;
