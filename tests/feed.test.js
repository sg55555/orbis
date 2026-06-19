import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, parseGdeltDate, feedChipIds, loadFeedHidden, toggleHidden, visibleIds, allActive, applyChips, readFeedFilter, writeFeedFilter, countBarPct } from '../js/lib/feed.js';

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

test('feedChipIds: フィード対象かつ有効なレイヤーのみ', () => {
  const ls = [{ id: 'quakes' }, { id: 'conflict' }, { id: 'news' }];
  assert.deepEqual(feedChipIds(ls, new Set(['quakes', 'conflict'])), ['quakes', 'conflict']);
});

test('feedChipIds: items を渡すと実フィード項目を持つレイヤーだけ（空 currents 等を排除）', () => {
  const ls = [{ id: 'quakes' }, { id: 'conflict' }, { id: 'currents' }, { id: 'news' }];
  const enabled = new Set(['quakes', 'conflict', 'currents', 'news']);
  // currents は items に登場しない（toFeedItems が空）→ チップに出さない
  const items = [{ layerId: 'quakes' }, { layerId: 'conflict' }, { layerId: 'news' }];
  assert.deepEqual(feedChipIds(ls, enabled, items), ['quakes', 'conflict', 'news']);
  // items 省略時は従来どおり（有効レイヤー全部）
  assert.deepEqual(feedChipIds(ls, enabled), ['quakes', 'conflict', 'currents', 'news']);
});

test('hidden モデル: toggle/visible/allActive/applyChips', () => {
  const ids = ['quakes', 'conflict', 'news'];
  let hidden = loadFeedHidden(null);
  assert.equal(allActive(ids, hidden), true);
  hidden = toggleHidden(hidden, 'conflict');
  assert.equal(allActive(ids, hidden), false);
  assert.deepEqual(visibleIds(ids, hidden), ['quakes', 'news']);
  const items = [{ layerId: 'quakes' }, { layerId: 'conflict' }, { layerId: 'news' }];
  assert.deepEqual(applyChips(items, hidden).map((i) => i.layerId), ['quakes', 'news']);
  hidden = toggleHidden(hidden, 'conflict'); // 再トグルで戻る
  assert.equal(allActive(ids, hidden), true);
});

test('loadFeedHidden: 配列を Set に・新レイヤーは既定表示（hidden に無い）', () => {
  const hidden = loadFeedHidden(['conflict']);
  assert.equal(hidden.has('conflict'), true);
  assert.equal(hidden.has('news'), false); // 既定表示
});

test('read/write FeedFilter: ラウンドトリップ（偽 storage）', () => {
  const store = { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; } };
  writeFeedFilter(new Set(['conflict', 'protests']), store);
  const back = readFeedFilter(store);
  assert.deepEqual([...back].sort(), ['conflict', 'protests']);
});

test('countBarPct: 0..100・log正規化・maxCount=0 ガード・単調', () => {
  assert.equal(countBarPct(0, 100), 0);
  assert.equal(countBarPct(50, 0), 0);     // maxCount=0 ガード
  assert.equal(countBarPct(100, 100), 100); // 最大は満幅
  assert.ok(countBarPct(10, 100) < countBarPct(50, 100)); // 単調増加
  assert.ok(countBarPct(1, 100) > 0);       // 小件数でも >0
});
