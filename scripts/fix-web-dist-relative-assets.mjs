#!/usr/bin/env node
/**
 * Parcel emits absolute /web-src.*.js paths. In some Commerce iframe / CDN layouts that makes the
 * browser request the wrong origin path (404). Rewrite to relative ./web-src.* for shipped index.html.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

function fixFile (p) {
  let html = fs.readFileSync(p, 'utf8')
  const next = html
    .replace(/href="\/(web-src\.[^"]+\.css)"/g, 'href="./$1"')
    .replace(/src="\/(web-src\.[^"]+\.js)"/g, 'src="./$1"')
  if (next !== html) {
    fs.writeFileSync(p, next, 'utf8')
    process.stdout.write(`fix-web-dist-relative-assets: ${p}\n`)
  }
}

const dirs = [
  path.join(root, 'dist/application/web-prod'),
  path.join(root, 'dist/commerce-backend-ui-1/web-prod'),
  path.join(root, 'dist/commerce-admin-ui/web-prod')
]

for (const dir of dirs) {
  const index = path.join(dir, 'index.html')
  if (fs.existsSync(index)) fixFile(index)
}
