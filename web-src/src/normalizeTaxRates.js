/**
 * Normalize Tax Rates Utility
 * Converts tax rate data to ensure state codes are properly formatted
 * Handles legacy data with numeric tax_region_id or region_name
 */

import { getStatesForCountry, getStateName } from './countries-states'

/**
 * Normalize a single tax rate to ensure state codes are correct
 * @param {Object} rate - Tax rate object
 * @returns {Object} Normalized tax rate
 */
/**
 * Extract state code from tax_identifier (e.g., "US-AK-13" -> "AK")
 * @param {string} taxIdentifier - Tax identifier string
 * @returns {string|null} State code or null
 */
function extractStateFromTaxIdentifier(taxIdentifier) {
  if (!taxIdentifier || typeof taxIdentifier !== 'string') {
    return null;
  }
  
  // Format: US-AK-13 or US-NY-*-Rate 1
  const parts = taxIdentifier.split('-');
  if (parts.length >= 2) {
    const state = parts[1];
    // If state is "*", return null (all states)
    if (state === '*') {
      return null;
    }
    // If it looks like a state code (2-3 uppercase letters), return it
    if (/^[A-Z]{2,3}$/.test(state)) {
      return state;
    }
  }
  return null;
}

export const normalizeTaxRate = (rate) => {
  if (!rate) return rate

  const normalized = { 
    ...rate,
    // Preserve tax_identifier and code if they exist
    tax_identifier: rate.tax_identifier || rate.code || null,
    code: rate.code || rate.tax_identifier || null
  }

  // If tax_region_id is missing (null/undefined), try to extract it from tax_identifier
  // BUT: If tax_region_id is explicitly empty string '', it means "All States" - don't overwrite it
  if (normalized.tax_region_id === null || normalized.tax_region_id === undefined) {
    const extractedState = extractStateFromTaxIdentifier(normalized.tax_identifier || normalized.code);
    if (extractedState) {
      normalized.tax_region_id = extractedState;
    } else {
      // If extraction fails, set to empty string (All States)
      normalized.tax_region_id = '';
    }
  } else if (normalized.tax_region_id === '' || normalized.tax_region_id === '*') {
    // Explicitly set to empty or '*' means "All States" - keep it as is
    normalized.tax_region_id = '';
  }

  // If tax_region_id is numeric or region_name exists, convert to state code
  if (normalized.tax_region_id && typeof normalized.tax_region_id === 'number' && normalized.tax_region_id > 0) {
    // Numeric ID - try to use region_name if available
    if (normalized.region_name) {
      const countryId = normalized.tax_country_id || 'US'
      const states = getStatesForCountry(countryId)
      const matchedState = states.find(s => 
        s.name.toLowerCase() === normalized.region_name.toLowerCase()
      )
      if (matchedState && matchedState.id) {
        normalized.tax_region_id = matchedState.id
      } else {
        // Try state name mapping
        const regionNameLower = normalized.region_name.toLowerCase()
        const stateMap = {
          'california': 'CA', 'new york': 'NY', 'texas': 'TX', 'florida': 'FL',
          'illinois': 'IL', 'pennsylvania': 'PA', 'ohio': 'OH', 'georgia': 'GA',
          'north carolina': 'NC', 'michigan': 'MI', 'new jersey': 'NJ', 'virginia': 'VA',
          'washington': 'WA', 'arizona': 'AZ', 'massachusetts': 'MA', 'tennessee': 'TN',
          'indiana': 'IN', 'missouri': 'MO', 'maryland': 'MD', 'wisconsin': 'WI',
          'colorado': 'CO', 'minnesota': 'MN', 'south carolina': 'SC', 'alabama': 'AL',
          'louisiana': 'LA', 'kentucky': 'KY', 'oregon': 'OR', 'oklahoma': 'OK',
          'connecticut': 'CT', 'utah': 'UT', 'iowa': 'IA', 'nevada': 'NV',
          'arkansas': 'AR', 'mississippi': 'MS', 'kansas': 'KS', 'new mexico': 'NM',
          'nebraska': 'NE', 'west virginia': 'WV', 'idaho': 'ID', 'hawaii': 'HI',
          'new hampshire': 'NH', 'maine': 'ME', 'montana': 'MT', 'rhode island': 'RI',
          'delaware': 'DE', 'south dakota': 'SD', 'north dakota': 'ND', 'alaska': 'AK',
          'vermont': 'VT', 'wyoming': 'WY', 'district of columbia': 'DC'
        }
        if (stateMap[regionNameLower]) {
          normalized.tax_region_id = stateMap[regionNameLower]
        } else {
          // Can't map, set to empty (all states)
          normalized.tax_region_id = ''
        }
      }
    } else {
      // Numeric ID but no region_name - set to empty (all states)
      normalized.tax_region_id = ''
    }
  } else if (normalized.region_name && (!normalized.tax_region_id || normalized.tax_region_id === 0 || normalized.tax_region_id === '0')) {
    // Has region_name but tax_region_id is 0 or empty - convert region_name to state code
    const countryId = normalized.tax_country_id || 'US'
    const states = getStatesForCountry(countryId)
    const regionName = normalized.region_name.trim()
    
    const matchedState = states.find(s => 
      s.name.toLowerCase() === regionName.toLowerCase() ||
      s.id.toLowerCase() === regionName.toLowerCase()
    )
    
    if (matchedState && matchedState.id) {
      normalized.tax_region_id = matchedState.id
    } else if (/^[A-Z]{2,3}$/i.test(regionName)) {
      normalized.tax_region_id = regionName.toUpperCase()
    } else {
      // Try state name mapping for US
      if (countryId === 'US') {
        const regionNameLower = regionName.toLowerCase()
        const stateMap = {
          'california': 'CA', 'new york': 'NY', 'texas': 'TX', 'florida': 'FL',
          'illinois': 'IL', 'pennsylvania': 'PA', 'ohio': 'OH', 'georgia': 'GA',
          'north carolina': 'NC', 'michigan': 'MI', 'new jersey': 'NJ', 'virginia': 'VA',
          'washington': 'WA', 'arizona': 'AZ', 'massachusetts': 'MA', 'tennessee': 'TN',
          'indiana': 'IN', 'missouri': 'MO', 'maryland': 'MD', 'wisconsin': 'WI',
          'colorado': 'CO', 'minnesota': 'MN', 'south carolina': 'SC', 'alabama': 'AL',
          'louisiana': 'LA', 'kentucky': 'KY', 'oregon': 'OR', 'oklahoma': 'OK',
          'connecticut': 'CT', 'utah': 'UT', 'iowa': 'IA', 'nevada': 'NV',
          'arkansas': 'AR', 'mississippi': 'MS', 'kansas': 'KS', 'new mexico': 'NM',
          'nebraska': 'NE', 'west virginia': 'WV', 'idaho': 'ID', 'hawaii': 'HI',
          'new hampshire': 'NH', 'maine': 'ME', 'montana': 'MT', 'rhode island': 'RI',
          'delaware': 'DE', 'south dakota': 'SD', 'north dakota': 'ND', 'alaska': 'AK',
          'vermont': 'VT', 'wyoming': 'WY', 'district of columbia': 'DC'
        }
        if (stateMap[regionNameLower]) {
          normalized.tax_region_id = stateMap[regionNameLower]
        } else {
          normalized.tax_region_id = ''
        }
      } else {
        normalized.tax_region_id = ''
      }
    }
  } else if (!normalized.tax_region_id || normalized.tax_region_id === 0 || normalized.tax_region_id === '0') {
    // Empty or 0 - means all states
    normalized.tax_region_id = ''
  }

  return normalized
}

/**
 * Normalize an array of tax rates
 * @param {Array} rates - Array of tax rate objects
 * @returns {Array} Array of normalized tax rates
 */
export const normalizeTaxRates = (rates) => {
  if (!Array.isArray(rates)) return []
  return rates.map(normalizeTaxRate)
}

