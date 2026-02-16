/* 
* Dashboard Component - Shows overview and statistics
*/

import React, { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import {
  Flex,
  Heading,
  View,
  Text,
  ProgressCircle,
  StatusLight
} from '@adobe/react-spectrum'
import actionWebInvoke from '../utils'
import allActions from '../config.json'

const Dashboard = (props) => {
  const [stats, setStats] = useState({
    totalTaxRates: 0,
    lastSync: 'Never',
    syncStatus: 'Idle'
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadStats()
    
  }, [props.ims, props.runtime])

  const loadStats = async () => {
    setLoading(true)
    
    try {
      const savedSettings = localStorage.getItem('taxByCitySettings')
      if (!savedSettings) {
        setStats({
          totalTaxRates: 0,
          lastSync: 'Never',
          syncStatus: 'Not Configured'
        })
        setLoading(false)
        return
      }

      const settings = JSON.parse(savedSettings)
      const headers = {
        authorization: `Bearer ${props.ims.token}`,
        'x-gw-ims-org-id': props.ims.org
      }

      const params = {
        magentoBaseUrl: settings.magentoBaseUrl,
        magentoAdminUsername: settings.magentoAdminUsername,
        magentoAdminPassword: settings.magentoAdminPassword,
        operation: 'LIST'
      }

      // Get action URL from config or runtime
      let actionUrl
      if (props.runtime && typeof props.runtime.getActionUrl === 'function') {
        actionUrl = props.runtime.getActionUrl('tax-rate')
      } else if (allActions['tax-rate']) {
        actionUrl = allActions['tax-rate']
      } else if (allActions['tax-by-city/tax-rate']) {
        actionUrl = allActions['tax-by-city/tax-rate']
      } else {
        throw new Error('Action URL not found. Please ensure the action is deployed.')
      }
      
      const response = await actionWebInvoke(actionUrl, headers, params)

      if (response.statusCode === 200 && response.body) {
        const rates = Array.isArray(response.body) ? response.body : []
        setStats({
          totalTaxRates: rates.length,
          lastSync: new Date().toLocaleString(),
          syncStatus: 'Connected'
        })
      }
    } catch (err) {
      setStats({
        totalTaxRates: 0,
        lastSync: 'Never',
        syncStatus: 'Error'
      })
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
                  {stats.totalTaxRates}
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
                    stats.syncStatus === 'Connected' ? 'positive' : 
                    stats.syncStatus === 'Error' ? 'negative' : 
                    'neutral'
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

