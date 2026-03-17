#!/usr/bin/env bash
# Build fetch-db-table.zip under the 48 MB exec limit (bundle only, no node_modules).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
LIMIT=$((48 * 1024 * 1024))

echo "Building bundle..."
node build.mjs

echo "Creating deploy package.json..."
node -e "
const p = require('./package.json');
const deploy = { name: p.name, version: p.version, main: 'index.js' };
require('fs').writeFileSync('dist/package.json', JSON.stringify(deploy, null, 0));
"

echo "Building zip..."
rm -f fetch-db-table.zip
cd dist
zip -9 -r ../fetch-db-table.zip index.js package.json
cd ..

SIZE=$(stat -c%s fetch-db-table.zip 2>/dev/null || stat -f%z fetch-db-table.zip 2>/dev/null)
UNCOMPRESSED=$(unzip -l fetch-db-table.zip | awk '{ sum += $1 } END { print sum+0 }')
if [ "$SIZE" -ge "$LIMIT" ] || [ "$UNCOMPRESSED" -ge "$LIMIT" ]; then
  echo "ERROR: Size over 48 MB limit." >&2
  exit 1
fi
echo "OK: fetch-db-table.zip size $SIZE bytes (uncompressed $UNCOMPRESSED bytes)."
