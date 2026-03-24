/**
 * Magento Tax Rate (Web API) — auth via ../lib/auth-runtime.js (same as create-tax-rate).
 * GraphQL guest-cart flow: create cart → add product → shipping address → cart prices / applied taxes.
 * No ABDB; Magento Commerce GraphQL only. Optional query params for address + product search tuning.
 */

const axios = require('axios');
const { CORS, resolveAuthAndNamespace } = require('../lib/auth-runtime.js');

const FALLBACK_SKUS = [{ sku: 'WS12-M-Orange', quantity: 1 }];

function pget(params, k) {
  return params[k] != null ? params[k] : process.env[k];
}

function getGraphqlUrl(params = {}) {
  const explicit = pget(params, 'GRAPHQL_URL');
  if (explicit) return explicit;
  const domain = pget(params, 'MAGENTO_COMMERCE_DOMAIN');
  const instanceId = pget(params, 'MAGENTO_INSTANCE_ID');
  if (domain && instanceId) {
    return `https://${domain}/${instanceId}/graphql`;
  }
  return 'https://na1-sandbox.api.commerce.adobe.com/GMBkaBQSumFG4qaxU86h3L/graphql';
}

function getEnvironmentIdFromUrl(graphqlUrl) {
  try {
    const path = new URL(graphqlUrl).pathname.split('/');
    return path[1] && path[1] !== 'graphql' ? path[1] : null;
  } catch {
    return null;
  }
}

function getDefaultHeaders(params = {}) {
  const graphqlUrl = getGraphqlUrl(params);
  const apiKey =
    pget(params, 'API_KEY') ||
    pget(params, 'ADOBE_CLIENT_ID') ||
    '02cacbf78e8b4e8d8cfe2f1eaa886c30';
  const imsOrg =
    pget(params, 'IMS_ORG_ID') ||
    pget(params, 'ADOBE_ORG_ID') ||
    pget(params, 'MAGENTO_ORG_ID') ||
    'C116239B68225A790A495C96@AdobeOrg';
  const envId =
    pget(params, 'MAGENTO_ENVIRONMENT_ID') || getEnvironmentIdFromUrl(graphqlUrl);

  return {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
    'x-gw-ims-org-id': imsOrg,
    ...(envId && { 'Magento-Environment-Id': envId }),
    ...(pget(params, 'MAGENTO_CUSTOMER_GROUP') && {
      'Magento-Customer-Group': pget(params, 'MAGENTO_CUSTOMER_GROUP')
    }),
    'Magento-Website-Code': pget(params, 'MAGENTO_WEBSITE_CODE') || 'base',
    'Magento-Store-Code': pget(params, 'MAGENTO_STORE_CODE') || 'main_website_store',
    'Magento-Store-View-Code': pget(params, 'MAGENTO_STORE_VIEW_CODE') || 'default'
  };
}

