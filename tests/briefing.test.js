import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefCards, cardColorCss } from '../js/ui/briefing.js';

test('briefCards: cards 配列を返す・空安全', () => {
  assert.deepEqual(briefCards({ cards: [{ title_ja: 'a' }] }).map((c) => c.title_ja), ['a']);
  assert.deepEqual(briefCards(null), []);
  assert.deepEqual(briefCards({}), []);
});

test('cardColorCss: カテゴリ色を rgb 文字列に（news_categories 再利用）', () => {
  assert.equal(cardColorCss('conflict'), 'rgb(255,70,90)');
  assert.equal(cardColorCss('zzz'), 'rgb(180,190,205)'); // 未知→other
});
