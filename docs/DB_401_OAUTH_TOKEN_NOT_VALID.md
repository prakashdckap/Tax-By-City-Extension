# Fix: "Oauth token is not valid" (401) when calling fetch-db-table / DB actions

## Same 401 from the CLI

If **`aio app db status`** also fails with:

```text
Error: Failed to check database status: Request ... to v1/db/provision/status failed with code 401: Oauth token is not valid
```

then the issue is **not** the action code. The App Builder DB API is rejecting auth for this project/workspace. Fix it at the Console and login level (below).

## Why you see 401

App Builder Database accepts **service tokens** (client_credentials), not **user Bearer tokens**. If you call the action with only `Authorization: Bearer <user token>`, the DB API returns 401 "Oauth token is not valid".

## What the action does now

- **fetch-db-table** uses a **service token** when the action has `clientId` and `clientSecret` (from default params or env). That token is generated with `generateAccessToken(params)` and sent to the DB.
- So you can call the action **with or without** a Bearer header; when the action is deployed with default params (`-p clientId ... -p clientSecret ... -p orgId ...`), it will use the service token for the DB and the 401 should stop.

## If you get "None of the requested scopes are both on the client and the binding"

The action now requests only **adobeio_api** by default (so IMS accepts the request). If you still see this error, your OAuth client may not have that scope—add the relevant API in Adobe Developer Console.

**For the DB to accept the token** (and avoid 401 from the DB), the token must include App Builder Data Services scope:

1. Open [Adobe Developer Console](https://console.adobe.io) → your project → **Stage** (or the workspace with your Runtime).
2. Add **App Builder Data Services** (or "App Builder Data Services API") to the project if it’s not there.
3. Ensure your OAuth Server-to-Server credential is in a product profile that includes that API.
4. Pass a scope that includes the DB scope when deploying the action, e.g.  
   `-p scope "adobeio_api,adobeio.abdata.read"`  
   or set **ADOBE_SCOPE** in the action inputs to that value.  
   (The action uses **adobeio_api** by default so IMS returns a token; add **adobeio.abdata.read** once the API is in your project so the DB accepts it.)

## Summary

| Token type        | DB accepts? | When used                          |
|-------------------|------------|------------------------------------|
| Service token     | Yes        | When clientId/clientSecret are set |
| User Bearer token | No (401)   | If you rely only on Bearer         |

Deploy the action with default params so it has clientId/clientSecret; then calls will use a service token and the DB connection should succeed (assuming the project has App Builder Data Services API).
