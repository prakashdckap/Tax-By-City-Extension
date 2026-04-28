/**
 * Out-of-process tax webhook — `plugin.magento.out_of_process_tax_management.api.oop_tax_collection.collect_taxes`
 *
 * Request body matches Adobe Commerce as a Cloud Service (ACCS) admin Webhook sample:
 * `oopQuote.items[]`, `ship_to_address`, `ship_from_address`, `billing_address`, `shipping`, `customer`, etc.
 * Tax jurisdiction for App Builder rate lookup uses **ship_to_address** first, then legacy `shipping_address`.
 *
 * Resolves tax lines from the App Builder tax rate table (same matching rules as calculate-tax-rate)
 * and returns Commerce Webhook JSON Patch operations for `oopQuote` items.
 *
 * Debug logging: set `LOG_LEVEL=debug` or `OOP_COLLECT_TAXES_DEBUG=true` on the action (or in `.env`)
 * to log location, config, DB collection, and tax calculation summaries (Adobe I/O Runtime activations).
 *
 * **Production / Commerce webhooks (critical):** register the OOP tax webhook URL on
 * `https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/collect-taxes` — **not** on
 * `*.adobeio-static.net`. The static hostname is for the browser-hosted UI; server-side POSTs from
 * Commerce to `adobeio-static` often do not reach this action, which shows in Admin as
 * "The webhook ... collect_taxes:before could not be run."
 * Auth uses IMS + Runtime namespace: ensure `AIO_runtime_namespace` is in `.env` / action inputs,
 * or rely on Host header parsing (`<namespace>.adobeioruntime.net`).
 *
 * @see https://developer.adobe.com/commerce/extensibility/webhooks/
 * @see https://raw.githubusercontent.com/adobe/commerce-checkout-starter-kit/main/actions/collect-taxes/index.js
 */

const crypto = require('crypto');

const { calculateTaxRate } = require('../calculate-tax-rate/index.js');
const { CORS, resolveAuthForCommerceWebhook } = require('../lib/auth-runtime.js');
const { resolveTaxRatesCollectionName, getDefaultRegion } = require('../lib/config.js');
const { normalizeStateForTaxMatching } = require('../lib/us-state-normalize.js');

const HTTP_OK = 200;

/** Enable via `LOG_LEVEL=debug` or `OOP_COLLECT_TAXES_DEBUG=true` on action params or `process.env`. */
function isCollectTaxesDebug(params) {
  const p = params && typeof params === 'object' ? params : {};
  return (
    String(p.LOG_LEVEL || process.env.LOG_LEVEL || '').toLowerCase() === 'debug' ||
    String(p.OOP_COLLECT_TAXES_DEBUG || process.env.OOP_COLLECT_TAXES_DEBUG || '')
      .toLowerCase() === 'true'
  );
}

function collectTaxesDebugLog(enabled, message, payload) {
  if (!enabled) return;
  if (payload !== undefined) {
    console.log(`collect-taxes [debug] ${message}`, payload);
  } else {
    console.log(`collect-taxes [debug] ${message}`);
  }
}

const INSTANCE_TAX_BREAKDOWN =
  'Magento\\OutOfProcessTaxManagement\\Api\\Data\\OopQuoteItemTaxBreakdownInterface';
const INSTANCE_TAX_SUMMARY = 'Magento\\OutOfProcessTaxManagement\\Api\\Data\\OopQuoteItemTaxInterface';

function webhookErrorResponse(message) {
  return {
    statusCode: HTTP_OK,
    body: {
      op: 'exception',
      message
    }
  };
}

/**
 * Verifies `x-adobe-commerce-webhook-signature` when `COMMERCE_WEBHOOKS_PUBLIC_KEY` is set.
 * If the public key is not configured, verification is skipped (manual/curl testing); set the
 * key in production so only signed Commerce requests are accepted.
 * @see https://developer.adobe.com/commerce/extensibility/webhooks/signature-verification/
 */
