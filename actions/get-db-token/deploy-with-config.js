/**
 * Deploy get-db-token as a web action with params from app.config.yaml.
 * Uses --web true so the action is reachable at:
 *   https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/get-db-token
 *
 * Requires: wsk (OpenWhisk CLI), WSK_AUTH.
 *
 * From project root:
 *   WSK_AUTH=namespace:key node actions/get-db-token/deploy-with-config.js
 *
 * Build zip first if needed:
 *   cd actions/get-db-token && zip -r get-db-token.zip index.js package.json node_modules
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const appConfigPath = path.resolve(__dirname, '..', '..', 'app.config.yaml');
const zipPath = path.resolve(__dirname, 'get-db-token.zip');

if (!fs.existsSync(appConfigPath)) {
  console.error('app.config.yaml not found at', appConfigPath);
  process.exit(1);
}

if (!fs.existsSync(zipPath)) {
  console.error('get-db-token.zip not found. Build it first:');
  console.error('  cd actions/get-db-token && zip -r get-db-token.zip index.js package.json node_modules');
  process.exit(1);
}

const yaml = require('yaml');
const content = fs.readFileSync(appConfigPath, 'utf8');
const config = yaml.parse(content);
const inputs = config?.runtimeManifest?.packages?.['tax-by-city']?.actions?.['get-db-token']?.inputs;

if (!inputs) {
  console.error('get-db-token inputs not found in app.config.yaml');
  process.exit(1);
}

const auth = process.env.WSK_AUTH;
const apihost = process.env.WSK_APIHOST || 'https://adobeioruntime.net';
const actionName = process.env.WSK_ACTION_NAME || 'tax-by-city/get-db-token';

if (!auth) {
  console.error('Set WSK_AUTH (e.g. namespace:auth_key)');
  process.exit(1);
}

const args = [
  'action', 'update', actionName, zipPath,
  '--kind', 'nodejs:22',
  '--web', 'true',
  '--auth', auth,
  '--apihost', apihost
];

for (const [key, value] of Object.entries(inputs)) {
  if (value === undefined || value === null) continue;
  args.push('--param', key, String(value));
}

console.log('Deploying get-db-token as web action with params from app.config.yaml...');
execFileSync('wsk', args, { stdio: 'inherit' });
console.log('Done. Web URL: https://<your-namespace>.adobeioruntime.net/api/v1/web/tax-by-city/get-db-token');
