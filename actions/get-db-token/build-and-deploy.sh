#!/bin/bash
# Build zip (with node_modules) and deploy DBToken so the action has @adobe/aio-sdk etc.
set -e
cd "$(dirname "$0")"
echo "Installing dependencies..."
npm install
echo "Building get-db-token.zip (index.js, package.json, node_modules)..."
zip -r get-db-token.zip index.js package.json node_modules
echo "Zip built. Deploy with one of:"
echo "  aio runtime action update DBToken get-db-token.zip --web true --annotation require-adobe-auth false"
echo "  Or: WSK_AUTH=namespace:key node deploy-with-config.js"
echo "Then test: AUTH_BASE64=<your_base64> node invoke-raw-axios.js"