function webhookVerify(params) {
  const skipExplicit =
    String(process.env.SKIP_WEBHOOK_SIGNATURE_VERIFY || '').toLowerCase() === 'true' ||
    String(params.SKIP_WEBHOOK_SIGNATURE_VERIFY || '').toLowerCase() === 'true';
  if (skipExplicit) {
    return { success: true };
  }

  const headers = params.__ow_headers || {};
  const body = params.__ow_body;
  const publicKey = String(
    params.COMMERCE_WEBHOOKS_PUBLIC_KEY || process.env.COMMERCE_WEBHOOKS_PUBLIC_KEY || ''
  ).trim();

  const signature = headers['x-adobe-commerce-webhook-signature'];

  if (!signature) {
    if (!publicKey) {
      console.warn(
        'collect-taxes: no x-adobe-commerce-webhook-signature and COMMERCE_WEBHOOKS_PUBLIC_KEY unset — skipping verification (add the Commerce public key to enforce signatures in production).'
      );
      return { success: true };
    }
    return {
      success: false,
      error:
        'Header `x-adobe-commerce-webhook-signature` not found. Enable webhook signing in Commerce Admin (Adobe Services > Webhooks) or set SKIP_WEBHOOK_SIGNATURE_VERIFY=true only for non-production testing.'
    };
  }

  if (body == null || body === '') {
    return {
      success: false,
      error: 'Request body missing. Configure the action with `raw-http: true`.'
    };
  }

  if (!publicKey) {
    return {
      success: false,
      error:
        'COMMERCE_WEBHOOKS_PUBLIC_KEY is not set but Commerce sent a signature. Paste the Commerce public key into .env / Runtime inputs.'
    };
  }

  try {
    const verifier = crypto.createVerify('SHA256');
    const buf = typeof body === 'string' ? body : Buffer.from(body);
    verifier.update(buf);
    const ok = verifier.verify(publicKey, signature, 'base64');
    return ok ? { success: true } : { success: false, error: 'Signature verification failed.' };
  } catch (e) {
    return { success: false, error: e.message || 'Signature verification error' };
  }
}

/** ACCS / proxies sometimes double-encode JSON as a string. */
function parseJsonUnwrapStrings(v) {
  let cur = v;
  let guard = 0;
  while (typeof cur === 'string' && cur.trim().startsWith('{') && guard < 5) {
    try {
      cur = JSON.parse(cur);
      guard += 1;
    } catch {
      break;
    }
  }
  return cur;
}

function parseWebhookBody(params) {
  const raw = params.__ow_body;
  if (raw == null && params.body != null) {
    if (typeof params.body === 'string') {
      return parseJsonUnwrapStrings(JSON.parse(params.body));
    }
    return params.body;
  }
  if (Buffer.isBuffer(raw) || raw instanceof Uint8Array) {
    const text = Buffer.from(raw).toString('utf8');
    try {
      return parseJsonUnwrapStrings(JSON.parse(text));
    } catch {
      try {
        return parseJsonUnwrapStrings(JSON.parse(Buffer.from(text, 'base64').toString('utf8')));
      } catch (e2) {
        throw new Error(`Invalid webhook JSON: ${e2.message}`);
      }
    }
  }
  if (typeof raw === 'string') {
    try {
      return parseJsonUnwrapStrings(JSON.parse(raw));
    } catch {
      try {
        return parseJsonUnwrapStrings(JSON.parse(Buffer.from(raw, 'base64').toString('utf8')));
      } catch (e2) {
        throw new Error(`Invalid webhook JSON: ${e2.message}`);
      }
    }
  }
  if (raw && typeof raw === 'object') return raw;
  throw new Error('Empty webhook body');
}

/**
 * Commerce may nest the payload or send quote-like fields at the root.
 */
