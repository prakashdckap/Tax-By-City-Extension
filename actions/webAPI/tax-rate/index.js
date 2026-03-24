/**
 * Tax Rate (Web API) — auth/DB connection same as create-tax-rate (../lib/auth-runtime.js).
 * GET: paginated list + location lookup. POST: CREATE / UPDATE / DELETE; optional Magento sync via manage-tax.
 */

const axios = require('axios');
const dbHelper = require('./db-helper');
const { CORS, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

function manageTaxActionUrl(params) {
  const ns = params.__OW_NAMESPACE || process.env.__OW_NAMESPACE || '3676633-taxbycity-stage';
  return `https://adobeioruntime.net/api/v1/namespaces/${encodeURIComponent(ns)}/actions/tax-by-city/manage-tax?result=true&blocking=true`;
}

/** Basic auth for invoking manage-tax (same credentials as web API auth). */
function getManageTaxAuthorization(params, body) {
  const fromBody = body?.runtimeBasicAuth || params.runtimeBasicAuth;
  if (fromBody && String(fromBody).trim()) return String(fromBody).trim();
  const b64 = params.RUNTIME_AUTH_BASE64 || process.env.RUNTIME_AUTH_BASE64;
  if (b64 && String(b64).trim()) return `Basic ${String(b64).trim()}`;
  const u = (params.RUNTIME_USERNAME || process.env.RUNTIME_USERNAME || '').trim();
  const p = (params.RUNTIME_PASSWORD || process.env.RUNTIME_PASSWORD || '').trim();
  if (u && p) return `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`;
  return 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';
}

/**
 * Keys injected by Runtime / app.config into `params` (not the HTTP JSON body).
 * Merging them into `body` breaks "empty POST" detection and pollutes API payloads.
 */
const RUNTIME_INJECTED_KEYS = new Set([
  'LOG_LEVEL',
  'ADOBE_CLIENT_ID',
  'ADOBE_CLIENT_SECRET',
  'ADOBE_ORG_ID',
  'ADOBE_SCOPE',
  'ADOBE_TOKEN_URL',
  'RUNTIME_USERNAME',
  'RUNTIME_PASSWORD',
  'RUNTIME_AUTH_BASE64',
  'MAGENTO_COMMERCE_DOMAIN',
  'MAGENTO_INSTANCE_ID',
  'IMS_OAUTH_S2S_CLIENT_ID',
  'IMS_OAUTH_S2S_CLIENT_SECRET',
  'IMS_OAUTH_S2S_ORG_ID',
  'IMS_OAUTH_S2S_SCOPES'
]);

/** Strip OpenWhisk internals + deploy inputs; keep caller payload fields on `params`. */
function pickNonOwParams(params) {
  const o = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k.startsWith('__OW_') || k === 'method') continue;
    if (RUNTIME_INJECTED_KEYS.has(k)) continue;
    if (v !== undefined && v !== '') o[k] = v;
  }
  return o;
}

function parseJsonFromOwBody(raw) {
  if (raw == null) return {};
  if (Array.isArray(raw)) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  const t = s.trim();
  if (!t) return {};
  if (t.startsWith('{') || t.startsWith('[')) {
    return JSON.parse(t);
  }
  try {
    return JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
  } catch {
    return JSON.parse(s);
  }
}

/** Gateways may put the POST JSON under __ow_body, content, value, payload, or body. */
function mergeParsedBodySources(params) {
  const candidates = [
    params.__ow_body,
    params.content,
    params.value,
    params.payload,
    params.body,
    params.json,
    params.httpBody,
    params.requestBody,
    params.postData
  ];
  let merged = {};
  for (const c of candidates) {
    if (c == null) continue;
    try {
      const parsed = parseJsonFromOwBody(c);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length) {
        merged = { ...merged, ...parsed };
      }
    } catch (_) {
      /* ignore */
    }
  }
  return merged;
}

/**
 * Adobe web actions may supply JSON only in __ow_body, only merged onto `params`, or on the query string.
 * Merge so `operation`, `taxRate`, `limit`, etc. are always available (fixes LIST / DELETE without taxRate).
 */
