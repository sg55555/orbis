// A3「表示の正直さ」の純関数（鮮度チップ・AI 免責・定型 narrative 判定）と、
// 差し込み先（index.html / 各 ui モジュール / CSS）の配線をソース突合で固定する。
// DOM は使わない：ブラウザ実挙動は Task 10 の e2e（.fresh-chip.is-stale ≥ 3）が担保する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_AI_MS, freshnessChip, freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative,
} from '../js/ui/ai-meta.js';
import { newsPopupHtml } from '../js/lib/selection.js';
import { renderFeed } from '../js/ui/feed.js';
import { renderBriefing } from '../js/ui/briefing.js';
import { renderInstability } from '../js/ui/instability.js';
import { renderForecasts } from '../js/ui/forecast.js';

const NOW = Date.parse('2026-09-03T00:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('FRESH_AI_MS は 24 時間（AI 3 層＋news は hourly-ai schedule で動く）', () => {
  assert.equal(FRESH_AI_MS, 24 * 3600 * 1000);
});

test('freshnessChip: 閾値の手前（23h59m）は stale でない', () => {
  const r = freshnessChip({ updated: ago(23 * 3600e3 + 59 * 60e3), now: NOW });
  assert.equal(r.stale, false);
  assert.equal(r.rel, '23時間前');
  assert.equal(r.text, '最終更新 23時間前');
});

test('freshnessChip: 閾値ちょうど（24h00m）は stale でない（超えた時だけ stale）', () => {
  assert.equal(freshnessChip({ updated: ago(24 * 3600e3), now: NOW }).stale, false);
});

test('freshnessChip: 閾値の先（24h01m）は stale で「更新停止中」', () => {
  const r = freshnessChip({ updated: ago(24 * 3600e3 + 60e3), now: NOW });
  assert.equal(r.stale, true);
  assert.equal(r.rel, '1日前');
  assert.equal(r.text, '更新停止中 · 最終 1日前');
});

test('freshnessChip: updated が不正/欠落なら「更新時刻 不明」＋ stale（黙って新鮮に見せない）', () => {
  for (const bad of [undefined, null, '', 'not-a-date']) {
    const r = freshnessChip({ updated: bad, now: NOW });
    assert.equal(r.text, '更新時刻 不明', String(bad));
    assert.equal(r.stale, true, String(bad));
    assert.equal(r.rel, '—', String(bad));
  }
  assert.equal(freshnessChip().text, '更新時刻 不明');
});

test('freshnessChip: staleMs は呼び出し側で上書きできる', () => {
  const u = ago(7 * 3600e3);
  assert.equal(freshnessChip({ updated: u, now: NOW, staleMs: 6 * 3600e3 }).stale, true);
  assert.equal(freshnessChip({ updated: u, now: NOW }).stale, false);
});

test('freshnessChipHtml: is-stale は stale の時だけ・title は正規化 ISO', () => {
  const fresh = freshnessChipHtml({ updated: ago(60e3), now: NOW });
  assert.equal(fresh,
    '<span class="fresh-chip" title="2026-09-02T23:59:00.000Z">最終更新 1分前</span>');
  const stale = freshnessChipHtml({ updated: ago(11 * 86400e3), now: NOW });
  assert.match(stale, /^<span class="fresh-chip is-stale" title="2026-08-23T00:00:00\.000Z">/);
  assert.match(stale, /更新停止中 · 最終 11日前<\/span>$/);
});

test('freshnessChipHtml: 不正な updated を HTML に流さない', () => {
  const h = freshnessChipHtml({ updated: '<img src=x onerror=alert(1)>', now: NOW });
  assert.ok(!h.includes('<img'), h);
  assert.match(h, /title=""/);
  assert.match(h, /class="fresh-chip is-stale"/);
  assert.match(h, /更新時刻 不明/);
});

test('aiDisclaimerHtml: model 有りは「AI 生成（model・YYYY-MM-DD HH:mm UTC）」', () => {
  assert.equal(
    aiDisclaimerHtml({ model: 'claude-haiku-4-5', generatedAt: '2026-08-23T08:16:56Z' }),
    '<p class="ai-disclaimer">AI 生成（claude-haiku-4-5・2026-08-23 08:16 UTC）'
    + '・要約/推定であり誤りを含むことがあります</p>');
});

test('aiDisclaimerHtml: model 無しは時刻だけ・時刻不明でも落ちない', () => {
  assert.equal(
    aiDisclaimerHtml({ generatedAt: '2026-08-23T08:14:18Z' }),
    '<p class="ai-disclaimer">AI 生成（2026-08-23 08:14 UTC）'
    + '・要約/推定であり誤りを含むことがあります</p>');
  assert.match(aiDisclaimerHtml({}), /AI 生成（時刻不明）/);
  assert.match(aiDisclaimerHtml(), /AI 生成（時刻不明）/);
});

