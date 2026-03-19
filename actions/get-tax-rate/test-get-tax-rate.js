/**
 * Test get-tax-rate action - get tax rate(s) by country and state (optional: zipcode, city).
 * Run: node test-get-tax-rate.js
 *
 * Correct action URL (default package):
 *   https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/get-tax-rate?result=true&blocking=true
 *
 * Deploy with params ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, RUNTIME_AUTH_BASE64 so the action can call get-db-token.
 *
 * Required: country, state
 * Optional: zipcode, postcode, city, region
 */

const axios = require('axios');

const ACTION_URL = 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/get-tax-rate?result=true&blocking=true';

const data = {
  country: 'US',
  state: 'CA'
  // optional: zipcode: '90210', city: 'Los Angeles', region: 'amer'
};

const config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: ACTION_URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
  },
  data: JSON.stringify(data)
};

axios.request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    console.error(error.response?.data || error.message);
  });
