/**
 * Test get-db-token action locally using credentials from app.config.yaml.
 *
 * Run: node test-get-db-token.js
 *
 * Reads: runtimeManifest.packages.tax-by-city.actions.get-db-token.inputs from app.config.yaml
 */

const path = require('path');
const fs = require('fs');

const { main } = require('./index.js');

function loadParamsFromAppConfig() {
  const appConfigPath = path.resolve(__dirname, '..', '..', 'app.config.yaml');
  if (!fs.existsSync(appConfigPath)) {
    throw new Error('app.config.yaml not found at ' + appConfigPath);
  }
  const yaml = require('yaml');
  const content = fs.readFileSync(appConfigPath, 'utf8');
  const config = yaml.parse(content);
  const inputs =
    config?.runtimeManifest?.packages?.['tax-by-city']?.actions?.['get-db-token']?.inputs;
  if (!inputs) {
    throw new Error('get-db-token inputs not found in app.config.yaml');
  }
  return {
    ADOBE_CLIENT_ID: inputs.ADOBE_CLIENT_ID,
    ADOBE_CLIENT_SECRET: inputs.ADOBE_CLIENT_SECRET,
    ADOBE_ORG_ID: inputs.ADOBE_ORG_ID,
    ADOBE_TOKEN_URL: inputs.ADOBE_TOKEN_URL,
    ADOBE_SCOPE: inputs.ADOBE_SCOPE,
    LOG_LEVEL: inputs.LOG_LEVEL
  };
}

async function run() {
  let params;
  try {
    params = loadParamsFromAppConfig();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }

  if (!params.ADOBE_CLIENT_ID || !params.ADOBE_CLIENT_SECRET) {
    console.error('ADOBE_CLIENT_ID and ADOBE_CLIENT_SECRET must be set in app.config.yaml under get-db-token.inputs');
    process.exit(1);
  }

  console.log('Using credentials from app.config.yaml (get-db-token.inputs)');
  console.log('Calling get-db-token...');
  try {
    const result = await main(params);
    console.log('Status:', result.statusCode);
    if (result.body && result.body.access_token) {
      console.log('Token (first 24 chars):', result.body.access_token.substring(0, 24) + '...');
      console.log('Success:', result.body.status);
      if (result.body.expires_in != null) console.log('Expires in:', result.body.expires_in);
    } else {
      console.log('Body:', JSON.stringify(result.body, null, 2));
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
