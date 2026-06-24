import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fipsCenter } from '../js/lib/drilldown/country_index.js';

test('fipsCenter: 既知FIPS は COUNTRIES の [lng,lat] を返す', () => {
  // JA(日本)=135.6614,36.2041 / US=-95.8259,37.2345（country_centroids.js 実値）
  assert.deepEqual(fipsCenter('JA'), [135.6614, 36.2041]);
  assert.deepEqual(fipsCenter('US'), [-95.8259, 37.2345]);
});

test('fipsCenter: 未知FIPS は null', () => {
  assert.equal(fipsCenter('ZZ'), null);
});
