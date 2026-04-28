/**
 * Calculate tax rate (Web API) — auth via actions/webAPI/lib/auth-runtime.js (same as create-tax-rate).
 * Business logic matches actions/calculate-tax-rate (Magento-style matching, sorting, compounding).
 */

const https = require('https');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');
const { getDbServiceUrlTemplate, resolveTaxRatesCollectionName } = require('../lib/config');
const { normalizeUsTaxRegionForMatching } = require('../lib/us-state-normalize.js');

/**
 * App Builder Database / Mongo may return numbers as plain numbers, Extended JSON
 * (`{ "$numberDouble": "8.25" }`), Decimal128, or strings. UI may label the field "Tax Rate"
 * but persist as `rate`, `taxRate`, etc.
 */
function unwrapNumericFromDb(val) {
  if (val == null) return null;
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const s = val.replace(/%/g, '').trim().replace(/,/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === 'object') {
    if (val.$numberDouble != null) return parseFloat(String(val.$numberDouble));
    if (val.$numberDecimal != null) return parseFloat(String(val.$numberDecimal));
    if (val.$numberInt != null) return parseFloat(String(val.$numberInt));
    if (val.$numberLong != null) return parseFloat(String(val.$numberLong));
    if (typeof val.toString === 'function') {
      const s = val.toString();
      if (s && s !== '[object Object]') {
        const n = parseFloat(s.replace(/%/g, '').trim());
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

function getTaxRatePercent(rate) {
  if (!rate || typeof rate !== 'object') return 0;
  const keys = [
    'rate',
    'tax_rate',
    'taxRate',
    'percent',
    'percentage',
    'value',
    'tax_percent',
    'rate_percent',
    'taxPercentage'
  ];
  for (const k of keys) {
    if (rate[k] === undefined) continue;
    const n = unwrapNumericFromDb(rate[k]);
    if (n != null && Number.isFinite(n)) return n;
  }
  return 0;
}

function dbFindWithBearerToken(params, namespace, region, bearerToken, collectionName, filter, options) {
  const template = getDbServiceUrlTemplate(params);
  const baseUrl = String(template || '')
    .trim()
    .replace(/<region>/gi, (region || DEFAULT_REGION).toLowerCase());
  if (!baseUrl) {
    return Promise.reject(
      new Error(
        'APP_BUILDER_DB_URL_TEMPLATE is not set on this action. Add it to .env and app.config.yaml (collect-taxes / calculate-tax-rate inputs).'
      )
    );
  }
  const path = `/v1/collection/${encodeURIComponent(collectionName)}/find`;
  const body = JSON.stringify({ filter: filter || {}, options: options || {} });
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(baseUrl);
    } catch (e) {
      reject(
        new Error(
          `Invalid APP_BUILDER_DB_URL_TEMPLATE (could not parse as URL): ${e.message || 'Invalid URL'}`
        )
      );
      return;
    }
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

/** Normalize dashes/spaces so "78701 – 78710" and typos still parse as a numeric range. */
function normalizePostcodePatternForRangeParse(raw) {
  if (raw == null || raw === '*') return '';
  let s = String(raw).trim();
  if (!s) return '';
  s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
  s = s.replace(/\s*-\s*/g, '-');
  return s;
}

function parseZipcodeRange(zipcode) {
  const n = normalizePostcodePatternForRangeParse(zipcode);
  if (!n || n === '*') return null;
  const rangeMatch = n.match(/^(\d+)\s*-\s*(\d+)$/);
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

/** US ZIP+4 and formatting: compare using the first 5 digits when both look US-numeric. */
function normalizeZipForComparison(zip, country) {
  if (zip == null || zip === '') return '';
  const s = String(zip).trim();
  const c = String(country || '').toUpperCase();
  if (c === 'US' || c === 'USA') {
    const m = s.match(/^(\d{5})(?:-\d{4})?$/);
    if (m) return m[1];
    const digits = s.replace(/\D/g, '');
    if (digits.length >= 5) return digits.slice(0, 5);
  }
  return s;
}

function zipcodeMatches(customerZipcode, taxRateZipcode, country) {
  if (!customerZipcode || !taxRateZipcode) return false;
  const cz = normalizeZipForComparison(customerZipcode, country);
  const rz = normalizeZipForComparison(taxRateZipcode, country);
  if (cz === rz) return true;
  if (taxRateZipcode === '*' || rz === '*') return true;
  const range = parseZipcodeRange(taxRateZipcode);
  if (range && zipcodeInRange(cz || customerZipcode, range)) return true;
  return false;
}

function getZipcodeSortValue(zipcode) {
  if (!zipcode || zipcode === '*') return 0;
  const range = parseZipcodeRange(zipcode);
  if (range) return range.to;
  return parseInt(zipcode, 10) || 0;
}

function isExactZipcodeMatch(customerZipcode, taxRateZipcode, country) {
  if (!customerZipcode || !taxRateZipcode) return false;
  if (taxRateZipcode === '*') return false;
  const cz = normalizeZipForComparison(customerZipcode, country);
  const rz = normalizeZipForComparison(taxRateZipcode, country);
  return cz === rz && cz !== '';
}

/**
 * App Builder TaxRateManager stores US ZIP ranges as `zip_is_range` + `zip_from` + `zip_to` with
 * `tax_postcode` null; the single-field form uses `tax_postcode` (e.g. "78701-78710" or "*").
 */
function getEffectiveRatePostcodePattern(rate) {
  if (!rate || typeof rate !== 'object') return '*';
  const singleRaw = rate.tax_postcode ?? rate.postcode;
  const single = singleRaw != null ? String(singleRaw).trim() : '';
  if (single !== '' && single !== '*') {
    return single;
  }
  const from = rate.zip_from != null ? String(rate.zip_from).trim() : '';
  const to = rate.zip_to != null ? String(rate.zip_to).trim() : '';
  if (from !== '' && to !== '') {
    return `${from}-${to}`;
  }
  if (single === '*') return '*';
  return '*';
}

/**
 * App Builder tax rows may use ALL/null/*, "TX" vs "Texas", mixed case.
 */
function rateStateMatchesLocation(locationState, rate, countryNorm) {
  if (locationState == null || String(locationState).trim() === '') return true;
  const rid = rate.tax_region_id;
  if (rid === undefined || rid === null) return true;
  const rs = String(rid).trim();
  if (rs === '' || rs === '*' || rs === '0') return true;
  const ru = rs.toUpperCase();
  if (ru === 'ALL' || ru === 'ALL STATES' || ru === '*') return true;

  const locN = normalizeUsTaxRegionForMatching(locationState, countryNorm);
  const rateN = normalizeUsTaxRegionForMatching(rid, countryNorm);
  if (!locN || !rateN) return false;
  return String(locN).toUpperCase() === String(rateN).toUpperCase();
}

/**
 * Magento-style city layer on top of an already filter-matched (country + region + postcode) set.
 *
 * When `config.taxByCity === false` (legacy): with no quote city, only DB rows with no `city`;
 * with a quote city, exact city else rows with no `city` (no "all region+postcode" fallback).
 *
 * When `config.taxByCity` is not false (default for collect-taxes OOP):
 * - If the quote has a city and at least one row fully matches that city, keep those rows plus
 *   generic rows that have no `city` value.
 * - Otherwise (no city on quote, or no row matches the quote city) return the full
 *   region+postcode match set (exact ZIP, in-range, and * — already merged in
 *   `findMatchingTaxRates`). Empty in only if the postcode layer returned nothing.
 */
function filterRatesByCityPreference(rates, quoteCity, config) {
  if (!rates?.length) return rates;
  const qc = quoteCity != null ? String(quoteCity).trim() : '';
  const legacy = config && config.taxByCity === false;

  const hasCityOnRate = (r) => {
    const c = r?.city != null ? String(r.city).trim() : '';
    return c !== '';
  };

  if (legacy) {
    if (!qc) {
      return rates.filter((r) => !hasCityOnRate(r));
    }
    const exact = rates.filter(
      (r) =>
        hasCityOnRate(r) &&
        qc.localeCompare(String(r.city).trim(), undefined, { sensitivity: 'base' }) === 0
    );
    if (exact.length > 0) return exact;
    return rates.filter((r) => !hasCityOnRate(r));
  }

  if (!qc) {
    return rates;
  }

  const exact = rates.filter(
    (r) =>
      hasCityOnRate(r) &&
      qc.localeCompare(String(r.city).trim(), undefined, { sensitivity: 'base' }) === 0
  );
  if (exact.length > 0) {
    const generic = rates.filter((r) => !hasCityOnRate(r));
    return [...exact, ...generic];
  }

  return rates;
}

/**
 * Magento-style specificity: if the address is already matched by at least one row with a
 * concrete `tax_postcode` (exact ZIP or a range like 78701-78710), drop rows that use a
 * catch-all postcode (`*` or empty). Otherwise US-wide / all-ZIP rules (e.g. codes named
 * US-CA-*) stay in the candidate set and can stack with the correct range row.
 */
function filterCatchAllPostcodeWhenSpecificExists(rates) {
  if (!rates?.length) return rates;
  const isCatchAllPostcode = (r) => {
    const pat = getEffectiveRatePostcodePattern(r);
    return pat === '' || pat === '*';
  };
  const hasSpecific = rates.some((r) => !isCatchAllPostcode(r));
  if (!hasSpecific) return rates;
  return rates.filter((r) => !isCatchAllPostcode(r));
}

/**
 * Load rates for country, then: match tax_region to destination (state), match postcode
 * (exact, range, or *), merge all of those; then drop catch-all postcodes when a more
 * specific rule also matches; if none, []. Then apply
 * `filterRatesByCityPreference` and `preferStateSpecificTaxRates`.
 */
async function findMatchingTaxRates(location, config, region, params, dbCtx) {
  const { country, state, zipcode, city } = location;
  const { bearerToken, namespace } = dbCtx;
  if (!bearerToken || !namespace) {
    throw new Error('Database token or namespace unavailable.');
  }

  const countryNorm = String(country || '')
    .trim()
    .toUpperCase();
  const filter = {
    status: { $ne: false }
  };
  const variants = [...new Set([country, countryNorm, countryNorm.toLowerCase()].filter(Boolean))];
  if (variants.length === 1) {
    filter.tax_country_id = variants[0];
  } else {
    filter.tax_country_id = { $in: variants };
  }

  const findLimit = Math.min(
    Math.max(parseInt(String(params.OOP_TAX_DB_FIND_LIMIT || process.env.OOP_TAX_DB_FIND_LIMIT || 1000), 10) || 1000, 100),
    2000
  );

  const collectionName = dbCtx.collectionName || resolveTaxRatesCollectionName(params);
  const raw = await dbFindWithBearerToken(
    params,
    namespace,
    region,
    bearerToken,
    collectionName,
    filter,
    { limit: findLimit }
  );
  const allRates = Array.isArray(raw) ? raw : raw?.cursor?.firstBatch || raw?.documents || [];

  const exactMatches = [];
  const rangeMatches = [];
  const wildcardMatches = [];

  for (const rate of allRates) {
    const rateCountry = rate.tax_country_id;
    if (rateCountry != null && String(rateCountry).trim() !== '' && String(rateCountry).toUpperCase() !== countryNorm) {
      continue;
    }

    if (state && !rateStateMatchesLocation(state, rate, countryNorm)) {
      continue;
    }

    const rateZipcode = getEffectiveRatePostcodePattern(rate);

    let zipcodeMatchType = null;
    if (isExactZipcodeMatch(zipcode, rateZipcode, countryNorm)) {
      zipcodeMatchType = 'exact';
    } else if (zipcodeMatches(zipcode, rateZipcode, countryNorm)) {
      zipcodeMatchType = rateZipcode === '*' ? 'wildcard' : 'range';
    }
    if (!zipcodeMatchType) continue;

    if (zipcodeMatchType === 'exact') exactMatches.push(rate);
    else if (zipcodeMatchType === 'range') rangeMatches.push(rate);
    else wildcardMatches.push(rate);
  }

  const regionPostcodeMatches = mergePostcodeMatchBuckets(
    exactMatches,
    rangeMatches,
    wildcardMatches
  );
  const afterPostcodeSpecificity = filterCatchAllPostcodeWhenSpecificExists(regionPostcodeMatches);
  if (afterPostcodeSpecificity.length === 0) {
    return [];
  }

  return preferStateSpecificTaxRates(
    filterRatesByCityPreference(afterPostcodeSpecificity, city, config),
    state,
    countryNorm
  );
}

function isStateWildcardTaxRate(rate) {
  const rid = rate.tax_region_id;
  if (rid === undefined || rid === null) return true;
  const s = String(rid).trim();
  if (s === '' || s === '*' || s === '0') return true;
  const u = s.toUpperCase();
  return u === 'ALL' || u === 'ALL STATES';
}

function stateTaxRateMatchesDestination(rate, locationState, countryNorm) {
  if (!locationState || isStateWildcardTaxRate(rate)) return false;
  const rn = normalizeUsTaxRegionForMatching(rate.tax_region_id, countryNorm);
  const ln = normalizeUsTaxRegionForMatching(locationState, countryNorm);
  return Boolean(
    rn && ln && String(rn).toUpperCase() === String(ln).toUpperCase()
  );
}

/** Prefer rows whose tax_region_id matches ship-to state over "all states" rows (often mis-labeled). */
function preferStateSpecificTaxRates(rates, locationState, countryNorm) {
  if (!rates?.length || !locationState) return rates;
  const specific = rates.filter((r) => stateTaxRateMatchesDestination(r, locationState, countryNorm));
  return specific.length > 0 ? specific : rates;
}

/**
 * Unique row identity for deduping only true duplicates (same DB document returned twice).
 * Do not merge distinct rows that share rule_id + tax_identifier — stacked rates need separate lines.
 */
function rateRowIdentity(rate) {
  const id = rate?._id;
  if (id != null) {
    if (typeof id === 'object' && id.$oid != null) return `oid:${String(id.$oid)}`;
    return `id:${String(id)}`;
  }
  const magentoId = rate.rate_id ?? rate.tax_calculation_rate_id ?? rate.entity_id;
  if (magentoId != null && String(magentoId).trim() !== '') {
    return `mid:${String(magentoId)}`;
  }
  const ruleId = rate.rule_id ?? rate.tax_rule_id ?? 'default';
  const taxId = rate.tax_identifier ?? rate.code ?? '';
  const zip = getEffectiveRatePostcodePattern(rate);
  const pct = getTaxRatePercent(rate);
  const city = String(rate.city ?? '');
  return `syn:${ruleId}|${taxId}|${zip}|${city}|${pct}`;
}

/**
 * Union all postcode match types (exact, ZIP range e.g. 78701-78710, wildcard `*`) for the same
 * region; dedupe same DB document. Does not pick exact over range—Magento-style collection of
 * all applicable tax_postcode rules for the address.
 */
function mergePostcodeMatchBuckets(exactMatches, rangeMatches, wildcardMatches) {
  const out = [];
  const seen = new Set();
  for (const list of [exactMatches, rangeMatches, wildcardMatches]) {
    for (const rate of list) {
      const k = rateRowIdentity(rate);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(rate);
    }
  }
  return out;
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

    const zipcodeA = getZipcodeSortValue(getEffectiveRatePostcodePattern(a));
    const zipcodeB = getZipcodeSortValue(getEffectiveRatePostcodePattern(b));
    if (zipcodeA !== zipcodeB) return zipcodeB - zipcodeA;

    const rateA = getTaxRatePercent(a);
    const rateB = getTaxRatePercent(b);
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
  const seen = new Set();

  for (const rate of sortedRates) {
    const key = rateRowIdentity(rate);
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicatedRates.push(rate);
  }

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
          const rateValue = getTaxRatePercent(rate);
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
        const rateValue = getTaxRatePercent(rate);
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
      rate: getTaxRatePercent(rate),
      tax_country_id: rate.tax_country_id,
      tax_region_id: rate.tax_region_id,
      tax_postcode: getEffectiveRatePostcodePattern(rate),
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
    const dbCtx = {
      bearerToken: accessToken,
      namespace,
      collectionName: resolveTaxRatesCollectionName(params)
    };

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
/** Used by `collect-taxes` (OOP tax webhook) to resolve rates from App Builder Database. */
exports.calculateTaxRate = calculateTaxRate;
exports.filterCatchAllPostcodeWhenSpecificExists = filterCatchAllPostcodeWhenSpecificExists;
exports.getEffectiveRatePostcodePattern = getEffectiveRatePostcodePattern;
exports.filterRatesByCityPreference = filterRatesByCityPreference;
