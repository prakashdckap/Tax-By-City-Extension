/*
* <license header>
*/

import React from 'react'
import { Heading, View, Text, Flex, Button, Link, Well } from '@adobe/react-spectrum'
import { useNavigate } from 'react-router-dom'
import SettingsIcon from '@spectrum-icons/workflow/Settings'
import DashboardIcon from '@spectrum-icons/workflow/Dashboard'
import DocumentIcon from '@spectrum-icons/workflow/Document'
import CheckIcon from '@spectrum-icons/workflow/CheckmarkCircle'

export const Home = () => {
  const navigate = useNavigate()
  
  return (
    <View width="100%" UNSAFE_style={{ padding: window.innerWidth <= 768 ? '15px' : '30px' }}>
      <Flex direction="column" gap={window.innerWidth <= 768 ? "size-300" : "size-500"}>
        <Flex direction="column" gap="size-200">
          <Heading level={1} marginTop="size-0" UNSAFE_style={{ fontSize: window.innerWidth <= 768 ? '24px' : '32px' }}>
            Tax By City
          </Heading>
          <Text elementType="p" size={window.innerWidth <= 768 ? "M" : "L"} UNSAFE_style={{ color: 'var(--spectrum-global-color-gray-700)' }}>
            Professional tax management solution for Magento SaaS. Manage tax rates based on City, State, Country, and ZIP code ranges with a fully SaaS-compatible architecture.
          </Text>
        </Flex>

        <Flex direction="row" gap="size-300" wrap className="mobile-stack">
          <Well 
            width={window.innerWidth <= 768 ? "100%" : "calc(33.333% - size-200)"} 
            minWidth={window.innerWidth <= 768 ? "100%" : "size-3000"}
            UNSAFE_style={{
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              border: '1px solid var(--spectrum-global-color-gray-300)'
            }}
            onPress={() => navigate('/configuration')}
          >
            <Flex direction="column" gap="size-200">
              <Flex direction="row" gap="size-150" alignItems="center">
                <SettingsIcon size="M" UNSAFE_style={{ color: 'var(--spectrum-global-color-blue-600)' }} />
                <Heading level={2} marginTop="size-0">Configuration</Heading>
              </Flex>
              <Text>
                Configure your Magento store connection and extension settings. Set up API credentials and enable features.
              </Text>
              <Button variant="primary" onPress={() => navigate('/configuration')}>
                Configure Settings
              </Button>
            </Flex>
          </Well>

          <Well 
            width={window.innerWidth <= 768 ? "100%" : "calc(33.333% - size-200)"} 
            minWidth={window.innerWidth <= 768 ? "100%" : "size-3000"}
            UNSAFE_style={{
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              border: '1px solid var(--spectrum-global-color-gray-300)'
            }}
            onPress={() => navigate('/dashboard')}
          >
            <Flex direction="column" gap="size-200">
              <Flex direction="row" gap="size-150" alignItems="center">
                <DashboardIcon size="M" UNSAFE_style={{ color: 'var(--spectrum-global-color-blue-600)' }} />
                <Heading level={2} marginTop="size-0">Dashboard</Heading>
              </Flex>
              <Text>
                View overview statistics, total tax rates, connection status, and last sync information.
              </Text>
              <Button variant="primary" onPress={() => navigate('/dashboard')}>
                View Dashboard
              </Button>
            </Flex>
          </Well>

          <Well 
            width={window.innerWidth <= 768 ? "100%" : "calc(33.333% - size-200)"} 
            minWidth={window.innerWidth <= 768 ? "100%" : "size-3000"}
            UNSAFE_style={{
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              border: '1px solid var(--spectrum-global-color-gray-300)'
            }}
            onPress={() => navigate('/tax-rates')}
          >
            <Flex direction="column" gap="size-200">
              <Flex direction="row" gap="size-150" alignItems="center">
                <DocumentIcon size="M" UNSAFE_style={{ color: 'var(--spectrum-global-color-blue-600)' }} />
                <Heading level={2} marginTop="size-0">Tax Rate Manager</Heading>
              </Flex>
              <Text>
                View, create, edit, and delete tax rates with city support. Manage all your tax configurations.
              </Text>
              <Button variant="primary" onPress={() => navigate('/tax-rates')}>
                Manage Tax Rates
              </Button>
            </Flex>
          </Well>
        </Flex>

        <Flex direction="row" gap="size-300" wrap>
          <Well 
            flex="1"
            minWidth="size-4000"
            UNSAFE_style={{
              border: '1px solid var(--spectrum-global-color-gray-300)'
            }}
          >
            <Flex direction="column" gap="size-200">
              <Heading level={2} marginTop="size-0">Getting Started</Heading>
              <Flex direction="column" gap="size-150">
                <Flex direction="row" gap="size-150" alignItems="start">
                  <Text UNSAFE_style={{ fontWeight: 600, minWidth: '60px' }}>Step 1:</Text>
                  <Text>
                    Navigate to <Link onPress={() => navigate('/configuration')}>Configuration</Link> and set up your Magento store connection (Base URL, Admin Username, Password).
                  </Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="start">
                  <Text UNSAFE_style={{ fontWeight: 600, minWidth: '60px' }}>Step 2:</Text>
                  <Text>
                    Test the connection to ensure your credentials are correct.
                  </Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="start">
                  <Text UNSAFE_style={{ fontWeight: 600, minWidth: '60px' }}>Step 3:</Text>
                  <Text>
                    Go to <Link onPress={() => navigate('/tax-rates')}>Tax Rate Manager</Link> to start managing tax rates with city support.
                  </Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="start">
                  <Text UNSAFE_style={{ fontWeight: 600, minWidth: '60px' }}>Step 4:</Text>
                  <Text>
                    View your <Link onPress={() => navigate('/dashboard')}>Dashboard</Link> for statistics and overview.
                  </Text>
                </Flex>
              </Flex>
            </Flex>
          </Well>

          <Well 
            flex="1"
            minWidth="size-4000"
            UNSAFE_style={{
              border: '1px solid var(--spectrum-global-color-gray-300)'
            }}
          >
            <Flex direction="column" gap="size-200">
              <Heading level={2} marginTop="size-0">Key Features</Heading>
              <Flex direction="column" gap="size-100">
                <Flex direction="row" gap="size-150" alignItems="center">
                  <CheckIcon size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-green-600)' }} />
                  <Text>City, State, Country & ZIP code based tax management</Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="center">
                  <CheckIcon size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-green-600)' }} />
                  <Text>ZIP code range support (e.g., 90001 - 90010)</Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="center">
                  <CheckIcon size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-green-600)' }} />
                  <Text>Case-insensitive city matching with wildcards</Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="center">
                  <CheckIcon size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-green-600)' }} />
                  <Text>Fully SaaS-compatible architecture</Text>
                </Flex>
                <Flex direction="row" gap="size-150" alignItems="center">
                  <CheckIcon size="S" UNSAFE_style={{ color: 'var(--spectrum-global-color-green-600)' }} />
                  <Text>Real-time tax calculation engine</Text>
                </Flex>
              </Flex>
            </Flex>
          </Well>
        </Flex>
      </Flex>
    </View>
  )
}
