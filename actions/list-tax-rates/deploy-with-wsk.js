/**
 * Build zip and update the root action "list-tax-rates" via wsk.
 *
 * From project root:
 *   WSK_AUTH=namespace:key node actions/list-tax-rates/deploy-with-wsk.js
 *
 * Or from this folder:
 *   WSK_AUTH=namespace:key node deploy-with-wsk.js
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ACTION_DIR = __dirname;
const ZIP_NAME = 'list-tax-rates.zip';
const ZIP_PATH = path.resolve(ACTION_DIR, ZIP_NAME);
const ACTION_NAME = 'list-tax-rates';
const APIHOST = process.env.WSK_APIHOST || 'https://adobeioruntime.net';
const AUTH = process.env.WSK_AUTH;

if (!AUTH) {
  console.error('Set WSK_AUTH (e.g. namespace:auth_key)');
  process.exit(1);
}

if (!fs.existsSync(path.resolve(ACTION_DIR, 'index.js'))) {
  console.error('index.js not found in', ACTION_DIR);
  process.exit(1);
}

console.log('Installing dependencies...');
execSync('npm install --omit=dev', { cwd: ACTION_DIR, stdio: 'inherit' });

console.log('Building zip...');
execSync(`zip -r ${ZIP_NAME} index.js package.json node_modules -x "*.git*"`, { cwd: ACTION_DIR, stdio: 'inherit' });

if (!fs.existsSync(ZIP_PATH)) {
  console.error('Failed to create', ZIP_NAME);
  process.exit(1);
}

// Bind Basic auth as base64 so the action can call the token action (even when request doesn't forward Authorization)
const authBase64 = Buffer.from(AUTH, 'utf8').toString('base64');

console.log('Updating action', ACTION_NAME, '...');
execSync(
  'wsk', [
    'action', 'update', ACTION_NAME, ZIP_PATH,
    '--auth', AUTH,
    '--apihost', APIHOST,
    '--kind', 'nodejs:22',
    '--param', 'RUNTIME_AUTH_BASE64', authBase64
  ],
  { stdio: 'inherit' }
);

console.log('Done. Raw invoke URL:');
console.log(`${APIHOST}/api/v1/namespaces/<namespace>/actions/${ACTION_NAME}?result=true&blocking=true`);
