#!/usr/bin/env bash
# Update tax-by-city/magento-tax-rate with the zip and enable web access.
# Run from project root: ./actions/magento-tax-rate/deploy-wsk.sh
# Or from this folder: ./deploy-wsk.sh
# Requires: WSK_AUTH set (e.g. namespace:key) or pass --auth to wsk.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$SCRIPT_DIR/magento-tax-rate.zip"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ ! -f "$ZIP" ]; then
  echo "Missing $ZIP. Run from actions/magento-tax-rate: npm install && zip -r magento-tax-rate.zip ..."
  exit 1
fi

cd "$ROOT"
echo "Updating tax-by-city/magento-tax-rate with --web true..."
wsk action update tax-by-city/magento-tax-rate "$ZIP" --web true --kind nodejs:22
echo "Done. Check: aio runtime action list (magento-tax-rate should show 'web')."
