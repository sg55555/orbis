import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconAngle, eventRadius, degLenForZoom } from '../js/lib/geo.js';

test('iconAngle converts compass heading to deck CCW icon angle', () => {
  assert.equal(iconAngle(0), 0);
  assert.equal(iconAngle(90), 270);
  assert.equal(iconAngle(180), 180);
  assert.equal(iconAngle(360), 0);
  assert.equal(iconAngle(null), 0);
});

test('eventRadius grows with mentions and is clamped', () => {
  assert.equal(eventRadius(0), 5);
  assert.equal(eventRadius(undefined), 5);
  assert.equal(eventRadius(100), 15);
  assert.equal(eventRadius(10000), 18);
});

test('degLenForZoom: 正の度長を返し、ズームが大きいほど小さい', () => {
  const a = degLenForZoom(2);
  const b = degLenForZoom(5);
  assert.ok(a > 0 && b > 0);
  assert.ok(b < a, 'ズームインで度長は小さくなる');
});

test('degLenForZoom: targetPx に比例', () => {
  assert.ok(Math.abs(degLenForZoom(4, 20) - degLenForZoom(4, 10) * 2) < 1e-9);
});
