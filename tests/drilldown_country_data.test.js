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

import { loadCountryBounds, __resetCountryIndexCache } from '../js/lib/drilldown/country_index.js';

const BOUNDS_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: 'JA', name: 'Japan' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    },
  ],
};

function fakeFetch(payload) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return { ok: true, json: async () => payload };
  };
  fn.callCount = () => calls;
  return fn;
}

test('loadCountryBounds: fetch→loadPolygons し code/rings を持つ polys を返す', async () => {
  __resetCountryIndexCache();
  const ff = fakeFetch(BOUNDS_FC);
  const polys = await loadCountryBounds(ff);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].code, 'JA');
  assert.ok(Array.isArray(polys[0].rings));
  assert.ok(Array.isArray(polys[0].bbox) && polys[0].bbox.length === 4);
});

test('loadCountryBounds: 2回目は再 fetch せずキャッシュを返す', async () => {
  __resetCountryIndexCache();
  const ff = fakeFetch(BOUNDS_FC);
  const a = await loadCountryBounds(ff);
  const b = await loadCountryBounds(ff);
  assert.equal(a, b, '同一参照（キャッシュ）');
  assert.equal(ff.callCount(), 1, 'fetch は一度だけ');
});

import { loadCountryGeo, __resetCountryDataCache } from '../js/lib/drilldown/country_data.js';

const MANIFEST = {
  JA: { admin1Bytes: 12345, citiesBytes: 2222, countryBbox: [122, 24, 154, 46] },
  extra: { IS: { lon: 34.95, lat: 31.45, margin: 1.5 } },
};

test('loadCountryGeo: manifest に admin1 が無い(extra)なら fetch せず degraded 空', async () => {
  __resetCountryDataCache();
  let fetched = false;
  const fetchFn = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  const r = await loadCountryGeo('IS', { manifest: MANIFEST, fetchFn });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.admin1, { type: 'FeatureCollection', features: [] });
  assert.deepEqual(r.cities, []);
  assert.equal(fetched, false, 'fetch を呼ばない');
});

test('loadCountryGeo: manifest に存在しない FIPS も fetch せず degraded 空', async () => {
  __resetCountryDataCache();
  let fetched = false;
  const fetchFn = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  const r = await loadCountryGeo('ZZ', { manifest: MANIFEST, fetchFn });
  assert.equal(r.degraded, true);
  assert.equal(fetched, false);
});
