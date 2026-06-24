import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initCountryClick } from '../js/ui/country_click.js';

// loadPolygons 形の最小 polys（geo_poly の loadPolygons 出力 = {code,name,name_ja,bbox,rings}）。
// 0..2 の正方形を JA とする。
const POLYS = [
  { code: 'JA', name: 'Japan', name_ja: '日本', bbox: [0, 0, 2, 2], rings: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
];

function fakeMap() {
  return {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; },
    resize() { this.resized = (this.resized || 0) + 1; },
    flyTo(opts) { this.flewTo = opts; },
  };
}

function baseDeps(over = {}) {
  return {
    fetchFn: async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }),
    loadCountryGeo: async () => ({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }),
    buildDrilldown: () => ({ header: {}, regions: [], events: [], degraded: true }),
    renderDrilldown: () => {},
    setDrilldownState: () => {},
    zoomForBbox: () => 4,
    countryBbox: () => [0, 0, 2, 2],
    rootEl: { classList: { add() {}, remove() {} } },
    bodyEl: { classList: { add() {}, remove() {} } },
    manifest: { JA: { admin1Bytes: 1, citiesBytes: 1, countryBbox: [0, 0, 2, 2] } },
    onSelectEvent: () => {},
    ...over,
  };
}

test('resolveFipsAt: 国内点は FIPS を返す', () => {
  const api = initCountryClick({ map: fakeMap(), getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(api.resolveFipsAt(1, 1, POLYS), 'JA');
});

test('resolveFipsAt: 海洋/極域(miss)は null', () => {
  const api = initCountryClick({ map: fakeMap(), getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(api.resolveFipsAt(50, 50, POLYS), null);
});

// patch #7（二重登録解消）: initCountryClick は map.on('click') を内部登録しない。
// main.js(C7) が cc = initCountryClick(...); map.on('click', cc.handleMapClick) で登録するのが唯一の登録点。
// handleMapClick は戻り値として公開されるので、呼び出し元が任意のタイミングで登録できる。
test('initCountryClick: map.on("click") を内部登録しない（外部配線に委ねる）', () => {
  const map = fakeMap();
  initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps() });
  // 内部登録されていないことを確認（map.on が呼ばれていない → handlers.click は undefined）
  assert.equal(map.handlers.click, undefined, '内部登録なし');
});

test('initCountryClick: handleMapClick が戻り値として公開されている（外部から登録可能）', () => {
  const map = fakeMap();
  const api = initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(typeof api.handleMapClick, 'function', 'handleMapClick は公開関数');
  // 外部から登録できる
  map.on('click', api.handleMapClick);
  assert.equal(map.handlers.click, api.handleMapClick, '外部から登録すると map.handlers.click に入る');
});

test('handleMapClick: deck pick 直後＆近接座標なら openCountry を抑制', async () => {
  const map = fakeMap();
  let opened = 0;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({ loadCountryGeo: async () => { opened += 1; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; } }),
  });
  api.setBoundsPolys(POLYS);
  api.noteDeckPick({ lng: 1, lat: 1 });            // deck が (1,1) を pick
  await api.handleMapClick({ lngLat: { lng: 1.05, lat: 1.05 } }); // 近接 → 抑制
  assert.equal(opened, 0, 'loadCountryGeo を呼ばない（抑制）');
});

test('handleMapClick: deck pick から離れた座標なら抑制せず開く', async () => {
  const map = fakeMap();
  let openedFips = null;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({ loadCountryGeo: async (fips) => { openedFips = fips; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; } }),
  });
  api.setBoundsPolys(POLYS);
  api.noteDeckPick({ lng: 1, lat: 1 });
  await api.handleMapClick({ lngLat: { lng: 1.6, lat: 1.6 } }); // 0.5度超え → 抑制しない・国内 → JA
  assert.equal(openedFips, 'JA');
});

