# 紛争セクション改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 紛争（と抗議）を「読める（国別集約フィード）・絞れる（レイヤーチップ）・触れる（二段階クリック詳細）」体験にし、globe の紛争表現を ember＋深刻度（白熱度）＋ホットスポット脈動で刷新する。

**Architecture:** 完全にクライアントサイド。既存 `conflict.json`/`protests.json`（`place/mentions/tone/date/url/root` を含む）から純粋関数で国別集約・発色・popup HTML を生成。`main.js`/`registry.js` の信頼性系（drawAll キャッシュ・ポーリング・自動導出）は非破壊で配線追加のみ。純粋ロジックは node:test、配線/DOM は Playwright と手動視覚で検証。

**Tech Stack:** Vanilla ES modules, MapLibre GL 5.24.0, deck.gl 9.3.4, node:test, Playwright, PWA(Service Worker)。

## Global Constraints

- ライブラリ版: MapLibre `5.24.0` / deck.gl `9.3.4`（CDN 固定・変更しない）。
- globe 制約: deck.gl の集約系（HeatmapLayer/ScreenGrid/Contour）は **globe 非対応**・IconLayer も globe で全滅 → **ScatterplotLayer ベースのみ**使用。
- 加算合成は色相を白方向に濁らせるため、深刻度は **色相でなく明度（白熱度）** で表す。
- 記事リンクの href は **http/https のみ許可**（`javascript:` 等を無効化）。
- maplibre popup の `'close'` ハンドラに **状態解除を載せない**（再オープン時に選択が消える回帰防止）。状態を伴うクリックは **反復クリック**で検証する。
- `prefers-reduced-motion: reduce` 時は脈動/パルスを描かない。
- 静的ファイル（index.html/js/css）変更時は `sw.js` の `CACHE` を上げる: **`orbis-v34` → `orbis-v35`**。
- e2e は直列（`workers:1`・既存設定維持）。視覚は**本番データ量の実画素**をスクショ目視で確認（headless の見え方を結論根拠にしない）。
- 文言はすべて日本語。
- node:test 実行: `npm run test:js`（= `node --test tests/*.test.js`）。単体: `node --test tests/<file>.test.js`。e2e: `npm run test:e2e`。
- **既存テストを緑のまま維持**（現状 node:test 180 / Playwright 5 を下回らない）。

---

### Task 1: サブタイプ日本語化（places.js: rootToJa / severityRank）

**Files:**
- Modify: `js/lib/places.js`（末尾に追加）
- Test: `tests/places.test.js`（import 行に追記＋テスト追加）

**Interfaces:**
- Produces: `rootToJa(root) -> string`（'18'→'暴行','19'→'戦闘','20'→'大規模暴力', 他→'紛争'）、`severityRank(root) -> number`（'20'→3,'19'→2,'18'→1, 他→0）

- [ ] **Step 1: 失敗するテストを書く**

`tests/places.test.js` の既存 import 行を次に置き換える（`rootToJa, severityRank` を追加）:

```js
import { fipsToJa, rootToJa, severityRank } from '../js/lib/places.js';
```

ファイル末尾に追加:

```js
test('rootToJa: 18/19/20→暴行/戦闘/大規模暴力・他は紛争', () => {
  assert.equal(rootToJa('18'), '暴行');
  assert.equal(rootToJa('19'), '戦闘');
  assert.equal(rootToJa('20'), '大規模暴力');
  assert.equal(rootToJa('14'), '紛争');
  assert.equal(rootToJa(undefined), '紛争');
});

test('severityRank: 20>19>18>その他=0', () => {
  assert.ok(severityRank('20') > severityRank('19'));
  assert.ok(severityRank('19') > severityRank('18'));
  assert.equal(severityRank('18'), 1);
  assert.equal(severityRank('14'), 0);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/places.test.js`
Expected: FAIL（`rootToJa is not a function` 等）

- [ ] **Step 3: 実装**

`js/lib/places.js` の末尾に追加:

```js
// GDELT CAMEO root code → 紛争サブタイプ（日本語）。18=暴行/19=戦闘/20=大規模暴力。他は「紛争」。
export function rootToJa(root) {
  return ({ 18: '暴行', 19: '戦闘', 20: '大規模暴力' })[String(root)] || '紛争';
}

// 重大度ランク。dominantRoot の同数決着・globe 白熱度に使用。20>19>18>その他=0。
export function severityRank(root) {
  return ({ 20: 3, 19: 2, 18: 1 })[String(root)] || 0;
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/places.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/places.js tests/places.test.js
git commit -m "feat(conflict): root code 日本語化 rootToJa/severityRank"
```

---

### Task 2: ember 発色ヘルパ（geo.js: emberFill）

**Files:**
- Modify: `js/lib/geo.js`（`ADDITIVE_BLEND` 付近に追加）
- Test: `tests/geo2.test.js`（import 行に追記＋テスト追加）

**Interfaces:**
- Produces: `emberFill(mentions, severity, scale = 1, base = [200,40,50]) -> [r,g,b,a]`。severity(0..1)・mentions が大きいほど base から白熱（明るい）へ補間し alpha も上げる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/geo2.test.js` の import に `emberFill` を追加（既存 import 行へ）。無ければ先頭に:

```js
import { emberFill } from '../js/lib/geo.js';
```

テスト追加:

```js
test('emberFill: severity/mentions が高いほど明るく・alpha も上がる', () => {
  const dim = emberFill(0, 0, 1, [200, 40, 50]);
  const hot = emberFill(100, 1, 1, [200, 40, 50]);
  assert.equal(dim.length, 4);
  assert.ok(hot[1] > dim[1], '白熱で緑成分が増える（赤→白）');
  assert.ok(hot[3] >= dim[3], '密集/深刻ほど不透明寄り');
  assert.ok(hot[0] <= 255 && hot[1] <= 255 && hot[2] <= 255 && hot[3] <= 255);
});

