import allActions from './config.json'
import { RUNTIME_BASIC_AUTH_BASE64 } from './generatedRuntimeAuth'

/** Must match app.config.yaml runtimeManifest.packages (main application actions). */
const MAIN_ACTION_PACKAGE = 'tax-by-city'

export { rewriteTaxByCityStaticWebUrlToRuntime } from './rewriteTaxByCityActionUrl'

function inferNamespaceFromConfigOrWindow () {
  for (const url of Object.values(allActions)) {
    if (typeof url !== 'string' || !url.includes('/api/v1/web/')) continue
    try {
      const hostname = new URL(url).hostname
      if (hostname.endsWith('.adobeio-static.net')) {
        return hostname.replace(/\.adobeio-static\.net$/, '')
      }
      if (hostname.endsWith('.adobeioruntime.net')) {
        return hostname.replace(/\.adobeioruntime\.net$/, '')
      }
    } catch (e) {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined') {
    const h = window.location && window.location.hostname
    if (h && h.endsWith('.adobeio-static.net')) {
      return h.replace(/\.adobeio-static\.net$/, '')
    }
    if (h && h.endsWith('.adobeioruntime.net')) {
      return h.replace(/\.adobeioruntime\.net$/, '')
    }
  }
  return null
}

function inferredWebActionUrl (namespace, actionName) {
  if (!namespace) return null
  // Browser GET + custom headers reliably passes CORS on *.adobeio-static.net; same GET on
  // adobeioruntime.net often fails preflight. POST body calls rewrite to runtime in actionWebInvoke.
  return `https://${namespace}.adobeio-static.net/api/v1/web/${MAIN_ACTION_PACKAGE}/${actionName}`
}

export function getConfiguredActionUrl (runtime, name) {
  let url = null
  if (runtime && typeof runtime.getActionUrl === 'function') {
    url = runtime.getActionUrl(name) || null
  }
  if (!url && allActions[name]) url = allActions[name]
  if (!url && allActions[`tax-by-city/${name}`]) url = allActions[`tax-by-city/${name}`]

  /* commerce/backend-ui/1 web build may only inject admin-ui-sdk URLs into config.json */
  if (!url) {
    const ns = inferNamespaceFromConfigOrWindow()
    url = inferredWebActionUrl(ns, name)
  }

  if (!url) return null
  return url
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

/**
 * Basic auth for Runtime web actions: optional caller override → config.json runtimeBasicAuthBase64 →
 * build-injected RUNTIME_BASIC_AUTH_BASE64 from .env (inject-runtime-auth-for-web.mjs).
 */
export function getEffectiveRuntimeBasicAuthBase64 (explicitOverride) {
  if (typeof explicitOverride === 'string' && explicitOverride.trim() !== '') {
    return explicitOverride.trim()
  }
  const fromConfig = (allActions.runtimeBasicAuthBase64 || '').trim()
  if (fromConfig) return fromConfig
  return (RUNTIME_BASIC_AUTH_BASE64 || '').trim()
}

/** True when web bundle was built with inject-runtime-auth-for-web.mjs (non-empty secret). */
export function hasBuildInjectedRuntimeAuth () {
  return (RUNTIME_BASIC_AUTH_BASE64 || '').trim() !== ''
}

/** True if any Basic-auth source exists (for header chip). */
export function hasRuntimeBasicConfigured () {
  return getEffectiveRuntimeBasicAuthBase64() !== ''
}

/** IMS Bearer or Basic auth (any resolved source) — required before calling ABDB-backed actions. */
export function hasWebActionAuth (ims, basicAuthBase64) {
  const token =
    ims &&
    typeof ims.token === 'string' &&
    ims.token.trim() !== ''
  const basic = getEffectiveRuntimeBasicAuthBase64(basicAuthBase64)
  return token || basic !== ''
}

export function buildActionHeaders ({ ims, runtime, preferredAction = 'list-tax-rates', basicAuthBase64 } = {}) {
  const namespace = getRuntimeNamespace(runtime, preferredAction)
  const headers = {}
  const effectiveBasicAuth = getEffectiveRuntimeBasicAuthBase64(basicAuthBase64)

  if (ims?.token) {
    headers.authorization = `Bearer ${ims.token}`
    if (ims.org) headers['x-gw-ims-org-id'] = ims.org
  } else if (effectiveBasicAuth) {
    headers.authorization = `Basic ${effectiveBasicAuth}`
  }

  if (namespace) headers['x-runtime-namespace'] = namespace

  return headers
}
