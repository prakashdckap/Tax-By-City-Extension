/**
 * Get Cart Tax Action
 *
 * Retrieves cart id and address from the Magento front end request, then uses
 * Adobe Commerce GraphQL cart query to get tax rates (prices.applied_taxes) and
 * returns them in the App Builder Runtime Action response.
 *
 * Uses the same cart query as the storefront: cart(cart_id) with prices and
 * shipping_addresses (see Commerce GraphQL cart query / GetCartTax pattern).
 *
 * Runtime API (blocking):
 *   POST https://adobeioruntime.net/api/v1/namespaces/<namespace>/actions/tax-by-city/get-cart-tax?result=true&blocking=true
 *
 * Web endpoint:
 *   POST https://<runtime-namespace>.adobeio-static.net/api/v1/web/tax-by-city/get-cart-tax
 *
 * Payload (JSON body, from Magento front end):
 *   {
 *     "cart_id": "Uws4vBeuYM79q86YOmqo1BARpSe3rP1o"   // required – cart mask id or quote id
 *   }
 *
 * Response (action body):
 *   {
 *     "status": "Success",
 *     "cart_id": "...",
 *     "address": { "city", "region", "postcode", "country_code", "street", ... } | null,
 *     "prices": { "grand_total", "subtotal_excluding_tax", "subtotal_including_tax" },
 *     "applied_taxes": [ { "label", "amount": { "value", "currency" } } ]
 *   }
 */

require('dotenv').config();

const axios = require('axios');

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

const GET_CART_TAX_QUERY = `
  query GetCartTax($cart_id: String!) {
    cart(cart_id: $cart_id) {
      id
      shipping_addresses {
        city
        region { code label }
        postcode
        country { code label }
        street
        firstname
        lastname
        telephone
      }
      prices {
        grand_total { value currency }
        subtotal_excluding_tax { value currency }
        subtotal_including_tax { value currency }
        applied_taxes { label amount { value currency } }
      }
    }
  }
`;

async function graphql(query, variables = {}, extraHeaders = {}) {
  const headers = { ...defaultHeaders, ...extraHeaders };
  const { data } = await axios.post(
    GRAPHQL_URL,
    { query, variables },
    { headers, maxBodyLength: Infinity }
  );
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
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

function normalizeAddress(shippingAddress) {
  if (!shippingAddress) return null;
  const region = shippingAddress.region;
  const country = shippingAddress.country;
  return {
    city: shippingAddress.city ?? null,
    region: region?.code ?? null,
    region_label: region?.label ?? null,
    postcode: shippingAddress.postcode ?? null,
    country_code: country?.code ?? null,
    country_label: country?.label ?? null,
    street: shippingAddress.street ?? [],
    firstname: shippingAddress.firstname ?? null,
    lastname: shippingAddress.lastname ?? null,
    telephone: shippingAddress.telephone ?? null,
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
    const cartId =
      body?.cart_id ||
      body?.cartId ||
      params?.cart_id ||
      params?.cartId;

    if (!cartId || String(cartId).trim() === '') {
      return {
        statusCode: 400,
        headers,
        body: {
          status: 'Error',
          message: 'cart_id is required',
          payload_example: { cart_id: '<masked_cart_id_from_storefront>' },
        },
      };
    }

    // Forward customer/guest token from storefront so Commerce can resolve the cart
    const owHeaders = params['__ow_headers'] || {};
    const authHeader =
      owHeaders.authorization ||
      owHeaders.Authorization ||
      body?.authorization ||
      body?.access_token;
    const graphqlHeaders = {};
    if (authHeader) {
      graphqlHeaders.Authorization =
        authHeader.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    }

    const data = await graphql(
      GET_CART_TAX_QUERY,
      { cart_id: String(cartId).trim() },
      graphqlHeaders
    );
    const cart = data?.cart;

    if (!cart) {
      return {
        statusCode: 404,
        headers,
        body: {
          status: 'Error',
          message: 'Cart not found or inactive',
          cart_id: cartId,
        },
      };
    }

    const prices = cart.prices;
    const applied_taxes = prices?.applied_taxes ?? [];
    const firstShipping = cart.shipping_addresses?.[0];
    const address = normalizeAddress(firstShipping);

    // Top-level grand_total for convenience; Commerce may return prices null until shipping address is set
    const grand_total =
      prices?.grand_total ?? null;
    const pricesPayload = prices
      ? {
          grand_total: prices.grand_total,
          subtotal_excluding_tax: prices.subtotal_excluding_tax,
          subtotal_including_tax: prices.subtotal_including_tax,
        }
      : null;

    const responseBody = {
      status: 'Success',
      cart_id: cart.id ?? cartId,
      address,
      prices: pricesPayload,
      applied_taxes,
      grand_total,
    };
    if (!pricesPayload || !grand_total) {
      responseBody.message =
        'Cart totals are calculated after a shipping address is set. Set shipping address on the cart (setShippingAddressesOnCart) then call again to get grand_total and applied_taxes.';
    }

    return {
      statusCode: 200,
      headers,
      body: responseBody,
    };
  } catch (error) {
    const msg = error.response?.data || error.message;
    const errStr = typeof msg === 'string' ? msg : JSON.stringify(msg);
    console.error('get-cart-tax error:', errStr);
    return {
      statusCode: error.response?.status || 500,
      headers,
      body: {
        status: 'Error',
        message: 'Failed to get cart tax from Magento',
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
