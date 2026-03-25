/**
 * Calculate tax rate (Web API) — auth via actions/webAPI/lib/auth-runtime.js (same as create-tax-rate).
 * Business logic matches actions/calculate-tax-rate (Magento-style matching, sorting, compounding).
 */

const https = require('https');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');
const { getDbServiceUrlTemplate, getTaxRatesCollection } = require('../lib/config');

const COLLECTION_NAME = getTaxRatesCollection();
const DB_SERVICE_URL_TEMPLATE = getDbServiceUrlTemplate();

function dbFindWithBearerToken(namespace, region, bearerToken, collectionName, filter, options) {
  const baseUrl = DB_SERVICE_URL_TEMPLATE.replace(/<region>/gi, (region || DEFAULT_REGION).toLowerCase());
  const path = `/v1/collection/${encodeURIComponent(collectionName)}/find`;
  const body = JSON.stringify({ filter: filter || {}, options: options || {} });
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl);
    const req = https.request(
      {
        hostname: u.hostname,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${bearerToken}`,
          'x-runtime-namespace': namespace
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
            if (res.statusCode >= 400) {
              reject(new Error(json.message || data || `HTTP ${res.statusCode}`));
              return;
            }
            if (json.success && json.data !== undefined) resolve(json.data);
            else reject(new Error(json.message || 'Invalid DB response'));
          } catch (e) {
            reject(new Error(data || e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

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

function zipcodeInRange(zipcode, range) {
  if (!range) return false;
  const zip = parseInt(zipcode, 10);
  return zip >= range.from && zip <= range.to;
}

function zipcodeMatches(customerZipcode, taxRateZipcode) {
  if (!customerZipcode || !taxRateZipcode) return false;
  if (customerZipcode === taxRateZipcode) return true;
  if (taxRateZipcode === '*') return true;
  const range = parseZipcodeRange(taxRateZipcode);
  if (range && zipcodeInRange(customerZipcode, range)) return true;
  return false;
}

function getZipcodeSortValue(zipcode) {
  if (!zipcode || zipcode === '*') return 0;
  const range = parseZipcodeRange(zipcode);
  if (range) return range.to;
  return parseInt(zipcode, 10) || 0;
}

function isExactZipcodeMatch(customerZipcode, taxRateZipcode) {
  if (!customerZipcode || !taxRateZipcode) return false;
  return customerZipcode === taxRateZipcode && taxRateZipcode !== '*';
}

async function findMatchingTaxRates(location, config, region, params, dbCtx) {
  const { country, state, zipcode, city } = location;
  const { taxByCity } = config;
  const { bearerToken, namespace } = dbCtx;
  if (!bearerToken || !namespace) {
    throw new Error('Database token or namespace unavailable.');
  }

  const filter = {
    tax_country_id: country,
    status: { $ne: false }
  };
  if (state) filter.tax_region_id = state;

  const raw = await dbFindWithBearerToken(namespace, region, bearerToken, COLLECTION_NAME, filter, { limit: 500 });
  const allRates = Array.isArray(raw) ? raw : raw?.cursor?.firstBatch || raw?.documents || [];

  const exactMatches = [];
  const rangeMatches = [];
  const wildcardMatches = [];

  for (const rate of allRates) {
    const rateZipcode = rate.tax_postcode || rate.postcode || '*';
    const rateCity = rate.city || null;

    let zipcodeMatchType = null;
    if (isExactZipcodeMatch(zipcode, rateZipcode)) {
      zipcodeMatchType = 'exact';
    } else if (zipcodeMatches(zipcode, rateZipcode)) {
      zipcodeMatchType = rateZipcode === '*' ? 'wildcard' : 'range';
    }
    if (!zipcodeMatchType) continue;

    if (taxByCity) {
      if (city) {
        if (!rateCity || city !== rateCity) continue;
      } else if (rateCity) continue;
    }

    if (zipcodeMatchType === 'exact') exactMatches.push(rate);
    else if (zipcodeMatchType === 'range') rangeMatches.push(rate);
    else wildcardMatches.push(rate);
  }

  if (exactMatches.length > 0) return exactMatches;
  return [...rangeMatches, ...wildcardMatches];
}

function sortTaxRatesByPriority(rates) {
  return rates.sort((a, b) => {
    const priorityA = a.priority !== undefined ? a.priority : 0;
    const priorityB = b.priority !== undefined ? b.priority : 0;
    if (priorityA !== priorityB) return priorityA - priorityB;

    const ruleIdA = a.rule_id || a.tax_rule_id || 0;
    const ruleIdB = b.rule_id || b.tax_rule_id || 0;
    if (ruleIdA !== ruleIdB) return ruleIdA - ruleIdB;

    const countryA = a.tax_country_id || '';
    const countryB = b.tax_country_id || '';
    if (countryA !== countryB) return countryB.localeCompare(countryA);

    const taxIdA = a.tax_identifier || a.code || '';
    const taxIdB = b.tax_identifier || b.code || '';
    if (taxIdA !== taxIdB) return taxIdB.localeCompare(taxIdA);

    const zipcodeA = getZipcodeSortValue(a.tax_postcode || a.postcode);
    const zipcodeB = getZipcodeSortValue(b.tax_postcode || b.postcode);
    if (zipcodeA !== zipcodeB) return zipcodeB - zipcodeA;

    const rateA = parseFloat(a.rate) || 0;
    const rateB = parseFloat(b.rate) || 0;
    return rateB - rateA;
  });
}

function calculateFinalTaxRate(rates, location, config) {
  if (rates.length === 0) {
    return {
      taxPercentage: 0,
      appliedRates: [],
      calculationMethod: 'no_match'
    };
  }

  const sortedRates = sortTaxRatesByPriority(rates);
  const deduplicatedRates = [];
  const rateMap = new Map();

  for (const rate of sortedRates) {
    const ruleId = rate.rule_id || rate.tax_rule_id || 'default';
    const taxId = rate.tax_identifier || rate.code || rate._id?.toString() || '';
    const key = `${ruleId}_${taxId}`;

    if (!rateMap.has(key)) {
      rateMap.set(key, rate);
    } else {
      const existingRate = rateMap.get(key);
      const existingValue = parseFloat(existingRate.rate) || 0;
      const currentValue = parseFloat(rate.rate) || 0;
      if (currentValue > existingValue) rateMap.set(key, rate);
    }
  }

  deduplicatedRates.push(...Array.from(rateMap.values()));

  const priorityGroups = new Map();
  for (const rate of deduplicatedRates) {
    const priority = rate.priority !== undefined ? rate.priority : 0;
    if (!priorityGroups.has(priority)) priorityGroups.set(priority, []);
    priorityGroups.get(priority).push(rate);
  }

  let totalTax = 0;
  const appliedRates = [];
  const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const ratesInPriority = priorityGroups.get(priority);
    const taxIdGroups = new Map();
    for (const rate of ratesInPriority) {
      const taxId = rate.tax_identifier || rate.code || rate._id?.toString() || '';
      if (!taxIdGroups.has(taxId)) taxIdGroups.set(taxId, []);
      taxIdGroups.get(taxId).push(rate);
    }

    for (const [, taxRates] of taxIdGroups.entries()) {
      if (taxRates.length > 1) {
        for (const rate of taxRates) {
          const rateValue = parseFloat(rate.rate) || 0;
          totalTax += rateValue;
          appliedRates.push({
            rate: rateValue,
            rule_id: rate.rule_id || rate.tax_rule_id || null,
            tax_identifier: rate.tax_identifier || rate.code || '',
            priority,
            compounded: true,
            rule_count: taxRates.length
          });
        }
      } else {
        const rate = taxRates[0];
        const rateValue = parseFloat(rate.rate) || 0;
        totalTax += rateValue;
        appliedRates.push({
          rate: rateValue,
          rule_id: rate.rule_id || rate.tax_rule_id || null,
          tax_identifier: rate.tax_identifier || rate.code || '',
          priority,
          compounded: false
        });
      }
    }
  }

  return {
    taxPercentage: totalTax,
    appliedRates,
    calculationMethod: appliedRates.some((r) => r.compounded) ? 'compounded' : 'single',
    matchingRatesCount: rates.length,
    processedRatesCount: deduplicatedRates.length
  };
}

async function calculateTaxRate(location, config, region, params, dbCtx) {
  const matchingRates = await findMatchingTaxRates(location, config, region, params, dbCtx);

  if (matchingRates.length === 0) {
    return {
      taxPercentage: 0,
      appliedRates: [],
      calculationMethod: 'no_match',
      location,
      config
    };
  }

  const result = calculateFinalTaxRate(matchingRates, location, config);

  return {
    ...result,
    location,
    config,
    matchingRates: matchingRates.map((rate) => ({
      _id:
        rate._id && rate._id.$oid
          ? rate._id.$oid
          : rate._id?.toString
            ? rate._id.toString()
            : rate._id != null
              ? String(rate._id)
              : undefined,
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
 * Build request payload from __ow_body, GET query, and top-level params (same fields as legacy calculate-tax-rate).
 */
function extractLocationAndConfig(params) {
  let body = null;
  if (params.__ow_body) {
    try {
      try {
        body = JSON.parse(Buffer.from(params.__ow_body, 'base64').toString());
      } catch {
        body = typeof params.__ow_body === 'string' ? JSON.parse(params.__ow_body) : params.__ow_body;
      }
    } catch (e) {
      throw new Error(`Invalid JSON in request body: ${e.message}`);
    }
  } else if (params.country || params.location || params.config) {
    body = params;
  }

  const method = String(params.__ow_method || params.method || 'POST').toUpperCase();
  if (method === 'GET' && params.__ow_query) {
    const q = {};
    try {
      const sp = typeof params.__ow_query === 'string' ? new URLSearchParams(params.__ow_query) : null;
      if (sp) for (const [k, v] of sp.entries()) if (v !== '') q[k] = v;
    } catch (e) {
      console.warn('Error parsing __ow_query:', e);
    }
    body = { ...(body && typeof body === 'object' ? body : {}), ...q };
  }

  if (!body || typeof body !== 'object') body = {};

  const location =
    body.location ||
    (body && (body.country || body.state || body.zipcode)
      ? {
          country: body.country,
          state: body.state,
          zipcode: body.zipcode,
          city: body.city || null
        }
      : {
          country: params.country,
          state: params.state,
          zipcode: params.zipcode,
          city: params.city || null
        });

  if (!location || !location.country) {
    throw new Error('Missing location: provide country, state, zipcode (and optional city) in body, query, or params.');
  }

  const config =
    body.config || {
      taxByCity:
        body.taxByCity !== undefined
          ? body.taxByCity === true || body.taxByCity === 'true'
          : params.taxByCity !== undefined
            ? params.taxByCity === true || params.taxByCity === 'true'
            : false,
      enableCityForZipcodeRange:
        body.enableCityForZipcodeRange !== undefined
          ? body.enableCityForZipcodeRange === true || body.enableCityForZipcodeRange === 'true'
          : params.enableCityForZipcodeRange !== undefined
            ? params.enableCityForZipcodeRange === true || params.enableCityForZipcodeRange === 'true'
            : false
    };

  const region = body.region || params.region || DEFAULT_REGION;

  return { location, config, region };
}

async function main(params) {
  const method = params.__ow_method || params.method || 'POST';
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  try {
    if (String(method).toUpperCase() !== 'GET' && String(method).toUpperCase() !== 'POST') {
      return {
        statusCode: 405,
        headers: CORS,
        body: { status: 'Error', message: 'Method not allowed. Use GET or POST.' }
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
    const { accessToken, namespace } = authResult;
    const dbCtx = { bearerToken: accessToken, namespace };

    let location;
    let config;
    let region;
    try {
      ({ location, config, region } = extractLocationAndConfig(params));
    } catch (parseErr) {
      return {
        statusCode: 400,
        headers: CORS,
        body: { status: 'Error', message: parseErr.message }
      };
    }

    if (!location.country) {
      return { statusCode: 400, headers: CORS, body: { status: 'Error', message: 'country parameter is required' } };
    }
    if (!location.state) {
      return { statusCode: 400, headers: CORS, body: { status: 'Error', message: 'state parameter is required' } };
    }
    if (!location.zipcode) {
      return { statusCode: 400, headers: CORS, body: { status: 'Error', message: 'zipcode parameter is required' } };
    }

    const result = await calculateTaxRate(location, config, region, params, dbCtx);

    return {
      statusCode: 200,
      headers: CORS,
      body: {
        status: 'Success',
        ...result
      }
    };
  } catch (error) {
    console.error('calculate-tax-rate (webAPI):', error);
    return {
      statusCode: 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Error calculating tax rate',
        error: error.message,
        stack: process.env.LOG_LEVEL === 'debug' ? error.stack : undefined
      }
    };
  }
}

exports.main = main;