test('aiDisclaimerHtml: model を HTML エスケープする', () => {
  const h = aiDisclaimerHtml({ model: '<b>x</b>', generatedAt: '2026-08-23T08:00:00Z' });
  assert.ok(!h.includes('<b>'), h);
  assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('isPlaceholderNarrative: 本番 instability.json の定型 3 例で true', () => {
  assert.equal(isPlaceholderNarrative('与えたデータには不安定性を示す具体的な事象が記載されていない'), true);
  assert.equal(isPlaceholderNarrative('データが不足しているため評価できない'), true);
  assert.equal(isPlaceholderNarrative('具体的な事象は確認されていない'), true);
});

test('isPlaceholderNarrative: 空/欠落/空白も「分析文なし」扱い（無言の空欄にしない）', () => {
  for (const v of [undefined, null, '', '   ']) {
    assert.equal(isPlaceholderNarrative(v), true, String(v));
  }
});

test('isPlaceholderNarrative: 実際の分析文 2 例では false', () => {
  assert.equal(isPlaceholderNarrative('ウクライナとの軍事紛争が継続している'), false);
  assert.equal(isPlaceholderNarrative('司法と行政の対立および自然災害の脅威が存在する'), false);
});

// --- ニュースが AI 翻訳/要約であることの明示（LEGAL-07） ---
// renderFeed が触る DOM サーフェスは innerHTML / __wired / querySelectorAll（Task 6 が足した
// applyDataStyles(root) 用）だけなので最小スタブで足りる
// （repo 既存の DOM スタブ idiom＝tests/drilldown_render.test.js・tests/data-style.test.js と同方針）。
function fakeFeedRoot() {
  return { __wired: true, innerHTML: '', addEventListener() {}, querySelectorAll: () => [] };
}

test('renderFeed: news 行にだけ「見出しからのAI要約」タグを出す', () => {
  const root = fakeFeedRoot();
  renderFeed(root, [
    { layerId: 'news', kind: 'item', title: '見出し', time: Date.parse('2026-09-02T00:00:00Z') },
    { layerId: 'quakes', kind: 'item', title: 'M5.0', time: Date.parse('2026-09-02T00:00:00Z') },
  ], () => {});
  const rows = root.innerHTML.split('<div class="feed-row"');
  assert.equal(rows.length, 3, `feed-row が 2 行出る: ${root.innerHTML}`);
  assert.match(rows[1], /<span class="ai-tag">見出しからのAI要約<\/span>/);
  assert.ok(!rows[2].includes('ai-tag'), '地震行には AI タグを出さない');
});

test('newsPopupHtml: AI 要約であることを明示するタグを含む', () => {
  const h = newsPopupHtml({
    title_ja: 'タイトル', summary_ja: '要約', place: '東京',
    category: 'conflict', url: 'https://example.com/a',
  });
  assert.match(h, /<span class="ai-tag">見出しからのAI要約<\/span>/);
});

// --- 差し込みの配線（ソース突合）。ブラウザ実挙動は Task 10 の e2e が担保する ---
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('index.html: 『毎時更新』の虚偽文言が無く、鮮度チップの置き場が 3 つある', () => {
  const html = read('../index.html');
  assert.ok(!html.includes('毎時更新'), 'AI 3 層は 2026-08-23 で停止中＝毎時更新ではない');
  for (const id of ['brief-fresh', 'ins-fresh', 'fc-fresh']) {
    assert.ok(html.includes(`<span class="fresh-chip-slot" id="${id}"></span>`), id);
  }
});

// 補助: モジュール結線の静的確認（差し込みの中身は下の 5 本が挙動で測る）。
test('briefing / instability / forecast が ai-meta を import している', () => {
  for (const p of ['../js/ui/briefing.js', '../js/ui/instability.js', '../js/ui/forecast.js']) {
    assert.match(read(p), /from '\.\/ai-meta\.js'/, p);
  }
});

// --- 差し込みの挙動（最小 DOM シムで実際に描かせる） ---
// repo 既存の DOM スタブ idiom（tests/drilldown_render.test.js・tests/data-style.test.js）に倣う。
// querySelector は「同じセレクタなら同じ要素」を返す遅延生成なので、描画後に同じ呼び出しで読み戻せる。
// getAttribute が常に null なので Task 6 の applyDataStyles(el) は 0 件適用で素通りする。
function makeEl(tag = 'div') {
  const kids = new Map();
  const el = {
    tagName: String(tag).toUpperCase(),
    type: '', className: '', textContent: '', innerHTML: '', disabled: false,
    dataset: {}, children: [], _parent: null,
    style: { display: '', setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get parentElement() { if (!el._parent) el._parent = makeEl('div'); return el._parent; },
    appendChild(c) { el.children.push(c); return c; },
    insertAdjacentHTML(_pos, html) { el.innerHTML += html; },
    addEventListener() {},
    querySelector(sel) { if (!kids.has(sel)) kids.set(sel, makeEl('div')); return kids.get(sel); },
    querySelectorAll: () => [],
    getAttribute: () => null,
    removeAttribute() {},
  };
  return el;
}

// 3 renderer は document.createElement を使うので、その間だけ global に生やす。
function withFakeDocument(fn) {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => makeEl(t) };
  try { return fn(); } finally {
    if (prev === undefined) delete globalThis.document; else globalThis.document = prev;
  }
}

test('renderBriefing: 停止中なら #brief-fresh に is-stale チップ・カード末尾に免責 1 個', () => {
  const root = makeEl();
  withFakeDocument(() => renderBriefing(root, {
    updated: '2026-08-23T08:14:18Z', model: 'claude-sonnet-4-6', lead: 'リード',
    cards: [{ title_ja: 'A', summary_ja: 'B', category: 'conflict', severity: 2 }],
  }, { now: NOW }));
  const chip = root.querySelector('#brief-fresh').innerHTML;
  assert.match(chip, /class="fresh-chip is-stale"/);
  assert.match(chip, /更新停止中 · 最終 10日前/);
  assert.equal(root.querySelector('.brief-lead').textContent, 'リード');
  const cards = root.querySelector('.brief-cards');
  assert.equal(cards.children.length, 1, 'カードは 1 枚');
  assert.match(cards.innerHTML,
    /^<p class="ai-disclaimer">AI 生成（claude-sonnet-4-6・2026-08-23 08:14 UTC）/);
  assert.equal((cards.innerHTML.match(/ai-disclaimer/g) || []).length, 1, '免責は 1 個だけ');
});

test('renderBriefing: 1 時間前なら is-stale を付けない', () => {
  const root = makeEl();
  withFakeDocument(() => renderBriefing(root,
    { updated: new Date(NOW - 3600e3).toISOString(), lead: '', cards: [] }, { now: NOW }));
  const chip = root.querySelector('#brief-fresh').innerHTML;
  assert.match(chip, /最終更新 1時間前/);
  assert.ok(!chip.includes('is-stale'), chip);
});

test('renderInstability: #ins-fresh のチップ・定型 narrative の置換・末尾の免責', () => {
  const root = makeEl();
  withFakeDocument(() => renderInstability(root, {
    updated: '2026-08-23T08:16:24Z', model: 'claude-haiku-4-5',
    countries: [{ code: 'IZ', name_ja: 'イラク', score: 87, lat: 33, lon: 44,
      counts: { conflict: 1, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
      narrative_ja: '与えたデータには不安定性を示す具体的な事象が記載されていない' }],
  }, { now: NOW }));
  const chip = root.querySelector('#ins-fresh').innerHTML;
  assert.match(chip, /class="fresh-chip is-stale"/);
  assert.match(chip, /更新停止中 · 最終 10日前/);
  const rank = root.querySelector('.ins-rank-list');
  assert.equal(rank.children.length, 1, 'ランキング行は 1 件');
  assert.match(rank.children[0].innerHTML, /ins-narr--none/);
  assert.match(rank.innerHTML,
    /^<p class="ai-disclaimer">AI 生成（claude-haiku-4-5・2026-08-23 08:16 UTC）/);
});

test('renderForecasts: #fc-fresh のチップとリスト末尾の免責', () => {
  const root = makeEl();
  withFakeDocument(() => renderForecasts(root, {
    generated_at: '2026-08-23T08:16:56Z', model: 'claude-haiku-4-5',
    cards: [{ domain: 'conflict', place_ja: 'X', attention_score: 70, trend: 'up',
      status: 'active', confidence: 'high', horizon: '1週間', signals: [],
      outlook_ja: 'o', rationale_ja: 'r' }],
  }, { now: NOW }));
  const chip = root.querySelector('#fc-fresh').innerHTML;
  assert.match(chip, /class="fresh-chip is-stale"/);
  assert.match(chip, /更新停止中 · 最終 10日前/);
  const list = root.querySelector('.fc-list');
  assert.equal(list.children.length, 1, 'カードは 1 枚');
  assert.match(list.innerHTML,
    /^<p class="ai-disclaimer">AI 生成（claude-haiku-4-5・2026-08-23 08:16 UTC）/);
});

test('renderForecasts: 時刻キーは generated_at を優先する（updated と取り違えない）', () => {
  const root = makeEl();
  withFakeDocument(() => renderForecasts(root, {
    generated_at: new Date(NOW - 3600e3).toISOString(),
    updated: '2026-08-23T00:00:00Z', cards: [],
  }, { now: NOW }));
  const chip = root.querySelector('#fc-fresh').innerHTML;
  assert.match(chip, /最終更新 1時間前/, 'updated（11日前）を使うと is-stale になってしまう');
  assert.ok(!chip.includes('is-stale'), chip);
});
