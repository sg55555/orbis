import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempToColor } from '../js/layers/airtemp.js';

test('tempToColor: 各成分が 0..255 の整数3要素を返す', () => {
  const c = tempToColor(15);
  assert.equal(c.length, 3);
  c.forEach((v) => { assert.ok(Number.isInteger(v) && v >= 0 && v <= 255); });
});

test('tempToColor: 寒い(-40)は青寄り・暑い(40)は赤寄り', () => {
  const cold = tempToColor(-40);
  const hot = tempToColor(40);
  assert.ok(cold[2] > cold[0]);  // 青 > 赤
  assert.ok(hot[0] > hot[2]);    // 赤 > 青
});

test('tempToColor: レンジ外はクランプ（-100 は -40 と同じ、100 は 40 と同じ）', () => {
  assert.deepEqual(tempToColor(-100), tempToColor(-40));
  assert.deepEqual(tempToColor(100), tempToColor(40));
});
