/* 
* Sync Component - Magento SaaS Sync Management
* Allows users to configure Magento credentials and sync tax rates
*/

import React, { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import {
  Flex,
  Heading,
  View,
  StatusLight,
  Text,
  Well,
  ProgressCircle,
  ProgressBar,
  TableView,
  TableHeader,
  TableBody,
  Row,
  Cell,
  Column
} from '@adobe/react-spectrum'
import actionWebInvoke from '../utils'
import allActions from '../config.json'
import { buildActionHeaders, getConfiguredActionUrl } from '../runtimeConfig'

const Sync = (props) => {
  const [syncing, setSyncing] = useState(false)
  const [magentoSyncIndeterminate, setMagentoSyncIndeterminate] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [syncResult, setSyncResult] = useState(null)
  const [syncHistory, setSyncHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState(null)
  const [progress, setProgress] = useState(0)
  const [syncLogs, setSyncLogs] = useState([])
  
  // Load Magento settings from Configuration page
  const [magentoSettings, setMagentoSettings] = useState({
    commerceDomain: '',
    instanceId: ''
  })
  
  useEffect(() => {
    const saved = localStorage.getItem('magentoSettings')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setMagentoSettings({
          commerceDomain: parsed.commerceDomain || '',
          instanceId: parsed.instanceId || ''
        })
      } catch (e) {
        // Error loading settings
      }
    }
  }, [])

  // Load sync history whenever the page is shown / auth changes (last 20 from App Builder)
  useEffect(() => {
    loadSyncHistory()
  }, [props.ims?.token, props.ims?.org, props.runtime])

  const getActionUrl = (name, fallback) => {
    return getConfiguredActionUrl(props.runtime, name) || fallback
  }

  const buildApiHeaders = () => {
    return buildActionHeaders({
      ims: props.ims,
      runtime: props.runtime,
      preferredAction: 'sync-tax-rates',
      basicAuthBase64: allActions.runtimeBasicAuthBase64
    })
  }

  const parseHistoryRows = (res) => {
    if (!res) return []
    const parseMaybe = (v) => {
      if (v == null) return null
      if (typeof v === 'string') {
        try {
          return JSON.parse(v)
        } catch {
          return null
        }
      }
      return v
    }
    if (Array.isArray(res.data)) return res.data
    if (res.status === 'Success' && Array.isArray(res.data)) return res.data
    if (res.statusCode === 200 && res.body != null) {
      const b = parseMaybe(res.body)
      if (b && Array.isArray(b.data)) return b.data
    }
    const nested = res.response?.result?.body || res.result?.body
    if (nested != null) {
      const b = parseMaybe(nested)
      if (b && Array.isArray(b.data)) return b.data
    }
    return []
  }

  const refreshHistoryAfterSync = async () => {
    await loadSyncHistory()
    await new Promise((r) => setTimeout(r, 350))
    await loadSyncHistory()
  }

  const formatModeLabel = (mode) => {
    if (mode === 'magento-to-extension') return 'Magento to Extension'
    if (mode === 'extension-to-magento') return 'Extension to Magento'
    return mode || '—'
  }

  const unwrapWebActionResponse = (res) => {
    if (!res) return null
    if (res.body != null) {
      if (typeof res.body === 'string') {
        try {
          return JSON.parse(res.body)
        } catch {
          return null
        }
      }
      return res.body
    }
    if (res.status === 'Success' || res.data != null || res.message != null) return res
    return res
  }

  const loadSyncHistory = async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const url = getActionUrl('list-sync-history')
      if (!url) {
        setHistoryError('list-sync-history URL not configured.')
        setSyncHistory([])
        return
      }
      const response = await actionWebInvoke(url, buildApiHeaders(), { limit: 20 }, { method: 'GET' })
      const rows = parseHistoryRows(response)
      setSyncHistory(Array.isArray(rows) ? rows : [])
    } catch (e) {
      console.error('Error loading sync history:', e)
      setHistoryError(e.message || 'Failed to load sync history.')
      setSyncHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString()
    setSyncLogs(prev => [...prev, { timestamp, message, type }])
  }

  const handleSyncFromMagento = async () => {
    setSyncing(true)
    setMagentoSyncIndeterminate(true)
    setError(null)
    setSuccess(false)
    setSyncResult(null)
    setProgress(5)
    setSyncLogs([])

    let progressTimer = null
    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      addLog('Starting Magento → Extension sync (server uses MAGENTO_* / ADOBE_* from deployment)...', 'info')
      setProgress(12)

      const headers = buildApiHeaders()

      const syncActionUrl =
        getActionUrl('sync-tax-rates') ||
        allActions['tax-by-city/sync-tax-rates'] ||
        SYNC_TAX_RATES_FALLBACK_URL
      if (!syncActionUrl) {
        throw new Error('sync-tax-rates action URL not found.')
      }

      addLog(`POST ${syncActionUrl}`, 'info')
      setProgress(18)

      progressTimer = setInterval(() => {
        setProgress((p) => (p >= 88 ? p : p + 4))
      }, 220)

      const payload = {}
      if (magentoSettings.commerceDomain) {
        payload.commerceDomain = magentoSettings.commerceDomain
      }
      if (magentoSettings.instanceId) {
        payload.instanceId = magentoSettings.instanceId
      }

      const syncResponse = await actionWebInvoke(syncActionUrl, headers, payload, { method: 'POST' })

      if (progressTimer) {
        clearInterval(progressTimer)
        progressTimer = null
      }
      setMagentoSyncIndeterminate(false)

      const inner = unwrapWebActionResponse(syncResponse)
      const syncData = inner?.data
      if (!syncData || inner?.status === 'Error') {
        throw new Error(
          inner?.message || syncResponse?.message || 'Invalid sync response from sync-tax-rates'
        )
      }

      setProgress(100)
      addLog(`Sync completed: ${syncData.synced} synced, ${syncData.failed} failed`, syncData.failed > 0 ? 'warning' : 'success')

      setSyncResult({
        success: syncData.status !== 'error',
        message: inner?.message || 'Magento sync completed',
        synced: syncData.synced || 0,
        failed: syncData.failed || 0,
        total: syncData.total || 0,
        errors: syncData.errors || []
      })

      setSuccess((syncData.synced || 0) > 0)
      setError(null)
      await refreshHistoryAfterSync()

      await new Promise((r) => setTimeout(r, 650))
    } catch (err) {
      if (progressTimer) clearInterval(progressTimer)
      setMagentoSyncIndeterminate(false)
      addLog(`Error: ${err.message}`, 'error')
      setError(`Sync failed: ${err.message}`)
      setSyncResult(null)
      setProgress(0)
    } finally {
      if (progressTimer) clearInterval(progressTimer)
      setMagentoSyncIndeterminate(false)
      setSyncing(false)
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
                Pull tax rates from Magento into App Builder (sync-tax-rates).
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
                        ? 'ℹ️ Commerce domain is not saved in Configuration. Magento → Extension will use MAGENTO_COMMERCE_DOMAIN / MAGENTO_INSTANCE_ID from the deployed action environment when set.'
                        : '⚠️ IMS token not available. Please ensure you are logged in to Adobe.'}
                  </Text>
                </View>
              )}

              <Flex direction="row" gap="size-200" wrap>
                <button
                  type="button"
                  onClick={() => {
                    void handleSyncFromMagento()
                  }}
                  disabled={syncing}
                  aria-busy={syncing}
                  style={{
                    backgroundColor: syncing ? '#059669' : '#0066cc',
                    border: `1px solid ${syncing ? '#059669' : '#0066cc'}`,
                    color: '#fff',
                    minWidth: '220px',
                    padding: '10px 16px',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: syncing ? 'not-allowed' : 'pointer',
                    opacity: syncing ? 0.85 : 1
                  }}
                >
                  {syncing ? 'Syncing...' : 'Magento to Extension Sync'}
                </button>
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
                        Syncing tax rates from Magento to Extension (sync-tax-rates)…
                      </Text>
                    </Flex>

                    <View width="100%">
                      {magentoSyncIndeterminate ? (
                        <ProgressBar
                          label="Calling sync-tax-rates (Magento → App Builder)…"
                          isIndeterminate
                          UNSAFE_style={{ width: '100%' }}
                        />
                      ) : (
                        <ProgressBar
                          label="Magento → Extension"
                          value={progress}
                          UNSAFE_style={{ width: '100%' }}
                        />
                      )}
                    </View>
                    
                    {/* Progress Bar (numeric) */}
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

          {/* Sync History — always visible; loads last 20 from list-sync-history */}
          <Well>
            <Flex direction="column" gap="size-200">
              <Heading level={2} marginTop="size-0">Sync History</Heading>
              <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                Last 20 sync runs from App Builder (list-sync-history). Refreshes when you open this page.
              </Text>

              {historyLoading && (
                <Flex direction="row" alignItems="center" gap="size-150" paddingY="size-100">
                  <ProgressCircle size="S" isIndeterminate aria-label="Loading sync history" />
                  <Text size="S">Loading history…</Text>
                </Flex>
              )}

              {!historyLoading && historyError && (
                <Text size="S" UNSAFE_style={{ color: '#b45309' }}>
                  {historyError}
                </Text>
              )}

              {!historyLoading && !historyError && syncHistory.length === 0 && (
                <Text size="S" UNSAFE_style={{ color: '#6b7280' }}>
                  No sync history yet. Run a sync above to create records.
                </Text>
              )}

              {!historyLoading && syncHistory.length > 0 && (
                <TableView aria-label="Sync History" width="100%">
                  <TableHeader>
                    <Column>Date &amp; Time</Column>
                    <Column>Mode</Column>
                    <Column>Status</Column>
                    <Column>Sync</Column>
                    <Column>Failed</Column>
                    <Column>Total</Column>
                  </TableHeader>
                  <TableBody>
                    {syncHistory.map((entry, index) => {
                      const synced = entry.synced ?? entry.result?.synced ?? 0
                      const failed = entry.failed ?? entry.result?.failed ?? 0
                      const total = entry.total ?? entry.result?.total ?? synced + failed
                      const ts = entry.timestamp || entry.created_at
                      const rowKey =
                        entry._id != null ? String(entry._id) : `${ts || 'row'}-${index}`
                      return (
                        <Row key={rowKey}>
                          <Cell>
                            <Text size="S">
                              {ts ? new Date(ts).toLocaleString() : '—'}
                            </Text>
                          </Cell>
                          <Cell>
                            <Text size="S">{formatModeLabel(entry.mode)}</Text>
                          </Cell>
                          <Cell>
                            <StatusLight
                              variant={
                                entry.status === 'success'
                                  ? 'positive'
                                  : entry.status === 'error'
                                    ? 'negative'
                                    : 'warning'
                              }
                              size="S"
                            >
                              {entry.status === 'success'
                                ? 'Success'
                                : entry.status === 'error'
                                  ? 'Error'
                                  : 'Partial'}
                            </StatusLight>
                          </Cell>
                          <Cell>
                            <Text size="S">{synced}</Text>
                          </Cell>
                          <Cell>
                            <Text size="S">{failed}</Text>
                          </Cell>
                          <Cell>
                            <Text size="S">{total}</Text>
                          </Cell>
                        </Row>
                      )
                    })}
                  </TableBody>
                </TableView>
              )}
            </Flex>
          </Well>

          {/* Information Section */}
          <Well>
            <Flex direction="column" gap="size-200">
              <Heading level={2} marginTop="size-0">How Sync Works</Heading>
              <Flex direction="column" gap="size-150">
                <Text size="S">
                  <strong>1. Action:</strong> The sync-tax-rates web action reads Magento tax rates and upserts them into App Builder Database by tax identifier.
                </Text>
                <Text size="S">
                  <strong>2. Configuration:</strong> Commerce domain and instance can come from Configuration or from MAGENTO_COMMERCE_DOMAIN / MAGENTO_INSTANCE_ID on the deployed action.
                </Text>
                <Text size="S">
                  <strong>3. History:</strong> Each run is recorded in Sync History (list-sync-history).
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

