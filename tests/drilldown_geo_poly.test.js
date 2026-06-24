import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInRings, loadPolygons, pointInFeature, locateFeature } from '../js/lib/drilldown/geo_poly.js';

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

// --- C1.2 loadPolygons ---

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: 'US', name: 'United States', name_ja: 'アメリカ合衆国' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    },
    {
      type: 'Feature',
      properties: { code: 'JP', name: 'Japan' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
          [[[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]]],
        ],
      },
    },
  ],
};

test('loadPolygons: Polygon を {code,name,name_ja,bbox,rings} に正規化', () => {
  const polys = loadPolygons(GEOJSON);
  const us = polys.find((p) => p.code === 'US');
  assert.equal(us.name, 'United States');
  assert.equal(us.name_ja, 'アメリカ合衆国');
  assert.deepEqual(us.bbox, [0, 0, 10, 10]);
  assert.equal(us.rings.length, 1);
  assert.deepEqual(us.rings[0][0], [0, 0]);
});

test('loadPolygons: MultiPolygon は全リングを一つの rings に flatten', () => {
  const polys = loadPolygons(GEOJSON);
  const jp = polys.find((p) => p.code === 'JP');
  assert.equal(jp.rings.length, 2);
  // bbox は全 ring の全点から
  assert.deepEqual(jp.bbox, [0, 0, 10, 4]);
});

test('loadPolygons: name_ja 欠落時は null', () => {
  const polys = loadPolygons(GEOJSON);
  const jp = polys.find((p) => p.code === 'JP');
  assert.equal(jp.name_ja, null);
});

test('loadPolygons: codeKey で別キーから code を引ける', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { a1code: 'CA', name: 'California' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    }],
  };
  const polys = loadPolygons(gj, { codeKey: 'a1code' });
  assert.equal(polys.length, 1);
  assert.equal(polys[0].code, 'CA');
});

test('loadPolygons: code 無し / rings 無しの feature はスキップ', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'no code' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', properties: { code: 'XX' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  };
  assert.deepEqual(loadPolygons(gj), []);
});

test('loadPolygons: features 無し / null は空配列', () => {
  assert.deepEqual(loadPolygons({}), []);
  assert.deepEqual(loadPolygons({ features: null }), []);
});

// --- C1.3 pointInFeature ---

const POLY_US = {
  code: 'US', name: 'United States', name_ja: 'アメリカ合衆国',
  bbox: [0, 0, 10, 10],
  rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
};

test('pointInFeature: bbox 内かつポリゴン内は true', () => {
  assert.equal(pointInFeature(5, 5, POLY_US), true);
});

test('pointInFeature: bbox 外は pointInRings を呼ばず即 false', () => {
  assert.equal(pointInFeature(20, 5, POLY_US), false);
  assert.equal(pointInFeature(5, -5, POLY_US), false);
  assert.equal(pointInFeature(-1, 5, POLY_US), false);
  assert.equal(pointInFeature(5, 11, POLY_US), false);
});

test('pointInFeature: bbox 端(w,s,e,n)は棄却されない', () => {
  // 左下角 (0,0) は bbox 内（< / > の境界）→ pointInRings に委譲
  // 角は even-odd の半開き挙動依存だが bbox 棄却はされないことを確認
  const polyBig = {
    code: 'X', bbox: [0, 0, 10, 10],
    rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  // bbox 内の確実な内部点
  assert.equal(pointInFeature(0.001, 0.001, polyBig), true);
});

// --- C1.4 locateFeature ---

const POLYS = [
  { code: 'A', bbox: [0, 0, 4, 4], rings: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] },
  { code: 'B', bbox: [6, 0, 10, 4], rings: [[[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]]] },
];

test('locateFeature: ヒットした poly オブジェクトを返す', () => {
  const hit = locateFeature(2, 2, POLYS);
  assert.equal(hit.code, 'A');
  const hit2 = locateFeature(8, 2, POLYS);
  assert.equal(hit2.code, 'B');
});

test('locateFeature: 重なり時は配列で最初にヒットした poly', () => {
  const overlap = [
    { code: 'FIRST', bbox: [0, 0, 10, 10], rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    { code: 'SECOND', bbox: [0, 0, 10, 10], rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  ];
  assert.equal(locateFeature(5, 5, overlap).code, 'FIRST');
});

test('locateFeature: どこにもヒットしなければ null（海洋/極域）', () => {
  assert.equal(locateFeature(5, 2, POLYS), null); // 隙間
  assert.equal(locateFeature(100, 100, POLYS), null); // 完全に外
});

test('locateFeature: 空 polys は null', () => {
  assert.equal(locateFeature(5, 5, []), null);
});