function unwrapWebhookEnvelope(body) {
  if (!body || typeof body !== 'object') return body;
  if (body.oopQuote && typeof body.oopQuote === 'object') return body;
  const inner =
    body.argument ||
    body.object ||
    body.payload ||
    body.data ||
    body.input ||
    body.body ||
    body.request ||
    body.details;
  if (inner && typeof inner === 'object') {
    if (inner.oopQuote) return { ...body, oopQuote: inner.oopQuote, config: body.config || inner.config };
    if (Array.isArray(inner.items) || (inner.items && typeof inner.items === 'object')) {
      return { ...body, oopQuote: inner, config: body.config || inner.config };
    }
  }
  if (Array.isArray(body.items) || (body.items && typeof body.items === 'object')) {
    if (
      body.ship_to_address ||
      body.shipToAddress ||
      body.shipping_address ||
      body.shippingAddress
    ) {
      return { oopQuote: body, config: body.config };
    }
  }
  return body;
}

/**
 * Adobe Commerce Admin "Test webhook" and gateways may wrap the same JSON you use in Postman.
 */
function unwrapCommerceAdminLayers(body) {
  if (!body || typeof body !== 'object') return body;
  let b = body;

  const mergeInnerString = (key) => {
    const s = b[key];
    if (typeof s === 'string' && s.trim().startsWith('{')) {
      try {
        const inner = JSON.parse(s);
        b = { ...b, ...inner };
      } catch (_) {
        /* ignore */
      }
    }
  };
  mergeInnerString('input');
  mergeInnerString('body');
  mergeInnerString('content');
  mergeInnerString('message');
  mergeInnerString('data');

  if (Array.isArray(b.arguments) && b.arguments.length > 0) {
    const first = b.arguments[0];
    if (first && typeof first === 'object') {
      if (first.oopQuote) {
        b = { ...b, oopQuote: first.oopQuote, config: b.config || first.config };
      } else if (first.items || first.ship_to_address || first.shipToAddress) {
        b = { ...b, oopQuote: first, config: b.config };
      }
    }
  }

  if (b.argument && typeof b.argument === 'object' && b.argument.oopQuote) {
    b = { ...b, oopQuote: b.argument.oopQuote, config: b.config || b.argument.config };
  }

  if (b.params && typeof b.params === 'object' && (b.params.oopQuote || b.params.items)) {
    b = { ...b, ...b.params };
  }

  if (b.value && typeof b.value === 'object' && (b.value.oopQuote || b.value.items)) {
    b = { ...b, ...b.value };
  }

  const methodKeys = Object.keys(b).filter(
    (k) => k.includes('plugin.magento') || k.includes('collect_taxes') || k.includes('oop_tax')
  );
  for (const mk of methodKeys) {
    const inner = b[mk];
    if (inner && typeof inner === 'object' && (inner.oopQuote || inner.items)) {
      if (inner.oopQuote) {
        b = { ...b, oopQuote: inner.oopQuote, config: b.config || inner.config };
      } else {
        b = { ...b, oopQuote: inner, config: b.config };
      }
      break;
    }
  }

  return b;
}

function deepFindOopQuoteLike(obj, depth = 0, seen = new Set()) {
  if (depth > 14 || obj == null || typeof obj !== 'object') return null;
  if (seen.has(obj)) return null;
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const el of obj) {
      const r = deepFindOopQuoteLike(el, depth + 1, seen);
      if (r) return r;
    }
    return null;
  }

  const oq = obj.oopQuote || obj.oop_quote;
  if (oq && typeof oq === 'object' && normalizeItemsArray(oq.items).length > 0) {
    return { oopQuote: oq, config: obj.config || {} };
  }
  if (
    normalizeItemsArray(obj.items).length > 0 &&
    (obj.ship_to_address ||
      obj.shipToAddress ||
      obj.shipping_address ||
      obj.shippingAddress ||
      obj.billing_address ||
      obj.billingAddress)
  ) {
    return { oopQuote: obj, config: obj.config || {} };
  }

  for (const k of Object.keys(obj)) {
    if (k === 'config') continue;
    const r = deepFindOopQuoteLike(obj[k], depth + 1, seen);
    if (r) return r;
  }
  return null;
}

