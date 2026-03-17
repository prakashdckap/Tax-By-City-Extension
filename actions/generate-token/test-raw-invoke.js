/**
 * Test generate-token via raw invoke URL with Basic auth.
 * Runtime Basic auth = invoker (namespace:key). Action still needs credentials
 * via request body or bound params. This script passes credentials from app.config
 * in the body so the action can generate a token.
 *
 * Run: node test-raw-invoke.js
 */
const path = require('path');
const fs = require('fs');
const axios = require('axios');

const APP_CONFIG = path.resolve(__dirname, '..', '..', 'app.config.yaml');
const yaml = require('yaml');
const configYaml = yaml.parse(fs.readFileSync(APP_CONFIG, 'utf8'));
const inputs = configYaml?.runtimeManifest?.packages?.['tax-by-city']?.actions?.['generate-token']?.inputs || {};

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/generate-token?result=true&blocking=true',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Basic YjQzYmUyMjAtZDU0ZC00MzE1LTk2ZjQtOWQwYmUxYjRhZDNjOmVrSzJVbWxNMFdnRmY2YmdqNXJVd3AyNnZhN081czdzVEpMUEpTOE8yeTB1ZjJYOGY2MjhrdzBWNDJqcUdKcTg='
  },
  data: {
    ADOBE_CLIENT_ID: inputs.ADOBE_CLIENT_ID,
    ADOBE_CLIENT_SECRET: inputs.ADOBE_CLIENT_SECRET,
    ADOBE_TOKEN_URL: inputs.ADOBE_TOKEN_URL,
    ADOBE_SCOPE: inputs.ADOBE_SCOPE
  }
};

axios.request(config)
  .then((response) => {
    const out = response.data;
    const body = out?.response?.result?.body ?? out?.body ?? out;
    console.log(JSON.stringify(body || out, null, 2));
    if (body && body.access_token) {
      console.log('Token (first 24 chars):', body.access_token.substring(0, 24) + '...');
    }
  })
  .catch((error) => {
    console.log(error.response?.data ?? error.message);
  });
