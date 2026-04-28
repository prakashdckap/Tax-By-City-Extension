/*
 * Update Tax Rate (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * Flow: Magento PUT /V1/taxRates → ABDB updateOne. Body: { _id | id, region?, taxRate }.
 */

const axios = require('axios');
const libDb = require('@adobe/aio-lib-db');
const { generateAccessToken: aioGenerateAccessToken } = require('@adobe/aio-lib-core-auth');
const { ObjectId } = require('bson');
const { CORS, DEFAULT_REGION, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');
const { getMagentoScope, getMagentoTokenUrl, resolveTaxRatesCollectionName } = require('../lib/config');

/* --------------------------------------------------------------------------
 * MAGENTO CONFIG (params first, then env — same as create-tax-rate webAPI)
 * -------------------------------------------------------------------------- */
function normalizeCommerceDomainForUrl(raw) {
  let d = String(raw || '').trim();
  d = d.replace(/^https?:\/\//i, '');
  d = d.replace(/\/+$/, '');
  return d;
}

/**
 * Adobe Commerce as a Cloud Service: REST is always
 * `https://<host>/<tenant-id>/V1/...`. An empty tenant produces `https://host//V1/...` (404).
 */
function buildMagentoRestApiBaseUrl(config) {
  const domain = normalizeCommerceDomainForUrl(config.commerceDomain);
  if (!domain) {
    throw new Error('Commerce domain is missing. Set commerceDomain or MAGENTO_COMMERCE_DOMAIN.');
  }
  const inst = String(config.instanceId || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const isSaaS = /\.api\.commerce\.adobe\.com$/i.test(domain);
  if (isSaaS) {
    if (!inst) {
      throw new Error(
        'Adobe Commerce SaaS REST requires the tenant (instance) id in the URL path. ' +
          'Set instanceId / magento_instance_id in App Configuration, or MAGENTO_INSTANCE_ID on the update-tax-rate action. ' +
          'Example: https://na1.api.commerce.adobe.com/<tenant-id>/V1/taxRates'
      );
    }
    return `https://${domain}/${inst}`;
  }
  return inst ? `https://${domain}/${inst}` : `https://${domain}`;
}

function buildMagentoTaxRatesSearchUrl(config) {
  return `${buildMagentoRestApiBaseUrl(config)}/V1/taxRates/search`;
}

function buildMagentoTaxRatesResourceUrl(config) {
  return `${buildMagentoRestApiBaseUrl(config)}/V1/taxRates`;
}

function getMagentoConfig(params = {}) {
  const p = (k) => (params[k] != null && params[k] !== '' ? params[k] : process.env[k]);
  let commerceDomain = String(
    p('MAGENTO_COMMERCE_DOMAIN') || p('commerceDomain') || p('magento_commerce_domain') || ''
  ).trim();
  commerceDomain = normalizeCommerceDomainForUrl(commerceDomain);
  commerceDomain = commerceDomain.replace(/\.admin\.commerce\.adobe\.com$/i, '.api.commerce.adobe.com');
  const instanceId =
    p('MAGENTO_INSTANCE_ID') || p('instanceId') || p('magento_instance_id') || '';
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
    instanceId: String(instanceId || '').trim(),
    clientId,
    clientSecret,
    orgId,
    tokenUrl: tokenUrl || getMagentoTokenUrl(params),
    scope: scope || getMagentoScope(params),
    accessToken
  };
}

/* --------------------------------------------------------------------------
 * AUTH
 * -------------------------------------------------------------------------- */
async function generateAccessToken(config) {
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

async function getAccessToken(config) {
  try {
    const serviceToken = await generateAccessToken(config);
    if (serviceToken) return serviceToken;
  } catch (error) {
    console.warn('update-tax-rate: service token generation failed, falling back to explicit accessToken', error?.message || error);
  }
  if (config.accessToken) return config.accessToken;
  throw new Error('Unable to obtain Magento access token');
}

/* --------------------------------------------------------------------------
 * MAGENTO
 * -------------------------------------------------------------------------- */
const US_STATE_TO_REGION_ID = {
  'AL': 1, 'AK': 2, 'AS': 3, 'AZ': 4, 'AR': 5, 'AF': 6, 'AA': 7, 'AC': 8, 'AE': 9, 'AM': 10, 'AP': 11,
  'CA': 12, 'CO': 13, 'CT': 14, 'DE': 15, 'DC': 16, 'FM': 17, 'FL': 18, 'GA': 19, 'GU': 20, 'HI': 21,
  'ID': 22, 'IL': 23, 'IN': 24, 'IA': 25, 'KS': 26, 'KY': 27, 'LA': 28, 'ME': 29, 'MH': 30, 'MD': 31,
  'MA': 32, 'MI': 33, 'MN': 34, 'MS': 35, 'MO': 36, 'MT': 37, 'NE': 38, 'NV': 39, 'NH': 40, 'NJ': 41,
  'NM': 42, 'NY': 43, 'NC': 44, 'ND': 45, 'MP': 46, 'OH': 47, 'OK': 48, 'OR': 49, 'PW': 50, 'PA': 51,
  'PR': 52, 'RI': 53, 'SC': 54, 'SD': 55, 'TN': 56, 'TX': 57, 'UT': 58, 'VT': 59, 'VI': 60, 'VA': 61,
  'WA': 62, 'WV': 63, 'WI': 64, 'WY': 65
};

function getMagentoRegionId(stateCodeOrId, countryId = 'US') {
  if (!stateCodeOrId || stateCodeOrId === '' || stateCodeOrId === '*' || stateCodeOrId === 'ALL') {
    return 0;
  }
  if (typeof stateCodeOrId === 'number') {
    return stateCodeOrId;
  }
  if (typeof stateCodeOrId === 'string' && /^\d+$/.test(stateCodeOrId)) {
    return parseInt(stateCodeOrId, 10);
  }
  if (countryId === 'US' && typeof stateCodeOrId === 'string') {
    const normalizedStateCode = stateCodeOrId.trim().toUpperCase();
    return US_STATE_TO_REGION_ID[normalizedStateCode] || 0;
  }
  return 0;
}

/** UI / ABDB often stores full names (e.g. "Hawaii"); Magento search uses numeric region_id. */
const US_STATE_NAME_TO_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC'
}

function normalizeTaxRegionIdForSearch(existing) {
  const country = String(existing.tax_country_id || 'US');
  const raw = existing.tax_region_id;
  if (raw == null || raw === '' || raw === '*' || raw === 'ALL') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const two = s.length === 2 ? s.toUpperCase() : null;
  if (two && US_STATE_TO_REGION_ID[two]) return US_STATE_TO_REGION_ID[two];
  const abbr = US_STATE_NAME_TO_CODE[s.toLowerCase()];
  if (abbr) return US_STATE_TO_REGION_ID[abbr] || 0;
  return getMagentoRegionId(s, country);
}

/**
 * When Magento tax `code` ≠ extension tax_identifier (common), resolve id by country/postcode/rate/region.
 */
async function findMagentoTaxRateIdByFingerprint(params, existing) {
  const config = getMagentoConfig(params);
  const inst = String(config.instanceId || '').trim();
  if (/\.api\.commerce\.adobe\.com$/i.test(String(config.commerceDomain || '')) && !inst) {
    return null;
  }
  const token = await getAccessToken(config);
  let base;
  try {
    base = buildMagentoTaxRatesSearchUrl(config);
  } catch (e) {
    console.warn('findMagentoTaxRateIdByFingerprint:', e.message);
    return null;
  }

  const country = String(existing.tax_country_id || 'US').trim();
  const rateNum = Number(existing.rate);
  if (!Number.isFinite(rateNum)) return null;
  const wantRegionId = normalizeTaxRegionIdForSearch(existing);
  const wantCode = String(
    (existing.code && String(existing.code).trim()) || existing.tax_identifier || ''
  ).trim();
  const pc = String(existing.tax_postcode || '').trim();
  const wantPc = pc && pc !== '*' ? pc : null;

  const runQuery = async (includeRateInApi) => {
    const sp = {
      'searchCriteria[filterGroups][0][filters][0][field]': 'tax_country_id',
      'searchCriteria[filterGroups][0][filters][0][value]': country,
      'searchCriteria[filterGroups][0][filters][0][condition_type]': 'eq',
      'searchCriteria[pageSize]': 100
    };
    let idx = 1;
    if (includeRateInApi) {
      sp[`searchCriteria[filterGroups][0][filters][${idx}][field]`] = 'rate';
      sp[`searchCriteria[filterGroups][0][filters][${idx}][value]`] = String(rateNum);
      sp[`searchCriteria[filterGroups][0][filters][${idx}][condition_type]`] = 'eq';
      idx += 1;
    }
    if (wantPc) {
      sp[`searchCriteria[filterGroups][0][filters][${idx}][field]`] = 'tax_postcode';
      sp[`searchCriteria[filterGroups][0][filters][${idx}][value]`] = wantPc;
      sp[`searchCriteria[filterGroups][0][filters][${idx}][condition_type]`] = 'eq';
      idx += 1;
    }
    const response = await axios.get(base, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      params: sp,
      validateStatus: () => true
    });
    if (response.status >= 400) {
      console.warn('findMagentoTaxRateIdByFingerprint HTTP', response.status, response.data);
      return []
    }
    return response.data?.items || []
  }

  try {
    let items = await runQuery(true)
    if (!items.length) items = await runQuery(false)

    const rateMatches = (item) => Math.abs(Number(item.rate) - rateNum) < 0.0001
    items = items.filter(rateMatches)
    if (!items.length) return null

    const scoreRow = (item) => {
      let score = 0
      if (wantCode && String(item.code || '').trim() === wantCode) score += 100
      if (wantRegionId > 0 && Number(item.tax_region_id) === wantRegionId) score += 60
      if (wantRegionId > 0 && Number(item.region_id) === wantRegionId) score += 60
      const iname = String(item.region_name || '').toLowerCase()
      const tr = String(existing.tax_region_id || '').toLowerCase()
      if (tr && tr !== '*' && tr !== 'all' && iname && (iname.includes(tr) || tr.includes(iname))) {
        score += 45
      }
      if (wantPc && String(item.tax_postcode || '').trim() === wantPc) score += 40
      return score
    }

    const ranked = items.map((item) => ({ item, score: scoreRow(item) }))
    ranked.sort((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best.score >= 50 || ranked.length === 1) {
      const id = best.item.id
      if (id != null && !Number.isNaN(Number(id))) {
        console.log(
          'Resolved Magento tax rate id from fingerprint:',
          id,
          'score',
          best.score,
          'magento code',
          best.item.code
        )
        return Number(id)
      }
    }
  } catch (e) {
    console.warn('findMagentoTaxRateIdByFingerprint failed:', e.response?.data || e.message)
  }
  return null
}

function formatMagentoTaxRatePayload(data, existingData) {
  const country = data.tax_country_id || 'US';
  const rate = Number(data.rate) || 0;
  
  let stateCode = '*';
  let regionId = 0;
  
  if (data.tax_region_id && data.tax_region_id !== '' && data.tax_region_id !== '*' && data.tax_region_id !== 'ALL') {
    if (typeof data.tax_region_id === 'number') {
      regionId = data.tax_region_id;
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === data.tax_region_id);
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0];
      }
    } else if (typeof data.tax_region_id === 'string' && /^\d+$/.test(data.tax_region_id)) {
      regionId = parseInt(data.tax_region_id, 10);
      const regionIdToStateCode = Object.entries(US_STATE_TO_REGION_ID).find(([_, id]) => id === regionId);
      if (regionIdToStateCode) {
        stateCode = regionIdToStateCode[0];
      }
    } else if (typeof data.tax_region_id === 'string' && /^[A-Z]{2,3}$/i.test(data.tax_region_id)) {
      stateCode = data.tax_region_id.toUpperCase();
      regionId = getMagentoRegionId(stateCode, country);
    } else {
      stateCode = data.tax_region_id.toUpperCase();
      regionId = getMagentoRegionId(stateCode, country);
    }
  } else {
    regionId = 0;
    stateCode = '*';
  }
  
  // CRITICAL: For UPDATE, only include code if it's different from existing
  const existingCode = existingData?.code || existingData?.tax_identifier || null;
  const newCode = data.code || null;
  const codeMatches = existingCode && newCode && String(existingCode).trim() === String(newCode).trim();
  
  // Handle ZIP range parsing if tax_postcode contains a range format (e.g., "90001-90006")
  let zipFrom = data.zip_from;
  let zipTo = data.zip_to;
  
  if (!zipFrom && !zipTo && data.tax_postcode && data.zip_is_range) {
    // Try to parse range from tax_postcode if zip_from/zip_to not provided
    const rangeMatch = data.tax_postcode.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      zipFrom = rangeMatch[1];
      zipTo = rangeMatch[2];
    }
  }
  
  // Get region name
  let regionName = null;
  if (stateCode && stateCode !== '*') {
    const stateNames = {
      'AK': 'Alaska', 'AL': 'Alabama', 'AR': 'Arkansas', 'AZ': 'Arizona', 'CA': 'California',
      'CO': 'Colorado', 'CT': 'Connecticut', 'DC': 'District of Columbia', 'DE': 'Delaware',
      'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'IA': 'Iowa', 'ID': 'Idaho',
      'IL': 'Illinois', 'IN': 'Indiana', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
      'MA': 'Massachusetts', 'MD': 'Maryland', 'ME': 'Maine', 'MI': 'Michigan', 'MN': 'Minnesota',
      'MO': 'Missouri', 'MS': 'Mississippi', 'MT': 'Montana', 'NC': 'North Carolina', 'ND': 'North Dakota',
      'NE': 'Nebraska', 'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NV': 'Nevada',
      'NY': 'New York', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania',
      'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas',
      'UT': 'Utah', 'VA': 'Virginia', 'VT': 'Vermont', 'WA': 'Washington', 'WI': 'Wisconsin',
      'WV': 'West Virginia', 'WY': 'Wyoming'
    };
    regionName = stateNames[stateCode] || stateCode;
  }
  
  const payload = {
    tax_country_id: country,
    rate: rate,
    tax_region_id: regionId,
    tax_postcode: data.tax_postcode || '*',
    zip_is_range: data.zip_is_range ? 1 : 0,
    titles: [
      {
        store_id: '0',
        value: `${regionName || 'All'} - ${rate}%`
      }
    ]
  };
  
  // If zip_is_range is true, include zip_from and zip_to
  if (data.zip_is_range) {
    if (zipFrom) {
      payload.zip_from = zipFrom;
    }
    if (zipTo) {
      payload.zip_to = zipTo;
    }
  }
  
  // Only include code if it's different from existing (to avoid "code already exists" error)
  if (!codeMatches && newCode) {
    payload.code = newCode;
  }
  
  if (regionId > 0 && regionName) {
    payload.region_name = regionName;
  }
  
  return payload;
}

