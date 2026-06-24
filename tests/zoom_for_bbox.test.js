import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomForBbox, bboxCenter } from '../js/lib/zoom_for_bbox.js';

test('bboxCenter: 通常 bbox は素朴中点', () => {
  assert.deepEqual(bboxCenter([122, 24, 154, 46]), [138, 35]);
});

test('bboxCenter: 日付変更線跨ぎ(e<w) は折返し幅の中点を [-180,180] に正規化', () => {
  // NZ 型: w=166, e=-176.17（折返し）。実幅 17.83 の中点 = 166+8.915 = 174.915°E。
  const [lng, lat] = bboxCenter([166, -47, -176.17, -34]);
  assert.ok(Math.abs(lng - 174.915) < 1e-6, `lng=${lng}（NZ 中心は約 175°E）`);
  assert.equal(lat, -40.5);
  assert.ok(lng >= -180 && lng <= 180, '正規化済');
});

test('bboxCenter: w<-180 形(単一跨ぎ feature)も [-180,180] に正規化', () => {
  // Fiji 型: [-183,-178] → 中点 -180.5 → +360 → 179.5°E。
  const [lng] = bboxCenter([-183, -19, -178, -12]);
  assert.ok(Math.abs(lng - 179.5) < 1e-6, `lng=${lng}（Fiji 中心は約 179.5°E）`);
});

test('bboxCenter: 不正 bbox は [0,0]', () => {
  assert.deepEqual(bboxCenter(null), [0, 0]);
  assert.deepEqual(bboxCenter([1, 2, 3]), [0, 0]);
  assert.deepEqual(bboxCenter([1, 2, NaN, 4]), [0, 0]);
});

test('zoomForBbox: 戻り値は [minZoom, maxZoom] 内', () => {
  const z = zoomForBbox([0, 0, 10, 10]);
  assert.ok(z >= 2.5 && z <= 6, `z=${z} は既定 clamp 範囲内`);
});

test('zoomForBbox: span が大きいほど zoom は小さい（単調減少）', () => {
  const small = zoomForBbox([0, 0, 2, 2]);
  const mid = zoomForBbox([0, 0, 8, 8]);
  const big = zoomForBbox([0, 0, 30, 30]);
  assert.ok(small >= mid, `small(${small}) >= mid(${mid})`);
  assert.ok(mid >= big, `mid(${mid}) >= big(${big})`);
});

test('zoomForBbox: 極小国は maxZoom にクランプ', () => {
  // 0.05 度四方の極小 bbox → 上限 6 に張り付く
  const z = zoomForBbox([0, 0, 0.05, 0.05]);
  assert.equal(z, 6);
});

test('zoomForBbox: 巨大国（ロシア級 span）は minZoom にクランプ', () => {
  // 経度 320 度 span 級の極端 bbox（赤道付近で cosLat 補正最小）→ 下限 2.5 に張り付く
  const z = zoomForBbox([-160, -5, 160, 5]);
  assert.equal(z, 2.5);
});

test('zoomForBbox: lat span が lon span より大きい国は lat 主導', () => {
  // 縦長 bbox（lat span 40 > lon span 5）。lat 主導で広く引く。
  const tall = zoomForBbox([0, 0, 5, 40]);
  // 同じ最大 span を持つ横長 bbox と概ね同等の zoom
  const wide = zoomForBbox([0, 0, 40, 5]);
  // どちらも minZoom 近辺。差は cosLat 補正分のみ。tall/wide とも下限近く。
  assert.ok(tall <= 4 && wide <= 4, `tall=${tall} wide=${wide} 共に広め`);
});

test('zoomForBbox: アンチメリディアン折返し(w>e)は実 span を 360-差で取り過剰ズームアウトしない', () => {
  // フィジー級: w=177, e=-178（折返し）。実 span = (-178+360)-177 = 5 度。
  const wrapped = zoomForBbox([177, -18, -178, -16]);
  // もし w>e を素直に e-w=-355 や |−355| として扱うと巨大 span 誤認 → minZoom。
  // 実 span 5 度（lat span 2 度）相当として小さめ span → 高め zoom になるはず。
  const equiv = zoomForBbox([0, -18, 5, -16]);
  assert.ok(Math.abs(wrapped - equiv) < 1e-6, `wrapped=${wrapped} は実 span 等価 equiv=${equiv} と一致`);
  assert.ok(wrapped > 2.5, '過剰ズームアウト(minZoom 張り付き)しない');
});

test('zoomForBbox: pad を大きくすると zoom は同じか小さくなる（余白増）', () => {
  const tight = zoomForBbox([0, 0, 10, 10], { pad: 1.0 });
  const loose = zoomForBbox([0, 0, 10, 10], { pad: 1.6 });
  assert.ok(loose <= tight, `pad 大の loose(${loose}) <= tight(${tight})`);
});

test('zoomForBbox: minZoom/maxZoom を上書きできる', () => {
  const z = zoomForBbox([0, 0, 0.01, 0.01], { maxZoom: 9 });
  assert.equal(z, 9);
  const z2 = zoomForBbox([-160, -5, 160, 5], { minZoom: 1 });
  assert.equal(z2, 1);
});

test('zoomForBbox: 不正 bbox（非配列・要素数不足・NaN）は安全側で minZoom', () => {
  assert.equal(zoomForBbox(null), 2.5);
  assert.equal(zoomForBbox([0, 0, 10]), 2.5);
  assert.equal(zoomForBbox([0, 0, NaN, 10]), 2.5);
  assert.equal(zoomForBbox('x'), 2.5);
});

test('zoomForBbox: degLenForZoom 整合（同 span は決定的に同値）', () => {
  const a = zoomForBbox([0, 0, 12, 9]);
  const b = zoomForBbox([0, 0, 12, 9]);
  assert.equal(a, b);
  assert.ok(Number.isFinite(a));
});
