# How to Check App Builder Database Is Installed Properly

Per [App Builder Database Storage docs](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/database), **aio-lib-db must be initialized with an IMS Access Token**. This app does that by:

1. Using **`include-ims-credentials: true`** in `app.config.yaml` for every action that uses the DB (so Runtime injects IMS credentials into action params).
2. Calling **`generateAccessToken(params)`** from `@adobe/aio-sdk` and passing the token to **`libDb.init({ token: token.access_token, region })`** in each DB action.

Verify the App Builder database at three levels: **package**, **workspace entitlement**, and **runtime**.

---

## 1. Package: `@adobe/aio-lib-db` in your actions

Actions that use the DB must depend on the library and call `libDb.init()`.

**Check dependency (per action):**

```bash
# List-tax-rates (uses DB)
cat actions/list-tax-rates/package.json | grep aio-lib-db

# Should show: "@adobe/aio-lib-db": "^0.1.0-beta.4" (or similar)
```

**Check that code uses it:**

```bash
grep -l "aio-lib-db" actions/*/index.js actions/*/*/index.js
# Should include: list-tax-rates, manage-tax-rate, create-tax-rate, etc.
```

**Install/reinstall in an action (if missing):**

```bash
cd actions/list-tax-rates
npm install
```

---

## 2. Workspace entitlement: App Builder Data Services

The **project/workspace** in Adobe Developer Console must have the App Builder Data Services entitlement so the DB API and runtime token work.

**Check in `.aio` (after `aio app use`):**

```bash
grep -A2 "App Builder Data Services" .aio
```

You should see something like:

```json
{
  "name": "App Builder Data Services",
  "code": "AppBuilderDataServicesSDK",
  "type": "entp"
}
```

If it’s missing, add it in [Adobe Developer Console](https://console.adobe.io) → your project → **Stage** → **Add service** → add **App Builder Data Services** (or equivalent).

---

## 3. Runtime: DB is provisioned and actions can connect

### Quick check: “DB connection successful”

Use the **db-debug** action with your Bearer token. It tries `libDb.init({ token, region })` and a quick read; the response tells you if the DB connection is successful.

**1. Get a Bearer token:** `aio auth:login` then `aio auth:token`

**2. Call db-debug (replace `YOUR_TOKEN`):**

```bash
curl -s "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/db-debug" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**3. Check the response:**

- **Success:** `"dbConnectionSuccessful": true`, `"message": "DB connection successful."`
- **Failure:** `"dbConnectionSuccessful": false`, `"message": "DB connection failed."` and `errorDetails` with the reason (e.g. invalid token, wrong region, DB not provisioned).

The action uses the same pattern as the [App Builder docs](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/database): IMS token (from your Bearer header or from `generateAccessToken(params)` when `include-ims-credentials: true`) and `libDb.init({ token, region })` with `region` matching `app.config.yaml` → `runtimeManifest.database.region` (e.g. `amer`).

---

**Option A – CLI (if it works for you):**

```bash
aio app db status
```

If you see provisioning status (and no 401), the workspace DB is provisioned and the CLI can talk to it.

**Option B – Use the db-debug action (exact error):**

Deploy and invoke the **db-debug** action (see `actions/db-debug/README.md`). It tries to connect to the DB and returns the **exact error** in the response body: `errorDetails.message`, `errorDetails.code`, `errorDetails.status`, and which step failed (`init`, `connect`, or `collection`). No secrets are returned. Use this to see whether the failure is 401 (token), "database not provisioned", or something else.

**Option C – Call list-tax-rates (works even when CLI returns 401):**

If **list-tax-rates** is deployed, call it with Adobe auth. If it returns data (or a valid empty list), the DB is provisioned and the action can connect:

```bash
# Web action (no auth for public actions; if require-adobe-auth: true, add Bearer token)
curl -s "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/list-tax-rates?limit=5"
```

Expected: `{"statusCode":200,"body":{"status":"Success","data":[...],"pagination":{...}}}` or similar. Errors like “Database error” or auth failures mean the DB isn’t set up or the action can’t get a token.

**Option D – Use the app UI**

Open the Tax By City app in the Experience Cloud shell. If the tax rates list (or sync/config that uses the DB) loads, the App Builder database is installed and working at runtime.

---

## 4. App config: DB region

Your `app.config.yaml` should define the DB region used by the runtime:

```yaml
runtimeManifest:
  database:
    auto-provision: false
    region: amer   # or emea, apac
```

Actions use this region (or `AIO_DB_REGION`) when calling `libDb.init({ region })`. Default is `amer`; must match the region where the workspace DB was provisioned.

---

## Quick checklist

| Check | Command or location |
|-------|----------------------|
| Package in action | `cat actions/list-tax-rates/package.json` → `@adobe/aio-lib-db` |
| Code uses libDb | `grep -l "libDb.init" actions/*/index.js` |
| Workspace entitlement | `grep "AppBuilderDataServicesSDK" .aio` |
| DB provisioned (CLI) | `aio app db status` |
| DB working at runtime | `curl` **list-tax-rates** or use app UI |

If all are true, the App Builder database is installed and configured properly. If `aio app db status` returns 401 but the **list-tax-rates** response or app UI works, the DB is fine and only the CLI token is rejected; see `docs/FIX_APP_DB_401.md`.
