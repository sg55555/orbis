import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, scoreColor, trendArrow, fmtSignedPct, rankTop, topMovers, rowHtml }
  from '../js/ui/instability.js';

test('levelOf: 0..100 を 1..5 に', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(19), 1);
  assert.equal(levelOf(20), 2);
  assert.equal(levelOf(100), 5);
});

test('scoreColor: rgb 文字列', () => {
  assert.match(scoreColor(90), /^rgb\(\d+,\d+,\d+\)$/);
});

test('trendArrow / fmtSignedPct', () => {
  assert.equal(trendArrow('up'), '▲');
  assert.equal(trendArrow('down'), '▼');
  assert.equal(trendArrow('flat'), '─');
  assert.equal(fmtSignedPct(12), '+12%');
  assert.equal(fmtSignedPct(-3), '-3%');
});

test('rankTop / topMovers', () => {
  const cs = [
    { code: 'A', score: 90, trend: { dod: { delta: 2, dir: 'up' }, normal: { deltaPct: 40, dir: 'up' }, isNew: false } },
    { code: 'B', score: 80, trend: { dod: { delta: 1, dir: 'flat' }, normal: { deltaPct: 5, dir: 'flat' }, isNew: false } },
    { code: 'C', score: 70, trend: { dod: null, normal: null, isNew: true } },
  ];
  assert.deepEqual(rankTop(cs, 2).map((c) => c.code), ['A', 'B']);
  assert.deepEqual(topMovers(cs, 5).map((c) => c.code), ['A']); // 上昇かつ新規でないのは A のみ
  assert.deepEqual(rankTop(null, 3), []);
});

test('rowHtml: 国名/スコアを含み、url は http(s) のみ', () => {
  const html = rowHtml({ code: 'IZ', name_ja: 'イラク', score: 87, level: 5,
    counts: { conflict: 10, protests: 1, news: 2, quakes: 0 },
    trend: { dod: { delta: 12, dir: 'up' }, normal: { deltaPct: 30, dir: 'up' }, isNew: false },
    narrative_ja: '紛争が集中', top_events: [{ title: 'x', place: 'y', url: 'javascript:bad' }] });
  assert.match(html, /イラク/);
  assert.match(html, /87/);
  assert.doesNotMatch(html, /javascript:bad/); // 危険 URL は出さない
});

test('rowHtml: XSS エスケープ（name_ja/narrative_ja）', () => {
  const html = rowHtml({ code: 'XX', name_ja: '<script>alert(1)</script>', score: 50,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 },
    trend: { isNew: true }, narrative_ja: '"><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<script>/);          // 生タグが出ない
  assert.match(html, /&lt;script&gt;/);            // エスケープ済み
  assert.doesNotMatch(html, /<img src=x/);         // 生の img が出ない
  assert.match(html, /&quot;|&gt;/);               // 引用符/不等号がエスケープ
});

test('rowHtml: 定型 narrative は「AI 分析文なし（入力データ不足）」に置き換える', () => {
  const html = rowHtml({ code: 'XX', name_ja: 'テスト国', score: 10,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
    narrative_ja: '与えたデータには不安定性を示す具体的な事象が記載されていない' });
  assert.match(html, /<p class="ins-narr ins-narr--none">AI 分析文なし（入力データ不足）<\/p>/);
  assert.ok(!html.includes('与えたデータには'), html);
});

test('rowHtml: narrative 欠落も「AI 分析文なし」を出す（無言の空欄にしない）', () => {
  const html = rowHtml({ code: 'YY', name_ja: '別国', score: 5,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true } });
  assert.match(html, /ins-narr--none/);
});

test('rowHtml: 実際の分析文はそのまま（escape 済み）出す', () => {
  const html = rowHtml({ code: 'UP', name_ja: 'ウクライナ', score: 90,
    counts: { conflict: 1, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
    narrative_ja: 'ロシアとの軍事紛争が継続している' });
  assert.match(html, /<p class="ins-narr">ロシアとの軍事紛争が継続している<\/p>/);
  assert.ok(!html.includes('ins-narr--none'), html);
});
