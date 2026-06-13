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