function isMagentoTaxRateSuccessPayload(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload.id || payload.tax_calculation_rate_id || payload.tax_rate_id) &&
      payload.tax_country_id &&
      payload.rate !== undefined
  );
}

/**
 * Resolve numeric tax rate id from Magento when ABDB row only has code / tax_identifier (legacy sync).
 * GET /V1/taxRates/search with filter field=code (eq, then like).
 */
async function findMagentoTaxRateIdByCode(params, code) {
  if (!code || String(code).trim() === '') return null;
  const config = getMagentoConfig(params);
  const inst = String(config.instanceId || '').trim();
  if (/\.api\.commerce\.adobe\.com$/i.test(String(config.commerceDomain || '')) && !inst) {
    console.warn('findMagentoTaxRateIdByCode: missing instanceId for SaaS REST path');
    return null;
  }
  const token = await getAccessToken(config);
  let base;
  try {
    base = buildMagentoTaxRatesSearchUrl(config);
  } catch (e) {
    console.warn('findMagentoTaxRateIdByCode:', e.message);
    return null;
  }
  const value = String(code).trim();

  const trySearch = async (conditionType, searchValue) => {
    const searchParams = {
      'searchCriteria[filterGroups][0][filters][0][field]': 'code',
      'searchCriteria[filterGroups][0][filters][0][value]': searchValue,
      'searchCriteria[filterGroups][0][filters][0][condition_type]': conditionType,
      'searchCriteria[pageSize]': 20
    };
    const response = await axios.get(base, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      },
      params: searchParams,
      validateStatus: () => true
    });
    if (response.status >= 400) {
      console.warn('findMagentoTaxRateIdByCode HTTP', response.status, response.data);
      return null;
    }
    const items = response.data?.items || [];
    if (!items.length) return null;
    const id = items[0].id;
    if (id != null && !Number.isNaN(Number(id))) return Number(id);
    return null;
  };

  try {
    let id = await trySearch('eq', value);
    if (id != null) {
      console.log(`Resolved Magento tax rate id ${id} from code eq (${value})`);
      return id;
    }
    id = await trySearch('like', `%${value}%`);
    if (id != null) {
      console.log(`Resolved Magento tax rate id ${id} from code like (%${value}%)`);
      return id;
    }
  } catch (e) {
    console.warn('findMagentoTaxRateIdByCode failed:', e.response?.data || e.message);
  }
  return null;
}

