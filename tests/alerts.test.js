import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectAlerts, alertChipHtml } from '../js/ui/alerts.js';

// --- テスト用データ ---
function insCountry(over = {}) {
  return {
    code: 'XX', name_ja: 'テスト国', score: 50, lat: 10, lon: 20,
    trend: { isNew: false, dod: { dir: 'up', delta: 3 }, normal: { dir: 'up', deltaPct: 30 } },
    ...over,
  };
}
function fcCard(over = {}) {
  return {
    domain: 'conflict', place_ja: 'どこか', attention_score: 70, trend: 'up',
    status: 'active', lat: 5, lon: 6, ...over,
  };
}

test('selectAlerts: 平常比が閾値以上で上昇中の国を採用（平常比降順）', () => {
  const ins = { countries: [
    insCountry({ code: 'A', name_ja: 'A国', trend: { isNew: false, normal: { dir: 'up', deltaPct: 20 } } }),
    insCountry({ code: 'B', name_ja: 'B国', trend: { isNew: false, normal: { dir: 'up', deltaPct: 60 } } }),
  ] };
  const out = selectAlerts(ins, null, { insMinDeltaPct: 15, fcMinScore: 999 });
  assert.equal(out.length, 2);
  assert.equal(out[0].label, 'B国', '平常比が大きいB国が先頭');
  assert.equal(out[0].kind, 'instability');
  assert.equal(out[0].lon, 20);
  assert.match(out[0].detail, /\+60%/);
});

test('selectAlerts: 閾値未満・非上昇・新規・平常比なしは除外', () => {
  const ins = { countries: [
    insCountry({ code: 'A', trend: { isNew: false, normal: { dir: 'up', deltaPct: 5 } } }),      // 閾値未満
    insCountry({ code: 'B', trend: { isNew: false, normal: { dir: 'down', deltaPct: -40 } } }),  // 下降
    insCountry({ code: 'C', trend: { isNew: true } }),                                            // 新規
    insCountry({ code: 'D', trend: { isNew: false, dod: { dir: 'up', delta: 9 } } }),             // 平常比なし
  ] };
  const out = selectAlerts(ins, null, { insMinDeltaPct: 15, fcMinScore: 999 });
  assert.equal(out.length, 0);
});

test('selectAlerts: forecast は注視度が閾値以上かつ上昇中のみ採用（watch/低/非上昇は除外）', () => {
  const fc = { cards: [
    fcCard({ place_ja: 'P1', attention_score: 80, trend: 'up' }),
    fcCard({ place_ja: 'P2', attention_score: 80, trend: 'flat' }),     // 非上昇
    fcCard({ place_ja: 'P3', attention_score: 40, trend: 'up' }),       // 低スコア
    fcCard({ place_ja: 'P4', attention_score: 90, trend: 'up', status: 'watch' }), // watch
  ] };
  const out = selectAlerts(null, fc, { insMinDeltaPct: 999, fcMinScore: 60 });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'forecast');
  assert.match(out[0].label, /P1/);
});

test('selectAlerts: instability(%)と forecast(注視度)を正規化して重大度降順に統合', () => {
  // instability の正規化重大度 = min(100, deltaPct/3)。forecast = attention_score。
  const ins = { countries: [
    insCountry({ code: 'A', name_ja: 'A国', score: 50, trend: { isNew: false, normal: { dir: 'up', deltaPct: 300 } } }), // sev=100
    insCountry({ code: 'B', name_ja: 'B国', score: 50, trend: { isNew: false, normal: { dir: 'up', deltaPct: 30 } } }),  // sev=10
  ] };
  const fc = { cards: [
    fcCard({ place_ja: 'P1', attention_score: 70, trend: 'up' }), // sev=70
  ] };
  const out = selectAlerts(ins, fc, { insMinDeltaPct: 15, fcMinScore: 60, limit: 3 });
  assert.equal(out.length, 3);
  assert.equal(out[0].label, 'A国', '大スパイク(sev100)が先頭');
  assert.match(out[1].label, /P1/, 'forecast(sev70)が2番目＝両種が混在');
  assert.equal(out[2].label, 'B国', '小スパイク(sev10)が最後');
});

test('selectAlerts: 低スコア国の極端%は除外（低ベースラインのノイズ抑制）', () => {
  const ins = { countries: [
    insCountry({ code: 'A', name_ja: '小母数国', score: 5, trend: { isNew: false, normal: { dir: 'up', deltaPct: 800 } } }),
    insCountry({ code: 'B', name_ja: '本物国', score: 40, trend: { isNew: false, normal: { dir: 'up', deltaPct: 50 } } }),
  ] };
  const out = selectAlerts(ins, null, { insMinDeltaPct: 15, insMinScore: 12, fcMinScore: 999 });
  assert.equal(out.length, 1, 'score<12 の小母数国は除外');
  assert.equal(out[0].label, '本物国');
});

test('selectAlerts: instability の同一 code は重複排除（最大平常比を残す）', () => {
  const ins = { countries: [
    insCountry({ code: 'A', name_ja: 'A国', trend: { isNew: false, normal: { dir: 'up', deltaPct: 20 } } }),
    insCountry({ code: 'A', name_ja: 'A国', trend: { isNew: false, normal: { dir: 'up', deltaPct: 50 } } }),
  ] };
  const out = selectAlerts(ins, null, { insMinDeltaPct: 15, fcMinScore: 999 });
  assert.equal(out.length, 1);
  assert.match(out[0].detail, /\+50%/);
});

test('selectAlerts: null/空入力は空配列', () => {
  assert.deepEqual(selectAlerts(null, null), []);
  assert.deepEqual(selectAlerts({ countries: [] }, { cards: [] }), []);
});

test('alertChipHtml: label/detail を HTML エスケープしつつ kind クラスを付与', () => {
  const html = alertChipHtml({ kind: 'forecast', label: '<x>&"', detail: 'a<b', severity: 80 });
  assert.match(html, /alert-forecast/);
  assert.ok(!html.includes('<x>'), '生の<x>を含まない');
  assert.match(html, /&lt;x&gt;/);
  assert.match(html, /a&lt;b/);
});
