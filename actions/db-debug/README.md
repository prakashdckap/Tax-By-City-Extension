# db-debug

Debug action for App Builder Database connection. Returns the **exact error** and context when the DB connection fails (no secrets in the response).

## Deploy

If you deploy actions manually:

```bash
cd actions/db-debug
npm install
# Then deploy via aio runtime action update or wsk (see main project docs).
```

If `aio app deploy` deploys the backend, the action is deployed with the app.

## Invoke

**With Adobe auth (recommended – same as list-tax-rates):**

```bash
curl -s "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/db-debug" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

Or open the app in the Experience Cloud shell and call the `db-debug` action from the Actions UI.

## Response

- **Success:** `ok: true`, `step: "done"`, `collectionSample: 0` or `1`.
- **Failure:** `ok: false`, `errorDetails: { message, name, code, status, statusCode, stack }`, `step` (where it failed: init, connect, collection), `hasAuthInParams`, `hasOwHeaders`, `paramKeysSample`.

Use `errorDetails.message` and `errorDetails.code` to see the exact DB/API error (e.g. 401, "Oauth token is not valid", or "database not provisioned").
