# Fix 401 "The resource requires authentication" for DBToken

Your `app.config.yaml` already has `require-adobe-auth: false` for `get-db-token`, but the deployed action **DBToken** may have been created with auth required. Use one of the options below so `curl` without a Bearer token works.

**Note:** After updating the annotation, the API Gateway can take **5–10 minutes** to apply the change. If you still get 401, wait a few minutes and try again.

## Option 1: Set annotation via Adobe I/O CLI (recommended)

From the project root (so the correct workspace is used):

```bash
aio runtime action update DBToken --annotation require-adobe-auth false
```

Then test:

```bash
curl -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/DBToken" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Option 2: Set annotation via wsk

If you use OpenWhisk CLI directly:

```bash
wsk action update DBToken --annotation require-adobe-auth false --auth YOUR_NAMESPACE:AUTH_KEY --apihost https://adobeioruntime.net
```

Use the same namespace and auth key you use for deploy. If the action is under a package, use the full name, e.g. `tax-by-city/DBToken` or `application/DBToken`.

## Option 3: Redeploy so config is applied

Redeploy the app so the action is recreated from `app.config.yaml` (where get-db-token has `require-adobe-auth: false`):

```bash
aio app deploy
```

If your deploy deploys backend actions, the get-db-token action should then get the correct annotations. The action name in the list might be **DBToken** or **get-db-token** depending on the project.

## Verify

After updating, this should return a token (no Bearer header):

```bash
curl -s -X POST "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/DBToken" \
  -H "Content-Type: application/json" \
  -d '{}'
```

You should see JSON with `"status":"Success"` and `"access_token":"eyJ..."`.

**Check current annotations:** `aio runtime action get DBToken` — ensure `require-adobe-auth` is `false`.

---

## Why web URL returns 401 or 404

- **401** – Web gateway requires a Bearer token (Adobe I/O auth), not Basic auth.
- **404** – The web path may not accept Basic auth, or the resource path is different.

Use **raw invoke** (Option 4) to call the action with Basic auth; it does not use the web gateway.

## Option 4: Use raw invoke (works immediately, no web gateway)

If the web URL keeps returning 401 (e.g. project-level auth is enforced), call the action via the **Runtime API** with **Basic auth** (your namespace + auth key). This bypasses the web gateway.

**1. Get your auth:** From project root, `aio runtime property get` or check `.aio` for the auth value. Format: `NAMESPACE:AUTH_KEY`.

**2. Invoke (replace `YOUR_NAMESPACE` and `YOUR_AUTH_KEY`):**

```bash
curl -s -X POST "https://adobeioruntime.net/api/v1/namespaces/3676633-taxbycity-stage/actions/DBToken?result=true&blocking=true" \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n '3676633-taxbycity-stage:YOUR_AUTH_KEY' | base64 -w 0)" \
  -d '{}'
```

**3. Response shape:** You get the activation result. The token is in the action’s response body, e.g.:

- If the CLI returns the result directly: look for `"body": { "status": "Success", "access_token": "eyJ..." }`.
- Full structure is often: `response.result.body.access_token` or inside `result.body.access_token` depending on client.

**4. One-liner with aio (no manual Base64):**

```bash
aio runtime action invoke DBToken --blocking --result
```

This uses your logged-in credentials and prints the result (including the token in the body).
