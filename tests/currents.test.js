import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  colorForTemp, lerpStops, buildCurrentField, tempAtT, currentsLayer, CMAPS, DEFAULT_CMAP,
  cyclicDist, chaseFactor,
} from '../js/layers/currents.js';

test('lerpStops: 停止点の端と中間を補間', () => {
  const stops = [[0, [0, 0, 0]], [1, [100, 200, 50]]];
  assert.deepEqual(lerpStops(stops, 0), [0, 0, 0]);
  assert.deepEqual(lerpStops(stops, 1), [100, 200, 50]);
  assert.deepEqual(lerpStops(stops, 0.5), [50, 100, 25]);
});

test('colorForTemp: sst は極寒=青系・高温=赤系、範囲外はクランプ', () => {
  const cold = colorForTemp(0, 'sst');
  const hot = colorForTemp(1, 'sst');
  assert.ok(cold[2] > cold[0], '冷たい側は青が強い');
  assert.ok(hot[0] > hot[2], '暖かい側は赤が強い');
  assert.deepEqual(colorForTemp(-5, 'sst'), cold, '下クランプ');
  assert.deepEqual(colorForTemp(9, 'sst'), hot, '上クランプ');
});

test('colorForTemp: 3カラーマップすべて [0..255]^3 を返す', () => {
  assert.deepEqual([...CMAPS].sort(), ['aqua', 'sst', 'twin']);
  for (const cm of CMAPS) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const c = colorForTemp(t, cm);
      assert.equal(c.length, 3);
      for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${cm}@${t}`);
    }
  }
  assert.equal(DEFAULT_CMAP, 'sst');
});

const GEO = {
  type: 'FeatureCollection',
  features: [
    { properties: { name: '黒潮', name_en: 'Kuroshio', type: 'warm', temps: [0.9, 0.5] },
      geometry: { type: 'LineString', coordinates: [[122, 22], [145, 38]] } },
  ],
};

test('tempAtT: 距離タイムスタンプに沿って水温を補間', () => {
  assert.equal(tempAtT([0.9, 0.5], [0, 1], 0), 0.9);
  assert.equal(tempAtT([0.9, 0.5], [0, 1], 1), 0.5);
  assert.equal(tempAtT([0.9, 0.5], [0, 1], 0.5), 0.7);
});

test('buildCurrentField: 経路を密サンプルしブロブ点を返す', () => {
  const pts = buildCurrentField(GEO, 'sst', 10);
  assert.equal(pts.length, 10); // 2点1区間×step10
  for (const p of pts) {
    assert.equal(p.position.length, 2);
    assert.equal(p.rgb.length, 3); // 水温色（alpha は描画時に波で付与）
    assert.equal(p.name, '黒潮');
    assert.ok(p.temp >= 0.5 && p.temp <= 0.9);
    assert.ok(p.phase >= 0 && p.phase <= 1); // 経路上の正規化位置
  }
});

test('buildCurrentField: 欠損(temps無し/1点)は無視', () => {
  assert.deepEqual(buildCurrentField({ features: [{ properties: {}, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }] }), []);
  assert.deepEqual(buildCurrentField({}), []);
});

test('currentsLayer.tooltip: 名称＋英名＋水温ワード', () => {
  assert.equal(currentsLayer.tooltip({ name: '親潮', name_en: 'Oyashio', temp: 0.1 }), '海流 親潮｜Oyashio｜水温 冷たい');
  assert.equal(currentsLayer.tooltip({ name: '黒潮', name_en: 'Kuroshio', temp: 0.9 }), '海流 黒潮｜Kuroshio｜水温 暖かい');
  assert.equal(currentsLayer.tooltip(null), null);
});

test('currentsLayer.toFeedItems: 海流はイベントでない→空', () => {
  assert.deepEqual(currentsLayer.toFeedItems({}), []);
});

test('ocean_currents.geojson: 全 feature が LineString・temps長=座標数・0..1・名称あり', () => {
  const path = fileURLToPath(new URL('../data/static/ocean_currents.geojson', import.meta.url));
  const geo = JSON.parse(readFileSync(path, 'utf8'));
  assert.ok(geo.features.length >= 15, '主要海流が十分ある');
  for (const f of geo.features) {
    assert.equal(f.geometry.type, 'LineString');
    const co = f.geometry.coordinates;
    const temps = f.properties.temps;
    assert.equal(co.length, temps.length, `${f.properties.name} temps長=座標数`);
    assert.ok(co.length >= 2);
    for (const t of temps) assert.ok(t >= 0 && t <= 1, `${f.properties.name} temp範囲`);
    assert.ok(f.properties.name && f.properties.name_en, '名称');
    assert.ok(f.properties.type === 'warm' || f.properties.type === 'cold');
    // 経度が ±180 をまたがない（globe での線の回り込み回避）
    for (const [lon] of co) assert.ok(lon >= -180 && lon <= 180);
  }
});

test('cyclicDist: 巡回距離（ラップ考慮・対称・0..0.5）', () => {
  assert.ok(Math.abs(cyclicDist(0.2, 0.3) - 0.1) < 1e-9);
  assert.ok(Math.abs(cyclicDist(0.1, 0.9) - 0.2) < 1e-9, 'ラップ');
  assert.ok(Math.abs(cyclicDist(0.9, 0.1) - 0.2) < 1e-9, '対称');
  assert.equal(cyclicDist(0.5, 0.5), 0);
});

test('chaseFactor: ヘッド位置で最大・前方は base・尾は中間（glide）', () => {
  const o = { cells: 4, tail: 0.25, speed: 1, base: 0.5, peak: 1.5, step: 'glide' };
  // head = (motionT*speed) mod 1 = 0.5
  const atHead = chaseFactor(0.5, 0.5, o);
  const behind = chaseFactor(0.4, 0.5, o); // ヘッドの後方（尾）= phase が小さい側
  const ahead = chaseFactor(0.7, 0.5, o);  // ヘッド前方（暗い）
  assert.ok(Math.abs(atHead - 2.0) < 1e-9, 'ヘッドで base+peak');
  assert.ok(ahead <= 0.5 + 1e-9, '前方は base');
  assert.ok(behind > 0.5 && behind < atHead, '尾は base と最大の間');
});

test('chaseFactor: base を下回らない / step hard はセル内一定・glide は連続', () => {
  const o = { cells: 5, tail: 0.2, speed: 1, base: 0.6, peak: 1.0, step: 'hard' };
  for (const ph of [0, 0.13, 0.37, 0.5, 0.88, 1]) {
    assert.ok(chaseFactor(ph, 0.3, o) >= 0.6 - 1e-9, 'base 以上');
  }
  // cells=5 → セル0は phase[0,0.2)。同一セル内の2点は同値（量子化）
  assert.equal(chaseFactor(0.02, 0.3, o), chaseFactor(0.18, 0.3, o));
  // glide は連続なので同一セル内でも異なる
  const g = { ...o, step: 'glide' };
  assert.notEqual(chaseFactor(0.02, 0.3, g), chaseFactor(0.18, 0.3, g));
});