/**
 * Resolves oopQuote + items after all unwrapping (Postman body or ACCS-wrapped).
 */
function resolveOopQuoteFromBody(body) {
  if (!body || typeof body !== 'object') return null;

  const tryQuote = (oq, cfg) => {
    if (!oq || typeof oq !== 'object') return null;
    const items = normalizeItemsArray(oq.items);
    if (items.length === 0) return null;
    return { oopQuote: oq, config: cfg || {} };
  };

  let r =
    tryQuote(body.oopQuote, body.config) ||
    tryQuote(body.oop_quote, body.config) ||
    tryQuote(body.quote, body.config);
  if (r) return r;

  if (
    body.items &&
    (body.ship_to_address ||
      body.shipToAddress ||
      body.shipping_address ||
      body.shippingAddress ||
      body.billing_address)
  ) {
    r = tryQuote(body, body.config);
    if (r) return r;
  }

  return deepFindOopQuoteLike(body);
}

function summarizeBodyForError(body) {
  try {
    if (body == null) return 'body=null';
    if (typeof body !== 'object') return `type=${typeof body}`;
    const keys = Object.keys(body);
    const sample = JSON.stringify(body).slice(0, 280);
    return `keys=[${keys.slice(0, 12).join(',')}${keys.length > 12 ? '…' : ''}] sample=${sample}${sample.length >= 280 ? '…' : ''}`;
  } catch (e) {
    return e.message || 'unprintable';
  }
}

function normalizeItemsArray(items) {
  if (items == null) return [];
  if (typeof items === 'string') {
    try {
      return normalizeItemsArray(JSON.parse(items));
    } catch {
      return [];
    }
  }
  if (Array.isArray(items)) return items;
  if (typeof items === 'object') return Object.values(items);
  return [];
}

/** Map Magento / REST quote lines to OOP tax math fields used by this action. */
function normalizeLineItemForTax(item) {
  if (!item || typeof item !== 'object') {
    return { unit_price: 0, quantity: 0, discount_amount: 0, is_tax_included: false };
  }
  const qty = Number(item.quantity ?? item.qty ?? item.qty_ordered ?? 1) || 1;
  let unit = item.unit_price != null ? Number(item.unit_price) : NaN;
  if (Number.isNaN(unit) || unit === 0) {
    if (item.price != null) unit = Number(item.price);
    else if (item.base_price != null) unit = Number(item.base_price);
    else if (item.row_total != null) unit = Number(item.row_total) / qty;
    else unit = 0;
  }
  const discount = Number(item.discount_amount ?? item.discount ?? 0) || 0;
  const isTaxIncluded = Boolean(
    item.is_tax_included === true ||
      item.is_tax_included === 1 ||
      item.is_tax_included === 'true' ||
      item.price_includes_tax === true ||
      item.price_includes_tax === 1
  );
  return {
    ...item,
    unit_price: unit,
    quantity: qty,
    discount_amount: discount,
    is_tax_included: isTaxIncluded
  };
}

/**
 * Destination for tax rate matching: ACCS uses `ship_to_address`; older payloads use `shipping_address`.
 */
