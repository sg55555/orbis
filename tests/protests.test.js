import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProtestsConfig } from '../js/layers/protests.js';

const SNAP = { layer: 'protests', points: [{ id: '1', lon: -0.1, lat: 51.5, mentions: 0, place: 'London' }] };

test('buildProtestsConfig builds green scatter', () => {
  const cfg = buildProtestsConfig(SNAP);
  assert.equal(cfg.id, 'protests');
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [-0.1, 51.5]);
  assert.equal(cfg.getRadius(p), 5);
  assert.deepEqual(cfg.getFillColor(p), [94, 255, 166, 200]);
});

test('empty tolerated', () => {
  assert.deepEqual(buildProtestsConfig({ points: [] }).data, []);
});
