// tests/ships.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipSilhouettePolygon, buildHullConfig, buildDotConfig, shipTooltip, SHIP_VERTS,
} from '../js/layers/ships.js';

test('shipSilhouettePolygon: 北(cog 0)は船首が北、頂点数は SHIP_VERTS と一致', () => {
  const poly = shipSilhouettePolygon({ lon: 0, lat: 0, cog: 0 }, 1);
  assert.equal(poly.length, SHIP_VERTS.length);
  assert.ok(poly[0][1] > 0, '船首(先頭頂点)は北で緯度が増える');
});

test('shipSilhouettePolygon: 東(cog 90)は船首が東', () => {
  const poly = shipSilhouettePolygon({ lon: 0, lat: 0, cog: 90 }, 1);
  assert.ok(poly[0][0] > 0, '東向きは船首の経度が増える');
});

test('shipSilhouettePolygon: cog 無しは null', () => {
  assert.equal(shipSilhouettePolygon({ lon: 0, lat: 0, cog: null }, 1), null);
  assert.equal(shipSilhouettePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildHullConfig: cog を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildHullConfig({ points: [
    { lon: 0, lat: 0, cog: 90 }, { lon: 1, lat: 1, cog: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'ships');
  assert.equal(cfg.data.length, 1, 'cog 無しは船体に含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, SHIP_VERTS.length);
});

test('buildDotConfig: cog 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, cog: 90 }, { lon: 1, lat: 1, cog: null },
  ] });
  assert.equal(cfg.id, 'ships-dot');
  assert.equal(cfg.data.length, 1, 'cog 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildHullConfig/buildDotConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildHullConfig(null, 1).data, []);
});

test('shipTooltip: 船名・船種・速度・航路（全部あり・全項目見出し付き）', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: 'EVER GIVEN', type: '貨物船', sog: 12.3, cog: 45 }),
    '船名 EVER GIVEN｜船種 貨物船｜速度 12kn｜航路 045°',
  );
});
test('shipTooltip: 船名/船種無しは MMSI ＋欠損項目を省略', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: null, type: null, sog: 12.3, cog: 45 }),
    'MMSI 123456789｜速度 12kn｜航路 045°',
  );
  assert.equal(shipTooltip({ mmsi: 1, name: null, type: null, sog: null, cog: null }), 'MMSI 1');
  assert.equal(shipTooltip(null), null);
});
test('shipTooltip: cog 359.6 は 360 ではなく 000 に丸める', () => {
  assert.equal(
    shipTooltip({ mmsi: 1, name: null, type: null, sog: 5, cog: 359.6 }),
    'MMSI 1｜速度 5kn｜航路 000°',
  );
});
