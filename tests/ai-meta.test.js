// A3「表示の正直さ」の純関数（鮮度チップ・AI 免責・定型 narrative 判定）と、
// 差し込み先（index.html / 各 ui モジュール / CSS）の配線をソース突合で固定する。
// DOM は使わない：ブラウザ実挙動は Task 10 の e2e（.fresh-chip.is-stale ≥ 3）が担保する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRESH_AI_MS, freshnessChip, freshnessChipHtml, aiDisclaimerHtml, isPlaceholderNarrative,
} from '../js/ui/ai-meta.js';

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