function mergePostInputs(params) {
  const query = {};
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      for (const [k, v] of q.entries()) {
        if (v !== undefined && v !== '') query[k] = v;
      }
    } catch (_) {
      /* ignore */
    }
  }
  const fromBody = mergeParsedBodySources(params);
  const flat = pickNonOwParams(params);
  return { ...query, ...flat, ...fromBody };
}

/** Some gateways stringify nested objects (taxRate becomes a JSON string). */
function coerceJsonObject(v) {
  if (v == null) return null;
  if (typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{') && t.endsWith('}')) {
      try {
        const o = JSON.parse(t);
        return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null;
      } catch (_) {
        return null;
      }
    }
  }
  return null;
}

function isNonEmptyObject(o) {
  return o != null && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0;
}

/** Resolve tax rate document from body/params (aliases + nested + stringified JSON). */
function resolveTaxRatePayload(body, params) {
  const b = body && typeof body === 'object' ? body : {};
  const p = params && typeof params === 'object' ? params : {};
  const pick = (o, key) => {
    const v = o[key];
    const coerced = coerceJsonObject(v);
    if (isNonEmptyObject(coerced)) return coerced;
    return isNonEmptyObject(v) ? v : null;
  };
  return (
    pick(b, 'taxRate') ||
    pick(p, 'taxRate') ||
    pick(b, 'tax_rate') ||
    pick(p, 'tax_rate') ||
    (b.data && pick(b.data, 'taxRate')) ||
    (b.data && pick(b.data, 'tax_rate')) ||
    null
  );
}

function countMeaningfulKeys(body) {
  if (!body || typeof body !== 'object') return 0;
  return Object.keys(body).filter((k) => {
    if (RUNTIME_INJECTED_KEYS.has(k)) return false;
    return body[k] !== undefined && body[k] !== '';
  }).length;
}

/** POST that should run the same logic as GET (list / location lookup), not ABDB create. */
function postBodyShouldUseGetHandler(body, params) {
  if (!body || typeof body !== 'object') return false;
  if (resolveTaxRatePayload(body, params) != null) return false;
  // Magento UI: operation "POST" + commerceDomain + accessToken — never treat as list
  if (body.commerceDomain && body.accessToken) return false;
  const op = String(body.operation || '').toUpperCase();
  if (op === 'DELETE' || op === 'UPDATE' || op === 'PUT') return false;
  // Magento uses operation "POST" for Commerce create — not a list
  if (op === 'POST' || op === 'UPDATETAXRATE') return false;
  if (op === 'LIST' || op === 'LIST_RATES' || op === 'QUERY') return true;
  if (body.limit != null || body.page != null) return true;
  if (body.country && body.state && body.zipcode) return true;
  // Postman / probes: empty JSON {} or no body merged — default to list instead of taxRate error
  if (countMeaningfulKeys(body) === 0) return true;
  return false;
}

function buildMergedParamsForGetFromPost(body, params) {
  const qs = new URLSearchParams();
  const op = String(body.operation || '').toUpperCase();
  const explicitList = op === 'LIST' || op === 'LIST_RATES' || op === 'QUERY';
  const listByLimit = body.limit != null || body.page != null;
  if (explicitList || listByLimit) {
    const limit = body.limit != null ? parseInt(String(body.limit), 10) : 1000;
    const page = body.page != null ? parseInt(String(body.page), 10) : 1;
    const ln = Number.isFinite(limit) && limit > 0 ? limit : 1000;
    const pg = Number.isFinite(page) && page > 0 ? page : 1;
    qs.set('limit', String(ln));
    qs.set('page', String(pg));
  }
  if (body.country) qs.set('country', String(body.country));
  if (body.state) qs.set('state', String(body.state));
  if (body.zipcode) qs.set('zipcode', String(body.zipcode));
  if (body.city) qs.set('city', String(body.city));
  if (body.region) qs.set('region', String(body.region));
  return { ...params, __ow_query: qs.toString() };
}

/**
 * @param {Object} params - Action parameters
 * @param {{ bearerToken: string, namespace: string }} dbCtx
 */
