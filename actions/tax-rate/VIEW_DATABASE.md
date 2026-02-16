# Viewing App Builder Database and Collections

## Database Name

**Important**: App Builder Database Storage uses a **one-to-one relationship** between an AIO Project Workspace and a Workspace Database. The database name is **automatically managed** by the system and is tied to your workspace. You don't need to (and can't) specify a database name - it's automatically selected based on your workspace context.

## Collection Name

The collection (table) name used in this application is:
- **`tax_rates`** - Stores all tax rate documents

## Viewing Database and Collections

### Method 1: Using AIO CLI DB Plugin Commands

#### Check Database Status
```bash
# Check if database is provisioned
aio app db status

# Check database connectivity
aio app db ping

# Get database statistics
aio app db stats
```

#### List All Collections
```bash
# List all collections in the database
aio app db collection list
```

Expected output:
```
Collections in database:
- tax_rates
```

#### View Collection Statistics
```bash
# Get statistics for the tax_rates collection
aio app db collection stats tax_rates
```

#### View Collection Documents
```bash
# View all documents in tax_rates collection (first 20, max 100)
aio app db document find tax_rates '{}'

# Find specific documents
aio app db document find tax_rates '{"tax_country_id": "US"}'

# Count documents
aio app db document count tax_rates '{}'
```

#### View Indexes
```bash
# List all indexes for tax_rates collection
aio app db index list tax_rates
```

### Method 2: Using Runtime Actions (Programmatic Access)

You can create a simple action to query the database programmatically:

```javascript
const dbHelper = require('./db-helper');

async function main(params) {
  try {
    // List all tax rates
    const allRates = await dbHelper.findTaxRates({}, { limit: 100 });
    
    // Count total documents
    const count = await dbHelper.countTaxRates({});
    
    // Get collection stats (requires direct DB access)
    const { client, collection } = await dbHelper.initDb();
    const stats = await collection.stats(); // Note: stats() may not be available in all ABDB versions
    
    await client.close();
    
    return {
      statusCode: 200,
      body: {
        totalCount: count,
        documents: allRates,
        collectionName: dbHelper.COLLECTION_NAME
      }
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: { error: error.message }
    };
  }
}
```

### Method 3: Query via API Endpoints

You can use the existing GET endpoints to view data:

```bash
# Get paginated list of tax rates
curl -X GET "https://your-runtime-url/api/v1/web/tax-by-city/tax-rate?limit=100&page=1" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-gw-ims-org-id: YOUR_ORG_ID"

# Find tax rate by location
curl -X GET "https://your-runtime-url/api/v1/web/tax-by-city/tax-rate?country=US&state=CA&zipcode=90210" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-gw-ims-org-id: YOUR_ORG_ID"
```

## Database Information

### Workspace Context

The database is automatically associated with:
- **Project**: Your AIO Project (from `app.config.yaml` or environment)
- **Workspace**: Your current workspace (dev, stage, prod)
- **Region**: Database region (amer, emea, or apac)

### Viewing Workspace Information

```bash
# Get current workspace info
aio app info

# This will show:
# - Project ID
# - Workspace ID
# - Workspace Name
# - Runtime Namespace
```

The database is tied to the **Runtime Namespace** shown in this output.

## Region Configuration

The database region can be set via:

1. **Environment variable** (in `.env` file):
   ```bash
   AIO_DB_REGION=amer  # or emea, apac
   ```

2. **CLI flag**:
   ```bash
   aio app db status --region emea
   ```

3. **API parameter**:
   ```json
   {
     "region": "amer"
   }
   ```

## Common Queries

### View All Tax Rates
```bash
aio app db document find tax_rates '{}'
```

### Find by Country
```bash
aio app db document find tax_rates '{"tax_country_id": "US"}'
```

### Find by Country and State
```bash
aio app db document find tax_rates '{"tax_country_id": "US", "tax_region_id": "CA"}'
```

### Count Documents
```bash
aio app db document count tax_rates '{}'
```

### View Indexes
```bash
aio app db index list tax_rates
```

## Troubleshooting

### Database Not Provisioned
If you get errors about database not being provisioned:
```bash
aio app db provision
```

### Connection Issues
Check connectivity:
```bash
aio app db ping
```

### Wrong Region
If you get connection errors, verify the region matches:
```bash
# Check current region setting
echo $AIO_DB_REGION

# Or check in .env file
cat .env | grep AIO_DB_REGION
```

## Notes

- **Database Name**: Automatically managed, tied to workspace
- **Collection Name**: `tax_rates` (defined in `db-helper.js`)
- **No Direct Database Selection**: The `aio-lib-db` library automatically connects to the workspace database
- **Isolation**: Each workspace has its own isolated database
- **Collections**: Created automatically on first document insert

