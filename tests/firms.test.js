import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frpToRadius, frpToColor, nearestCountry, acqToMs, buildFireConfig,
} from '../js/layers/firms.js';

test('frpToRadius: √FRP を 3..24px にクランプ', () => {
  assert.equal(frpToRadius(0), 3);
  assert.ok(frpToRadius(100) > frpToRadius(25));
  assert.equal(frpToRadius(1e6), 24);
});

test('frpToColor: 弱=黄 / 中=橙 / 強=赤', () => {
  assert.deepEqual(frpToColor(10), [255, 214, 64]);
  assert.deepEqual(frpToColor(50), [255, 140, 32]);
  assert.deepEqual(frpToColor(500), [255, 64, 32]);
});

test('nearestCountry: 座標→最寄り国の日本語名', () => {
  assert.equal(nearestCountry(133.4, -24.9), 'オーストラリア'); // AS centroid 近傍
});

test('acqToMs: FIRMS の date/time を epoch ms(UTC) に', () => {
  assert.equal(acqToMs('2026-07-12', '0312'), Date.UTC(2026, 6, 12, 3, 12));
});

test('buildFireConfig: filled・暖色・半径∝FRP', () => {
  const cfg = buildFireConfig({ points: [{ lon: 1, lat: 2, frp: 50 }] });
  assert.equal(cfg.id, 'firms');
  assert.equal(cfg.filled, true);
  assert.equal(cfg.stroked, false);
  assert.deepEqual(cfg.getPosition(cfg.data[0]), [1, 2]);
  assert.deepEqual(cfg.getFillColor(cfg.data[0]).slice(0, 3), [255, 140, 32]);
  assert.ok(cfg.getRadius(cfg.data[0]) > 3);
});

test('buildFireConfig: 空 snapshot は data=[]', () => {
  assert.deepEqual(buildFireConfig(null).data, []);
});
