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
