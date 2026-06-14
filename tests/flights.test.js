import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headingEndpoint } from '../js/lib/geo.js';
import { buildDotConfig, buildHeadingConfig } from '../js/layers/flights.js';

test('headingEndpoint: 北(0)は緯度が増える方向へ', () => {
  const [lon, lat] = headingEndpoint(10, 20, 0, 1);
  assert.ok(Math.abs(lon - 10) < 1e-9, '北なら経度ほぼ不変');
  assert.ok(lat > 20, '北なら緯度が増える');
});

test('headingEndpoint: 東(90)は経度が増える方向へ', () => {
  const [lon, lat] = headingEndpoint(10, 0, 90, 1);
  assert.ok(lon > 10, '東なら経度が増える');
  assert.ok(Math.abs(lat - 0) < 1e-9, '東なら緯度ほぼ不変');
});

test('headingEndpoint: heading が null/非数値なら null（線を描かない）', () => {
  assert.equal(headingEndpoint(10, 20, null, 1), null);
  assert.equal(headingEndpoint(10, 20, undefined, 1), null);
  assert.equal(headingEndpoint(null, 20, 90, 1), null);
});

test('buildDotConfig: 全点をピクセル半径のドットに、pickable', () => {
  const cfg = buildDotConfig({ points: [{ lon: 1, lat: 2 }, { lon: 3, lat: 4 }] });
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.data.length, 2);
  assert.equal(cfg.radiusUnits, 'pixels');
  assert.equal(cfg.pickable, true);
  assert.deepEqual(cfg.getPosition({ lon: 5, lat: 6 }), [5, 6]);
});

test('buildDotConfig: snapshot 無しでも空で安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
});

test('buildHeadingConfig: heading を持つ点のみ線分データ化', () => {
  const cfg = buildHeadingConfig({ points: [
    { lon: 0, lat: 0, heading: 90 },
    { lon: 1, lat: 1, heading: null },   // 除外
    { lon: 2, lat: 2, heading: 0 },
  ] });
  assert.equal(cfg.id, 'flights-heading');
  assert.equal(cfg.data.length, 2, 'heading 無しは除外');
  const seg = cfg.data[0];
  assert.deepEqual(seg.source, [0, 0]);
  assert.ok(seg.target[0] > 0, '東向きは target 経度が増える');
});

test('buildHeadingConfig: snapshot 無しでも空で安全', () => {
  assert.deepEqual(buildHeadingConfig(null).data, []);
});
