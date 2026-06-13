import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconAngle, eventRadius } from '../js/lib/geo.js';

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
