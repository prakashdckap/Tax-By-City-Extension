/**
 * Generate Adobe Access Token - Web action.
 * Returns an IMS access token (client_credentials). Credentials from params (app.config inputs)
 * or request body. Optional: Authorization: Basic base64(client_id:client_secret).
 *
 * POST /generate-token - Returns { access_token, token_type, expires_in? }.
 */

const axios = require('axios');
const qs = require('qs');

const DEFAULT_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const DEFAULT_SCOPE = 'AdobeID,openid,read_organizations,additional_info.projectedProductContext,additional_info.roles,adobeio_api,read_client_secret,manage_client_secrets,event_receiver_api';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
};

/** Parse Authorization: Basic base64(client_id:client_secret). */
function parseBasicAuth(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const auth = headers.authorization || headers.Authorization;
  if (!auth || typeof auth !== 'string') return null;
  const match = /^\s*Basic\s+(.+)$/i.exec(auth);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1].trim(), 'base64').toString('utf-8');
    const colon = decoded.indexOf(':');
    if (colon <= 0) return null;
    return { clientId: decoded.slice(0, colon), clientSecret: decoded.slice(colon + 1) };
  } catch (_) {
    return null;
  }
}

/** Resolve config: Basic auth > body > params > env. */
function getTokenConfig(params, body, basicAuth) {
  return {
    clientId: basicAuth?.clientId ?? body?.clientId ?? body?.ADOBE_CLIENT_ID ?? params.ADOBE_CLIENT_ID ?? process.env.ADOBE_CLIENT_ID,
    clientSecret: basicAuth?.clientSecret ?? body?.clientSecret ?? body?.ADOBE_CLIENT_SECRET ?? params.ADOBE_CLIENT_SECRET ?? process.env.ADOBE_CLIENT_SECRET,
    tokenUrl: body?.ADOBE_TOKEN_URL ?? params.ADOBE_TOKEN_URL ?? process.env.ADOBE_TOKEN_URL ?? DEFAULT_TOKEN_URL,
    scope: body?.scope ?? body?.ADOBE_SCOPE ?? params.ADOBE_SCOPE ?? process.env.ADOBE_SCOPE ?? DEFAULT_SCOPE
  };
}

async function getTokenViaIms(config) {
  const { clientId, clientSecret, tokenUrl, scope } = config;
  if (!clientId || !clientSecret) throw new Error('Client ID and Client Secret are required');
  const payload = qs.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope: scope || DEFAULT_SCOPE
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
  const method = (params['__ow_method'] || params.method || 'POST').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    const headers = params['__ow_headers'] || {};
    const basicAuth = parseBasicAuth(headers);

    let body = null;
    if (params['__ow_body']) {
      try {
        const raw = params['__ow_body'];
        const str = typeof raw === 'string' ? (raw.match(/^[A-Za-z0-9+/=]+$/) ? Buffer.from(raw, 'base64').toString('utf-8') : raw) : JSON.stringify(raw);
        body = JSON.parse(str);
      } catch (_) {}
    }

    const config = getTokenConfig(params, body, basicAuth);
    const token = await getTokenViaIms(config);

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: {
        status: 'Success',
        message: 'Access token generated successfully',
        access_token: token.access_token,
        token_type: 'Bearer',
        ...(token.expires_in != null && { expires_in: token.expires_in })
      }
    };
  } catch (error) {
    const missing = error.message && error.message.includes('Client ID and Client Secret');
    if (!missing) console.error('generate-token error:', error.message);
    return {
      statusCode: missing ? 401 : 500,
      headers: { ...CORS_HEADERS, ...(missing && { 'WWW-Authenticate': 'Basic realm="generate-token"' }) },
      body: {
        status: 'Error',
        message: missing ? 'Credentials required. Use Authorization: Basic base64(client_id:client_secret) or deploy with params.' : 'Error generating access token',
        error: error.message
      }
    };
  }
}

exports.main = main;
