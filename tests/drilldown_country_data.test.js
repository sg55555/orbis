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

const MANIFEST_JA = { JA: { admin1Bytes: 10, citiesBytes: 10, countryBbox: [122, 24, 154, 46] } };
const ADMIN1_JA = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a1code: 'JA-13', name_ja: '東京都' }, geometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } }] };
const CITIES_JA = [{ name: 'Tokyo', name_ja: '東京', lon: 139.69, lat: 35.69, pop: 37000000 }];

function urlRouter(map) {
  let count = 0;
  const fn = async (url) => {
    count += 1;
    for (const [needle, payload] of map) {
      if (url.includes(needle)) {
        if (payload === 'fail') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.callCount = () => count;
  return fn;
}

test('loadCountryGeo: 成功 fetch で admin1/cities を返し degraded=false', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', ADMIN1_JA], ['cities/JA', CITIES_JA]]);
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.equal(r.degraded, false);
  assert.equal(r.admin1.features.length, 1);
  assert.deepEqual(r.cities, CITIES_JA);
});

test('loadCountryGeo: admin1 が 404 なら degraded:true 空配列', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', 'fail'], ['cities/JA', CITIES_JA]]);
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.admin1, { type: 'FeatureCollection', features: [] });
  assert.deepEqual(r.cities, []);
});

test('loadCountryGeo: timeout(abort) で degraded:true', async () => {
  __resetCountryDataCache();
  // fetch が AbortSignal で reject する fake（timeoutMs=0 で即 abort）。
  const fetchFn = (url, opts) => new Promise((_resolve, reject) => {
    const s = opts && opts.signal;
    if (s) s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn, timeoutMs: 0 });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.cities, []);
});

test('loadCountryGeo: in-flight 共有（連打で fetch 一度）＋成功キャッシュ', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', ADMIN1_JA], ['cities/JA', CITIES_JA]]);
  const [a, b] = await Promise.all([
    loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn }),
    loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(fetchFn.callCount(), 2, 'admin1+cities の2回のみ（in-flight 共有で重複なし）');
  // キャッシュ済 → 追加 fetch なし
  const c = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.deepEqual(c, a);
  assert.equal(fetchFn.callCount(), 2, 'キャッシュヒットで追加 fetch なし');
});

test('loadCountryGeo: degraded 結果はキャッシュされず次回呼び出しで再試行できる', async () => {
  __resetCountryDataCache();
  // 1回目: admin1 fetch が失敗 → degraded:true
  const failFetch = urlRouter([['admin1/JA', 'fail'], ['cities/JA', CITIES_JA]]);
  const r1 = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn: failFetch });
  assert.equal(r1.degraded, true, '1回目は degraded');

  // __resetCountryDataCache は呼ばない（degraded がキャッシュされていないことを確認）
  // 2回目: 成功 fetch で上書きできる
  const successFetch = urlRouter([['admin1/JA', ADMIN1_JA], ['cities/JA', CITIES_JA]]);
  const r2 = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn: successFetch });
  assert.equal(r2.degraded, false, '2回目は成功');
  assert.equal(r2.admin1.features.length, 1, 'admin1 features が取得できている');
  assert.equal(successFetch.callCount(), 2, '2回目で fetchFn が呼ばれた（degraded はキャッシュされていない）');
});