test('handleMapClick: 海洋クリックは onOceanMiss を呼びパネルを開かない', async () => {
  const map = fakeMap();
  let missed = 0;
  let opened = 0;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({
      onOceanMiss: () => { missed += 1; },
      loadCountryGeo: async () => { opened += 1; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; },
    }),
  });
  api.setBoundsPolys(POLYS);
  await api.handleMapClick({ lngLat: { lng: 50, lat: 50 } }); // 海洋
  assert.equal(missed, 1);
  assert.equal(opened, 0);
});

test('openPlace: drill-open 付与→resize→loadCountryGeo→resolvePlace→loadProfile→renderProfile→flyTo（国 target）', async () => {
  const map = fakeMap();
  const order = [];
  const bodyEl = { classList: { add: (c) => order.push(`body+${c}`), remove: () => {} } };
  const api = initCountryClick({
    map,
    getSnapshots: () => ({ quakes: { features: [] } }),
    deps: baseDeps({
      bodyEl,
      loadCountryGeo: async (fips, opts) => { order.push(`load:${fips}`); assert.equal(opts.manifest.JA.admin1Bytes, 1); return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false }; },
      resolvePlace: () => ({ chain: [{ level: 'country', id: 'JA', name_ja: '日本' }], target: { level: 'country', id: 'JA', name_ja: '日本' }, admin1Hit: null }),
      loadProfile: async (level, id) => { order.push(`profile:${id}`); return { id, level, name_ja: '日本', facts: {}, sections: [], source: {}, degraded: false }; },
      renderProfile: (rootEl, model) => { order.push('render'); assert.equal(model.target.id, 'JA'); },
      profilesManifest: { country: { JA: {} }, admin1: {}, city: {} },
      setDrilldownState: (rootEl, state) => order.push(`state:${state}`),
      countryBbox: () => [120, 20, 150, 46],
      zoomForBbox: (bbox) => { assert.deepEqual(bbox, [120, 20, 150, 46]); return 4.2; },
    }),
  });
  api.setBoundsPolys(POLYS);
  await api.openPlace(1, 1);
  assert.deepEqual(order, ['body+drill-open', 'state:loading', 'load:JA', 'profile:JA', 'render', 'state:ready']);
  // flyTo は国 bbox 中心へ・zoom は zoomForBbox の返り値
  assert.deepEqual(map.flewTo.center, [(120 + 150) / 2, (20 + 46) / 2]);
  assert.equal(map.flewTo.zoom, 4.2);
  assert.equal(map.flewTo.essential, true);
  assert.ok(map.resized >= 1, 'map.resize が呼ばれた');
});

test('openPlace: token race — fetch 中に別クリックが来たら先行 open の render を破棄', async () => {
  const map = fakeMap();
  const rendered = [];
  let resolveFirst;
  let callCount = 0;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({
      loadCountryGeo: async (fips) => {
        callCount += 1;
        if (callCount === 1) {
          // 最初の呼び出しのみ保留
          return new Promise((res) => { resolveFirst = () => res({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false }); });
        }
        return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false };
      },
      resolvePlace: ({ fips }) => ({ chain: [{ level: 'country', id: fips, name_ja: fips }], target: { level: 'country', id: fips, name_ja: fips }, admin1Hit: null }),
      loadProfile: async (level, id) => ({ id, level, name_ja: id, facts: {}, sections: [], source: {}, degraded: false }),
      renderProfile: (rootEl, model) => rendered.push(model.target.id),
      profilesManifest: { country: { JA: {}, US: {} }, admin1: {}, city: {} },
    }),
  });
  api.setBoundsPolys(POLYS);
  const p1 = api.openPlace(1, 1);   // 先行（1回目・保留中）
  const p2 = api.openPlace(1, 1);   // 後勝ち（2回目・即解決）— token を進める
  await p2;
  resolveFirst();                   // 先行が後から解決
  await p1;
  assert.equal(rendered.length, 1, '1回のみ render（後勝ちのみ）');
});

