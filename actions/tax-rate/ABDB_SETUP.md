# App Builder Database Storage (ABDB) Setup for Tax Rates

## Overview

The tax-rate action now uses App Builder Database Storage (ABDB) for persistent storage of tax rates. This provides a backend database that persists across sessions and is shared across all users.

## Prerequisites

1. **Install AIO CLI DB Plugin** (if not already installed):
   ```bash
   aio plugins:install @adobe/aio-cli-plugin-app-storage@next
   ```

2. **Provision Workspace Database**:
   ```bash
   aio app db provision
   ```
   
   Check status:
   ```bash
   aio app db status
   ```

3. **Set Region** (if not using default 'amer'):
   - Add to `.env` file: `AIO_DB_REGION=emea` or `AIO_DB_REGION=apac`
   - Or use `--region` flag in CLI commands

## Initial Setup

### Create Indexes (Optional but Recommended)

Indexes improve query performance. Create them by calling the `createIndexes` function:

```javascript
const dbHelper = require('./db-helper');
await dbHelper.createIndexes('amer'); // or 'emea', 'apac'
```

Or create manually using CLI:
```bash
# Compound index for location queries
aio app db index create tax_rates -k tax_country_id -k tax_region_id -k tax_postcode

# City index
aio app db index create tax_rates -k city

# Rate index
aio app db index create tax_rates -k rate

# Status index
aio app db index create tax_rates -k status
```

## API Usage

### GET - List Tax Rates (Paginated)

```
GET /tax-rate?limit=20&page=1&country=US&state=CA
```

Query Parameters:
- `limit` (required): Number of results per page
- `page`: Page number (default: 1)
- `country`: Filter by country code
- `state`: Filter by state/region
- `zipcode`: Filter by zipcode
- `city`: Filter by city
- `region`: Database region (amer, emea, apac) - defaults to 'amer'

### GET - Lookup Tax Rate by Location

```
GET /tax-rate?country=US&state=CA&zipcode=90210&city=Los Angeles
```

Query Parameters:
- `country` (required): Country code
- `state` (required): State/region code
- `zipcode` (required): Zipcode
- `city`: Optional city name
- `region`: Database region

### POST - Create Tax Rate

```json
POST /tax-rate
{
  "taxRate": {
    "tax_country_id": "US",
    "tax_region_id": "CA",
    "tax_postcode": "90210",
    "city": "Los Angeles",
    "rate": "9.5",
    "status": true
  },
  "syncToMagento": false,
  "region": "amer"
}
```

### PUT - Update Tax Rate

```json
PUT /tax-rate
{
  "id": "507f1f77bcf86cd799439011",
  "taxRate": {
    "rate": "10.0",
    "status": false
  },
  "region": "amer"
}
```

Or using filter:
```json
PUT /tax-rate
{
  "filter": {
    "tax_country_id": "US",
    "tax_region_id": "CA",
    "tax_postcode": "90210"
  },
  "taxRate": {
    "rate": "10.0"
  }
}
```

### DELETE - Delete Tax Rate

```json
DELETE /tax-rate
{
  "id": "507f1f77bcf86cd799439011"
}
```

Or using filter:
```json
DELETE /tax-rate
{
  "filter": {
    "tax_country_id": "US",
    "tax_region_id": "CA"
  }
}
```

## Database Helper Functions

The `db-helper.js` module provides the following functions:

- `insertTaxRate(taxRate, region)` - Insert single tax rate
- `insertManyTaxRates(taxRates, region)` - Insert multiple tax rates
- `findTaxRates(filter, options, region)` - Find tax rates with pagination
- `findOneTaxRate(filter, region)` - Find single tax rate
- `countTaxRates(filter, region)` - Count matching tax rates
- `updateTaxRate(filter, update, region)` - Update single tax rate
- `updateManyTaxRates(filter, update, region)` - Update multiple tax rates
- `replaceTaxRate(filter, replacement, region)` - Replace tax rate document
- `deleteTaxRate(filter, region)` - Delete single tax rate
- `deleteManyTaxRates(filter, region)` - Delete multiple tax rates
- `findTaxRateByLocation(location, region)` - Find by location (country, state, zipcode, city)
- `createIndexes(region)` - Create recommended indexes

## Magento Sync (Optional)

When creating tax rates, you can optionally sync to Magento by setting `syncToMagento: true` and providing Magento credentials:

```json
{
  "taxRate": { ... },
  "syncToMagento": true,
  "commerceDomain": "your-domain.com",
  "instanceId": "your-instance-id",
  "accessToken": "your-access-token"
}
```

## Notes

- The database is automatically provisioned per workspace
- Collections are created automatically on first use
- All timestamps (`created_at`, `updated_at`) are automatically managed
- ObjectId fields are automatically converted to strings in API responses
- The default region is 'amer' - change in `db-helper.js` or pass via API

