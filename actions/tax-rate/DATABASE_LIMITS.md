# App Builder Database Storage - Size Limitations and Quotas

## Document Size Limits

### Maximum Document Size
- **16 MB per document** - This is the maximum size for a single document in the database
- Documents larger than 16 MB will be rejected
- For tax rates, this is typically not a concern as each tax rate document is small (usually < 1 KB)

### Document Size Best Practices
- Keep documents under 1 MB for optimal performance
- For tax rates, typical document size is 200-500 bytes
- With 16 MB limit, you could theoretically store ~32,000-80,000 tax rate documents in a single document (not recommended)

## Database Storage Quotas

### Current Status
App Builder Database Storage is currently in **beta** and quotas may vary. The following information is based on available documentation:

### Known Limitations
1. **Provisioning**: Database must be manually provisioned (one per workspace)
2. **Workspace Isolation**: Each workspace has its own isolated database
3. **Region Selection**: Database is provisioned in one region (amer, emea, or apac)

### Organizational Quotas
- Database provisioning is subject to **organizational quotas and limits**
- Contact Adobe support or check your organization's App Builder quota for specific limits
- Quotas may vary by:
  - Organization tier
  - Workspace type (dev, stage, prod)
  - Region

## Practical Considerations for Tax Rates

### Estimated Capacity
Based on typical tax rate document sizes:

| Document Size | Estimated Documents | Storage Used |
|--------------|---------------------|--------------|
| 500 bytes    | 1,000,000           | ~500 MB      |
| 500 bytes    | 10,000,000          | ~5 GB        |
| 1 KB         | 1,000,000           | ~1 GB        |

### Real-World Scenarios
- **US Tax Rates**: ~50,000 zip codes × multiple rates = ~100,000-500,000 documents
- **Global Tax Rates**: Could reach millions of documents
- **Storage**: Even with millions of documents, storage would be in GB range (well within typical quotas)

## Monitoring Database Size

### Check Database Statistics
```bash
# Get overall database statistics
aio app db stats

# Get collection statistics
aio app db collection stats tax_rates
```

### Programmatic Monitoring
```javascript
const dbHelper = require('./db-helper');

// Count total documents
const count = await dbHelper.countTaxRates({});

// Get collection stats (if available)
const { client, collection } = await dbHelper.initDb();
const stats = await collection.stats();
console.log('Storage size:', stats.storageSize);
console.log('Document count:', stats.count);
await client.close();
```

## Best Practices

### 1. Document Design
- Keep documents small and focused
- Avoid storing large binary data (use File Storage instead)
- Use references for related data when possible

### 2. Indexing
- Create indexes on frequently queried fields
- Monitor index size (indexes consume storage)
- Remove unused indexes

### 3. Data Management
- Implement pagination for large result sets
- Use filters to reduce query result sizes
- Archive or delete old/unused data regularly

### 4. Performance
- Keep documents under 1 MB for optimal performance
- Use projections to limit returned fields
- Implement caching for frequently accessed data

## Comparison with Other App Builder Storage Options

| Storage Type | Max Item Size | Total Quota | Use Case |
|-------------|---------------|-------------|----------|
| **Database Storage** | 16 MB per document | Varies by org | Complex queries, relationships, indexing |
| **State Storage** | 1 MB per value | 1 GB per prod workspace | Session data, preferences, caching |
| **File Storage** | 200 GB per file | 1 TB per year | Large files, binary data |

## Recommendations for Tax Rate Application

### Current Implementation
- **Document Size**: ~200-500 bytes per tax rate
- **Estimated Capacity**: Millions of tax rates possible
- **Storage Impact**: Minimal (GB range even for large datasets)

### Optimization Strategies
1. **Pagination**: Already implemented (limit parameter)
2. **Indexing**: Create indexes on frequently queried fields:
   - `tax_country_id`, `tax_region_id`, `tax_postcode` (compound index)
   - `city` (for city-based queries)
   - `rate` (for rate-based queries)

3. **Data Cleanup**: 
   - Archive inactive tax rates
   - Remove duplicate entries
   - Implement soft deletes (status field) instead of hard deletes

4. **Monitoring**:
   - Track document count regularly
   - Monitor storage usage via `aio app db stats`
   - Set up alerts if approaching limits

## Important Notes

⚠️ **Beta Status**: App Builder Database Storage is currently in beta and not recommended for production use without proper evaluation.

⚠️ **Quota Verification**: Contact Adobe support or check your organization's App Builder dashboard for specific quota limits.

⚠️ **Region Selection**: Database region cannot be changed after provisioning. Choose carefully (amer, emea, or apac).

## Getting Help

- **Adobe Support**: Contact for quota information and limits
- **Documentation**: https://developer.adobe.com/app-builder/docs/guides/app_builder_guides/storage/
- **CLI Commands**: Use `aio app db stats` to monitor current usage

