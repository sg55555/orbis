import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFacts, profileHtml } from '../js/lib/drilldown/profile_view.js';

const BASE = {
  profile: {
    id: 'JP-13', level: 'admin1', name_ja: '東京都',
    belongs_to: { level: 'country', id: 'JA', name_ja: '日本' },
    facts: { population: 13960000, area_km2: 2194, lat: 35.7, lon: 139.7, elevation_m: null },
    layers: [
      {
        key: 'geography', title: '地勢・立地', body: '首都圏の中心。',
        confidence: [{ label: 'certain', kind: '地理', note: '座標・気候区分' }],
        evidence: '地理節＝Wikipedia', dig_deeper: ['地形図'],
      },
      {
        key: 'economy', title: '産業の成り立ちと近代化', body: '太平洋側気候。',
        confidence: [], dig_deeper: [],
      },
    ],
    timeline: [{ year: '1868', event: '東京奠都', confidence: 'certain', cause_note: '首都機能集中（推定）' }],
    tourism: ['浅草寺', '東京タワー'],
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

test('profileHtml: パンくず・種別バッジ・名前・レイヤー・出典・形状を含む', () => {
  const h = profileHtml(BASE);
  assert.match(h, /pf-crumbs/);
  assert.match(h, /東京都/);
  assert.match(h, /ADMIN1/);                              // 種別バッジ
  assert.match(h, /pf-shape/);                            // 形状シルエット
  assert.match(h, /viewBox="0 0 100 50"/);
  assert.match(h, /pf-layer/);
  assert.match(h, /地勢・立地/); assert.match(h, /首都圏の中心。/);
  assert.match(h, /pf-events/);                           // イベント折りたたみ
  assert.match(h, /千代田区/);
  assert.match(h, /ja\.wikipedia\.org/);                  // 出典
  assert.match(h, /日本/);                                // パンくず親
});

test('profileHtml: shapePath=null（都市）は形状を出さない', () => {
  const h = profileHtml({ ...BASE, shapePath: null });
  assert.doesNotMatch(h, /pf-shape/);
});

test('profileHtml: degraded はバナー＋facts＋出典・レイヤー無し', () => {
  // layers は BASE のまま（非空）にして degraded: true だけ変える
  // → degraded フラグ単独でレイヤーが抑制されることを確認
  const deg = { ...BASE, profile: { ...BASE.profile, degraded: true } };
  const h = profileHtml(deg);
  assert.match(h, /pf-degraded/);
  assert.match(h, /人口|13,960,000|13\.96/);              // facts は出す
  assert.doesNotMatch(h, /pf-layer-h/);                   // レイヤー見出し無し
  assert.doesNotMatch(h, /pf-tourism/);                   // 観光枠も無し
});

test('profileHtml: XSS エスケープ（layer body の < > を素通ししない）', () => {
  const x = {
    ...BASE,
    profile: {
      ...BASE.profile,
      layers: [{ key: 'geography', title: '地勢・立地', body: '<img src=x onerror=alert(1)>', confidence: [], dig_deeper: [] }],
    },
  };
  const h = profileHtml(x);
  assert.doesNotMatch(h, /<img src=x/);
  assert.match(h, /&lt;img/);
});

test('profileHtml: events 空はフッタ非表示', () => {
  const h = profileHtml({ ...BASE, events: [] });
  assert.doesNotMatch(h, /pf-events/);
});

test('profileHtml: event の where が空文字のとき " — " セパレータが出ない', () => {
  // timeline の cause_note も " — " を出すため、このテストでは timeline を空にして
  // events 側のセパレータ抑制だけを対象にする
  const h = profileHtml({
    ...BASE,
    profile: { ...BASE.profile, timeline: [] },
    events: [{ emoji: '📰', where: '', title: '無地名イベント' }],
  });
  assert.match(h, /無地名イベント/);
  assert.doesNotMatch(h, / — /, 'where が空のとき em-dash セパレータは出力されない');
});

// ── v2 スキーマ: layers/確度/年表/観光/belongs_to ──

test('profileHtml: layers・確度バッジ・年表・観光を描画する（brief核心）', () => {
  const html = profileHtml({
    profile: {
      id: 'SG', level: 'country', name_ja: 'シンガポール', belongs_to: null, facts: {},
      layers: [{
        key: 'economy', title: '産業', body: '積層した。',
        confidence: [{ label: 'inferred', kind: '因果', note: '立地が駆動' }],
        evidence: '経済節', dig_deeper: ['GDP構成'],
      }],
      timeline: [{ year: '1819', event: '開港', confidence: 'certain', cause_note: '立地(推定)' }],
      tourism: ['マーライオン'], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.ok(html.includes('積層した'));
  assert.ok(html.includes('推定') && html.includes('立地が駆動'));
  assert.ok(html.includes('1819') && html.includes('マーライオン'));
});

test('profileHtml: city で diplomacy 欠落時に belongs_to リンクを出す（brief核心）', () => {
  const html = profileHtml({
    profile: {
      id: 'Q1', level: 'city', name_ja: '大阪市',
      belongs_to: { level: 'country', id: 'JP', name_ja: '日本' }, facts: {},
      layers: [{ key: 'geography', title: '地勢', body: 'x', confidence: [], dig_deeper: [] }],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.ok(html.includes('日本'));
  assert.match(html, /data-level="country"/);
  assert.match(html, /data-id="JP"/);
});

test('profileHtml: country は belongs_to があってもリンクを出さない', () => {
  const html = profileHtml({
    profile: {
      id: 'JP', level: 'country', name_ja: '日本',
      belongs_to: { level: 'country', id: 'JP', name_ja: '日本' }, facts: {},
      layers: [{ key: 'geography', title: '地勢', body: 'x', confidence: [], dig_deeper: [] }],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.doesNotMatch(html, /pf-belongs/);
});

test('profileHtml: diplomacy レイヤーがあれば belongs_to リンクを出さない', () => {
  const html = profileHtml({
    profile: {
      id: 'Q1', level: 'city', name_ja: '大阪市',
      belongs_to: { level: 'country', id: 'JP', name_ja: '日本' }, facts: {},
      layers: [
        { key: 'geography', title: '地勢', body: 'x', confidence: [], dig_deeper: [] },
        { key: 'diplomacy', title: '外交姿勢', body: '要鮮度の外交記述。', confidence: [], dig_deeper: [] },
      ],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.doesNotMatch(html, /pf-belongs/);
});

test('profileHtml: belongs_to が無ければリンクを出さない（degraded等）', () => {
  const html = profileHtml({
    profile: {
      id: 'Q1', level: 'city', name_ja: '大阪市', belongs_to: null, facts: {},
      layers: [{ key: 'geography', title: '地勢', body: 'x', confidence: [], dig_deeper: [] }],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.doesNotMatch(html, /pf-belongs/);
});

test('profileHtml: timeline は economy レイヤー直後・他レイヤーの後ろではない', () => {
  const html = profileHtml({
    profile: {
      id: 'JP', level: 'country', name_ja: '日本', belongs_to: null, facts: {},
      layers: [
        { key: 'geography', title: '地勢', body: '地勢本文', confidence: [], dig_deeper: [] },
        { key: 'economy', title: '産業', body: '産業本文', confidence: [], dig_deeper: [] },
        { key: 'society', title: '社会', body: '社会本文', confidence: [], dig_deeper: [] },
      ],
      timeline: [{ year: '1868', event: '明治維新', confidence: 'certain', cause_note: null }],
      tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  const iEconomy = html.indexOf('産業本文');
  const iTimeline = html.indexOf('pf-timeline');
  const iSociety = html.indexOf('社会本文');
  assert.ok(iEconomy >= 0 && iTimeline > iEconomy && iTimeline < iSociety,
    'timeline は economy 本文の後・society 本文の前に挿入される');
});

test('profileHtml: evidence/dig_deeper を末尾ブロックで描画する', () => {
  const html = profileHtml({
    profile: {
      id: 'JP', level: 'country', name_ja: '日本', belongs_to: null, facts: {},
      layers: [{
        key: 'geography', title: '地勢・立地', body: '本文',
        confidence: [{ label: 'time_sensitive', kind: '時事', note: '要確認' }],
        evidence: '座標＝Wikidata', dig_deeper: ['シーレーン地図', '通航量'],
      }],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.match(html, /根拠/); assert.match(html, /座標＝Wikidata/);
  assert.match(html, /深掘り/); assert.match(html, /シーレーン地図/); assert.match(html, /通航量/);
  assert.match(html, /要鮮度/); // confidence label ja
});

test('profileHtml: layers/timeline/tourism/confidence/evidence/dig_deeper の悪意ある文字列を escape する', () => {
  const evil = '<script>alert(1)</script>';
  const html = profileHtml({
    profile: {
      id: 'JP', level: 'country', name_ja: '日本', belongs_to: null, facts: {},
      layers: [{
        key: 'economy', title: evil, body: evil,
        confidence: [{ label: 'certain', kind: evil, note: evil }],
        evidence: evil, dig_deeper: [evil],
      }],
      timeline: [{ year: evil, event: evil, confidence: 'certain', cause_note: evil }],
      tourism: [evil], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('&lt;script&gt;'));
});

test('profileHtml: belongs_to.name_ja の悪意ある文字列を escape する', () => {
  const evil = '<script>alert(1)</script>';
  const html = profileHtml({
    profile: {
      id: 'Q1', level: 'city', name_ja: '大阪市',
      belongs_to: { level: 'country', id: 'JP', name_ja: evil }, facts: {},
      layers: [{ key: 'geography', title: '地勢', body: 'x', confidence: [], dig_deeper: [] }],
      timeline: [], tourism: [], source: {}, degraded: false,
    },
    breadcrumb: [], events: [],
  });
  assert.doesNotMatch(html, /<script>/);
  assert.ok(html.includes('&lt;script&gt;'));
});
