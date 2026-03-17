/**
 * Call DBToken, print access_token for testing.
 * Run: node get-token-for-test.js
 */

const axios = require('axios');

const NAMESPACE = '3676633-taxbycity-stage';
const BASIC_AUTH = 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg=';
const URL = `https://adobeioruntime.net/api/v1/namespaces/${NAMESPACE}/actions/DBToken?result=true&blocking=true`;

axios.request({
  method: 'post',
  url: URL,
  headers: {
    'Content-Type': 'application/json',
    'Authorization': BASIC_AUTH
  },
  data: {}
})
  .then((res) => {
    const raw = res.data;
    const result = raw?.response?.result ?? raw?.result ?? raw;
    const body = result?.body ?? result;
    const token = body?.access_token;
    if (token) {
      console.log('Access token (copy for testing):');
      console.log(token);
      console.log('\nExpires in:', body?.expires_in ?? 'N/A', 'seconds');
    } else {
      console.log('Response:', JSON.stringify(res.data, null, 2));
    }
  })
  .catch((err) => {
    console.error('Error:', err.response?.data || err.message);
    process.exit(1);
  });
