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

test('initCountryClick: map.on("click") を登録する', () => {
  const map = fakeMap();
  initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(typeof map.handlers.click, 'function');
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
