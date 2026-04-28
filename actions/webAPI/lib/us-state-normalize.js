/**
 * Normalize US state from webhook / DB (2-letter, full name, or common variants) to a 2-letter code when possible.
 */
const US_STATE_NAME_TO_CODE = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  'district of columbia': 'DC',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY'
};

function normalizeUsStateToCode(stateInput) {
  if (stateInput == null || String(stateInput).trim() === '') return '';
  const raw = String(stateInput).trim();
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  const key = raw
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return US_STATE_NAME_TO_CODE[key] || raw;
}

/**
 * @param {string} stateInput - region or region_code from address
 * @param {string} country - ISO country e.g. US
 */
function normalizeStateForTaxMatching(stateInput, country) {
  const c = String(country || '').toUpperCase();
  if (c !== 'US' && c !== 'USA') {
    return String(stateInput || '').trim();
  }
  return normalizeUsStateToCode(stateInput);
}

/**
 * Magento `directory_country_region.region_id` for US states (matches Magento tax rate REST payloads).
 * Same keys as App Builder / update-tax-rate sync (Commerce ACCS).
 */
const US_STATE_TO_MAGENTO_REGION_ID = {
  AL: 1,
  AK: 2,
  AS: 3,
  AZ: 4,
  AR: 5,
  AF: 6,
  AA: 7,
  AC: 8,
  AE: 9,
  AM: 10,
  AP: 11,
  CA: 12,
  CO: 13,
  CT: 14,
  DE: 15,
  DC: 16,
  FM: 17,
  FL: 18,
  GA: 19,
  GU: 20,
  HI: 21,
  ID: 22,
  IL: 23,
  IN: 24,
  IA: 25,
  KS: 26,
  KY: 27,
  LA: 28,
  ME: 29,
  MH: 30,
  MD: 31,
  MA: 32,
  MI: 33,
  MN: 34,
  MS: 35,
  MO: 36,
  MT: 37,
  NE: 38,
  NV: 39,
  NH: 40,
  NJ: 41,
  NM: 42,
  NY: 43,
  NC: 44,
  ND: 45,
  MP: 46,
  OH: 47,
  OK: 48,
  OR: 49,
  PW: 50,
  PA: 51,
  PR: 52,
  RI: 53,
  SC: 54,
  SD: 55,
  TN: 56,
  TX: 57,
  UT: 58,
  VT: 59,
  VI: 60,
  VA: 61,
  WA: 62,
  WV: 63,
  WI: 64,
  WY: 65
};

const MAGENTO_REGION_ID_TO_US_CODE = Object.fromEntries(
  Object.entries(US_STATE_TO_MAGENTO_REGION_ID).map(([code, id]) => [id, code])
);

/**
 * Normalize OOP quote region OR App Builder `tax_region_id` so `"TX"`, `"Texas"`, `57`, or `"57"`
 * compare equal for US destinations (Magento stores numeric region_id on tax rates).
 */
function normalizeUsTaxRegionForMatching(raw, country) {
  const c = String(country || '').toUpperCase();
  if (c !== 'US' && c !== 'USA') {
    return raw == null ? '' : String(raw).trim();
  }
  if (raw == null || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const code = MAGENTO_REGION_ID_TO_US_CODE[raw];
    return code || String(raw);
  }
  const s = String(raw).trim();
  if (/^\d+$/.test(s)) {
    const id = parseInt(s, 10);
    const code = MAGENTO_REGION_ID_TO_US_CODE[id];
    if (code) return code;
  }
  return normalizeUsStateToCode(s);
}

module.exports = {
  normalizeUsStateToCode,
  normalizeStateForTaxMatching,
  normalizeUsTaxRegionForMatching,
  US_STATE_NAME_TO_CODE,
  US_STATE_TO_MAGENTO_REGION_ID
};
