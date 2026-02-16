/* 
* <license header>
*/

/* global fetch */

/**
 *
 * Invokes a web action
 *
 * @param  {string} actionUrl
 * @param {object} headers
 * @param  {object} params
 *
 * @returns {Promise<string|object>} the response
 *
 */

async function actionWebInvoke (actionUrl, headers = {}, params = {}, options = { method: 'POST' }) {
  // Normalize headers - ensure Authorization is capitalized for HTTP request
  // (Adobe I/O Runtime will convert it to lowercase in __ow_headers)
  const normalizedHeaders = {}
  Object.keys(headers).forEach(key => {
    const normalizedKey = key.toLowerCase() === 'authorization' ? 'Authorization' : key
    normalizedHeaders[normalizedKey] = headers[key]
  })
  
  const actionHeaders = {
    'Content-Type': 'application/json',
    ...normalizedHeaders
  }

  // Debug: Log headers being sent
  console.log('[actionWebInvoke] Sending headers:', Object.keys(actionHeaders))
  console.log('[actionWebInvoke] Authorization present:', !!actionHeaders.Authorization || !!actionHeaders.authorization)
  console.log('[actionWebInvoke] x-gw-ims-org-id present:', !!actionHeaders['x-gw-ims-org-id'])

  const fetchConfig = {
    headers: actionHeaders
  }

  if (window.location.hostname === 'localhost') {
    actionHeaders['x-ow-extra-logging'] = 'on'
  }

  fetchConfig.method = options.method.toUpperCase()

  if (fetchConfig.method === 'GET') {
    actionUrl = new URL(actionUrl)
    Object.keys(params).forEach(key => actionUrl.searchParams.append(key, params[key]))
  } else if (fetchConfig.method === 'POST' || fetchConfig.method === 'DELETE' || fetchConfig.method === 'PUT') {
    fetchConfig.body = JSON.stringify(params)
  }

  console.log('[actionWebInvoke] Calling:', actionUrl)
  console.log('[actionWebInvoke] Method:', fetchConfig.method)
  console.log('[actionWebInvoke] Headers in fetch config:', Object.keys(fetchConfig.headers))

  let response
  try {
    response = await fetch(actionUrl, fetchConfig)
  } catch (fetchError) {
    console.error('[actionWebInvoke] Fetch error:', fetchError)
    // Check if it's a CORS error specifically
    if (fetchError.message === 'Failed to fetch' || fetchError.name === 'TypeError') {
      // Check if it's likely a CORS error
      const isCorsError = fetchError.message.includes('CORS') || 
                         fetchError.message.includes('cross-origin') ||
                         !fetchError.message.includes('NetworkError')
      
      if (isCorsError) {
        throw new Error(`CORS error: Unable to fetch from '${actionUrl}'. Please ensure:\n- The action is deployed as a web action\n- CORS headers are properly configured\n- The action URL uses /web/ path format\n\nOriginal error: ${fetchError.message}`)
      }
      throw new Error(`Network error: Unable to connect to '${actionUrl}'. This could be due to:\n- CORS configuration issue\n- Action not deployed or URL incorrect\n- Network connectivity problem\n- Authentication failure\n\nOriginal error: ${fetchError.message}`)
    }
    throw fetchError
  }
  
  // Check response headers for CORS
  const corsHeader = response.headers.get('access-control-allow-origin')
  if (!corsHeader && response.status !== 200) {
    console.warn('[actionWebInvoke] Warning: Response missing CORS header')
  }

  let content = await response.text()

  if (!response.ok) {
    // Try to parse error response to get debug info
    let errorBody = content
    try {
      errorBody = JSON.parse(content)
      console.error('[actionWebInvoke] Error response body:', errorBody)
      if (errorBody.debug) {
        console.error('[actionWebInvoke] Debug info:', errorBody.debug)
      }
    } catch (e) {
      // Not JSON, use as-is
    }
    throw new Error(`failed request to '${actionUrl}' with status: ${response.status} and message: ${JSON.stringify(errorBody)}`)
  }
  try {
    content = JSON.parse(content)
  } catch (e) {
    // response is not json
  }
  return content
}

export default actionWebInvoke
