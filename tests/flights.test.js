import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIconConfig } from '../js/layers/flights.js';

const SNAP = { layer: 'flights', points: [{ icao24: 'a', callsign: 'ANA1', lon: 139.7, lat: 35.6, heading: 90 }] };

test('buildIconConfig builds zoom-aware rotated icon props', () => {
  const cfg = buildIconConfig(SNAP);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.sizeUnits, 'meters');
  assert.ok(cfg.sizeMinPixels >= 3 && cfg.sizeMaxPixels <= 40);
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [139.7, 35.6]);
  assert.equal(cfg.getAngle(p), 270);
  assert.deepEqual(cfg.getColor(p), [57, 208, 255, 220]);
});

test('buildIconConfig tolerates empty', () => {
  assert.deepEqual(buildIconConfig({ points: [] }).data, []);
});
