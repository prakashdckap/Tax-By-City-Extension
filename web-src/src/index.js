/* 
* <license header>
*/

/**
 * Application entry (bundled from web-src/src/index.js).
 *
 * Bootstrap order (see bottom of file):
 *
 * 1) Not inside an iframe (e.g. opened as top-level static URL)
 *    → bootstrapRaw(): mock Exc `runtime` + optional localStorage IMS; React mounts <App>.
 *
 * 2) Inside an iframe but no Experience Cloud “module runtime” (_mr / unified shell script)
 *    → bootstrapRaw(): typical for Commerce Admin embedding; IMS often arrives later via
 *       Admin UI SDK attach() in App.js.
 *
 * 3) Inside an iframe with module runtime
 *    → bootstrapInShellOrCommerceIframe(): loads @adobe/exc-app, init() calls
 *       bootstrapInExcShell(runtime) when `runtime` fires `ready` with imsToken / imsOrg.
 *
 * Commerce Admin “left menu” entries (Tax By City section) are NOT defined here. They come
 * from the App Builder registration action: src/admin-ui/actions/registration/index.js
 * (included via app.config.yaml → extensions.commerce/backend-ui/1).
 *
 * In-app navigation (Home, Dashboard, …) is React Router + SideBar.js inside <App>.
 */

import 'core-js/stable'
import 'regenerator-runtime/runtime'
import ReactDOM from 'react-dom'

import App from './components/App'
import allActions from './config.json'
import './index.css'

window.React = require('react')

/** Experience Cloud module runtime only runs inside an iframe; Commerce Admin also embeds this app in an iframe. */
function isEmbeddedInIframe () {
  try {
    return window.self !== window.top
  } catch (e) {
    return true
  }
}

function bootstrapRaw () {
  /* Outside Experience Cloud Shell (e.g. static URL / top-level tab): no IMS unless dev sets it or Admin UI SDK attach(). */
  const mockRuntime = {
    on: () => {},
    off: () => {},
    getActionUrl: (name) =>
      allActions[name] || allActions[`tax-by-city/${name}`] || null
  }
  const mockIms = {
    token: localStorage.getItem('taxByCityImsToken') || undefined,
    org: localStorage.getItem('taxByCityImsOrg') || undefined,
    user: { name: localStorage.getItem('taxByCityImsUser') || 'Local preview' }
  }

  ReactDOM.render(
    <App runtime={mockRuntime} ims={mockIms} />,
    document.getElementById('root')
  )
}

function bootstrapInExcShell (runtime) {
  runtime.on('ready', ({ imsOrg, imsToken, imsProfile, locale }) => {
    runtime.done()
    console.log('Ready! received imsProfile:', imsProfile)
    const ims = {
      profile: imsProfile,
      org: imsOrg,
      token: imsToken
    }
    ReactDOM.render(
      <App runtime={runtime} ims={ims} />,
      document.getElementById('root')
    )
  })

  runtime.solution = {
    icon: 'AdobeExperienceCloud',
    title: 'TaxByCity',
    shortTitle: 'JGR'
  }
  runtime.title = 'TaxByCity'
}

function hasModuleRuntimeScript () {
  try {
    const search = new URLSearchParams(window.location.search)
    const mr = search.get('_mr')
    if (mr && mr.trim() !== '') return true
    if (window.EXC_US_HMR) return true
    const cached = window.sessionStorage.getItem('unifiedShellMRScript')
    return !!(cached && cached.trim() !== '')
  } catch (e) {
    return false
  }
}

async function bootstrapInShellOrCommerceIframe () {
  await import('./exc-runtime')
  const { init } = await import('@adobe/exc-app')
  init((runtime) => bootstrapInExcShell(runtime))
}

/* Choose bootstrap path: top-level vs iframe × Exc module runtime present or not. */
if (!isEmbeddedInIframe()) {
  console.info(
    'TaxByCity: top-level window (not in iframe). Skipping Exc module runtime; IMS may come from Admin UI SDK attach() if you open from Commerce Admin in an iframe.'
  )
  bootstrapRaw()
} else {
  if (!hasModuleRuntimeScript()) {
    console.info(
      'TaxByCity: iframe without Experience Cloud module runtime script (_mr). Skipping Exc runtime and using standalone bootstrap; IMS may come from Admin UI SDK attach().'
    )
    bootstrapRaw()
  } else {
    bootstrapInShellOrCommerceIframe().catch((e) => {
      console.info(
        'TaxByCity: Exc runtime not available in this iframe. Using standalone bootstrap. IMS may come from Admin UI SDK attach().',
        e?.message || e
      )
      bootstrapRaw()
    })
  }
}
