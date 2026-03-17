/**
 * Test get-tax-rate action.
 *
 * With Basic auth only: action runs but DB returns 401 (no OAuth token for App Builder DB).
 * With Bearer token: use web URL so Runtime injects IMS credentials and DB works.
 *
 * Usage:
 *   node test-get-tax-rate.js                    # Basic auth (will get 401 from DB)
 *   BEARER_TOKEN=eyJ... node test-get-tax-rate.js  # Bearer auth (use web URL, DB works)
 */
const axios = require('axios');

const body = { country: 'US', state: 'CA' };
const bearerToken = process.env.BEARER_TOKEN;

let config;
if (bearerToken) {
  // Web action + Bearer: Runtime injects IMS credentials → DB works
  config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/get-tax-rate',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearerToken}`
    },
    data: body
  };
  console.log('Using web URL + Bearer token (DB should work)\n');
} else {
  // Raw action + Basic auth: no IMS token → DB returns 401
  config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/get-tax-rate?result=true&blocking=true',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
    },
    data: body
  };
  console.log('Using Basic auth (DB will return 401 until you use BEARER_TOKEN)\n');
}

axios.request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch((error) => {
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Data:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log(error.message);
    }
  });
