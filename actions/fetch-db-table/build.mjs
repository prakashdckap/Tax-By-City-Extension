#!/usr/bin/env node
/**
 * Bundle fetch-db-table for deploy so extracted size stays under 48 MB.
 * Output: dist/index.js (single file, no node_modules needed in zip).
 */
import * as esbuild from 'esbuild';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = `${__dirname}/dist/index.js`;

if (!existsSync(`${__dirname}/dist`)) {
  mkdirSync(`${__dirname}/dist`, { recursive: true });
}

await esbuild.build({
  entryPoints: [`${__dirname}/index.js`],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: out,
  mainFields: ['module', 'main'],
  conditions: ['node'],
}).catch(() => process.exit(1));

console.log('Bundled to', out);
