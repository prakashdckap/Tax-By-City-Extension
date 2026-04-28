/**
 * Magento tax rows often use numeric tax_region_id (e.g. 57 for TX); OOP quotes send region_code TX.
 */
const { normalizeUsTaxRegionForMatching } = require('../actions/webAPI/lib/us-state-normalize.js');

describe('normalizeUsTaxRegionForMatching', () => {
  test('maps Magento region id 57 to TX for US', () => {
    expect(normalizeUsTaxRegionForMatching(57, 'US')).toBe('TX');
    expect(normalizeUsTaxRegionForMatching('57', 'US')).toBe('TX');
  });

  test('passes through 2-letter codes', () => {
    expect(normalizeUsTaxRegionForMatching('TX', 'US')).toBe('TX');
    expect(normalizeUsTaxRegionForMatching('ca', 'US')).toBe('CA');
  });

  test('maps full state names', () => {
    expect(normalizeUsTaxRegionForMatching('Texas', 'US')).toBe('TX');
  });

  test('non-US returns trimmed string', () => {
    expect(normalizeUsTaxRegionForMatching('TX', 'DE')).toBe('TX');
  });
});