async function updateInMagento(data, identifier, existingData, params = {}) {
  const config = getMagentoConfig(params);
  const token = await getAccessToken(config);
  let url;
  try {
    url = buildMagentoTaxRatesResourceUrl(config);
  } catch (e) {
    const err = new Error(e.message);
    err.statusCode = 400;
    throw err;
  }

  // Identifier can be numeric ID or code (string)
  // Try numeric first, but accept string codes too
  let taxRateId = identifier;
  if (typeof identifier === 'string' && /^\d+$/.test(identifier)) {
    taxRateId = parseInt(identifier, 10);
  }

  // CRITICAL: Magento API requires PUT to /V1/taxRates (without ID in URL)
  // The ID must be included in the request body as part of the taxRate object
  console.log(`🔗 Updating Magento tax rate with identifier: ${identifier} (resolved to: ${taxRateId})`);
  console.log(`🔗 URL: ${url} (ID will be in request body)`);

  try {
    const payload = formatMagentoTaxRatePayload(data, existingData);
    
    // CRITICAL: Include the ID in the payload (Magento API requirement)
    if (taxRateId && typeof taxRateId === 'number') {
      payload.id = taxRateId;
    } else if (taxRateId) {
      // If it's a string code, we can't use it as numeric ID
      // But we'll try to include it if it's numeric
      const numericId = parseInt(taxRateId, 10);
      if (!isNaN(numericId)) {
        payload.id = numericId;
      }
    }
    
    // CRITICAL: Magento requires 'code' field for updates
    // Use existing code if new code matches (to avoid "code already exists" error)
    // Otherwise use the new code, or fall back to existing code if no new code provided
    const existingCode = existingData?.code || existingData?.tax_identifier || null;
    const newCode = payload.code || data.code || null;
    
    if (existingCode && newCode && String(existingCode).trim() === String(newCode).trim()) {
      // Code matches - use existing code to avoid "already exists" error
      payload.code = existingCode;
      console.log(`✅ Using existing code (${existingCode}) to avoid "code already exists" error`);
    } else if (!payload.code && existingCode) {
      // No new code provided, use existing code
      payload.code = existingCode;
      console.log(`✅ Using existing code (${existingCode}) as no new code provided`);
    } else if (payload.code) {
      // New code provided and different - use it
      console.log(`✅ Using new code (${payload.code})`);
    } else {
      // No code at all - this will cause an error, but we'll let Magento handle it
      console.log('⚠️  Warning: No code provided for update');
    }
    
    console.log(`📤 PUT payload (with id in body):`, JSON.stringify(payload, null, 2));
    
    const response = await axios.put(url, { taxRate: payload }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    return {
      taxIdentifier: response.data?.tax_identifier || response.data?.code || response.data?.id || identifier,
      response: response.data
    };
  } catch (error) {
    const magentoPayload = error.response?.data;
    if (error.response?.status === 500 && isMagentoTaxRateSuccessPayload(magentoPayload)) {
      console.warn('Magento returned HTTP 500 but updated the tax rate successfully:', JSON.stringify(magentoPayload));
      return {
        taxIdentifier: magentoPayload?.tax_identifier || magentoPayload?.code || magentoPayload?.id || taxRateId,
        response: magentoPayload
      };
    }

    console.error('Magento API Error:', magentoPayload || error.message);
    console.error('URL used:', url);
    console.error('Tax Rate ID used:', taxRateId);
    const magentoError = new Error(
      `Request failed with status code ${error.response?.status || 'unknown'}. ` +
      `Details: ${JSON.stringify(magentoPayload || error.message)}. ` +
      `URL: ${url}, Tax Rate ID: ${taxRateId}`
    );
    magentoError.statusCode = error.response?.status || 500;
    magentoError.magentoResponse = magentoPayload;
    throw magentoError;
  }
}

/**
 * ABDB rows that never existed in Commerce (no magento_tax_rate_id, no code match, no fingerprint match)
 * cannot be PUT-updated. POST /V1/taxRates creates the rate and returns an id for later sync.
 */
async function createMagentoTaxRateWhenMissing(previewData, existingDbRow, params) {
  const config = getMagentoConfig(params);
  const domain = String(config.commerceDomain || '');
  const inst = String(config.instanceId || '').trim();
  if (/\.api\.commerce\.adobe\.com$/i.test(domain) && !inst) {
    console.warn('createMagentoTaxRateWhenMissing: skip — instanceId required for Adobe Commerce API');
    return null;
  }

  const data = {
    ...previewData,
    code:
      previewData.code != null && String(previewData.code).trim() !== ''
        ? String(previewData.code).trim()
        : previewData.tax_identifier != null && String(previewData.tax_identifier).trim() !== ''
          ? String(previewData.tax_identifier).trim()
          : null
  };

  const payload = formatMagentoTaxRatePayload(data, existingDbRow);
  if (!payload.code) {
    if (data.code) payload.code = data.code;
    else if (data.tax_identifier) payload.code = String(data.tax_identifier).trim();
  }

  const token = await getAccessToken(config);
  const url = buildMagentoTaxRatesResourceUrl(config);

  console.log('📤 Magento CREATE (extension-only ABDB row):', JSON.stringify({ taxRate: payload }, null, 2));

  try {
    const response = await axios.post(url, { taxRate: payload }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      }
    });
    const body = response.data;
    const numericId = body?.id ?? body?.tax_calculation_rate_id ?? body?.tax_rate_id;
    if (numericId != null) {
      return { numericId: Number(numericId), response: body };
    }
    console.warn('createMagentoTaxRateWhenMissing: response missing id', JSON.stringify(body));
    return null;
  } catch (error) {
    const magentoPayload = error.response?.data;
    if (error.response?.status === 500 && isMagentoTaxRateSuccessPayload(magentoPayload)) {
      const numericId =
        magentoPayload?.id ?? magentoPayload?.tax_calculation_rate_id ?? magentoPayload?.tax_rate_id;
      if (numericId != null) {
        return { numericId: Number(numericId), response: magentoPayload };
      }
    }
    console.error(
      'createMagentoTaxRateWhenMissing:',
      error.response?.status,
      magentoPayload || error.message
    );
    return null;
  }
}

