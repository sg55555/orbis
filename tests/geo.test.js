import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeToRadius, magnitudeToColor, formatFreshness, silhouettePolygon, projectAhead, shipArrival, projectedArrival } from '../js/lib/geo.js';

test('magnitudeToRadius is floored at 3 and grows with magnitude', () => {
  assert.equal(magnitudeToRadius(0), 3);
  assert.equal(magnitudeToRadius(1), 3);
  assert.equal(magnitudeToRadius(5), 18); // round(5^1.8)=18
});

test('magnitudeToColor maps to aurora palette bands', () => {
  assert.deepEqual(magnitudeToColor(1), [57, 208, 255]);   // < 2 cyan
  assert.deepEqual(magnitudeToColor(3), [94, 255, 166]);   // 2-4 green
  assert.deepEqual(magnitudeToColor(5), [255, 176, 40]);   // 4-6 amber
  assert.deepEqual(magnitudeToColor(7), [255, 60, 80]);    // >=6 red
  assert.deepEqual(magnitudeToColor(6), [255, 60, 80]);    // 境界6は赤
});

test('formatFreshness renders Japanese relative time', () => {
  const now = Date.parse('2026-06-13T12:00:00Z');
  assert.equal(formatFreshness('2026-06-13T11:59:30Z', now), 'たった今');
  assert.equal(formatFreshness('2026-06-13T11:57:00Z', now), '3分前');
  assert.equal(formatFreshness('2026-06-13T10:00:00Z', now), '2時間前');
});

test('silhouettePolygon: 北(0)は前方頂点が北、頂点数は verts と一致', () => {
  const verts = [[1, 0], [-1, 0.3], [-1, -0.3]];
  const poly = silhouettePolygon(0, 0, 0, 1, verts);
  assert.equal(poly.length, 3);
  assert.ok(poly[0][1] > 0, '前方(forward+)は北で緯度が増える');
  assert.ok(Math.abs(poly[0][0]) < 1e-9, '純前方頂点は経度が不変');
});

test('silhouettePolygon: 東(90)は前方頂点が東', () => {
  const poly = silhouettePolygon(0, 0, 90, 1, [[1, 0]]);
  assert.ok(poly[0][0] > 0, '東向きは前方頂点の経度が増える');
});

test('silhouettePolygon: heading 欠損/非数値/座標欠損は null', () => {
  assert.equal(silhouettePolygon(0, 0, null, 1, [[1, 0]]), null);
  assert.equal(silhouettePolygon(0, 0, NaN, 1, [[1, 0]]), null);
  assert.equal(silhouettePolygon(null, 0, 0, 1, [[1, 0]]), null);
});

test('silhouettePolygon: side+ は heading 0 のとき東(経度+)へ動く', () => {
  const poly = silhouettePolygon(0, 0, 0, 1, [[0, 1]]);
  assert.ok(poly[0][0] > 0, 'side+ は右舷=東で経度が増える');
  assert.ok(Math.abs(poly[0][1]) < 1e-9, '純横方向頂点は緯度がほぼ不変');
});

test('silhouettePolygon: verts が配列でなければ null', () => {
  assert.equal(silhouettePolygon(0, 0, 0, 1, null), null);
  assert.equal(silhouettePolygon(0, 0, 0, 1, undefined), null);
});

test('projectAhead: 北(0)へ前進すると緯度↑・経度≒不変', () => {
  const out = projectAhead(0, 0, 0, 100, 10);
  assert.ok(out[1] > 0 && Math.abs(out[0]) < 1e-9);
});

test('projectAhead: 東(90)へは経度↑', () => {
  const out = projectAhead(0, 0, 90, 100, 10);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9);
});

test('projectAhead: 速度0/負・heading欠損・座標欠損は null', () => {
  assert.equal(projectAhead(0, 0, 0, 0, 10), null);
  assert.equal(projectAhead(0, 0, 0, -5, 10), null);
  assert.equal(projectAhead(0, 0, null, 100, 10), null);
  assert.equal(projectAhead(null, 0, 0, 100, 10), null);
});

test('shipArrival: cog/sog(kn)から前進・kn→m/s換算', () => {
  const out = shipArrival({ lon: 0, lat: 0, cog: 90, sog: 10 }, 60);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9, '東へ進む');
});

test('shipArrival: cog/sog 欠損・sog0・p無しは null', () => {
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: 90, sog: 0 }, 60), null);
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: null, sog: 10 }, 60), null);
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: 90, sog: null }, 60), null);
  assert.equal(shipArrival(null, 60), null);
});

test('projectedArrival 回帰: heading/velocity で従来通り（東進・緯度不変・速度0でnull）', () => {
  const out = projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 100 }, 10);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9);
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 0 }, 10), null);
});
