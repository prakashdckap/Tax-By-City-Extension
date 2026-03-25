/**
 * Delete tax rate (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Deletes from Magento then ABDB (legacy delete-tax-rate behavior).
 * POST body: { id | _id, region? }. No list pagination; id targets one document.
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken: aioGenerateAccessToken } = require('@adobe/aio-lib-core-auth');
const { ObjectId } = require('bson');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');
const { getMagentoScope, getMagentoTokenUrl, getTaxRatesCollection } = require('../lib/config');

const COLLECTION_NAME = getTaxRatesCollection();

/* --------------------------------------------------------------------------
 * MAGENTO (params + env, same as create-tax-rate webAPI)
 * -------------------------------------------------------------------------- */
function getMagentoConfig(params = {}) {
  const p = (k) => (params[k] != null ? params[k] : process.env[k]);
  const commerceDomain = String(p('MAGENTO_COMMERCE_DOMAIN') || p('commerceDomain') || '')
    .trim()
    .replace(/\.admin\.commerce\.adobe\.com$/i, '.api.commerce.adobe.com');
  const instanceId = p('MAGENTO_INSTANCE_ID') || p('instanceId');
  const clientId = p('ADOBE_CLIENT_ID') || p('IMS_OAUTH_S2S_CLIENT_ID');
  const clientSecret = p('ADOBE_CLIENT_SECRET') || p('IMS_OAUTH_S2S_CLIENT_SECRET');
  const orgId = p('ADOBE_ORG_ID') || p('IMS_OAUTH_S2S_ORG_ID');
  const tokenUrl = p('ADOBE_TOKEN_URL');
  const scope = p('ADOBE_SCOPE') || p('IMS_OAUTH_S2S_SCOPES');
  const accessToken = p('MAGENTO_ACCESS_TOKEN') || p('accessToken');

  if (!commerceDomain || !clientId || !clientSecret) {
    throw new Error('Missing Magento / Adobe config: set commerceDomain or MAGENTO_COMMERCE_DOMAIN, plus ADOBE_CLIENT_ID/ADOBE_CLIENT_SECRET (or IMS_OAUTH_S2S_CLIENT_ID/SECRET).');
  }

  return {
    commerceDomain,
    instanceId: instanceId || '',
    clientId,
    clientSecret,
    orgId,
    tokenUrl: tokenUrl || getMagentoTokenUrl(params),
    scope: scope || getMagentoScope(params),
    accessToken
  };
}

async function generateMagentoAccessToken(config) {
  const merged = {
    clientId: config.clientId,
    clientSecret: config.clientSecret
  };

  if (config.scope != null) {
    if (Array.isArray(config.scope)) {
      merged.scopes = config.scope;
    } else if (typeof config.scope === 'string') {
      try {
        merged.scopes = JSON.parse(config.scope);
      } catch {
        merged.scopes = config.scope.split(/[,\s]+/).filter(Boolean);
      }
    }
  }

  if (config.orgId) merged.orgId = config.orgId;
  if (merged.orgId == null && process.env.ADOBE_ORG_ID) merged.orgId = process.env.ADOBE_ORG_ID;
  if (merged.orgId == null && process.env.IMS_OAUTH_S2S_ORG_ID) merged.orgId = process.env.IMS_OAUTH_S2S_ORG_ID;

  const tokenRes = await aioGenerateAccessToken(merged);
  return tokenRes?.access_token;
}

async function getMagentoAccessToken(config) {
  try {
    const serviceToken = await generateMagentoAccessToken(config);
    if (serviceToken) return serviceToken;
  } catch (error) {
    console.warn('delete-tax-rate: service token generation failed, falling back to explicit accessToken', error?.message || error);
  }
  if (config.accessToken) return config.accessToken;
  throw new Error('Unable to obtain Magento access token');
}

async function initDbWithCtx(dbCtx, region = DEFAULT_REGION) {
  const { bearerToken, namespace } = dbCtx;
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(COLLECTION_NAME);
  return { client, collection };
}

