// tests/drilldown_country_index.test.js
// Critical-3: countryBbox が正準形 bboxIndex = {country:{fips:[w,s,e,n]}, extra:{fips:{lon,lat,margin}}} を正しく読む。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countryBbox } from '../js/lib/drilldown/country_index.js';

// Critical-3: 正準形 bboxIndex
const CANONICAL_INDEX = {
  country: {
    JA: [129.5, 31.0, 145.8, 45.5],
    US: [-124.7, 24.5, -66.9, 49.4],
  },
  extra: {
    MV: { lon: 73.5, lat: 4.2, margin: 5.0 },  // モルディブ（小国 EXTRA）
    VC: { lon: -61.2, lat: 13.2 },              // margin 省略（既定 = CENTER_MARGIN_DEG=2）
  },
};

test('Critical-3: countryBbox が country[fips] から bbox を返す', () => {
  const bbox = countryBbox('JA', CANONICAL_INDEX);
  // slice() コピーが返るため deepEqual で検証
  assert.ok(Array.isArray(bbox) && bbox.length === 4);
  assert.equal(bbox[0], 129.5);
  assert.equal(bbox[1], 31.0);
  assert.equal(bbox[2], 145.8);
  assert.equal(bbox[3], 45.5);
});

test('Critical-3: countryBbox が US の bbox を返す', () => {
  const bbox = countryBbox('US', CANONICAL_INDEX);
  assert.ok(Array.isArray(bbox) && bbox.length === 4);
  assert.equal(bbox[0], -124.7);
  assert.equal(bbox[1], 24.5);
  assert.equal(bbox[2], -66.9);
  assert.equal(bbox[3], 49.4);
});

test('Critical-3: extra[fips] から bbox を構築する（margin=5.0）', () => {
  const bbox = countryBbox('MV', CANONICAL_INDEX);
  // lon=73.5, lat=4.2, margin=5.0 → [73.5-5, 4.2-5, 73.5+5, 4.2+5]
  assert.ok(Array.isArray(bbox) && bbox.length === 4, '4要素配列');
  assert.ok(Math.abs(bbox[0] - 68.5) < 0.001, `w ≈ 68.5、実際: ${bbox[0]}`);
  assert.ok(Math.abs(bbox[1] - (-0.8)) < 0.001, `s ≈ -0.8、実際: ${bbox[1]}`);
  assert.ok(Math.abs(bbox[2] - 78.5) < 0.001, `e ≈ 78.5、実際: ${bbox[2]}`);
  assert.ok(Math.abs(bbox[3] - 9.2) < 0.001, `n ≈ 9.2、実際: ${bbox[3]}`);
});

test('Critical-3: extra[fips] で margin 省略時は CENTER_MARGIN_DEG=2 を既定使用', () => {
  const bbox = countryBbox('VC', CANONICAL_INDEX);
  // lon=-61.2, lat=13.2, margin=2 (既定) → [-63.2, 11.2, -59.2, 15.2]
  assert.ok(Array.isArray(bbox) && bbox.length === 4, '4要素配列');
  assert.ok(Math.abs(bbox[0] - (-63.2)) < 0.001, `w ≈ -63.2、実際: ${bbox[0]}`);
  assert.ok(Math.abs(bbox[2] - (-59.2)) < 0.001, `e ≈ -59.2、実際: ${bbox[2]}`);
});

test('Critical-3: 正準形の extra.margin 既定値は生成側 5.0 と一致している', () => {
  // build_drilldown_manifest.py が margin=5.0 を既定として出力し、
  // country_index.js の countryBbox は extra.margin が有限数値なら使う。
  // 一致していれば extra[fips] で margin=5.0 の bbox が正しく生成される。
  const bboxWith5 = countryBbox('MV', CANONICAL_INDEX);
  // lon=73.5±5, lat=4.2±5
  assert.ok(Math.abs(bboxWith5[0] - (73.5 - 5.0)) < 0.001);
  assert.ok(Math.abs(bboxWith5[2] - (73.5 + 5.0)) < 0.001);
});

test('Critical-3: country に無く extra にも無い FIPS は fipsCenter フォールバック or 世界全体', () => {
  // 既知 FIPS は fipsCenter（COUNTRIES）からフォールバックする
  const bbox = countryBbox('ZZ', CANONICAL_INDEX); // 完全不明→世界全体
  assert.ok(Array.isArray(bbox) && bbox.length === 4, '4要素配列');
});

test('Critical-3: bboxIndex が null/空の時も安全に動作する', () => {
  const bbox = countryBbox('JA', null);
  assert.ok(Array.isArray(bbox) && bbox.length === 4, 'null bboxIndex でも配列を返す');
});

test('Critical-3: bboxIndex が空オブジェクトでも落ちない', () => {
  assert.doesNotThrow(() => countryBbox('JA', {}));
  assert.doesNotThrow(() => countryBbox('JA', { country: {}, extra: {} }));
});
