# fetch-db-table

Fetches documents from any App Builder Database collection. Requires Adobe IMS auth and `include-ims-credentials`.

## Deploy with wsk

Build and deploy (must include IMS annotations or the action will fail with MISSING_PARAMETERS):

```bash
cd actions/fetch-db-table
./build-zip.sh
wsk action update tax-by-city/fetch-db-table fetch-db-table.zip \
  --kind nodejs:22 --web true \
  -a require-adobe-auth true \
  -a include-ims-credentials true \
  --auth YOUR_AUTH --apihost https://adobeioruntime.net
```

## Endpoint

- **Web:** `https://<namespace>.adobeioruntime.net/api/v1/web/tax-by-city/fetch-db-table`
- **Params:** `collection` (required), `filter`, `limit`, `skip`, `sort`, `region`
- **Methods:** GET (query params) or POST (JSON body). Send Bearer token in `Authorization` header.
