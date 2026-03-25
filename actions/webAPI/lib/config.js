function getParamOrEnv(params = {}, key, fallback = undefined) {
  if (params[key] != null && params[key] !== '') return params[key];
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  return fallback;
}

function getRuntimeApiHost(params = {}) {
  return getParamOrEnv(params, 'RUNTIME_API_HOST', getParamOrEnv(params, 'AIO_runtime_apihost', ''));
}

function getRuntimeNamespace(params = {}) {
  return (
    params.__OW_NAMESPACE ||
    process.env.__OW_NAMESPACE ||
    getParamOrEnv(params, 'AIO_runtime_namespace', '')
  );
}

function getRuntimeAuthBase64(params = {}) {
  const explicitBase64 = getParamOrEnv(params, 'RUNTIME_AUTH_BASE64', '');
  if (explicitBase64) return explicitBase64.trim();

  const aioRuntimeAuth = getParamOrEnv(params, 'AIO_runtime_auth', '');
  if (aioRuntimeAuth) {
    const rawValue = String(aioRuntimeAuth).trim();
    return rawValue.includes(':') ? Buffer.from(rawValue, 'utf8').toString('base64') : rawValue;
  }

  const username = String(getParamOrEnv(params, 'RUNTIME_USERNAME', '')).trim();
  const password = String(getParamOrEnv(params, 'RUNTIME_PASSWORD', '')).trim();
  if (username && password) {
    return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  }

  return '';
}

function getDefaultRegion(params = {}) {
  return String(getParamOrEnv(params, 'DEFAULT_REGION', '')).trim();
}

function getTaxRatesCollection(params = {}) {
  return String(getParamOrEnv(params, 'TAX_RATES_COLLECTION', '')).trim();
}

function getSyncHistoryCollection(params = {}) {
  return String(getParamOrEnv(params, 'SYNC_HISTORY_COLLECTION', '')).trim();
}

function getDbServiceUrlTemplate(params = {}) {
  return String(getParamOrEnv(params, 'APP_BUILDER_DB_URL_TEMPLATE', '')).trim();
}

function getMagentoTokenUrl(params = {}) {
  return String(getParamOrEnv(params, 'ADOBE_TOKEN_URL', '')).trim();
}

function getMagentoScope(params = {}) {
  return String(getParamOrEnv(params, 'ADOBE_SCOPE', '')).trim();
}

function getMagentoGraphqlUrl(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_GRAPHQL_URL', getParamOrEnv(params, 'GRAPHQL_URL', ''))).trim();
}

function getMagentoApiKey(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_API_KEY', getParamOrEnv(params, 'API_KEY', getParamOrEnv(params, 'ADOBE_CLIENT_ID', '')))).trim();
}

function getMagentoImsOrgId(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_IMS_ORG_ID', getParamOrEnv(params, 'IMS_ORG_ID', getParamOrEnv(params, 'ADOBE_ORG_ID', getParamOrEnv(params, 'MAGENTO_ORG_ID', ''))))).trim();
}

function getMagentoWebsiteCode(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_WEBSITE_CODE', '')).trim();
}

function getMagentoStoreCode(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_STORE_CODE', '')).trim();
}

function getMagentoStoreViewCode(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_STORE_VIEW_CODE', '')).trim();
}

function getDefaultSku(params = {}) {
  return String(getParamOrEnv(params, 'MAGENTO_DEFAULT_SKU', '')).trim();
}

module.exports = {
  getParamOrEnv,
  getRuntimeApiHost,
  getRuntimeNamespace,
  getRuntimeAuthBase64,
  getDefaultRegion,
  getTaxRatesCollection,
  getSyncHistoryCollection,
  getDbServiceUrlTemplate,
  getMagentoTokenUrl,
  getMagentoScope,
  getMagentoGraphqlUrl,
  getMagentoApiKey,
  getMagentoImsOrgId,
  getMagentoWebsiteCode,
  getMagentoStoreCode,
  getMagentoStoreViewCode,
  getDefaultSku
};
