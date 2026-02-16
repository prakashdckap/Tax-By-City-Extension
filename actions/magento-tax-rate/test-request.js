/**
 * Test script for magento-tax-rate API.
 * Run: node test-request.js
 *
 * Uses the WEB action URL (same as get-taxes, delete-tax-rate). No Basic auth needed.
 * If you get 404: run "aio app deploy" so the action is deployed to the namespace.
 */
const axios = require('axios');

const data = JSON.stringify({
  country_code: 'US',
  region: 'CA',
  postcode: '90003',
  city: 'Los Angeles'
});

// Use web action URL (no auth, same pattern as other actions in this app)
const WEB_URL = 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/magento-tax-rate';
// Raw Runtime API (requires Basic auth; use actions/magento-tax-rate without package prefix to match manage-tax)
const RAW_URL = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/magento-tax-rate?result=true&blocking=true';

const config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: WEB_URL,
  headers: { 'Content-Type': 'application/json' },
  data
};

axios.request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
    const body = response.data?.body;
    if (body?.applied_taxes?.length) {
      console.log('\nTax:', body.applied_taxes[0].label, body.applied_taxes[0].amount?.value, body.applied_taxes[0].amount?.currency);
    }
  })
  .catch((error) => {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status, error.response.statusText);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
      if (error.response.status === 404) {
        console.error('\n→ 404: Action not found. Deploy the app (aio app deploy) so magento-tax-rate exists in this namespace.');
      }
      if (error.response.status === 401) {
        console.error('\n→ 401: Use Basic auth with namespace as username and your Runtime auth key as password.');
      }
    }
  });
