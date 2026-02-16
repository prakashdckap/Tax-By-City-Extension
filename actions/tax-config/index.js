/**
 * Tax By City - Configuration Management
 * SaaS-Compatible: Stores enable/disable and other settings in App Builder
 */

const { Core } = require('@adobe/aio-sdk')
const { errorResponse, stringParameters, checkMissingRequestInputs } = require('../utils')

// In-memory config (for demo - in production, use Adobe I/O State SDK)
// Production: Use Adobe I/O Runtime State SDK or external config service
let configStorage = {
  tax_by_city_enabled: true,
  fallback_to_magento: true,
  cache_enabled: true,
  cache_ttl: 3600
}

/**
 * Main function for configuration operations
 */
async function main (params) {
  const logger = Core.Logger('tax-config', { level: params.LOG_LEVEL || 'info' })

  try {
    logger.info('Tax Configuration Action')
    logger.debug(stringParameters(params))

    // Health check
    if (!params.operation) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: { status: 'ok', config: configStorage }
      }
    }

    const { operation } = params
    // For web actions, Authorization may come from headers, not params
    // Only check if operation is provided
    if (!operation) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json'
        },
        body: { status: 'Error', message: 'operation is required' }
      }
    }

    logger.info(`Processing operation: ${operation}`)

    let response
    switch (operation.toUpperCase()) {
      case 'GET':
      case 'GET_CONFIG':
        response = await getConfig(logger)
        break

      case 'PUT':
      case 'UPDATE':
        if (!params.config) {
          return {
            statusCode: 400,
            body: { status: 'Error', message: 'config is required for UPDATE operation' }
          }
        }
        response = await updateConfig(params.config, logger)
        break

      case 'ENABLE':
        response = await updateConfig({ tax_by_city_enabled: true }, logger)
        break

      case 'DISABLE':
        response = await updateConfig({ tax_by_city_enabled: false }, logger)
        break

      default:
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json'
          },
          body: { status: 'Error', message: `Unsupported operation: ${operation}` }
        }
    }

    logger.info(`Operation ${operation} completed successfully`)
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json'
      },
      body: response
    }
  } catch (error) {
    logger.error(error)
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json'
      },
      body: { status: 'Error', message: error.message || 'server error' }
    }
  }
}

/**
 * Get configuration
 */
async function getConfig(logger) {
  // TODO: Replace with actual storage (Adobe I/O State SDK or external DB)
  return { ...configStorage }
}

/**
 * Update configuration
 */
async function updateConfig(newConfig, logger) {
  // TODO: Replace with actual storage (Adobe I/O State SDK or external DB)
  configStorage = {
    ...configStorage,
    ...newConfig,
    updated_at: new Date().toISOString()
  }
  return { ...configStorage }
}

// Wrap main for web actions (same pattern as create-tax-rate and update-tax-rate)
async function wrappedMain(params) {
  try {
    const result = await main(params);
    
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
    
    // Ensure body is always an object (not array or primitive)
    let body = result.body || {};
    if (Array.isArray(body) || typeof body !== 'object' || body === null) {
      body = { status: 'Success', data: body };
    }
    
    // Merge headers (Adobe I/O Runtime handles CORS automatically for web actions)
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: {
        'Content-Type': 'application/json',
        ...(result.headers || {})
      },
      body: body
    };
    
    // Ensure Content-Type is always present
    if (!finalResult.headers['Content-Type']) {
      finalResult.headers['Content-Type'] = 'application/json';
    }
    
    return finalResult;
  } catch (error) {
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

exports.main = wrappedMain

