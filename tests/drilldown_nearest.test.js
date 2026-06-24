import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqDistDeg, nearestCity } from '../js/lib/drilldown/nearest.js';

test('sqDistDeg: 同一点は 0', () => {
  assert.equal(sqDistDeg(10, 20, 10, 20), 0);
});

test('sqDistDeg: 純緯度差は cos 補正を受けず差の二乗', () => {
  // 経度差なし→ dLon=0, dLat=2 → 4
  assert.ok(Math.abs(sqDistDeg(0, 0, 0, 2) - 4) < 1e-9);
});

test('sqDistDeg: 高緯度では同じ経度差でも cosLat 補正で距離が縮む', () => {
  // 経度差 2 度。赤道(lat0)と高緯度(lat60)で比較すると高緯度の方が小さい。
  const atEquator = sqDistDeg(0, 0, 2, 0);
  const atHigh = sqDistDeg(0, 60, 2, 60);
  assert.ok(atHigh < atEquator, 'cosLat 補正で高緯度の経度差は縮む');
  // lat=0 は cos(0)=1 → dLon=2 → 4
  assert.ok(Math.abs(atEquator - 4) < 1e-9);
});

test('sqDistDeg: 引数順に対して対称', () => {
  const ab = sqDistDeg(10, 30, 12, 33);
  const ba = sqDistDeg(12, 33, 10, 30);
  assert.ok(Math.abs(ab - ba) < 1e-9);
});

test('nearestCity: 最も近い都市を返す', () => {
  const cities = [
    { name: 'Far', name_ja: '遠', lon: 5, lat: 5, pop: 100 },
    { name: 'Near', name_ja: '近', lon: 0.1, lat: 0.1, pop: 200 },
    { name: 'Mid', name_ja: '中', lon: 1, lat: 1, pop: 300 },
  ];
  const c = nearestCity(0, 0, cities);
  assert.equal(c.name, 'Near');
});

test('nearestCity: cities 0 件は null', () => {
  assert.equal(nearestCity(0, 0, []), null);
});

test('nearestCity: cities が undefined/null は null', () => {
  assert.equal(nearestCity(0, 0, undefined), null);
  assert.equal(nearestCity(0, 0, null), null);
});

test('nearestCity: 最近傍が maxDeg を超えると null', () => {
  const cities = [{ name: 'Far', name_ja: '遠', lon: 10, lat: 10, pop: 1 }];
  // 既定 maxDeg=1.5。距離は約 14度 ≫ 1.5 → null
  assert.equal(nearestCity(0, 0, cities), null);
});

test('nearestCity: maxDeg を広げれば遠い都市も返る', () => {
  const cities = [{ name: 'Far', name_ja: '遠', lon: 10, lat: 10, pop: 1 }];
  const c = nearestCity(0, 0, cities, { maxDeg: 20 });
  assert.equal(c.name, 'Far');
});

test('nearestCity: maxDeg 境界ちょうど（半径内）は採用される', () => {
  // 純緯度差 1.5 度ちょうど。dLat=1.5 → 距離=1.5 ≤ maxDeg=1.5 → 採用
  const cities = [{ name: 'Edge', name_ja: '境', lon: 0, lat: 1.5, pop: 1 }];
  const c = nearestCity(0, 0, cities, { maxDeg: 1.5 });
  assert.equal(c.name, 'Edge');
});

test('nearestCity: 同距離は配列先頭を優先（安定タイブレーク）', () => {
  const cities = [
    { name: 'First', name_ja: '一', lon: 1, lat: 0, pop: 1 },
    { name: 'Second', name_ja: '二', lon: -1, lat: 0, pop: 1 },
  ];
  // (0,0) から両者とも経度差 1（同距離）→ 先頭 First
  const c = nearestCity(0, 0, cities);
  assert.equal(c.name, 'First');
});

test('nearestCity: cosLat 補正で高緯度の経度差が縮み判定が変わる', () => {
  // lat=80 付近。A は経度差大だが高緯度で縮む、B は緯度差。
  const cities = [
    { name: 'EastFar', name_ja: '東', lon: 6, lat: 80, pop: 1 },   // 経度差6, cos(80)≈0.173 → 実効 ~1.04
    { name: 'NorthMid', name_ja: '北', lon: 0, lat: 81.5, pop: 1 }, // 緯度差1.5
  ];
  const c = nearestCity(0, 80, cities, { maxDeg: 5 });
  // EastFar の実効距離 ~1.04 < NorthMid 1.5 → EastFar
  assert.equal(c.name, 'EastFar');
});