const TAX_CONFIG_COLLECTION = 'tax_config';
const TAX_CONFIG_KEY = 'default';

/**
 * Fills missing Commerce host / tenant from App Builder `tax_config` (same document as Settings).
 * Prevents `https://host//V1/...` when the browser omits `instanceId` but production saved it in ABDB.
 */
async function mergeMagentoSettingsFromTaxConfig(mergedParams, dbCtx, region) {
  const hasDomain = Boolean(
    (mergedParams.commerceDomain && String(mergedParams.commerceDomain).trim()) ||
      (mergedParams.magento_commerce_domain && String(mergedParams.magento_commerce_domain).trim()) ||
      (process.env.MAGENTO_COMMERCE_DOMAIN && String(process.env.MAGENTO_COMMERCE_DOMAIN).trim())
  );
  const hasInstance = Boolean(
    (mergedParams.instanceId && String(mergedParams.instanceId).trim()) ||
      (mergedParams.magento_instance_id && String(mergedParams.magento_instance_id).trim()) ||
      (process.env.MAGENTO_INSTANCE_ID && String(process.env.MAGENTO_INSTANCE_ID).trim())
  );
  if (hasDomain && hasInstance) return;
  let client;
  try {
    const { bearerToken, namespace } = dbCtx;
    const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
    client = await db.connect();
    const collection = await client.collection(TAX_CONFIG_COLLECTION);
    const rows = await collection.findArray({ config_key: TAX_CONFIG_KEY }, { limit: 1 });
    if (!Array.isArray(rows) || !rows.length) return;
    const doc = rows[0];
    if (!hasDomain && doc.magento_commerce_domain) {
      mergedParams.commerceDomain = String(doc.magento_commerce_domain).trim();
    }
    if (!hasInstance && doc.magento_instance_id != null && String(doc.magento_instance_id).trim() !== '') {
      mergedParams.instanceId = String(doc.magento_instance_id).trim();
    }
  } catch (e) {
    console.warn('update-tax-rate: read tax_config for Magento host:', e?.message || e);
  } finally {
    if (client) await client.close();
  }
}

