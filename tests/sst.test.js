import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sstToColor, sstAt, buildSstField, sstLayer } from '../js/layers/sst.js';

test('sstToColor: 各成分が 0..255 の整数3要素を返す', () => {
  const c = sstToColor(15);
  assert.equal(c.length, 3);
  c.forEach((v) => { assert.ok(Number.isInteger(v) && v >= 0 && v <= 255); });
});

test('sstToColor: 冷たい(-2)は青寄り・暖かい(32)は赤寄り', () => {
  const cold = sstToColor(-2);
  const warm = sstToColor(32);
  assert.ok(cold[2] > cold[0]);  // 青 > 赤
  assert.ok(warm[0] > warm[2]);  // 赤 > 青
});

test('sstToColor: レンジ外はクランプ（-50 は -2 と同じ、100 は 32 と同じ）', () => {
  assert.deepEqual(sstToColor(-50), sstToColor(-2));
  assert.deepEqual(sstToColor(100), sstToColor(32));
});

const SNAP = {
  grid: { lat0: 0, lon0: 0, latStep: 10, lonStep: 10, nLat: 2, nLon: 2 },
  // row-major: (0,0)=10, (0,10)=20, (10,0)=null(陸), (10,10)=28
  temps: [10, 20, null, 28],
};

test('sstAt: 最寄りグリッド値を返す', () => {
  assert.equal(sstAt(SNAP, 1, 1), 10);
  assert.equal(sstAt(SNAP, 1, 9), 20);
  assert.equal(sstAt(SNAP, 9, 9), 28);
});

test('sstAt: 陸(null)セルは null / グリッド外は null / snapshot無しは null', () => {
  assert.equal(sstAt(SNAP, 9, 1), null);
  assert.equal(sstAt(SNAP, 200, 200), null);
  assert.equal(sstAt(null, 0, 0), null);
});

const FULL = {
  grid: { lat0: -45, lon0: -90, latStep: 90, lonStep: 90, nLat: 2, nLon: 3 },
  temps: [-2, 15, 32, -2, 15, 32],
};

test('buildSstField: w*h*4 の Uint8ClampedArray を返し、有効領域は alpha=255', () => {
  const w = 6, h = 4;
  const px = buildSstField(FULL, w, h);
  assert.ok(px instanceof Uint8ClampedArray);
  assert.equal(px.length, w * h * 4);
  const mid = ((Math.floor(h / 2) * w) + Math.floor(w / 2)) * 4;
  assert.equal(px[mid + 3], 255);
});

test('buildSstField: 全 null(陸)セルは透明(alpha=0)', () => {
  const empty = { grid: FULL.grid, temps: [null, null, null, null, null, null] };
  const px = buildSstField(empty, 4, 2);
  for (let i = 0; i < px.length; i += 4) assert.equal(px[i + 3], 0);
});

test('sstLayer: id/label/marker/legend/feed のメタを持つ', () => {
  assert.equal(sstLayer.id, 'sst');
  assert.equal(sstLayer.label, '水温');
  assert.equal(sstLayer.marker, 'gradient');
  assert.ok(Array.isArray(sstLayer.legend) && sstLayer.legend.length >= 2);
  assert.deepEqual(sstLayer.toFeedItems(), []);
  assert.equal(sstLayer.tooltip(), null);
});

test('sstLayer.toDeckLayer: grid 無しスナップショットは空配列', () => {
  assert.deepEqual(sstLayer.toDeckLayer({}), []);
});
