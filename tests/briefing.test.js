import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// 補助（結線の確認）。実挙動＝チップ/免責の中身は tests/ai-meta.test.js の DOM スタブ 2 本が測る。
test('renderBriefing: updated からチップを描き、カード末尾に免責を足す（結線）', () => {
  const src = readFileSync(new URL('../js/ui/briefing.js', import.meta.url), 'utf8');
  assert.ok(src.includes("rootEl.querySelector('#brief-fresh')"));
  assert.ok(src.includes('freshnessChipHtml({ updated: b.updated, now })'));
  assert.ok(src.includes("cardsEl.insertAdjacentHTML('beforeend', aiDisclaimerHtml("));
  assert.ok(src.includes('generatedAt: b.updated'), 'briefing の時刻キーは updated');
});
