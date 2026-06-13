import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, parseGdeltDate } from '../js/lib/feed.js';

test('parseGdeltDate: "YYYYMMDDHHMMSS"(UTC) を epoch ms に', () => {
  assert.equal(parseGdeltDate('20260613173000'), Date.UTC(2026, 5, 13, 17, 30, 0));
  assert.equal(parseGdeltDate('bad'), 0);
});

const quakes = {
  id: 'quakes',
  toFeedItems: (s) => (s.points || []).map((p) => ({
    id: p.id, time: p.time, title: `M${p.mag}`, layerId: 'quakes', lon: p.lon, lat: p.lat,
  })),
};
const conflict = {
  id: 'conflict',
  toFeedItems: (s) => (s.points || []).map((p) => ({
    id: p.id, time: parseGdeltDate(p.date), title: p.place, layerId: 'conflict', lon: p.lon, lat: p.lat,
  })),
};

test('buildFeed: 有効レイヤーのみ集約し time 降順', () => {
  const snaps = {
    quakes: { points: [{ id: 'q1', mag: 2, lon: 1, lat: 1, time: 100 }, { id: 'q2', mag: 3, lon: 2, lat: 2, time: 300 }] },
    conflict: { points: [{ id: 'c1', place: 'US', lon: 3, lat: 3, date: '20260101000000' }] },
  };
  const out = buildFeed([quakes, conflict], snaps, new Set(['quakes', 'conflict']));
  assert.deepEqual(out.map((i) => i.id), ['c1', 'q2', 'q1']);
});

test('buildFeed: 無効レイヤーは除外', () => {
  const snaps = { quakes: { points: [{ id: 'q1', mag: 2, lon: 1, lat: 1, time: 100 }] } };
  const out = buildFeed([quakes, conflict], snaps, new Set(['conflict']));
  assert.equal(out.length, 0);
});

test('buildFeed: cap=100 で上位のみ', () => {
  const points = Array.from({ length: 150 }, (_, i) => ({ id: `q${i}`, mag: 1, lon: 0, lat: 0, time: i }));
  const out = buildFeed([quakes], { quakes: { points } }, new Set(['quakes']));
  assert.equal(out.length, 100);
  assert.equal(out[0].id, 'q149');
});

test('buildFeed: toFeedItems を持たない/snapshot欠如レイヤーは無視', () => {
  const noFeed = { id: 'flights' };
  const out = buildFeed([noFeed, quakes], {}, new Set(['flights', 'quakes']));
  assert.deepEqual(out, []);
});
