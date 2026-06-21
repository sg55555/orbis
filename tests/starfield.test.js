import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStars, starCount } from '../js/lib/starfield.js';

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

test('starCount: off は現状の上限600・面積比例', () => {
  // 4K(3840x2160=8,294,400)*0.00018=1493 → off cap 600 で頭打ち
  assert.equal(starCount(3840, 2160, 'off'), 600);
  // FHD(1920x1080=2,073,600)*0.00018=373 → cap 未満で面積比例値
  assert.equal(starCount(1920, 1080, 'off'), Math.round(2073600 * 0.00018));
});

test('starCount: level で 4K の上限が段階的に上がる（760/900/1100）', () => {
  assert.equal(starCount(3840, 2160, '1'), 760);
  assert.equal(starCount(3840, 2160, '2'), 900);
  assert.equal(starCount(3840, 2160, '3'), 1100);
});

test('starCount: FHD/HD は上限未満なので level によらず不変（面積比例値）', () => {
  const fhd = Math.round(1920 * 1080 * 0.00018); // 373
  assert.equal(starCount(1920, 1080, '1'), fhd);
  assert.equal(starCount(1920, 1080, '3'), fhd);
  assert.equal(starCount(1920, 1080, 'off'), fhd);
});

test('starCount: 不正 level は off 扱い', () => {
  assert.equal(starCount(3840, 2160, 'zzz'), 600);
});
