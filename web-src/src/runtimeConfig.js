import allActions from './config.json'

export function getConfiguredActionUrl(runtime, name) {
  if (runtime && typeof runtime.getActionUrl === 'function') {
    const fromRuntime = runtime.getActionUrl(name)
    if (fromRuntime) return fromRuntime
  }

  if (allActions[name]) return allActions[name]
  if (allActions[`tax-by-city/${name}`]) return allActions[`tax-by-city/${name}`]

  return null
}

export function getRuntimeNamespace(runtime, preferredAction = 'list-tax-rates') {
  if (allActions.runtimeNamespace) return allActions.runtimeNamespace

  const actionUrl = getConfiguredActionUrl(runtime, preferredAction)
  if (!actionUrl) return null

  try {
    const hostname = new URL(actionUrl).hostname
    if (hostname.endsWith('.adobeio-static.net')) {
      return hostname.replace(/\.adobeio-static\.net$/, '')
    }
    if (hostname.endsWith('.adobeioruntime.net')) {
      return hostname.replace(/\.adobeioruntime\.net$/, '')
    }
  } catch (e) {
    return null
  }

  return null
}

export function buildActionHeaders({ ims, runtime, preferredAction = 'list-tax-rates', basicAuthBase64 }) {
  const namespace = getRuntimeNamespace(runtime, preferredAction)
  const headers = {}

  if (ims?.token) {
    headers.authorization = `Bearer ${ims.token}`
    if (ims.org) headers['x-gw-ims-org-id'] = ims.org
  } else if (basicAuthBase64) {
    headers.authorization = `Basic ${basicAuthBase64}`
  }

  if (namespace) headers['x-runtime-namespace'] = namespace

  return headers
}
