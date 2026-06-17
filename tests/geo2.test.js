import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconAngle, eventRadius, degLenForZoom, projectedArrival, formatLatLon } from '../js/lib/geo.js';

test('formatLatLon: 北緯/南緯・東経/西経で符号を明示', () => {
  assert.equal(formatLatLon(10, -30), '北緯10° 西経30°');
  assert.equal(formatLatLon(-15, 120), '南緯15° 東経120°');
  assert.equal(formatLatLon(0, 0), '北緯0° 東経0°');
});

test('formatLatLon: 経度はラップを [-180,180) に正規化', () => {
  assert.equal(formatLatLon(0, 200), '北緯0° 西経160°');   // 200 → -160
  assert.equal(formatLatLon(0, -190), '北緯0° 東経170°');  // -190 → 170
});

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

test('projectedArrival: 東向きは経度が増える / 北向きは緯度が増える', () => {
  const e = projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 200 }, 10);
  assert.ok(e[0] > 0 && Math.abs(e[1]) < 1e-6);
  const n = projectedArrival({ lon: 0, lat: 0, heading: 0, velocity: 200 }, 10);
  assert.ok(n[1] > 0);
});

test('projectedArrival: velocity/heading 欠損や速度0は null', () => {
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 0 }, 10), null);
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: null, velocity: 200 }, 10), null);
  assert.equal(projectedArrival({ lon: 0, lat: 0, velocity: 200 }, 10), null);
});
