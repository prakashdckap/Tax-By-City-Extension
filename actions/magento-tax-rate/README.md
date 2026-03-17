# magento-tax-rate

Returns Magento Commerce tax rate data for a given address (zipcode + country, optional region/city).

## Zip deployment

This action is deployed from **magento-tax-rate.zip** (see `app.config.yaml`). After changing code or dependencies, rebuild the zip:

```bash
cd actions/magento-tax-rate
npm install
zip -r magento-tax-rate.zip index.js package.json package-lock.json node_modules .env.example -x "*.git*" -x "node_modules/.package-lock.json"
```

Then deploy: `aio app deploy` (or push to trigger CI/CD).

### Manual deploy with wsk (from action folder)

If you deploy manually with `wsk`, use **update** (action already exists). The action is deployed as **private** (like `manage-tax`), not as a web action:

```bash
cd actions/magento-tax-rate
# Rebuild zip if needed (see above), then:
wsk action update tax-by-city/magento-tax-rate magento-tax-rate.zip \
  --web false \
  --kind nodejs:22
```

- Use **update** (not create) after the first deploy so the action is refreshed.
- **`--web false`** makes the action show as "private" in `aio runtime action list` (published action, invoked with namespace auth).
- From project root, use the zip path: `actions/magento-tax-rate/magento-tax-rate.zip`.

## Environment

- **Local:** Copy `.env.example` to `.env` and set values (or use the provided `.env`). The action uses `dotenv` to load `.env` when present.
- **Runtime:** Env vars are set via `app.config.yaml` inputs (API_KEY, IMS_ORG_ID, etc.). The zip includes `.env.example` only; do not bundle `.env` (secrets).

## Fix for 404 "The requested resource does not"

This error means the **magento-tax-rate** action is not deployed to the namespace. Do this:

1. **Deploy the app** so the action is created:
   ```bash
   cd /var/www/html/coe/COE/tax-by-city
   aio app deploy
   ```
   Or push to the branch that triggers your CI/CD (e.g. `main` for stage).

2. **Use the web action URL** (recommended; no Basic auth needed):
   ```
   POST https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/magento-tax-rate
   ```

## Web action URL (recommended)

**URL**

```
POST https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/magento-tax-rate
```

No query params or Basic auth required. Same pattern as `get-taxes`, `delete-tax-rate`.

**Request:** `Content-Type: application/json`, body: `{ "postcode": "90003", "country_code": "US", "region": "CA", "city": "Los Angeles" }`

**Response:** Same as below; the response body is the action result (statusCode, headers, body with tax data).

## Runtime API (blocking, with Basic auth)

**URL**

```
POST https://adobeioruntime.net/api/v1/namespaces/<namespace>/actions/tax-by-city/magento-tax-rate?result=true&blocking=true
```

**Example (stage namespace)**

```
POST https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/tax-by-city/magento-tax-rate?result=true&blocking=true
```

**Authentication**  
Use namespace auth (Basic) or Adobe I/O JWT when calling the Runtime API.  
- Basic: username = your namespace auth (e.g. `3676633-taxbycity-stage`), password = your auth key from `aio auth:login` / Developer Console.  
- Or use `Authorization: Bearer <access_token>` if using Adobe I/O token.

**Request**

- Method: `POST`
- Header: `Content-Type: application/json`
- Body: JSON with address fields

```json
{
  "postcode": "90003",
  "country_code": "US",
  "region": "CA",
  "city": "Los Angeles"
}
```

**Example (curl)**

```bash
curl -X POST "https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/tax-by-city/magento-tax-rate?result=true&blocking=true" \
  -H "Content-Type: application/json" \
  -u "3676633-taxbycity-stage:YOUR_AUTH_KEY" \
  -d '{"postcode":"90003","country_code":"US","region":"CA","city":"Los Angeles"}'
```

**Response**

With `result=true&blocking=true`, the response body is the action’s return value:

```json
{
  "statusCode": 200,
  "headers": { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  "body": {
    "status": "Success",
    "address": { "postcode": "90003", "country_code": "US", "region": "CA", "city": "Los Angeles" },
    "prices": {
      "grand_total": { "value": 43.08, "currency": "USD" },
      "subtotal_excluding_tax": { "value": 34, "currency": "USD" },
      "subtotal_including_tax": { "value": 38.08, "currency": "USD" }
    },
    "applied_taxes": [
      { "label": "US-CA-12", "amount": { "value": 4.08, "currency": "USD" } }
    ]
  }
}
```

Tax data is in `response.body` (or `result.body` if you parse the JSON).

## Payload fields

| Field | Required | Description |
|-------|----------|-------------|
| `postcode` or `zipcode` | Yes | ZIP / postal code |
| `country_code` or `country` | Yes | ISO country code (e.g. `US`, `CA`) |
| `region` or `state` | No | State/region code |
| `city` | No | City |
| `street` | No | Street line(s), array or string |
| `telephone` | No | Phone (defaults if omitted) |