async function graphql(params, queryOrMutation, variables = {}) {
  const url = getGraphqlUrl(params);
  const headers = getDefaultHeaders(params);
  const payload =
    typeof queryOrMutation === 'string'
      ? { query: queryOrMutation }
      : {
          query: queryOrMutation.query,
          variables: queryOrMutation.variables
        };
  const { data } = await axios.post(url, payload, {
    headers,
    maxBodyLength: Infinity
  });
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function graphqlSafe(params, queryOrMutation, variables = {}) {
  const url = getGraphqlUrl(params);
  const headers = getDefaultHeaders(params);
  const payload =
    typeof queryOrMutation === 'string'
      ? { query: queryOrMutation }
      : {
          query: queryOrMutation.query,
          variables: queryOrMutation.variables
        };
  try {
    const { data } = await axios.post(url, payload, {
      headers,
      maxBodyLength: Infinity
    });
    return { data: data.data, errors: data.errors };
  } catch (e) {
    return {
      data: null,
      errors: [
        {
          message: e.response?.data ? JSON.stringify(e.response.data) : e.message
        }
      ]
    };
  }
}

async function getOneProductSku(params, opts = {}) {
  const phrase = opts.phrase || pget(params, 'PRODUCT_SEARCH_PHRASE') || 'bag';
  const pageSize = Math.min(
    Math.max(parseInt(String(opts.page_size || pget(params, 'PRODUCT_SEARCH_PAGE_SIZE') || 3), 10) || 3, 1),
    50
  );
  try {
    const { data, errors } = await graphqlSafe(params, {
      query: `
        query ProductSearch($phrase: String!, $page_size: Int) {
          productSearch(phrase: $phrase, page_size: $page_size) {
            items { productView { sku } }
          }
        }
      `,
      variables: { phrase, page_size: pageSize }
    });
    const sku = data?.productSearch?.items?.[0]?.productView?.sku;
    if (sku) return [{ sku, quantity: 1 }];
  } catch (_) {}
  try {
    const search = opts.fallback_search || pget(params, 'PRODUCT_FALLBACK_SEARCH') || 'shirt';
    const fbSize = Math.min(
      Math.max(parseInt(String(opts.fallback_page_size || 2), 10) || 2, 1),
      20
    );
    const safeSearch = String(search).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const { data } = await graphqlSafe(params, {
      query: `query { products(search: "${safeSearch}", pageSize: ${fbSize}) { items { sku } } }`
    });
    const sku = data?.products?.items?.[0]?.sku;
    if (sku) return [{ sku, quantity: 1 }];
  } catch (_) {}
  return null;
}

async function createGuestCart(params) {
  const data = await graphql(
    params,
    `
    mutation {
      createGuestCart {
        cart { id }
      }
    }
  `
  );
  return data.createGuestCart.cart.id;
}

async function addProductsToCart(params, cartId, items) {
  const cartItems = items.map(({ sku, quantity }) => ({ sku, quantity }));
  const data = await graphql(params, {
    query: `
      mutation AddToCart($cartId: String!, $cartItems: [CartItemInput!]!) {
        addProductsToCart(cartId: $cartId, cartItems: $cartItems) {
          cart { id }
          user_errors { code, message }
        }
      }
    `,
    variables: { cartId, cartItems }
  });
  const result = data.addProductsToCart;
  if (result?.user_errors?.length) console.warn('Add to cart user_errors:', result.user_errors);
  return result?.cart;
}

async function setShippingAddressesOnCart(params, cartId, address) {
  const addressInput = {
    firstname: address.firstname || 'Guest',
    lastname: address.lastname || 'User',
    street: address.street || [''],
    city: address.city || '',
    region: address.region || '',
    postcode: address.postcode,
    country_code: address.country_code,
    telephone: address.telephone || ''
  };
  const data = await graphql(params, {
    query: `
      mutation SetShipping($cartId: String!, $address: CartAddressInput!) {
        setShippingAddressesOnCart(input: {
          cart_id: $cartId
          shipping_addresses: [{ address: $address }]
        }) {
          cart {
            shipping_addresses {
              city
              region { code, label }
              postcode
              country { code, label }
              available_shipping_methods {
                carrier_code
                method_code
                amount { value, currency }
              }
            }
          }
        }
      }
    `,
    variables: { cartId, address: addressInput }
  });
  return data.setShippingAddressesOnCart.cart;
}

/**
 * Commerce SaaS rejects setShippingMethodsOnCart when more than one method is sent.
 * Pick a single method (cheapest when amounts are present).
 */
function pickOneShippingMethod(methods) {
  if (!methods?.length) return null;
  if (methods.length === 1) return methods[0];
  const rated = methods.filter((m) => m?.amount?.value != null && !Number.isNaN(Number(m.amount.value)));
  if (rated.length) {
    return rated.reduce((best, m) =>
      Number(m.amount.value) < Number(best.amount.value) ? m : best
    );
  }
  return methods[0];
}

async function setShippingMethodsOnCart(params, cartId, shippingMethods) {
  if (!shippingMethods?.length) return null;
  const data = await graphql(params, {
    query: `
      mutation SetShippingMethod($cartId: String!, $shippingMethods: [ShippingMethodInput!]!) {
        setShippingMethodsOnCart(input: { cart_id: $cartId, shipping_methods: $shippingMethods }) {
          cart { id }
        }
      }
    `,
    variables: {
      cartId,
      shippingMethods: shippingMethods.map((m) => ({
        carrier_code: m.carrier_code,
        method_code: m.method_code
      }))
    }
  });
  return data.setShippingMethodsOnCart.cart;
}

async function getCartPrices(params, cartId) {
  const data = await graphql(params, {
    query: `
      query CartPrices($cartId: String!) {
        cart(cart_id: $cartId) {
          prices {
            grand_total { value, currency }
            subtotal_excluding_tax { value, currency }
            subtotal_including_tax { value, currency }
            applied_taxes { label, amount { value, currency } }
          }
        }
      }
    `,
    variables: { cartId }
  });
  return data?.cart?.prices;
}

function parseBody(params) {
  if (params.body && typeof params.body === 'object') return params.body;
  const raw = params.__ow_body;
  if (!raw) return null;
  try {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
      } catch {
        return JSON.parse(raw);
      }
    }
    return raw;
  } catch {
    return null;
  }
}

function mergeInputs(params) {
  const query = {};
  if (params.__ow_query && typeof params.__ow_query === 'string') {
    try {
      const q = new URLSearchParams(params.__ow_query);
      for (const [k, v] of q.entries()) {
        if (v !== undefined && v !== '') query[k] = v;
      }
    } catch (e) {
      console.warn('magento-tax-rate: __ow_query', e?.message || e);
    }
  }
  const flat = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (k.startsWith('__ow_') || k === 'method') continue;
    if (v !== undefined && v !== '') flat[k] = v;
  }
  const body = parseBody(params) || {};
  return { ...query, ...flat, ...body };
}

