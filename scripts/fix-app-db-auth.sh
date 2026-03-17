#!/usr/bin/env bash
# Attempt to fix "401: Oauth token is not valid" for aio app db (status, provision, document find).
# Run from project root: ./scripts/fix-app-db-auth.sh
# You must complete the browser login when prompted.
#
# If it still fails, run first: npm install -g @adobe/aio-cli@latest

set -e
cd "$(dirname "$0")/.."

echo "Step 1: Forcing fresh Adobe I/O login (browser will open)..."
aio login --force

echo ""
echo "Step 2: Selecting project workspace (choose TaxByCity / Stage if prompted)..."
aio app use

echo ""
echo "Step 3: Checking database status..."
aio app db status

echo ""
echo "If you see database status above, the fix worked. You can now run:"
echo "  aio app db document find tax_rates '{}' -l 100"
