/**
 * Magento Tax Rate Action
 *
 * Returns tax rate data from Adobe Commerce (Magento) GraphQL for a given address.
 * Uses guest cart flow: create cart → add product → set shipping address → get prices/tax.
 *
 * Runtime API (blocking, returns result in response body):
 *   POST https://adobeioruntime.net/api/v1/namespaces/<namespace>/actions/tax-by-city/magento-tax-rate?result=true&blocking=true
 *   Example (stage): https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/tax-by-city/magento-tax-rate?result=true&blocking=true
 *
 * Web endpoint (alternative):
 *   POST https://<runtime-namespace>.adobeio-static.net/api/v1/web/tax-by-city/magento-tax-rate
 *
 * Payload (JSON body):
 *   {
 *     "postcode": "90003",           // required (zipcode)
 *     "country_code": "US",          // required (e.g. US, CA)
 *     "region": "CA",                // optional – state/region code
 *     "city": "Los Angeles",         // optional
 *     "street": ["123 Main St"],     // optional
 *     "telephone": "512-555-1111"   // optional
 *   }
 *
 * Response (action return value; with result=true the Runtime response body is this object):
 *   {
 *     "statusCode": 200,
 *     "headers": { "Content-Type": "application/json", ... },
 *     "body": {
 *       "status": "Success",
 *       "address": { "postcode", "country_code", "region", "city" },
 *       "prices": { "grand_total", "subtotal_excluding_tax", "subtotal_including_tax" },
 *       "applied_taxes": [ { "label", "amount": { "value", "currency" } } ]
 *     }
 *   }
 */

require('dotenv').config();

const axios = require('axios');
const qs = require('qs');

const GRAPHQL_URL =
  process.env.GRAPHQL_URL ||
  (process.env.MAGENTO_COMMERCE_DOMAIN && process.env.MAGENTO_INSTANCE_ID
    ? `https://${process.env.MAGENTO_COMMERCE_DOMAIN}/${process.env.MAGENTO_INSTANCE_ID}/graphql`
    : 'https://na1-sandbox.api.commerce.adobe.com/GMBkaBQSumFG4qaxU86h3L/graphql');

const API_KEY =
  process.env.API_KEY ||
  process.env.ADOBE_CLIENT_ID ||
  '02cacbf78e8b4e8d8cfe2f1eaa886c30';

const IMS_ORG_ID =
  process.env.IMS_ORG_ID ||
  process.env.MAGENTO_ORG_ID ||
  'C116239B68225A790A495C96@AdobeOrg';

const ENVIRONMENT_ID =
  process.env.MAGENTO_ENVIRONMENT_ID ||
  (() => {
    try {
      const p = new URL(GRAPHQL_URL).pathname.split('/');
      return p[1] && p[1] !== 'graphql' ? p[1] : null;
    } catch {
      return null;
    }
  })();

const defaultHeaders = {
  'x-api-key': API_KEY,
  'Content-Type': 'application/json',
  'x-gw-ims-org-id': IMS_ORG_ID,
  ...(ENVIRONMENT_ID && { 'Magento-Environment-Id': ENVIRONMENT_ID }),
  ...(process.env.MAGENTO_CUSTOMER_GROUP && {
    'Magento-Customer-Group': process.env.MAGENTO_CUSTOMER_GROUP,
  }),
  'Magento-Website-Code': process.env.MAGENTO_WEBSITE_CODE || 'base',
  'Magento-Store-Code': process.env.MAGENTO_STORE_CODE || 'main_website_store',
  'Magento-Store-View-Code': process.env.MAGENTO_STORE_VIEW_CODE || 'default',
};

// Fallback SKU for cart when productSearch returns nothing (tax is address-based)
const FALLBACK_SKUS = [{ sku: 'WS12-M-Orange', quantity: 1 }];

