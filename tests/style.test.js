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
