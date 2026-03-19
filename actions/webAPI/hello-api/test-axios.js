#!/usr/bin/env node
/**
 * Test hello-api (axios) - same as user's snippet. Run: node test-axios.js
 */
const axios = require('axios');

const config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://3676633-taxbycity-stage.adobeio-static.net/api/v1/web/tax-by-city/hello-api',
  headers: {
    'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
  }
};

axios.request(config)
  .then((response) => {
    console.log(JSON.stringify(response.data, null, 2));
    if (response.data.token) {
      console.log('\nToken present:', response.data.token.substring(0, 30) + '...');
    } else {
      console.log('\nToken missing - redeploy hello-api (aio app deploy) so it includes token logic and ADOBE_CLIENT_ID/SECRET.');
    }
  })
  .catch((error) => {
    console.error(error.message || error);
    if (error.response) console.error('Status:', error.response.status, 'Data:', error.response.data);
  });
