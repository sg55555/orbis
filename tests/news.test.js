import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY, categoryOf } from '../js/lib/news_categories.js';
import { newsLayer } from '../js/layers/news.js';

const SNAP = { updated: 'x', items: [
  { id: 'u1', url: 'https://www.bbc.com/n/1', source: 'bbcworld', time: 1781784000000,
    title_ja: '東京で地震', summary_ja: 'M6。', category: 'disaster', lon: 139.7, lat: 35.6, place: '東京' },
] };

test('CATEGORY: 8カテゴリ・各label/color(RGB3要素)', () => {
  const keys = Object.keys(CATEGORY);
  assert.equal(keys.length, 8);
  for (const k of keys) {
    assert.ok(typeof CATEGORY[k].label === 'string');
    assert.equal(CATEGORY[k].color.length, 3);
  }
});

test('categoryOf: 未知キーは other にフォールバック', () => {
  assert.equal(categoryOf('disaster').label, '災害・事故');
  assert.equal(categoryOf('nope'), CATEGORY.other);
  assert.equal(categoryOf(undefined), CATEGORY.other);
});

test('newsLayer.tooltip: カテゴリ＋日本語見出し＋host', () => {
  const s = newsLayer.tooltip(SNAP.items[0]);
  assert.ok(s.includes('災害・事故') && s.includes('東京で地震') && s.includes('bbc.com'));
});

test('newsLayer.toFeedItems: time/lon/lat/カテゴリ付き', () => {
  const f = newsLayer.toFeedItems(SNAP);
  assert.equal(f.length, 1);
  assert.equal(f[0].layerId, 'news');
  assert.equal(f[0].time, 1781784000000);
  assert.ok(f[0].title.includes('災害・事故') && f[0].title.includes('東京で地震'));
});

test('newsLayer.toFeedItems: 空スナップは空配列', () => {
  assert.deepEqual(newsLayer.toFeedItems(null), []);
});
