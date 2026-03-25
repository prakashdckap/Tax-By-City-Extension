/**
 * Shared Runtime + IMS token resolution for web API actions (Basic / Bearer).
 * Used by calculate-tax-rate, create-tax-rate, etc.
 */

const https = require('https');
const crypto = require('crypto');
const { generateAccessToken } = require('@adobe/aio-lib-core-auth');
const {
  getDefaultRegion,
  getRuntimeApiHost,
  getRuntimeAuthBase64,
  getRuntimeNamespace
} = require('./config');

const DEFAULT_REGION = getDefaultRegion();

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff'
};

function secureCompare(a, b) {
  if (a == null || b == null) return false;
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  if (ha.length !== hb.length) return false;
  return crypto.timingSafeEqual(ha, hb);
}

function getExpectedBasicAuthBase64(params) {
  return getRuntimeAuthBase64(params) || null;
}

function normalizeImsParamsForToken(params) {
  const merged = { ...params };
  const env = process.env;
  if (merged.orgId == null && merged.ADOBE_ORG_ID != null) merged.orgId = merged.ADOBE_ORG_ID;
  if (merged.orgId == null && env.ADOBE_ORG_ID) merged.orgId = env.ADOBE_ORG_ID;
  if (merged.orgId == null && env.IMS_OAUTH_S2S_ORG_ID) merged.orgId = env.IMS_OAUTH_S2S_ORG_ID;
  if (merged.clientId == null && merged.ADOBE_CLIENT_ID != null) merged.clientId = merged.ADOBE_CLIENT_ID;
  if (merged.clientId == null && env.ADOBE_CLIENT_ID) merged.clientId = env.ADOBE_CLIENT_ID;
  if (merged.clientId == null && env.IMS_OAUTH_S2S_CLIENT_ID) merged.clientId = env.IMS_OAUTH_S2S_CLIENT_ID;
  if (merged.clientSecret == null && merged.ADOBE_CLIENT_SECRET != null) merged.clientSecret = merged.ADOBE_CLIENT_SECRET;
  if (merged.clientSecret == null && env.ADOBE_CLIENT_SECRET) merged.clientSecret = env.ADOBE_CLIENT_SECRET;
  if (merged.clientSecret == null && env.IMS_OAUTH_S2S_CLIENT_SECRET) merged.clientSecret = env.IMS_OAUTH_S2S_CLIENT_SECRET;
  if (merged.scopes == null && merged.ADOBE_SCOPE != null) {
    const s = merged.ADOBE_SCOPE;
    if (Array.isArray(s)) merged.scopes = s;
    else if (typeof s === 'string') {
      try {
        merged.scopes = JSON.parse(s);
      } catch {
        merged.scopes = s.split(/[,\s]+/).filter(Boolean);
      }
    }
  }
  if (merged.scopes == null && env.ADOBE_SCOPE) {
    const s = env.ADOBE_SCOPE;
    try {
      merged.scopes = JSON.parse(s);
    } catch {
      merged.scopes = String(s)
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  if (merged.scopes == null && env.IMS_OAUTH_S2S_SCOPES) {
    try {
      merged.scopes = JSON.parse(env.IMS_OAUTH_S2S_SCOPES);
    } catch {
      merged.scopes = String(env.IMS_OAUTH_S2S_SCOPES)
        .split(/[,\s]+/)
        .map((x) => x.replace(/^[\s\["]+|[\s\]"']+$/g, ''))
        .filter(Boolean);
    }
  }
  return merged;
}

function getTokenFromGetDbTokenRaw(params) {
  return new Promise((resolve) => {
    const basicAuth =
      params.RUNTIME_AUTH_BASE64 ||
      process.env.RUNTIME_AUTH_BASE64 ||
      (() => {
        const h = params.__ow_headers || {};
        const a = h.authorization || h.Authorization;
        return a && typeof a === 'string' && a.startsWith('Basic ') ? a.substring(6).trim() : null;
      })() ||
      getExpectedBasicAuthBase64(params);
    const clientId =
      params.ADOBE_CLIENT_ID ||
      process.env.ADOBE_CLIENT_ID ||
      process.env.IMS_OAUTH_S2S_CLIENT_ID;
    const clientSecret =
      params.ADOBE_CLIENT_SECRET ||
      process.env.ADOBE_CLIENT_SECRET ||
      process.env.IMS_OAUTH_S2S_CLIENT_SECRET;
    if (!clientId || !clientSecret) return resolve(null);

    const runtimeApiHost = getRuntimeApiHost(params);
    const ns = getRuntimeNamespace(params);
    if (!basicAuth || !runtimeApiHost || !ns) return resolve(null);
    const paths = [
      `/api/v1/namespaces/${encodeURIComponent(ns)}/actions/tax-by-city/get-db-token?result=true&blocking=true`,
      `/api/v1/namespaces/${encodeURIComponent(ns)}/actions/get-db-token?result=true&blocking=true`
    ];
    const body = JSON.stringify({ ADOBE_CLIENT_ID: clientId, ADOBE_CLIENT_SECRET: clientSecret });

    function tryPath(i) {
      if (i >= paths.length) return resolve(null);
      const u = new URL(runtimeApiHost + paths[i]);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Basic ${basicAuth}`
          }
        },
        (res) => {
          let data = '';
          res.on('data', (c) => {
            data += c;
          });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const result = json?.response?.result || json?.result || json;
              if (result?.statusCode >= 400) return tryPath(i + 1);
              const token = result?.body?.access_token || result?.access_token;
              if (token) return resolve(token);
            } catch (_) {
              /* try next */
            }
            tryPath(i + 1);
          });
        }
      );
      req.on('error', () => tryPath(i + 1));
      req.write(body);
      req.end();
    }
    tryPath(0);
  });
}

function getNamespaceFromBasicAuth(basicAuthBase64) {
  if (!basicAuthBase64 || typeof basicAuthBase64 !== 'string') return null;
  try {
    const decoded = Buffer.from(basicAuthBase64.trim(), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    const username = colon >= 0 ? decoded.substring(0, colon).trim() : decoded.trim();
    return username || null;
  } catch (_) {
    return null;
  }
}

function looksLikeOAuthCredentialId(username) {
  if (!username || typeof username !== 'string') return false;
  const s = username.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

async function resolveAuthAndNamespace(params) {
  const auth = params.__ow_headers?.authorization || params.__ow_headers?.Authorization;
  let accessToken = null;
  let namespace =
    params.__OW_NAMESPACE ||
    process.env.__OW_NAMESPACE ||
    process.env.AIO_runtime_namespace ||
    params.__ow_headers?.['x-runtime-namespace'] ||
    params.__ow_headers?.['X-Runtime-Namespace'] ||
    '';

  if (auth && typeof auth === 'string' && auth.startsWith('Basic ')) {
    const providedBase64 = auth.slice(6).trim();
    const expectedBase64 = getExpectedBasicAuthBase64(params);
    if (!secureCompare(providedBase64, expectedBase64)) {
      return { error: { statusCode: 401, body: { status: 'Error', error: 'Unauthorized' } } };
    }
    const namespaceFromAuth = getNamespaceFromBasicAuth(providedBase64);
    if (namespaceFromAuth && !looksLikeOAuthCredentialId(namespaceFromAuth)) {
      namespace = namespaceFromAuth;
    }
    if (!namespace) {
      return {
        error: {
          statusCode: 400,
          body: {
            status: 'Error',
            message: 'Cannot resolve Runtime namespace (use namespace as Basic username or deploy __OW_NAMESPACE).'
          }
        }
      };
    }
    const ims = normalizeImsParamsForToken(params);
    let tokenErr = null;
    try {
      const tokenRes = await generateAccessToken(ims);
      accessToken = tokenRes && tokenRes.access_token;
    } catch (err) {
      tokenErr = err;
    }
    if (!accessToken) {
      accessToken = await getTokenFromGetDbTokenRaw(params);
    }
    if (!accessToken) {
      return {
        error: {
          statusCode: 502,
          body: {
            status: 'Error',
            message:
              (tokenErr && tokenErr.message) ||
              'Could not obtain IMS token (generateAccessToken) or DB token (get-db-token). Ensure ADOBE_* or IMS_OAUTH_S2S_* are set on the action / .env at deploy.',
            hint: 'Redeploy after aio app use / .env has ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, ADOBE_ORG_ID, ADOBE_SCOPE (or IMS_OAUTH_S2S_*).'
          }
        }
      };
    }
  } else if (auth && typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const userBearer = auth.replace(/^Bearer\s+/i, '').trim();
    if (!userBearer) {
      return { error: { statusCode: 401, body: { status: 'Error', error: 'Unauthorized' } } };
    }
    const hdrNs = params.__ow_headers?.['x-runtime-namespace'] || params.__ow_headers?.['X-Runtime-Namespace'];
    if (hdrNs && String(hdrNs).trim()) namespace = String(hdrNs).trim();
    if (!namespace) {
      return {
        error: {
          statusCode: 400,
          body: {
            status: 'Error',
            message:
              'Cannot resolve Runtime namespace for Bearer calls (missing __OW_NAMESPACE or x-runtime-namespace header).'
          }
        }
      };
    }
    // User IMS token is not valid for App Builder Database — use client_credentials (same as Basic path).
    const ims = normalizeImsParamsForToken(params);
    let tokenErr = null;
    try {
      const tokenRes = await generateAccessToken(ims);
      accessToken = tokenRes && tokenRes.access_token;
    } catch (err) {
      tokenErr = err;
    }
    if (!accessToken) {
      accessToken = await getTokenFromGetDbTokenRaw(params);
    }
    if (!accessToken) {
      return {
        error: {
          statusCode: 502,
          body: {
            status: 'Error',
            message:
              (tokenErr && tokenErr.message) ||
              'Could not obtain service token for App Builder Database (Bearer UI flow). Ensure ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, ADOBE_ORG_ID, ADOBE_SCOPE with adobeio.abdata.* on the action.',
            hint: 'Use ADOBE_SCOPE_EXTENDED at deploy; OAuth client must be in an Adobe product profile with App Builder Data Services.'
          }
        }
      };
    }
  } else {
    return {
      error: {
        statusCode: 401,
        body: {
          status: 'Error',
          error: 'Unauthorized',
          message: 'Send Authorization: Basic (Runtime API credentials) or Bearer (Adobe IMS token).'
        }
      }
    };
  }

  return { accessToken, namespace };
}

module.exports = {
  CORS,
  DEFAULT_REGION,
  resolveAuthAndNamespace
};
