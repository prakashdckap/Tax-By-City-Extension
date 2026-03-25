/* 
* Dashboard Component - Shows overview and statistics
*/

import React, { useState, useEffect, useMemo } from 'react'
import PropTypes from 'prop-types'
import {
  Flex,
  Heading,
  View,
  Text,
  ProgressCircle,
  StatusLight,
  Link
} from '@adobe/react-spectrum'
import actionWebInvoke from '../utils'
import allActions from '../config.json'
import { buildActionHeaders, getConfiguredActionUrl } from '../runtimeConfig'

const SYNC_CONNECTED = 'Connected'
const SYNC_CONNECTED_PREVIEW = 'Connected (runtime auth)'
const SYNC_NOT_SIGNED_IN = 'Not signed in'

const Dashboard = (props) => {
  const [stats, setStats] = useState({
    totalTaxRates: 0,
    lastSync: 'Never',
    syncStatus: 'Idle'
  })
  const [loading, setLoading] = useState(true)

  const experienceCloudShellUrl = useMemo(() => {
    const u = new URL(window.location.href)
    const indexHref = u.pathname.endsWith('.html')
      ? `${u.origin}${u.pathname}`
      : `${u.origin}/index.html`
    return `https://experience.adobe.com/?devMode=true#/custom-apps/?localDevUrl=${encodeURIComponent(indexHref)}`
  }, [])

  useEffect(() => {
    loadStats()
  }, [props.ims?.token, props.ims?.org, props.runtime])

  const loadStats = async () => {
    setLoading(true)

    let actionUrl
    actionUrl = getConfiguredActionUrl(props.runtime, 'list-tax-rates')
    if (!actionUrl) {
      setLoading(false)
      setStats({
        totalTaxRates: 0,
        lastSync: 'Never',
        syncStatus: SYNC_NOT_SIGNED_IN
      })
      return
    }

    const listParams = { limit: 0 }

    const buildHeaders = () => {
      return buildActionHeaders({
        ims: props.ims,
        runtime: props.runtime,
        preferredAction: 'list-tax-rates',
        basicAuthBase64: allActions.runtimeBasicAuthBase64
      })
    }

    try {
      const response = await actionWebInvoke(actionUrl, buildHeaders(), listParams, { method: 'GET' })

      /**
       * Adobe web actions may return: direct body, OpenWhisk { statusCode, body },
       * or body as a JSON string. Nested result wrappers also appear in some gateways.
       */
      const extractTotal = (res) => {
        if (!res) return 0

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

        const fromPayload = (payload) => {
          if (!payload || typeof payload !== 'object') return 0
          if (Array.isArray(payload)) return payload.length
          if (typeof payload.count === 'number') return payload.count
          if (payload.data && Array.isArray(payload.data)) return payload.data.length
          return 0
        }

        // Direct: { status: 'Success', data, count }
        if (res.status === 'Success' || res.data != null || typeof res.count === 'number') {
          const n = fromPayload(res)
          if (n > 0 || (Array.isArray(res.data) && res.data.length === 0)) return n
        }

        // OpenWhisk-style
        if (res.statusCode === 200 && res.body != null) {
          const b = parseMaybe(res.body)
          const n = fromPayload(b)
          if (n > 0 || (b && Array.isArray(b.data) && b.data.length === 0)) return n
        }

        // Nested (shell / gateway)
        const nested =
          res.response?.result?.body ||
          res.result?.body ||
          res.result?.response?.result?.body
        if (nested != null) {
          const b = parseMaybe(nested)
          const n = fromPayload(b)
          if (n > 0 || (b && Array.isArray(b.data) && b.data.length === 0)) return n
        }

        if (Array.isArray(res.data)) return res.data.length
        if (typeof res.count === 'number') return res.count
        if (Array.isArray(res)) return res.length
        return 0
      }

      const total = extractTotal(response)
      setStats({
        totalTaxRates: total,
        lastSync: new Date().toLocaleString(),
        syncStatus: props.ims?.token ? SYNC_CONNECTED : SYNC_CONNECTED_PREVIEW
      })
    } catch (err) {
      if (!props.ims?.token) {
        setStats({
          totalTaxRates: 0,
          lastSync: 'Never',
          syncStatus: SYNC_NOT_SIGNED_IN
        })
      } else {
        setStats({
          totalTaxRates: 0,
          lastSync: 'Never',
          syncStatus: 'Error'
        })
      }
    } finally {
      setLoading(false)
    }
  }


  return (
    <View width="100%" UNSAFE_style={{ padding: window.innerWidth <= 768 ? '15px' : '30px' }}>
      <Flex direction="column" gap={window.innerWidth <= 768 ? "size-300" : "size-400"}>
        <Flex direction="column" gap="size-100">
          <Heading level={1} marginTop="size-0">Dashboard</Heading>
          <Text elementType="p" size="M" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
            Overview of your tax configuration and statistics
          </Text>
        </Flex>

        {loading ? (
          <View padding="size-400" alignItems="center">
            <ProgressCircle isIndeterminate aria-label="Loading..." />
          </View>
        ) : (
          <Flex direction="row" gap="size-300" wrap className="mobile-stack">
            <View 
              padding={window.innerWidth <= 768 ? "size-200" : "size-400"}
              backgroundColor="white"
              borderRadius="regular"
              borderWidth="thin"
              borderColor="gray-300"
              minWidth={window.innerWidth <= 768 ? "100%" : "size-3000"}
              width={window.innerWidth <= 768 ? "100%" : undefined}
              UNSAFE_style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <Flex direction="column" gap="size-150">
                <Text size="S" UNSAFE_style={{ 
                  color: 'var(--spectrum-global-color-gray-600)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: 600
                }}>
                  Total Tax Rates
                </Text>
                <Heading level={1} marginTop="size-0" UNSAFE_style={{ 
                  color: 'var(--spectrum-global-color-blue-600)',
                  fontSize: '2.5rem'
                }}>
                  {stats.syncStatus === SYNC_NOT_SIGNED_IN ? '—' : stats.totalTaxRates}
                </Heading>
                {stats.syncStatus === SYNC_NOT_SIGNED_IN && (
                  <Flex direction="column" gap="size-100" marginTop="size-100">
                    <Text size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
                      The static URL does not receive an Adobe IMS session. Open the app in Experience Cloud (dev mode) to sign in; totals load automatically after that.
                    </Text>
                    <Link href={experienceCloudShellUrl} target="_blank" rel="noopener noreferrer">
                      Open TaxByCity in Experience Cloud
                    </Link>
                  </Flex>
                )}
              </Flex>
            </View>

            <View 
              padding="size-400"
              backgroundColor="white"
              borderRadius="regular"
              borderWidth="thin"
              borderColor="gray-300"
              minWidth="size-3000"
              UNSAFE_style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <Flex direction="column" gap="size-150">
                <Text size="S" UNSAFE_style={{ 
                  color: 'var(--spectrum-global-color-gray-600)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: 600
                }}>
                  Last Sync
                </Text>
                <Heading level={2} marginTop="size-0">
                  {stats.lastSync}
                </Heading>
              </Flex>
            </View>

            <View 
              padding="size-400"
              backgroundColor="white"
              borderRadius="regular"
              borderWidth="thin"
              borderColor="gray-300"
              minWidth="size-3000"
              UNSAFE_style={{
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <Flex direction="column" gap="size-150">
                <Text size="S" UNSAFE_style={{ 
                  color: 'var(--spectrum-global-color-gray-600)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  fontWeight: 600
                }}>
                  Sync Status
                </Text>
                <StatusLight 
                  variant={
                    stats.syncStatus === SYNC_CONNECTED || stats.syncStatus === SYNC_CONNECTED_PREVIEW
                      ? 'positive'
                      : stats.syncStatus === 'Error'
                        ? 'negative'
                        : 'neutral'
                  }
                >
                  {stats.syncStatus}
                </StatusLight>
              </Flex>
            </View>
          </Flex>
        )}

      </Flex>
    </View>
  )
}

Dashboard.propTypes = {
  runtime: PropTypes.any,
  ims: PropTypes.any
}

export default Dashboard