function extractShippingLocation(oopQuote) {
  if (!oopQuote || typeof oopQuote !== 'object') return null;
  const a =
    oopQuote.ship_to_address ||
    oopQuote.shipToAddress ||
    oopQuote.shipping_address ||
    oopQuote.shippingAddress ||
    oopQuote.shipping ||
    (Array.isArray(oopQuote.addresses) ? oopQuote.addresses[0] : null) ||
    oopQuote.address ||
    oopQuote.billing_address ||
    oopQuote.billingAddress ||
    null;
  if (!a) return null;

  const countryRaw =
    a.country_id ||
    a.country_code ||
    (typeof a.country === 'string' ? a.country.trim() : '') ||
    (a.country && typeof a.country === 'object' ? a.country.code || a.country.country_id : '') ||
    '';
  const country = String(countryRaw || '')
    .trim()
    .toUpperCase();

  let region = '';
  if (a.region_code != null && String(a.region_code).trim() !== '') {
    region = String(a.region_code).trim();
  } else if (a.region_id != null && String(a.region_id).trim() !== '') {
    const rid = String(a.region_id).trim();
    if (/^[A-Za-z]{2}$/.test(rid)) {
      region = rid;
    }
  }
  if (!region && typeof a.region === 'string') {
    const r = a.region.trim();
    region = /^[A-Za-z]{2}$/.test(r) ? r.toUpperCase() : r;
  } else if (!region && a.region && typeof a.region === 'object' && a.region.code) {
    region = String(a.region.code).trim();
  }
  if (!region && a.region_id != null && String(a.region_id).trim() !== '') {
    region = String(a.region_id).trim();
  }

  const postcode = String(a.postcode || a.zip || '').trim();
  const city = String(a.city || '').trim() || null;

  let state = region;
  if (country === 'US' || country === 'USA') {
    state = normalizeStateForTaxMatching(state, country) || state;
  } else if (state && /^[A-Za-z]{2}$/.test(String(state).trim())) {
    state = String(state).trim().toUpperCase();
  }

  return {
    country,
    state,
    zipcode: postcode,
    city
  };
}

/** Aligns location with App Builder tax rows (US state codes, country casing). */
function normalizeLocationForTax(location) {
  if (!location || typeof location !== 'object') return location;
  const out = { ...location };
  if (out.country) out.country = String(out.country).trim().toUpperCase();
  const c = out.country;
  if (out.state && (c === 'US' || c === 'USA')) {
    out.state = normalizeStateForTaxMatching(out.state, c) || String(out.state).trim();
  } else if (out.state && /^[A-Za-z]{2}$/.test(String(out.state).trim())) {
    out.state = String(out.state).trim().toUpperCase();
  }
  if (out.zipcode) out.zipcode = String(out.zipcode).trim();
  if (out.city) out.city = String(out.city).trim();
  return out;
}

/**
 * OOP tax: match App Builder rates to ship_to (city, state, zip, country).
 * City on the quote is optional: `taxByCity` defaults to true so we use optional-city matching
 * in calculate-tax-rate (all region+ZIP rows when city is absent; exact city first, else full
 * region+ZIP set when city does not match). Set `config.taxByCity` to false to restore legacy
 * matching (no city → only DB rows with no city; unknown city → fallback to rows with no city).
 *
 * If `enableCityForZipcodeRange` is true, we always use optional-city matching (taxByCity effective
 * true) so empty `city` on the quote can still match ZIP / range rows that have a city in DB.
 */
function buildConfig(body, _oopQuote) {
  const b = body && typeof body === 'object' ? body : {};
  const c = b.config && typeof b.config === 'object' ? b.config : {};
  const explicitOff = c.taxByCity === false || c.taxByCity === 'false';
  const enableCityForZipcodeRange =
    c.enableCityForZipcodeRange === true ||
    c.enableCityForZipcodeRange === 'true' ||
    String(process.env.OOP_ENABLE_CITY_FOR_ZIP_RANGE || '').toLowerCase() === 'true';
  // Legacy "taxByCity: false" + empty city drops all city-scoped DB rows; zip-range mode needs optional-city.
  const taxByCity = !explicitOff || enableCityForZipcodeRange;

  return {
    taxByCity,
    enableCityForZipcodeRange
  };
}

function appliedRatesToTaxList(appliedRates) {
  if (!Array.isArray(appliedRates) || !appliedRates.length) return [];
  return appliedRates.map((ar) => {
    const title = ar.tax_identifier || ar.code || 'Tax';
    const code = String(title)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 64) || 'tax';
    return {
      code,
      rate: typeof ar.rate === 'number' ? ar.rate : parseFloat(ar.rate) || 0,
      title
    };
  });
}

