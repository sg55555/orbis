import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerBlockHtml, legendHtml, helpHtml } from '../js/ui/legend.js';

const quake = { id: 'quakes', label: '地震', marker: 'ring', swatchColor: 'rgb(255,176,40)', desc: '直近の地震',
  tiers: [{ color: 'rgb(1,2,3)', label: 'M<2' }, { color: 'rgb(255,60,80)', label: 'M6+' }] };
const currents = { id: 'currents', label: '海流', marker: 'line', swatchColor: 'rgb(120,170,200)', desc: '',
  tiers: [{ color: 'rgb(42,150,255)', label: '冷たい' }, { color: 'rgb(255,90,55)', label: '暖かい' }] };

test('layerBlockHtml: 名前・代表swatch形・各tierの色とラベル', () => {
  const h = layerBlockHtml(quake);
  assert.match(h, /地震/);
  assert.match(h, /swatch-ring/);          // 代表＝層 marker
  assert.match(h, /color:rgb\(1,2,3\)/);   // tier 色
  assert.match(h, /M6\+/);                  // tier ラベル
  assert.match(h, /直近の地震/);            // desc
});

test('layerBlockHtml: line/gradient の tier は chip（色が出る塗り）', () => {
  const h = layerBlockHtml(currents);
  assert.match(h, /swatch-chip/);            // tier は chip
  assert.match(h, /color:rgb\(42,150,255\)/);// 冷たいの色
  assert.match(h, /color:rgb\(255,90,55\)/); // 暖かいの色
});

test('legendHtml: カテゴリ見出し（.layer-cat-head）と全レイヤー名', () => {
  const model = [{ id: 'events', label: '出来事', layers: [quake] },
                 { id: 'environment', label: '環境', layers: [currents] }];
  const h = legendHtml(model);
  assert.match(h, /layer-cat-head/);
  assert.match(h, /出来事/);
  assert.match(h, /環境/);
  assert.match(h, /地震/);
  assert.match(h, /海流/);
});

test('helpHtml: 5つの操作項目を含む', () => {
  const h = helpHtml();
  assert.match(h, /移動/);     // クリックで flyTo
  assert.match(h, /進路/);     // 機体/船クリック
  assert.match(h, /スクロール/);// メディア
  assert.match(h, /プリセット/);// 左パネル
  assert.match(h, /ズーム/);   // ドラッグ/ホイール
  assert.equal((h.match(/<li/g) || []).length, 5);
});
