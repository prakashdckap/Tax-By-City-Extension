#!/usr/bin/env node
/**
 * Local harness for `collect-taxes` — invokes the action main() like Adobe I/O Runtime
 * (no HTTP). Skips webhook signature verification; still needs IMS + ABDB env (see .env).
 *
 * Usage:
 *   node scripts/test-collect-taxes.mjs
 *   node scripts/test-collect-taxes.mjs /path/to/custom-payload.json
 *
 * Requires: ADOBE_CLIENT_ID, ADOBE_CLIENT_SECRET, ADOBE_ORG_ID, ADOBE_SCOPE (with abdata),
 *           AIO_runtime_namespace or __OW_NAMESPACE, DEFAULT_REGION, TAX_RATES_COLLECTION, etc.
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

const require = createRequire(import.meta.url);
require('dotenv').config({ path: join(process.cwd(), '.env') });

process.env.SKIP_WEBHOOK_SIGNATURE_VERIFY = 'true';

const defaultFixture = join(process.cwd(), 'test/fixtures/oop-collect-taxes-sample.json');
const fixturePath = process.argv[2] || defaultFixture;

console.error(`Fixture: ${fixturePath}`);
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

console.error('Loading collect-taxes action…');
const { main } = await import('../actions/webAPI/collect-taxes/index.js');

const bodyStr = JSON.stringify(fixture);
const params = {
  ...process.env,
  __ow_method: 'POST',
  __ow_body: bodyStr,
  __ow_headers: {}
};

console.error(
  'Invoking main() (IMS token + App Builder DB; may take a few seconds on first run)…'
);
const result = await main(params);

console.log('--- raw action result ---');
console.log(JSON.stringify(result, null, 2));

if (result.body && typeof result.body === 'string') {
  try {
    const ops = JSON.parse(result.body);
    console.log('\n--- parsed operations (Commerce JSON Patch array) ---');
    console.log(JSON.stringify(ops, null, 2));
  } catch {
    console.log('\n(body is not JSON string)');
  }
}

const failed =
  (result.statusCode != null && result.statusCode !== 200) ||
  (result.body &&
    typeof result.body === 'object' &&
    result.body.op === 'exception');
process.exit(failed ? 1 : 0);
