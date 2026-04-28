const {
  buildMagentoRestApiBaseUrl,
  buildMagentoTaxRatesResourceUrl,
  normalizeCommerceDomainForUrl
} = require('../actions/webAPI/update-tax-rate/index.js');

describe('update-tax-rate Magento REST URL (ACCS / no double slash)', () => {
  test('normalizeCommerceDomainForUrl strips protocol and trailing slash', () => {
    expect(normalizeCommerceDomainForUrl('https://na1.api.commerce.adobe.com/')).toBe(
      'na1.api.commerce.adobe.com'
    );
  });

  test('SaaS host requires instance id in base URL', () => {
    const base = buildMagentoRestApiBaseUrl({
      commerceDomain: 'na1-sandbox.api.commerce.adobe.com',
      instanceId: 'GMBkaBQSumFG4qaxU86h3L'
    });
    expect(base).toBe('https://na1-sandbox.api.commerce.adobe.com/GMBkaBQSumFG4qaxU86h3L');
  });

  test('SaaS host without instance id throws (prevents //V1/... 404)', () => {
    expect(() =>
      buildMagentoRestApiBaseUrl({
        commerceDomain: 'na1-sandbox.api.commerce.adobe.com',
        instanceId: ''
      })
    ).toThrow(/tenant/);
  });

  test('SaaS with whitespace instance id is treated as missing', () => {
    expect(() =>
      buildMagentoRestApiBaseUrl({
        commerceDomain: 'na1-sandbox.api.commerce.adobe.com',
        instanceId: '   '
      })
    ).toThrow(/tenant/);
  });

  test('V1/taxRates resource path has no double slash', () => {
    const url = buildMagentoTaxRatesResourceUrl({
      commerceDomain: 'na1-sandbox.api.commerce.adobe.com',
      instanceId: 'GMBkaBQSumFG4qaxU86h3L'
    });
    expect(url).toBe('https://na1-sandbox.api.commerce.adobe.com/GMBkaBQSumFG4qaxU86h3L/V1/taxRates');
    expect(url).not.toMatch(/https:\/\/[^/]+\/\/V1/);
  });

  test('on-prem style host can omit instance id (no SaaS host)', () => {
    const base = buildMagentoRestApiBaseUrl({
      commerceDomain: 'magento.example.com',
      instanceId: ''
    });
    expect(base).toBe('https://magento.example.com');
  });
});
