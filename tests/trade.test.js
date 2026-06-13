import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeConfigs } from '../js/layers/trade.js';

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
