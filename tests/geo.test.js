import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeToRadius, magnitudeToColor, formatFreshness } from '../js/lib/geo.js';

test('magnitudeToRadius is floored at 3 and grows with magnitude', () => {
  assert.equal(magnitudeToRadius(0), 3);
  assert.equal(magnitudeToRadius(1), 3);
  assert.equal(magnitudeToRadius(5), 18); // round(5^1.8)=18
});

test('magnitudeToColor maps to aurora palette bands', () => {
  assert.deepEqual(magnitudeToColor(1), [57, 208, 255]);   // < 2 cyan
  assert.deepEqual(magnitudeToColor(3), [94, 255, 166]);   // 2-4 green
  assert.deepEqual(magnitudeToColor(5), [255, 176, 40]);   // 4-6 amber
  assert.deepEqual(magnitudeToColor(7), [255, 60, 80]);    // >=6 red
  assert.deepEqual(magnitudeToColor(6), [255, 60, 80]);    // 境界6は赤
});

test('formatFreshness renders Japanese relative time', () => {
  const now = Date.parse('2026-06-13T12:00:00Z');
  assert.equal(formatFreshness('2026-06-13T11:59:30Z', now), 'たった今');
  assert.equal(formatFreshness('2026-06-13T11:57:00Z', now), '3分前');
  assert.equal(formatFreshness('2026-06-13T10:00:00Z', now), '2時間前');
});
