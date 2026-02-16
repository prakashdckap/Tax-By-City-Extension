/**
 * Tax Rate Sync Service
 * Syncs tax rates from Magento SaaS API to local storage
 * Filters out city and ZIP code ranges as per requirements
 */

import actionWebInvoke from './utils'
import allActions from './config.json'
import { getStatesForCountry } from './countries-states'

/**
 * Fetch all tax rates from Magento
 * @param {string} commerceDomain - Commerce domain
 * @param {string} instanceId - Instance ID
 * @param {string} accessToken - Access token
 * @param {string} orgId - Organization ID
 * @returns {Promise<Array>} Array of tax rates
 */
export const fetchTaxRatesFromMagento = async (commerceDomain, instanceId, accessToken, orgId) => {
  try {
    // Get manage-tax action URL (use magento-tax-rate action)
    let actionUrl
    if (allActions['manage-tax']) {
      actionUrl = allActions['manage-tax']
    } else if (allActions['tax-by-city/manage-tax']) {
      actionUrl = allActions['tax-by-city/manage-tax']
    } else if (allActions['magento-tax-rate']) {
      actionUrl = allActions['magento-tax-rate']
    } else {
      // Fallback to direct action URL
      actionUrl = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/manage-tax'
    }

    // Search for all tax rates (no filters = get all)
    // Use empty search criteria to get all tax rates
    const searchCriteria = {}

    const headers = {
      'x-gw-ims-org-id': orgId,
      'authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }

    const requestData = {
      operation: 'searchTaxRates',
      commerceDomain: commerceDomain,
      instanceId: instanceId,
      accessToken: accessToken,
      searchCriteria: searchCriteria
    }

    // Call manage-tax action with searchTaxRates operation
    const response = await actionWebInvoke(actionUrl, headers, requestData)

    if (response.statusCode === 200 && response.body) {
      // Extract items from response
      // Response format: { status, message, data: { items: [...] }, items: [...] }
      const items = response.body.items || response.body.data?.items || response.body.data || []
      return Array.isArray(items) ? items : []
    }

    return []
  } catch (error) {
    console.error('Error fetching tax rates from Magento:', error)
    throw error
  }
}

/**
 * Validate and filter tax rate data
 * Removes city and ZIP code ranges as per requirements
 * @param {Object} taxRate - Tax rate from Magento
 * @returns {Object|null} Validated tax rate or null if invalid
 */
export const validateAndFilterTaxRate = (taxRate) => {
  // Skip if tax rate has city (we don't want city-based rates in sync)
  if (taxRate.city && taxRate.city.trim() !== '') {
    return null
  }

  // Skip if it's a ZIP code range (zip_is_range = 1 or has zip_from/zip_to)
  if (taxRate.zip_is_range === 1 || taxRate.zip_is_range === true || 
      (taxRate.zip_from && taxRate.zip_to)) {
    return null
  }

  // Validate required fields
  if (!taxRate.tax_country_id || !taxRate.rate) {
    return null
  }

  // Map tax_region_id to state code
  // Magento returns numeric tax_region_id (0 = all regions, or numeric ID)
  // We need to convert to state code (CA, NY, etc.) or empty string for "all"
  let stateCode = ''
  
  // If tax_region_id is 0, null, or empty, it means "all states"
  if (!taxRate.tax_region_id || taxRate.tax_region_id === 0 || taxRate.tax_region_id === '0') {
    stateCode = '' // Empty means "all states"
  } else {
    // Check if region_code is available (preferred - direct state code)
    if (taxRate.region_code && taxRate.region_code.trim() !== '') {
      stateCode = taxRate.region_code.trim().toUpperCase()
    }
    // Check if region_name is available and try to match it
    else if (taxRate.region_name && taxRate.region_name.trim() !== '') {
      const countryId = taxRate.tax_country_id || 'US'
      const states = getStatesForCountry(countryId)
      const regionName = taxRate.region_name.trim()
      
      // First, try to find state by exact name match (case-insensitive)
      let matchedState = states.find(s => 
        s.name.toLowerCase() === regionName.toLowerCase() ||
        s.id.toLowerCase() === regionName.toLowerCase()
      )
      
      // If not found and region_name looks like a code (2-3 letters), use it directly
      if (!matchedState && /^[A-Z]{2,3}$/i.test(regionName)) {
        stateCode = regionName.toUpperCase()
      }
      // If still not found, try US state name mapping
      else if (!matchedState && countryId === 'US') {
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
          stateCode = stateMap[regionNameLower]
        } else {
          // Try partial match (e.g., "California" might be in "California State")
          matchedState = states.find(s => 
            s.name.toLowerCase().includes(regionNameLower) ||
            regionNameLower.includes(s.name.toLowerCase())
          )
          if (matchedState && matchedState.id) {
            stateCode = matchedState.id
          }
        }
      }
      // If we found a match in states list, use its ID
      else if (matchedState && matchedState.id) {
        stateCode = matchedState.id
      }
    }
    
    // If we still don't have a state code, check if tax_region_id itself is a code
    if (!stateCode && typeof taxRate.tax_region_id === 'string' && /^[A-Z]{2,3}$/i.test(taxRate.tax_region_id)) {
      stateCode = taxRate.tax_region_id.toUpperCase()
    }
    
    // Final fallback: if we have a numeric ID but no mapping, leave empty (will show as "All")
    // In production, you might want to fetch region details from Magento API using the numeric ID
    if (!stateCode) {
      console.warn(`Could not map tax_region_id ${taxRate.tax_region_id} to state code for country ${taxRate.tax_country_id}. region_name: ${taxRate.region_name || 'N/A'}`)
      stateCode = '' // Will show as "All States" in UI
    }
  }

  // If stateCode is still empty, try to extract from tax_identifier
  if (!stateCode || stateCode === '') {
    const taxIdentifier = taxRate.tax_identifier || taxRate.code || '';
    if (taxIdentifier && typeof taxIdentifier === 'string') {
      const parts = taxIdentifier.split('-');
      if (parts.length >= 2) {
        const extractedState = parts[1];
        // If it's a valid state code (not "*"), use it
        if (extractedState !== '*' && /^[A-Z]{2,3}$/.test(extractedState)) {
          stateCode = extractedState;
        }
      }
    }
  }

  // Normalize the tax rate data
  const normalizedRate = {
    id: taxRate.id || taxRate.tax_calculation_rate_id || null,
    tax_country_id: taxRate.tax_country_id,
    tax_region_id: stateCode, // Use state code instead of numeric ID (extracted from tax_identifier if needed)
    tax_postcode: taxRate.tax_postcode || '*',
    rate: parseFloat(taxRate.rate) || 0,
    city: null, // Explicitly set to null (no city-based rates)
    zip_is_range: false, // Explicitly set to false (no ZIP ranges)
    zip_from: null,
    zip_to: null,
    status: taxRate.status !== undefined ? taxRate.status : true,
    magento_tax_rate_id: taxRate.id || taxRate.tax_calculation_rate_id || null,
    tax_identifier: taxRate.tax_identifier || taxRate.code || null, // Capture tax identifier from Magento
    code: taxRate.code || taxRate.tax_identifier || null, // Capture code from Magento
    synced_from_magento: true, // Flag to indicate this came from Magento
    synced_at: new Date().toISOString()
  }

  return normalizedRate
}

