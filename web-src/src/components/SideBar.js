/* 
* Professional Sidebar Component for Tax By City
*/

import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Flex, Heading, View } from '@adobe/react-spectrum'
import HomeIcon from '@spectrum-icons/workflow/Home'
import DashboardIcon from '@spectrum-icons/workflow/Dashboard'
import SettingsIcon from '@spectrum-icons/workflow/Settings'
import DocumentIcon from '@spectrum-icons/workflow/Document'
import SyncIcon from '@spectrum-icons/workflow/Sync'

function SideBar () {
    const location = useLocation()
    
    const navItems = [
        { path: '/', label: 'Home', icon: HomeIcon },
        { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
        { path: '/configuration', label: 'Configuration', icon: SettingsIcon },
        { path: '/tax-rates', label: 'Tax Rates', icon: DocumentIcon },
        { path: '/sync', label: 'Magento Sync', icon: SyncIcon }
    ]

    return (
        <View height="100%" UNSAFE_style={{ backgroundColor: '#2c2c2c' }}>
            <Flex direction="column" height="100%">
                <View 
                    padding="size-300" 
                    UNSAFE_style={{
                        borderBottom: '1px solid #404040',
                        backgroundColor: '#1a1a1a'
                    }}
                >
                    <Heading 
                        level={2} 
                        margin={0}
                        UNSAFE_style={{
                            color: '#fff',
                            fontSize: '18px',
                            fontWeight: 600
                        }}
                    >
                        Tax By City
                    </Heading>
                </View>
                
                <Flex direction="column" gap="size-0" padding="size-0" flex>
                    {navItems.map((item) => {
                        const isActive = location.pathname === item.path || 
                                       (item.path !== '/' && location.pathname.startsWith(item.path))
                        const Icon = item.icon
                        
                        return (
                            <NavLink
                                key={item.path}
                                to={item.path}
                                style={{ 
                                    textDecoration: 'none',
                                    display: 'block',
                                    width: '100%'
                                }}
                            >
                                <View
                                    padding="size-200"
                                    UNSAFE_style={{
                                        backgroundColor: isActive ? '#514f50' : 'transparent',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        borderLeft: isActive ? '3px solid #eb5202' : '3px solid transparent',
                                        ':hover': {
                                            backgroundColor: '#3a3a3a'
                                        }
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.backgroundColor = '#3a3a3a'
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isActive) {
                                            e.currentTarget.style.backgroundColor = 'transparent'
                                        }
                                    }}
                                >
                                    <Flex direction="row" gap="size-150" alignItems="center">
                                        <Icon 
                                            size="S" 
                                            UNSAFE_style={{ 
                                                color: isActive ? '#fff' : '#b3b3b3'
                                            }}
                                        />
                                        <span style={{
                                            color: isActive ? '#fff' : '#b3b3b3',
                                            fontWeight: isActive ? 600 : 400,
                                            fontSize: '14px'
                                        }}>
                                            {item.label}
                                        </span>
                                    </Flex>
                                </View>
                            </NavLink>
                        )
                    })}
                </Flex>
            </Flex>
        </View>
    )
}

export default SideBar
