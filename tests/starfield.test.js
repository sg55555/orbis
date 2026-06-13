import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStars } from '../js/lib/starfield.js';

// 決定的 RNG（線形合同法）でテストを再現可能に
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

test('generateStars: 指定個数を返す', () => {
  assert.equal(generateStars(50, 800, 600, seeded(1)).length, 50);
});

test('generateStars: 全ての星が画面範囲内', () => {
  for (const st of generateStars(200, 800, 600, seeded(2))) {
    assert.ok(st.x >= 0 && st.x <= 800);
    assert.ok(st.y >= 0 && st.y <= 600);
    assert.ok(st.r > 0);
    assert.ok(st.alpha > 0 && st.alpha <= 1);
  }
});

test('generateStars: 同一 seed は同一結果（再乱数しない設計の担保）', () => {
  const a = generateStars(10, 100, 100, seeded(7));
  const b = generateStars(10, 100, 100, seeded(7));
  assert.deepEqual(a, b);
});
