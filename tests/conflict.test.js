import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConflictConfig } from '../js/layers/conflict.js';

const SNAP = { layer: 'conflict', points: [{ id: '1', lon: 2.3, lat: 48.8, mentions: 100, place: 'Paris' }] };

test('buildConflictConfig builds red scatter with mention-based radius', () => {
  const cfg = buildConflictConfig(SNAP);
  assert.equal(cfg.id, 'conflict');
  assert.equal(cfg.radiusUnits, 'pixels');
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [2.3, 48.8]);
  assert.equal(cfg.getRadius(p), 15);
  assert.deepEqual(cfg.getFillColor(p), [255, 60, 80, 200]);
});

test('empty tolerated', () => {
  assert.deepEqual(buildConflictConfig({ points: [] }).data, []);
});
