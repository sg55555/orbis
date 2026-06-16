import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planeSilhouettePolygon, buildPlaneConfig, buildDotConfig, PLANE_VERTS } from '../js/layers/flights.js';

test('planeSilhouettePolygon: 北(0)は機首が北、頂点数は PLANE_VERTS と一致', () => {
  const poly = planeSilhouettePolygon({ lon: 0, lat: 0, heading: 0 }, 1);
  assert.equal(poly.length, PLANE_VERTS.length);
  assert.ok(poly[0][1] > 0, '機首(先頭頂点)は北で緯度が増える');
});

test('planeSilhouettePolygon: 東(90)は機首が東', () => {
  const poly = planeSilhouettePolygon({ lon: 0, lat: 0, heading: 90 }, 1);
  assert.ok(poly[0][0] > 0, '東向きは機首の経度が増える');
});

test('planeSilhouettePolygon: heading 無しは null', () => {
  assert.equal(planeSilhouettePolygon({ lon: 0, lat: 0, heading: null }, 1), null);
  assert.equal(planeSilhouettePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildPlaneConfig: heading を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildPlaneConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.data.length, 1, 'heading 無しはシルエットに含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, PLANE_VERTS.length);
});

test('buildDotConfig: heading 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] });
  assert.equal(cfg.id, 'flights-dot');
  assert.equal(cfg.data.length, 1, 'heading 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildDotConfig/buildPlaneConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildPlaneConfig(null, 1).data, []);
});