/* --------------------------------------------------------------------------
 * DATABASE (IMS + namespace — same as create-tax-rate webAPI)
 * -------------------------------------------------------------------------- */
async function initDbWithCtx(dbCtx, region = DEFAULT_REGION, params = {}) {
  const { bearerToken, namespace } = dbCtx;
  const collectionName = dbCtx.collectionName || resolveTaxRatesCollectionName(params);
  const db = await libDb.init({ token: bearerToken, region, ow: { namespace } });
  const client = await db.connect();
  const collection = await client.collection(collectionName);
  return { client, collection };
}

async function findTaxRateDb(dbCtx, filter, region, params = {}) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region, params);
    client = dbClient;
    return await collection.findOne(filter);
  } finally {
    if (client) await client.close();
  }
}

async function updateTaxRateDb(dbCtx, filter, data, region, params = {}) {
  let client;
  try {
    const { client: dbClient, collection } = await initDbWithCtx(dbCtx, region, params);
    client = dbClient;
    const result = await collection.updateOne(filter, {
      $set: { ...data, updated_at: new Date() }
    });
    return result.modifiedCount > 0;
  } finally {
    if (client) await client.close();
  }
}

function parseUpdateBody(params) {
  let body = {};
  if (params.__ow_body) {
    const raw = params.__ow_body;
    try {
      if (typeof raw === 'string') {
        try {
          body = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
        } catch {
          body = JSON.parse(raw);
        }
      } else if (typeof raw === 'object' && !Array.isArray(raw)) {
        body = raw;
      }
    } catch (e) {
      throw new Error('Invalid JSON in request body: ' + e.message);
    }
  }
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      if (q.has('_id')) body._id = body._id || q.get('_id');
      if (q.has('id')) body._id = body._id || q.get('id');
      if (q.has('region')) body.region = body.region || q.get('region');
    } catch (e) {
      console.warn('update-tax-rate: __ow_query', e?.message || e);
    }
  }
  const flat = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') flat[k] = v;
  }
  const merged = { ...flat, ...body };
  if (!merged.taxRate && params.taxRate) {
    merged.taxRate = params.taxRate;
  }
  return merged;
}

