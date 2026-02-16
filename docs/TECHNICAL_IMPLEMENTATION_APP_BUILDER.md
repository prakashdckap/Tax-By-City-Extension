# Tax By City – Technical Implementation Guide (App Builder)

This document describes how to implement and use the **Tax By City** application with Adobe App Builder. It covers project structure, deployment, and each Runtime action with steps, payloads, and responses.

---

## Table of Contents

1. [Overview](#1-overview)
2. [App Builder Setup](#2-app-builder-setup)
3. [Project Structure](#3-project-structure)
4. [Deployment](#4-deployment)
5. [Runtime Actions Reference](#5-runtime-actions-reference)
6. [Frontend Configuration](#6-frontend-configuration)
7. [Environment Variables & Secrets](#7-environment-variables--secrets)

---

## 1. Overview

**Tax By City** is an Adobe App Builder application that:

- Stores and manages tax rates (App Builder Database / ABDB).
- Optionally syncs tax rates with **Adobe Commerce (Magento)**.
- Exposes a **Magento GraphQL–based** action (`magento-tax-rate`) to get live tax for an address (guest cart flow).
- Provides a React admin UI under **Admin → System → Tax By City**.

Actions run on **Adobe I/O Runtime** (Node.js 22), are defined in `app.config.yaml`, and are exposed as **web actions** for the UI and external callers.

---

## 2. App Builder Setup

### Prerequisites

- Adobe Developer Console project with **App Builder** and **I/O Runtime** enabled.
- Access to **App Builder** in Adobe Admin (for the admin UI).
- (Optional) Adobe Commerce instance and API credentials for Magento sync and `magento-tax-rate`.

### Steps

1. **Create/use an App Builder project** in [Adobe Developer Console](https://console.adobe.io).
2. **Link the repo** to the project (or clone this repo into your workspace).
3. **Install CLI and login:**
   ```bash
   npm install -g @adobe/aio-cli
   aio login
   ```
4. **Select the project and workspace:**
   ```bash
   aio app use
   ```
5. **Deploy the application:**
   ```bash
   aio app deploy
   ```
6. **Run the UI locally (optional):**
   ```bash
   aio app run
   ```

After deployment, the admin UI is available under **Admin → System → Tax By City**, and all actions are available at the Runtime URLs (see [Frontend Configuration](#6-frontend-configuration)).

---

## 3. Project Structure

```
tax-by-city/
├── app.config.yaml          # App Builder app config: actions, packages, admin UI
├── web-src/                 # Admin UI (React)
│   └── src/
│       └── config.json      # Runtime action URLs (injected at build)
├── actions/                 # I/O Runtime actions
│   ├── tax-rate/            # CRUD + lookup from ABDB, optional Magento sync
│   ├── tax-config/          # Config (enable/disable, cache, etc.)
│   ├── list-tax-rates/      # List tax rates from ABDB (paginated)
│   ├── manage-tax-rate/     # Create/update in Magento + ABDB
│   ├── delete-tax-rate/     # Delete from Magento + ABDB
│   ├── get-tax-percentage/  # Tax % by location (ABDB or Magento)
│   ├── calculate-tax-rate/  # Tax calculation logic (city/zip rules)
│   ├── magento-tax-rate/    # Live tax from Magento GraphQL (guest cart)
│   ├── generate-token/      # Adobe IMS access token for Magento
│   ├── generic/             # Sample external API action
│   ├── publish-events/      # Sample I/O Events publish
│   ├── webAPI/
│   │   ├── get-taxes/       # Proxy to list-tax-rates
│   │   ├── save-tax-rate/   # Proxy to manage-tax
│   │   └── delete-tax-rate/  # Proxy to delete-tax-rate
│   └── utils/               # Shared helpers (auth, errors, etc.)
└── docs/
    └── TECHNICAL_IMPLEMENTATION_APP_BUILDER.md  # This file
```

---

## 4. Deployment

### Full app deploy

From the project root:

```bash
aio app deploy
```

This deploys:

- All actions in the `tax-by-city` package (see `app.config.yaml`).
- The admin UI to the configured hosting.

### Magento Tax Rate action (zip-based)

The `magento-tax-rate` action is deployed from a **zip** file. Use the steps below to build the zip and deploy via App Builder or OpenWhisk.

#### Step 1: Generate the zip file

Run these commands from the project root or from the action folder:

```bash
cd actions/magento-tax-rate
npm install
zip -r magento-tax-rate.zip index.js package.json package-lock.json node_modules .env.example \
  -x "*.git*" \
  -x "node_modules/.package-lock.json"
```

**What goes in the zip:**

| Include | Exclude |
|---------|---------|
| `index.js` (entry) | `.env` (secrets – use `.env.example` only) |
| `package.json`, `package-lock.json` | `*.git*` |
| `node_modules/` (dependencies) | `node_modules/.package-lock.json` |
| `.env.example` (template) | |

**From project root**, the zip path is: `actions/magento-tax-rate/magento-tax-rate.zip`.

#### Step 2: Deploy via App Builder (recommended)

After building the zip, deploy the full app so the action is created/updated:

```bash
cd /var/www/html/coe/COE/tax-by-city   # or your project root
aio app deploy
```

#### Step 3: Manual deployment with OpenWhisk (wsk)

If you deploy **without** `aio app deploy`, use the OpenWhisk CLI (`wsk`) against your namespace.

**Prerequisites:** Install [OpenWhisk CLI](https://github.com/apache/openwhisk-cli/releases) and configure it for your Adobe I/O Runtime namespace (e.g. set `APIHOST` and auth from `aio auth:login` or `wsk property set`).

**First-time – create the action:**

```bash
cd actions/magento-tax-rate
# Ensure zip exists (run Step 1 above), then:
wsk action create tax-by-city/magento-tax-rate magento-tax-rate.zip \
  --web true \
  --kind nodejs:22
```

**Subsequent deploys – update the action:**

```bash
cd actions/magento-tax-rate
# Rebuild zip if code or dependencies changed (Step 1), then:
wsk action update tax-by-city/magento-tax-rate magento-tax-rate.zip \
  --web true \
  --kind nodejs:22
```

**From project root** (use the zip path relative to where you run `wsk`):

```bash
wsk action create tax-by-city/magento-tax-rate actions/magento-tax-rate/magento-tax-rate.zip \
  --web true \
  --kind nodejs:22
# Or for update:
wsk action update tax-by-city/magento-tax-rate actions/magento-tax-rate/magento-tax-rate.zip \
  --web true \
  --kind nodejs:22
```

**Optional – pass default parameters (env) with wsk:**

```bash
wsk action update tax-by-city/magento-tax-rate magento-tax-rate.zip \
  --web true \
  --kind nodejs:22 \
  --param MAGENTO_COMMERCE_DOMAIN "na1-sandbox.api.commerce.adobe.com" \
  --param MAGENTO_INSTANCE_ID "GMBkaBQSumFG4qaxU86h3L" \
  --param API_KEY "your-api-key" \
  --param IMS_ORG_ID "YourOrgId@AdobeOrg"
```

**Notes:**

- **`--web true`** exposes the action as a web action (no Basic auth on the web URL).
- **`--kind nodejs:22`** matches the runtime in `app.config.yaml`.
- Use **create** only the first time; use **update** afterward so the action is refreshed.
- List actions: `wsk action list` or `aio runtime action list`.

### Database (ABDB)

- `runtimeManifest.database` in `app.config.yaml` can set `auto-provision: false` (as in this app).
- Ensure the Runtime namespace has **App Builder Database** enabled and the `tax_rates` collection is used as documented in the actions below.

---

## 5. Runtime Actions Reference

Base URLs (replace `<namespace>` with your Runtime namespace, e.g. `3676633-taxbycity-stage`):

- **Web (no auth):** `https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/<action-name>`
- **Runtime API (auth):** `https://adobeioruntime.net/api/v1/namespaces/<namespace>/actions/tax-by-city/<action-name>?result=true&blocking=true`

Unless noted, assume **JSON** `Content-Type` and that **web** actions support **CORS**.

---

### 5.1 tax-rate

**Purpose:** CRUD and lookup for tax rates using App Builder Database; optional Magento sync.

**Config:** `function: actions/tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Endpoints:**

| Method | Purpose | Parameters / body |
|--------|---------|--------------------|
| GET with `limit` | Paginated list from ABDB | Query: `limit`, `page`, `country`, `state`, `zipcode`, `city`, `region` |
| GET with location | Tax percentage by location from ABDB | Query: `country`, `state`, `zipcode`, optional `city`, `region` |
| POST | Create/update tax rate in ABDB (optional sync to Magento) | Body: tax rate object; optional `commerceDomain`, `instanceId`, `accessToken` for sync |
| PUT | Update tax rate | Same as POST |
| DELETE | Delete tax rate from ABDB | Body/params: `id` or `_id`, optional `region` |

**Steps (high level):**

1. **GET (list):** Parse `__ow_query` or params → build filter (country, state, zipcode, city) → `dbHelper.countTaxRates` + `dbHelper.findTaxRates` with pagination → return `{ status, data, pagination }`.
2. **GET (lookup):** Parse country, state, zipcode, city → `dbHelper.findTaxRateByLocation` (exact then fallback without city/zip) → return `taxPercentage` and `taxRate` or 404.
3. **POST/PUT:** Validate body → create/update in ABDB; if Magento sync requested, call Magento APIs (using token from header/params).
4. **DELETE:** Resolve ID → delete from ABDB (and optionally from Magento if implemented).

**Example GET (paginated):**

```http
GET /api/v1/web/tax-by-city/tax-rate?limit=20&page=1
Authorization: Bearer <token>
```

**Example GET (lookup):**

```http
GET /api/v1/web/tax-by-city/tax-rate?country=US&state=CA&zipcode=90210&city=Beverly%20Hills
```

**Example response (list):**

```json
{
  "status": "Success",
  "data": [ { "_id": "...", "tax_country_id": "US", "tax_region_id": "CA", "rate": "9.25", ... } ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3, "hasNext": true, "hasPrev": false }
}
```

---

### 5.2 tax-config

**Purpose:** Read/update application configuration (e.g. enable/disable Tax By City, cache settings).

**Config:** `function: actions/tax-config/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Parameters:** `operation` (required), optional `config` for updates. Can be passed in body or params.

**Operations:**

| Operation | Description |
|-----------|-------------|
| (none) | Health check; returns current config |
| GET / GET_CONFIG | Return current config |
| PUT / UPDATE | Update config (requires `config` object) |
| ENABLE | Set `tax_by_city_enabled: true` |
| DISABLE | Set `tax_by_city_enabled: false` |

**Steps:**

1. If no `operation`, return `{ status: 'ok', config }`.
2. Otherwise validate `operation`, then call `getConfig()` or `updateConfig()` (in-memory in sample; replace with State SDK or DB in production).
3. Return 200 with updated config or 400 for unsupported operation.

**Example request (body):**

```json
{ "operation": "GET_CONFIG" }
```

**Example response:**

```json
{
  "status": "ok",
  "config": {
    "tax_by_city_enabled": true,
    "fallback_to_magento": true,
    "cache_enabled": true,
    "cache_ttl": 3600
  }
}
```

---

### 5.3 list-tax-rates

**Purpose:** List tax rates from App Builder Database with filters and pagination.

**Config:** `function: actions/list-tax-rates/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Method:** GET only.

**Query parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| limit | No | Page size (default 20, max 1000) |
| page | No | Page number (default 1) |
| country | No | Filter by `tax_country_id` |
| state | No | Filter by `tax_region_id` |
| zipcode | No | Filter by `tax_postcode` |
| city | No | Filter by city |
| region | No | DB region: `amer`, `emea`, `apac` (default `amer`) |

**Steps:**

1. Handle OPTIONS (CORS).
2. Parse `__ow_query` or params; validate `limit` (1–1000).
3. Build filter from country, state, zipcode, city.
4. `countTaxRates(filter, region)` and `findTaxRates(filter, { limit, skip, sort }, region)`.
5. Map `_id` to string; return `{ status, data, pagination }`.

**Example:**

```http
GET /api/v1/web/tax-by-city/list-tax-rates?limit=100&page=1&country=US
```

**Example response:**

```json
{
  "status": "Success",
  "data": [
    {
      "_id": "...",
      "tax_country_id": "US",
      "tax_region_id": "CA",
      "tax_postcode": "90210",
      "rate": "9.25",
      "code": "US-CA-9.25",
      "city": "Beverly Hills",
      "created_at": "..."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 50,
    "totalPages": 1,
    "hasNext": false,
    "hasPrev": false
  }
}
```

---

### 5.4 manage-tax

**Purpose:** Create or update a tax rate in Magento Commerce and persist it in App Builder Database (only if Magento succeeds).

**Config:** `function: actions/manage-tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: true`. Inputs include Magento/Adobe env vars in `app.config.yaml`.

**Method:** POST.

**Request body:** Tax rate payload (e.g. country, state, zipcode, rate, code, priority, etc.). Must match what Magento and the app expect (see action code for full schema).

**Steps:**

1. Load Magento config from env (commerce domain, instance ID, client id/secret, token URL, scope).
2. Get Adobe access token (client_credentials) if not provided.
3. Map state/country to Magento region IDs; build Magento tax rate payload.
4. Call Magento REST (create or update tax rule/rate).
5. On success, upsert same rate into ABDB `tax_rates` collection.
6. Return success with created/updated id and Magento response.

**Note:** This action is invoked by the **save-tax-rate** web API action (which forwards the body to manage-tax with Basic auth to Runtime).

---

### 5.5 save-tax-rate (webAPI)

**Purpose:** Web-facing proxy to create/update a tax rate; calls **manage-tax** internally.

**Config:** `function: actions/webAPI/save-tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: false`. Uses `RUNTIME_USERNAME` and `RUNTIME_PASSWORD` for Basic auth to Runtime.

**Method:** POST.

**Request body:**

```json
{
  "taxRate": {
    "tax_country_id": "US",
    "tax_region_id": "CA",
    "tax_postcode": "90210",
    "rate": "9.25",
    "code": "US-CA-9.25",
    "city": "Beverly Hills",
    ...
  },
  "region": "amer"
}
```

**Steps:**

1. Parse body from `__ow_body` (base64 or JSON) or from params.
2. Validate `taxRate` is present.
3. Call Runtime action `manage-tax` with `POST` and Basic auth (`RUNTIME_USERNAME` / `RUNTIME_PASSWORD`).
4. Return the same status and body as manage-tax (success or error).

**Example:**

```http
POST /api/v1/web/tax-by-city/save-tax-rate
Content-Type: application/json

{ "taxRate": { "tax_country_id": "US", "tax_region_id": "CA", "tax_postcode": "90210", "rate": "9.25", "code": "US-CA-9.25" }, "region": "amer" }
```

---

### 5.6 get-taxes (webAPI)

**Purpose:** Proxy that returns tax rates by calling **list-tax-rates** internally (e.g. for UI).

**Config:** `function: actions/webAPI/get-taxes/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Method:** GET.

**Steps:**

1. Forward GET to Runtime action `list-tax-rates` with fixed or passed query (e.g. `limit=100`, `page=1`) and Basic auth.
2. Unwrap response (use `response.data.body` if wrapped).
3. Return 200 with body as `{ status, data }` or the list directly.

**Example:**

```http
GET /api/v1/web/tax-by-city/get-taxes
Authorization: Bearer <token>
```

---

### 5.7 delete-tax-rate and delete-tax-rate-action

**delete-tax-rate (webAPI)**  
**Config:** `function: actions/webAPI/delete-tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: true`.  
**Purpose:** Proxy to delete a tax rate; calls the Runtime **delete-tax-rate** action.  
**Method:** POST.  
**Body:** `{ "id": "<_id or tax_identifier>", "region": "amer" }` (or `_id`).  
**Steps:** Parse body/query → validate id → call delete-tax-rate with Basic auth → return result.

**delete-tax-rate-action**  
**Config:** `function: actions/delete-tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: true`.  
**Purpose:** Deletes the tax rate from Magento (if tax_identifier present) and from App Builder Database.  
**Steps:** Resolve id → get Magento config → get access token → delete from Magento by tax rule/rate id → delete from ABDB by `_id` → return success or error.

**Example (web API):**

```http
POST /api/v1/web/tax-by-city/delete-tax-rate
Content-Type: application/json

{ "id": "507f1f77bcf86cd799439011", "region": "amer" }
```

---

### 5.8 get-tax-percentage

**Purpose:** Return tax percentage for a location; can use ABDB and/or Magento (requires commerce domain and token when Magento is used).

**Config:** `function: actions/get-tax-percentage/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Method:** GET.

**Query parameters:** `country`, `state`, `zipcode`, optional `city`; for Magento: `commerceDomain`, `instanceId` (or `tenantId`), `accessToken` (or header). Optional: `orgId`, `runtimeBasicAuth`.

**Steps:**

1. Parse query and headers for location and Magento params.
2. Validate required params (e.g. `commerceDomain` when Magento is used).
3. If only DB: lookup in ABDB by location and return `taxPercentage`.
4. If Magento: use token to call Commerce API or internal logic and return percentage.

**Example:**

```http
GET /api/v1/web/tax-by-city/get-tax-percentage?country=US&state=CA&zipcode=90210&city=Los%20Angeles
```

---

### 5.9 calculate-tax-rate

**Purpose:** Implements tax calculation logic with city-level and zipcode-range support; reads from ABDB.

**Config:** `function: actions/calculate-tax-rate/index.js`, `web: 'yes'`, `require-adobe-auth: false`.

**Logic (summary):** Priority and rule order (e.g. tax_calculation rule, country, tax id, postcode, value); supports Tax by City, city for zipcode range, zipcode ranges, compounded rates, and duplicate handling (e.g. highest rate).

**Steps:**

1. Parse input (country, region, postcode, city, etc.).
2. `initDb(region)` and query `tax_rates` with filters and sort.
3. Apply zipcode range and city matching; resolve best match(es) and compound rates.
4. Return calculated rate(s) and metadata.

---

### 5.10 magento-tax-rate

**Purpose:** Returns **live** tax data from Adobe Commerce (Magento) GraphQL for a given address, using guest cart: create cart → add product → set shipping address → get prices/tax.

**Config:** `function: actions/magento-tax-rate/magento-tax-rate.zip`, `web: 'yes'`, `require-adobe-auth: false`. Inputs: `MAGENTO_COMMERCE_DOMAIN`, `MAGENTO_INSTANCE_ID`, `API_KEY`, `IMS_ORG_ID`, etc.

**Method:** POST (OPTIONS for CORS).

**Request body:**

| Field | Required | Description |
|-------|----------|-------------|
| postcode / zipcode | Yes | ZIP / postal code |
| country_code / country | Yes | ISO country code (e.g. US, CA) |
| region / state | No | State/region code |
| city | No | City |
| street | No | Street line(s), array or string |
| telephone | No | Phone (defaults if omitted) |

**Steps:**

1. Handle OPTIONS (CORS headers).
2. Parse body from `params.body` or `__ow_body` (base64/JSON); build address (postcode, country_code, region, city, street, telephone).
3. Validate postcode and country_code; return 400 if missing.
4. Create guest cart (GraphQL `createGuestCart`).
5. Get one product SKU (productSearch or products); use fallback SKU if none.
6. Add product(s) to cart (`addProductsToCart`).
7. Set shipping address on cart (`setShippingAddressesOnCart`).
8. Optionally set first shipping method (`setShippingMethodsOnCart`).
9. Get cart prices (`cart { prices { grand_total, subtotal_excluding_tax, subtotal_including_tax, applied_taxes } }`).
10. Return 200 with `{ status, address, prices, applied_taxes }`.

**Example request:**

```http
POST /api/v1/web/tax-by-city/magento-tax-rate
Content-Type: application/json

{
  "postcode": "90003",
  "country_code": "US",
  "region": "CA",
  "city": "Los Angeles"
}
```

**Example response:**

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

**Rebuild and deploy (after code/deps change):** See [Step 1: Generate the zip file](#step-1-generate-the-zip-file) and [Step 3: Manual deployment with OpenWhisk (wsk)](#step-3-manual-deployment-with-openwhisk-wsk) in Section 4 for full zip generation and `wsk action create` / `wsk action update` commands.

---

### 5.11 generate-token

**Purpose:** Generate an Adobe IMS access token (client_credentials) for Magento/Commerce API calls.

**Config:** `function: actions/generate-token/index.js`, `web: 'yes'`, `require-adobe-auth: false`. Inputs: `ADOBE_CLIENT_ID`, `ADOBE_CLIENT_SECRET`, `ADOBE_TOKEN_URL`, `ADOBE_SCOPE`.

**Method:** POST.

**Request body (optional override):** `clientId`, `clientSecret`, `tokenUrl`, `scope`.

**Steps:**

1. Parse body from `__ow_body` or params.
2. Resolve client id/secret, token URL, scope from body, params, or env.
3. POST to Adobe IMS token URL with `grant_type=client_credentials` and scope.
4. Return `{ access_token, ... }` or error.

**Example:**

```http
POST /api/v1/web/tax-by-city/generate-token
Content-Type: application/json

{}
```

(Uses env or app.config inputs; can override via body.)

---

### 5.12 generic

**Purpose:** Sample action that calls an external API (e.g. `https://adobeioruntime.net/api/v1`); demonstrates auth and error handling.

**Config:** `function: actions/generic/index.js`, `web: 'yes'`, `require-adobe-auth: true`.

**Steps:** Check required params and `Authorization` header → get Bearer token → fetch external API → return JSON. Not used by Tax By City business logic.

---

### 5.13 publish-events

**Purpose:** Sample action that publishes a Cloud Event to Adobe I/O Events.

**Config:** `function: actions/publish-events/index.js`, `web: 'yes'`, `require-adobe-auth: true`, input `apiKey: $SERVICE_API_KEY`.

**Required params:** `apiKey`, `providerId`, `eventCode`, `payload`. Required headers: `Authorization`, `x-gw-ims-org-id`.

**Steps:** Validate params → init Events client with org and apiKey → create Cloud Event → publish → return 200 or 204. Not required for core Tax By City flows.

---

### 5.14 hello-world

**Purpose:** Sample/template action (referenced in `app.config.yaml`; may be a placeholder). Not required for Tax By City functionality.

---

## 6. Frontend Configuration

The admin UI uses **config.json** (in `web-src/src/config.json`) to resolve action URLs. It is typically generated at build time with the correct Runtime namespace and base URL.

Example entries:

```json
{
  "tax-rate": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/tax-rate",
  "list-tax-rates": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/list-tax-rates",
  "get-taxes": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/get-taxes",
  "save-tax-rate": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/save-tax-rate",
  "delete-tax-rate": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/delete-tax-rate",
  "magento-tax-rate": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/magento-tax-rate",
  "tax-config": "https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/tax-config",
  ...
}
```

Both short names and full names (`tax-by-city/<action-name>`) are often present. The UI should use these keys to call the correct web action URLs with the appropriate method and body/query.

---

## 7. Environment Variables & Secrets

- **App / Runtime:** Set in `app.config.yaml` under `runtimeManifest.packages.tax-by-city.actions.<action>.inputs` (e.g. `LOG_LEVEL`, `MAGENTO_COMMERCE_DOMAIN`, `MAGENTO_INSTANCE_ID`, `API_KEY`, `IMS_ORG_ID`, `RUNTIME_USERNAME`, `RUNTIME_PASSWORD`). Do not commit secrets; use placeholders or CI secrets.
- **magento-tax-rate (local):** Uses `dotenv` and `.env` when present; do not bundle `.env` in the zip (use `.env.example` only).
- **Database:** App Builder Database (ABDB) is used with region (e.g. `amer`). Ensure the namespace has ABDB enabled and that the `tax_rates` collection exists and is used consistently across actions.

---

## Summary Table of Actions

| Action | Method | Auth | Purpose |
|--------|--------|------|---------|
| tax-rate | GET, POST, PUT, DELETE | Adobe | CRUD + lookup from ABDB; optional Magento sync |
| tax-config | GET/POST (operation in body) | Adobe | Get/update app config |
| list-tax-rates | GET | Adobe | Paginated list from ABDB |
| manage-tax | POST | Adobe | Create/update in Magento + ABDB |
| get-taxes | GET | Adobe | Proxy to list-tax-rates |
| save-tax-rate | POST | No | Proxy to manage-tax (for UI) |
| delete-tax-rate (webAPI) | POST | Adobe | Proxy to delete-tax-rate action |
| delete-tax-rate-action | POST | Adobe | Delete from Magento + ABDB |
| get-tax-percentage | GET | Adobe | Tax % by location (ABDB/Magento) |
| calculate-tax-rate | GET/POST | No | Tax calculation with city/zip rules |
| magento-tax-rate | POST | No | Live tax from Magento GraphQL (guest cart) |
| generate-token | POST | No | Adobe IMS access token for Magento |
| generic | (varies) | Adobe | Sample external API |
| publish-events | POST | Adobe | Sample I/O Events publish |
| hello-world | (varies) | No | Sample/template |

This completes the technical implementation guide for the Tax By City application using App Builder and its actions with steps, payloads, and responses.
