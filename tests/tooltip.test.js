import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooltipFor } from '../js/layers/registry.js';

test('quakes tooltip: ラベル付き', () => {
  assert.equal(tooltipFor('quakes', { mag: 3.6, place: 'Alaska' }), '地震 M3.6｜Alaska');
});
test('flights tooltip: 便名/高度/速度ラベル（空中）', () => {
  assert.equal(tooltipFor('flights', { callsign: 'RTY484 ', alt: 1821.18, velocity: 56.83, on_ground: false }),
    '便名 RTY484｜高度 1821m｜速度 57m/s');
});
test('flights tooltip: 地上', () => {
  assert.equal(tooltipFor('flights', { callsign: 'AIC1TA', alt: null, velocity: 7.46, on_ground: true }),
    '便名 AIC1TA｜高度 地上｜速度 7m/s');
});
test('conflict/protests tooltip: ラベル付き', () => {
  assert.equal(tooltipFor('conflict', { place: 'FR', url: 'https://www.dailymail.com/x' }), '紛争｜FR｜出典 dailymail.com');
  assert.equal(tooltipFor('protests', { place: 'US', url: 'https://www.sacurrent.com/x' }), '抗議｜US｜出典 sacurrent.com');
});
test('trade tooltip: 要衝/航路ラベル', () => {
  assert.equal(tooltipFor('trade-chokepoints', { properties: { name: 'Suez Canal' } }), '要衝 Suez Canal');
  assert.equal(tooltipFor('trade-routes', { geometry: { type: 'LineString' }, properties: { name: 'Trans-Pacific' } }), '航路 Trans-Pacific');
});
test('tooltipFor: null/未知は null', () => {
  assert.equal(tooltipFor('quakes', null), null);
  assert.equal(tooltipFor('ghost', {}), null);
});
