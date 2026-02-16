/* 
* Sync Component - Magento SaaS Sync Management
* Allows users to configure Magento credentials and sync tax rates
*/

import React, { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import {
  Flex,
  Heading,
  Button,
  View,
  StatusLight,
  Text,
  Divider,
  Well,
  ProgressCircle,
  TableView,
  TableHeader,
  TableBody,
  Row,
  Cell,
  Column
} from '@adobe/react-spectrum'
import actionWebInvoke from '../utils'
import allActions from '../config.json'

const Sync = (props) => {
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncingDirection, setSyncingDirection] = useState(null) // 'magento-to-extension' or 'extension-to-magento'
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncHistory, setSyncHistory] = useState([])
  const [progress, setProgress] = useState(0)
  const [syncLogs, setSyncLogs] = useState([])
  
  // Load Magento settings from Configuration page
  const [magentoSettings, setMagentoSettings] = useState({
    commerceDomain: '',
    instanceId: '',
    syncToMagento: true
  })
  
  useEffect(() => {
    const saved = localStorage.getItem('magentoSettings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setMagentoSettings({
          commerceDomain: parsed.commerceDomain || '',
          instanceId: parsed.instanceId || '',
          syncToMagento: parsed.syncToMagento !== false
        })
      } catch (e) {
        // Error loading settings
      }
    }
  }, [])

  // Load sync history on mount
  useEffect(() => {
    loadSyncHistory()
  }, [])

  const loadSyncHistory = () => {
    const saved = localStorage.getItem('taxByCitySyncHistory')
    if (saved) {
      try {
        setSyncHistory(JSON.parse(saved))
      } catch (e) {
        console.error('Error loading sync history:', e)
      }
    }
  }

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    setSyncLogs(prev => [...prev, { timestamp, message, type }])
  }

  const handleSyncFromMagento = async () => {
    setSyncing(true)
    setSyncingDirection('magento-to-extension')
    setError(null)
    setSuccess(false)
    setSyncResult(null)
    setProgress(0)
    setSyncLogs([])

    try {
      addLog('Starting sync from Magento to Extension...', 'info')
      setProgress(10)

      if (!magentoSettings.commerceDomain) {
        throw new Error('Please configure Commerce Domain in Configuration page')
      }

      if (!props.ims?.token) {
        throw new Error('IMS token not available. Please ensure you are logged in to Adobe.')
      }

      const headers = {
        authorization: `Bearer ${props.ims.token}`,
        'x-gw-ims-org-id': props.ims.org
      }

      addLog('Fetching tax rates from Magento...', 'info')
      setProgress(30)

      // Use syncService to fetch from Magento
      const { fetchTaxRatesFromMagento, mergeTaxRates } = await import('../syncService')
      
      const magentoTaxRates = await fetchTaxRatesFromMagento(
        magentoSettings.commerceDomain,
        magentoSettings.instanceId,
        props.ims.token,
        props.ims.org
      )

      addLog(`Found ${magentoTaxRates.length} tax rates in Magento`, 'info')
      setProgress(50)

      addLog('Merging with local storage...', 'info')
      setProgress(70)

      const mergedRates = mergeTaxRates(magentoTaxRates)

      addLog(`Successfully synced ${magentoTaxRates.length} tax rates`, 'success')
      setProgress(100)

      setSyncResult({
        success: true,
        message: `Successfully synced ${magentoTaxRates.length} tax rates from Magento`,
        synced: magentoTaxRates.length,
        failed: 0,
        total: mergedRates.length
      })

      setSuccess(true)
      setError(null)

      const historyEntry = {
        timestamp: new Date().toISOString(),
        mode: 'magento-to-extension',
        result: {
          synced: magentoTaxRates.length,
          failed: 0,
          total: mergedRates.length
        },
        status: 'success'
      }
      const updatedHistory = [historyEntry, ...syncHistory].slice(0, 20)
      setSyncHistory(updatedHistory)
      localStorage.setItem('taxByCitySyncHistory', JSON.stringify(updatedHistory))
      localStorage.setItem('lastSyncTime', new Date().toISOString())

    } catch (err) {
      addLog(`Error: ${err.message}`, 'error')
      setError(`Sync failed: ${err.message}`)
      setSyncResult(null)
      setProgress(0)
      
      const historyEntry = {
        timestamp: new Date().toISOString(),
        mode: 'magento-to-extension',
        result: { error: err.message },
        status: 'error'
      }
      const updatedHistory = [historyEntry, ...syncHistory].slice(0, 20)
      setSyncHistory(updatedHistory)
      localStorage.setItem('taxByCitySyncHistory', JSON.stringify(updatedHistory))
    } finally {
      setSyncing(false)
      setSyncingDirection(null)
    }
  }

  const handleSyncToMagento = async () => {
    setSyncing(true)
    setSyncingDirection('extension-to-magento')
    setError(null)
    setSuccess(false)
    setSyncResult(null)
    setProgress(0)
    setSyncLogs([])

    try {
      addLog('Starting sync from Extension to Magento...', 'info')
      setProgress(10)

      if (!magentoSettings.commerceDomain) {
        throw new Error('Please configure Commerce Domain in Configuration page')
      }

      if (!props.ims?.token) {
        throw new Error('IMS token not available. Please ensure you are logged in to Adobe.')
      }

      const headers = {
        authorization: `Bearer ${props.ims.token}`,
        'x-gw-ims-org-id': props.ims.org
      }

      addLog('Fetching tax rates from Extension...', 'info')
      setProgress(20)

      // Get tax rates from tax-rate action
      let taxRateActionUrl
      if (props.runtime && typeof props.runtime.getActionUrl === 'function') {
        taxRateActionUrl = props.runtime.getActionUrl('tax-rate')
      } else if (allActions['tax-rate']) {
        taxRateActionUrl = allActions['tax-rate']
      } else if (allActions['tax-by-city/tax-rate']) {
        taxRateActionUrl = allActions['tax-by-city/tax-rate']
      } else {
        taxRateActionUrl = 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/tax-rate'
      }

      const listResponse = await actionWebInvoke(taxRateActionUrl, headers, { operation: 'LIST', limit: 1000 })
      
      if (listResponse.statusCode !== 200 || !listResponse.body?.data) {
        throw new Error('Failed to fetch tax rates from Extension')
      }

      const taxRates = listResponse.body.data || []
      addLog(`Found ${taxRates.length} tax rates in Extension`, 'info')
      setProgress(40)

      addLog('Syncing to Magento...', 'info')
      setProgress(50)

      // Sync each tax rate to Magento using create-tax-rate or update-tax-rate
      let synced = 0
      let failed = 0
      const errors = []

      for (let i = 0; i < taxRates.length; i++) {
        const rate = taxRates[i]
        const progressPercent = 50 + Math.floor((i / taxRates.length) * 40)
        setProgress(progressPercent)

        try {
          addLog(`Syncing ${rate.tax_identifier || rate.code || `Rate ${i + 1}`}...`, 'info')

          // Use create-tax-rate or update-tax-rate action
          let syncActionUrl
          if (props.runtime && typeof props.runtime.getActionUrl === 'function') {
            syncActionUrl = props.runtime.getActionUrl(rate.magento_tax_rate_id ? 'update-tax-rate' : 'create-tax-rate')
          } else if (allActions[rate.magento_tax_rate_id ? 'update-tax-rate' : 'create-tax-rate']) {
            syncActionUrl = allActions[rate.magento_tax_rate_id ? 'update-tax-rate' : 'create-tax-rate']
          } else {
            syncActionUrl = `https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/${rate.magento_tax_rate_id ? 'update-tax-rate' : 'create-tax-rate'}`
          }

          const syncParams = {
            taxRate: {
              tax_country_id: rate.tax_country_id,
              tax_region_id: rate.tax_region_id,
              tax_postcode: rate.tax_postcode || '*',
              rate: rate.rate,
              code: rate.code || rate.tax_identifier,
              city: rate.city,
              zip_is_range: rate.zip_is_range || false,
              zip_from: rate.zip_from,
              zip_to: rate.zip_to
            },
            region: 'amer'
          }

          if (rate.magento_tax_rate_id) {
            syncParams._id = rate._id || rate.id
            syncParams.taxRate.id = rate.magento_tax_rate_id
          }

          const syncResponse = await actionWebInvoke(syncActionUrl, headers, syncParams)

          if (syncResponse.statusCode === 200 || syncResponse.statusCode === 201) {
            synced++
            addLog(`✓ Successfully synced ${rate.tax_identifier || rate.code || `Rate ${i + 1}`}`, 'success')
          } else {
            failed++
            const errorMsg = syncResponse.body?.message || 'Unknown error'
            errors.push({ rateId: rate.tax_identifier || rate.code, error: errorMsg })
            addLog(`✗ Failed to sync ${rate.tax_identifier || rate.code || `Rate ${i + 1}`}: ${errorMsg}`, 'error')
          }
        } catch (err) {
          failed++
          errors.push({ rateId: rate.tax_identifier || rate.code, error: err.message })
          addLog(`✗ Error syncing ${rate.tax_identifier || rate.code || `Rate ${i + 1}`}: ${err.message}`, 'error')
        }
      }

      setProgress(100)
      addLog(`Sync completed: ${synced} synced, ${failed} failed`, synced > 0 ? 'success' : 'error')

      setSyncResult({
        success: synced > 0,
        message: `Synced ${synced} tax rates to Magento${failed > 0 ? `, ${failed} failed` : ''}`,
        synced,
        failed,
        total: taxRates.length,
        errors: errors.length > 0 ? errors : undefined
      })

      if (synced > 0) {
        setSuccess(true)
      }
      if (failed > 0) {
        setError(`${failed} tax rates failed to sync`)
      }

      const historyEntry = {
        timestamp: new Date().toISOString(),
        mode: 'extension-to-magento',
        result: {
          synced,
          failed,
          total: taxRates.length
        },
        status: synced > 0 ? (failed > 0 ? 'partial' : 'success') : 'error'
      }
      const updatedHistory = [historyEntry, ...syncHistory].slice(0, 20)
      setSyncHistory(updatedHistory)
      localStorage.setItem('taxByCitySyncHistory', JSON.stringify(updatedHistory))

    } catch (err) {
      addLog(`Error: ${err.message}`, 'error')
      setError(`Sync failed: ${err.message}`)
      setSyncResult(null)
      setProgress(0)
      
      const historyEntry = {
        timestamp: new Date().toISOString(),
        mode: 'extension-to-magento',
        result: { error: err.message },
        status: 'error'
      }
      const updatedHistory = [historyEntry, ...syncHistory].slice(0, 20)
      setSyncHistory(updatedHistory)
      localStorage.setItem('taxByCitySyncHistory', JSON.stringify(updatedHistory))
    } finally {
      setSyncing(false)
      setSyncingDirection(null)
    }
  }

  return (
    <View width="100%" UNSAFE_style={{ backgroundColor: '#f3f4f6', minHeight: '100vh' }}>
      {/* Page Header */}
      <View 
        UNSAFE_style={{
          backgroundColor: '#fff',
          borderBottom: '1px solid #d1d5db',
          padding: '20px 30px'
        }}
      >
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
          Magento Sync
        </Heading>
      </View>

      {/* Main Content */}
      <View padding="size-300">
        <Flex direction="column" gap="size-400">
          {/* Sync Actions */}
          <Well>
            <Flex direction="column" gap="size-300">
              <Heading level={2} marginTop="size-0">Sync Tax Rates</Heading>
              <Text size="M" UNSAFE_style={{ color: '#6b7280' }}>
                Sync tax rates between Magento and Extension. Choose the direction of sync.
              </Text>

              {(!magentoSettings.commerceDomain || !props.ims?.token) && (
                <View 
                  padding="size-200" 
                  backgroundColor="yellow-50"
                  borderRadius="regular"
                  borderWidth="thin"
                  borderColor="yellow-300"
                  marginBottom="size-200"
                >
                  <Text size="S" UNSAFE_style={{ color: '#d97706' }}>
                    {!magentoSettings.commerceDomain && !props.ims?.token 
                      ? '⚠️ Please configure Commerce Domain in Configuration page and ensure you are logged in to Adobe.'
                      : !magentoSettings.commerceDomain 
                        ? '⚠️ Please configure Commerce Domain in Configuration page.'
                        : '⚠️ IMS token not available. Please ensure you are logged in to Adobe.'}
                  </Text>
                </View>
              )}

              <Flex direction="row" gap="size-200" wrap>
                <Button 
                  variant="primary" 
                  onPress={handleSyncFromMagento}
                  isDisabled={syncing}
                  UNSAFE_style={{
                    backgroundColor: syncingDirection === 'magento-to-extension' ? '#059669' : '#0066cc',
                    borderColor: syncingDirection === 'magento-to-extension' ? '#059669' : '#0066cc',
                    color: '#fff',
                    minWidth: '220px'
                  }}
                >
                  {syncing && syncingDirection === 'magento-to-extension' ? 'Syncing...' : 'Magento to Extension Sync'}
                </Button>
                <Button 
                  variant="primary" 
                  onPress={handleSyncToMagento}
                  isDisabled={syncing}
                  UNSAFE_style={{
                    backgroundColor: syncingDirection === 'extension-to-magento' ? '#059669' : '#0066cc',
                    borderColor: syncingDirection === 'extension-to-magento' ? '#059669' : '#0066cc',
                    color: '#fff',
                    minWidth: '220px'
                  }}
                >
                  {syncing && syncingDirection === 'extension-to-magento' ? 'Syncing...' : 'Extension to Magento Sync'}
                </Button>
              </Flex>

              {syncing && (
                <View 
                  padding="size-300" 
                  backgroundColor="gray-50"
                  borderRadius="regular"
                  borderWidth="thin"
                  borderColor="gray-300"
                >
                  <Flex direction="column" gap="size-200">
                    <Flex direction="row" alignItems="center" gap="size-200">
                      <ProgressCircle isIndeterminate aria-label="Syncing..." size="S" />
                      <Text>
                        {syncingDirection === 'magento-to-extension' 
                          ? 'Syncing tax rates from Magento to Extension...' 
                          : 'Syncing tax rates from Extension to Magento...'}
                      </Text>
                    </Flex>
                    
                    {/* Progress Bar */}
                    <View>
                      <Flex direction="row" alignItems="center" gap="size-100" marginBottom="size-50">
                        <Text size="S" UNSAFE_style={{ fontWeight: 600 }}>
                          Progress: {progress}%
                        </Text>
                        {progress === 100 && (
                          <StatusLight variant="positive" size="S">
                            Completed
                          </StatusLight>
                        )}
                      </Flex>
                      <View 
                        UNSAFE_style={{
                          width: '100%',
                          height: '24px',
                          backgroundColor: '#e5e7eb',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          position: 'relative'
                        }}
                      >
                        <View
                          UNSAFE_style={{
                            width: `${progress}%`,
                            height: '100%',
                            backgroundColor: progress === 100 ? '#10b981' : '#3b82f6',
                            transition: 'width 0.3s ease, background-color 0.3s ease',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          {progress > 0 && (
                            <Text 
                              size="S" 
                              UNSAFE_style={{ 
                                color: '#fff', 
                                fontWeight: 600,
                                fontSize: '12px'
                              }}
                            >
                              {progress}%
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>

                    {/* Sync Logs */}
                    {syncLogs.length > 0 && (
                      <View 
                        padding="size-200"
                        backgroundColor="white"
                        borderRadius="regular"
                        borderWidth="thin"
                        borderColor="gray-300"
                        UNSAFE_style={{
                          maxHeight: '300px',
                          overflowY: 'auto'
                        }}
                      >
                        <Text size="S" UNSAFE_style={{ fontWeight: 600, marginBottom: '8px' }}>
                          Sync Logs:
                        </Text>
                        <Flex direction="column" gap="size-50">
                          {syncLogs.map((log, idx) => (
                            <Flex key={idx} direction="row" gap="size-100" alignItems="flex-start">
                              <Text size="S" UNSAFE_style={{ color: '#6b7280', minWidth: '80px' }}>
                                {log.timestamp}
                              </Text>
                              <Text 
                                size="S" 
                                UNSAFE_style={{ 
                                  color: log.type === 'success' ? '#059669' : 
                                         log.type === 'error' ? '#dc2626' : '#374151',
                                  flex: 1
                                }}
                              >
                                {log.message}
                              </Text>
                            </Flex>
                          ))}
                        </Flex>
                      </View>
                    )}
                  </Flex>
                </View>
              )}

              {syncResult && !syncing && (
                <View 
                  padding="size-300" 
                  backgroundColor={syncResult.success ? "green-50" : "yellow-50"}
                  borderRadius="regular"
                  borderWidth="thin"
                  borderColor={syncResult.success ? "green-300" : "yellow-300"}
                >
                  <Flex direction="column" gap="size-150">
                    <Flex direction="row" alignItems="center" gap="size-100">
                      <StatusLight variant={syncResult.success ? "positive" : "warning"} />
                      <Text UNSAFE_style={{ fontWeight: 600, color: syncResult.success ? '#059669' : '#d97706' }}>
                        {syncResult.message}
                      </Text>
                    </Flex>
                    <Flex direction="row" gap="size-300" wrap>
                      <Text size="S">
                        <strong>Synced:</strong> {syncResult.synced || 0}
                      </Text>
                      <Text size="S">
                        <strong>Failed:</strong> {syncResult.failed || 0}
                      </Text>
                      <Text size="S">
                        <strong>Total:</strong> {syncResult.total || 0}
                      </Text>
                    </Flex>
                    {syncResult.errors && syncResult.errors.length > 0 && (
                      <View marginTop="size-200">
                        <Text size="S" UNSAFE_style={{ fontWeight: 600, marginBottom: '8px' }}>Errors:</Text>
                        <Flex direction="column" gap="size-50">
                          {syncResult.errors.map((err, idx) => (
                            <Text key={idx} size="S" UNSAFE_style={{ color: '#dc2626' }}>
                              • {err.rateId || 'Rate'}: {err.error}
                            </Text>
                          ))}
                        </Flex>
                      </View>
                    )}
                  </Flex>
                </View>
              )}
            </Flex>
          </Well>

          {/* Sync History */}
          {syncHistory.length > 0 && (
            <Well>
              <Flex direction="column" gap="size-200">
                <Heading level={2} marginTop="size-0">Sync History</Heading>
                <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                  Recent sync operations (last 20)
                </Text>
                
                <TableView aria-label="Sync History" width="100%">
                  <TableHeader>
                    <Column>Date & Time</Column>
                    <Column>Mode</Column>
                    <Column>Status</Column>
                    <Column>Synced</Column>
                    <Column>Failed</Column>
                    <Column>Total</Column>
                  </TableHeader>
                  <TableBody>
                    {syncHistory.map((entry, index) => (
                      <Row key={index}>
                        <Cell>
                          <Text size="S">
                            {new Date(entry.timestamp).toLocaleString()}
                          </Text>
                        </Cell>
                        <Cell>
                          <Text size="S" UNSAFE_style={{ textTransform: 'capitalize' }}>
                            {entry.mode}
                          </Text>
                        </Cell>
                        <Cell>
                          <StatusLight 
                            variant={
                              entry.status === 'success' ? 'positive' : 
                              entry.status === 'error' ? 'negative' : 
                              'warning'
                            }
                            size="S"
                          >
                            {entry.status === 'success' ? 'Success' : 
                             entry.status === 'error' ? 'Error' : 
                             'Partial'}
                          </StatusLight>
                        </Cell>
                        <Cell>
                          <Text size="S">
                            {entry.result?.synced || 0}
                          </Text>
                        </Cell>
                        <Cell>
                          <Text size="S">
                            {entry.result?.failed || 0}
                          </Text>
                        </Cell>
                        <Cell>
                          <Text size="S">
                            {entry.result?.total || 0}
                          </Text>
                        </Cell>
                      </Row>
                    ))}
                  </TableBody>
                </TableView>
              </Flex>
            </Well>
          )}

          {/* Information Section */}
          <Well>
            <Flex direction="column" gap="size-200">
              <Heading level={2} marginTop="size-0">How Sync Works</Heading>
              <Flex direction="column" gap="size-150">
                <Text size="S">
                  <strong>1. Authentication:</strong> Uses Adobe IMS OAuth tokens automatically. Your App Builder app authenticates with Commerce SaaS using your Adobe ID credentials. No manual tokens or passwords needed.
                </Text>
                <Text size="S">
                  <strong>2. Data Retrieval:</strong> Tax rates are fetched from App Builder storage (tax-data action).
                </Text>
                <Text size="S">
                  <strong>3. Format Conversion:</strong> Tax rates are converted to Adobe Commerce REST API format.
                </Text>
                <Text size="S">
                  <strong>4. Sync:</strong> Each tax rate is created or updated in Commerce via REST API using IMS OAuth authentication.
                </Text>
                <Text size="S">
                  <strong>5. City Information:</strong> Since Commerce doesn't have a native city field, city information is stored in the tax rate title (e.g., "City Tax: Los Angeles, CA, US").
                </Text>
                <Text size="S" UNSAFE_style={{ color: '#dc2626', fontWeight: 600 }}>
                  <strong>Note:</strong> Ensure your App Builder app has Adobe Commerce API access configured in Adobe Developer Console with "Tax" resource permissions.
                </Text>
              </Flex>
            </Flex>
          </Well>
        </Flex>
      </View>
    </View>
  )
}

Sync.propTypes = {
  runtime: PropTypes.any,
  ims: PropTypes.any
}

export default Sync

