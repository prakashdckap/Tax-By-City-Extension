# Quick Database Reference

## ✅ Plugin Installed

The `@adobe/aio-cli-plugin-app-storage` plugin is now installed. You can use all database commands.

## ⚠️ Configuration Required

Before using database commands, you need to configure your runtime environment:

### Option 1: Set Environment Variables

```bash
export AIO_RUNTIME_NAMESPACE=your-namespace
export AIO_RUNTIME_AUTH=your-auth-token
```

### Option 2: Use .env File

Create a `.env` file in the project root:

```bash
AIO_RUNTIME_NAMESPACE=your-namespace
AIO_RUNTIME_AUTH=your-auth-token
AIO_DB_REGION=amer  # Optional: amer, emea, or apac
```

### Option 3: Get from aio app info

```bash
# Get your runtime namespace
aio app info | grep namespace

# Or get auth from your existing configuration
```

## 📋 Available Commands

### Database Management

```bash
# Check database status
aio app db status

# Provision database (if not already provisioned)
aio app db provision

# Test connectivity
aio app db ping

# Get database statistics
aio app db stats

# Delete database (non-production only)
aio app db delete
```

### Collection Management (Tables)

```bash
# List all collections
aio app db collection list
# or
aio app db col list

# Create a collection
aio app db collection create tax_rates

# Get collection statistics
aio app db collection stats tax_rates

# Rename a collection
aio app db collection rename old_name new_name

# Drop a collection
aio app db collection drop tax_rates
```

### Document Management (Rows)

```bash
# Find all documents
aio app db document find tax_rates '{}'

# Find with filter
aio app db document find tax_rates '{"tax_country_id": "US"}'

# Count documents
aio app db document count tax_rates '{}'

# Insert a document
aio app db document insert tax_rates '{"tax_country_id": "US", "tax_region_id": "CA", "rate": "9.5"}'

# Update documents
aio app db document update tax_rates '{"tax_country_id": "US"}' '{"$set": {"rate": "10.0"}}'

# Delete a document
aio app db document delete tax_rates '{"_id": "document-id"}'
```

### Index Management

```bash
# List indexes
aio app db index list tax_rates
# or
aio app db idx list tax_rates

# Create an index
aio app db index create tax_rates -k tax_country_id -k tax_region_id

# Drop an index
aio app db index drop tax_rates index_name
```

## 🔍 Quick View Commands

Once configured, use these to view your database:

```bash
# 1. Check if database exists
aio app db status

# 2. List all collections (tables)
aio app db collection list

# 3. View all tax rates
aio app db document find tax_rates '{}'

# 4. Count tax rates
aio app db document count tax_rates '{}'

# 5. View collection stats
aio app db collection stats tax_rates
```

## 📝 Notes

- **Database Name**: Automatically managed (tied to workspace)
- **Collection Name**: `tax_rates`
- **Region**: Default is `amer`, can be set via `AIO_DB_REGION` env var or `--region` flag
- Collections are created automatically when first document is inserted

## 🚀 First Time Setup

1. **Configure environment** (see above)
2. **Provision database**:
   ```bash
   aio app db provision
   ```
3. **Verify status**:
   ```bash
   aio app db status
   ```
4. **View collections** (after inserting data):
   ```bash
   aio app db collection list
   ```

