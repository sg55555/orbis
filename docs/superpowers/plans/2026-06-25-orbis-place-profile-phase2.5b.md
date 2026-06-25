# 地域プロフィール Phase2.5b（UI 描画＋配線）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2.5a で生成済の日本ダミープロフィール（国/県/都市）を、案C（中央フロートページ）の全部入りヒーロー＋6セクション＋イベント折りたたみで描画し、クリック→最具体階層着地＋パンくず遷移＋flyTo を配線して「ダミーで体裁が見える」ところまで実装する。

**Architecture:** Phase2 の `#drilldown` 要素と `country_click.js` コントローラを流用し、右ドック grid → 中央フロート＋スクリムへ再スタイル。描画は新規純関数 `profile_view.js`（schema＋付帯→HTML）、形状シルエットは `region_shape.js`（クライアントが既読み込みのポリゴンから実行時生成・スキーマ非変更）、クリック解決は `resolve_place.js`（最具体かつ manifest 在りの階層）、データ取得は DI seam `profile_data.js`（country_data.js 同型・gz gunzip・manifest gating）。集計（aggregate_admin1）は「近隣の動向」フッタへ降格して流用。

**Tech Stack:** Vanilla ESM（type: module）、node:test（`node --test tests/*.test.js`）、MapLibre、DecompressionStream（gz）、SVG。確定デザインの markup/CSS は `docs/superpowers/mockups/place-profile-2.5b/`（content.js / shared.css / mockup-c.html・承認済）が確定ソース。

## Global Constraints

- 純関数（region_shape/profile_view/resolve_place）は **DOM/fetch/map 非依存**・全 HTML 出力は `escapeHtml`（`js/lib/selection.js`）経由。
- データ取得は **manifest 事前判定で 404 回避**＋相対 fetch（`data/static/profiles/**` は data-source.js 非対象＝常に相対配信。country_data.js と同方針）。
- 出力スキーマ（2.5a で確定・読み取り専用）: `{id, level, name_ja, facts{population,area_km2,lat,lon,elevation_m}, sections[{title,body}], source{qid,wikipedia_url}, degraded}`。
- プロフィール配置: `data/static/profiles/{country/<FIPS>.json | admin1/<a1code>.json.gz | city/<QID>.json.gz}` ＋ `data/static/profiles_manifest.json`（`{country:{<FIPS>:{bytes,degraded}}, admin1:{<a1>:{...}}, city:{<QID>:{...}}}`）。
- `#drilldown` は **blur-bleed 回避のため backdrop-filter / glass-blur を使わない**（近不透明地＋オーロラ縁/光）。
- 設計言語＝線/光/縁（面の多用禁）。並行 main の secfit/HUD トークンに統合時に寄せる。
- ナビ＝**クリック位置の最具体かつ manifest 在りの階層に直接着地＋パンくずで上る**（city→admin1→country フォールバック）。
- 既存テスト緑維持。契約が変わる `drilldown_css.test.js`（右ドック→中央フロート）と `drilldown_sw.test.js`（版番号）は本計画で更新。
- 実行: `node --test tests/<name>.test.js`。コミットは各タスク末尾。

## File Structure

- Create `js/lib/drilldown/region_shape.js` — `regionShapePath(rings)`（純）。
- Create `js/lib/drilldown/profile_view.js` — `formatFacts(facts)` ＋ `profileHtml(model)`（純・HTML）。
- Create `js/lib/drilldown/resolve_place.js` — `resolvePlace(lon, lat, ctx)`（純）。
- Create `js/lib/drilldown/profile_data.js` — `loadProfile(level, id, opts)` ＋ `__resetProfileCache()`（DI seam）。
- Modify `js/ui/drilldown.js` — `renderProfile(rootEl, model, handlers)` を追加（renderDrilldown/renderWatchlist は保持）。
- Modify `js/ui/country_click.js` — `openPlace` 流れ（resolve→loadProfile→model→renderProfile→flyTo）＋ `navigate(level,id)`。
- Modify `index.html` — `#drilldown` の兄弟に `#drill-scrim` 追加（#drilldown markup は保持）。
- Modify `css/orbis.css` — `#drilldown` を中央フロート＋スクリムへ再スタイル＋`.pf-*`（shared.css 移植）＋モバイル全幅シート。
- Modify `js/main.js` — `profiles_manifest` fetch＋profile deps 配線＋Esc/スクリム close。
- Modify `sw.js` — CACHE 版 bump（新コード配信）。
- Tests: `tests/profile_region_shape.test.js`, `tests/profile_view.test.js`, `tests/profile_resolve.test.js`, `tests/profile_data.test.js`, `tests/profile_render.test.js` 新規。`tests/drilldown_css.test.js`/`tests/drilldown_sw.test.js`/`tests/drilldown_main_wiring.test.js` 更新。

---

### Task 1: region_shape.js（ポリゴン→SVG パス・純関数）

**Files:**
- Create: `js/lib/drilldown/region_shape.js`
- Test: `tests/profile_region_shape.test.js`

