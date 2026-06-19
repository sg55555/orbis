import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByCountry, buildHotspotConfigs } from '../js/lib/aggregate.js';

const pts = [
  { id: '1', place: 'UP', root: '19', mentions: 10, date: '20260620120000', url: 'https://reuters.com/a', lon: 30, lat: 49 },
  { id: '2', place: 'UP', root: '19', mentions: 50, date: '20260620130000', url: 'https://bbc.com/b', lon: 31, lat: 50 },
  { id: '3', place: 'UP', root: '20', mentions: 5, date: '20260620110000', url: 'https://reuters.com/c', lon: 32, lat: 51 },
  { id: '4', place: 'RS', root: '18', mentions: 3, date: '20260620100000', url: 'https://tass.com/d', lon: 37, lat: 55 },
];

test('aggregateByCountry: 国別に集約し件数・代表点・最新時刻を出す', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.kind, 'group');
  assert.equal(up.layerId, 'conflict');
  assert.equal(up.count, 3);
  assert.equal(up.country_ja, 'ウクライナ');
  assert.equal(up.mentionsTotal, 65);
  // 代表点=最多 mentions(id2: mentions50)
  assert.equal(up.lon, 31); assert.equal(up.lat, 50);
  // 最新時刻=130000
  assert.equal(up.time, Date.UTC(2026, 5, 20, 13, 0, 0));
});

test('aggregateByCountry: dominantRoot は最頻（同数は重大度）・dominantRootJa', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.dominantRoot, '19'); // 19が2件で最頻
  assert.equal(up.dominantRootJa, '戦闘');
});

test('aggregateByCountry: topSources は hostname 頻度上位（最大3）', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.topSources[0], 'reuters.com'); // 2件で最多
  assert.ok(up.topSources.includes('bbc.com'));
  assert.ok(up.topSources.length <= 3);
});

test('aggregateByCountry: 空配列・未知/空 place は安全', () => {
  assert.deepEqual(aggregateByCountry([], 'conflict'), []);
  const rows = aggregateByCountry([{ id: 'x', place: '', root: '18', mentions: 0, date: 'bad', url: '', lon: 0, lat: 0 }], 'protests');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].time, 0); // 不正 date→0
});

const groups = [
  { lon: 30, lat: 49, count: 100 }, { lon: 37, lat: 55, count: 50 },
  { lon: 10, lat: 5, count: 5 }, { lon: 1, lat: 1, count: 80 },
];

test('buildHotspotConfigs: count 上位 topN を選ぶ', () => {
  const c = buildHotspotConfigs(groups, 0, { topN: 2 });
  assert.equal(c.length, 1);
  assert.equal(c[0].data.length, 2);
  assert.equal(c[0].data[0].count, 100); // 降順先頭
  assert.equal(c[0].data[1].count, 80);
  assert.equal(c[0].pickable, false);
});

test('buildHotspotConfigs: reduced/空は []', () => {
  assert.deepEqual(buildHotspotConfigs(groups, 0, { reduced: true }), []);
  assert.deepEqual(buildHotspotConfigs([], 0, {}), []);
});

test('buildHotspotConfigs: rgb を線色に使う', () => {
  const c = buildHotspotConfigs(groups, 0.5, { rgb: [94, 255, 166] });
  const col = c[0].getLineColor(groups[0]);
  assert.equal(col[0], 94); assert.equal(col[1], 255); assert.equal(col[2], 166);
});
