/*
 * Admin UI SDK — registration action (HTTP endpoint Commerce calls to learn how to embed the app).
 * Docs: https://developer.adobe.com/commerce/extensibility/admin-ui-sdk/app-registration/
 *
 * Returned JSON defines:
 * - registration.menuItems: Commerce Admin left-nav section ("Tax By City") and child item(s).
 *   Ids must be alphanumeric + / : _ only (no hyphens).
 * - registration.page: shell chrome for the iframe that loads this project’s web bundle
 *   (see src/admin-ui/ext.config.yaml → operations.view.impl).
 *
 * Must stay in sync with web-src/src/components/Constants.js `extensionId` for attach().
 */

const extensionId = 'taxbycity'

async function main () {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      registration: {
        menuItems: [
          {
            id: `${extensionId}::apps`,
            title: 'Tax By City',
            isSection: true,
            sortOrder: 80
          },
          {
            id: `${extensionId}::dashboard`,
            title: 'Dashboard',
            parent: `${extensionId}::apps`,
            sortOrder: 1
          }
        ],
        page: {
          title: 'Tax By City'
        }
      }
    }
  }
}

exports.main = main
