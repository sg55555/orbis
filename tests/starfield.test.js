import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStars, starCount, generateDust, stepDust, dustCount } from '../js/lib/starfield.js';

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

test('generateStars: brightRatio=0 は全て bright:false（off の後方互換）', () => {
  const stars = generateStars(100, 800, 600, seeded(3), 0);
  assert.ok(stars.every((s) => s.bright === false));
});

test('generateStars: brightRatio=0 は既存レンジを保つ（r 0.4–1.5 / alpha 0.25–0.85）', () => {
  for (const s of generateStars(300, 800, 600, seeded(4), 0)) {
    assert.ok(s.r >= 0.4 && s.r <= 1.5);
    assert.ok(s.alpha >= 0.25 && s.alpha <= 0.85);
  }
});

test('generateStars: brightRatio>0 で一部が bright（大きく明るい）', () => {
  const stars = generateStars(500, 800, 600, seeded(5), 0.3);
  const bright = stars.filter((s) => s.bright);
  assert.ok(bright.length > 0, 'bright が存在する');
  for (const s of bright) {
    assert.ok(s.r >= 1.3 && s.r <= 2.2);       // bright は大きい
    assert.ok(s.alpha >= 0.75 && s.alpha <= 1.0); // bright は明るい
  }
});

test('dustCount: level 連動（off=0 / 1=18 / 2=32 / 3=48）', () => {
  assert.equal(dustCount('off'), 0);
  assert.equal(dustCount('1'), 18);
  assert.equal(dustCount('2'), 32);
  assert.equal(dustCount('3'), 48);
  assert.equal(dustCount('zzz'), 0);
});

test('generateDust: 指定個数・画面内・極淡 alpha・極小 r', () => {
  const dust = generateDust(40, 800, 600, seeded(11));
  assert.equal(dust.length, 40);
  for (const d of dust) {
    assert.ok(d.x >= 0 && d.x <= 800 && d.y >= 0 && d.y <= 600);
    assert.ok(d.r >= 0.3 && d.r <= 0.8);
    assert.ok(d.alpha >= 0.05 && d.alpha <= 0.18);
  }
});

test('stepDust: ドリフト後も画面内にラップされる', () => {
  const dust = generateDust(30, 100, 100, seeded(12));
  stepDust(dust, 10000, 100, 100); // 大きな dt でも
  for (const d of dust) {
    assert.ok(d.x >= 0 && d.x <= 100, 'x ラップ');
    assert.ok(d.y >= 0 && d.y <= 100, 'y ラップ');
  }
});
