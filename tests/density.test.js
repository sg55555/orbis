import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densityScale } from '../js/lib/geo.js';

test('densityScale: zoom<=z0 は min(0.22)', () => {
  assert.equal(densityScale(2.5), 0.22);
  assert.equal(densityScale(0), 0.22);
});
test('densityScale: zoom>=z1 は 1', () => {
  assert.equal(densityScale(5), 1);
  assert.equal(densityScale(9), 1);
});
test('densityScale: 中間は線形（中点3.75→0.5）', () => {
  assert.equal(densityScale(3.75), 0.5);
});
test('densityScale: 非数は 1（減衰なし＝安全側）', () => {
  assert.equal(densityScale(undefined), 1);
  assert.equal(densityScale(NaN), 1);
});
test('densityScale: opts で z0/z1/min を上書き', () => {
  assert.equal(densityScale(2, { z0: 2, z1: 6, min: 0.1 }), 0.1);
  assert.equal(densityScale(6, { z0: 2, z1: 6, min: 0.1 }), 1);
  assert.equal(densityScale(4, { z0: 2, z1: 6, min: 0.1 }), 0.5);
});