/* --------------------------------------------------------------------------
 * MAIN
 * -------------------------------------------------------------------------- */
async function runUpdateFlow(params, dbCtx) {
  let body;
  try {
    body = parseUpdateBody(params);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: { status: 'Error', message: e.message || 'Invalid request body' }
    };
  }

  /** UI sends commerceDomain / instanceId in POST body; OpenWhisk params alone omit them. */
  const region = body.region || DEFAULT_REGION;
  const mergedParams = { ...params, ...body };
  await mergeMagentoSettingsFromTaxConfig(mergedParams, dbCtx, region);

  dbCtx.collectionName = resolveTaxRatesCollectionName(mergedParams);
  const taxRate = body.taxRate;
  const docId = body._id || body.id;

  if (!taxRate) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'taxRate is required'
      }
    };
  }

  if (!docId) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: '_id or id is required for update'
      }
    };
  }

  let existing;
  try {
    existing = await findTaxRateDb(dbCtx, { _id: new ObjectId(String(docId)) }, region, mergedParams);
  } catch (e) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: e.message || 'Invalid _id format'
      }
    };
  }

  if (!existing) {
    return {
      statusCode: 404,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Tax rate not found'
      }
    };
  }

  console.log('🔍 Existing tax rate from DB:', JSON.stringify({
    _id: existing._id,
    magento_tax_rate_id: existing.magento_tax_rate_id,
    magento_id: existing.magento_id,
    id: existing.id,
    tax_identifier: existing.tax_identifier,
    code: existing.code
  }, null, 2));

  // Get update identifier (prefer numeric ID, fallback to code/tax_identifier)
  // Try numeric ID first, but if that fails, we'll try using the code
  const updateIdentifier = existing.magento_tax_rate_id || 
                           existing.magento_id || 
                           existing.id ||
                           null;

  // If we don't have numeric ID, try to get it from tax_identifier if it's numeric
  let numericIdentifier = updateIdentifier;
  if (!numericIdentifier && existing.tax_identifier) {
    // Check if tax_identifier is actually a numeric ID stored as string
    if (/^\d+$/.test(String(existing.tax_identifier))) {
      numericIdentifier = parseInt(existing.tax_identifier, 10);
    }
  }

  // Legacy rows: resolve id from Magento by tax code (same as Admin "Tax Identifier")
  if (!numericIdentifier) {
    const lookupCode = (existing.code && String(existing.code).trim()) || existing.tax_identifier;
    const resolved = await findMagentoTaxRateIdByCode(mergedParams, lookupCode);
    if (resolved) {
      numericIdentifier = resolved;
    }
  }
  // Extension tax_identifier often differs from Magento's internal `code` — match by location + rate
  if (!numericIdentifier) {
    const resolved = await findMagentoTaxRateIdByFingerprint(mergedParams, existing);
    if (resolved) {
      numericIdentifier = resolved;
    }
  }

  let createdMagentoResponse = null;
  if (!numericIdentifier) {
    const previewForCreate = { ...existing, ...taxRate };
    if (previewForCreate.code == null || String(previewForCreate.code).trim() === '') {
      if (previewForCreate.tax_identifier != null && String(previewForCreate.tax_identifier).trim() !== '') {
        previewForCreate.code = String(previewForCreate.tax_identifier).trim();
      }
    }
    const created = await createMagentoTaxRateWhenMissing(previewForCreate, existing, mergedParams);
    if (created?.numericId != null && !Number.isNaN(created.numericId)) {
      numericIdentifier = created.numericId;
      createdMagentoResponse = created.response;
      console.log('✅ Created tax rate in Magento (ABDB-only row); id=', numericIdentifier);
    }
  }

  // CRITICAL: Magento API requires numeric ID in the request body for updates (or we just created one above)
  if (!numericIdentifier) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: `Cannot update tax rate: no numeric Magento ID and no matching tax rate in Magento for code "${existing.code || existing.tax_identifier || ''}". Sync from Magento or ensure the rate exists in Commerce with the same code. Existing record: ${JSON.stringify({ magento_tax_rate_id: existing.magento_tax_rate_id, magento_id: existing.magento_id, id: existing.id, tax_identifier: existing.tax_identifier, code: existing.code })}`
      }
    };
  }
  
  // Ensure it's a number
  let identifierToUse = numericIdentifier;
  if (typeof numericIdentifier !== 'number') {
    identifierToUse = parseInt(numericIdentifier, 10);
    if (isNaN(identifierToUse)) {
      return {
        statusCode: 400,
        headers: CORS,
        body: {
          status: 'Error',
          message: `Invalid identifier format: ${numericIdentifier}. Magento requires a numeric ID for updates.`
        }
      };
    }
  }
  
  console.log(`🔍 Using numeric identifier for Magento update: ${identifierToUse}`);

  // Merge existing with new data (exclude code if it matches)
  const existingCode = existing.code || existing.tax_identifier || null;
  const newCode = taxRate.code || null;
  const codeMatches = existingCode && newCode && String(existingCode).trim() === String(newCode).trim();
  
  const mergedData = { ...existing };
  Object.keys(taxRate).forEach(key => {
    if (key === 'code' && codeMatches) {
      return; // Skip code if it matches
    }
    mergedData[key] = taxRate[key];
  });
  
  if (codeMatches) {
    delete mergedData.code;
  }

  let magento;
  if (createdMagentoResponse) {
    magento = {
      taxIdentifier:
        createdMagentoResponse.tax_identifier ||
        createdMagentoResponse.code ||
        mergedData.code ||
        mergedData.tax_identifier ||
        identifierToUse,
      response: createdMagentoResponse
    };
  } else {
    magento = await updateInMagento(mergedData, identifierToUse, existing, mergedParams);
  }

  // Format tax identifier
  const formatTaxIdentifier = (country, state, rate, customCode) => {
    if (state === '*' && customCode) {
      return `${country}-${state}-${customCode}`;
    } else if (state === '*') {
      return `${country}-${state}-${rate}`;
    } else {
      return `${country}-${state}-${rate}`;
    }
  };

  let taxIdentifier = magento.taxIdentifier || 
                     magento.response?.tax_identifier || 
                     magento.response?.code ||
                     taxRate.tax_identifier ||
                     existing.tax_identifier ||
                     null;

  // Recalculate tax identifier based on NEW values (not existing)
  // Use taxRate values first, fallback to existing only if taxRate doesn't have the field
  const country = taxRate.tax_country_id !== undefined ? taxRate.tax_country_id : (existing.tax_country_id || 'US');
  const rate = taxRate.rate !== undefined ? Number(taxRate.rate) : Number(existing.rate || 0);
  const customCode = taxRate.code !== undefined ? taxRate.code : (existing.code || '');
  
  // Determine state: if taxRate.tax_region_id is explicitly set (even if empty), use it
  // Empty string, null, '*', or 'ALL' all mean "all states" (*)
  let state = '*';
  if (taxRate.tax_region_id !== undefined) {
    if (taxRate.tax_region_id === '' || taxRate.tax_region_id === null || taxRate.tax_region_id === '*' || taxRate.tax_region_id === 'ALL') {
      state = '*'; // All states
    } else {
      state = taxRate.tax_region_id; // Specific state
    }
  } else {
    // taxRate.tax_region_id is undefined, use existing value
    if (!existing.tax_region_id || existing.tax_region_id === '' || existing.tax_region_id === 'ALL' || existing.tax_region_id === '*') {
      state = '*';
    } else {
      state = existing.tax_region_id;
    }
  }
  
  // Recalculate tax identifier with new values
  if (taxIdentifier && typeof taxIdentifier === 'number') {
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  } else if (!taxIdentifier || taxIdentifier === existing.tax_identifier) {
    // Recalculate if no identifier or if it matches existing (might need update)
    taxIdentifier = formatTaxIdentifier(country, state, rate, customCode);
  }

  // Extract numeric ID from Magento
  const magentoNumericId = magento.response?.id || 
                           magento.response?.tax_calculation_rate_id ||
                           existing.magento_tax_rate_id ||
                           null;

  // Update in database
  // Normalize tax_region_id: empty string, null, '*', or 'ALL' all mean "all states"
  let normalizedRegionId = existing.tax_region_id;
  if (taxRate.tax_region_id !== undefined) {
    if (taxRate.tax_region_id === '' || taxRate.tax_region_id === null || taxRate.tax_region_id === '*' || taxRate.tax_region_id === 'ALL') {
      normalizedRegionId = ''; // Empty string means "all states"
    } else {
      normalizedRegionId = taxRate.tax_region_id;
    }
  }
  
  // Build final tax rate object with all updated fields
  // Remove 'id' field from taxRate as it's not a database field (it's the MongoDB _id)
  const { id, ...taxRateWithoutId } = taxRate;
  
  // Start with existing data, then override with new values from taxRate
  // This ensures all fields are updated, including null values to clear fields
  const finalTaxRate = {
    ...existing,
    ...taxRateWithoutId,
    // Override with calculated/normalized values
    tax_identifier: taxIdentifier,
    magento_tax_rate_id: magentoNumericId,
    tax_region_id: normalizedRegionId,
    // Ensure code is handled correctly (use new if provided, otherwise keep existing)
    code: taxRate.code !== undefined ? taxRate.code : existing.code
  };

  await updateTaxRateDb(dbCtx, { _id: existing._id }, finalTaxRate, region, mergedParams);

  return {
    statusCode: 200,
    headers: CORS,
    body: {
      status: 'Success',
      magento,
      tax_identifier: taxIdentifier
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
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
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

  const dbCtx = {
    bearerToken: authResult.accessToken,
    namespace: authResult.namespace,
    collectionName: resolveTaxRatesCollectionName(params)
  };

  try {
    return await runUpdateFlow(params, dbCtx);
  } catch (error) {
    console.error('update-tax-rate (webAPI):', error);
    const statusCode =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
    return {
      statusCode,
      headers: CORS,
      body: {
        status: 'Error',
        message: error.message || 'Error updating tax rate',
        ...(error.magentoResponse ? { magentoResponse: error.magentoResponse } : {})
      }
    };
  }
}

exports.main = main;
/** Exposed for unit tests (URL building / ACCS path correctness). */
exports.buildMagentoRestApiBaseUrl = buildMagentoRestApiBaseUrl;
exports.buildMagentoTaxRatesResourceUrl = buildMagentoTaxRatesResourceUrl;
exports.normalizeCommerceDomainForUrl = normalizeCommerceDomainForUrl;
