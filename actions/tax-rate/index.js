/**
 * Tax Rate Action - App Builder Database Storage Integration
 * Handles CRUD operations for tax rates using ABDB
 * Also supports optional Magento sync
 * GET endpoints:
 * 1. Paginated tax rates list from ABDB
 * 2. Tax percentage lookup by location from ABDB
 * POST/PUT/DELETE endpoints:
 * 3. Create/Update/Delete tax rates in ABDB
 */

const axios = require('axios');
const dbHelper = require('./db-helper');

/**
 * Handle GET requests for tax rate endpoints
 * @param {Object} params - Action parameters
 * @returns {Promise<Object>} Response object
 */
async function handleGetRequest(params) {
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
        const totalItems = await dbHelper.countTaxRates(filter, region, params);
        
        // Get paginated results
        const options = {
          limit: pageSize,
          skip: skip,
          sort: { created_at: -1 } // Most recent first
        };
        
        const items = await dbHelper.findTaxRates(filter, options, region, params);
        
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
          headers: {
            'Content-Type': 'application/json'
          },
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
          headers: {
            'Content-Type': 'application/json'
          },
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
        }, region, params);
        
        // If no exact match, try without city
        if (!bestMatch && city) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country,
            state,
            zipcode
          }, region, params);
        }
        
        // If still no match, try with just country and state
        if (!bestMatch) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country,
            state
          }, region, params);
        }
        
        // If still no match, try with just country
        if (!bestMatch) {
          bestMatch = await dbHelper.findTaxRateByLocation({
            country
          }, region, params);
        }

        if (bestMatch) {
          // Convert ObjectId to string
          const taxRate = { ...bestMatch };
          if (taxRate._id) {
            taxRate._id = taxRate._id.toString();
          }
          
          return {
            statusCode: 200,
            headers: {
              
              'Content-Type': 'application/json'
            },
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
            headers: {
              
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
        console.error('Error looking up tax rate from ABDB:', error);
        return {
          statusCode: 500,
          headers: {
            'Content-Type': 'application/json'
          },
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
      headers: {
        
        'Content-Type': 'application/json'
      },
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
      headers: {
        
        'Content-Type': 'application/json'
      },
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
  // Handle OPTIONS preflight request for CORS
  const method = params["__ow_method"] || params.method || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  // Handle GET requests
  if (method === 'GET') {
    return await handleGetRequest(params);
  }

  try {
    // Parse request body if it exists
    let body = null;
    if (params["__ow_body"]) {
      try {
        // Try base64 decode first (common in Adobe I/O Runtime)
        try {
          body = JSON.parse(Buffer.from(params["__ow_body"], 'base64').toString());
        } catch (e1) {
          // If not base64, try parsing directly
          body = typeof params["__ow_body"] === 'string' 
            ? JSON.parse(params["__ow_body"]) 
            : params["__ow_body"];
        }
      } catch (e) {
        console.error('Error parsing body:', e);
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: {
            status: 'Error',
            message: 'Invalid JSON in request body: ' + e.message
          }
        };
      }
    } else if (params.operation || params.id || params._id || params.taxRate) {
      // Body might be passed directly in params (when calling action directly)
      body = params;
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
          headers: {
            'Content-Type': 'application/json'
          },
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
            headers: {
              
              'Content-Type': 'application/json'
            },
            body: {
              status: 'Error',
              message: 'Invalid filter format: ' + e.message
            }
          };
        }
      }

      const result = await dbHelper.deleteTaxRate(deleteFilter, region, params);
      
      return {
        statusCode: 200,
        headers: {
          
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Success',
          message: result.success ? 'Tax rate deleted successfully' : 'Tax rate not found',
          result: result
        }
      };
    }

    // Handle CREATE and UPDATE operations
    let taxRate = body?.taxRate || params.taxRate;
    
    if (!taxRate) {
      return {
        statusCode: 400,
        headers: {
          
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'taxRate parameter is required'
        }
      };
    }

    // Handle CREATE operation
    if (operation === 'CREATE' || operation === 'POST') {
      // Remove _id if present (will be generated by database)
      const { _id, ...taxRateData } = taxRate;
      
      const result = await dbHelper.insertTaxRate(taxRateData, region, params);
      
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
            const basicAuth = params.runtimeBasicAuth || body?.runtimeBasicAuth || 
                             'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';
            
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
              url: 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/manage-tax?result=true&blocking=true',
              headers: { 
                'x-gw-ims-org-id': orgId, 
                'authorization': basicAuth,
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
        headers: {
          
          'Content-Type': 'application/json'
        },
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
          headers: {
            'Content-Type': 'application/json'
          },
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
            headers: {
              
              'Content-Type': 'application/json'
            },
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
      const result = await dbHelper.updateTaxRate(updateFilter, update, region, params);
      
      if (result.success) {
        // Fetch updated document
        const updatedDoc = await dbHelper.findOneTaxRate(updateFilter, region, params);
        if (updatedDoc && updatedDoc._id) {
          updatedDoc._id = updatedDoc._id.toString();
        }
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json'
          },
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
          headers: {
            'Content-Type': 'application/json'
          },
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
      headers: {
        
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: `Unsupported operation: ${operation}. Supported operations: CREATE, UPDATE, DELETE`
      }
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers: {
        
        'Content-Type': 'application/json'
      },
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