**Interfaces:**
- Produces: `regionShapePath(rings) -> { d: string, viewBox: string } | null`（`rings`＝loadPolygons 出力の `.rings`＝環配列・各環 `[ [lon,lat], ... ]`。最大面積の環を bbox 正規化・長辺=100・Y 反転・~80点に間引き・SVG パス。空/点不足は null）。
- 注: クライアントの形状源は国=`boundsPolys` hit `.rings`／県=`admin1Polys` hit `.rings`（共に loadPolygons 形式）なので、GeoJSON geometry→rings 変換は本実装では不要（YAGNI のため設けない）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/profile_region_shape.test.js`）

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { regionShapePath } from '../js/lib/drilldown/region_shape.js';

test('regionShapePath: 最大環を viewBox 正規化（長辺100・Y反転）', () => {
  // 小三角と、横長(幅10×高さ2)の大三角。大きい方が選ばれる。
  const rings = [
    [[0, 0], [1, 0], [0.5, 0.5], [0, 0]],
    [[0, 0], [10, 0], [5, 2], [0, 0]],
  ];
  const out = regionShapePath(rings);
  assert.ok(out && typeof out.d === 'string');
  assert.equal(out.viewBox, '0 0 100 20');    // 幅10→100, 高さ2→20
  assert.ok(out.d.startsWith('M'));
  assert.ok(out.d.endsWith('Z'));
  // Y 反転: y=0(最下) → 20, y=2(最上) → 0。最上頂点(5,2)が y≈0 付近に出る。
  assert.match(out.d, /50,0/);
});

test('regionShapePath: 空/点不足は null', () => {
  assert.equal(regionShapePath([]), null);
  assert.equal(regionShapePath([[[0, 0], [1, 1]]]), null);  // 3点未満
  assert.equal(regionShapePath(null), null);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/profile_region_shape.test.js` Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**（`js/lib/drilldown/region_shape.js`）

```javascript
// 地域ポリゴン rings → 形状シルエット SVG パス（純関数・DOM/fetch 非依存）。
// クライアントが既に読み込み済のポリゴン（国=country_bounds rings / 県=admin1 rings・共に
// loadPolygons 形式）から実行時生成し、profile JSON のスキーマは変えない。都市(点)は null 扱い。

function _area(ring) {
  let s = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(s) / 2;
}

// 外環配列 → 最大面積環を選び viewBox 正規化（長辺=100・Y 反転）・~80点に間引き → SVG パス。
export function regionShapePath(rings) {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  let ring = rings.reduce((a, b) => (_area(b) > _area(a) ? b : a), rings[0]);
  if (!Array.isArray(ring) || ring.length < 3) return null;
  if (ring.length > 90) {
    const step = Math.floor(ring.length / 80) || 1;
    ring = ring.filter((_, i) => i % step === 0);
    if (ring[ring.length - 1] !== ring[0]) ring = ring.concat([ring[0]]);
  }
  const xs = ring.map((p) => p[0]); const ys = ring.map((p) => p[1]);
  const minx = Math.min(...xs); const maxx = Math.max(...xs);
  const miny = Math.min(...ys); const maxy = Math.max(...ys);
  const w = maxx - minx; const h = maxy - miny;
  if (w === 0 && h === 0) return null;
  const scale = 100 / Math.max(w, h);
  const r1 = (n) => Math.round(n * 10) / 10;
  const tx = (x) => r1((x - minx) * scale);
  const ty = (y) => r1((maxy - y) * scale);   // SVG は y 下向き＝反転
  const d = 'M' + ring.map((p) => `${tx(p[0])},${ty(p[1])}`).join(' L') + 'Z';
  return { d, viewBox: `0 0 ${r1(w * scale)} ${r1(h * scale)}` };
}
```

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/profile_region_shape.test.js` Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add js/lib/drilldown/region_shape.js tests/profile_region_shape.test.js
git commit -m "feat(profiles): region_shape（rings→形状シルエットSVGパス・純関数）"
```

---

### Task 2: profile_view.js（schema＋付帯 → HTML・純関数）

**Files:**
- Create: `js/lib/drilldown/profile_view.js`
- Test: `tests/profile_view.test.js`
- Reference: `docs/superpowers/mockups/place-profile-2.5b/content.js`（確定 markup）/ `shared.css`（クラス名の確定ソース）

**Interfaces:**
- Consumes: model `{ profile, breadcrumb:[{level,id,name_ja}], shapePath:{d,viewBox}|null, miniDot:{lon,lat}|null, events:[{emoji,where,title}] }`。
- Produces: `formatFacts(facts) -> [{label,value,unit}]`（null は除外・人口/面積/位置/標高を整形）。
- Produces: `profileHtml(model) -> string`（パンくず＋全部入りヒーロー＋セクション＋イベント折りたたみ＋出典。degraded はバナー＋facts＋出典）。
- 種別ラベル: `{country:['COUNTRY','国'], admin1:['ADMIN1','県'], city:['CITY','都市']}`。セクションアイコンは content.js の `ICONS` を移植。

- [ ] **Step 1: 失敗するテストを書く**（`tests/profile_view.test.js`）

```javascript
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
  const deg = { ...BASE, profile: { ...BASE.profile, sections: [], degraded: true } };
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
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/profile_view.test.js` Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**（`js/lib/drilldown/profile_view.js`）
`docs/superpowers/mockups/place-profile-2.5b/content.js` の `renderProfile` 構造を**純関数化**（ハードコード東京都→`model` 駆動）して移植する。要点：
- `import { escapeHtml } from '../selection.js';`
- `ICONS`（content.js から移植）・`KIND = {country:['COUNTRY','国'], admin1:['ADMIN1','県'], city:['CITY','都市']}`。
- `formatFacts(facts)`：`population`→`{label:'人口', value:(>=1e6? (v/1e6 を小数1) : toLocaleString), unit:(>=1e6?'M':'人')}`、`area_km2`→`{label:'面積', value:toLocaleString, unit:'km²'}`、`lat&&lon`→`{label:'位置', value:`${lat}°N`, unit:`${lon}°E`}`、`elevation_m`→`{label:'標高', value, unit:'m'}`。null は push しない。全て escapeHtml。
- `profileHtml(model)`：パンくず（breadcrumb を `›` 区切り・最終要素は `aria-current`・各 button は `data-level`/`data-id`）→ ヒーロー（メディア＝画像スロット＋ミニグローブ[miniDot 由来 or 既定]、識別＝種別バッジ＋`pf-name-row`[h1 名前＋`shapePath` あれば `pf-shape` svg]＋`pf-facts` HUD）→ `degraded` ならバナー＋（セクション省略）／非 degraded なら `sections` を `pf-sec`（アイコン＋見出し＋body）で→ **`events.length>0` のときのみ** `pf-events`（件数バッジ＋行）→ `pf-source`（wikipedia_url リンク＋QID）。全テキスト escapeHtml。
- クラス名・構造は shared.css / content.js に厳密一致させる（CSS 移植 Task 8 と整合）。

