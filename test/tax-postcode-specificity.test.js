/**
 * Regression: US-wide * postcode rows (e.g. US-CA-*) must not stack with TX ZIP-range rows.
 */
const {
  filterCatchAllPostcodeWhenSpecificExists,
  getEffectiveRatePostcodePattern,
  filterRatesByCityPreference
} = require('../actions/webAPI/calculate-tax-rate/index.js');

describe('getEffectiveRatePostcodePattern', () => {
  test('App Builder range rows use zip_from + zip_to with null tax_postcode', () => {
    expect(
      getEffectiveRatePostcodePattern({
        tax_postcode: null,
        zip_is_range: 1,
        zip_from: '78701',
        zip_to: '78710',
        tax_identifier: 'Texas-test-1'
      })
    ).toBe('78701-78710');
  });
});

describe('filterCatchAllPostcodeWhenSpecificExists', () => {
  test('drops * postcode when a range pattern is also present', () => {
    const usCa = { tax_postcode: '*', tax_identifier: 'US-CA-10', tax_region_id: '*' };
    const texas = { tax_postcode: '78701-78710', tax_identifier: 'Texas-test-1', tax_region_id: '*' };
    const out = filterCatchAllPostcodeWhenSpecificExists([usCa, texas]);
    expect(out).toEqual([texas]);
  });

  test('drops * when range is from zip_from/zip_to (App Builder shape)', () => {
    const usCa = { tax_postcode: '*', tax_identifier: 'US-CA-10' };
    const texas = {
      tax_postcode: null,
      zip_is_range: true,
      zip_from: '78701',
      zip_to: '78710',
      tax_identifier: 'Texas-test-1',
      tax_region_id: '*'
    };
    const out = filterCatchAllPostcodeWhenSpecificExists([usCa, texas]);
    expect(out).toEqual([texas]);
  });

  test('drops empty postcode when exact pattern is present', () => {
    const blanket = { tax_postcode: '', tax_identifier: 'US-CA-12' };
    const exact = { tax_postcode: '78703', tax_identifier: 'TX-exact' };
    expect(filterCatchAllPostcodeWhenSpecificExists([blanket, exact])).toEqual([exact]);
  });

  test('keeps only * rows when no specific rule exists', () => {
    const a = { tax_postcode: '*', tax_identifier: 'A' };
    const b = { tax_postcode: '*', tax_identifier: 'B' };
    expect(filterCatchAllPostcodeWhenSpecificExists([a, b])).toEqual([a, b]);
  });

  test('empty array stays empty', () => {
    expect(filterCatchAllPostcodeWhenSpecificExists([])).toEqual([]);
  });
});

describe('filterRatesByCityPreference', () => {
  test('when city fully matches, keeps city rows and generic no-city rows', () => {
    const cityExactPostcode = { city: 'abc', tax_postcode: '78703', tax_identifier: 'City-exact' };
    const cityRangePostcode = { city: 'ABC', tax_postcode: '78701-78710', tax_identifier: 'City-range' };
    const genericRange = { city: '', tax_postcode: '78701-78710', tax_identifier: 'Texas-test-1' };
    const otherCity = { city: 'Austin', tax_postcode: '78703', tax_identifier: 'Austin-only' };

    const out = filterRatesByCityPreference(
      [cityExactPostcode, cityRangePostcode, genericRange, otherCity],
      'abc',
      { taxByCity: true }
    );

    expect(out).toEqual([cityExactPostcode, cityRangePostcode, genericRange]);
  });

  test('when city does not match, returns all region+postcode matched rows', () => {
    const cityA = { city: 'Austin', tax_postcode: '78703', tax_identifier: 'City-Austin' };
    const cityB = { city: 'Dallas', tax_postcode: '78701-78710', tax_identifier: 'City-Dallas' };
    const generic = { city: '', tax_postcode: '78701-78710', tax_identifier: 'Texas-test-1' };

    const out = filterRatesByCityPreference([cityA, cityB, generic], 'abc', { taxByCity: true });
    expect(out).toEqual([cityA, cityB, generic]);
  });
});