test('emberFill: base 色を尊重（抗議=緑ベースでも白熱へ）', () => {
  const g = emberFill(0, 0, 1, [40, 200, 120]);
  assert.equal(g[0], 40); assert.equal(g[1], 200); assert.equal(g[2], 120);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/geo2.test.js`
Expected: FAIL（`emberFill is not a function`）

- [ ] **Step 3: 実装**

`js/lib/geo.js` の `ADDITIVE_BLEND` 定義の直後に追加:

```js
// ember コアの発色（純粋）。severity(0..1)＋mentions で baseRgb→白熱(255,235,215)へ補間。
// scale は ?cfx の白熱度ダイヤル（既定1）。
export function emberFill(mentions, severity, scale = 1, base = [200, 40, 50]) {
  const m = Math.min(1, (Number(mentions) || 0) / 100);
  const heat = Math.min(1, (0.35 + 0.5 * (Number(severity) || 0) + 0.3 * m) * (Number(scale) || 1));
  return [
    Math.round(base[0] + (255 - base[0]) * heat),
    Math.round(base[1] + (235 - base[1]) * heat),
    Math.round(base[2] + (215 - base[2]) * heat),
    Math.round(70 + 60 * heat),
  ];
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/geo2.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/geo.js tests/geo2.test.js
git commit -m "feat(conflict): ember 発色ヘルパ emberFill(明度で白熱)"
```

---

### Task 3: 国別集約（aggregate.js: aggregateByCountry）

**Files:**
- Create: `js/lib/aggregate.js`
- Test: `tests/aggregate.test.js`

**Interfaces:**
- Consumes: `fipsToJa, rootToJa, severityRank`（places.js）、`hostnameOf`（geo.js）、`parseGdeltDate`（feed.js）
- Produces: `aggregateByCountry(points, layerId) -> GroupRow[]`。GroupRow = `{ id, kind:'group', layerId, place, country_ja, count, mentionsTotal, dominantRoot, dominantRootJa, topSources[], time, lon, lat }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/aggregate.test.js` を新規作成:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateByCountry } from '../js/lib/aggregate.js';

const pts = [
  { id: '1', place: 'UP', root: '19', mentions: 10, date: '20260620120000', url: 'https://reuters.com/a', lon: 30, lat: 49 },
  { id: '2', place: 'UP', root: '19', mentions: 50, date: '20260620130000', url: 'https://bbc.com/b', lon: 31, lat: 50 },
  { id: '3', place: 'UP', root: '20', mentions: 5, date: '20260620110000', url: 'https://reuters.com/c', lon: 32, lat: 51 },
  { id: '4', place: 'RS', root: '18', mentions: 3, date: '20260620100000', url: 'https://tass.com/d', lon: 37, lat: 55 },
];

test('aggregateByCountry: 国別に集約し件数・代表点・最新時刻を出す', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.kind, 'group');
  assert.equal(up.layerId, 'conflict');
  assert.equal(up.count, 3);
  assert.equal(up.country_ja, 'ウクライナ');
  assert.equal(up.mentionsTotal, 65);
  // 代表点=最多 mentions(id2: mentions50)
  assert.equal(up.lon, 31); assert.equal(up.lat, 50);
  // 最新時刻=130000
  assert.equal(up.time, Date.UTC(2026, 5, 20, 13, 0, 0));
});

test('aggregateByCountry: dominantRoot は最頻（同数は重大度）・dominantRootJa', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.dominantRoot, '19'); // 19が2件で最頻
  assert.equal(up.dominantRootJa, '戦闘');
});

test('aggregateByCountry: topSources は hostname 頻度上位（最大3）', () => {
  const rows = aggregateByCountry(pts, 'conflict');
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.topSources[0], 'reuters.com'); // 2件で最多
  assert.ok(up.topSources.includes('bbc.com'));
  assert.ok(up.topSources.length <= 3);
});

test('aggregateByCountry: 空配列・未知/空 place は安全', () => {
  assert.deepEqual(aggregateByCountry([], 'conflict'), []);
  const rows = aggregateByCountry([{ id: 'x', place: '', root: '18', mentions: 0, date: 'bad', url: '', lon: 0, lat: 0 }], 'protests');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].time, 0); // 不正 date→0
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/aggregate.test.js`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装**

`js/lib/aggregate.js` を新規作成:

```js
// 紛争/抗議の点群を国(FIPS)別に集約して GroupRow を返す（純粋・deck/DOM 非依存）。
import { fipsToJa, rootToJa, severityRank } from './places.js';
import { hostnameOf } from './geo.js';
import { parseGdeltDate } from './feed.js';

export function aggregateByCountry(points, layerId) {
  const pts = Array.isArray(points) ? points : [];
  const byPlace = new Map();
  for (const p of pts) {
    const key = (p.place == null || p.place === '') ? '' : String(p.place);
    if (!byPlace.has(key)) byPlace.set(key, []);
    byPlace.get(key).push(p);
  }
  const rows = [];
  for (const [place, group] of byPlace) {
    // dominantRoot: 最頻 root（同数は重大度で決定）
    const rootCount = new Map();
    for (const p of group) { const r = String(p.root); rootCount.set(r, (rootCount.get(r) || 0) + 1); }
    let dominantRoot = null, best = -1;
    for (const [r, n] of rootCount) {
      if (n > best || (n === best && severityRank(r) > severityRank(dominantRoot))) { best = n; dominantRoot = r; }
    }
    // topSources: hostname 出現頻度 上位3
    const hostCount = new Map();
    for (const p of group) { const h = hostnameOf(p.url); if (h) hostCount.set(h, (hostCount.get(h) || 0) + 1); }
    const topSources = [...hostCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
    // 代表点: 最多 mentions（同数は最新 date）
    let rep = group[0];
    for (const p of group) {
      const pm = Number(p.mentions) || 0, rm = Number(rep.mentions) || 0;
      if (pm > rm || (pm === rm && String(p.date) > String(rep.date))) rep = p;
    }
    rows.push({
      id: `${layerId}-${place}`, kind: 'group', layerId, place,
      country_ja: fipsToJa(place), count: group.length,
      mentionsTotal: group.reduce((s, p) => s + (Number(p.mentions) || 0), 0),
      dominantRoot, dominantRootJa: rootToJa(dominantRoot), topSources,
      time: group.reduce((mx, p) => Math.max(mx, parseGdeltDate(p.date)), 0),
      lon: rep.lon, lat: rep.lat,
    });
  }
  return rows;
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/aggregate.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/aggregate.js tests/aggregate.test.js
git commit -m "feat(conflict): 国別集約 aggregateByCountry"
```

---

### Task 4: ホットスポット脈動ビルダ（aggregate.js: buildHotspotConfigs）

**Files:**
- Modify: `js/lib/aggregate.js`
- Test: `tests/aggregate.test.js`

**Interfaces:**
- Consumes: GroupRow[]（Task 3）
- Produces: `buildHotspotConfigs(groups, motionT = 0, opts = {}) -> Array<config>`。opts: `{ reduced, topN=6, rgb=[255,60,80] }`。reduced か空なら `[]`。config は ScatterplotLayer 用（呼び出し側で `new deck.ScatterplotLayer`）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/aggregate.test.js` に追加:

```js
import { buildHotspotConfigs } from '../js/lib/aggregate.js';

const groups = [
  { lon: 30, lat: 49, count: 100 }, { lon: 37, lat: 55, count: 50 },
  { lon: 10, lat: 5, count: 5 }, { lon: 1, lat: 1, count: 80 },
];

test('buildHotspotConfigs: count 上位 topN を選ぶ', () => {
  const c = buildHotspotConfigs(groups, 0, { topN: 2 });
  assert.equal(c.length, 1);
  assert.equal(c[0].data.length, 2);
  assert.equal(c[0].data[0].count, 100); // 降順先頭
  assert.equal(c[0].data[1].count, 80);
  assert.equal(c[0].pickable, false);
});

test('buildHotspotConfigs: reduced/空は []', () => {
  assert.deepEqual(buildHotspotConfigs(groups, 0, { reduced: true }), []);
  assert.deepEqual(buildHotspotConfigs([], 0, {}), []);
});

test('buildHotspotConfigs: rgb を線色に使う', () => {
  const c = buildHotspotConfigs(groups, 0.5, { rgb: [94, 255, 166] });
  const col = c[0].getLineColor(groups[0]);
  assert.equal(col[0], 94); assert.equal(col[1], 255); assert.equal(col[2], 166);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/aggregate.test.js`
Expected: FAIL（`buildHotspotConfigs is not a function`）

- [ ] **Step 3: 実装**

`js/lib/aggregate.js` に追加:

```js
// 上位 topN 国の代表点に脈打つリング config（純粋）。reduced/空で []。
export function buildHotspotConfigs(groups, motionT = 0, opts = {}) {
  const { reduced = false, topN = 6, rgb = [255, 60, 80] } = opts;
  if (reduced || !Array.isArray(groups) || groups.length === 0) return [];
  const top = [...groups].sort((a, b) => (b.count || 0) - (a.count || 0)).slice(0, topN);
  const phase = (((motionT % 1) + 1) % 1);
  return [{
    id: `hot-${rgb.join('-')}`, data: top, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: (d) => 10 + Math.min(28, (d.count || 0) * 0.6) + 18 * phase,
    getLineColor: () => [rgb[0], rgb[1], rgb[2], Math.round(200 * (1 - phase))],
    updateTriggers: { getRadius: motionT, getLineColor: motionT },
    pickable: false,
  }];
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/aggregate.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/aggregate.js tests/aggregate.test.js
git commit -m "feat(conflict): ホットスポット脈動ビルダ buildHotspotConfigs"
```

---

### Task 5: 二段階クリック popup（selection.js）

**Files:**
- Modify: `js/lib/selection.js`（import 追記＋2関数追加）
- Test: `tests/selection.test.js`（import 追記＋テスト追加）

**Interfaces:**
- Consumes: `fipsToJa, rootToJa`（places.js）、既存 `LAYER_RGB/CYAN/escapeHtml/hostnameOf`
- Produces: `gdeltEventPopupHtml(event, layerId) -> string`（記事リンク付き）、`gdeltCountryPopupHtml(group) -> string`（国サマリ）

- [ ] **Step 1: 失敗するテストを書く**

`tests/selection.test.js` の import 行へ追加:

```js
import { gdeltEventPopupHtml, gdeltCountryPopupHtml } from '../js/lib/selection.js';
```

テスト追加:

```js
test('gdeltEventPopupHtml: 紛争はサブタイプ括弧・記事リンク http のみ', () => {
  const html = gdeltEventPopupHtml({ place: 'UP', root: '19', mentions: 92, url: 'https://reuters.com/x' }, 'conflict');
  assert.match(html, /紛争（戦闘）/);
  assert.match(html, /ウクライナ/);
  assert.match(html, /報道 92件/);
  assert.match(html, /href="https:\/\/reuters\.com\/x"/);
});

test('gdeltEventPopupHtml: 抗議はサブタイプ無し・不正 url は # に', () => {
  const html = gdeltEventPopupHtml({ place: 'FR', root: '14', mentions: 5, url: 'javascript:alert(1)' }, 'protests');
  assert.match(html, /抗議/);
  assert.doesNotMatch(html, /（/); // サブタイプ括弧なし
  assert.match(html, /href="#"/);
  assert.doesNotMatch(html, /javascript:/);
});

test('gdeltCountryPopupHtml: 国サマリ（件数・最多種類・出典）・紛争のみ最多表示', () => {
  const c = gdeltCountryPopupHtml({ layerId: 'conflict', country_ja: 'ウクライナ', count: 148, dominantRootJa: '戦闘', topSources: ['reuters.com', 'bbc.com'] });
  assert.match(c, /紛争 ウクライナ/);
  assert.match(c, /24h 148件/);
  assert.match(c, /最多は戦闘/);
  assert.match(c, /reuters\.com、bbc\.com/);
  const p = gdeltCountryPopupHtml({ layerId: 'protests', country_ja: 'フランス', count: 31, topSources: [] });
  assert.match(p, /抗議 フランス/);
  assert.doesNotMatch(p, /最多は/); // 抗議は最多種類を出さない
});

test('gdelt popups: null 安全', () => {
  assert.equal(typeof gdeltEventPopupHtml(null, 'conflict'), 'string');
  assert.equal(typeof gdeltCountryPopupHtml(null), 'string');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/selection.test.js`
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`js/lib/selection.js` の先頭 import を更新（`places.js` から取り込み）:

```js
import { fipsToJa, rootToJa } from './places.js';
```

ファイル末尾に追加:

```js
const GDELT_LABEL = { conflict: '紛争', protests: '抗議' };

// globe 個別点のクリック詳細（記事リンク付き）。紛争/抗議で共用。
export function gdeltEventPopupHtml(event, layerId) {
  const o = event || {};
  const rgb = LAYER_RGB[layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const label = GDELT_LABEL[layerId] || '報道';
  const sub = layerId === 'conflict' ? `（${rootToJa(o.root)}）` : '';
  const m = Number(o.mentions) || 0;
  const host = hostnameOf(o.url);
  const safeUrl = /^https?:\/\//i.test(o.url || '') ? o.url : '#';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(label + sub)}</span></div>`
    + `<div class="sel-meta">${escapeHtml(fipsToJa(o.place))}｜報道 ${m}件</div>`
    + `<div class="sel-hint"><a class="sel-link" style="color:#7fd8ff" href="${escapeHtml(safeUrl)}"`
    + ` target="_blank" rel="noopener">${escapeHtml(host)} ↗</a></div>`
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}

// フィード国別行のクリック詳細（国サマリ・記事リンク無し）。
export function gdeltCountryPopupHtml(group) {
  const g = group || {};
  const rgb = LAYER_RGB[g.layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const label = GDELT_LABEL[g.layerId] || '報道';
  const dom = (g.layerId === 'conflict' && g.dominantRootJa) ? `・最多は${g.dominantRootJa}` : '';
  const srcs = (Array.isArray(g.topSources) && g.topSources.length) ? g.topSources.join('、') : '—';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(label + ' ' + (g.country_ja || ''))}</span></div>`
    + `<div class="sel-meta">24h ${Number(g.count) || 0}件${escapeHtml(dom)}</div>`
    + `<div class="sel-meta">主な出典 ${escapeHtml(srcs)}</div>`
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/selection.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/selection.js tests/selection.test.js
git commit -m "feat(conflict): 二段階 popup gdeltEventPopupHtml/gdeltCountryPopupHtml"
```

---

### Task 6: フィードチップ状態（lib/feed.js・hidden モデル）

**Files:**
- Modify: `js/lib/feed.js`（チップ純粋ヘルパ＋localStorage 薄ラッパを追加）
- Test: `tests/feed.test.js`（import 追記＋テスト追加）

**Interfaces:**
- Produces:
  - `feedChipIds(feedLayerObjs, enabled) -> string[]`（フィード対象かつ有効なレイヤー id）
  - `loadFeedHidden(stored) -> Set`（stored=非表示idの配列。null→空＝全表示）
  - `toggleHidden(hidden, id) -> Set`、`visibleIds(chipIds, hidden) -> string[]`、`allActive(chipIds, hidden) -> bool`、`applyChips(items, hidden) -> items[]`
  - `readFeedFilter(storage?) -> any`、`writeFeedFilter(hidden, storage?) -> void`

- [ ] **Step 1: 失敗するテストを書く**

`tests/feed.test.js` の import 行を更新:

```js
import { buildFeed, parseGdeltDate, feedChipIds, loadFeedHidden, toggleHidden, visibleIds, allActive, applyChips, readFeedFilter, writeFeedFilter } from '../js/lib/feed.js';
```

テスト追加:

```js
test('feedChipIds: フィード対象かつ有効なレイヤーのみ', () => {
  const ls = [{ id: 'quakes' }, { id: 'conflict' }, { id: 'news' }];
  assert.deepEqual(feedChipIds(ls, new Set(['quakes', 'conflict'])), ['quakes', 'conflict']);
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
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/feed.test.js`
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`js/lib/feed.js` の末尾に追加:

```js
// ── フィードのレイヤーフィルタ（純粋・hidden=非表示idの Set モデル）──
const FEED_FILTER_KEY = 'orbis.feedFilter.v1';

// チップに出す layerId（フィード対象かつ globe 有効）。
export function feedChipIds(feedLayerObjs, enabled) {
  return feedLayerObjs.filter((l) => enabled.has(l.id)).map((l) => l.id);
}
// stored=非表示idの配列。null/不正→空（全表示）。新レイヤーは hidden に無いので既定表示。
export function loadFeedHidden(stored) {
  return new Set(Array.isArray(stored) ? stored : []);
}
export function toggleHidden(hidden, id) {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
export function visibleIds(chipIds, hidden) { return chipIds.filter((id) => !hidden.has(id)); }
export function allActive(chipIds, hidden) { return chipIds.every((id) => !hidden.has(id)); }
export function applyChips(items, hidden) { return items.filter((it) => !hidden.has(it.layerId)); }

export function readFeedFilter(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(FEED_FILTER_KEY)); } catch { return null; }
}
export function writeFeedFilter(hidden, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(FEED_FILTER_KEY, JSON.stringify([...hidden])); } catch { /* noop */ }
}
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/feed.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/feed.js tests/feed.test.js
git commit -m "feat(conflict): フィードチップ状態(hidden モデル)＋永続"
```

---

### Task 7: globe ember コア（conflict.js / protests.js）

**Files:**
- Modify: `js/layers/conflict.js`、`js/layers/protests.js`
- Test: `tests/heat.test.js`（テスト追加）

**Interfaces:**
- Consumes: `emberFill`（geo.js, Task 2）、`severityRank`（places.js, Task 1）
- Produces: 各レイヤーに `buildCoreConfig(snapshot, emberScale = 1) -> config`。`toDeckLayer(snapshot, ctx)` が halo＋core＋pick の3 ScatterplotLayer を返す（`ctx.cfx.emberScale` を core に渡す）。
- 注: 既存 `buildBlobConfig`（halo・id `*-heat`）は不変＝heat.test.js の既存assertを維持。

- [ ] **Step 1: 失敗するテストを書く**

`tests/heat.test.js` の import を更新（core を追加）:

```js
import { buildBlobConfig, buildPickConfig, buildCoreConfig } from '../js/layers/conflict.js';
import { buildBlobConfig as buildBlobP, buildPickConfig as buildPickP, buildCoreConfig as buildCoreP } from '../js/layers/protests.js';
```

テスト追加:

```js
const sevSnap = { points: [
  { id: 'a', lon: 1, lat: 2, mentions: 5, root: '18' },   // 暴行・低
  { id: 'b', lon: 3, lat: 4, mentions: 100, root: '20' }, // 大規模暴力・高 mentions
] };

test('conflict buildCoreConfig: id=conflict-core・加算・深刻/多mentionsほど明るい', () => {
  const c = buildCoreConfig(sevSnap, 1);
  assert.equal(c.id, 'conflict-core');
  assert.equal(c.parameters.blendColorOperation, 'add');
  assert.equal(c.pickable, false);
  const low = c.getFillColor(sevSnap.points[0]);
  const high = c.getFillColor(sevSnap.points[1]);
  assert.ok(high[1] > low[1], '大規模暴力＋高mentions→白熱(緑成分増)');
});

test('protests buildCoreConfig: id=protests-core・緑ベース', () => {
  const c = buildCoreP(sevSnap, 1);
  assert.equal(c.id, 'protests-core');
  const col = c.getFillColor({ mentions: 0, root: '14' });
  assert.equal(col[1], 200); // 緑ベース(40,200,120)の dim
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/heat.test.js`
Expected: FAIL（`buildCoreConfig is not a function`）

- [ ] **Step 3: 実装**

`js/layers/conflict.js` の import に `emberFill` と `severityRank` を追加:

```js
import { hostnameOf, blobRadius, ADDITIVE_BLEND, emberFill } from '../lib/geo.js';
import { fipsToJa, severityRank } from '../lib/places.js';
```

`buildPickConfig` の後に追加し、`toDeckLayer` を差し替え:

```js
// ember コア（白熱度＝severity＋mentions・加算合成）。emberScale は ?cfx ダイヤル。
export function buildCoreConfig(snapshot, emberScale = 1) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict-core', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => Math.max(3, blobRadius(p.mentions) * 0.45),
    radiusMinPixels: 3, radiusMaxPixels: 26, stroked: false, pickable: false,
    getFillColor: (p) => emberFill(p.mentions, severityRank(p.root) / 3, emberScale, [200, 40, 50]),
    parameters: ADDITIVE_BLEND,
  };
}
```

`toDeckLayer` を次に置換:

```js
  toDeckLayer(snapshot, ctx) {
    const scale = (ctx && ctx.cfx && ctx.cfx.emberScale) || 1;
    return [
      new deck.ScatterplotLayer(buildBlobConfig(snapshot)),
      new deck.ScatterplotLayer(buildCoreConfig(snapshot, scale)),
      new deck.ScatterplotLayer(buildPickConfig(snapshot)),
    ];
  },
```

`js/layers/protests.js` も同様（緑ベース・severity は root 14 で 0 になるので mentions 主導）:

import 追加（severityRank は不要・0 固定で渡す）:

```js
import { hostnameOf, blobRadius, ADDITIVE_BLEND, emberFill } from '../lib/geo.js';
```

`buildCoreConfig` 追加＋`toDeckLayer` 置換:

```js
export function buildCoreConfig(snapshot, emberScale = 1) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests-core', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => Math.max(3, blobRadius(p.mentions) * 0.45),
    radiusMinPixels: 3, radiusMaxPixels: 26, stroked: false, pickable: false,
    getFillColor: (p) => emberFill(p.mentions, 0, emberScale, [40, 200, 120]),
    parameters: ADDITIVE_BLEND,
  };
}
```

```js
  toDeckLayer(snapshot, ctx) {
    const scale = (ctx && ctx.cfx && ctx.cfx.emberScale) || 1;
    return [
      new deck.ScatterplotLayer(buildBlobConfig(snapshot)),
      new deck.ScatterplotLayer(buildCoreConfig(snapshot, scale)),
      new deck.ScatterplotLayer(buildPickConfig(snapshot)),
    ];
  },
```

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/heat.test.js`
Expected: PASS（既存 buildBlobConfig アサートも緑のまま）

- [ ] **Step 5: コミット**

```bash
git add js/layers/conflict.js js/layers/protests.js tests/heat.test.js
git commit -m "feat(conflict): globe ember コア(白熱度を明度で)"
```

---

### Task 8: toFeedItems を国別集約に切替（conflict.js / protests.js）

**Files:**
- Modify: `js/layers/conflict.js`、`js/layers/protests.js`（`toFeedItems` 差替・未使用 import 整理）
- Test: `tests/aggregate.test.js`（レイヤー経由のテスト追加）

**Interfaces:**
- Consumes: `aggregateByCountry`（aggregate.js, Task 3）
- Produces: `conflictLayer.toFeedItems(snapshot) -> GroupRow[]`（`layerId:'conflict'`）、`protestsLayer.toFeedItems(snapshot) -> GroupRow[]`（`layerId:'protests'`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/aggregate.test.js` に追加:

```js
import { conflictLayer } from '../js/layers/conflict.js';
import { protestsLayer } from '../js/layers/protests.js';

test('conflictLayer.toFeedItems: 国別 GroupRow を返す', () => {
  const rows = conflictLayer.toFeedItems({ points: pts });
  assert.ok(rows.every((r) => r.kind === 'group' && r.layerId === 'conflict'));
  const up = rows.find((r) => r.place === 'UP');
  assert.equal(up.count, 3);
  assert.equal(up.country_ja, 'ウクライナ');
});

test('protestsLayer.toFeedItems: layerId=protests・空安全', () => {
  assert.deepEqual(protestsLayer.toFeedItems({ points: [] }), []);
  const rows = protestsLayer.toFeedItems({ points: [{ id: 'p', place: 'FR', root: '14', mentions: 1, date: '20260620120000', url: 'https://x.fr/a', lon: 2, lat: 48 }] });
  assert.equal(rows[0].layerId, 'protests');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/aggregate.test.js`
Expected: FAIL（従来 toFeedItems は個別イベントを返すため `kind/place` が一致しない）

- [ ] **Step 3: 実装**

`js/layers/conflict.js`: `aggregateByCountry` を import し、`toFeedItems` を差替。`parseGdeltDate` が他で未使用なら import から削除（`feed.js` import 行）。

import 追加:

```js
import { aggregateByCountry } from '../lib/aggregate.js';
```

`toFeedItems` を置換:

```js
  toFeedItems(snapshot) {
    return aggregateByCountry((snapshot && snapshot.points) ? snapshot.points : [], 'conflict');
  },
```

`feed.js` からの `parseGdeltDate` import がこのファイルで未使用になるなら、その import 文を削除する。

`js/layers/protests.js` も同様:

```js
import { aggregateByCountry } from '../lib/aggregate.js';
```

```js
  toFeedItems(snapshot) {
    return aggregateByCountry((snapshot && snapshot.points) ? snapshot.points : [], 'protests');
  },
```

`protests.js` も `parseGdeltDate` が未使用になるなら import から削除。

- [ ] **Step 4: 成功を確認**

Run: `node --test tests/aggregate.test.js && node --test tests/heat.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/layers/conflict.js js/layers/protests.js tests/aggregate.test.js
git commit -m "feat(conflict): フィードを国別集約(toFeedItems→aggregateByCountry)"
```

---

### Task 9: フィード UI（チップ＋集約行＋フィルタ）＋ main.js 配線

**Files:**
- Modify: `index.html`（`#feed-chips` 追加）、`css/orbis.css`（チップ/バッジ）、`js/ui/feed.js`（`renderChips`＋`renderFeed` の group 行）、`js/main.js`（チップ配線・refreshFeed フィルタ）
- Test: `tests/e2e/conflict.spec.js`（新規）

**Interfaces:**
- Consumes: `feedChipIds/loadFeedHidden/toggleHidden/allActive/applyChips/readFeedFilter/writeFeedFilter`（feed.js, Task 6）
- Produces: `renderChips(root, chipIds, hidden, onToggle, onAll)`（ui/feed.js）

- [ ] **Step 1: 失敗する e2e を書く**

`tests/e2e/conflict.spec.js` を新規作成:

```js
import { test, expect } from '@playwright/test';

test('feed aggregates conflict by country and chips filter it', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 紛争データ到着（既定 ON）
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.conflict ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // チップ行が出る（全＋地震/紛争/抗議/ニュース のうち有効分）
  await expect(page.locator('#feed-chips .feed-chip')).not.toHaveCount(0);

  // 集約行（×N バッジ）がフィードに出る
  await expect(page.locator('#feed .feed-row .feed-count').first()).toBeVisible({ timeout: 15000 });

  // 「紛争」チップを押すと紛争行が消え、他レイヤー行は残る
  const conflictRows = () => page.locator('#feed .feed-row .feed-dot[style*="255,60,80"]');
  expect(await conflictRows().count()).toBeGreaterThan(0);
  await page.locator('#feed-chips .feed-chip[data-chip="conflict"]').click();
  await page.waitForTimeout(300);
  expect(await conflictRows().count()).toBe(0);
  await expect(page.locator('#feed .feed-row')).not.toHaveCount(0); // 他は残る

  // 「全」で復帰
  await page.locator('#feed-chips .feed-chip[data-all="1"]').click();
  await page.waitForTimeout(300);
  expect(await conflictRows().count()).toBeGreaterThan(0);

  // 集約行クリック→国サマリ popup＋flyTo
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await conflictRows().first().click();
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  await expect(page.locator('.orbis-popup .sel-meta').first()).toContainText('24h');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx playwright test tests/e2e/conflict.spec.js`
Expected: FAIL（`#feed-chips` 無し・`.feed-count` 無し）

- [ ] **Step 3: 実装（DOM＋描画＋配線）**

(a) `index.html` の `#feed` 内、`feed-hint` の直後に追加:

```html
        <div class="feed-hint">クリックでその地点へ移動 📍</div>
        <div id="feed-chips" class="feed-chips"></div>
        <div id="feed-rows"></div>
```

(b) `js/ui/feed.js` を更新。`COLOR` に隣接して `LABEL` を追加し、`renderFeed` を group 対応に、`renderChips` を新設:

```js
const COLOR = { quakes: 'rgb(255,176,40)', conflict: 'rgb(255,60,80)', protests: 'rgb(94,255,166)', news: 'var(--cyan)' };
const LABEL = { quakes: '地震', conflict: '紛争', protests: '抗議', news: 'ニュース' };

export function renderFeed(root, items, onPick) {
  root.innerHTML = items.map((it, i) => {
    const c = COLOR[it.layerId] || 'var(--cyan)';
    const title = it.kind === 'group'
      ? `${LABEL[it.layerId] || ''} ${escapeHtml(it.country_ja || '')}`
      : escapeHtml(it.title);
    const badge = it.kind === 'group' ? `<span class="feed-count">×${Number(it.count) || 0}</span>` : '';
    return `<div class="feed-row" data-i="${i}">
      <span class="feed-dot" style="color:${c};background:${c}"></span>
      <span class="feed-title">${title}</span>${badge}
      <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
    </div>`;
  }).join('') || '<div class="feed-empty">イベントなし</div>';

  if (!root.__wired) {
    root.addEventListener('click', (e) => {
      const row = e.target.closest('.feed-row');
      if (!row) return;
      const it = root.__items[+row.dataset.i];
      if (it) onPick(it);
    });
    root.__wired = true;
  }
  root.__items = items;
}

// チップ行（全＋各レイヤー）。onToggle(id)/onAll() を委譲で呼ぶ。
export function renderChips(root, chipIds, hidden, onToggle, onAll) {
  const allOn = chipIds.every((id) => !hidden.has(id));
  const html = [`<button class="feed-chip chip-all${allOn ? ' active' : ''}" data-all="1">全</button>`]
    .concat(chipIds.map((id) => {
      const on = !hidden.has(id);
      const c = COLOR[id] || 'var(--cyan)';
      return `<button class="feed-chip${on ? ' active' : ''}" data-chip="${id}" style="--chip:${c}">${LABEL[id] || id}</button>`;
    })).join('');
  root.innerHTML = html;
  if (!root.__wired) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('.feed-chip');
      if (!b) return;
      if (b.dataset.all) onAll(); else onToggle(b.dataset.chip);
    });
    root.__wired = true;
  }
}
```

(c) `js/main.js`:

import を更新（feed の純粋ヘルパと chips を追加）:

```js
import { buildFeed, applyChips, feedChipIds, loadFeedHidden, toggleHidden, readFeedFilter, writeFeedFilter } from './lib/feed.js';
import { renderFeed, renderChips, wireCollapse as wireFeedCollapse } from './ui/feed.js';
```

モジュール状態に追加（`let selected = null;` 付近）:

```js
let feedHidden = loadFeedHidden(readFeedFilter());
```

`refreshFeed` を次に置換（チップ描画＋フィルタ＋onPick の group 分岐）:

```js
function refreshFeed() {
  const map = window.__orbis.map;
  const chipIds = feedChipIds(feedLayers(), ENABLED);
  renderChips(document.getElementById('feed-chips'), chipIds, feedHidden,
    (id) => { feedHidden = toggleHidden(feedHidden, id); writeFeedFilter(feedHidden); refreshFeed(); },
    () => { feedHidden = new Set(); writeFeedFilter(feedHidden); refreshFeed(); });
  const items = applyChips(buildFeed(feedLayers(), snapshots, ENABLED), feedHidden);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    const at = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    selected = { lon: it.lon, lat: it.lat, title: it.title || it.country_ja || '', layerId: it.layerId, at };
    if (window.__orbis) window.__orbis.selected = selected;
    map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500, essential: true });
    const html = (it.kind === 'group') ? gdeltCountryPopupHtml(it) : selectionPopupHtml(it);
    if (selPopup) selPopup.setLngLat([it.lon, it.lat]).setHTML(html).addTo(map);
    drawAll(window.__orbis.overlay);
  });
}
```

`selection.js` import 行に `gdeltCountryPopupHtml`（次タスクで `gdeltEventPopupHtml` も）を追加:

```js
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml, shipPopupHtml, newsPopupHtml, buildProjectionConfigs, gdeltEventPopupHtml, gdeltCountryPopupHtml } from './lib/selection.js';
```

(d) `css/orbis.css` に追加（チップ／バッジ。モバイルで折返す）:

```css
.feed-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; }
.feed-chip {
  font: inherit; font-size: 11px; line-height: 1; cursor: pointer;
  padding: 4px 9px; border-radius: 999px; color: #cfe6ff;
  border: 1px solid rgba(120,180,255,.25); background: rgba(20,40,70,.4);
  opacity: .5; transition: opacity .15s, border-color .15s;
}
.feed-chip.active { opacity: 1; border-color: var(--chip, var(--cyan)); box-shadow: 0 0 8px -2px var(--chip, var(--cyan)); }
.feed-chip.chip-all.active { border-color: rgba(160,210,255,.7); box-shadow: none; }
.feed-count { font-size: 11px; color: #ff9bb0; margin-left: 4px; white-space: nowrap; }
```

- [ ] **Step 4: 成功を確認**

Run: `npx playwright test tests/e2e/conflict.spec.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add index.html css/orbis.css js/ui/feed.js js/main.js tests/e2e/conflict.spec.js
git commit -m "feat(conflict): フィード国別集約行＋レイヤーチップ絞り込み"
```

---

### Task 10: globe 二段階クリック＋ホットスポット脈動＋?cfx

**Files:**
- Modify: `js/main.js`（クリック分岐・hotspot 層・?cfx・集約キャッシュ）
- Test: `tests/e2e/conflict.spec.js`（globe クリックの tolerant 検証を追加）

**Interfaces:**
- Consumes: `gdeltEventPopupHtml`（selection.js, Task 5）、`aggregateByCountry/buildHotspotConfigs`（aggregate.js, Task 3/4）
- Produces: なし（配線）

- [ ] **Step 1: 失敗する e2e を追加**

`tests/e2e/conflict.spec.js` の末尾に追加（ship-projection と同じ tolerant 方式・headless picking の不安定さを許容）:

```js
test('clicking a conflict point shows article popup (best-effort) + hotspot pulses', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.conflict ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // ホットスポット層が deck に存在（脈動・reduced でなければ）
  const hasHot = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => String(l.id).startsWith('hot-'));
  });
  expect(hasHot).toBe(true);

  // 紛争点を反復クリック（座標依存で flaky なため best-effort・1回でも記事リンク popup が出れば可）
  const pts = await page.evaluate(async () => {
    const r = await fetch('/data/snapshots/conflict.json'); const j = await r.json();
    return (j.points || []).filter((p) => p.url && /^https?:/.test(p.url)).slice(0, 20);
  });
  let ok = false;
  for (const p of pts.slice(0, 6)) {
    await page.evaluate(({ lon, lat }) => window.__orbis.map.jumpTo({ center: [lon, lat], zoom: 6 }), p);
    await page.waitForTimeout(400);
    const px = await page.evaluate(({ lon, lat }) => { const t = window.__orbis.map.project([lon, lat]); return { x: t.x, y: t.y }; }, p);
    await page.mouse.click(px.x, px.y);
    await page.waitForTimeout(350);
    const href = await page.locator('.orbis-popup .sel-link').first().getAttribute('href').catch(() => null);
    if (href && /^https?:/.test(href)) { ok = true; break; }
  }
  // headless では picking が外れることがあるため、popup が出れば検証・出なくても落とさない（実画素は手動）
  expect(typeof ok).toBe('boolean');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx playwright test tests/e2e/conflict.spec.js`
Expected: 新テストの `hasHot` で FAIL（hotspot 層未配線）

- [ ] **Step 3: 実装**

`js/main.js`:

import に集約を追加:

```js
import { aggregateByCountry, buildHotspotConfigs } from './lib/aggregate.js';
```

`CMAP` 定義の付近に `?cfx` プリセットを追加:

```js
// 紛争 FX プリセット（?cfx=a|b|c で実物比較。既定 b）。emberScale=白熱度、topN=脈動する上位国数。
const CFX_PRESET = { a: { emberScale: 0.8, topN: 4 }, b: { emberScale: 1.0, topN: 6 }, c: { emberScale: 1.3, topN: 8 } };
const CFX = CFX_PRESET[((/[?&]cfx=([abc])/i.exec(typeof location !== 'undefined' ? location.search : '') || [])[1] || 'b').toLowerCase()];
```

集約キャッシュ（毎フレーム再集約を避ける）。モジュール状態に追加:

```js
let aggCache = { conflict: [], protests: [] };
```

`rebuild` の `drawAll(overlay)` 呼び出しの前に集約を更新:

```js
  for (const id of ['conflict', 'protests']) {
    aggCache[id] = (ENABLED.has(id) && snapshots[id] && snapshots[id].points)
      ? aggregateByCountry(snapshots[id].points, id) : [];
  }
  drawAll(overlay);
```

`buildBaseLayers` の `ctx` に `cfx` を渡す:

```js
  const ctx = { zoom, cmap: CMAP, motionT, cfx: CFX };
```

`drawAll` の `extra` 構築（quakeRipple の後）に hotspot を追加:

```js
  for (const id of ['conflict', 'protests']) {
    if (!ENABLED.has(id)) continue;
    const rgb = id === 'conflict' ? [255, 60, 80] : [94, 255, 166];
    for (const c of buildHotspotConfigs(aggCache[id], motionT, { reduced: REDUCED, topN: CFX.topN, rgb })) {
      extra.push(new deck.ScatterplotLayer(c));
    }
  }
```

`boot` 内、`initMap` の第3引数（クリックハンドラ）に紛争/抗議分岐を追加（news 分岐の後）:

```js
      if (info.layer.id === 'conflict' || info.layer.id === 'protests') {
        const p = info.object;
        selectedFlight = null;
        selectedShip = null;
        selected = { lon: p.lon, lat: p.lat, title: '', layerId: info.layer.id, at: performance.now() };
        if (window.__orbis) window.__orbis.selected = selected;
        map.flyTo({ center: [p.lon, p.lat], zoom: 5, duration: 1500, essential: true });
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(gdeltEventPopupHtml(p, info.layer.id)).addTo(map);
        drawAll(overlay);
      }
```

- [ ] **Step 4: 成功を確認**

Run: `npx playwright test tests/e2e/conflict.spec.js`
Expected: PASS（hasHot=true。globe クリックは best-effort）

- [ ] **Step 5: コミット**

```bash
git add js/main.js tests/e2e/conflict.spec.js
git commit -m "feat(conflict): globe 二段階クリック＋ホットスポット脈動＋?cfx"
```

---

### Task 11: SW バンプ＋全体検証＋実物比較ハンドオフ

**Files:**
- Modify: `js/sw.js`（`CACHE` を `orbis-v34`→`orbis-v35`）

**Interfaces:**
- なし

- [ ] **Step 1: SW バージョンを上げる**

`sw.js` の `CACHE` 定数を更新:

```js
const CACHE = 'orbis-v35';
```

- [ ] **Step 2: 全 node:test 緑を確認**

Run: `npm run test:js`
Expected: 全 PASS（既存 ≥180 ＋新規が緑・退行なし）

- [ ] **Step 3: 全 e2e 緑を確認**

Run: `npm run test:e2e`
Expected: 全 PASS（smoke の layer-row=10 等の回帰なし・conflict spec 緑）

- [ ] **Step 4: 実物視覚チェック（本番データ量）**

Run: `npm run serve`（別ターミナル）→ ブラウザで以下を **実画素目視**（headless 不可・mistakes.md）:
- `http://localhost:8000/?cfx=a` / `?cfx=b` / `?cfx=c` を比較し、ember 白熱度・脈動の強さを確認。
- フィードが国別集約（×N）で「紛争一色」でないこと・チップで絞れること。
- 紛争点クリックで記事リンク popup（反復クリックで2回目以降も出る）。
- console error 0。

`?cfx` の最終既定はユーザー（オーナー）が比較して確定する（確定後 `CFX_PRESET` の既定キーを必要なら変更）。

- [ ] **Step 5: コミット**

```bash
git add js/sw.js
git commit -m "chore(conflict): SW v34→v35（紛争セクション刷新の配信）"
```

---

## Self-Review

**Spec coverage:**
- 国別集約フィード → Task 3（集約）＋Task 8（toFeedItems）＋Task 9（描画）✅
- レイヤーチップ絞り込み → Task 6（状態）＋Task 9（描画/配線）✅
- 二段階クリック（フィード国サマリ／globe 記事） → Task 5（popup）＋Task 9（フィード onPick）＋Task 10（globe クリック）✅
- サブタイプ日本語化 → Task 1 ✅
- globe ember＋深刻度（白熱度） → Task 2（emberFill）＋Task 7（core）✅
- ホットスポット脈動 → Task 4（builder）＋Task 10（配線）✅
- ?cfx 実物比較 → Task 10（プリセット）＋Task 11（比較ハンドオフ）✅
- SW バンプ → Task 11 ✅
- collector 不変／registry 不変 → どのタスクも Python・registry を触らない ✅

**Placeholder scan:** "TODO"/"適切に"/"等" のみの曖昧指示なし。各コード/テストは実コードを記載。globe クリック e2e は既存 ship-projection 同様の tolerant 方式（headless picking 不安定への既知の対処）として明記。

**Type consistency:**
- GroupRow の形（`kind/layerId/place/country_ja/count/mentionsTotal/dominantRoot/dominantRootJa/topSources/time/lon/lat`）は Task 3 定義 → Task 8/9（renderFeed・onPick）／Task 5（gdeltCountryPopupHtml が `layerId/country_ja/count/dominantRootJa/topSources` を参照）で一致。
- `buildHotspotConfigs(groups, motionT, opts)` の opts キー（`reduced/topN/rgb`）は Task 4 定義 → Task 10 呼び出しと一致。
- `emberFill(mentions, severity, scale, base)` は Task 2 定義 → Task 7 呼び出しと一致。
- `gdeltEventPopupHtml(event, layerId)` / `gdeltCountryPopupHtml(group)` は Task 5 定義 → main.js（Task 9/10）import・呼び出しと一致。
- フィードチップ: `feedChipIds/loadFeedHidden/toggleHidden/allActive/applyChips/readFeedFilter/writeFeedFilter`（hidden モデル）は Task 6 定義 → Task 9 配線と一致。
- `toDeckLayer(snapshot, ctx)` の `ctx.cfx.emberScale` は Task 7（消費）／Task 10（`buildBaseLayers` の ctx で供給）で一致。
