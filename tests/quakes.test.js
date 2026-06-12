import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScatterConfig } from '../js/layers/quakes.js';

const SNAP = {
  layer: 'quakes', updated: '2026-06-13T12:00:00Z', count: 1,
  points: [{ id: 'a', lon: 139.7, lat: 35.6, depth: 30, mag: 5, place: 'Tokyo', time: 1, url: 'u' }],
};

test('buildScatterConfig produces deck-compatible props from a snapshot', () => {
  const cfg = buildScatterConfig(SNAP);
  assert.equal(cfg.id, 'quakes');
  assert.deepEqual(cfg.data, SNAP.points);
  assert.equal(cfg.radiusUnits, 'pixels');
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [139.7, 35.6]);
  assert.equal(cfg.getRadius(p), 18);             // round(5^1.8)
  assert.deepEqual(cfg.getFillColor(p), [255, 176, 40, 200]); // amber + alpha
});

test('buildScatterConfig tolerates empty snapshot', () => {
  const cfg = buildScatterConfig({ points: [] });
  assert.deepEqual(cfg.data, []);
});