async function deleteFromMagento(taxIdentifier, params = {}) {
  if (!taxIdentifier) {
    return { success: true, skipped: true };
  }

  const config = getMagentoConfig(params);
  const token = await getMagentoAccessToken(config);
  const url = `https://${config.commerceDomain}/${config.instanceId}/V1/taxRates/${encodeURIComponent(String(taxIdentifier))}`;

  try {
    await axios.delete(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    return { success: true, deleted: true };
  } catch (error) {
    console.error('Magento delete error:', error.response?.data || error.message);
    const magentoError = new Error(
      `Magento delete failed with status ${error.response?.status || 'unknown'}. ` +
        `Details: ${JSON.stringify(error.response?.data || error.message)}. URL: ${url}`
    );
    magentoError.statusCode = error.response?.status || 500;
    magentoError.magentoResponse = error.response?.data;
    throw magentoError;
  }
}

async function findTaxRateById(taxRateId, region, params, dbCtx) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;

    let objectId;
    try {
      objectId = new ObjectId(taxRateId);
    } catch (error) {
      throw new Error(`Invalid tax rate ID format: ${error.message}`);
    }

    const taxRate = await collection.findOne({ _id: objectId });
    return taxRate || null;
  } catch (error) {
    if (error.message && error.message.includes('Document not found')) {
      return null;
    }
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      if (error.message.includes('not found') || error.message.includes('Document not found')) {
        return null;
      }
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

async function deleteTaxRateById(taxRateId, region, params, dbCtx) {
  let client;
  try {
    const taxRate = await findTaxRateById(taxRateId, region, params, dbCtx);

    if (!taxRate) {
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found',
        magento: { success: true, skipped: true }
      };
    }

    let magentoResult = { success: true, skipped: true };
    const magentoId =
      taxRate.magento_tax_rate_id || taxRate.magento_id || taxRate.id || null;

    if (magentoId) {
      try {
        magentoResult = await deleteFromMagento(magentoId, params);
      } catch (magentoError) {
        console.error('Magento delete failed, continuing with DB delete:', magentoError.message);
        magentoResult = { success: false, error: magentoError.message };
      }
    } else if (taxRate.tax_identifier) {
      try {
        magentoResult = await deleteFromMagento(taxRate.tax_identifier, params);
      } catch (magentoError) {
        console.error('Magento delete failed (tax_identifier), continuing with DB delete:', magentoError.message);
        magentoResult = { success: false, error: magentoError.message };
      }
    }

    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region);
    client = dbClient;

    let objectId;
    try {
      objectId = new ObjectId(taxRateId);
    } catch (error) {
      throw new Error(`Invalid tax rate ID format: ${error.message}`);
    }

    const result = await collection.deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found in database',
        magento: magentoResult
      };
    }

    return {
      success: true,
      deletedCount: result.deletedCount,
      magento: magentoResult
    };
  } catch (error) {
    if (error.message && (error.message.includes('not found') || error.message.includes('Document not found'))) {
      return {
        success: false,
        deletedCount: 0,
        message: 'Tax rate not found',
        magento: { success: true, skipped: true }
      };
    }
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

function parseDeleteBody(params) {
  let body = null;

  if (params.id || params._id) {
    body = { id: params.id || params._id, region: params.region || DEFAULT_REGION };
  } else if (params.__ow_body) {
    const bodyData = params.__ow_body;
    if (typeof bodyData === 'object' && !Array.isArray(bodyData)) {
      body = bodyData;
    } else if (typeof bodyData === 'string') {
      try {
        body = JSON.parse(Buffer.from(bodyData, 'base64').toString('utf8'));
      } catch {
        try {
          body = JSON.parse(bodyData);
        } catch (e2) {
          throw new Error('Invalid JSON in request body: ' + e2.message);
        }
      }
    }
  }

  return body;
}

async function runDeleteFlow(params, dbCtx) {
  const body = parseDeleteBody(params);
  const mergedParams = { ...params, ...body };

  let taxRateId = body?.id || body?._id || params.id || params._id;
  let region = body?.region || params.region || DEFAULT_REGION;

  if (params.__ow_query && typeof params.__ow_query === 'string') {
    const q = new URLSearchParams(params.__ow_query);
    if (q.has('id')) taxRateId = taxRateId || q.get('id');
    if (q.has('_id')) taxRateId = taxRateId || q.get('_id');
    if (q.has('region')) region = q.get('region') || region;
  }

  if (!taxRateId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'id or _id parameter is required'
      }
    };
  }

  const result = await deleteTaxRateById(taxRateId, region, mergedParams, dbCtx);

  if (result.success) {
    return {
      statusCode: 200,
      headers: CORS,
      body: {
        status: 'Success',
        message: 'Tax rate deleted successfully from database and Magento',
        deletedCount: result.deletedCount,
        magento: result.magento
      }
    };
  }

  return {
    statusCode: 404,
    headers: CORS,
    body: {
      status: 'Error',
      message: result.message || 'Tax rate not found',
      deletedCount: result.deletedCount
    }
  };
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Method not allowed. Use POST.' }
    };
  }

  const authResult = await resolveAuthAndNamespace(params);
  if (authResult.error) {
    const e = authResult.error;
    return {
      statusCode: e.statusCode,
      headers: { ...CORS, ...(e.statusCode === 401 ? { 'WWW-Authenticate': 'Basic realm="Tax API"' } : {}) },
      body: e.body
    };
  }

  const dbCtx = { bearerToken: authResult.accessToken, namespace: authResult.namespace };

  try {
    return await runDeleteFlow(params, dbCtx);
  } catch (error) {
    console.error('delete-tax-rate (webAPI):', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Error deleting tax rate',
        error: error.message
      }
    };
  }
}

exports.main = main;
