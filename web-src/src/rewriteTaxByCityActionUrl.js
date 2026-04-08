/**
 * Commerce / Admin UI SDK often supplies *.adobeio-static.net. For browser GET + Authorization,
 * stay on static (CORS). For POST/PUT/DELETE, the static edge can return 400 "message/http";
 * actionWebInvoke rewrites those to *.adobeioruntime.net.
 */
const WEB_PATH_PREFIX = '/api/v1/web/tax-by-city/'

export function rewriteTaxByCityStaticWebUrlToRuntime (url) {
  if (typeof url !== 'string' || !url) return url
  const s = url.trim()
  if (!/adobeio-static\.net/i.test(s)) return s
  if (!s.toLowerCase().includes(WEB_PATH_PREFIX)) return s
  try {
    const u = new URL(s)
    if (!/\.adobeio-static\.net$/i.test(u.hostname)) return s
    if (!u.pathname.includes(WEB_PATH_PREFIX)) return s
    u.hostname = u.hostname.replace(/\.adobeio-static\.net$/i, '.adobeioruntime.net')
    return u.toString()
  } catch (e) {
    return s.replace(/adobeio-static\.net/gi, 'adobeioruntime.net')
  }
}
