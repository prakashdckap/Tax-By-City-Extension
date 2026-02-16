/**
 * Calculate Tax Rate Action
 * Implements Magento tax calculation logic with city-level extension
 * 
 * Calculation Logic & Priority:
 * - Priority -> ascending
 * - Tax_calculation Rule -> ascending
 * - Country_ID -> descending
 * - Tax ID -> descending
 * - Postcode -> descending
 * - Value -> descending
 * 
 * Supports:
 * - Tax by City (enabled/disabled)
 * - City for Zipcode Range (enabled/disabled)
 * - Zipcode range matching with descending logic
 * - Compounded tax rates from multiple rules
 * - Duplicate tax rates (uses highest rate)
 */

const libDb = require('@adobe/aio-lib-db');
const { ObjectId } = require('bson');

const COLLECTION_NAME = 'tax_rates';
const DEFAULT_REGION = 'amer';

/**
 * Initialize database connection
 */
async function initDb(region = DEFAULT_REGION) {
  try {
    const db = await libDb.init({ region });
    const client = await db.connect();
    const collection = client.collection(COLLECTION_NAME);
    return { client, collection };
  } catch (error) {
    if (error && (error.name === 'DbError' || (error.message && error.message.includes('Database')))) {
      throw new Error(`Database error: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parse zipcode range (e.g., "90001-90006" or "90001-90005")
 * Returns { from, to } or null if not a range
 */
function parseZipcodeRange(zipcode) {
  if (!zipcode || zipcode === '*') return null;
  
  const rangeMatch = zipcode.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    return {
      from: parseInt(rangeMatch[1], 10),
      to: parseInt(rangeMatch[2], 10)
    };
  }
  
  return null;
}

/**
 * Check if a zipcode falls within a range
 */
function zipcodeInRange(zipcode, range) {
  if (!range) return false;
  const zip = parseInt(zipcode, 10);
  return zip >= range.from && zip <= range.to;
}

/**
 * Check if zipcode matches (exact match or range match)
 * Zipcode ranges are always checked, regardless of city configuration
 */
function zipcodeMatches(customerZipcode, taxRateZipcode) {
  if (!customerZipcode || !taxRateZipcode) return false;
  
  // Exact match
  if (customerZipcode === taxRateZipcode) return true;
  
  // Wildcard match
  if (taxRateZipcode === '*') return true;
  
  // Range match (always check ranges)
  const range = parseZipcodeRange(taxRateZipcode);
  if (range && zipcodeInRange(customerZipcode, range)) {
    return true;
  }
  
  return false;
}

/**
 * Get zipcode sort value for descending sort
 * For ranges, uses the "to" value (highest zipcode in range)
 * For exact matches, uses the zipcode value
 * For wildcards, uses 0
 */
function getZipcodeSortValue(zipcode) {
  if (!zipcode || zipcode === '*') return 0;
  
  const range = parseZipcodeRange(zipcode);
  if (range) {
    return range.to; // Use highest zipcode in range for descending sort
  }
  
  return parseInt(zipcode, 10) || 0;
}

/**
 * Check if zipcode is an exact match (not a range or wildcard)
 */
function isExactZipcodeMatch(customerZipcode, taxRateZipcode) {
  if (!customerZipcode || !taxRateZipcode) return false;
  return customerZipcode === taxRateZipcode && taxRateZipcode !== '*';
}

/**
 * Find all matching tax rates based on location and configuration
 */
async function findMatchingTaxRates(location, config, region) {
  const { country, state, zipcode, city } = location;
  const { taxByCity, enableCityForZipcodeRange } = config;
  
  let client;
  try {
    const { client: dbClient, collection } = await initDb(region);
    client = dbClient;
    
    // Build base filter
    const filter = {
      tax_country_id: country,
      status: { $ne: false } // Only active rates
    };
    
    // State/Region filter
    if (state) {
      filter.tax_region_id = state;
    }
    
    // Get all potential matches (we'll filter by zipcode and city in code)
    const allRates = await collection.find(filter).toArray();
    
    // Filter by zipcode and city matching
    const exactMatches = [];
    const rangeMatches = [];
    const wildcardMatches = [];
    
    for (const rate of allRates) {
      const rateZipcode = rate.tax_postcode || rate.postcode || '*';
      const rateCity = rate.city || null;
      
      // Check zipcode match type
      let zipcodeMatchType = null;
      if (isExactZipcodeMatch(zipcode, rateZipcode)) {
        zipcodeMatchType = 'exact';
      } else if (zipcodeMatches(zipcode, rateZipcode)) {
        if (rateZipcode === '*') {
          zipcodeMatchType = 'wildcard';
        } else {
          zipcodeMatchType = 'range';
        }
      }
      
      if (!zipcodeMatchType) continue;
      
      // Check city match based on configuration
      if (taxByCity) {
        // If "Tax by City" is enabled, city must match exactly
        // If city is provided, rate must have matching city
        if (city) {
          if (!rateCity || city !== rateCity) {
            continue; // City doesn't match, skip this rate
          }
        } else {
          // If city is not provided but tax by city is enabled, 
          // only match rates without city specified
          if (rateCity) {
            continue; // Rate has city but customer doesn't, skip
          }
        }
      } else {
        // If "Tax by City" is disabled, ignore city matching
        // Magento will revert to default behavior (Country → State → Zipcode)
      }
      
      // Categorize by match type for prioritization
      if (zipcodeMatchType === 'exact') {
        exactMatches.push(rate);
      } else if (zipcodeMatchType === 'range') {
        rangeMatches.push(rate);
      } else {
        wildcardMatches.push(rate);
      }
    }
    
    // Prioritize: exact matches > range matches > wildcard matches
    // If exact matches exist, only return those (per Use Case #1 Case 2)
    if (exactMatches.length > 0) {
      return exactMatches;
    }
    
    // Otherwise, return range matches and wildcard matches
    return [...rangeMatches, ...wildcardMatches];
  } catch (error) {
    throw error;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Sort tax rates according to Magento priority logic
 * Priority -> ascending
 * Tax_calculation Rule -> ascending (rule_id or tax_rule_id)
 * Country_ID -> descending
 * Tax ID -> descending (tax_identifier or code)
 * Postcode -> descending
 * Value -> descending (rate)
 */
function sortTaxRatesByPriority(rates) {
  return rates.sort((a, b) => {
    // Priority -> ascending (lower priority number = higher priority)
    const priorityA = a.priority !== undefined ? a.priority : 0;
    const priorityB = b.priority !== undefined ? b.priority : 0;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    // Tax_calculation Rule -> ascending (rule_id)
    const ruleIdA = a.rule_id || a.tax_rule_id || 0;
    const ruleIdB = b.rule_id || b.tax_rule_id || 0;
    if (ruleIdA !== ruleIdB) {
      return ruleIdA - ruleIdB;
    }
    
    // Country_ID -> descending
    const countryA = a.tax_country_id || '';
    const countryB = b.tax_country_id || '';
    if (countryA !== countryB) {
      return countryB.localeCompare(countryA);
    }
    
    // Tax ID -> descending (tax_identifier or code)
    const taxIdA = a.tax_identifier || a.code || '';
    const taxIdB = b.tax_identifier || b.code || '';
    if (taxIdA !== taxIdB) {
      return taxIdB.localeCompare(taxIdA);
    }
    
    // Postcode -> descending
    const zipcodeA = getZipcodeSortValue(a.tax_postcode || a.postcode);
    const zipcodeB = getZipcodeSortValue(b.tax_postcode || b.postcode);
    if (zipcodeA !== zipcodeB) {
      return zipcodeB - zipcodeA;
    }
    
    // Value -> descending (rate)
    const rateA = parseFloat(a.rate) || 0;
    const rateB = parseFloat(b.rate) || 0;
    return rateB - rateA;
  });
}


/**
 * Calculate final tax rate from matching rates
 * Handles compounded rates from multiple rules with same priority
 * Handles duplicate rates (uses highest rate)
 */
function calculateFinalTaxRate(rates, location, config) {
  if (rates.length === 0) {
    return {
      taxPercentage: 0,
      appliedRates: [],
      calculationMethod: 'no_match'
    };
  }
  
  // Sort by priority
  const sortedRates = sortTaxRatesByPriority(rates);
  
  // Process duplicates within same rule (use highest rate)
  // Group by rule_id and tax_identifier, keep only highest rate
  const deduplicatedRates = [];
  const rateMap = new Map();
  
  for (const rate of sortedRates) {
    const ruleId = rate.rule_id || rate.tax_rule_id || 'default';
    const taxId = rate.tax_identifier || rate.code || rate._id?.toString() || '';
    const key = `${ruleId}_${taxId}`;
    
    if (!rateMap.has(key)) {
      rateMap.set(key, rate);
    } else {
      // Compare rates, keep the one with higher rate value
      const existingRate = rateMap.get(key);
      const existingValue = parseFloat(existingRate.rate) || 0;
      const currentValue = parseFloat(rate.rate) || 0;
      
      if (currentValue > existingValue) {
        rateMap.set(key, rate);
      }
    }
  }
  
  deduplicatedRates.push(...Array.from(rateMap.values()));
  
  // Group by priority to check for compounding
  const priorityGroups = new Map();
  for (const rate of deduplicatedRates) {
    const priority = rate.priority !== undefined ? rate.priority : 0;
    if (!priorityGroups.has(priority)) {
      priorityGroups.set(priority, []);
    }
    priorityGroups.get(priority).push(rate);
  }
  
  // Calculate compounded tax
  // If same tax_identifier appears in multiple rules with same priority, compound them
  let totalTax = 0;
  const appliedRates = [];
  
  // Process each priority group
  const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);
  
  for (const priority of sortedPriorities) {
    const ratesInPriority = priorityGroups.get(priority);
    
    // Group by tax_identifier within this priority
    const taxIdGroups = new Map();
    for (const rate of ratesInPriority) {
      const taxId = rate.tax_identifier || rate.code || rate._id?.toString() || '';
      if (!taxIdGroups.has(taxId)) {
        taxIdGroups.set(taxId, []);
      }
      taxIdGroups.get(taxId).push(rate);
    }
    
    // For each tax identifier in this priority
    for (const [taxId, taxRates] of taxIdGroups.entries()) {
      // If same tax_id appears in multiple rules with same priority, compound them
      if (taxRates.length > 1) {
        // Multiple rules with same tax_id and priority - compound all
        for (const rate of taxRates) {
          const rateValue = parseFloat(rate.rate) || 0;
          totalTax += rateValue;
          appliedRates.push({
            rate: rateValue,
            rule_id: rate.rule_id || rate.tax_rule_id || null,
            tax_identifier: taxId,
            priority: priority,
            compounded: true,
            rule_count: taxRates.length
          });
        }
      } else {
        // Single rate for this tax_id in this priority
        const rate = taxRates[0];
        const rateValue = parseFloat(rate.rate) || 0;
        totalTax += rateValue;
        appliedRates.push({
          rate: rateValue,
          rule_id: rate.rule_id || rate.tax_rule_id || null,
          tax_identifier: taxId,
          priority: priority,
          compounded: false
        });
      }
    }
  }
  
  return {
    taxPercentage: totalTax,
    appliedRates: appliedRates,
    calculationMethod: appliedRates.some(r => r.compounded) ? 'compounded' : 'single',
    matchingRatesCount: rates.length,
    processedRatesCount: deduplicatedRates.length
  };
}

/**
 * Main calculation function
 */
async function calculateTaxRate(location, config, region) {
  const { country, state, zipcode, city } = location;
  const { taxByCity = false, enableCityForZipcodeRange = false } = config;
  
  // Find all matching tax rates
  const matchingRates = await findMatchingTaxRates(location, config, region);
  
  if (matchingRates.length === 0) {
    return {
      taxPercentage: 0,
      appliedRates: [],
      calculationMethod: 'no_match',
      location: location,
      config: config
    };
  }
  
  // Calculate final tax rate
  const result = calculateFinalTaxRate(matchingRates, location, config);
  
  return {
    ...result,
    location: location,
    config: config,
    matchingRates: matchingRates.map(rate => ({
      _id: rate._id?.toString(),
      rate: parseFloat(rate.rate) || 0,
      tax_country_id: rate.tax_country_id,
      tax_region_id: rate.tax_region_id,
      tax_postcode: rate.tax_postcode || rate.postcode,
      city: rate.city,
      tax_identifier: rate.tax_identifier || rate.code,
      rule_id: rate.rule_id || rate.tax_rule_id,
      priority: rate.priority
    }))
  };
}

/**
 * Main handler
 */
async function main(params) {
  // Handle OPTIONS preflight request for CORS
  const method = params["__ow_method"] || params.method || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    // Parse request body if present
    let body = null;
    if (params["__ow_body"]) {
      try {
        // Try base64 decode first (common in Adobe I/O Runtime)
        try {
          body = JSON.parse(Buffer.from(params["__ow_body"], 'base64').toString());
          console.log('Parsed body from base64');
        } catch (e1) {
          // If not base64, try parsing directly
          body = typeof params["__ow_body"] === 'string' 
            ? JSON.parse(params["__ow_body"]) 
            : params["__ow_body"];
          console.log('Parsed body directly');
        }
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
    } else if (params.country || params.location || params.config) {
      body = params;
      console.log('Using params directly as body');
    } else {
      console.log('No body found, params keys:', Object.keys(params));
    }

    // Extract parameters - check body first, then params directly
    const location = body?.location || (body && (body.country || body.state || body.zipcode) ? {
      country: body.country,
      state: body.state,
      zipcode: body.zipcode,
      city: body.city || null
    } : {
      country: params.country,
      state: params.state,
      zipcode: params.zipcode,
      city: params.city || null
    });

    const config = body?.config || {
      taxByCity: body?.taxByCity !== undefined 
        ? body.taxByCity 
        : (params.taxByCity !== undefined 
          ? (params.taxByCity === 'true' || params.taxByCity === true)
          : false),
      enableCityForZipcodeRange: body?.enableCityForZipcodeRange !== undefined 
        ? body.enableCityForZipcodeRange 
        : (params.enableCityForZipcodeRange !== undefined
          ? (params.enableCityForZipcodeRange === 'true' || params.enableCityForZipcodeRange === true)
          : false)
    };

    const region = body?.region || params.region || DEFAULT_REGION;

    // Validate required parameters
    if (!location.country) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'country parameter is required'
        }
      };
    }

    if (!location.state) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'state parameter is required'
        }
      };
    }

    if (!location.zipcode) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        },
        body: {
          status: 'Error',
          message: 'zipcode parameter is required'
        }
      };
    }

    // Calculate tax rate
    const result = await calculateTaxRate(location, config, region);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Success',
        ...result
      }
    };
  } catch (error) {
    console.error('Error calculating tax rate:', error);
    console.error('Error stack:', error.stack);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: {
        status: 'Error',
        message: 'Error calculating tax rate',
        error: error.message,
        stack: process.env.LOG_LEVEL === 'debug' ? error.stack : undefined
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
    const finalResult = {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: {
        'Content-Type': 'application/json',
        ...(result.headers || {})
      },
      body: result.body || {}
    };
    
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
        message: error.message || 'Internal server error',
        error: process.env.LOG_LEVEL === 'debug' ? error.stack : undefined
      }
    };
  }
}

exports.main = wrappedMain;
