# Deploy Tax Rate Action with ABDB Support

## Issue
The `aio app deploy` command shows "no backend, skipping action build" which means actions aren't being deployed automatically.

## Manual Deployment Steps

### Option 1: Deploy via Runtime CLI (Recommended)

1. **Ensure you're authenticated:**
   ```bash
   aio auth:login
   ```

2. **Deploy the action:**
   ```bash
   cd /var/www/html/coe/COE/tax-by-city/actions/tax-rate
   aio runtime action update tax-by-city/tax-rate tax-rate.zip --kind nodejs:22 --web yes
   ```

### Option 2: Deploy via Adobe I/O Console

1. Go to: https://console.adobe.io/
2. Navigate to your project → Workspace → Actions
3. Find `tax-rate` action
4. Click "Update" and upload the `tax-rate.zip` file
5. Set:
   - Runtime: `nodejs:22`
   - Web Action: `Yes`

### Option 3: Use aio app deploy with force

Try deploying with build flag:
```bash
cd /var/www/html/coe/COE/tax-by-city
aio app deploy --build
```

## Verify Deployment

After deployment, test the endpoint:

```bash
curl -X GET "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/tax-rate?limit=10&page=1" \
  -H "Content-Type: application/json"
```

Expected response:
```json
{
  "statusCode": 200,
  "body": {
    "status": "Success",
    "data": [...],
    "pagination": {...}
  }
}
```

## What Changed

The action no longer requires `commerceDomain` and `accessToken` for database-only operations. These are only needed if you want to sync to Magento.

