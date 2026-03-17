# Fix: UI Showing Only 20 Records

The code is already updated. You must **deploy** so the stage runtime uses the new actions.

## Actions that must be updated (deployed)

| Action | Purpose | Config in app.config.yaml |
|--------|---------|---------------------------|
| **list-tax-rates** | Returns tax rates from DB; supports `limit=0` = all | `actions/list-tax-rates/index.js` |
| **get-taxes** | Called by the UI; forwards `limit=0` to list-tax-rates | `actions/webAPI/get-taxes/index.js` |

Both are deployed from **source** (not zip). One deploy updates both.

## Steps (run on your machine)

### 1. Deploy the app

From the project root:

```bash
cd /var/www/html/coe/COE/tax-by-city
aio app deploy
```

This will:
- Build and deploy **list-tax-rates** (with limit=0 support)
- Build and deploy **get-taxes** (sends limit=0 to list-tax-rates)
- Deploy the **web UI** (with ?limit=0 in the request and default 100 rows per page)

### 2. Hard-refresh the Tax Rates page

Open:

https://3676633-taxbycity-stage.adobeio-static.net/index.html#/tax-rates

Then do a **hard refresh** so the browser doesn’t use cached JS:
- **Windows/Linux:** `Ctrl + Shift + R` or `Ctrl + F5`
- **Mac:** `Cmd + Shift + R`

### 3. Verify

- You should see **all** tax rates (not only 20).
- The table shows up to **100 per page** by default; use the “per page” dropdown or pagination if you have more.

---

## If you only want to update the two actions (no UI rebuild)

You can deploy only actions (faster):

```bash
cd /var/www/html/coe/COE/tax-by-city
aio app deploy --no-build-ui
```

Then refresh the page. If the UI was already deployed earlier with the `?limit=0` change, it will start requesting all records and the updated get-taxes/list-tax-rates will return them.

---

## Quick test from command line (after deploy)

To confirm list-tax-rates returns more than 20:

```bash
curl -s -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/list-tax-rates" \
  -H "Content-Type: application/json" \
  -d '{"limit":0}' | head -c 500
```

You should see a long JSON with many items in `data` (or in `body.data` if wrapped).

---

## Manual deploy with `wsk` and zip (avoid 413 / exec size limit)

The runtime limit is **48 MB** (50331648 bytes) on the **uncompressed** (extracted) package. A 38 MB zip can still fail if it extracts to &gt; 48 MB.

**list-tax-rates** is built as a **single bundled file** (esbuild), so the zip contains only `index.js` + `package.json` (no node_modules). That keeps both compressed and uncompressed size under 48 MB.

**Build the zip with the script:**

```bash
cd /var/www/html/coe/COE/tax-by-city/actions/list-tax-rates
./build-zip.sh
```

This runs `node build.mjs` (bundle) then zips `dist/index.js` and `dist/package.json`, and checks size. Then deploy (path is relative to **current directory**):

From **actions/list-tax-rates** (after `./build-zip.sh`):

```bash
wsk action update list-tax-rates list-tax-rates.zip \
  --auth YOUR_AUTH --apihost https://adobeioruntime.net --kind nodejs:22
```

From **project root**:

```bash
wsk action update list-tax-rates actions/list-tax-rates/list-tax-rates.zip \
  --auth YOUR_AUTH --apihost https://adobeioruntime.net --kind nodejs:22
```