（実装の確定形は content.js を参照。テスト（Step 1）が pass する HTML を出すこと。）

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/profile_view.test.js` Expected: PASS（6 件）

- [ ] **Step 5: コミット**

```bash
git add js/lib/drilldown/profile_view.js tests/profile_view.test.js
git commit -m "feat(profiles): profile_view（schema＋付帯→HTML・純関数・確定モック移植）"
```

---

### Task 3: resolve_place.js（クリック→最具体階層解決・純関数）

**Files:**
- Create: `js/lib/drilldown/resolve_place.js`
- Test: `tests/profile_resolve.test.js`

**Interfaces:**
- admin1 は **loadPolygons 出力 polys**（`{code:a1code, name_ja, bbox, rings}`・main.js が `codeKey:'a1code'` で生成）で受ける。PIP は注入 `pip(lon,lat,poly)->bool`（本番＝geo_poly の `pointInFeature`）。`nearest(lon,lat,cities)->city|null` 注入（本番＝`nearestCity`）。
- Produces: `resolvePlace(lon, lat, { fips, countryName, admin1Polys, cities, manifest, pip, nearest, cityRadiusDeg })`
  `-> { chain:[{level,id,name_ja}], target:{level,id,name_ja}, admin1Hit:poly|null }`。
  最具体かつ **manifest にプロフィールが在る**階層を target に。都市（近接 `cityRadiusDeg` 既定 0.5・qid 在り・manifest.city 在り）→ admin1（PIP・manifest.admin1 在り）→ country（manifest.country 在り）。chain は country→admin1→city の在る分のみ。`admin1Hit`＝PIP で当たった poly（呼び出し側が `poly.rings` から形状生成）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/profile_resolve.test.js`）

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlace } from '../js/lib/drilldown/resolve_place.js';

const A1 = [{ code: 'JP-13', name_ja: '東京都', rings: [[[139, 35], [140, 35], [140, 36], [139, 35]]] }];
const CITIES = [{ qid: 'Q1490', name_ja: '新宿区', lon: 139.7, lat: 35.69 }];
const MAN = { country: { JA: {} }, admin1: { 'JP-13': {} }, city: { Q1490: {} } };
const ctx = (over = {}) => ({
  fips: 'JA', countryName: '日本', admin1Polys: A1, cities: CITIES, manifest: MAN,
  pip: (lon, lat, p) => p.code === 'JP-13',   // 常に東京都に当たる
  nearest: (lon, lat, cs) => cs[0],
  cityRadiusDeg: 0.5, ...over,
});

test('最具体=都市（近接・manifest 在り）に着地、chain は国›県›市', () => {
  const r = resolvePlace(139.7, 35.69, ctx());
  assert.equal(r.target.level, 'city');
  assert.equal(r.target.id, 'Q1490');
  assert.deepEqual(r.chain.map((c) => c.level), ['country', 'admin1', 'city']);
});

test('都市が遠い→県に着地', () => {
  const r = resolvePlace(139.7, 35.69, ctx({ cities: [{ qid: 'Q1490', name_ja: '新宿区', lon: 200, lat: 80 }] }));
  assert.equal(r.target.level, 'admin1');
  assert.equal(r.target.id, 'JP-13');
});