async function handleGetRequest(params, dbCtx) {
  try {
    // Parse query parameters - can be in __ow_query (string) or directly in params
    let queryParams = {};
    
    if (params["__ow_query"]) {
      // If __ow_query is a string, parse it
      if (typeof params["__ow_query"] === 'string') {
        const urlParams = new URLSearchParams(params["__ow_query"]);
        queryParams = {};
        for (const [key, value] of urlParams.entries()) {
          queryParams[key] = value;
        }
      } else {
        // If it's already an object, use it directly
        queryParams = params["__ow_query"];
      }
    }
    
    // Also check params directly for query parameters (common in Adobe I/O Runtime)
    const limitValue = queryParams.limit || params.limit;
    const limit = limitValue ? parseInt(limitValue, 10) : null;
    const pageValue = queryParams.page || params.page;
    const page = pageValue ? parseInt(pageValue, 10) : 1;
    const country = queryParams.country || params.country;
    const state = queryParams.state || params.state;
    const zipcode = queryParams.zipcode || params.zipcode;
    const city = queryParams.city || params.city;

    // Get optional parameters for Magento sync (only needed if syncToMagento is true)
    const commerceDomain = queryParams.commerceDomain || params.commerceDomain;
    const instanceId = queryParams.instanceId || params.instanceId || queryParams.tenantId || params.tenantId;
    
    // Get access token from headers or params (optional for database-only operations)
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

    // Note: commerceDomain and accessToken are NOT required for database-only operations
    // They are only needed if syncToMagento is enabled

    // Endpoint 1: Paginated tax rates list from ABDB
    if (limit !== null) {
      try {
        const pageSize = limit || 100;
        const currentPage = page || 1;
        const skip = (currentPage - 1) * pageSize;
        
        // Build filter from query parameters
        const filter = {};
        if (country) filter.tax_country_id = country;
        if (state) filter.tax_region_id = state;
        if (zipcode) filter.tax_postcode = zipcode;
        if (city) filter.city = city;
        
        // Get region from params or use default
        const region = queryParams.region || params.region || dbHelper.DEFAULT_REGION;
        
        // Get total count
        const totalItems = await dbHelper.countTaxRates(filter, region, dbCtx);
        
        // Get paginated results
        const options = {
          limit: pageSize,
          skip: skip,
          sort: { created_at: -1 } // Most recent first
        };
        
        const items = await dbHelper.findTaxRates(filter, options, region, dbCtx);
        
        // Convert ObjectId to string for JSON response
        const paginatedItems = items.map(item => {
          const result = { ...item };
          if (result._id) {
            result._id = result._id.toString();
          }
          return result;
        });
        
        const totalPages = Math.ceil(totalItems / pageSize);

        return {
          statusCode: 200,
          headers: CORS,
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
      } catch (error) {
        console.error('Error fetching tax rates from ABDB:', error);
        return {
          statusCode: 500,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'Error fetching tax rates from database',
            error: error.message
          }
        };
      }
    }

    // Endpoint 2: Tax percentage lookup by location from ABDB
    if (country && state && zipcode) {
      try {
        // Get region from params or use default
        const region = queryParams.region || params.region || dbHelper.DEFAULT_REGION;
        
        // Try to find exact match first
        let bestMatch = await dbHelper.findTaxRateByLocation({
          country,
          state,
          zipcode,
          city
        }, region, dbCtx);
        
        // If no exact match, try without city
        if (!bestMatch && city) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country,
            state,
            zipcode
          }, region, dbCtx);
        }
        
        // If still no match, try with just country and state
        if (!bestMatch) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country,
            state
          }, region, dbCtx);
        }
        
        // If still no match, try with just country
        if (!bestMatch) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country
          }, region, dbCtx);
        }

        if (bestMatch) {
          // Convert ObjectId to string
          const taxRate = { ...bestMatch };
          if (taxRate._id) {
            taxRate._id = taxRate._id.toString();
          }
          
          return {
            statusCode: 200,
            headers: CORS,
            body: {
              status: 'Success',
              country: country,
              state: state,
              zipcode: zipcode,
              city: city || null,
              taxPercentage: parseFloat(bestMatch.rate) || 0,
              taxRate: taxRate
            }
          };
        } else {
          return {
            statusCode: 404,
            headers: CORS,
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
        console.error('Error looking up tax rate from ABDB:', error);
        return {
          statusCode: 500,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'Error looking up tax rate from database',
            error: error.message
          }
        };
      }
    }

    // Invalid GET request - missing required parameters
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Invalid GET request. Provide either:\n' +
                 '1. limit parameter for paginated tax rates list from ABDB\n' +
                 '2. country, state, and zipcode parameters for tax percentage lookup from ABDB'
      }
    };
  } catch (error) {
    console.error('Error handling GET request:', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Error processing GET request',
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

async function main(params) {
  const method = params["__ow_method"] || params.method || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  const authResult = await resolveAuthAndNamespace(params);
  if (authResult.error) {
    return {
      statusCode: authResult.error.statusCode,
      headers: CORS,
      body: authResult.error.body
    };
  }
  const dbCtx = { bearerToken: authResult.accessToken, namespace: authResult.namespace };

  if (method === 'GET') {
    return await handleGetRequest(params, dbCtx);
  }

  try {
    let body;
    try {
      body = mergePostInputs(params);
    } catch (e) {
      console.error('Error parsing POST inputs:', e);
      return {
        statusCode: 400,
        headers: CORS,
        body: {
          status: 'Error',
          message: 'Invalid JSON in request body: ' + (e.message || String(e))
        }
      };
    }

    // POST list / location lookup — same as GET (Dashboard, Sync, Settings, implicit limit/page/location)
    if (method === 'POST' && postBodyShouldUseGetHandler(body, params)) {
      let listBody = body;
      if (countMeaningfulKeys(body) === 0) {
        listBody = { operation: 'LIST', limit: 100, page: 1 };
      }
      const merged = buildMergedParamsForGetFromPost(listBody, params);
      return handleGetRequest(merged, dbCtx);
    }

    // Get operation from body/params first (allows POST with operation: 'DELETE' to work),
    // then fall back to method-based defaults
    const operation = (body?.operation || params.operation) 
                     ? (body?.operation || params.operation).toUpperCase()
                     : (method === 'POST' ? 'CREATE' : 
                        method === 'PUT' ? 'UPDATE' : 
                        method === 'DELETE' ? 'DELETE' : 'CREATE');
    
    // Get region from params or use default
    const region = body?.region || params.region || dbHelper.DEFAULT_REGION;

    // Handle DELETE operation
    if (operation === 'DELETE') {
      const taxRateId = body?.id || body?._id || params.id || params._id;
      const filter = body?.filter || params.filter;
      
      if (!taxRateId && !filter) {
        return {
          statusCode: 400,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'id or filter parameter is required for DELETE operation'
          }
        };
      }

      let deleteFilter;
      if (taxRateId) {
        deleteFilter = { _id: dbHelper.toObjectId(taxRateId) };
      } else {
        try {
          deleteFilter = typeof filter === 'string' ? JSON.parse(filter) : filter;
        } catch (e) {
          return {
            statusCode: 400,
            headers: CORS,
            body: {
              status: 'Error',
              message: 'Invalid filter format: ' + e.message
            }
          };
        }
      }

      const result = await dbHelper.deleteTaxRate(deleteFilter, region, dbCtx);
      
      return {
        statusCode: 200,
        headers: CORS,
        body: {
          status: 'Success',
          message: result.success ? 'Tax rate deleted successfully' : 'Tax rate not found',
          result: result
        }
      };
    }

    // Handle CREATE and UPDATE operations
    let taxRate = resolveTaxRatePayload(body, params);
    
    if (!taxRate) {
      return {
        statusCode: 400,
        headers: CORS,
        body: {
          status: 'Error',
          message:
            'taxRate parameter is required (object with tax_country_id, rate, etc.). ' +
            'Send JSON in the request body with key "taxRate" (or "tax_rate").'
        }
      };
    }

    // Handle CREATE operation
    if (operation === 'CREATE' || operation === 'POST') {
      // Remove _id if present (will be generated by database)
      const { _id, ...taxRateData } = taxRate;
      
      const result = await dbHelper.insertTaxRate(taxRateData, region, dbCtx);
      
      // Optionally sync to Magento if requested
      let magentoResponse = null;
      if (body?.syncToMagento !== false && params.syncToMagento !== false) {
        try {
          const commerceDomain = body?.commerceDomain || params.commerceDomain;
          const instanceId = body?.instanceId || params.instanceId || body?.tenantId || params.tenantId;
          const accessToken = body?.accessToken || params.accessToken || body?.bearerToken || params.bearerToken || body?.token || params.token;
          
          if (commerceDomain && accessToken) {
            // Filter out unsupported fields for Magento
            const unsupportedFields = ['region_code', 'city', 'zip_from', 'zip_to', 'magento_tax_rate_id', 'status', '_id', 'created_at', 'updated_at'];
            const magentoTaxRate = { ...taxRateData };
            unsupportedFields.forEach(field => {
              if (field in magentoTaxRate) {
                delete magentoTaxRate[field];
              }
            });
            
            const orgId = params["__ow_headers"]?.["x-gw-ims-org-id"] || body?.orgId || params.orgId || 'C116239B68225A790A495C96@AdobeOrg';
            const authorization = getManageTaxAuthorization(params, body);
            
            const requestData = {
              operation: 'POST',
              commerceDomain: commerceDomain,
              instanceId: instanceId,
              accessToken: accessToken,
              taxRate: magentoTaxRate
            };
            
            const config = {
              method: 'post',
              maxBodyLength: Infinity,
              url: manageTaxActionUrl(params),
              headers: { 
                'x-gw-ims-org-id': orgId, 
                'authorization': authorization,
                'Content-Type': 'application/json'
              },
              data: JSON.stringify(requestData)
            };
            
            magentoResponse = await axios.request(config);
          }
        } catch (magentoError) {
          console.error('Error syncing to Magento (non-fatal):', magentoError.message);
          // Don't fail the request if Magento sync fails
        }
      }
      
      // Convert ObjectId to string
      const document = { ...result.document };
      if (document._id) {
        document._id = document._id.toString();
      }
      
      return {
        statusCode: 200,
        headers: CORS,
        body: {
          status: 'Success',
          message: 'Tax rate created successfully',
          data: document,
          magentoSync: magentoResponse ? {
            success: true,
            response: magentoResponse.data
          } : null
        }
      };
    }

    // Handle UPDATE operation
    if (operation === 'UPDATE' || operation === 'PUT') {
      const taxRateId = body?.id || body?._id || params.id || params._id;
      const filter = body?.filter || params.filter;
      
      if (!taxRateId && !filter) {
        return {
          statusCode: 400,
          headers: CORS,
          body: {
            status: 'Error',
            message: 'id or filter parameter is required for UPDATE operation'
          }
        };
      }

      let updateFilter;
      if (taxRateId) {
        updateFilter = { _id: dbHelper.toObjectId(taxRateId) };
      } else {
        try {
          updateFilter = typeof filter === 'string' ? JSON.parse(filter) : filter;
        } catch (e) {
          return {
            statusCode: 400,
            headers: CORS,
            body: {
              status: 'Error',
              message: 'Invalid filter format: ' + e.message
            }
          };
        }
      }

      // Remove _id from update data
      const { _id, ...updateData } = taxRate;
      
      const update = { $set: updateData };
      const result = await dbHelper.updateTaxRate(updateFilter, update, region, dbCtx);
      
      if (result.success) {
        // Fetch updated document
        const updatedDoc = await dbHelper.findOneTaxRate(updateFilter, region, dbCtx);
        if (updatedDoc && updatedDoc._id) {
          updatedDoc._id = updatedDoc._id.toString();
        }
        
        return {
          statusCode: 200,
          headers: CORS,
          body: {
            status: 'Success',
            message: 'Tax rate updated successfully',
            data: updatedDoc,
            result: result
          }
        };
      } else {
        return {
          statusCode: 404,
          headers: CORS,
          body: {
            status: 'Not Found',
            message: 'Tax rate not found',
            result: result
          }
        };
      }
    }

    // Unknown operation
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: `Unsupported operation: ${operation}. Supported operations: CREATE, UPDATE, DELETE`
      }
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Error processing tax rate request',
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

exports.main = main;
