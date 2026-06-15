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

import { tempAt } from '../js/layers/airtemp.js';

const SNAP = {
  grid: { lat0: 0, lon0: 0, latStep: 10, lonStep: 10, nLat: 2, nLon: 2 },
  // row-major: (0,0)=10, (0,10)=20, (10,0)=null, (10,10)=40
  temps: [10, 20, null, 40],
};

test('tempAt: 最寄りグリッド値を返す', () => {
  assert.equal(tempAt(SNAP, 1, 1), 10);    // (0,0) に最寄り
  assert.equal(tempAt(SNAP, 1, 9), 20);    // (0,10) に最寄り
  assert.equal(tempAt(SNAP, 9, 9), 40);    // (10,10) に最寄り
});

test('tempAt: null セルは null', () => {
  assert.equal(tempAt(SNAP, 9, 1), null);  // (10,0)=null
});

test('tempAt: グリッド外は null', () => {
  assert.equal(tempAt(SNAP, 200, 200), null);
  assert.equal(tempAt(null, 0, 0), null);
});

import { buildTempField } from '../js/layers/airtemp.js';

const FULL = {
  grid: { lat0: -45, lon0: -90, latStep: 90, lonStep: 90, nLat: 2, nLon: 3 },
  temps: [-40, 0, 40, -40, 0, 40], // 全セル有効
};

test('buildTempField: w*h*4 の Uint8ClampedArray を返し、有効領域は alpha=255', () => {
  const w = 6, h = 4;
  const px = buildTempField(FULL, w, h);
  assert.ok(px instanceof Uint8ClampedArray);
  assert.equal(px.length, w * h * 4);
  // 中央付近のピクセルは不透明
  const mid = ((Math.floor(h / 2) * w) + Math.floor(w / 2)) * 4;
  assert.equal(px[mid + 3], 255);
});

test('buildTempField: 全 null セルは透明(alpha=0)', () => {
  const empty = { grid: FULL.grid, temps: [null, null, null, null, null, null] };
  const px = buildTempField(empty, 4, 2);
  for (let i = 0; i < px.length; i += 4) assert.equal(px[i + 3], 0);
});

import { airtempLayer } from '../js/layers/airtemp.js';

test('airtempLayer: id/label/marker/legend/feed のメタを持つ', () => {
  assert.equal(airtempLayer.id, 'airtemp');
  assert.equal(airtempLayer.label, '気温');
  assert.equal(airtempLayer.marker, 'gradient');
  assert.ok(Array.isArray(airtempLayer.legend) && airtempLayer.legend.length >= 2);
  assert.deepEqual(airtempLayer.toFeedItems(), []);   // フィードには出さない
  assert.equal(airtempLayer.tooltip(), null);         // tooltip は main.js が座標から生成
});

test('airtempLayer.toDeckLayer: grid 無しスナップショットは空配列', () => {
  assert.deepEqual(airtempLayer.toDeckLayer({}), []);
});
