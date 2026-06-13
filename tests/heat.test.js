import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatConfig, buildPickConfig } from '../js/layers/conflict.js';
import { buildHeatConfig as buildHeatP, buildPickConfig as buildPickP } from '../js/layers/protests.js';

const snap = { points: [{ id: 'a', lon: 1, lat: 2, mentions: 5 }, { id: 'b', lon: 3, lat: 4, mentions: 0 }] };

test('conflict buildHeatConfig: data 反映・weight=mentions・id=conflict-heat', () => {
  const c = buildHeatConfig(snap);
  assert.equal(c.id, 'conflict-heat');
  assert.equal(c.data.length, 2);
  assert.deepEqual(c.getPosition(snap.points[0]), [1, 2]);
  assert.equal(c.getWeight(snap.points[0]), 5);
  assert.equal(c.getWeight(snap.points[1]), 1); // 0/欠損は最小1
  assert.ok(Array.isArray(c.colorRange) && c.colorRange.length >= 2);
});

test('conflict buildPickConfig: 小半径・pickable・id=conflict', () => {
  const p = buildPickConfig(snap);
  assert.equal(p.id, 'conflict');
  assert.equal(p.pickable, true);
  assert.ok(p.getRadius() <= 5);
});

test('protests も同形（id=protests-heat / protests）', () => {
  assert.equal(buildHeatP(snap).id, 'protests-heat');
  assert.equal(buildPickP(snap).id, 'protests');
  assert.equal(buildPickP(snap).pickable, true);
});
