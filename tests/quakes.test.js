import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRingConfig } from '../js/layers/quakes.js';

test('buildRingConfig: 中空リング（stroked, filled:false）', () => {
  const cfg = buildRingConfig({ points: [{ lon: 1, lat: 2, mag: 5 }] });
  assert.equal(cfg.id, 'quakes');
  assert.equal(cfg.stroked, true);
  assert.equal(cfg.filled, false);
  assert.equal(cfg.pickable, true);
  assert.deepEqual(cfg.getPosition({ lon: 1, lat: 2 }), [1, 2]);
});

test('buildRingConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildRingConfig(null).data, []);
});
