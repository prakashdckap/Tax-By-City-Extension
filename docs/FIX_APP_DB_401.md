# Fix: aio app db 401 "Oauth token is not valid"

**You're on TaxByCity / Stage but `aio app db status` still returns 401:**  
The DB API is rejecting the CLI's OAuth token. Try in order:

1. **Upgrade CLI and re-login**
   ```bash
   npm install -g @adobe/aio-cli@latest
   aio login --force
   aio app use
   aio app db status
   ```

2. **If 401 persists:** Use the Console for DB. In [Adobe Developer Console](https://console.adobe.io) → **TaxByCity** → **Stage**, look for **Storage**, **Database**, or **App Builder** and provision or check the workspace database there. Your **Runtime actions** (list-tax-rates, fetch-db-table) may still work when called from the app or with the right auth; only the `aio app db` CLI commands keep returning 401.

---

When any of these fail with 401:

- `aio app db status`
- `aio app db provision`
- `aio app db document find` (or other `aio app db document *` commands)

```text
Error: Failed to check database status: Request ... to v1/db/... failed with code 401: Oauth token is not valid
```

the CLI is sending an **OAuth token** that the App Builder Database API rejects. Fix it by refreshing auth and ensuring the correct workspace is selected.

## Steps (in order)

### 1. Force a fresh login

The token may be expired or from a different org. Run:

```bash
aio login --force
```

Complete the browser login. Use the same Adobe ID that has access to the **TaxByCity** project.

### 2. Select the project workspace

From the app root:

```bash
cd /var/www/html/coe/COE/tax-by-city
aio app use
```

- Choose **A. Use the global Org / Project / Workspace configuration** (or the option that shows **TaxByCity** and **Stage**).
- If prompted to overwrite `.env` or `.aio`, choose **Yes** so the CLI uses this project’s context.

### 3. Retry the db command

```bash
aio app db status
```

If it succeeds, you can use:

```bash
aio app db document find tax_rates '{}' -l 100
```

### 4. If 401 persists

- **Console entitlements**  
  In [Adobe Developer Console](https://console.adobe.io) → project **TaxByCity** → **Stage** workspace, confirm **App Builder** (and any “App Builder Database” / “Firefly Storage”) is enabled for the project/org.

- **Same machine/browser**  
  Use the same machine and browser profile you use for the Developer Console. Avoid VPN or corporate proxies that might alter or block the OAuth callback.

- **CLI version**  
  Update and retry:
  ```bash
  npm install -g @adobe/aio-cli
  aio login --force
  aio app use
  aio app db status
  ```

### 5. If 401 still persists after login + app use

Your project already has **App Builder Data Services** in `.aio` and the user token has the right scopes (`adobeio.abdata.*`). If the CLI still returns 401:

1. **Update the CLI** (fixes sometimes land in newer versions):
   ```bash
   npm install -g @adobe/aio-cli@latest
   aio login --force
   aio app use
   aio app db status
   ```

2. **Provision the database from the Console** (if `aio app db provision` keeps returning 401):  
   In [Adobe Developer Console](https://console.adobe.io) → **TaxByCity** → **Stage** → look for **Storage** / **Database** or **App Builder** and provision or manage the workspace database from the UI. That way the DB can be provisioned even when the CLI’s token is rejected. After that, Runtime actions (e.g. **list-tax-rates**) can use the DB; only the `aio app db` CLI commands may keep failing with 401.

3. **Verify the DB via a Runtime action** (confirms whether the DB works; only the CLI may be failing):  
   If your **list-tax-rates** action is deployed and called with Adobe auth (e.g. from the Experience Cloud shell or with a Bearer token), it uses the same DB. If that call returns data, the database is fine and the 401 is limited to the `aio app db` command. Example:
   ```bash
   curl -s "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/list-tax-rates?limit=5" \
     -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
   ```
   Or open the app in the Experience Cloud shell and use the UI; if tax rates load, the DB is working.

4. **Report the issue**  
   If the Runtime action can read the DB but `aio app db status` always returns 401, it may be a CLI or backend bug. Consider [Adobe Developer Support](https://developer.adobe.com/support/) or the [aio-cli-plugin-app GitHub repo](https://github.com/adobe/aio-cli-plugin-app).

## Why this happens

- `aio app db` uses **OAuth** (user token from `aio login`), not the Runtime auth in `.env` (`AIO_runtime_auth`).
- The DB API expects a valid token for the **workspace** that owns the database. If the token is expired or for a different org/project, the API returns 401.
- Selecting the correct workspace with `aio app use` ensures the CLI uses the right project context for DB calls.
