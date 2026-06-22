import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseStyle } from '../js/style.js';

test('buildBaseStyle: OpenFreeMap ベクター源とフォントを参照', () => {
  const s = buildBaseStyle();
  assert.equal(s.version, 8);
  assert.equal(s.sources.openmaptiles.type, 'vector');
  assert.match(s.sources.openmaptiles.url, /openfreemap\.org\/planet/);
  assert.match(s.glyphs, /openfreemap\.org\/fonts/);
});

test('buildBaseStyle: globe 投影を指定する（平面メルカトルではなく球体）', () => {
  const s = buildBaseStyle();
  assert.ok(s.projection, 'projection を持つ');
  assert.equal(s.projection.type, 'globe');
});

test('buildBaseStyle: 不透明な黒背景レイヤーを持たない（球体を星空に浮かせる）', () => {
  const s = buildBaseStyle();
  const opaqueBg = s.layers.find(
    (l) => l.type === 'background' && l.paint && l.paint['background-color'] === '#05080f'
  );
  assert.equal(opaqueBg, undefined);
});

test('buildBaseStyle: 海洋/陸/行政界/国名ラベルのレイヤーを含む', () => {
  const s = buildBaseStyle();
  const byLayer = (sl) => s.layers.find((l) => l['source-layer'] === sl);
  assert.ok(byLayer('water'), 'water fill');
  assert.ok(byLayer('landcover') || byLayer('landuse'), 'land');
  assert.ok(byLayer('boundary'), 'boundary');
  const place = s.layers.find((l) => l['source-layer'] === 'place' && l.type === 'symbol');
  assert.ok(place, 'place symbol');
  assert.ok(JSON.stringify(place.layout['text-field']).includes('name:ja'));
});

test('buildBaseStyle: admin1(県/州/省)ラベル層を持ち、name:ja で日本語化・state/province を対象', () => {
  const s = buildBaseStyle();
  const placeSymbols = s.layers.filter((l) => l['source-layer'] === 'place' && l.type === 'symbol');
  // 県/州/省ラベル層＝filter に 'state' と 'province' を含む symbol 層
  const admin1 = placeSymbols.find((l) => {
    const f = JSON.stringify(l.filter || '');
    return f.includes('state') && f.includes('province');
  });
  assert.ok(admin1, 'admin1(state/province)ラベル層が存在する');
  // 日本語名を優先（name:ja coalesce）
  assert.ok(JSON.stringify(admin1.layout['text-field']).includes('name:ja'), 'name:ja を使う');
  // 低zoomでの氾濫を避けるためズーム帯を持つ（minzoom もしくは text-opacity の zoom 補間）
  const hasZoomGate = admin1.minzoom != null
    || JSON.stringify(admin1.paint?.['text-opacity'] || '').includes('zoom');
  assert.ok(hasZoomGate, 'ズーム帯（minzoom か text-opacity の zoom 補間）を持つ');
});

test('buildBaseStyle: ラベル階層は country / admin1 / city の3層', () => {
  const s = buildBaseStyle();
  const placeSymbols = s.layers.filter((l) => l['source-layer'] === 'place' && l.type === 'symbol');
  assert.ok(placeSymbols.length >= 3, 'country/admin1/city の3つの place symbol 層');
});

test('buildBaseStyle: 国境(実線)と国内境界(点線)を別レイヤーで描く', () => {
  const s = buildBaseStyle();
  const boundaries = s.layers.filter((l) => l['source-layer'] === 'boundary' && l.type === 'line');
  assert.ok(boundaries.length >= 2, '国境と国内境界の2レイヤー');
  // 国境(admin_level==2): 実線（dasharray を持たない）
  const country = boundaries.find((l) => JSON.stringify(l.filter).includes('"=="') && JSON.stringify(l.filter).includes('2'));
  assert.ok(country, '国境レイヤー(admin_level==2)');
  assert.ok(!country.paint['line-dasharray'], '国境は実線');
  // 国内境界(共和国/州 admin_level>=3): 点線（line-dasharray あり）
  const region = boundaries.find((l) => l.paint && l.paint['line-dasharray']);
  assert.ok(region, '国内境界は点線(line-dasharray)');
});
