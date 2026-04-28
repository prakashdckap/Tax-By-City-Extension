# Fetch Tax Rates from App Builder Database (Sample)

Sample runtime action that **connects to the App Builder database** and fetches tax rates from the `tax_rates` collection. Use this as a reference for building actions that read from [App Builder Database Storage](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/db-runtime-actions).

## Reference

- **list-tax-rates** – Full-featured action (pagination, filters) using the same `@adobe/aio-lib-db` and `tax_rates` collection.
- **App Builder docs**: [Runtime actions with Database Storage](https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/db-runtime-actions), [Database storage (Commerce)](https://developer.adobe.com/commerce/extensibility/app-development/best-practices/database-storage).

## How it works

1. **Init**: `libDb.init({ region })` – uses workspace DB (region from `app.config.yaml` or param).
2. **Connect**: `db.connect()` then `client.collection('tax_rates')`.
3. **Query**: `collection.find(filter).sort().limit()` then `toArray()`.
4. **Close**: `client.close()` in `finally`.

## Parameters (GET query or POST body)

| Param    | Description                    |
|----------|--------------------------------|
| country  | Filter by `tax_country_id`    |
| state    | Filter by `tax_region_id`     |
| zipcode  | Filter by `tax_postcode`      |
| city     | Filter by city                |
| limit    | Max results (default 50, max 500) |
| region   | DB region: amer, emea, apac (default amer) |

## Example

**GET**

```
GET /api/v1/web/tax-by-city/fetch-tax-rates-db?country=US&state=CA&limit=10
```

**POST**

```json
POST /api/v1/web/tax-by-city/fetch-tax-rates-db
Content-Type: application/json

{ "country": "US", "state": "TX", "limit": 20 }
```

**Response**

```json
{
  "status": "Success",
  "data": [
    {
      "_id": "...",
      "tax_country_id": "US",
      "tax_region_id": "CA",
      "tax_postcode": "90001",
      "city": "Los Angeles",
      "rate": "9.25",
      "created_at": "..."
    }
  ],
  "count": 1
}
```

## Database config

The app uses `runtimeManifest.database` in `app.config.yaml` (region `amer`). The action uses the same workspace database as **list-tax-rates**.
