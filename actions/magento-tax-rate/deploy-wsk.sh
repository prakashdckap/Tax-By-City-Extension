#!/usr/bin/env bash
# Update tax-by-city/magento-tax-rate with the zip (private/published action, like manage-tax).
# Run from project root: ./actions/magento-tax-rate/deploy-wsk.sh
# Or from this folder: ./deploy-wsk.sh
#
# Requires auth for Adobe I/O Runtime. Either:
#   export WSK_AUTH='namespace:key'   # from aio auth:login or Console
#   export APIHOST=adobeioruntime.net  # optional; script sets this if unset

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="$SCRIPT_DIR/magento-tax-rate.zip"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Adobe I/O Runtime API host (required for wsk)
export APIHOST="${APIHOST:-adobeioruntime.net}"

if [ ! -f "$ZIP" ]; then
  echo "Missing $ZIP. Run from actions/magento-tax-rate: npm install && zip -r magento-tax-rate.zip ..."
  exit 1
fi

if [ -z "$WSK_AUTH" ]; then
  echo "Error: WSK_AUTH is not set. Set it to your Runtime auth (e.g. export WSK_AUTH='namespace:key')."
  exit 1
fi

cd "$ROOT"
echo "Updating tax-by-city/magento-tax-rate as private action (--web false)..."
wsk action update tax-by-city/magento-tax-rate "$ZIP" --web false --kind nodejs:22 --auth "$WSK_AUTH"
echo "Done. Check: aio runtime action list (magento-tax-rate should show 'private')."