/**
 * Merge Magento tax rates with local storage
 * Updates existing rates and adds new ones
 * @param {Array} magentoTaxRates - Tax rates from Magento
 * @returns {Array} Merged tax rates
 */
export const mergeTaxRates = (magentoTaxRates) => {
  // Get existing local rates
  const savedRates = localStorage.getItem('taxByCityRates')
  let localRates = savedRates ? JSON.parse(savedRates) : []
  
  // Filter out rates that were synced from Magento (to avoid duplicates)
  localRates = localRates.filter(rate => !rate.synced_from_magento)

  // Validate and filter Magento rates
  const validatedMagentoRates = magentoTaxRates
    .map(validateAndFilterTaxRate)
    .filter(rate => rate !== null)

  // Create a map of existing rates by key (country + region + postcode + rate)
  const existingRatesMap = new Map()
  localRates.forEach(rate => {
    const key = `${rate.tax_country_id}_${rate.tax_region_id || ''}_${rate.tax_postcode || '*'}_${rate.rate}`
    existingRatesMap.set(key, rate)
  })

  // Merge Magento rates
  validatedMagentoRates.forEach(magentoRate => {
    const key = `${magentoRate.tax_country_id}_${magentoRate.tax_region_id || ''}_${magentoRate.tax_postcode || '*'}_${magentoRate.rate}`
    
    if (existingRatesMap.has(key)) {
      // Update existing rate with Magento data (but preserve local ID if it exists)
      const existingRate = existingRatesMap.get(key)
      existingRatesMap.set(key, {
        ...existingRate,
        ...magentoRate,
        id: existingRate.id || magentoRate.id, // Keep local ID if exists
        magento_tax_rate_id: magentoRate.magento_tax_rate_id || magentoRate.id
      })
    } else {
      // Add new rate from Magento
      existingRatesMap.set(key, magentoRate)
    }
  })

  // Convert map back to array
  const mergedRates = Array.from(existingRatesMap.values())

  // Save to localStorage
  localStorage.setItem('taxByCityRates', JSON.stringify(mergedRates))
  localStorage.setItem('lastSyncTime', new Date().toISOString())

  return mergedRates
}

/**
 * Sync tax rates from Magento
 * @param {Object} config - Sync configuration
 * @param {string} config.commerceDomain - Commerce domain
 * @param {string} config.instanceId - Instance ID
 * @param {string} config.accessToken - Access token
 * @param {string} config.orgId - Organization ID
 * @returns {Promise<Object>} Sync result
 */
export const syncTaxRatesFromMagento = async (config) => {
  const { commerceDomain, instanceId, accessToken, orgId } = config

  if (!commerceDomain || !accessToken) {
    throw new Error('Commerce domain and access token are required for sync')
  }

  try {
    // Fetch tax rates from Magento
    const magentoTaxRates = await fetchTaxRatesFromMagento(
      commerceDomain,
      instanceId,
      accessToken,
      orgId
    )

    // Merge with local storage
    const mergedRates = mergeTaxRates(magentoTaxRates)

    return {
      success: true,
      message: `Synced ${magentoTaxRates.length} tax rates from Magento. ${mergedRates.length} total rates in local storage.`,
      syncedCount: magentoTaxRates.length,
      totalCount: mergedRates.length,
      filteredCount: magentoTaxRates.length - mergedRates.filter(r => r.synced_from_magento).length,
      rates: mergedRates
    }
  } catch (error) {
    console.error('Sync error:', error)
    return {
      success: false,
      message: `Sync failed: ${error.message}`,
      error: error.message
    }
  }
}

