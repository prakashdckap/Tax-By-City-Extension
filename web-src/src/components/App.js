/* 
* <license header>
*/

import React, { useState, useEffect } from 'react'
import { Provider, defaultTheme, Grid, View } from '@adobe/react-spectrum'
import ErrorBoundary from 'react-error-boundary'
import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import SideBar from './SideBar'
import { Home } from './Home'
import TaxRateManager from './TaxRateManager'
import Settings from './Settings'
import Dashboard from './Dashboard'
import Sync from './Sync'

function App (props) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768)
  const [ims, setIms] = useState(() => props.ims || {})

  useEffect(() => {
    setIms(props.ims || {})
  }, [props.ims?.token, props.ims?.org, props.ims?.profile])

  useEffect(() => {
    const rt = props.runtime
    if (!rt || typeof rt.on !== 'function') return

    const onConfiguration = ({ imsOrg, imsToken, imsProfile, locale }) => {
      console.log('configuration change', { imsOrg, imsToken, locale })
      setIms((prev) => ({
        ...prev,
        org: imsOrg != null ? imsOrg : prev.org,
        token: imsToken != null ? imsToken : prev.token,
        profile: imsProfile != null ? imsProfile : prev.profile,
        user:
          imsProfile != null
            ? {
                name:
                  [imsProfile.firstName, imsProfile.lastName].filter(Boolean).join(' ').trim() ||
                  imsProfile.email ||
                  prev?.user?.name ||
                  'User'
              }
            : prev.user
      }))
    }

    const onHistory = ({ type, path }) => {
      console.log('history change', { type, path })
    }

    rt.on('configuration', onConfiguration)
    rt.on('history', onHistory)
    return () => {
      if (typeof rt.off === 'function') {
        rt.off('configuration', onConfiguration)
        rt.off('history', onHistory)
      }
    }
  }, [props.runtime])

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768
      setIsMobile(mobile)
      if (!mobile) {
        setSidebarOpen(false)
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  console.log('runtime object:', props.runtime)
  console.log('ims object:', ims)

  return (
    <ErrorBoundary onError={onError} FallbackComponent={fallbackComponent}>
      <Router>
        <Provider theme={defaultTheme} colorScheme={'light'}>
          <Grid
            areas={isMobile 
              ? ['header', 'content'] 
              : ['header header', 'sidebar content']}
            columns={isMobile ? ['1fr'] : ['240px', '1fr']}
            rows={isMobile ? ['60px', '1fr'] : ['60px', '1fr']}
            height='100vh'
            gap='0'
          >
            {/* Magento-style Top Header */}
            <View
              gridArea='header'
              UNSAFE_style={{
                backgroundColor: '#fff',
                borderBottom: '1px solid #d1d5db',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: isMobile ? '0 15px' : '0 20px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                position: 'relative',
                zIndex: 1000
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '10px' : '20px' }}>
                {isMobile && (
                  <button
                    onClick={() => setSidebarOpen(!sidebarOpen)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '8px',
                      color: '#6b7280',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    className="mobile-menu-button"
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
                    </svg>
                  </button>
                )}
                <span style={{ fontSize: isMobile ? '16px' : '18px', fontWeight: 600, color: '#1f2937' }}>Tax By City</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '8px' : '15px' }}>
                <button style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px',
                  color: '#6b7280'
                }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" />
                  </svg>
                </button>
                <button style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px',
                  color: '#6b7280'
                }}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 12px',
                  cursor: 'pointer',
                  borderRadius: '4px'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: '#3b82f6',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '14px',
                    fontWeight: 600
                  }}>
                    {props.ims?.user?.name?.charAt(0) || 'U'}
                  </div>
                  <span style={{ fontSize: '14px', color: '#374151' }} className={isMobile ? 'mobile-hide' : ''}>
                    {props.ims?.user?.name || 'User'}
                  </span>
                  {!isMobile && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" style={{ color: '#6b7280' }}>
                      <path d="M6 9L1 4h10L6 9z" />
                    </svg>
                  )}
                </div>
              </div>
            </View>

            {/* Mobile Sidebar Overlay */}
            {isMobile && sidebarOpen && (
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(0,0,0,0.5)',
                  zIndex: 999,
                  display: sidebarOpen ? 'block' : 'none'
                }}
                onClick={() => setSidebarOpen(false)}
              />
            )}

            {/* Magento-style Dark Sidebar */}
            <View
              gridArea={isMobile ? undefined : 'sidebar'}
              UNSAFE_style={{
                backgroundColor: '#2c2c2c',
                overflowY: 'auto',
                position: isMobile ? 'fixed' : 'relative',
                left: isMobile ? (sidebarOpen ? 0 : '-240px') : 0,
                top: isMobile ? '60px' : 0,
                width: isMobile ? '240px' : '100%',
                height: isMobile ? 'calc(100vh - 60px)' : '100%',
                zIndex: isMobile ? 1000 : 1,
                transition: 'left 0.3s ease'
              }}
            >
              <SideBar></SideBar>
            </View>
            
            {/* Main Content Area */}
            <View 
              gridArea='content' 
              UNSAFE_style={{
                backgroundColor: '#f3f4f6',
                overflow: 'auto',
                padding: '0'
              }}
            >
              <Routes>
                <Route path='/' element={<Home />} />
                <Route path='/dashboard' element={<Dashboard runtime={props.runtime} ims={ims} />}/>
                <Route path='/configuration' element={<Settings runtime={props.runtime} ims={ims} />}/>
                <Route path='/tax-rates' element={<TaxRateManager runtime={props.runtime} ims={ims} />}/>
                <Route path='/sync' element={<Sync runtime={props.runtime} ims={ims} />}/>
              </Routes>
            </View>
          </Grid>
        </Provider>
      </Router>
    </ErrorBoundary>
  )

  // Methods

  // error handler on UI rendering failure
  function onError (e, componentStack) { }

  // component to show if UI fails rendering
  function fallbackComponent ({ componentStack, error }) {
    return (
      <React.Fragment>
        <h1 style={{ textAlign: 'center', marginTop: '20px' }}>
          Something went wrong :(
        </h1>
        <pre>{componentStack + '\n' + error.message}</pre>
      </React.Fragment>
    )
  }
}

export default App
