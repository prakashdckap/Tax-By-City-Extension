# Debugging Frontend Database Connection

## Issue
Tax rates are not showing from App Builder Database in the frontend.

## Current Status
- ✅ Database is provisioned
- ✅ Collection `tax_rates` exists
- ✅ 1 test document exists in database
- ⚠️ Frontend may be falling back to localStorage

## Debugging Steps

### 1. Check Browser Console
Open browser developer tools (F12) and check the Console tab. Look for:
- `Fetching tax rates from App Builder Database...`
- `Response from App Builder Database:`
- `✓ Found X tax rates in...` or `❌ No tax rates found...`

### 2. Verify API Response Format
The backend returns:
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

### 3. Test API Directly
Test the GET endpoint directly:

```bash
# Get your action URL
aio app info

# Test with curl (replace with your actual URL and token)
curl -X GET "https://3676633-taxbycity-stage.adobeioruntime.net/api/v1/web/tax-by-city/tax-rate?limit=1000&page=1" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "x-gw-ims-org-id: YOUR_ORG_ID"
```

### 4. Check Network Tab
In browser DevTools → Network tab:
1. Filter by "tax-rate"
2. Find the GET request
3. Check:
   - Request URL (should have `?limit=1000&page=1`)
   - Request Method (should be GET)
   - Response Status (should be 200)
   - Response Body (should have `status: 'Success'` and `data: [...]`)

### 5. Common Issues

#### Issue: Response format mismatch
**Symptom**: Console shows "No tax rates found in response"
**Solution**: Check the response structure in console logs. The frontend handles multiple formats.

#### Issue: CORS errors
**Symptom**: Network tab shows CORS error
**Solution**: Ensure action is deployed with `web: 'yes'` annotation

#### Issue: Authentication errors
**Symptom**: 401 or 403 errors
**Solution**: Check that IMS token and org ID are being sent correctly

#### Issue: Action not found
**Symptom**: 404 error
**Solution**: Verify action is deployed and URL is correct

### 6. Manual Data Migration

If you have data in localStorage that needs to be migrated to the database:

```javascript
// Run in browser console on the Tax Rates page
const localRates = JSON.parse(localStorage.getItem('taxByCityRates') || '[]')
console.log(`Found ${localRates.length} rates in localStorage`)

// For each rate, create it via API
// (You would need to call the POST endpoint for each rate)
```

### 7. Force Refresh from Database

To force the frontend to reload from database:
1. Open browser console
2. Clear localStorage: `localStorage.removeItem('taxByCityRates')`
3. Refresh the page
4. Check console logs to see if it loads from database

## Expected Console Output

When working correctly, you should see:
```
Fetching tax rates from App Builder Database... {actionUrl: "...", params: {limit: 1000, page: 1}}
Response from App Builder Database: {statusCode: 200, body: {...}}
✓ Found 1 tax rates in response.body.data
Loaded 1 tax rates from App Builder Database
```

## Next Steps

1. Check browser console for error messages
2. Verify the API endpoint is accessible
3. Check network tab for the actual request/response
4. If still not working, check the response format matches expected structure

