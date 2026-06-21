import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooltipFor } from '../js/layers/registry.js';

test('quakes tooltip: ラベル付き（日本語震源）', () => {
  assert.equal(tooltipFor('quakes', { mag: 3.6, place: 'Alaska' }), '地震 規模M3.6｜震源 アラスカ州（アメリカ）');
});
test('flights tooltip: 便名/高度/速度ラベル（空中）', () => {
  assert.equal(tooltipFor('flights', { callsign: 'RTY484 ', alt: 1821.18, velocity: 56.83, on_ground: false }),
    '便名 RTY484｜高度 1821m｜速度 57m/s');
});
test('flights tooltip: 地上', () => {
  assert.equal(tooltipFor('flights', { callsign: 'AIC1TA', alt: null, velocity: 7.46, on_ground: true }),
    '便名 AIC1TA｜高度 地上｜速度 7m/s');
});
test('conflict/protests tooltip: 報道集中＋日本語国名', () => {
  assert.equal(tooltipFor('conflict', { place: 'FR', url: 'https://www.dailymail.com/x' }), '紛争 報道集中｜フランス（FR）｜出典 dailymail.com');
  assert.equal(tooltipFor('protests', { place: 'US', url: 'https://www.sacurrent.com/x' }), '抗議 報道集中｜アメリカ（US）｜出典 sacurrent.com');
});
test('trade tooltip: 要衝/航路の日本語名＋説明', () => {
  assert.equal(tooltipFor('trade-chokepoints', { geometry: { type: 'Point' }, properties: { name: 'chokepoint', label: 'Suez' } }), '海上要衝 スエズ運河（Suez）｜海運の要所');
  assert.equal(tooltipFor('trade-routes', { geometry: { type: 'LineString' }, properties: { name: 'Trans-Pacific' } }), '主要航路 太平洋横断（アジア⇄北米）｜海上輸送ルート');
});
test('tooltipFor: null/未知は null', () => {
  assert.equal(tooltipFor('quakes', null), null);
  assert.equal(tooltipFor('ghost', {}), null);
});