function calculateTaxOperationsForItem(item, index, taxesToApply) {
  const operations = [];

  const discountAmount = Math.min(item.unit_price * item.quantity, item.discount_amount || 0);
  const taxableAmount = item.unit_price * item.quantity - discountAmount;
  let itemTaxAmount = 0;
  let discountCompensationTaxAmount = 0;

  for (const tax of taxesToApply) {
    let taxAmount = 0;
    if (item.is_tax_included) {
      taxAmount = taxableAmount - taxableAmount / (1 + tax.rate / 100);
      const hiddenTax = discountAmount - discountAmount / (1 + tax.rate / 100);
      discountCompensationTaxAmount += hiddenTax;
    } else {
      taxAmount = taxableAmount * (tax.rate / 100);
    }
    taxAmount = Math.round(taxAmount * 100) / 100;
    itemTaxAmount += taxAmount;

    operations.push({
      op: 'add',
      path: `oopQuote/items/${index}/tax_breakdown`,
      value: {
        data: {
          code: tax.code,
          rate: tax.rate,
          amount: taxAmount,
          title: tax.title,
          tax_rate_key: `${tax.code}-${tax.rate}`
        }
      },
      instance: INSTANCE_TAX_BREAKDOWN
    });
  }

  itemTaxAmount = Math.round(itemTaxAmount * 100) / 100;
  discountCompensationTaxAmount = Math.round(discountCompensationTaxAmount * 100) / 100;

  const netPrice = item.is_tax_included ? taxableAmount - itemTaxAmount : taxableAmount;
  const itemTaxRate = netPrice > 0 ? Math.round((itemTaxAmount / netPrice) * 10000) / 100 : 0;

  operations.push({
    op: 'replace',
    path: `oopQuote/items/${index}/tax`,
    value: {
      data: {
        rate: itemTaxRate,
        amount: itemTaxAmount,
        discount_compensation_amount: discountCompensationTaxAmount
      }
    },
    instance: INSTANCE_TAX_SUMMARY
  });

  return operations;
}

