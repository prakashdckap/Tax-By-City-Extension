# get-db-token

Web action that returns an Adobe IMS access token using **@adobe/aio-sdk** `Core.AuthClient.generateAccessToken(params)`. Use the token with App Builder DB.

## Usage

**From another action or app:**

```javascript
const { generateAccessToken } = require('@adobe/aio-sdk').Core.AuthClient;
const libDb = require('@adobe/aio-lib-db');

async function main(params) {
  const token = await generateAccessToken(params);
  const db = await libDb.init({ token: token.access_token });
  // ... use db
}
```

**As a web API:** call the deployed action URL (GET or POST). Response:

```json
{
  "status": "Success",
  "access_token": "eyJ...",
  "token_type": "Bearer",
  "expires_in": 86399999
}
```

Credentials come from action **inputs** in app.config.yaml (same as generate-token). No need to pass client id/secret in the request.

## Deploy as web action

In **app.config.yaml** the action already has `web: 'yes'`. To deploy via wsk and expose it as a web action:

1. Build the zip:
   ```bash
   cd actions/get-db-token && zip -r get-db-token.zip index.js package.json node_modules
   ```
2. Deploy with web enabled (reads params from app.config.yaml):
   ```bash
   WSK_AUTH=your_namespace:your_auth_key node actions/get-db-token/deploy-with-config.js
   ```

The script uses `--web true` so the action is available at:
`https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/get-db-token`

## Test deployed action (DBToken)

If the action is deployed as **DBToken** (e.g. from aio):

**Web URL:** `https://<namespace>.adobeioruntime.net/api/v1/web/DBToken`

- **Without auth** (if the action is configured to allow unauthenticated web access):
  ```bash
  curl -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/DBToken" -H "Content-Type: application/json" -d '{}'
  ```

- **With auth** (if the gateway returns 401): get a token with `aio auth:token`, then:
  ```bash
  BEARER_TOKEN=$(aio auth:token) node test-dbtoken-web.js
  ```
  Or: `curl -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/DBToken" -H "Content-Type: application/json" -H "Authorization: Bearer $(aio auth:token)" -d '{}'`

**Node test script:** `node test-dbtoken-web.js` (set `BEARER_TOKEN` if you get 401).

## Deploy as root action DBToken (with bound params)

If you deploy the same code as the **root** action **DBToken** (e.g. `wsk action update DBToken get-db-token.zip ...`), the action has no package inputs. Pass scope and credentials as bound params so the token includes App Builder DB scopes:

```bash
cd actions/get-db-token && npm install && zip -r get-db-token.zip index.js package.json node_modules
wsk action update DBToken get-db-token.zip --kind nodejs:22 \
  -p ADOBE_CLIENT_ID "YOUR_CLIENT_ID" \
  -p ADOBE_CLIENT_SECRET "YOUR_CLIENT_SECRET" \
  -p ADOBE_SCOPE "adobeio_api,adobeio.abdata.read,adobeio.abdata.write,adobeio.abdata.manage" \
  --auth "NAMESPACE:AUTH_KEY" --apihost https://adobeioruntime.net
```

Or use params from app.config: run `WSK_ACTION_NAME=DBToken node deploy-with-config.js` (the script reads app.config and passes inputs as `-p`; set `WSK_ACTION_NAME=DBToken` to deploy as root action).

**Token must include DB scopes:** If the API returns "Missing required scope: adobeio.abdata.write" or "Oauth token is not valid", the project must have **Adobe App Builder Data Services** enabled and the OAuth client must be in a product profile that includes Data Services. See `docs/VERIFY_DATA_SERVICES_CONSOLE.md`.
