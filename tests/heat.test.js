import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBlobConfig, buildPickConfig, buildCoreConfig } from '../js/layers/conflict.js';
import { buildBlobConfig as buildBlobP, buildPickConfig as buildPickP, buildCoreConfig as buildCoreP } from '../js/layers/protests.js';

const snap = { points: [{ id: 'a', lon: 1, lat: 2, mentions: 50 }, { id: 'b', lon: 3, lat: 4, mentions: 0 }] };

test('conflict buildBlobConfig: globe対応の加算合成スキャッター（HeatmapLayer非使用）', () => {
  const c = buildBlobConfig(snap);
  assert.equal(c.id, 'conflict-heat');
  assert.equal(c.data.length, 2);
  assert.deepEqual(c.getPosition(snap.points[0]), [1, 2]);
  // 加算合成（重なると発色＝ヒート風の面）。globe非対応の集約は使わない。
  assert.equal(c.parameters.blendColorOperation, 'add');
  assert.equal(c.parameters.blendColorDstFactor, 'one');
  assert.equal(c.pickable, false);
});

test('conflict buildBlobConfig: 半径は mentions が多いほど大きい・色は半透明', () => {
  const c = buildBlobConfig(snap);
  assert.ok(c.getRadius(snap.points[0]) > c.getRadius(snap.points[1]), 'mentions多→大半径');
  const col = c.getFillColor(snap.points[0]);
  assert.equal(col.length, 4);
  assert.ok(col[3] < 255 && col[3] > 0, '半透明（加算で蓄積）');
});

test('conflict buildPickConfig: 小半径・pickable・id=conflict', () => {
  const p = buildPickConfig(snap);
  assert.equal(p.id, 'conflict');
  assert.equal(p.pickable, true);
  assert.ok(p.getRadius() <= 5);
});

test('protests も同形（id=protests-heat / protests・加算合成）', () => {
  assert.equal(buildBlobP(snap).id, 'protests-heat');
  assert.equal(buildBlobP(snap).parameters.blendColorOperation, 'add');
  assert.equal(buildPickP(snap).id, 'protests');
  assert.equal(buildPickP(snap).pickable, true);
});

const sevSnap = { points: [
  { id: 'a', lon: 1, lat: 2, mentions: 5, root: '18' },   // 暴行・低
  { id: 'b', lon: 3, lat: 4, mentions: 100, root: '20' }, // 大規模暴力・高 mentions
] };

test('conflict buildCoreConfig: id=conflict-core・加算・深刻/多mentionsほど明るい', () => {
  const c = buildCoreConfig(sevSnap, 1);
  assert.equal(c.id, 'conflict-core');
  assert.equal(c.parameters.blendColorOperation, 'add');
  assert.equal(c.pickable, false);
  const low = c.getFillColor(sevSnap.points[0]);
  const high = c.getFillColor(sevSnap.points[1]);
  assert.ok(high[1] > low[1], '大規模暴力＋高mentions→白熱(緑成分増)');
});

test('protests buildCoreConfig: id=protests-core・緑ベース', () => {
  const c = buildCoreP(sevSnap, 1);
  assert.equal(c.id, 'protests-core');
  const col = c.getFillColor({ mentions: 0, root: '14' });
  assert.equal(col[1], 200); // 緑ベース(40,200,120)の dim
});
