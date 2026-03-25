/* 
* Tax Rate Manager Component for Adobe App Builder
* Manages tax rates via Magento REST API
*/

import React, { useState } from 'react'
import PropTypes from 'prop-types'
import {
  Flex,
  Heading,
  Text,
  Form,
  TextField,
  NumberField,
  Button,
  View,
  TableView,
  TableHeader,
  TableBody,
  Row,
  Cell,
  Column,
  StatusLight,
  Dialog,
  DialogTrigger,
  Content,
  ButtonGroup,
  Checkbox,
  Divider,
  ActionButton,
  Tooltip,
  TooltipTrigger,
  SearchField,
  Picker,
  Item,
  ToggleButton
} from '@adobe/react-spectrum'
import actionWebInvoke from '../utils'
import allActions from '../config.json'
import { buildActionHeaders, getConfiguredActionUrl } from '../runtimeConfig'
import { countries, getStatesForCountry, getStateName } from '../countries-states'
import { syncTaxRatesFromMagento } from '../syncService'
import { prepareRegionForMagento } from '../regionMapper'
import { normalizeTaxRates } from '../normalizeTaxRates'
import DocumentIcon from '@spectrum-icons/workflow/Document'
import Edit from '@spectrum-icons/workflow/Edit'
import Delete from '@spectrum-icons/workflow/Delete'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import ChevronRight from '@spectrum-icons/workflow/ChevronRight'

