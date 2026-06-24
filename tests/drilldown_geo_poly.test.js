import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInRings } from '../js/lib/drilldown/geo_poly.js';

// 共有フィクスチャ: 単純な正方形 (0,0)-(10,10)。GeoJSON 規約どおり始点=終点で閉じる。
const SQUARE = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
];

// 穴あき: 外周 (0,0)-(10,10) の中に内周 (3,3)-(7,7) の穴。
const SQUARE_WITH_HOLE = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
];

// MultiPolygon を一つの rings 配列に flatten した形 (loadPolygons の出力形)。
// 左の四角 (0,0)-(4,4) と 右の四角 (6,0)-(10,4)。
const MULTI = [
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]],
];

test('pointInRings: 単純な正方形の内部は true', () => {
  assert.equal(pointInRings(5, 5, SQUARE), true);
});

test('pointInRings: 単純な正方形の外部は false', () => {
  assert.equal(pointInRings(15, 5, SQUARE), false);
  assert.equal(pointInRings(-1, 5, SQUARE), false);
  assert.equal(pointInRings(5, 20, SQUARE), false);
});

test('pointInRings: 穴の内部は false（even-odd で穴を抜く）', () => {
  assert.equal(pointInRings(5, 5, SQUARE_WITH_HOLE), false);
});

test('pointInRings: 穴の外・外周の内は true', () => {
  assert.equal(pointInRings(1, 1, SQUARE_WITH_HOLE), true);
  assert.equal(pointInRings(9, 9, SQUARE_WITH_HOLE), true);
});

test('pointInRings: MultiPolygon は左右どちらの四角内も true', () => {
  assert.equal(pointInRings(2, 2, MULTI), true);
  assert.equal(pointInRings(8, 2, MULTI), true);
});

test('pointInRings: MultiPolygon の隙間(4-6)は false', () => {
  assert.equal(pointInRings(5, 2, MULTI), false);
});

test('pointInRings: 上辺の境界(y=yi=yj)は even-odd の半開き挙動で false', () => {
  // y=10 (上辺) では (yi>y)!=(yj>y) が成立せず内部判定されない＝Python と同一
  assert.equal(pointInRings(5, 10, SQUARE), false);
});

test('pointInRings: 空 rings は false', () => {
  assert.equal(pointInRings(5, 5, []), false);
});
