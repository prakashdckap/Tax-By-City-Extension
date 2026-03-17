/**
 * Get DB token - Returns only the access_token for App Builder DB.
 * Token includes adobeio.abdata.read, adobeio.abdata.write, adobeio.abdata.manage (default scope).
 *
 * GET/POST - Response body: { access_token: "eyJ..." } only.
 * Params from app.config or ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, ADOBE_SCOPE (default: DB scopes).
 */

const axios = require('axios');
const qs = require('qs');

const DEFAULT_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
/** Default scope for App Builder DB (read/write/manage). Use when ADOBE_SCOPE not bound. */
const DEFAULT_DB_SCOPE = 'adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage';
/** Required for App Builder DB API; always merged into requested scope. */
const REQUIRED_DB_SCOPES = ['adobeio.abdata.read', 'adobeio.abdata.write', 'adobeio.abdata.manage'];

function mergeScopeWithDbScopes(requestedScope) {
  if (!requestedScope || typeof requestedScope !== 'string') return DEFAULT_DB_SCOPE;
  const parts = requestedScope.split(',').map(s => s.trim()).filter(Boolean);
  const set = new Set(parts);
  REQUIRED_DB_SCOPES.forEach(s => set.add(s));
  if (!set.has('adobeio_api')) set.add('adobeio_api');
  return [...set].join(',');
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

/** Direct IMS client_credentials (same as generate-token). */
async function getTokenViaIms(params) {
  const clientId = params.ADOBE_CLIENT_ID || params.clientId || process.env.ADOBE_CLIENT_ID;
  const clientSecret = params.ADOBE_CLIENT_SECRET || params.clientSecret || process.env.ADOBE_CLIENT_SECRET;
  const tokenUrl = params.ADOBE_TOKEN_URL || params.tokenUrl || process.env.ADOBE_TOKEN_URL || DEFAULT_TOKEN_URL;
  const requestedScope = params.ADOBE_SCOPE || params.scope || process.env.ADOBE_SCOPE || DEFAULT_DB_SCOPE;
  const scope = mergeScopeWithDbScopes(requestedScope);
  if (!clientId || !clientSecret) {
    throw new Error('Client ID and Client Secret are required');
  }
  const payload = qs.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: scope
  });
  const res = await axios.request({
    method: 'post',
    url: tokenUrl,
    timeout: 15000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    data: payload
  });
  const data = res.data;
  if (!data || !data.access_token) throw new Error('No access_token in IMS response');
  return { access_token: data.access_token, expires_in: data.expires_in };
}

async function main(params) {
  const method = (params['__ow_method'] || params.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    const token = await getTokenViaIms(params);
    const accessToken = token && (token.access_token || token.accessToken);
    if (!accessToken) {
      return {
        statusCode: 500,
        headers: CORS_HEADERS,
        body: { status: 'Error', message: 'Token generation returned no access_token' }
      };
    }
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: { access_token: accessToken }
    };
  } catch (error) {
    console.error('get-db-token error:', error.message);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: {
        status: 'Error',
        message: 'Failed to generate token',
        error: error.message
      }
    };
  }
}

exports.main = main;