async function graphql(queryOrMutation, variables = {}) {
  const payload =
    typeof queryOrMutation === 'string'
      ? { query: queryOrMutation }
      : {
          query: queryOrMutation.query,
          variables: queryOrMutation.variables,
        };
  const { data } = await axios.post(GRAPHQL_URL, payload, {
    headers: defaultHeaders,
    maxBodyLength: Infinity,
  });
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

async function graphqlSafe(queryOrMutation, variables = {}) {
  const payload =
    typeof queryOrMutation === 'string'
      ? { query: queryOrMutation }
      : {
          query: queryOrMutation.query,
          variables: queryOrMutation.variables,
        };
  try {
    const { data } = await axios.post(GRAPHQL_URL, payload, {
      headers: defaultHeaders,
      maxBodyLength: Infinity,
    });
    return { data: data.data, errors: data.errors };
  } catch (e) {
    return {
      data: null,
      errors: [
        {
          message: e.response?.data
            ? JSON.stringify(e.response.data)
            : e.message,
        },
      ],
    };
  }
}

/** Try to get one product SKU from catalog (productSearch or products). */
async function getOneProductSku() {
  try {
    const { data, errors } = await graphqlSafe({
      query: `
        query ProductSearch($phrase: String!, $page_size: Int) {
          productSearch(phrase: $phrase, page_size: $page_size) {
            items { productView { sku } }
          }
        }
      `,
      variables: { phrase: 'bag', page_size: 3 },
    });
    const sku = data?.productSearch?.items?.[0]?.productView?.sku;
    if (sku) return [{ sku, quantity: 1 }];
  } catch (_) {}
  try {
    const { data } = await graphqlSafe({
      query: `query { products(search: "shirt", pageSize: 2) { items { sku } } }`,
    });
    const sku = data?.products?.items?.[0]?.sku;
    if (sku) return [{ sku, quantity: 1 }];
  } catch (_) {}
  return null;
}

async function createGuestCart() {
  const data = await graphql(`
    mutation {
      createGuestCart {
        cart { id }
      }
    }
  `);
  return data.createGuestCart.cart.id;
}

async function addProductsToCart(cartId, items) {
  const cartItems = items.map(({ sku, quantity }) => ({ sku, quantity }));
  const data = await graphql({
    query: `
      mutation AddToCart($cartId: String!, $cartItems: [CartItemInput!]!) {
        addProductsToCart(cartId: $cartId, cartItems: $cartItems) {
          cart { id }
          user_errors { code, message }
        }
      }
    `,
    variables: { cartId, cartItems },
  });
  const result = data.addProductsToCart;
  if (result?.user_errors?.length)
    console.warn('Add to cart user_errors:', result.user_errors);
  return result?.cart;
}

async function setShippingAddressesOnCart(cartId, address) {
  const addressInput = {
    firstname: address.firstname || 'Guest',
    lastname: address.lastname || 'User',
    street: address.street || [''],
    city: address.city || '',
    region: address.region || '',
    postcode: address.postcode,
    country_code: address.country_code,
    telephone: address.telephone || '',
  };
  const data = await graphql({
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
    variables: { cartId, address: addressInput },
  });
  return data.setShippingAddressesOnCart.cart;
}

async function setShippingMethodsOnCart(cartId, shippingMethods) {
  if (!shippingMethods?.length) return null;
  const data = await graphql({
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
        method_code: m.method_code,
      })),
    },
  });
  return data.setShippingMethodsOnCart.cart;
}

async function getCartPrices(cartId) {
  const data = await graphql({
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
    variables: { cartId },
  });
  return data?.cart?.prices;
}

function parseBody(params) {
  if (params.body && typeof params.body === 'object') return params.body;
  const raw = params['__ow_body'];
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

function getAddressFromPayload(body, params) {
  const postcode =
    body?.postcode ||
    body?.zipcode ||
    params?.postcode ||
    params?.zipcode;
  const country_code =
    body?.country_code ||
    body?.country ||
    params?.country_code ||
    params?.country;
  const region =
    body?.region ||
    body?.state ||
    params?.region ||
    params?.state ||
    '';
  const city = body?.city || params?.city || '';
  const street = body?.street || params?.street;
  const telephone = body?.telephone || params?.telephone || '';

  // Commerce GraphQL requires non-empty street, telephone, and city for shipping address
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
    firstname: body?.firstname || params?.firstname || 'Guest',
    lastname: body?.lastname || params?.lastname || 'User',
  };
}

async function main(params) {
  const method = (params['__ow_method'] || params.method || 'POST').toUpperCase();
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, x-gw-ims-org-id',
        'Access-Control-Max-Age': '86400',
      },
      body: {},
    };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = parseBody(params) || params;
    const address = getAddressFromPayload(body, params);

    if (!address.postcode) {
      return {
        statusCode: 400,
        headers,
        body: {
          status: 'Error',
          message: 'postcode (or zipcode) is required',
          payload_example: {
            postcode: '90003',
            country_code: 'US',
            region: 'CA',
            city: 'Los Angeles',
          },
        },
      };
    }
    if (!address.country_code) {
      return {
        statusCode: 400,
        headers,
        body: {
          status: 'Error',
          message: 'country_code (or country) is required',
        },
      };
    }

    const cartId = await createGuestCart();
    const itemsToAdd = (await getOneProductSku()) || FALLBACK_SKUS;
    await addProductsToCart(cartId, itemsToAdd);
    const cartWithShipping = await setShippingAddressesOnCart(cartId, address);
    const methods =
      cartWithShipping?.shipping_addresses?.[0]?.available_shipping_methods ||
      [];
    if (methods.length) {
      await setShippingMethodsOnCart(cartId, methods);
    }
    const prices = await getCartPrices(cartId);

    const applied_taxes = prices?.applied_taxes || [];

    return {
      statusCode: 200,
      headers,
      body: {
        status: 'Success',
        address: {
          postcode: address.postcode,
          country_code: address.country_code,
          region: address.region || null,
          city: address.city || null,
        },
        prices: prices
          ? {
              grand_total: prices.grand_total,
              subtotal_excluding_tax: prices.subtotal_excluding_tax,
              subtotal_including_tax: prices.subtotal_including_tax,
            }
          : null,
        applied_taxes,
      },
    };
  } catch (error) {
    const msg = error.response?.data || error.message;
    const errStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
    console.error('magento-tax-rate error:', errStr);
    return {
      statusCode: error.response?.status || 500,
      headers,
      body: {
        status: 'Error',
        message: 'Failed to get tax rate from Magento',
        error: errStr.slice(0, 500),
      },
    };
  }
}

async function wrappedMain(params) {
  try {
    const result = await main(params);
    if (!result || typeof result !== 'object') {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: { status: 'Error', message: 'Invalid response from action' },
      };
    }
    return {
      statusCode: typeof result.statusCode === 'number' ? result.statusCode : 200,
      headers: { 'Content-Type': 'application/json', ...(result.headers || {}) },
      body: result.body || {},
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: {
        status: 'Error',
        message: e.message || 'Internal server error',
      },
    };
  }
}

exports.main = wrappedMain;
