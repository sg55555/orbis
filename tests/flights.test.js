import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightTrianglePolygon, buildTriangleConfig, buildDotConfig } from '../js/layers/flights.js';

test('flightTrianglePolygon: 北(0)は tip が北、3頂点', () => {
  const tri = flightTrianglePolygon({ lon: 0, lat: 0, heading: 0 }, 1);
  assert.equal(tri.length, 3);
  const [tip] = tri;
  assert.ok(tip[1] > 0, '北向きは tip の緯度が増える');
});

test('flightTrianglePolygon: 東(90)は tip が東', () => {
  const [tip] = flightTrianglePolygon({ lon: 0, lat: 0, heading: 90 }, 1);
  assert.ok(tip[0] > 0, '東向きは tip の経度が増える');
});

test('flightTrianglePolygon: heading 無しは null', () => {
  assert.equal(flightTrianglePolygon({ lon: 0, lat: 0, heading: null }, 1), null);
  assert.equal(flightTrianglePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildTriangleConfig: heading を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildTriangleConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.data.length, 1, 'heading 無しは三角に含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, 3);
});

test('buildDotConfig: heading 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] });
  assert.equal(cfg.id, 'flights-dot');
  assert.equal(cfg.data.length, 1, 'heading 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildDotConfig/buildTriangleConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildTriangleConfig(null, 1).data, []);
});