function getAddressFromPayload(merged) {
  const postcode =
    merged.postcode || merged.zipcode;
  const country_code = merged.country_code || merged.country;
  const region = merged.region || merged.state || '';
  const city = merged.city || '';
  const street = merged.street;
  const telephone = merged.telephone || '';

  const streetArr = Array.isArray(street) ? street : street ? [String(street)] : ['1 N/A'];
  const tel = String(telephone || '').trim() || '000-000-0000';
  const cityVal = String(city || '').trim() || 'N/A';
  return {
    postcode: String(postcode || '').trim(),
    country_code: String(country_code || '').trim().toUpperCase(),
    region: String(region || '').trim(),
    city: cityVal,
    street: streetArr.length ? streetArr : ['1 N/A'],
    telephone: tel,
    firstname: merged.firstname || 'Guest',
    lastname: merged.lastname || 'User'
  };
}

function getProductSearchOpts(merged) {
  const phrase = merged.product_search_phrase || merged.productSearchPhrase;
  const page_size = merged.product_search_page_size || merged.productSearchPageSize;
  const fallback_search = merged.product_fallback_search || merged.productFallbackSearch;
  const fallback_page_size = merged.fallback_page_size;
  const o = {};
  if (phrase) o.phrase = phrase;
  if (page_size != null && page_size !== '') o.page_size = page_size;
  if (fallback_search) o.fallback_search = fallback_search;
  if (fallback_page_size != null && fallback_page_size !== '') o.fallback_page_size = fallback_page_size;
  return o;
}

async function runMagentoTaxFlow(params) {
  const merged = mergeInputs(params);
  const address = getAddressFromPayload(merged);

  if (!address.postcode) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'postcode (or zipcode) is required',
        payload_example: {
          postcode: '90003',
          country_code: 'US',
          region: 'CA',
          city: 'Los Angeles'
        }
      }
    };
  }
  if (!address.country_code) {
    return {
      statusCode: 400,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'country_code (or country) is required'
      }
    };
  }

  const productOpts = getProductSearchOpts(merged);

  const existingCart = merged.cart_id || merged.cartId;
  const cartId = existingCart
    ? String(existingCart).trim()
    : await createGuestCart(params);
  const itemsToAdd = (await getOneProductSku(params, productOpts)) || FALLBACK_SKUS;
  await addProductsToCart(params, cartId, itemsToAdd);
  const cartWithShipping = await setShippingAddressesOnCart(params, cartId, address);
  const methods = cartWithShipping?.shipping_addresses?.[0]?.available_shipping_methods || [];
  const chosenMethod = pickOneShippingMethod(methods);
  if (chosenMethod) {
    await setShippingMethodsOnCart(params, cartId, [chosenMethod]);
  }
  const prices = await getCartPrices(params, cartId);
  const applied_taxes = prices?.applied_taxes || [];

  return {
    statusCode: 200,
    headers: CORS,
    body: {
      status: 'Success',
      address: {
        postcode: address.postcode,
        country_code: address.country_code,
        region: address.region || null,
        city: address.city || null
      },
      prices: prices
        ? {
            grand_total: prices.grand_total,
            subtotal_excluding_tax: prices.subtotal_excluding_tax,
            subtotal_including_tax: prices.subtotal_including_tax
          }
        : null,
      applied_taxes,
      meta: {
        graphql_url: getGraphqlUrl(params)
      }
    }
  };
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
          'Content-Type, Authorization, x-gw-ims-org-id, x-runtime-namespace',
        'Access-Control-Max-Age': '86400'
      },
      body: {}
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS,
      body: { status: 'Error', message: 'Method not allowed. Use POST.' }
    };
  }

  const authResult = await resolveAuthAndNamespace(params);
  if (authResult.error) {
    const e = authResult.error;
    return {
      statusCode: e.statusCode,
      headers: { ...CORS, ...(e.statusCode === 401 ? { 'WWW-Authenticate': 'Basic realm="Tax API"' } : {}) },
      body: e.body
    };
  }

  try {
    return await runMagentoTaxFlow(params);
  } catch (error) {
    const msg = error.response?.data || error.message;
    const errStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
    console.error('magento-tax-rate (webAPI):', errStr);
    return {
      statusCode: error.response?.status || 500,
      headers: CORS,
      body: {
        status: 'Error',
        message: 'Failed to get tax rate from Magento',
        error: errStr.slice(0, 500)
      }
    };
  }
}

exports.main = main;