test('県 profile 無し→国に着地（フォールバック）', () => {
  const r = resolvePlace(139.7, 35.69, ctx({ manifest: { country: { JA: {} }, admin1: {}, city: {} } }));
  assert.equal(r.target.level, 'country');
  assert.equal(r.target.id, 'JA');
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/profile_resolve.test.js` Expected: FAIL

- [ ] **Step 3: 実装**（`js/lib/drilldown/resolve_place.js`）

```javascript
// クリック点 → 最具体かつ manifest にプロフィールが在る階層を解決（純関数・I/O は注入）。
// city(近接・qid・manifest.city) → admin1(PIP・manifest.admin1) → country(manifest.country)。
function _dist2(ax, ay, bx, by) { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; }

export function resolvePlace(lon, lat, ctx) {
  const { fips, countryName, admin1Polys = [], cities = [], manifest = {},
          pip, nearest, cityRadiusDeg = 0.5 } = ctx || {};
  const man = { country: {}, admin1: {}, city: {}, ...manifest };
  const chain = [];
  let target = null;
  let admin1Hit = null;

  if (fips && man.country[fips]) {
    const c = { level: 'country', id: fips, name_ja: countryName || fips };
    chain.push(c); target = c;
  }
  // admin1（PIP で当該 poly を特定）
  for (const p of admin1Polys) {
    if (pip && pip(lon, lat, p)) { admin1Hit = p; break; }
  }
  if (admin1Hit && man.admin1[admin1Hit.code]) {
    const c = { level: 'admin1', id: admin1Hit.code, name_ja: admin1Hit.name_ja || admin1Hit.code };
    chain.push(c); target = c;
  }
  // city（近接・qid・manifest 在り）
  const city = nearest ? nearest(lon, lat, cities) : null;
  if (city && city.qid && man.city[city.qid]) {
    const near = _dist2(lon, lat, city.lon, city.lat) <= cityRadiusDeg * cityRadiusDeg;
    if (near) {
      const c = { level: 'city', id: city.qid, name_ja: city.name_ja || city.qid };
      chain.push(c); target = c;
    }
  }
  return { chain, target, admin1Hit };
}
```

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/profile_resolve.test.js` Expected: PASS（3 件）

- [ ] **Step 5: コミット**

```bash
git add js/lib/drilldown/resolve_place.js tests/profile_resolve.test.js
git commit -m "feat(profiles): resolve_place（クリック→最具体階層・manifest gating・純関数）"
```

---

### Task 4: profile_data.js（プロフィール遅延取得・DI seam）

**Files:**
- Create: `js/lib/drilldown/profile_data.js`
- Test: `tests/profile_data.test.js`
- Reference: `js/lib/drilldown/country_data.js`（gunzip/manifest/in-flight の確定パターン）

**Interfaces:**
- Produces: `loadProfile(level, id, { manifest, fetchFn, timeoutMs }) -> Promise<profile|null>`。
  country は素 JSON（`data/static/profiles/country/<id>.json`）、admin1/city は gz（`.../admin1/<id>.json.gz` / `.../city/<id>.json.gz`）を DecompressionStream gunzip。
  manifest に当該 level/id が無ければ fetch せず null。失敗も null。成功は Map キャッシュ。
- Produces: `__resetProfileCache()`（テスト用）。

- [ ] **Step 1: 失敗するテストを書く**（`tests/profile_data.test.js`）

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProfile, __resetProfileCache } from '../js/lib/drilldown/profile_data.js';

const MAN = { country: { JA: {} }, admin1: { 'JP-13': {} }, city: {} };
const PROF = { id: 'JA', level: 'country', name_ja: '日本', sections: [], degraded: false };

test('country: 素 JSON を取得', async () => {
  __resetProfileCache();
  const fetchFn = async (url) => ({ ok: true, url, json: async () => PROF });
  const p = await loadProfile('country', 'JA', { manifest: MAN, fetchFn });
  assert.equal(p.name_ja, '日本');
});

test('manifest に無い id は fetch せず null', async () => {
  __resetProfileCache();
  let called = 0;
  const fetchFn = async () => { called++; return { ok: true, json: async () => PROF }; };
  const p = await loadProfile('admin1', 'JP-99', { manifest: MAN, fetchFn });
  assert.equal(p, null);
  assert.equal(called, 0);
});

test('admin1 gz: body 無し fake は res.json() フォールバックで展開', async () => {
  __resetProfileCache();
  const a1 = { id: 'JP-13', level: 'admin1', name_ja: '東京都', sections: [], degraded: false };
  const fetchFn = async (url) => ({ ok: true, url, body: null, json: async () => a1 });
  const p = await loadProfile('admin1', 'JP-13', { manifest: MAN, fetchFn });
  assert.equal(p.name_ja, '東京都');
});

test('fetch 失敗は null', async () => {
  __resetProfileCache();
  const fetchFn = async () => ({ ok: false });
  const p = await loadProfile('country', 'JA', { manifest: MAN, fetchFn });
  assert.equal(p, null);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/profile_data.test.js` Expected: FAIL

- [ ] **Step 3: 実装**（`js/lib/drilldown/profile_data.js`・country_data.js の `_gunzipJson` を踏襲）

```javascript
// プロフィール遅延取得（DI seam）。manifest 事前判定→相対 fetch→gz は DecompressionStream gunzip。
// country は素 JSON、admin1/city は .json.gz。失敗/欠落は null。成功は Map キャッシュ。
const URL_OF = {
  country: (id) => `data/static/profiles/country/${id}.json`,
  admin1: (id) => `data/static/profiles/admin1/${id}.json.gz`,
  city: (id) => `data/static/profiles/city/${id}.json.gz`,
};
const _cache = new Map();      // `${level}/${id}` -> profile
const _inflight = new Map();

function _has(manifest, level, id) {
  const m = manifest && manifest[level];
  return !!(m && Object.prototype.hasOwnProperty.call(m, id));
}

async function _gunzipJson(res) {
  if (typeof DecompressionStream === 'undefined' || !res.body) return res.json();
  const ds = new DecompressionStream('gzip');
  const reader = res.body.pipeThrough(ds).getReader();
  const chunks = [];
  // eslint-disable-next-line no-constant-condition
  while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(total); let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return JSON.parse(new TextDecoder().decode(buf));
}

export function loadProfile(level, id, { manifest, fetchFn, timeoutMs = 8000 } = {}) {
  const key = `${level}/${id}`;
  if (_cache.has(key)) return Promise.resolve(_cache.get(key));
  if (_inflight.has(key)) return _inflight.get(key);
  if (!_has(manifest, level, id) || !URL_OF[level]) return Promise.resolve(null);
  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  if (!f) return Promise.resolve(null);
  const p = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await f(URL_OF[level](id), ctl ? { signal: ctl.signal } : {});
      if (!res || !res.ok) return null;
      const prof = level === 'country' ? await res.json() : await _gunzipJson(res);
      _cache.set(key, prof);
      return prof;
    } catch { return null; }
    finally { if (timer) clearTimeout(timer); _inflight.delete(key); }
  })();
  _inflight.set(key, p);
  return p;
}

export function __resetProfileCache() { _cache.clear(); _inflight.clear(); }
```

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/profile_data.test.js` Expected: PASS（4 件）

- [ ] **Step 5: コミット**

```bash
git add js/lib/drilldown/profile_data.js tests/profile_data.test.js
git commit -m "feat(profiles): profile_data（プロフィール遅延取得・gz/manifest・DI seam）"
```

---

### Task 5: drilldown.js に renderProfile を追加（DOM 配線）

