import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLegendModel } from '../js/lib/legend-data.js';
import { layers as realLayers, descFor } from '../js/layers/registry.js';

const L = (id, label, extra = {}) => ({ id, label, ...extra });
const FULL = [
  L('quakes', '地震', { marker: 'ring', swatchColor: 'rgb(255,176,40)', legend: [{ color: 'a', label: 'M<2' }, { color: 'b', label: 'M2–4' }, { color: 'c', label: 'M4–6' }, { color: 'd', label: 'M6+' }] }),
  L('conflict', '紛争', { marker: 'dot', swatchColor: 'red', legend: [{ color: 'red', label: '紛争報道' }] }),
  L('protests', '抗議', { marker: 'dot', legend: [{ color: 'green', label: '抗議報道' }] }),
  L('news', 'ニュース', { marker: 'dot', legend: [{ color: 'x', label: '政治' }, { color: 'y', label: '災害' }] }),
  L('flights', '航空', { marker: 'triangle', swatchColor: 'cyan', legend: [{ color: 'cyan', label: '進行方向' }] }),
  L('ships', '船舶', { marker: 'diamond', legend: [{ color: 'gold', label: '進行方向' }] }),
  L('trade', '貿易ルート', { legend: [{ color: 'l', label: '主要航路' }, { color: 'm', label: '要衝' }] }),
  L('sst', '水温', { marker: 'gradient', legend: [{ color: 'c1', label: '冷' }, { color: 'c2', label: '中' }, { color: 'c3', label: '暖' }] }),
  L('currents', '海流', { marker: 'line', legend: [{ color: 'd1', label: '冷たい' }, { color: 'd2', label: '中間' }, { color: 'd3', label: '暖かい' }] }),
  L('airtemp', '気温', { marker: 'gradient', legend: [{ color: 'e1', label: '冷' }, { color: 'e2', label: '中' }, { color: 'e3', label: '暖' }] }),
];

test('buildLegendModel: カテゴリ順（出来事→移動→環境）で返す', () => {
  const m = buildLegendModel(FULL);
  assert.deepEqual(m.map((g) => g.id), ['events', 'mobility', 'environment']);
  assert.deepEqual(m[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
});

test('buildLegendModel: tiers は layer.legend と段数一致', () => {
  const m = buildLegendModel(FULL);
  const byId = {};
  m.forEach((g) => g.layers.forEach((l) => { byId[l.id] = l; }));
  assert.equal(byId.quakes.tiers.length, 4);
  assert.equal(byId.trade.tiers.length, 2);
  assert.equal(byId.currents.tiers.length, 3);
  assert.equal(byId.conflict.tiers.length, 1);
});

test('buildLegendModel: marker/swatchColor フォールバック（panel.js と一致）', () => {
  const m = buildLegendModel([L('x', 'X', { legend: [{ color: '#abc', label: 't' }] })]);
  const layer = m[m.length - 1].layers[0]; // 「その他」群
  assert.equal(layer.marker, 'dot');          // marker 既定
  assert.equal(layer.swatchColor, '#abc');    // legend[0].color
  const m2 = buildLegendModel([L('y', 'Y')]); // legend なし
  const l2 = m2[m2.length - 1].layers[0];
  assert.equal(l2.swatchColor, 'var(--cyan)');// 最終フォールバック
  assert.deepEqual(l2.tiers, []);             // legend なし → 空
});

test('buildLegendModel: desc は渡した関数の値', () => {
  const m = buildLegendModel([L('quakes', '地震')], (id) => id === 'quakes' ? '直近の地震' : '');
  assert.equal(m[0].layers[0].desc, '直近の地震');
});

test('buildLegendModel: 空配列 → 空配列', () => {
  assert.deepEqual(buildLegendModel([]), []);
});

test('整合性: registry 実レイヤーで全層が出る／quakes4・trade2・currents3・news>0', () => {
  const m = buildLegendModel(realLayers, descFor);
  const flat = m.flatMap((g) => g.layers);
  assert.equal(flat.length, realLayers.length); // 取りこぼしゼロ
  const byId = Object.fromEntries(flat.map((l) => [l.id, l]));
  assert.equal(byId.quakes.tiers.length, 4);
  assert.equal(byId.trade.tiers.length, 2);
  assert.equal(byId.currents.tiers.length, 3);
  assert.ok(byId.news.tiers.length > 0);
  assert.equal(byId.quakes.marker, 'ring');
});
