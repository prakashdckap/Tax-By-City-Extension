/**
 * Region Mapper Utility
 * Maps state codes (CA, NY, etc.) to Magento region names/IDs
 * and vice versa for proper integration with Magento API
 */

import { getStatesForCountry } from './countries-states'

/**
 * Convert state code to region name for Magento API
 * Magento API accepts region_name (e.g., "California", "New York")
 * @param {string} stateCode - State code (e.g., "CA", "NY") or empty string for "all"
 * @param {string} countryId - Country ID (e.g., "US")
 * @returns {string|null} Region name or null for "all regions"
 */
export const stateCodeToRegionName = (stateCode, countryId = 'US') => {
  if (!stateCode || stateCode.trim() === '') {
    return null // null means "all regions" in Magento
  }

  const states = getStatesForCountry(countryId)
  const state = states.find(s => s.id === stateCode.trim().toUpperCase())
  
  if (state && state.name) {
    return state.name
  }

  // If not found, return the code itself (Magento might accept it)
  return stateCode.trim()
}

/**
 * Magento US State to Region ID Mapping
 * Based on Magento's standard region_id values for US states
 */
const US_STATE_TO_REGION_ID = {
  'AL': 1,  // Alabama
  'AK': 2,  // Alaska
  'AS': 3,  // American Samoa
  'AZ': 4,  // Arizona
  'AR': 5,  // Arkansas
  'AF': 6,  // Armed Forces Africa
  'AA': 7,  // Armed Forces Americas
  'AC': 8,  // Armed Forces Canada
  'AE': 9,  // Armed Forces Europe
  'AM': 10, // Armed Forces Middle East
  'AP': 11, // Armed Forces Pacific
  'CA': 12, // California
  'CO': 13, // Colorado
  'CT': 14, // Connecticut
  'DE': 15, // Delaware
  'DC': 16, // District of Columbia
  'FM': 17, // Federated States Of Micronesia
  'FL': 18, // Florida
  'GA': 19, // Georgia
  'GU': 20, // Guam
  'HI': 21, // Hawaii
  'ID': 22, // Idaho
  'IL': 23, // Illinois
  'IN': 24, // Indiana
  'IA': 25, // Iowa
  'KS': 26, // Kansas
  'KY': 27, // Kentucky
  'LA': 28, // Louisiana
  'ME': 29, // Maine
  'MH': 30, // Marshall Islands
  'MD': 31, // Maryland
  'MA': 32, // Massachusetts
  'MI': 33, // Michigan
  'MN': 34, // Minnesota
  'MS': 35, // Mississippi
  'MO': 36, // Missouri
  'MT': 37, // Montana
  'NE': 38, // Nebraska
  'NV': 39, // Nevada
  'NH': 40, // New Hampshire
  'NJ': 41, // New Jersey
  'NM': 42, // New Mexico
  'NY': 43, // New York
  'NC': 44, // North Carolina
  'ND': 45, // North Dakota
  'MP': 46, // Northern Mariana Islands
  'OH': 47, // Ohio
  'OK': 48, // Oklahoma
  'OR': 49, // Oregon
  'PW': 50, // Palau
  'PA': 51, // Pennsylvania
  'PR': 52, // Puerto Rico
  'RI': 53, // Rhode Island
  'SC': 54, // South Carolina
  'SD': 55, // South Dakota
  'TN': 56, // Tennessee
  'TX': 57, // Texas
  'UT': 58, // Utah
  'VT': 59, // Vermont
  'VI': 60, // Virgin Islands
  'VA': 61, // Virginia
  'WA': 62, // Washington
  'WV': 63, // West Virginia
  'WI': 64, // Wisconsin
  'WY': 65  // Wyoming
};

/**
 * Convert state code to numeric region ID for Magento
 * @param {string} stateCode - State code (e.g., "CA", "NY", "AK")
 * @param {string} countryId - Country ID (e.g., "US")
 * @returns {number} Numeric region ID or 0 for "all"
 */
export const stateCodeToRegionId = (stateCode, countryId = 'US') => {
  if (!stateCode || stateCode.trim() === '') {
    return 0 // 0 means "all regions" in Magento
  }

  if (countryId === 'US') {
    const normalizedStateCode = stateCode.trim().toUpperCase()
    return US_STATE_TO_REGION_ID[normalizedStateCode] || 0
  }

  // For other countries, return 0 (all regions) - would need country-specific mappings
  return 0
}

/**
 * Prepare tax_region_id, region_name, and region_code for Magento API
 * @param {string} stateCode - State code from form (e.g., "CA", "NY") or empty for "all"
 * @param {string} countryId - Country ID (e.g., "US")
 * @returns {Object} Object with tax_region_id, region_name, and region_code
 */
export const prepareRegionForMagento = (stateCode, countryId = 'US') => {
  if (!stateCode || stateCode.trim() === '') {
    // Empty state code means "all regions"
    return {
      tax_region_id: 0,
      region_name: null,
      region_code: null
    }
  }

  const normalizedStateCode = stateCode.trim().toUpperCase()
  const regionName = stateCodeToRegionName(normalizedStateCode, countryId)
  const regionId = stateCodeToRegionId(normalizedStateCode, countryId)
  
  return {
    tax_region_id: regionId, // Use numeric region ID for Magento (required!)
    region_name: regionName, // Also include region name for display
    region_code: normalizedStateCode // Include state code for reference
  }
}