async function main(params) {
  const method = String(params.__ow_method || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        ...CORS,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-adobe-commerce-webhook-signature, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  if (method !== 'POST') {
    return { statusCode: 405, headers: CORS, body: { op: 'exception', message: 'Use POST.' } };
  }

  const collectTaxesDebug = isCollectTaxesDebug(params);
  collectTaxesDebugLog(collectTaxesDebug, 'POST received', {
    hasSignature: Boolean((params.__ow_headers || {})['x-adobe-commerce-webhook-signature'])
  });

  const { success, error } = webhookVerify(params);
  if (!success) {
    return webhookErrorResponse(error);
  }

  let body;
  try {
    body = parseWebhookBody(params);
  } catch (e) {
    return webhookErrorResponse(e.message || 'Invalid body');
  }

  body = unwrapWebhookEnvelope(body);
  body = unwrapCommerceAdminLayers(body);
  body = unwrapWebhookEnvelope(body);

  collectTaxesDebugLog(collectTaxesDebug, 'unwrapped body top-level keys', Object.keys(body || {}));

  const resolved = resolveOopQuoteFromBody(body);
  const oopQuoteRaw = resolved?.oopQuote;
  const itemsRaw = normalizeItemsArray(oopQuoteRaw?.items);
  if (!oopQuoteRaw || itemsRaw.length === 0) {
    console.warn(
      'collect-taxes: could not resolve oopQuote.items. __ow_body:',
      params.__ow_body != null ? typeof params.__ow_body : 'null',
      Buffer.isBuffer(params.__ow_body) ? '(Buffer)' : '',
      'preview:',
      summarizeBodyForError(body)
    );
    return webhookErrorResponse(
      `Expected a non-empty oopQuote.items array. ACCS Admin Test may wrap JSON (arguments/params/input) — this action now unwraps common forms. Received: ${summarizeBodyForError(body)}. If testing from Admin, paste the same JSON as in Postman into the Request payload field, or trigger a real checkout.`
    );
  }

  const oopQuote = {
    ...oopQuoteRaw,
    items: itemsRaw.map(normalizeLineItemForTax)
  };

  collectTaxesDebugLog(collectTaxesDebug, 'oopQuote summary', {
    quote_id: oopQuoteRaw?.quote_id ?? oopQuoteRaw?.entity_id,
    itemCount: oopQuote.items.length
  });

  let location = extractShippingLocation(oopQuote);
  if (!location || !location.country || !location.state || !location.zipcode) {
    return webhookErrorResponse(
      'Could not derive tax location from oopQuote. Set ship_to_address (ACCS) or shipping_address with country/country_id, region_code (or region), and postcode.'
    );
  }
  location = normalizeLocationForTax(location);

  collectTaxesDebugLog(collectTaxesDebug, 'tax location (ship_to / shipping)', location);

  const config = buildConfig({ ...body, config: resolved?.config ?? body.config }, oopQuote);
  const region = getDefaultRegion(params) || 'amer';

  collectTaxesDebugLog(collectTaxesDebug, 'config + runtime region', { config, region });

  const authResult = await resolveAuthForCommerceWebhook(params);
  if (authResult.error) {
    const e = authResult.error;
    return webhookErrorResponse(
      [e.body?.message, e.body?.hint].filter(Boolean).join(' ') || 'Auth failed'
    );
  }

  const { accessToken, namespace } = authResult;
  const dbCtx = {
    bearerToken: accessToken,
    namespace,
    collectionName: resolveTaxRatesCollectionName(params)
  };

  collectTaxesDebugLog(collectTaxesDebug, 'App Builder DB context', {
    namespace,
    collectionName: dbCtx.collectionName,
    findLimit: String(params.OOP_TAX_DB_FIND_LIMIT || process.env.OOP_TAX_DB_FIND_LIMIT || '')
  });

  let taxResult;
  try {
    taxResult = await calculateTaxRate(location, config, region, params, dbCtx);
  } catch (err) {
    collectTaxesDebugLog(collectTaxesDebug, 'calculateTaxRate failed (context)', {
      location,
      config,
      region,
      collectionName: dbCtx.collectionName
    });
    console.error('collect-taxes calculateTaxRate:', err);
    let msg = err.message || 'Tax lookup failed';
    if (/invalid url/i.test(msg)) {
      msg = `${msg}. Common causes: empty APP_BUILDER_DB_URL_TEMPLATE on the action, or malformed ADOBE_TOKEN_URL. Confirm .env is merged into deploy and collect-taxes inputs include APP_BUILDER_DB_URL_TEMPLATE.`;
    }
    return webhookErrorResponse(msg);
  }

  collectTaxesDebugLog(collectTaxesDebug, 'calculateTaxRate result', {
    calculationMethod: taxResult.calculationMethod,
    taxPercentage: taxResult.taxPercentage,
    appliedRates: taxResult.appliedRates,
    matchingRatesCount: taxResult.matchingRatesCount,
    matchingRatesSummary: Array.isArray(taxResult.matchingRates)
      ? taxResult.matchingRates.map((r) => ({
          tax_identifier: r.tax_identifier,
          tax_postcode: r.tax_postcode,
          tax_region_id: r.tax_region_id,
          rate: r.rate,
          city: r.city
        }))
      : []
  });

  const taxesToApply = appliedRatesToTaxList(taxResult.appliedRates);

  collectTaxesDebugLog(collectTaxesDebug, 'taxes applied to line items (after appliedRatesToTaxList)', taxesToApply);

  const operations = [];
  oopQuote.items.forEach((item, index) => {
    operations.push(...calculateTaxOperationsForItem(item, index, taxesToApply));
  });

  collectTaxesDebugLog(collectTaxesDebug, 'JSON Patch operations count', {
    operations: operations.length,
    lineItems: oopQuote.items.length
  });

  return {
    statusCode: HTTP_OK,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(operations)
  };
}

exports.main = main;
