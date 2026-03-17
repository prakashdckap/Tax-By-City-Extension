# Verify App Builder Data Services in Adobe Console

If **`aio app db status`** returns **401 Oauth token is not valid**, the DB API is rejecting auth for your project/workspace. Use this checklist to fix it.

## When `aio app db status` returns 401

1. **Re-login and select the right app/workspace**
   ```bash
   aio login --force
   aio app use
   ```
   Pick the project/workspace that has your Runtime namespace (e.g. **3676633-taxbycity-stage**). Then run `aio app db status` again.

2. **Confirm App Builder Data Services in that workspace**  
   In [Adobe Developer Console](https://console.adobe.io) → same project → **Stage** (or the workspace you use): under Services/APIs, **App Builder Data Services** must be present. If it’s missing, add it to this project/workspace.

3. **Credential must have Data Services access**  
   The credential you use (e.g. the one whose Client ID is in your app) must be in a **product profile** that includes **App Builder Data Services**. In Console → Project → **Credentials** and **Product profiles**, attach the credential to a profile that has Data Services.

4. **Retry**
   ```bash
   aio app db status
   ```
   If it still returns 401, the token your CLI uses still doesn’t have valid DB access; double-check the same project/workspace and product profile in Console.

---

## 1. Same project and workspace

- The **Runtime namespace** (`3676633-taxbycity-stage`) must belong to the **same project and workspace** where you added App Builder Data Services.
- In [Adobe Developer Console](https://console.adobe.io): open the project that contains the **Stage** workspace for this app.

## 2. App Builder Data Services added to that workspace

- In that project, open the **Stage** (or the workspace that has your Runtime).
- Under **Services/APIs**, confirm **App Builder Data Services** (or “App Builder Data Services API”) is listed and added to this workspace.
- If it’s missing, add it: **Add to project** / **Add service** → choose App Builder Data Services.

## 3. OAuth client has access (product profile)

- The action uses **Client ID** `02cacbf78e8b4e8d8cfe2f1eaa886c30` (from your app config).
- In the same project → **Credentials** (or **API Keys**): find the OAuth Server-to-Server credential whose **Client ID** is `02cacbf78e8b4e8d8cfe2f1eaa886c30`.
- That credential must be in a **product profile** that includes **App Builder Data Services** (or the Data Services API).
- If your credential is only in profiles that don’t include Data Services, add it to a profile that does, or create such a profile and add the credential to it.

## 4. Workspace database provisioned

- A **workspace database** must be provisioned for the same workspace (one DB per workspace).
- Either:
  - In **app.config.yaml** you have `runtimeManifest.database.auto-provision: true` and you ran **aio app deploy**, or
  - You ran **aio app db provision** (or provisioned via Console if available).
- If the DB was never provisioned, the DB API can return errors; provision for the correct region (e.g. `amer` to match `app.config.yaml`).

## 5. After changing Console

- Changes (new API, product profile, credential) can take a short time to apply.
- Wait a minute or two, then call **fetch-db-table** again (no need to redeploy the action if you only changed Console).

## Quick test

```bash
curl -s -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/fetch-db-table" \
  -H "Content-Type: application/json" \
  -d '{"collection":"tax_rates","limit":2}'
```

- **Success:** JSON with `"status":"Success"` and a `data` array.
- **401 "Oauth token is not valid":** DB is rejecting the token → re-check steps 2 and 3 (same project/workspace, Data Services added, credential in a profile that includes Data Services).
- **IMS scope error:** The Client ID used by the action doesn’t have the Data Services scope → re-check step 3 (product profile for that credential).
