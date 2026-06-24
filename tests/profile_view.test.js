import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFacts, profileHtml } from '../js/lib/drilldown/profile_view.js';

const BASE = {
  profile: {
    id: 'JP-13', level: 'admin1', name_ja: '東京都',
    facts: { population: 13960000, area_km2: 2194, lat: 35.7, lon: 139.7, elevation_m: null },
    sections: [{ title: '概要', body: '首都圏の中心。' }, { title: '気候', body: '太平洋側気候。' }],
    source: { qid: 'Q1490', wikipedia_url: 'https://ja.wikipedia.org/wiki/東京都' }, degraded: false,
  },
  breadcrumb: [{ level: 'country', id: 'JA', name_ja: '日本' }, { level: 'admin1', id: 'JP-13', name_ja: '東京都' }],
  shapePath: { d: 'M0,0 L10,0 L5,5Z', viewBox: '0 0 100 50' },
  miniDot: { lon: 139.7, lat: 35.7 },
  events: [{ emoji: '📰', where: '千代田区', title: '日銀会合' }],
};

test('formatFacts: null を除外し整形（人口/面積/位置/標高）', () => {
  const f = formatFacts(BASE.profile.facts);
  const labels = f.map((x) => x.label);
  assert.ok(labels.includes('人口') && labels.includes('面積') && labels.includes('位置'));
  assert.ok(!labels.includes('標高'));                   // elevation_m=null は出さない
});

test('profileHtml: パンくず・種別バッジ・名前・セクション・出典・形状を含む', () => {
  const h = profileHtml(BASE);
  assert.match(h, /pf-crumbs/);
  assert.match(h, /東京都/);
  assert.match(h, /ADMIN1/);                              // 種別バッジ
  assert.match(h, /pf-shape/);                            // 形状シルエット
  assert.match(h, /viewBox="0 0 100 50"/);
  assert.match(h, /概要/); assert.match(h, /首都圏の中心。/);
  assert.match(h, /pf-events/);                           // イベント折りたたみ
  assert.match(h, /千代田区/);
  assert.match(h, /ja\.wikipedia\.org/);                  // 出典
  assert.match(h, /日本/);                                // パンくず親
});

test('profileHtml: shapePath=null（都市）は形状を出さない', () => {
  const h = profileHtml({ ...BASE, shapePath: null });
  assert.doesNotMatch(h, /pf-shape/);
});

test('profileHtml: degraded はバナー＋facts＋出典・セクション無し', () => {
  // sections は BASE のまま（非空）にして degraded: true だけ変える
  // → degraded フラグ単独でセクションが抑制されることを確認
  const deg = { ...BASE, profile: { ...BASE.profile, degraded: true } };
  const h = profileHtml(deg);
  assert.match(h, /pf-degraded/);
  assert.match(h, /人口|13,960,000|13\.96/);              // facts は出す
  assert.doesNotMatch(h, /pf-sec-h/);                     // セクション見出し無し
});

test('profileHtml: XSS エスケープ（body の < > を素通ししない）', () => {
  const x = { ...BASE, profile: { ...BASE.profile, sections: [{ title: '概要', body: '<img src=x onerror=alert(1)>' }] } };
  const h = profileHtml(x);
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img/);
});

test('profileHtml: events 空はフッタ非表示', () => {
  const h = profileHtml({ ...BASE, events: [] });
  assert.doesNotMatch(h, /pf-events/);
});