**Files:**
- Modify: `js/ui/drilldown.js`（`renderProfile` 追加・既存 renderDrilldown/renderWatchlist は保持）
- Test: `tests/profile_render.test.js`（既存 drilldown_render.test.js の `makeEl` DOM シム idiom を流用）

**Interfaces:**
- Consumes: `profileHtml`（Task 2）。
- Produces: `renderProfile(rootEl, model, { onClose, onWatchToggle, onNavigate }) -> void`。
  `.dd-body` に `profileHtml(model)` を流し込み、`.pf-crumbs button[data-level]` に onNavigate(level,id) を配線、`.dd-close`→onClose、`.dd-watch`→onWatchToggle(model.target.id)。

- [ ] **Step 1: 失敗するテストを書く**（`tests/profile_render.test.js`）
既存 `tests/drilldown_render.test.js` 冒頭の `makeEl` シムを同ファイル内に複製（querySelector/querySelectorAll/addEventListener/click 発火に対応する最小版）。

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderProfile } from '../js/ui/drilldown.js';

// --- 最小 DOM シム（drilldown_render.test.js と同 idiom・querySelector(All) 対応） ---
function makeRoot() {
  const nodes = {};
  function el(cls) {
    const e = {
      className: cls, innerHTML: '', _click: null, _children: [],
      querySelector: (sel) => nodes[sel.replace(/^[.#]/, '')] || null,
      querySelectorAll: (sel) => (sel.includes('pf-crumbs') ? (e._crumbs || []) : []),
      addEventListener: (ev, fn) => { if (ev === 'click') e._click = fn; },
    };
    return e;
  }
  nodes['dd-body'] = el('dd-body');
  nodes['dd-close'] = el('dd-close');
  nodes['dd-watch'] = el('dd-watch');
  const root = {
    querySelector: (sel) => nodes[sel.replace(/^[.#]/, '')] || null,
    _nodes: nodes,
  };
  return root;
}

const MODEL = {
  profile: { id: 'JP-13', level: 'admin1', name_ja: '東京都', facts: {}, sections: [], source: {}, degraded: true },
  breadcrumb: [{ level: 'country', id: 'JA', name_ja: '日本' }, { level: 'admin1', id: 'JP-13', name_ja: '東京都' }],
  shapePath: null, miniDot: null, events: [], target: { level: 'admin1', id: 'JP-13' },
};

test('renderProfile: .dd-body に HTML を入れ close/watch を配線', () => {
  const root = makeRoot();
  let closed = false; let watched = null;
  renderProfile(root, MODEL, { onClose: () => { closed = true; }, onWatchToggle: (id) => { watched = id; }, onNavigate: () => {} });
  assert.match(root._nodes['dd-body'].innerHTML, /東京都/);
  root._nodes['dd-close']._click();
  assert.equal(closed, true);
  root._nodes['dd-watch']._click();
  assert.equal(watched, 'JP-13');
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/profile_render.test.js` Expected: FAIL（renderProfile 未エクスポート）

- [ ] **Step 3: 実装**（`js/ui/drilldown.js` に追記）

```javascript
import { profileHtml } from '../lib/drilldown/profile_view.js';

// rootEl=#drilldown。model（profile_view のモデル）を .dd-body に描画し、パンくず/close/watch を配線。
export function renderProfile(rootEl, model, { onClose, onWatchToggle, onNavigate } = {}) {
  if (!rootEl || !model) return;
  const body = rootEl.querySelector('.dd-body');
  const closeBtn = rootEl.querySelector('.dd-close');
  const watchBtn = rootEl.querySelector('.dd-watch');
  if (body) {
    body.innerHTML = profileHtml(model);
    if (onNavigate) {
      for (const btn of body.querySelectorAll('.pf-crumbs button[data-level]')) {
        btn.addEventListener('click', () => onNavigate(btn.dataset.level, btn.dataset.id));
      }
    }
  }
  if (closeBtn && onClose) { closeBtn.onclick = () => onClose(); }
  if (watchBtn && onWatchToggle && model.target) { watchBtn.onclick = () => onWatchToggle(model.target.id); }
}
```

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/profile_render.test.js` Expected: PASS
- [ ] **Step 5: 全 drilldown テスト緑** — Run: `node --test tests/drilldown_render.test.js tests/drilldown_view.test.js` Expected: PASS（既存維持）

- [ ] **Step 6: コミット**

```bash
git add js/ui/drilldown.js tests/profile_render.test.js
git commit -m "feat(profiles): renderProfile（.dd-body へ描画＋パンくず/close/watch 配線）"
```

---

### Task 6: country_click.js を openPlace 流れに拡張

**Files:**
- Modify: `js/ui/country_click.js`
- Test: `tests/drilldown_country_click.test.js`（既存に openPlace/navigate ケース追記・DI fakes）

**Interfaces:**
- Consumes: `resolvePlace`/`loadProfile`/`regionShapePath`/`ringsFromGeometry`/`profileHtml`（全て deps 注入で fake 可能）。
- Produces: 既存 `initCountryClick` の返り値に `navigate(level, id)` を追加。`handleMapClick`→`openPlace(lon,lat)`。
  openPlace: FIPS 解決→`loadCountryGeo`→admin1Polys 化（既存 `loadPolygonsFn`）→`resolvePlace`→`loadProfile(target)`→model 組立→`renderProfile`→flyTo。
  **形状 rings の源（全て loadPolygons の `.rings` 形式）**：country=`locateFeature(lon,lat,boundsPolys)` hit の `.rings`／admin1=`resolvePlace` の `admin1Hit.rings`／city=null。`shapePath = rings ? deps.regionShapePath(rings) : null`。token レース・deck pick 排他は既存維持。

- [ ] **Step 1: 失敗するテストを書く**（`tests/drilldown_country_click.test.js` に追記）

```javascript
test('openPlace: resolve→loadProfile→renderProfile を通り navigate も再実行', async () => {
  const rendered = [];
  const cc = initCountryClick({
    map: fakeMap(), getSnapshots: () => ({}),
    deps: baseDeps({
      loadCountryGeo: async () => ({ admin1: { type: 'FeatureCollection', features: [{ properties: { a1code: 'JP-13', name_ja: '東京都' } }] }, cities: [], degraded: false }),
      resolvePlace: () => ({ chain: [{ level: 'country', id: 'JA', name_ja: '日本' }, { level: 'admin1', id: 'JP-13', name_ja: '東京都' }], target: { level: 'admin1', id: 'JP-13', name_ja: '東京都' } }),
      loadProfile: async () => ({ id: 'JP-13', level: 'admin1', name_ja: '東京都', facts: {}, sections: [], source: {}, degraded: false }),
      renderProfile: (root, model) => rendered.push(model.target.id),
      profilesManifest: { country: { JA: {} }, admin1: { 'JP-13': {} }, city: {} },
    }),
  });
  cc.setBoundsPolys(POLYS);
  await cc.openPlace(1, 1);
  assert.deepEqual(rendered, ['JP-13']);
  await cc.navigate('country', 'JA');     // パンくずで上る
  assert.equal(rendered.length, 2);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/drilldown_country_click.test.js` Expected: FAIL（openPlace/navigate 未実装）

- [ ] **Step 3: 実装** — `country_click.js` に `openPlace(lon,lat)` と `navigate(level,id)` を追加し、`handleMapClick` を openPlace 呼び出しへ。openPlace は既存 openCountry の骨格（hidden 解除・state・token・flyTo）を流用しつつ、本体を resolvePlace→loadProfile→model→renderProfile に差し替える。形状 rings は §Interfaces の源（country=boundsPolys hit `.rings`／admin1=`admin1Hit.rings`／city=null）、`shapePath = rings ? deps.regionShapePath(rings) : null`。navigate(level,id) は当該 level のプロフィールを loadProfile→renderProfile で再描画（chain は保持済を流用）。
  **events（近隣の動向フッタ用）**＝既存 `deps.buildDrilldown({fips, snapshots:getSnapshots(), countryPolys, admin1Polys, cities, ...})` の `events` を `{emoji: LAYER_EMOJI[layerId]||'・', where: cityName||regionName||'', title}` に map（LAYER_EMOJI={conflict:'⚔',protests:'📢',news:'📰',quakes:'🌐'}・country_click 内に定義 or drilldown_view から import）。失敗時/空は `[]`（フッタ非表示）。
  deps に `resolvePlace/loadProfile/regionShapePath/renderProfile/pip/nearest/profilesManifest`（＋既存 `buildDrilldown/loadPolygonsFn`）を追加。`resolvePlace` には ctx として `{fips, countryName:(boundsPolys hit.name_ja), admin1Polys, cities:geo.cities, manifest:profilesManifest, pip, nearest}` を渡す。返り値に `openPlace, navigate` を追加。

- [ ] **Step 4: 合格を確認** — Run: `node --test tests/drilldown_country_click.test.js` Expected: PASS（既存＋新規）
- [ ] **Step 5: コミット**

```bash
git add js/ui/country_click.js tests/drilldown_country_click.test.js
git commit -m "feat(profiles): country_click を openPlace/navigate に拡張（プロフィール配線）"
```

---

### Task 7: index.html にスクリム追加（#drilldown markup は保持）

**Files:**
- Modify: `index.html`（`#drilldown` の直前か直後に `<div id="drill-scrim" hidden></div>`）
- Test: `tests/drilldown_html.test.js`（スクリム存在を追加・既存 #drilldown child 検査は維持）

- [ ] **Step 1: 失敗するテストを書く**（`tests/drilldown_html.test.js` に追記）

```javascript
test('index.html: #drill-scrim（中央フロート用の暗幕）が存在', () => {
  assert.match(html, /<div id="drill-scrim"[^>]*hidden/);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/drilldown_html.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — `index.html` の `<aside id="drilldown" ...>` の直前に `<div id="drill-scrim" hidden aria-hidden="true"></div>` を追加。#drilldown の既存 child（dd-head/dd-title/dd-watch/dd-close/dd-state/dd-body/dd-watchlist）は保持。
- [ ] **Step 4: 合格を確認** — Run: `node --test tests/drilldown_html.test.js` Expected: PASS（既存＋新規）
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): #drill-scrim（中央フロート暗幕）を index.html に追加"`

---

### Task 8: orbis.css — #drilldown を中央フロート＋スクリムへ再スタイル＋.pf-*

**Files:**
- Modify: `css/orbis.css`（#drilldown ルール群を中央フロート化・`.pf-*` 移植・モバイル全幅シート・`#drill-scrim`）
- Test: `tests/drilldown_css.test.js`（**旧右ドック契約を新中央フロート契約に更新**）
- Reference: `docs/superpowers/mockups/place-profile-2.5b/shared.css`（.pf-* の確定ソース）＋ `mockup-c.html`（フロート/スクリム/モバイルの確定 CSS）

**Interfaces:**
- Produces（CSS 契約）: `#drilldown` は中央固定フロート（`position: fixed`・中央寄せ・`width: min(920px,95vw)`・`max-height: 92vh`・内部スクロール・backdrop-filter なし）。`#drill-scrim` は全面暗幕。`body.drill-open` で両者表示。`@media (max-width:768px)` で全幅ボトムシート。`.pf-*` クラス一式。

- [ ] **Step 1: 失敗するテストを書く** — `tests/drilldown_css.test.js` を**書き換え**（旧 grid/右ドック assert を削除し新契約に）：

```javascript
test('css: #drilldown は中央フロート（fixed・中央寄せ・幅 min(920px,95vw)）', () => {
  const m = (css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || []).join('\n');
  assert.match(m, /position:\s*fixed/);
  assert.match(m, /min\(\s*920px/);
});
test('css: #drilldown は backdrop-filter / glass-blur を使わない（blur-bleed 回避）', () => {
  const m = (css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || []).join('\n');
  assert.doesNotMatch(m, /backdrop-filter/);
});
test('css: #drill-scrim（暗幕）と body.drill-open 表示契約', () => {
  assert.match(css, /#drill-scrim\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /body\.drill-open\s+#drill-scrim/);
});
test('css: .pf-hero / .pf-shape / .pf-sec-h / .pf-events が定義済み', () => {
  assert.match(css, /\.pf-hero\s*\{/);
  assert.match(css, /\.pf-shape\s*\{/);
  assert.match(css, /\.pf-sec-h\s*\{/);
  assert.match(css, /\.pf-events\s*\{/);
});
test('css: モバイルは全幅ボトムシート（max-width:768px で #drilldown 全幅）', () => {
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/drilldown_css.test.js` Expected: FAIL（旧 CSS のまま）
- [ ] **Step 3: 実装** — `css/orbis.css` の `#drilldown.drill-panel` ルール群（現行 1201-1279 付近）を置換：
  - `#drilldown` を中央フロート（`position: fixed; inset:0` の中で flex 中央寄せ→ or `top/left:50%; transform:translate(-50%,-50%)`）・`width: min(920px,95vw)`・`max-height: 92vh`・`overflow-y:auto`・近不透明地 `rgba(7,11,20,0.97)`・オーロラ縁/glow（mockup-c.html の `.page`/`.page::before` を `#drilldown` に移植）。
  - 旧 `body.drill-open #map-wrap{display:grid}` / `#map position:static` の右ドック push は**削除**（globe はスクリムで暗くするだけ・縮小しない）。
  - `#drill-scrim`：`position:fixed; inset:0; background: var(--bg-scrim-b); z-index:5;`＋`[hidden]{display:none}`。`body.drill-open #drill-scrim`/`#drilldown` を表示。
  - `.pf-*` 一式を shared.css から移植（@import の Google Fonts は不要＝既存 --font-display 'Saira' を使用）。
  - `.dd-head`（★/×）はフロート右上角に絶対配置。`.dd-title`/`.dd-state` は profile では未使用＝`display:none` 可。`.dd-watchlist` はフロート下部に従来通り。
  - `@media (max-width:768px)`：`#drilldown` を全幅ボトムシート（`left:0;right:0;bottom:0;top:auto;width:auto;max-height:88vh;border-radius:16px 16px 0 0`・ドラッグハンドル `::before`）。
- [ ] **Step 4: 合格を確認** — Run: `node --test tests/drilldown_css.test.js` Expected: PASS（新契約）
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): #drilldown を中央フロート＋スクリムへ再スタイル＋.pf-*（案C）"`

---

### Task 9: main.js — profiles_manifest 取得＋profile deps 配線＋Esc/スクリム close

**Files:**
- Modify: `js/main.js`（profiles_manifest fetch・initCountryClick deps へ profile 系注入・Esc/スクリムクリックで closeCountry）
- Test: `tests/drilldown_main_wiring.test.js`（profile deps 配線の存在を文字列回帰で追加）

**Interfaces:**
- Consumes: `loadProfile`/`resolvePlace`/`regionShapePath`/`ringsFromGeometry`/`renderProfile`/`locateFeature`/`nearestCity`。
- Produces: `cc` の deps に `resolvePlace, loadProfile, regionShapePath, ringsFromGeometry, renderProfile, get profilesManifest()` を渡す。`#drill-scrim` クリックと `keydown Escape` で `cc.closeCountry()`。

- [ ] **Step 1: 失敗するテストを書く**（`tests/drilldown_main_wiring.test.js` に追記）

```javascript
test('main.js: profiles_manifest を fetch し profile deps を配線', () => {
  assert.match(main, /profiles_manifest\.json/);
  assert.match(main, /resolvePlace/);
  assert.match(main, /loadProfile/);
  assert.match(main, /renderProfile/);
});
test('main.js: Esc / #drill-scrim で閉じる', () => {
  assert.match(main, /drill-scrim/);
  assert.match(main, /Escape/);
});
```

（`main` は `readFileSync(join(__dirname,'..','js','main.js'),'utf8')`。既存テスト冒頭の読み込みを流用。）

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/drilldown_main_wiring.test.js` Expected: FAIL
- [ ] **Step 3: 実装** — `js/main.js`：
  - import 追加：`loadProfile`(profile_data)・`resolvePlace`(resolve_place)・`regionShapePath`(region_shape)・`renderProfile`(drilldown)・`pointInFeature`(geo_poly)・`nearestCity`(nearest.js)。
  - `let _profilesManifest = {};` ＋ `fetch('data/static/profiles_manifest.json').then(r=>r.ok?r.json():null).then(d=>{ if(d) _profilesManifest=d; });`。
  - `initCountryClick` の deps に `resolvePlace`, `loadProfile`, `regionShapePath`, `renderProfile`, `pip: pointInFeature`, `nearest: nearestCity`, `get profilesManifest(){return _profilesManifest;}` を追加。
  - boot 後：`document.getElementById('drill-scrim').addEventListener('click', () => cc.closeCountry());` と `document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') cc.closeCountry(); });`。
- [ ] **Step 4: 合格を確認** — Run: `node --test tests/drilldown_main_wiring.test.js` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): main.js に profiles_manifest 取得＋profile deps＋Esc/スクリム close を配線"`

---

### Task 10: SW 版番号 bump（新コード配信）

**Files:**
- Modify: `sw.js`（CACHE 版を上げる）
- Test: `tests/drilldown_sw.test.js`（版番号を更新）

> **統合時の注意**：worktree は `orbis-v47`、並行 main は既に v48+。本タスクでは worktree 内整合のため `orbis-v49` に上げる。**統合（git fetch/merge）後に main の最新版＋1 へ再調整**すること（マージ衝突点）。

- [ ] **Step 1: テストを更新** — `tests/drilldown_sw.test.js` の `orbis-v47` を `orbis-v49` に変更（2 箇所＝説明文と assert）。
- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/drilldown_sw.test.js` Expected: FAIL（sw.js はまだ v47）
- [ ] **Step 3: 実装** — `sw.js` の `const CACHE = 'orbis-v47'` を `'orbis-v49'` に。
- [ ] **Step 4: 合格を確認** — Run: `node --test tests/drilldown_sw.test.js` Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "chore(sw): CACHE を orbis-v49 に bump（地域プロフィール配信）"`

---

### Task 11: 全テスト緑＋日本ダミーで実機サニティ（Playwright）

**Files:** （コードなし・検証）

- [ ] **Step 1: 全 node テスト緑** — Run: `node --test tests/*.test.js` Expected: PASS（新規5＋更新3＋既存）。失敗があれば該当タスクに戻る。
- [ ] **Step 2: Python テスト緑（回帰）** — Run: `PYTHONPATH=. python3 -m pytest -q` Expected: PASS（profile_prep 等）。
- [ ] **Step 3: ローカル起動＋クリック実機確認** — `python3 -m http.server 8000` で起動し、Playwright（playwright-skill）で：
  - 日本（本州中部）クリック→中央フロートのプロフィールがページ風に出る（ヒーロー全部入り＋6セクション＋出典）。
  - 東京付近クリック→admin1/city に着地・**形状シルエットが描画**・パンくず「日本›東京都(›…)」。
  - パンくず親クリック→上位プロフィールへ遷移。イベント折りたたみ開閉。
  - ×/スクリム/Esc で閉じる。globe が薄暗くなる。
  - モバイル幅（390）で全幅ボトムシート。
  - スクショを `docs/superpowers/mockups/place-profile-2.5b/live-*.png` に保存し承認モックと比較。
- [ ] **Step 4: 結果を報告し統合判断を仰ぐ** — 太田さんに実機サニティを依頼（GPU/globe 依存のクリック→flyTo・寄り具合は headless 不可）。OK なら統合（§ 統合手順）。

---

## 統合手順（並行 main・全タスク後）

1. **git fetch**（main は別スレッド並行更新中）。`git fetch origin && git log --oneline origin/main -5` で最新確認。
2. main ツリーで `git merge worktree-place-profile`。**衝突注意点**：`css/orbis.css`（secfit/HUD 変更 vs #drilldown 末尾・領域分離気味）・`index.html`（scrim 追加 vs secfit 見出し markup）・`sw.js`（CACHE 版＝main 最新版＋1 へ再調整）。
3. 設計言語トークンを最新 main（secfit の `.sec-h`/rim 系トークン）へ寄せる微修正。
4. `node --test tests/*.test.js` ＋ `pytest -q` 緑を再確認 → push（Vercel）→ 本番 curl で `profiles_manifest.json`/profile gz 反映確認 → 太田さん実機サニティ。
5. 記憶昇格（MEMORY.md / Obsidian Projects/orbis-feature-roadmap.md）。

---

## Self-Review

**1. Spec coverage（2.5b UI 設計 doc）:**
- 案C 中央フロート＋スクリム = Task 8 ✓
- 全部入りヒーロー（画像/ミニグローブ/種別/名前/形状/HUD）= Task 2（profileHtml）＋Task 1（形状）✓
- 6セクション（アイコン＋オーロラ下線）= Task 2 ✓
- 近隣の動向 折りたたみ = Task 2（events）✓（集計流用は country_click が buildDrilldown の events を model へ）
- 出典/パンくず/degraded = Task 2 ✓
- 形状＝クライアント生成・スキーマ非変更 = Task 1 ＋ Task 6（geometry 源）✓
- ナビ＝最具体着地＋パンくず = Task 3（resolve）＋ Task 5/6（navigate）✓
- データ層 gz/manifest = Task 4 ✓
- モバイル全幅シート = Task 8 ✓
- #drilldown/country_click 流用・新パネル無し = Task 5/6/8 ✓
- SW 配信 = Task 10 ✓
- 実機サニティ = Task 11 ✓
- 統合前 git fetch・共有ファイル衝突確認 = 統合手順 ✓

**2. Placeholder scan:** 純関数（Task 1/3/4）は実コード。Task 2（profile_view）/Task 8（CSS）は確定ソース（content.js/shared.css/mockup-c.html・コミット済）への移植指示＋pass すべき実テスト。Task 6/9 は import/配線の具体手順＋実テスト。TODO/TBD 無し。

**3. Type consistency:**
- model 形 `{profile, breadcrumb, shapePath:{d,viewBox}|null, miniDot, events, target}` は Task 2（消費）・Task 5（renderProfile）・Task 6（組立）で一致。
- `resolvePlace(...) -> {chain, target}`：Task 3 定義・Task 6 利用一致。
- `loadProfile(level,id,{manifest,fetchFn}) -> profile|null`：Task 4 定義・Task 6 利用一致。
- `regionShapePath(rings) -> {d,viewBox}|null`：Task 1 定義・Task 6（poly.rings 投入）利用一致。
- `renderProfile(rootEl, model, {onClose,onWatchToggle,onNavigate})`：Task 5 定義・Task 6/9 利用一致。
- CSS クラス `.pf-*`：Task 2（HTML）と Task 8（CSS）で同名（shared.css 準拠）。
