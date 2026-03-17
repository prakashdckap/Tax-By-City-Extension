/**
 * Build zip from index.js (+ package.json, node_modules) and update the generate-token action.
 * Uses app.config.yaml for action inputs (ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, etc.).
 *
 * Run from project root:
 *   node actions/generate-token/deploy-with-config.js
 *
 * Or from this folder:
 *   node deploy-with-config.js
 *
 * Uses: index.js (main action code), package.json, node_modules.
 * Optional: WSK_AUTH=namespace:key for wsk; or uses aio runtime if available.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

const ACTION_DIR = __dirname;
const APP_CONFIG_PATH = path.resolve(ACTION_DIR, '..', '..', 'app.config.yaml');
const ZIP_PATH = path.resolve(ACTION_DIR, 'generate-token.zip');
const INDEX_JS = path.resolve(ACTION_DIR, 'index.js');

if (!fs.existsSync(INDEX_JS)) {
  console.error('index.js not found at', INDEX_JS);
  process.exit(1);
}

if (!fs.existsSync(APP_CONFIG_PATH)) {
  console.error('app.config.yaml not found at', APP_CONFIG_PATH);
  process.exit(1);
}

// 1. Build zip from index.js, package.json, node_modules
console.log('Building zip from index.js, package.json, node_modules...');
execSync('npm install --omit=dev', { cwd: ACTION_DIR, stdio: 'inherit' });
execSync('zip -r generate-token.zip index.js package.json node_modules', { cwd: ACTION_DIR, stdio: 'inherit' });

if (!fs.existsSync(ZIP_PATH)) {
  console.error('Failed to create generate-token.zip');
  process.exit(1);
}

const yaml = require('yaml');
const config = yaml.parse(fs.readFileSync(APP_CONFIG_PATH, 'utf8'));
const inputs = config?.runtimeManifest?.packages?.['tax-by-city']?.actions?.['generate-token']?.inputs;

if (!inputs) {
  console.error('generate-token inputs not found in app.config.yaml');
  process.exit(1);
}

// 2. Update action: prefer aio, fallback to wsk
const useAio = !process.env.WSK_AUTH;

if (useAio) {
  console.log('Updating generate-token action with aio (using index.js from zip)...');
  const args = [
    'runtime', 'action', 'update', 'generate-token', ZIP_PATH,
    '--kind', 'nodejs:22',
    '--web', 'true',
    '--annotation', 'require-adobe-auth', 'false'
  ];
  for (const [key, value] of Object.entries(inputs)) {
    if (value === undefined || value === null) continue;
    args.push('--param', key, String(value));
  }
  try {
    execFileSync('aio', args, { stdio: 'inherit' });
    console.log('Done. Action updated from index.js.');
  } catch (e) {
    console.error('aio failed. Set WSK_AUTH=namespace:key to use wsk instead.');
    process.exit(1);
  }
} else {
  const auth = process.env.WSK_AUTH;
  const apihost = process.env.WSK_APIHOST || 'https://adobeioruntime.net';
  const actionName = process.env.WSK_ACTION_NAME || 'tax-by-city/generate-token';
  const args = [
    'action', 'update', actionName, ZIP_PATH,
    '--kind', 'nodejs:22',
    '--web', 'true',
    '--auth', auth,
    '--apihost', apihost
  ];
  for (const [key, value] of Object.entries(inputs)) {
    if (value === undefined || value === null) continue;
    args.push('--param', key, String(value));
  }
  console.log('Updating generate-token action with wsk (using index.js from zip)...');
  execFileSync('wsk', args, { stdio: 'inherit' });
  console.log('Done. Action updated from index.js.');
}