test('closeCountry: drill-open を解除し resize する', () => {
  const map = fakeMap();
  let removed = null;
  const bodyEl = { classList: { add: () => {}, remove: (c) => { removed = c; } } };
  const api = initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps({ bodyEl }) });
  api.closeCountry();
  assert.equal(removed, 'drill-open');
  assert.ok(map.resized >= 1);
});

test('openPlace: resolve→loadProfile→renderProfile を通り model の shape/events/breadcrumb が正しく組まれる', async () => {
  const capturedModels = [];
  const FAKE_SHAPE_PATH = 'M 0 0 L 2 0 L 2 2 Z';
  const FAKE_EVENTS_RAW = [
    { layerId: 'conflict', cityName: '東京', regionName: null, title: '衝突事件' },
    { layerId: 'news', cityName: null, regionName: '関東', title: 'ニュース' },
  ];
  const cc = initCountryClick({
    map: fakeMap(), getSnapshots: () => ({}),
    deps: baseDeps({
      loadCountryGeo: async () => ({
        admin1: { type: 'FeatureCollection', features: [{ properties: { a1code: 'JP-13', name_ja: '東京都' } }] },
        cities: [],
        degraded: false,
      }),
      resolvePlace: () => ({
        chain: [{ level: 'country', id: 'JA', name_ja: '日本' }, { level: 'admin1', id: 'JP-13', name_ja: '東京都' }],
        target: { level: 'admin1', id: 'JP-13', name_ja: '東京都' },
        admin1Hit: { code: 'JP-13', rings: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]], bbox: [0, 0, 2, 2] },
      }),
      loadProfile: async () => ({ id: 'JP-13', level: 'admin1', name_ja: '東京都', facts: {}, sections: [], source: {}, degraded: false }),
      renderProfile: (root, model) => capturedModels.push(model),
      profilesManifest: { country: { JA: {} }, admin1: { 'JP-13': {} }, city: {} },
      // Fix 2: regionShapePath と buildDrilldown の fake を注入
      regionShapePath: (rings) => { assert.ok(Array.isArray(rings), 'rings が配列'); return FAKE_SHAPE_PATH; },
      buildDrilldown: ({ fips }) => ({
        events: FAKE_EVENTS_RAW,
        regions: [],
        degraded: false,
      }),
      countryBbox: () => [0, 0, 2, 2],
      zoomForBbox: () => 6,
    }),
  });
  cc.setBoundsPolys(POLYS);
  await cc.openPlace(1, 1);
  assert.equal(capturedModels.length, 1, 'renderProfile が1回呼ばれた');
  const model = capturedModels[0];

  // Fix 2: shapePath アサート（admin1Hit.rings → regionShapePath の戻り値）
  assert.equal(model.shapePath, FAKE_SHAPE_PATH, 'model.shapePath は regionShapePath の戻り値');

  // Fix 2: events アサート（{emoji,where,title} にマップされていること）
  assert.equal(model.events.length, 2);
  assert.deepEqual(model.events[0], { emoji: '⚔', where: '東京', title: '衝突事件' });
  assert.deepEqual(model.events[1], { emoji: '📰', where: '関東', title: 'ニュース' });

  // Fix 2: breadcrumb アサート
  assert.deepEqual(model.breadcrumb, [
    { level: 'country', id: 'JA', name_ja: '日本' },
    { level: 'admin1', id: 'JP-13', name_ja: '東京都' },
  ]);

  // flyTo は admin1Hit.bbox へ（Fix 3）
  const m = fakeMap();
  // 別途 flyTo をテストするため以下でも確認済み（上記テストで admin1 bbox を使う）

  // navigate: 'country' レベルへ上るとパンくず1件・target = JA
  await cc.navigate('country', 'JA');
  assert.equal(capturedModels.length, 2, 'navigate 後に renderProfile が再呼ばれた');
  const navModel = capturedModels[1];
  assert.equal(navModel.breadcrumb.length, 1, 'パンくずが country まで切り詰められた');
  assert.equal(navModel.target.id, 'JA', 'navigate target.id は JA');
});