const TaxRateManager = (props) => {
  const [taxRates, setTaxRates] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [viewMode, setViewMode] = useState('table') // 'table' or 'cards'
  
  // Sync status tracking
  const [syncStatus, setSyncStatus] = useState('idle') // 'idle', 'syncing', 'success', 'error'
  const [lastSyncTime, setLastSyncTime] = useState(null)
  const [syncMessage, setSyncMessage] = useState('')
  
  // Datatable features
  const [searchQuery, setSearchQuery] = useState('')
  const [sortDescriptor, setSortDescriptor] = useState({ column: null, direction: 'asc' })
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [filterStatus, setFilterStatus] = useState('all') // 'all', 'active', 'inactive'
  
  // Column-specific filters (Magento style)
  const [columnFilters, setColumnFilters] = useState({
    taxIdentifier: '',
    country: '',
    state: '',
    zip: '',
    city: '',
    rate: '',
    status: ''
  })
  
  const [formData, setFormData] = useState({
    id: null,
    tax_country_id: 'US',
    tax_region_id: '',
    tax_postcode: '',
    rate: '',
    city: '',
    zip_is_range: false,
    zip_from: '',
    zip_to: '',
    status: true,
    code: '', // Custom code/name for tax identifier (e.g., "Rate 1")
    tax_identifier: '' // Tax identifier from Magento
  })
  
  // Magento sync settings - loaded from Configuration page
  const [magentoSettings, setMagentoSettings] = useState({
    commerceDomain: '',
    instanceId: '',
    syncToMagento: true, // Default checked
    runtimeBasicAuth: '', // Basic auth token for Runtime (should be from .env/config)
    autoSyncEnabled: false,
    autoSyncInterval: 10 // minutes
  })

  const handleInputChange = (field, value) => {
    setFormData(prev => {
      const newData = {
        ...prev,
        [field]: value
      }
      // Reset state/region when country changes
      if (field === 'tax_country_id') {
        newData.tax_region_id = ''
      }
      return newData
    })
  }

  // ZIP code validation function
  const validateZipCode = (zip, countryId, isRange = false) => {
    // Allow wildcard
    if (zip === '*' || zip === '') {
      return { valid: true, message: '' }
    }

    // Remove spaces and hyphens for validation
    const cleanZip = zip.replace(/[\s-]/g, '')

    // Country-specific validation
    switch (countryId) {
      case 'US':
        // US ZIP: 5 digits, optional +4 extension (9 digits total)
        if (isRange) {
          // For ranges, allow 5 digits only
          if (!/^\d{5}$/.test(cleanZip)) {
            return { valid: false, message: 'US ZIP code must be 5 digits (e.g., 90001)' }
          }
        } else {
          // Single ZIP: 5 digits or 5+4 format
          if (!/^\d{5}(\d{4})?$/.test(cleanZip)) {
            return { valid: false, message: 'US ZIP code must be 5 digits or 5+4 format (e.g., 90001 or 90001-1234)' }
          }
        }
        break

      case 'CA':
        // Canadian postal code: A1A 1A1 format (6 characters, alternating letter-number)
        if (!/^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/.test(zip)) {
          return { valid: false, message: 'Canadian postal code must be in format A1A 1A1 (e.g., K1A 0B1)' }
        }
        break

      case 'GB':
        // UK postcode: Various formats, but generally alphanumeric
        if (!/^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i.test(zip)) {
          return { valid: false, message: 'UK postcode must be valid format (e.g., SW1A 1AA)' }
        }
        break

      case 'AU':
        // Australian postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Australian postcode must be 4 digits (e.g., 2000)' }
        }
        break

      case 'IN':
        // Indian PIN: 6 digits
        if (!/^\d{6}$/.test(cleanZip)) {
          return { valid: false, message: 'Indian PIN code must be 6 digits (e.g., 110001)' }
        }
        break

      case 'DE':
        // German postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'German postcode must be 5 digits (e.g., 10115)' }
        }
        break

      case 'FR':
        // French postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'French postcode must be 5 digits (e.g., 75001)' }
        }
        break

      case 'IT':
        // Italian postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Italian postcode must be 5 digits (e.g., 00118)' }
        }
        break

      case 'ES':
        // Spanish postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Spanish postcode must be 5 digits (e.g., 28001)' }
        }
        break

      case 'NL':
        // Dutch postcode: 4 digits + 2 letters (1234 AB)
        if (!/^\d{4}\s?[A-Za-z]{2}$/.test(zip)) {
          return { valid: false, message: 'Dutch postcode must be 4 digits + 2 letters (e.g., 1012 AB)' }
        }
        break

      case 'BE':
        // Belgian postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Belgian postcode must be 4 digits (e.g., 1000)' }
        }
        break

      case 'AT':
        // Austrian postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Austrian postcode must be 4 digits (e.g., 1010)' }
        }
        break

      case 'CH':
        // Swiss postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Swiss postcode must be 4 digits (e.g., 8001)' }
        }
        break

      case 'SE':
        // Swedish postcode: 5 digits (can have space: 123 45)
        if (!/^\d{3}\s?\d{2}$/.test(cleanZip)) {
          return { valid: false, message: 'Swedish postcode must be 5 digits (e.g., 12345)' }
        }
        break

      case 'NO':
        // Norwegian postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Norwegian postcode must be 4 digits (e.g., 0001)' }
        }
        break

      case 'DK':
        // Danish postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Danish postcode must be 4 digits (e.g., 1000)' }
        }
        break

      case 'FI':
        // Finnish postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Finnish postcode must be 5 digits (e.g., 00100)' }
        }
        break

      case 'PL':
        // Polish postcode: 5 digits (can have hyphen: 12-345)
        if (!/^\d{2}-?\d{3}$/.test(cleanZip)) {
          return { valid: false, message: 'Polish postcode must be 5 digits (e.g., 00-001)' }
        }
        break

      case 'CZ':
        // Czech postcode: 5 digits (can have space: 123 45)
        if (!/^\d{3}\s?\d{2}$/.test(cleanZip)) {
          return { valid: false, message: 'Czech postcode must be 5 digits (e.g., 11000)' }
        }
        break

      case 'IE':
        // Irish postcode: Various formats (Eircode: A65 F4E2 or D6W 1AF)
        if (!/^[A-Za-z0-9\s]{6,8}$/.test(zip)) {
          return { valid: false, message: 'Irish postcode must be valid Eircode format (e.g., D6W 1AF)' }
        }
        break

      case 'PT':
        // Portuguese postcode: 4 digits + hyphen + 3 digits (1234-567)
        if (!/^\d{4}-?\d{3}$/.test(cleanZip)) {
          return { valid: false, message: 'Portuguese postcode must be 7 digits (e.g., 1000-001)' }
        }
        break

      case 'GR':
        // Greek postcode: 5 digits (can have space: 123 45)
        if (!/^\d{3}\s?\d{2}$/.test(cleanZip)) {
          return { valid: false, message: 'Greek postcode must be 5 digits (e.g., 10100)' }
        }
        break

      case 'BR':
        // Brazilian CEP: 8 digits (can have hyphen: 12345-678)
        if (!/^\d{5}-?\d{3}$/.test(cleanZip)) {
          return { valid: false, message: 'Brazilian CEP must be 8 digits (e.g., 01310-100)' }
        }
        break

      case 'MX':
        // Mexican postal code: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Mexican postal code must be 5 digits (e.g., 01000)' }
        }
        break

      case 'JP':
        // Japanese postal code: 7 digits (can have hyphen: 123-4567)
        if (!/^\d{3}-?\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Japanese postal code must be 7 digits (e.g., 100-0001)' }
        }
        break

      case 'AR':
        // Argentine postal code: 4 characters (letter + 4 digits or A1234)
        if (!/^[A-Za-z]?\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Argentine postal code must be 4 digits (e.g., 1000)' }
        }
        break

      case 'CL':
        // Chilean postal code: 7 digits
        if (!/^\d{7}$/.test(cleanZip)) {
          return { valid: false, message: 'Chilean postal code must be 7 digits (e.g., 8320000)' }
        }
        break

      case 'CO':
        // Colombian postal code: 6 digits
        if (!/^\d{6}$/.test(cleanZip)) {
          return { valid: false, message: 'Colombian postal code must be 6 digits (e.g., 110111)' }
        }
        break

      case 'CN':
        // Chinese postal code: 6 digits
        if (!/^\d{6}$/.test(cleanZip)) {
          return { valid: false, message: 'Chinese postal code must be 6 digits (e.g., 100000)' }
        }
        break

      case 'KR':
        // South Korean postal code: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'South Korean postal code must be 5 digits (e.g., 03051)' }
        }
        break

      case 'SG':
        // Singapore postal code: 6 digits
        if (!/^\d{6}$/.test(cleanZip)) {
          return { valid: false, message: 'Singapore postal code must be 6 digits (e.g., 018956)' }
        }
        break

      case 'MY':
        // Malaysian postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Malaysian postcode must be 5 digits (e.g., 50000)' }
        }
        break

      case 'TH':
        // Thai postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Thai postcode must be 5 digits (e.g., 10100)' }
        }
        break

      case 'PH':
        // Philippine postal code: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'Philippine postal code must be 4 digits (e.g., 1000)' }
        }
        break

      case 'ID':
        // Indonesian postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Indonesian postcode must be 5 digits (e.g., 10110)' }
        }
        break

      case 'VN':
        // Vietnamese postcode: 5-6 digits
        if (!/^\d{5,6}$/.test(cleanZip)) {
          return { valid: false, message: 'Vietnamese postcode must be 5-6 digits (e.g., 100000)' }
        }
        break

      case 'NZ':
        // New Zealand postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'New Zealand postcode must be 4 digits (e.g., 1010)' }
        }
        break

      case 'ZA':
        // South African postcode: 4 digits
        if (!/^\d{4}$/.test(cleanZip)) {
          return { valid: false, message: 'South African postcode must be 4 digits (e.g., 0001)' }
        }
        break

      case 'AE':
        // UAE doesn't use traditional postcodes, but some areas have codes
        // Allow alphanumeric format
        if (!/^[A-Za-z0-9\s-]{3,10}$/.test(zip)) {
          return { valid: false, message: 'UAE postcode must be 3-10 alphanumeric characters' }
        }
        break

      case 'SA':
        // Saudi Arabian postcode: 5 digits (can have hyphen: 12345 or 123-45)
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Saudi Arabian postcode must be 5 digits (e.g., 11564)' }
        }
        break

      case 'IL':
        // Israeli postcode: 7 digits (can have hyphen: 1234567 or 123-4567)
        if (!/^\d{7}$/.test(cleanZip)) {
          return { valid: false, message: 'Israeli postcode must be 7 digits (e.g., 9100001)' }
        }
        break

      case 'TR':
        // Turkish postcode: 5 digits
        if (!/^\d{5}$/.test(cleanZip)) {
          return { valid: false, message: 'Turkish postcode must be 5 digits (e.g., 34000)' }
        }
        break

      case 'RU':
        // Russian postcode: 6 digits
        if (!/^\d{6}$/.test(cleanZip)) {
          return { valid: false, message: 'Russian postcode must be 6 digits (e.g., 101000)' }
        }
        break

      default:
        // Generic validation: alphanumeric, 3-10 characters
        if (!/^[A-Za-z0-9\s-]{3,10}$/.test(zip)) {
          return { valid: false, message: 'Postcode must be 3-10 alphanumeric characters' }
        }
    }

    return { valid: true, message: '' }
  }

  // Validate ZIP code range
  const validateZipRange = (zipFrom, zipTo, countryId) => {
    const fromValidation = validateZipCode(zipFrom, countryId, true)
    if (!fromValidation.valid) {
      return { valid: false, message: `ZIP From: ${fromValidation.message}` }
    }

    const toValidation = validateZipCode(zipTo, countryId, true)
    if (!toValidation.valid) {
      return { valid: false, message: `ZIP To: ${toValidation.message}` }
    }

    // Compare numeric values for range validation
    const fromNum = parseInt(zipFrom.replace(/[\s-]/g, ''), 10)
    const toNum = parseInt(zipTo.replace(/[\s-]/g, ''), 10)

    if (!isNaN(fromNum) && !isNaN(toNum)) {
      if (fromNum >= toNum) {
        return { valid: false, message: 'ZIP From must be less than ZIP To' }
      }
    }

    return { valid: true, message: '' }
  }

  // Datatable filtering and sorting functions
  // Helper function to format tax identifier (like "US-AK-13" or "US-NY-*-Rate 1")
  const formatTaxIdentifier = (rate) => {
    // If tax_identifier exists and is a string (like "US-AK-13"), use it directly
    if (rate.tax_identifier && typeof rate.tax_identifier === 'string') {
      return rate.tax_identifier
    }
    // If code exists (from Magento), use it
    if (rate.code) {
      return rate.code
    }
    // Format as country-state-rate or country-state-*-code (matching Magento format)
    const country = rate.tax_country_id || 'US'
    // Use "*" if state is empty, null, or "ALL"
    const state = (!rate.tax_region_id || rate.tax_region_id === 'ALL' || rate.tax_region_id === '*') ? '*' : rate.tax_region_id
    const rateValue = rate.rate || ''
    const customCode = rate.code || ''
    
    // Format: US-AK-13 (country-state-rate) or US-NY-*-Rate 1 (country-state-*-code)
    if (state === '*' && customCode) {
      // When state is "*" and there's a custom code
      return `${country}-${state}-${customCode}`
    } else if (state === '*' && rateValue) {
      // When state is "*" and there's a rate
      return `${country}-${state}-${rateValue}`
    } else if (rateValue) {
      // Standard format: country-state-rate
      return `${country}-${state}-${rateValue}`
    }
    // Fallback
    return `${country}-${state}-*`
  }

  const getFilteredAndSortedRates = () => {
    let filtered = [...taxRates]

    // Apply column-specific filters (Magento style)
    if (columnFilters.taxIdentifier) {
      filtered = filtered.filter(rate => {
        const identifier = formatTaxIdentifier(rate)
        return identifier.toLowerCase().includes(columnFilters.taxIdentifier.toLowerCase())
      })
    }
    if (columnFilters.country) {
      filtered = filtered.filter(rate => 
        (rate.tax_country_id || '').toLowerCase().includes(columnFilters.country.toLowerCase())
      )
    }
    if (columnFilters.state) {
      filtered = filtered.filter(rate => 
        (rate.tax_region_id || '').toLowerCase().includes(columnFilters.state.toLowerCase())
      )
    }
    if (columnFilters.zip) {
      filtered = filtered.filter(rate => {
        const zipDisplay = (rate.zip_is_range && rate.zip_from && rate.zip_to)
          ? `${rate.zip_from}-${rate.zip_to}`
          : (rate.tax_postcode || '*')
        return zipDisplay.toLowerCase().includes(columnFilters.zip.toLowerCase())
      })
    }
    if (columnFilters.city) {
      filtered = filtered.filter(rate => 
        (rate.city || '').toLowerCase().includes(columnFilters.city.toLowerCase())
      )
    }
    if (columnFilters.rate) {
      filtered = filtered.filter(rate => 
        (rate.rate || '').toString().includes(columnFilters.rate)
      )
    }
    if (columnFilters.status) {
      filtered = filtered.filter(rate => {
        const isActive = rate.status !== false
        return columnFilters.status === 'active' ? isActive : !isActive
      })
    }

    // Apply global search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(rate => {
        const zipDisplay = (rate.zip_is_range && rate.zip_from && rate.zip_to)
          ? `${rate.zip_from}-${rate.zip_to}`
          : (rate.tax_postcode || '*')
        return (
          (rate.tax_country_id || '').toLowerCase().includes(query) ||
          (rate.tax_region_id || '').toLowerCase().includes(query) ||
          zipDisplay.toLowerCase().includes(query) ||
          (rate.city || '').toLowerCase().includes(query) ||
          (rate.rate || '').toString().includes(query)
        )
      })
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(rate => {
        const isActive = rate.status !== false
        return filterStatus === 'active' ? isActive : !isActive
      })
    }

    // Apply sorting
    if (sortDescriptor.column) {
      filtered.sort((a, b) => {
        let aVal, bVal
        
        switch (sortDescriptor.column) {
          case 'taxIdentifier':
            aVal = formatTaxIdentifier(a).toLowerCase()
            bVal = formatTaxIdentifier(b).toLowerCase()
            break
          case 'country':
            aVal = (a.tax_country_id || '').toLowerCase()
            bVal = (b.tax_country_id || '').toLowerCase()
            break
          case 'state':
            aVal = (a.tax_region_id || '').toLowerCase()
            bVal = (b.tax_region_id || '').toLowerCase()
            break
          case 'zip':
            aVal = (a.zip_is_range && a.zip_from && a.zip_to)
              ? `${a.zip_from}-${a.zip_to}`
              : (a.tax_postcode || '*')
            bVal = (b.zip_is_range && b.zip_from && b.zip_to)
              ? `${b.zip_from}-${b.zip_to}`
              : (b.tax_postcode || '*')
            break
          case 'city':
            aVal = (a.city || '').toLowerCase()
            bVal = (b.city || '').toLowerCase()
            break
          case 'rate':
            aVal = parseFloat(a.rate || 0)
            bVal = parseFloat(b.rate || 0)
            break
          case 'status':
            aVal = a.status !== false ? 1 : 0
            bVal = b.status !== false ? 1 : 0
            break
          default:
            return 0
        }

        if (aVal < bVal) return sortDescriptor.direction === 'asc' ? -1 : 1
        if (aVal > bVal) return sortDescriptor.direction === 'asc' ? 1 : -1
        return 0
      })
    }

    return filtered
  }

  const filteredAndSortedRates = getFilteredAndSortedRates()
  const totalPages = Math.ceil(filteredAndSortedRates.length / pageSize)
  const startIndex = (currentPage - 1) * pageSize
  const endIndex = startIndex + pageSize
  const paginatedRates = filteredAndSortedRates.slice(startIndex, endIndex)

  const handleSort = (column) => {
    setSortDescriptor(prev => {
      if (prev.column === column) {
        return {
          column: column,
          direction: prev.direction === 'asc' ? 'desc' : 'asc'
        }
      }
      return {
        column: column,
        direction: 'asc'
      }
    })
  }


  const createTaxRateInMagento = async (taxRateData) => {
    if (!magentoSettings.syncToMagento || !magentoSettings.commerceDomain) {
      return null
    }

    if (!props.ims?.token) {
      throw new Error('Access token is required. Please ensure you are logged in.')
    }

    try {
      // Convert state code to Magento region format
      const regionData = prepareRegionForMagento(
        taxRateData.tax_region_id || '',
        taxRateData.tax_country_id || 'US'
      )

      // Determine operation type (create or update)
      const isUpdate = taxRateData.id && taxRateData.magento_tax_rate_id
      const operation = isUpdate ? 'updateTaxRate' : 'POST'

      // Prepare tax rate data matching the exact Commerce API payload structure
      // Note: Magento Commerce API does NOT support region_code, only region_name
      const magentoTaxRate = {
        id: isUpdate ? taxRateData.magento_tax_rate_id : null, // Use Magento ID for updates
        tax_country_id: taxRateData.tax_country_id || 'US',
        tax_region_id: regionData.tax_region_id, // 0 for all or specific region
        region_name: regionData.region_name, // Region name (e.g., "California", "New York") - Magento uses this for display
        tax_postcode: taxRateData.zip_is_range ? null : (taxRateData.tax_postcode || '*'),
        rate: parseFloat(taxRateData.rate),
        city: taxRateData.city || null,
        zip_is_range: taxRateData.zip_is_range ? 1 : 0, // Commerce API expects 0 or 1 (integer)
        zip_from: taxRateData.zip_is_range && taxRateData.zip_from ? taxRateData.zip_from : null,
        zip_to: taxRateData.zip_is_range && taxRateData.zip_to ? taxRateData.zip_to : null,
        status: taxRateData.status !== undefined ? taxRateData.status : true,
        magento_tax_rate_id: taxRateData.magento_tax_rate_id || null,
        code: taxRateData.code || null // Custom code/name for tax identifier
      }

      // Remove null/empty values for optional fields (but keep region_name even if null for "all regions")
      Object.keys(magentoTaxRate).forEach(key => {
        if (key === 'region_name' && magentoTaxRate[key] === null) {
          // Keep null region_name (means all regions) - don't delete it
          return
        }
        if (magentoTaxRate[key] === null || magentoTaxRate[key] === '') {
          delete magentoTaxRate[key]
        }
      })

      // Prepare request payload for tax-rate action (which will proxy to manage-tax)
      // The tax-rate action accepts the same format and forwards to manage-tax
      const requestData = {
        operation: operation, // POST for create, updateTaxRate for update
        commerceDomain: magentoSettings.commerceDomain,
        instanceId: magentoSettings.instanceId || null,
        accessToken: props.ims.token, // Access token from IMS (Commerce API Bearer token)
        taxRate: magentoTaxRate,
        runtimeBasicAuth: magentoSettings.runtimeBasicAuth || '' // Basic auth for Runtime (optional, has fallback)
      }

      // Use tax-rate action (web action that supports CORS) which internally calls manage-tax
      // This avoids CORS issues since tax-rate is properly deployed as a web action
      const actionUrl = getConfiguredActionUrl(props.runtime, 'tax-rate')

      // Headers for web action (Bearer + namespace for ABDB-backed web APIs)
      const headers = {
        ...buildActionHeaders({
          ims: props.ims,
          runtime: props.runtime,
          preferredAction: 'tax-rate'
        }),
        'Content-Type': 'application/json'
      }

      // Make request using actionWebInvoke (handles CORS properly for web actions)
      const response = await actionWebInvoke(actionUrl, headers, requestData)
      
      // Handle response format from actionWebInvoke
      // The tax-rate action returns: { message, manageTaxResponse, requestData }
      // We need to extract the manageTaxResponse which contains the actual result
      if (response.statusCode === 200 && response.body) {
        // If response has manageTaxResponse, use that (from tax-rate proxy)
        if (response.body.manageTaxResponse) {
          const manageTaxBody = response.body.manageTaxResponse.body || response.body.manageTaxResponse
          const magentoResponse = manageTaxBody.magento || manageTaxBody.data
          
          // Extract tax_identifier from Magento response
          const taxIdentifier = magentoResponse?.tax_identifier || 
                               magentoResponse?.code || 
                               magentoResponse?.response?.tax_identifier ||
                               magentoResponse?.response?.code ||
                               null
          
          // Return in the format expected by the calling code
          return {
            status: manageTaxBody.status || 'Success',
            message: manageTaxBody.message,
            data: manageTaxBody.data,
            existing: manageTaxBody.existing,
            httpStatus: manageTaxBody.httpStatus,
            taxIdentifier: taxIdentifier // Include tax identifier from Magento
          }
        }
        // Otherwise return the body directly
        return response.body
      } else if (response.status === 'Success') {
        return response
      } else {
        const errorMessage = response.body?.message || response.body?.manageTaxResponse?.body?.message || response.message || response.error || 'Failed to create tax rate in Magento'
        throw new Error(errorMessage)
      }
    } catch (err) {
      console.error('Error creating tax rate in Magento:', err)
      throw err
    }
  }

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)

    try {
      // Validate required fields
      if (!formData.tax_country_id) {
        setError('Country is required')
        setLoading(false)
        return
      }

      if (!formData.rate || isNaN(parseFloat(formData.rate))) {
        setError('Tax rate is required and must be a valid number')
        setLoading(false)
        return
      }

      // Validate ZIP code
      let zipValidation = { valid: true, message: '' }
      if (formData.zip_is_range) {
        if (!formData.zip_from || !formData.zip_to) {
          setError('ZIP From and ZIP To are required when using ZIP code range')
          setLoading(false)
          return
        }
        zipValidation = validateZipRange(formData.zip_from, formData.zip_to, formData.tax_country_id)
      } else {
        // Single postcode - allow empty or * for "all"
        if (formData.tax_postcode && formData.tax_postcode !== '*') {
          zipValidation = validateZipCode(formData.tax_postcode, formData.tax_country_id, false)
        }
      }

      if (!zipValidation.valid) {
        setError(zipValidation.message)
        setLoading(false)
        return
      }

      const headers = buildActionHeaders({
        ims: props.ims,
        runtime: props.runtime,
        preferredAction: 'create-tax-rate'
      })

      // For updates, check for duplicates in the frontend first (client-side validation)
      // The backend will also check, but this provides immediate feedback
      if (formData.id) {
        const currentRateId = formData.id
        const potentialDuplicate = taxRates.find(rate => {
          const rateId = rate._id || rate.id || rate.tax_calculation_rate_id
          // Skip the current record being updated
          if (String(rateId) === String(currentRateId)) {
            return false
          }
          
          // Check if all key fields match
          const sameCountry = (rate.tax_country_id || 'US') === (formData.tax_country_id || 'US')
          const sameState = (rate.tax_region_id || '') === (formData.tax_region_id || '')
          const samePostcode = (rate.tax_postcode || '*') === (formData.zip_is_range ? null : (formData.tax_postcode || '*'))
          const sameCity = (rate.city || '') === (formData.city || '')
          const sameRate = parseFloat(rate.rate || 0) === parseFloat(formData.rate || 0)
          
          return sameCountry && sameState && samePostcode && sameCity && sameRate
        })
        
        if (potentialDuplicate) {
          const location = [
            potentialDuplicate.tax_country_id || 'US',
            potentialDuplicate.tax_region_id || 'All States',
            potentialDuplicate.tax_postcode || '*',
            potentialDuplicate.city || 'All Cities'
          ].filter(Boolean).join(', ')
          setError(`A tax rate with the same location (${location}) and rate (${potentialDuplicate.rate}%) already exists. Please use a different combination.`)
          setLoading(false)
          return
        }
      }

      // Convert form data to tax rate format
      const taxRateData = {
        id: formData.id || null,
        tax_country_id: formData.tax_country_id,
        tax_region_id: formData.tax_region_id === '' || formData.tax_region_id === null || formData.tax_region_id === undefined ? '' : formData.tax_region_id,
        tax_postcode: formData.zip_is_range ? null : (formData.tax_postcode || '*'),
        rate: parseFloat(formData.rate),
        city: formData.city || null,
        zip_is_range: formData.zip_is_range,
        zip_from: formData.zip_is_range ? formData.zip_from : null,
        zip_to: formData.zip_is_range ? formData.zip_to : null,
        status: formData.status !== undefined ? formData.status : true,
        magento_tax_rate_id: formData.magento_tax_rate_id || null,
        code: formData.code || null, // Custom code/name for tax identifier
        tax_identifier: formData.tax_identifier || null // Tax identifier from Magento
      }

      // Determine if this is a create or update operation
      const isUpdate = formData.id ? true : false
      
      // Prepare request body
      const requestBody = {
        taxRate: taxRateData,
        region: 'amer', // Default region
        commerceDomain: magentoSettings.commerceDomain || undefined,
        instanceId: magentoSettings.instanceId || undefined,
        accessToken: props.ims?.token || undefined
      }

      // If updating, include the _id for MongoDB
      if (isUpdate) {
        requestBody._id = formData.id
      }

      // Get action URL from config or runtime - use create-tax-rate or update-tax-rate endpoint
      const actionName = isUpdate ? 'update-tax-rate' : 'create-tax-rate'
      const actionUrl = getConfiguredActionUrl(props.runtime, actionName)
      
      if (actionUrl) {
        try {
          // Use POST method for both create and update actions
          const response = await actionWebInvoke(actionUrl, headers, requestBody, { method: 'POST' })
          
          console.log(`${isUpdate ? 'Update' : 'Create'} tax rate response:`, JSON.stringify(response, null, 2))
          
          // Handle response format: { statusCode: 200, body: { status: 'Success', ... } }
          // or direct format: { status: 'Success', ... }
          // Also check for statusCode 201 (created) or 200 (updated)
          const isSuccess = response.statusCode === 200 || 
                           response.statusCode === 201 || 
                           (response.body && response.body.status === 'Success') ||
                           (response && response.status === 'Success')
          
          if (isSuccess) {
            // Extract tax_identifier from response if available
            const responseBody = response.body || response
            const taxIdentifier = responseBody.tax_identifier || 
                                 responseBody.magento?.taxIdentifier ||
                                 responseBody.magento?.response?.tax_identifier ||
                                 responseBody.magento?.response?.code ||
                                 null
            
            // Extract magento_tax_rate_id for future updates
            const magentoId = responseBody.magento?.response?.id ||
                             responseBody.magento?.numericId ||
                             responseBody.id ||
                             null
            
            // Show success message
            setSuccessMessage(isUpdate ? 'Tax rate updated successfully!' : 'Tax rate created successfully!')
            setError(null)
            
            // Clear success message after 3 seconds
            setTimeout(() => {
              setSuccessMessage(null)
            }, 3000)
            
            setShowForm(false)
            setFormData({
              id: null,
              tax_country_id: 'US',
              tax_region_id: '',
              tax_postcode: '',
              rate: '',
              city: '',
              zip_is_range: false,
              zip_from: '',
              zip_to: '',
              status: true,
              code: '',
              tax_identifier: ''
            })
            // Refresh list from App Builder Database to get updated tax_identifier
            loadTaxRates()
            return
          } else {
            // Check for error in response
            // Handle duplicate error (409 Conflict) with detailed message
            const errorBody = response.body || response
            const errorMsgLower = (errorBody.message || errorBody.error || '').toLowerCase()
            if (response.statusCode === 409 || 
                (response.body?.status === 'Error' && 
                 (errorMsgLower.includes('duplicate') || 
                  errorMsgLower.includes('already exists') ||
                  errorMsgLower.includes('same location')))) {
              const errorMsg = errorBody.message || errorBody.error || 'Duplicate tax rate already exists'
              const existingRecord = errorBody.existingRecord
              
              // Build detailed duplicate error message
              let duplicateMessage = errorMsg
              if (existingRecord) {
                const location = [
                  existingRecord.tax_country_id || 'US',
                  existingRecord.tax_region_id || 'All States',
                  existingRecord.tax_postcode || '*',
                  existingRecord.city || 'All Cities'
                ].filter(Boolean).join(', ')
                duplicateMessage = `A tax rate with the same location (${location}) and rate (${existingRecord.rate}%) already exists. Please use a different combination.`
              }
              
              setError(duplicateMessage)
              setLoading(false)
              return
            }
            
            const errorMsg = response.body?.message || 
                           response.body?.error?.message || 
                           response.message || 
                           response.error ||
                           'Failed to save tax rate'
            console.error('Save tax rate error response:', response)
            throw new Error(errorMsg)
          }
        } catch (err) {
          console.error('Error saving tax rate:', err)
          console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            response: err.response
          })
          
          // Check if it's a duplicate error from the catch block
          const errorMsgLower = (err.message || '').toLowerCase()
          if (err.response?.status === 409 || 
              errorMsgLower.includes('duplicate') || 
              errorMsgLower.includes('already exists') ||
              errorMsgLower.includes('same location') ||
              errorMsgLower.includes('same data')) {
            setError(err.message || 'A tax rate with the same data already exists. Please use a different combination.')
          } else {
            setError(`Failed to save tax rate: ${err.message}`)
          }
          
          setLoading(false)
          // Don't fall back to localStorage for updates - show error instead
          if (formData.id) {
            return // Don't throw, just show error
          }
        }
      }

      // Fallback: save to localStorage
      const newRate = {
        id: formData.id || `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        tax_country_id: formData.tax_country_id,
        tax_region_id: formData.tax_region_id === '' || formData.tax_region_id === null || formData.tax_region_id === undefined ? '' : formData.tax_region_id,
        tax_postcode: formData.zip_is_range ? null : (formData.tax_postcode || '*'),
        rate: parseFloat(formData.rate),
        city: formData.city || null,
        zip_is_range: formData.zip_is_range,
        zip_from: formData.zip_is_range ? formData.zip_from : null,
        zip_to: formData.zip_is_range ? formData.zip_to : null,
        status: formData.status !== undefined ? formData.status : true
      }

      const savedRates = localStorage.getItem('taxByCityRates')
      let rates = savedRates ? JSON.parse(savedRates) : []
      
      if (formData.id) {
        // Update existing
        const index = rates.findIndex(r => r.id === formData.id)
        if (index !== -1) {
          rates[index] = { ...newRate, id: formData.id }
        } else {
          rates.push(newRate)
        }
      } else {
        // Add new
        rates.push(newRate)
      }

      // Normalize rates before saving
      const normalizedRates = normalizeTaxRates(rates)
      localStorage.setItem('taxByCityRates', JSON.stringify(normalizedRates))
      setTaxRates(normalizedRates)
      setShowForm(false)
      setFormData({
        id: null,
        tax_country_id: 'US',
        tax_region_id: '',
        tax_postcode: '',
        rate: '',
        city: '',
        zip_is_range: false,
        zip_from: '',
        zip_to: '',
        status: true
      })
      setError(null)
    } catch (err) {
      setError('Failed to save tax rate: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  const loadTaxRates = async (forceFromDatabase = false) => {
    setLoading(true)
    setError(null)

    // If forcing from database, clear localStorage first to prevent fallback
    if (forceFromDatabase) {
      console.log('Force reload from database: Clearing localStorage...')
      localStorage.removeItem('taxByCityRates')
    }

    try {
      const headers = buildActionHeaders({
        ims: props.ims,
        runtime: props.runtime,
        preferredAction: 'list-tax-rates'
      })

      // Call list-tax-rates DIRECTLY with GET ?limit=0 to get ALL records (no 20 limit)
      // Bypasses get-taxes so the limit is in the URL and always applied by list-tax-rates
      let actionUrl
      if (allActions['list-tax-rates'] && allActions['list-tax-rates'].includes('/web/')) {
        actionUrl = allActions['list-tax-rates']
        console.log('Using list-tax-rates URL from config:', actionUrl)
      } else if (allActions['tax-by-city/list-tax-rates'] && allActions['tax-by-city/list-tax-rates'].includes('/web/')) {
        actionUrl = allActions['tax-by-city/list-tax-rates']
        console.log('Using list-tax-rates URL from config:', actionUrl)
      } else {
        actionUrl = getConfiguredActionUrl(props.runtime, 'list-tax-rates')
        console.log('Constructed list-tax-rates URL:', actionUrl)
      }

      if (!actionUrl || !actionUrl.includes('/web/')) {
        throw new Error('list-tax-rates web action URL not found. Check config.json or runtime.')
      }

      try {
        new URL(actionUrl)
      } catch (urlError) {
        throw new Error(`Invalid action URL format: ${actionUrl}.`)
      }

      try {
        // GET with ?limit=0 = return ALL records (list-tax-rates only accepts GET)
        console.log('Fetching tax rates from list-tax-rates with limit=0 (all records)...', { actionUrl, forceFromDatabase })
        const response = await actionWebInvoke(actionUrl, headers, { limit: 0 }, { method: 'GET' })
          
          console.log('Response from list-tax-rates API:', JSON.stringify(response, null, 2))
          
          // Handle list-tax-rates response: { statusCode, body: { status, data: [...], pagination } } or direct { status, data, pagination }
          let rates = []
          
          // Check if response has statusCode and body (wrapped format)
          if (response && response.statusCode === 200 && response.body) {
            // Response format: { statusCode: 200, body: { status: 'Success', data: [...], pagination: {...} } }
            if (response.body.status === 'Success' && response.body.data && Array.isArray(response.body.data)) {
              rates = response.body.data
              console.log(`✓ Found ${rates.length} tax rates in response.body.data`)
            } else if (response.body.data && Array.isArray(response.body.data)) {
              rates = response.body.data
              console.log(`✓ Found ${rates.length} tax rates in response.body.data (without status check)`)
            } else if (Array.isArray(response.body)) {
              rates = response.body
              console.log(`✓ Found ${rates.length} tax rates in response.body (direct array)`)
            } else {
              console.warn('⚠ Unexpected response format in body:', response.body)
            }
          } 
          // Check if response is direct format from get-taxes: { data: [...], pagination: {...}, status: 'Success' }
          else if (response && response.status === 'Success' && response.data && Array.isArray(response.data)) {
            rates = response.data
            console.log(`✓ Found ${rates.length} tax rates in response.data (get-taxes format)`)
          }
          // Fallback: check if response has data array
          else if (response && response.data && Array.isArray(response.data)) {
            rates = response.data
            console.log(`✓ Found ${rates.length} tax rates in response.data (fallback)`)
          } else if (Array.isArray(response)) {
            rates = response
            console.log(`✓ Found ${rates.length} tax rates in response (direct array)`)
          } else {
            console.error('❌ No tax rates found in response. Response structure:', {
              hasResponse: !!response,
              keys: response ? Object.keys(response) : [],
              statusCode: response?.statusCode,
              hasBody: !!response?.body,
              bodyKeys: response?.body ? Object.keys(response.body) : [],
              hasData: !!response?.data,
              isArray: Array.isArray(response)
            })
          }

          // Normalize rates to ensure state codes are correct
          const normalizedRates = normalizeTaxRates(rates)
          setTaxRates(normalizedRates)
          
          // Clear error since we successfully loaded from database
          setError(null)
          
          // Update localStorage as backup only if we have data
          if (normalizedRates.length > 0) {
            localStorage.setItem('taxByCityRates', JSON.stringify(normalizedRates))
          } else if (forceFromDatabase) {
            // If forcing from database and no data, clear localStorage
            localStorage.removeItem('taxByCityRates')
          }
          
          console.log(`✓ Loaded ${normalizedRates.length} tax rates from App Builder Database`)
          return
        } catch (err) {
          console.error('Error loading from App Builder Database:', err)
          console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            actionUrl: actionUrl,
            params: params,
            hasImsToken: !!props.ims?.token,
            hasImsOrg: !!props.ims?.org
          })
          
          // Provide more helpful error messages
          let errorMessage = err.message
          if (err.message.includes('Failed to fetch') || err.message.includes('Network error')) {
            errorMessage = `Cannot connect to App Builder Database at ${actionUrl}.\n\nPossible causes:\n- Action not deployed or URL incorrect\n- CORS configuration issue\n- Network connectivity problem\n- Authentication token expired\n\nPlease check:\n1. Action is deployed: Run 'aio app deploy'\n2. Action URL is correct in config.json\n3. You are logged in to Adobe I/O\n4. Network connection is working`
          } else if (err.message.includes('401') || err.message.includes('403')) {
            errorMessage = `Authentication failed. Please ensure you are logged in to Adobe I/O and have proper permissions.`
          } else if (err.message.includes('404')) {
            errorMessage = `Action not found at ${actionUrl}. Please ensure the list-tax-rates action is deployed.`
          }
          
          // If forcing from database, don't fall back to localStorage
          if (forceFromDatabase) {
            setError(errorMessage)
            setTaxRates([])
            return
          }
          
          console.warn('Could not load from App Builder Database, trying localStorage:', err.message)
          setError(`${errorMessage}\n\nUsing locally saved tax rates as fallback.`)
        }

      // Fallback to localStorage only if not forcing from database
      if (!forceFromDatabase) {
        const savedRates = localStorage.getItem('taxByCityRates')
        if (savedRates) {
          try {
            const rates = JSON.parse(savedRates)
            // Normalize rates to ensure state codes are correct
            const normalizedRates = normalizeTaxRates(Array.isArray(rates) ? rates : [])
            setTaxRates(normalizedRates)
            // Update localStorage with normalized data
            if (normalizedRates.length > 0) {
              localStorage.setItem('taxByCityRates', JSON.stringify(normalizedRates))
            }
            setError('Using locally saved tax rates. Backend database is not accessible.')
          } catch (e) {
            console.error('Error parsing saved rates:', e)
            setTaxRates([])
          }
        } else {
          setTaxRates([])
        }
      } else {
        // Force from database: don't use localStorage, show error if database failed
        setError('Database connection failed. Please check your connection and try again.')
        setTaxRates([])
      }
    } catch (err) {
      console.error('Error loading tax rates:', err)
      
      // If forcing from database, don't fall back to localStorage (already cleared)
      if (forceFromDatabase) {
        setError('Unable to load tax rates from database. Please check your connection and try again.')
        setTaxRates([])
      } else {
        // Try localStorage as last resort (only if not forcing from database)
        const savedRates = localStorage.getItem('taxByCityRates')
        if (savedRates) {
          try {
            const rates = JSON.parse(savedRates)
            // Normalize rates to ensure state codes are correct
            const normalizedRates = normalizeTaxRates(Array.isArray(rates) ? rates : [])
            setTaxRates(normalizedRates)
            // Update localStorage with normalized data
            if (normalizedRates.length > 0) {
              localStorage.setItem('taxByCityRates', JSON.stringify(normalizedRates))
            }
            setError('Using locally saved tax rates. Backend database is not accessible.')
          } catch (e) {
            setError('Unable to load tax rates. Please try again or add a new tax rate.')
            setTaxRates([])
          }
        } else {
          setError('Unable to load tax rates. Please try adding a new tax rate.')
          setTaxRates([])
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (rateId) => {
    if (!window.confirm('Are you sure you want to delete this tax rate?')) {
      return
    }

    setLoading(true)
    setError(null)

    try {
      const headers = buildActionHeaders({
        ims: props.ims,
        runtime: props.runtime,
        preferredAction: 'delete-tax-rate'
      })

      // Get action URL - use same pattern as create/update actions
      const actionName = 'delete-tax-rate'
      const actionUrl = getConfiguredActionUrl(props.runtime, actionName)

      // Prepare request body (same format as create/update - just id)
      const requestBody = { id: rateId }

      // Always use POST method to avoid CORS issues
      console.log('Deleting tax rate with URL:', actionUrl, 'Body:', requestBody)
      const response = await actionWebInvoke(actionUrl, headers, requestBody, { method: 'POST' })
      
      console.log('Delete response:', response)
      
      // Handle response format: { statusCode: 200, body: { status: 'Success', ... } }
      // or direct format: { status: 'Success', ... }
      const isSuccess = response.statusCode === 200 || 
                       (response.body && response.body.status === 'Success') ||
                       (response.status === 'Success')
      
      if (isSuccess) {
        setSuccessMessage('Tax rate deleted successfully')
        // Force reload from App Builder Database to ensure we get fresh data
        await loadTaxRates(true)
      } else {
        const errorMsg = response.body?.message || response.message || 'Failed to delete tax rate'
        throw new Error(errorMsg)
      }
    } catch (err) {
      setError('Failed to delete tax rate: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => {
    // Load tax rates on mount - clear localStorage first to force database load
    // This ensures we always try the database first, not cached data
    console.log('Initial load: Clearing localStorage to force database load...')
    localStorage.removeItem('taxByCityRates')
    loadTaxRates(true) // Force from database on initial load
    
    // Load Magento settings from localStorage (saved from Configuration page)
    const savedMagentoSettings = localStorage.getItem('magentoSettings')
    if (savedMagentoSettings) {
      try {
        const parsed = JSON.parse(savedMagentoSettings)
        setMagentoSettings({
          syncToMagento: parsed.syncToMagento !== false, // Default to true if not set
          commerceDomain: parsed.commerceDomain || '',
          instanceId: parsed.instanceId || '',
          runtimeBasicAuth: parsed.runtimeBasicAuth || '', // Basic auth for Runtime
          autoSyncEnabled: parsed.autoSyncEnabled || false,
          autoSyncInterval: parsed.autoSyncInterval || 10
        })
      } catch (e) {
        console.error('Error loading Magento settings:', e)
      }
    }
  }, [])

  // Auto-sync effect
  React.useEffect(() => {
    // Only setup auto-sync if enabled and we have required settings
    if (!magentoSettings.autoSyncEnabled || 
        !magentoSettings.commerceDomain || 
        !props.ims?.token) {
      return
    }

    const intervalMinutes = magentoSettings.autoSyncInterval || 10
    const intervalMs = intervalMinutes * 60 * 1000

    // Perform initial sync after a short delay
    const performSync = async () => {
      try {
        setSyncStatus('syncing')
        setSyncMessage('Syncing tax rates from Magento...')
        console.log(`[Auto-Sync] Starting sync from Magento (interval: ${intervalMinutes} minutes)`)
        
        const result = await syncTaxRatesFromMagento({
          commerceDomain: magentoSettings.commerceDomain,
          instanceId: magentoSettings.instanceId,
          accessToken: props.ims.token,
          orgId: props.ims.org
        })

        if (result.success) {
          console.log(`[Auto-Sync] Success: ${result.message}`)
          setSyncStatus('success')
          setSyncMessage(result.message)
          setLastSyncTime(new Date().toISOString())
          // Normalize and update tax rates list
          const normalizedRates = normalizeTaxRates(result.rates)
          setTaxRates(normalizedRates)
          
          // Reset to idle after 5 seconds
          setTimeout(() => {
            setSyncStatus('idle')
            setSyncMessage('')
          }, 5000)
        } else {
          console.warn(`[Auto-Sync] Failed: ${result.message}`)
          setSyncStatus('error')
          setSyncMessage(result.message || 'Sync failed')
          
          // Reset to idle after 10 seconds
          setTimeout(() => {
            setSyncStatus('idle')
            setSyncMessage('')
          }, 10000)
        }
      } catch (error) {
        console.error('[Auto-Sync] Error:', error)
        setSyncStatus('error')
        setSyncMessage(`Sync error: ${error.message}`)
        
        // Reset to idle after 10 seconds
        setTimeout(() => {
          setSyncStatus('idle')
          setSyncMessage('')
        }, 10000)
      }
    }

    // Initial sync after 5 seconds
    const initialTimeout = setTimeout(performSync, 5000)

    // Set up interval for subsequent syncs
    const syncInterval = setInterval(performSync, intervalMs)

    // Cleanup
    return () => {
      clearTimeout(initialTimeout)
      clearInterval(syncInterval)
    }
  }, [
    magentoSettings.autoSyncEnabled,
    magentoSettings.autoSyncInterval,
    magentoSettings.commerceDomain,
    magentoSettings.instanceId,
    props.ims?.token,
    props.ims?.org
  ])

  // Load last sync time on mount
  React.useEffect(() => {
    const savedLastSync = localStorage.getItem('lastSyncTime')
    if (savedLastSync) {
      setLastSyncTime(savedLastSync)
    }
  }, [])

  // Format last sync time for display
  const formatLastSyncTime = () => {
    if (!lastSyncTime) return 'Never'
    try {
      const date = new Date(lastSyncTime)
      const now = new Date()
      const diffMs = now - date
      const diffMins = Math.floor(diffMs / 60000)
      
      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
      
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
      
      return date.toLocaleString()
    } catch (e) {
      return 'Unknown'
    }
  }

  return (
    <View width="100%" UNSAFE_style={{ backgroundColor: '#f3f4f6', minHeight: '100vh' }}>
      {/* Magento-style Page Header */}
      <View 
        UNSAFE_style={{
          backgroundColor: '#fff',
          borderBottom: '1px solid #d1d5db',
          padding: '20px 30px'
        }}
      >
        <Flex direction="row" justifyContent="space-between" alignItems="center" wrap>
          <Flex direction="column" gap="size-50">
            <Heading 
              level={1} 
              marginTop="size-0"
              UNSAFE_style={{
                fontSize: '28px',
                fontWeight: 400,
                color: '#303030',
                margin: 0
              }}
            >
              Tax Rules
            </Heading>
            {/* Sync Status Indicator */}
            {magentoSettings.autoSyncEnabled && (
              <Flex direction="row" gap="size-100" alignItems="center">
                <StatusLight 
                  variant={
                    syncStatus === 'syncing' ? 'info' :
                    syncStatus === 'success' ? 'positive' :
                    syncStatus === 'error' ? 'negative' : 'neutral'
                  }
                  size="S"
                >
                  {syncStatus === 'syncing' ? 'Syncing...' :
                   syncStatus === 'success' ? 'Synced' :
                   syncStatus === 'error' ? 'Sync Error' :
                   'Auto-Sync Enabled'}
                </StatusLight>
                <Text size="S" UNSAFE_style={{ 
                  color: 'var(--spectrum-global-color-gray-600)',
                  fontSize: '12px'
                }}>
                  {syncStatus === 'syncing' ? syncMessage :
                   syncStatus === 'success' ? syncMessage :
                   syncStatus === 'error' ? syncMessage :
                   `Last sync: ${formatLastSyncTime()} • Next sync in ${magentoSettings.autoSyncInterval || 10} min`}
                </Text>
              </Flex>
            )}
          </Flex>
          <ButtonGroup>
            <Button 
              variant="secondary" 
              onPress={() => loadTaxRates(true)}
              isDisabled={loading}
              UNSAFE_style={{ 
                minWidth: '180px',
                padding: '10px 20px',
                fontSize: '14px'
              }}
            >
              {loading ? 'Reloading...' : 'Reload from Database'}
            </Button>
          </ButtonGroup>
        </Flex>
      </View>

      {/* Main Content */}
      <View padding="size-300">
        <Flex direction="column" gap="size-400">

        {successMessage && (
          <View 
            padding="size-200"
            backgroundColor="green-100"
            borderRadius="regular"
            borderWidth="thin"
            borderColor="green-300"
          >
            <Flex direction="row" gap="size-150" alignItems="center">
              <StatusLight variant="positive" />
              <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-green-700)', fontWeight: 500 }}>
                {successMessage}
              </Text>
            </Flex>
          </View>
        )}

        {error && (
          <View 
            padding="size-200"
            backgroundColor="red-100"
            borderRadius="regular"
            borderWidth="thin"
            borderColor="red-300"
          >
            <Flex direction="row" gap="size-150" alignItems="center">
              <StatusLight variant="negative" />
              <Text UNSAFE_style={{ color: 'var(--spectrum-global-color-red-700)' }}>
                {error}
              </Text>
            </Flex>
          </View>
        )}

        <Dialog 
          isOpen={showForm} 
          onClose={() => {
            setShowForm(false)
            setError(null)
            setSuccessMessage(null)
            setFormData({
              id: null,
              tax_country_id: 'US',
              tax_region_id: '',
              tax_postcode: '',
              rate: '',
              city: '',
              zip_is_range: false,
              zip_from: '',
              zip_to: '',
              status: true
            })
          }} 
          UNSAFE_style={{ 
            maxWidth: '95vw',
            width: '100%'
          }}
        >
          <Heading>{formData.id ? 'Edit Tax Rate' : 'Create New Tax Rate'}</Heading>
          <Divider />
          <Content>
            <View padding="size-200">
              <Form>
                <Flex direction="column" gap="size-200">
                  {/* Section Headers - Responsive */}
                  <Flex direction="row" gap="size-150" wrap>
                    <View flex="1" minWidth="200px" maxWidth="100%">
                      <Text size="XS" UNSAFE_style={{ 
                        fontWeight: 600, 
                        color: 'var(--spectrum-global-color-gray-700)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '4px',
                        fontSize: '11px'
                      }}>
                        Location Settings
                      </Text>
                    </View>
                    <View flex="1" minWidth="250px" maxWidth="100%">
                      <Text size="XS" UNSAFE_style={{ 
                        fontWeight: 600, 
                        color: 'var(--spectrum-global-color-gray-700)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '4px',
                        fontSize: '11px'
                      }}>
                        ZIP Code Configuration
                      </Text>
                    </View>
                    <View flex="1" minWidth="200px" maxWidth="100%">
                      <Text size="XS" UNSAFE_style={{ 
                        fontWeight: 600, 
                        color: 'var(--spectrum-global-color-gray-700)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '4px',
                        fontSize: '11px'
                      }}>
                        City & Tax Rate
                      </Text>
                    </View>
                  </Flex>

                  {/* Responsive Row - All Fields */}
                  <Flex direction="row" gap="size-150" wrap alignItems="flex-start">
                    {/* Location Settings */}
                    <Flex direction="column" gap="size-150" flex="1" minWidth="200px" maxWidth="100%">
                      <Picker
                        label="Country"
                        selectedKey={formData.tax_country_id || 'US'}
                        onSelectionChange={(key) => handleInputChange('tax_country_id', key)}
                        isRequired
                        width="100%"
                        placeholder="Select Country"
                      >
                        {countries.map((country) => (
                          <Item key={country.id}>{country.name}</Item>
                        ))}
                      </Picker>
                      
                      <Picker
                        label="State/Region"
                        selectedKey={formData.tax_region_id || ''}
                        onSelectionChange={(key) => handleInputChange('tax_region_id', key)}
                        width="100%"
                        placeholder="Select State/Region"
                        isDisabled={!formData.tax_country_id}
                      >
                        {getStatesForCountry(formData.tax_country_id || 'US').map((state) => (
                          <Item key={state.id}>{state.name}</Item>
                        ))}
                      </Picker>
                    </Flex>

                    {/* ZIP Code Configuration */}
                    <Flex direction="column" gap="size-150" flex="1" minWidth="250px" maxWidth="100%">
                      <Checkbox
                        isSelected={formData.zip_is_range}
                        onChange={(value) => handleInputChange('zip_is_range', value)}
                      >
                        Use ZIP Code Range
                      </Checkbox>
                      
                      {formData.zip_is_range ? (
                        <Flex direction="column" gap="size-75">
                          <Flex direction="row" gap="size-75" wrap>
                            <TextField
                              label="ZIP From"
                              value={formData.zip_from}
                              onChange={(value) => handleInputChange('zip_from', value)}
                              width="100%"
                              isRequired
                              placeholder={formData.tax_country_id === 'US' ? '90001' : formData.tax_country_id === 'CA' ? 'K1A 0B1' : '12345'}
                              flex="1"
                              minWidth="100px"
                              validationState={formData.zip_from && !validateZipCode(formData.zip_from, formData.tax_country_id, true).valid ? 'invalid' : undefined}
                              errorMessage={formData.zip_from && !validateZipCode(formData.zip_from, formData.tax_country_id, true).valid ? validateZipCode(formData.zip_from, formData.tax_country_id, true).message : undefined}
                            />
                            <TextField
                              label="ZIP To"
                              value={formData.zip_to}
                              onChange={(value) => handleInputChange('zip_to', value)}
                              width="100%"
                              isRequired
                              placeholder={formData.tax_country_id === 'US' ? '90010' : formData.tax_country_id === 'CA' ? 'K1A 0B2' : '12350'}
                              flex="1"
                              minWidth="100px"
                              validationState={formData.zip_to && !validateZipCode(formData.zip_to, formData.tax_country_id, true).valid ? 'invalid' : undefined}
                              errorMessage={formData.zip_to && !validateZipCode(formData.zip_to, formData.tax_country_id, true).valid ? validateZipCode(formData.zip_to, formData.tax_country_id, true).message : undefined}
                            />
                          </Flex>
                          {formData.zip_from && formData.zip_to && (() => {
                            const rangeValidation = validateZipRange(formData.zip_from, formData.zip_to, formData.tax_country_id)
                            return !rangeValidation.valid ? (
                              <Text size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-red-600)' }}>
                                {rangeValidation.message}
                              </Text>
                            ) : null
                          })()}
                        </Flex>
                      ) : (
                        <TextField
                          label="Postcode"
                          value={formData.tax_postcode}
                          onChange={(value) => handleInputChange('tax_postcode', value)}
                          width="100%"
                          placeholder={formData.tax_country_id === 'US' ? '90001 or *' : formData.tax_country_id === 'CA' ? 'K1A 0B1 or *' : '12345 or *'}
                          validationState={formData.tax_postcode && formData.tax_postcode !== '*' && !validateZipCode(formData.tax_postcode, formData.tax_country_id, false).valid ? 'invalid' : undefined}
                          errorMessage={formData.tax_postcode && formData.tax_postcode !== '*' && !validateZipCode(formData.tax_postcode, formData.tax_country_id, false).valid ? validateZipCode(formData.tax_postcode, formData.tax_country_id, false).message : undefined}
                        />
                      )}
                    </Flex>

                    {/* City & Tax Rate */}
                    <Flex direction="column" gap="size-150" flex="1" minWidth="200px" maxWidth="100%">
                      <TextField
                        label="City"
                        value={formData.city}
                        onChange={(value) => handleInputChange('city', value)}
                        width="100%"
                        placeholder="Los Angeles (optional)"
                      />
                      <TextField
                        label="Tax Identifier Code (Optional)"
                        value={formData.code}
                        onChange={(value) => handleInputChange('code', value)}
                        width="100%"
                        placeholder="e.g., Rate 1"
                        description="Custom identifier code (e.g., 'Rate 1'). If empty, will be auto-generated from country-state-rate."
                      />
                      <NumberField
                        label="Tax Rate (%)"
                        value={formData.rate}
                        onChange={(value) => handleInputChange('rate', value)}
                        isRequired
                        minValue={0}
                        maxValue={100}
                        step={0.01}
                        formatOptions={{ style: 'decimal', minimumFractionDigits: 2, maximumFractionDigits: 4 }}
                        width="100%"
                      />
                    </Flex>
                  </Flex>
                </Flex>
              </Form>
            </View>
          </Content>
          <Divider />
          <ButtonGroup UNSAFE_style={{ padding: '12px', justifyContent: 'flex-start' }}>
            <Button 
              variant="primary" 
              onPress={handleSubmit} 
              isDisabled={loading}
              UNSAFE_style={{ minWidth: '140px' }}
            >
              {loading ? 'Saving...' : formData.id ? 'Update Tax Rate' : 'Create Tax Rate'}
            </Button>
            <Button 
              variant="secondary" 
              onPress={() => {
                setShowForm(false)
                setFormData({
                  id: null,
                  tax_country_id: 'US',
                  tax_region_id: '',
                  tax_postcode: '',
                  rate: '',
                  city: '',
                  zip_is_range: false,
                  zip_from: '',
                  zip_to: '',
                  status: true
                })
              }}
              UNSAFE_style={{ minWidth: '100px' }}
            >
              Cancel
            </Button>
          </ButtonGroup>
        </Dialog>


        {loading && (
          <View padding="size-200">
            <StatusLight variant="info">Loading tax rates...</StatusLight>
          </View>
        )}

        {!loading && taxRates.length === 0 && !error && (
          <View 
            padding="size-800"
            backgroundColor="gray-50"
            borderRadius="regular"
            borderWidth="thin"
            borderColor="gray-300"
            UNSAFE_style={{
              textAlign: 'center'
            }}
          >
            <Flex direction="column" gap="size-400" alignItems="center">
              <View 
                padding="size-400"
                backgroundColor="blue-100"
                borderRadius="circle"
                UNSAFE_style={{
                  width: '80px',
                  height: '80px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <DocumentIcon size="XL" UNSAFE_style={{ color: 'var(--spectrum-global-color-blue-600)' }} />
              </View>
              <Flex direction="column" gap="size-100" alignItems="center">
                <Heading level={2} marginTop="size-0">
                  No Tax Rates Configured
                </Heading>
                <Text size="M" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)', maxWidth: '500px' }}>
                  Create your first tax rate rule to get started. Configure taxes based on country, state, city, and ZIP code ranges.
                </Text>
              </Flex>
              <Button variant="primary" onPress={() => setShowForm(true)}>
                Create Your First Tax Rate
              </Button>
            </Flex>
          </View>
        )}

        {!loading && taxRates.length > 0 && viewMode === 'table' && (
          <View 
            backgroundColor="white"
            UNSAFE_style={{
              border: '1px solid #d1d5db'
            }}
          >
            {/* Magento-style Filter Bar */}
            <View 
              padding={window.innerWidth <= 768 ? "size-100" : "size-150"} 
              UNSAFE_style={{
                backgroundColor: '#f3f4f6',
                borderBottom: '1px solid #d1d5db'
              }}
            >
              <Flex direction={window.innerWidth <= 768 ? "column" : "row"} gap={window.innerWidth <= 768 ? "size-100" : "size-200"} alignItems="center" wrap>
                <Button 
                  variant="primary"
                  onPress={() => {
                    // Apply filters - in real Magento this would trigger a search
                  }}
                  UNSAFE_style={{
                    backgroundColor: '#514f50',
                    borderColor: '#514f50',
                    color: 'white',
                    minWidth: '100px'
                  }}
                >
                  Search
                </Button>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setSearchQuery('')
                    setColumnFilters({
                      country: '',
                      state: '',
                      zip: '',
                      city: '',
                      rate: '',
                      status: ''
                    })
                    setFilterStatus('all')
                    setCurrentPage(1)
                  }}
                  UNSAFE_style={{
                    textDecoration: 'underline',
                    color: '#1976d2'
                  }}
                >
                  Reset Filter
                </Button>
                <View flex="1" />
                <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                  {filteredAndSortedRates.length} records found
                </Text>
                <Flex direction="row" gap="size-100" alignItems="center">
                  <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                    {pageSize} per page
                  </Text>
                  <Picker
                    selectedKey={pageSize.toString()}
                    onSelectionChange={(key) => {
                      setPageSize(parseInt(key))
                      setCurrentPage(1)
                    }}
                    width="size-1200"
                    isQuiet
                  >
                    <Item key="20">20</Item>
                    <Item key="30">30</Item>
                    <Item key="50">50</Item>
                    <Item key="100">100</Item>
                    <Item key="200">200</Item>
                  </Picker>
                  <ButtonGroup>
                    <Button
                      variant="secondary"
                      onPress={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      isDisabled={currentPage === 1}
                      isQuiet
                    >
                      <ChevronLeft />
                    </Button>
                    <Button
                      variant="secondary"
                      onPress={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      isDisabled={currentPage === totalPages}
                      isQuiet
                    >
                      <ChevronRight />
                    </Button>
                  </ButtonGroup>
                  <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                    {currentPage} of {totalPages}
                  </Text>
                </Flex>
              </Flex>
            </View>

            {/* Magento-style Table with Column Filters */}
            <div className="table-scroll-container" style={{ overflowX: 'auto', width: '100%', WebkitOverflowScrolling: 'touch' }}>
              <table 
                className="magento-table"
                style={{ 
                  width: '100%',
                  borderCollapse: 'collapse',
                  minWidth: window.innerWidth <= 768 ? '800px' : '900px'
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: '#000', color: '#fff' }}>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>Tax Identifier</Text>
                        <ActionButton
                          onPress={() => handleSort('taxIdentifier')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'taxIdentifier' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'taxIdentifier' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'taxIdentifier' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>Country</Text>
                        <ActionButton
                          onPress={() => handleSort('country')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'country' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'country' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'country' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>State</Text>
                        <ActionButton
                          onPress={() => handleSort('state')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'state' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'state' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'state' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>ZIP Code</Text>
                        <ActionButton
                          onPress={() => handleSort('zip')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'zip' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'zip' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'zip' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>City</Text>
                        <ActionButton
                          onPress={() => handleSort('city')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'city' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'city' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'city' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>Tax Rate</Text>
                        <ActionButton
                          onPress={() => handleSort('rate')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'rate' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'rate' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'rate' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Flex direction="row" gap="size-50" alignItems="center">
                        <Text UNSAFE_style={{ color: '#fff' }}>Status</Text>
                        <ActionButton
                          onPress={() => handleSort('status')}
                          isQuiet
                          UNSAFE_style={{ padding: '2px', minWidth: 'auto' }}
                        >
                          <Text size="XS" UNSAFE_style={{ 
                            color: sortDescriptor.column === 'status' ? '#fff' : '#ccc',
                            fontWeight: sortDescriptor.column === 'status' ? 600 : 400
                          }}>
                            {sortDescriptor.column === 'status' ? (sortDescriptor.direction === 'asc' ? '↑' : '↓') : '⇅'}
                          </Text>
                        </ActionButton>
                      </Flex>
                    </th>
                    <th style={{ padding: '10px', textAlign: 'left', fontWeight: 600, border: '1px solid #333' }}>
                      <Text UNSAFE_style={{ color: '#fff' }}>Actions</Text>
                    </th>
                  </tr>
                  {/* Filter Row - Magento Style */}
                  <tr style={{ backgroundColor: '#f9fafb', borderBottom: '1px solid #d1d5db' }}>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.taxIdentifier}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, taxIdentifier: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.country}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, country: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.state}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, state: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.zip}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, zip: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.city}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, city: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <TextField
                        value={columnFilters.rate}
                        onChange={(value) => setColumnFilters(prev => ({ ...prev, rate: value }))}
                        placeholder="Filter..."
                        width="100%"
                        isQuiet
                        UNSAFE_style={{ fontSize: '13px' }}
                      />
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}>
                      <Picker
                        selectedKey={columnFilters.status}
                        onSelectionChange={(key) => setColumnFilters(prev => ({ ...prev, status: key }))}
                        width="100%"
                        isQuiet
                        placeholder="Filter..."
                      >
                        <Item key="">All</Item>
                        <Item key="active">Active</Item>
                        <Item key="inactive">Inactive</Item>
                      </Picker>
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #e5e7eb' }}></td>
                  </tr>
                </thead>
                <tbody>
                  {paginatedRates.length > 0 ? (
                    paginatedRates.map((rate, index) => {
                      const zipDisplay = (rate.zip_is_range && rate.zip_from && rate.zip_to)
                        ? `${rate.zip_from}-${rate.zip_to}`
                        : (rate.tax_postcode || '*')
                      return (
                        <tr 
                          key={rate._id || rate.id || rate.tax_calculation_rate_id}
                          style={{ 
                            backgroundColor: index % 2 === 0 ? '#fff' : '#f9fafb',
                            borderBottom: '1px solid #e5e7eb'
                          }}
                        >
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px', fontFamily: 'monospace' }}>
                            <Text UNSAFE_style={{ fontWeight: 600, color: '#1976d2' }}>
                              {formatTaxIdentifier(rate)}
                            </Text>
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}>
                            <Text UNSAFE_style={{ fontWeight: 600 }}>
                              {rate.tax_country_id}
                            </Text>
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}>
                            {(() => {
                              // Get state - use tax_region_id directly
                              // Empty string, null, '*', or '0' all mean "All States"
                              let stateId = rate.tax_region_id;
                              
                              // Only extract from tax_identifier if tax_region_id is null/undefined (truly missing)
                              // If tax_region_id is explicitly empty string '', it means "All States" - don't extract
                              if (stateId === null || stateId === undefined) {
                                const taxId = rate.tax_identifier || rate.code || '';
                                if (taxId && typeof taxId === 'string') {
                                  const parts = taxId.split('-');
                                  if (parts.length >= 2) {
                                    const extractedState = parts[1];
                                    // Only use extracted state if it's not '*' (all states)
                                    if (extractedState !== '*' && /^[A-Z]{2,3}$/.test(extractedState)) {
                                      stateId = extractedState;
                                    }
                                  }
                                }
                              }
                              
                              // Display: empty string, null, '*', or '0' = "All States"
                              if (!stateId || stateId === '' || stateId === '*' || stateId === '0') {
                                return (
                                  <Text UNSAFE_style={{ color: '#9ca3af', fontStyle: 'italic' }}>All</Text>
                                );
                              }
                              
                              return (
                                <Text>{getStateName(stateId, rate.tax_country_id)}</Text>
                              );
                            })()}
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px', fontFamily: 'monospace' }}>
                            {zipDisplay}
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}>
                            {rate.city || <Text UNSAFE_style={{ color: '#9ca3af', fontStyle: 'italic' }}>All Cities</Text>}
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}>
                            <Text UNSAFE_style={{ fontWeight: 600, color: '#1976d2' }}>
                              {rate.rate}%
                            </Text>
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb', fontSize: '13px' }}>
                            <StatusLight variant={rate.status !== false ? 'positive' : 'negative'} size="S">
                              {rate.status !== false ? 'Active' : 'Inactive'}
                            </StatusLight>
                          </td>
                          <td style={{ padding: '10px', border: '1px solid #e5e7eb' }}>
                            <Flex direction="row" gap="size-50" alignItems="center">
                              <TooltipTrigger>
                                <ActionButton
                                  onPress={() => {
                                    const rateId = rate._id || rate.id || rate.tax_calculation_rate_id
                                    
                                    // Parse ZIP code - check if it's a range format (e.g., "90001-90008")
                                    let zipIsRange = rate.zip_is_range || false
                                    let zipFrom = rate.zip_from || ''
                                    let zipTo = rate.zip_to || ''
                                    let taxPostcode = rate.tax_postcode || ''
                                    
                                    // If tax_postcode contains a dash and looks like a range, parse it
                                    if (taxPostcode && taxPostcode.includes('-') && !zipFrom && !zipTo) {
                                      const parts = taxPostcode.split('-')
                                      if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
                                        zipIsRange = true
                                        zipFrom = parts[0].trim()
                                        zipTo = parts[1].trim()
                                        taxPostcode = '' // Clear single postcode when using range
                                      }
                                    }
                                    
                                    // Convert rate to number for NumberField, handling 0 correctly
                                    let rateValue = '';
                                    if (rate.rate != null && rate.rate !== '') {
                                      const numRate = typeof rate.rate === 'number' ? rate.rate : parseFloat(rate.rate);
                                      rateValue = isNaN(numRate) ? '' : numRate;
                                    }
                                    
                                    setFormData({
                                      id: rateId,
                                      tax_country_id: rate.tax_country_id || 'US',
                                      tax_region_id: rate.tax_region_id || '',
                                      tax_postcode: taxPostcode,
                                      rate: rateValue,
                                      city: rate.city || '',
                                      zip_is_range: zipIsRange,
                                      zip_from: zipFrom,
                                      zip_to: zipTo,
                                      status: rate.status !== false,
                                      code: rate.code || '',
                                      tax_identifier: rate.tax_identifier || '',
                                      magento_tax_rate_id: rate.magento_tax_rate_id || null
                                    })
                                    setShowForm(true)
                                    setError(null)
                                    setSuccessMessage(null)
                                  }}
                                >
                                  <Edit size="S" />
                                </ActionButton>
                                <Tooltip>Edit Tax Rate</Tooltip>
                              </TooltipTrigger>
                              <TooltipTrigger>
                                <ActionButton
                                  onPress={() => handleDelete(rate._id || rate.id || rate.tax_calculation_rate_id)}
                                >
                                  <Delete size="S" />
                                </ActionButton>
                                <Tooltip>Delete Tax Rate</Tooltip>
                              </TooltipTrigger>
                            </Flex>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan="7" style={{ padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                        We couldn't find any records.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          </View>
        )}

        {!loading && taxRates.length > 0 && viewMode === 'cards' && (
          <Flex direction="row" gap="size-300" wrap>
            {taxRates.map((rate) => {
              const zipDisplay = (rate.zip_is_range && rate.zip_from && rate.zip_to)
                ? `${rate.zip_from}-${rate.zip_to}`
                : (rate.tax_postcode || '*')
              return (
                <View
                  key={rate._id || rate.id || rate.tax_calculation_rate_id}
                  backgroundColor="white"
                  borderRadius="regular"
                  borderWidth="thin"
                  borderColor="gray-300"
                  padding="size-300"
                  width="calc(33.333% - size-200)"
                  minWidth="size-4000"
                  UNSAFE_style={{
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                  }}
                >
                  <Flex direction="column" gap="size-200">
                    <Flex direction="row" justifyContent="space-between" alignItems="start">
                      <Flex direction="column" gap="size-50">
                        <Text size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          {rate.tax_country_id} {rate.tax_region_id && rate.tax_region_id !== '' && rate.tax_region_id !== '*' && rate.tax_region_id !== '0' ? `• ${getStateName(rate.tax_region_id, rate.tax_country_id)}` : '• All States'}
                        </Text>
                        <Heading level={3} marginTop="size-0" UNSAFE_style={{ color: 'var(--spectrum-global-color-blue-600)', fontSize: '24px' }}>
                          {rate.rate}%
                        </Heading>
                      </Flex>
                      <StatusLight variant={rate.status !== false ? 'positive' : 'negative'} size="S">
                        {rate.status !== false ? 'Active' : 'Inactive'}
                      </StatusLight>
                    </Flex>
                    
                    <Divider />
                    
                    <Flex direction="column" gap="size-100">
                      <Flex direction="row" justifyContent="space-between">
                        <Text size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>ZIP Code:</Text>
                        <Text size="S" UNSAFE_style={{ fontFamily: 'monospace', fontWeight: 600 }}>{zipDisplay}</Text>
                      </Flex>
                      <Flex direction="row" justifyContent="space-between">
                        <Text size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-600)' }}>City:</Text>
                        <Text size="S">{rate.city || <Text UNSAFE_style={{ fontStyle: 'italic', color: 'var(--spectrum-global-color-gray-500)' }}>All Cities</Text>}</Text>
                      </Flex>
                    </Flex>
                    
                    <Divider />
                    
                    <ButtonGroup>
                      <Button 
                        variant="primary" 
                        onPress={() => {
                          // Use _id (MongoDB format) if available, otherwise fall back to id
                          const rateId = rate._id || rate.id || rate.tax_calculation_rate_id
                          
                          // Parse ZIP code - check if it's a range format (e.g., "90001-90008")
                          let zipIsRange = rate.zip_is_range || false
                          let zipFrom = rate.zip_from || ''
                          let zipTo = rate.zip_to || ''
                          let taxPostcode = rate.tax_postcode || ''
                          
                          // If tax_postcode contains a dash and looks like a range, parse it
                          if (taxPostcode && taxPostcode.includes('-') && !zipFrom && !zipTo) {
                            const parts = taxPostcode.split('-')
                            if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
                              zipIsRange = true
                              zipFrom = parts[0].trim()
                              zipTo = parts[1].trim()
                              taxPostcode = '' // Clear single postcode when using range
                            }
                          }
                          
                          // Convert rate to number for NumberField, handling 0 correctly
                          let rateValue = '';
                          if (rate.rate != null && rate.rate !== '') {
                            const numRate = typeof rate.rate === 'number' ? rate.rate : parseFloat(rate.rate);
                            rateValue = isNaN(numRate) ? '' : numRate;
                          }
                          
                          setFormData({
                            id: rateId,
                            tax_country_id: rate.tax_country_id || 'US',
                            tax_region_id: rate.tax_region_id || '',
                            tax_postcode: taxPostcode,
                            rate: rateValue,
                            city: rate.city || '',
                            zip_is_range: zipIsRange,
                            zip_from: zipFrom,
                            zip_to: zipTo,
                            status: rate.status !== false
                          })
                          setShowForm(true)
                          setError(null)
                          setSuccessMessage(null)
                        }}
                      >
                        Edit
                      </Button>
                      <Button 
                        variant="negative" 
                        onPress={() => handleDelete(rate._id || rate.id || rate.tax_calculation_rate_id)}
                      >
                        Delete
                      </Button>
                    </ButtonGroup>
                  </Flex>
                </View>
              )
            })}
          </Flex>
        )}
        </Flex>
      </View>
    </View>
  )
}

TaxRateManager.propTypes = {
  runtime: PropTypes.any,
  ims: PropTypes.any
}

export default TaxRateManager

