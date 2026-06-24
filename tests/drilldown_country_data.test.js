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

import { countryBbox } from '../js/lib/drilldown/country_index.js';

const BBOX_INDEX = {
  country: { JA: [122.93, 24.04, 153.99, 45.52] },
  extra: { IS: { lon: 34.95, lat: 31.45, margin: 1.5 } },
};

test('countryBbox: country 索引にあればその bbox', () => {
  assert.deepEqual(countryBbox('JA', BBOX_INDEX), [122.93, 24.04, 153.99, 45.52]);
});

test('countryBbox: extra(EXTRA68) は lon/lat±margin の矩形', () => {
  assert.deepEqual(countryBbox('IS', BBOX_INDEX), [34.95 - 1.5, 31.45 - 1.5, 34.95 + 1.5, 31.45 + 1.5]);
});

test('countryBbox: どちらにも無いが fipsCenter があれば ±2度', () => {
  // US は country/extra 索引に無い → fipsCenter(US)=[-95.8259,37.2345] の ±2度
  assert.deepEqual(countryBbox('US', BBOX_INDEX), [-95.8259 - 2, 37.2345 - 2, -95.8259 + 2, 37.2345 + 2]);
});

test('countryBbox: 索引も centroid も無ければ世界全体 bbox', () => {
  assert.deepEqual(countryBbox('ZZ', {}), [-180, -85, 180, 85]);
});
