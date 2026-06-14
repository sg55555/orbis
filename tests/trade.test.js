import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeConfigs, tradeLayer } from '../js/layers/trade.js';

test('trade tooltip: 航路は日本語名＋説明', () => {
  assert.equal(
    tradeLayer.tooltip({ properties: { name: 'Asia-Europe (Suez)' }, geometry: { type: 'LineString' } }),
    '主要航路 アジア⇄欧州（スエズ経由）｜海上輸送ルート',
  );
});

test('trade tooltip: 要衝は label を使い日本語名＋説明（name=chokepoint バグ修正）', () => {
  assert.equal(
    tradeLayer.tooltip({ properties: { name: 'chokepoint', label: 'Malacca' }, geometry: { type: 'Point' } }),
    '海上要衝 マラッカ海峡（Malacca）｜海運の要所',
  );
});

const GEO = {
  type: 'FeatureCollection',
  features: [
    { properties: { name: 'R1' }, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] } },
    { properties: { name: 'chokepoint', label: 'X' }, geometry: { type: 'Point', coordinates: [5, 5] } },
  ],
};

test('buildTradeConfigs splits lines vs points into two configs', () => {
  const { pathConfig, pointConfig } = buildTradeConfigs(GEO);
  assert.equal(pathConfig.id, 'trade-routes');
  assert.equal(pathConfig.data.length, 1);
  assert.deepEqual(pathConfig.getPath(pathConfig.data[0]), [[0, 0], [10, 10]]);
  assert.equal(pointConfig.id, 'trade-chokepoints');
  assert.equal(pointConfig.data.length, 1);
  assert.deepEqual(pointConfig.getPosition(pointConfig.data[0]), [5, 5]);
});

test('tolerates missing features', () => {
  const { pathConfig, pointConfig } = buildTradeConfigs({});
  assert.deepEqual(pathConfig.data, []);
  assert.deepEqual(pointConfig.data, []);
});
