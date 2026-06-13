# ORBIS Phase 3.5（デザイン磨き）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 引くとネオン濃紺の地球が星空に浮かび、海陸が色で分かれ国名が日本語で読め、紛争/抗議は赤/緑の面でにじみ、マーカーにホバーで意味が分かり、フィードクリックで飛び先にハイライトが出る。

**Architecture:** 既存の疎結合（1レイヤー=1モジュール、純粋部を node:test、deck は CDN グローバル、収集=cron→静的JSON→描画）を維持。ベースマップを OpenFreeMap キー不要ベクター＋独自ネオンスタイルに差し替え（`js/style.js` 新設）、紛争/抗議を HeatmapLayer + 薄い pickable scatter に、フィード選択を deck の selected-marker で可視化、ツールチップとパネルにラベル/説明を足す。Vercel 静的・環境変数なしの方針は維持。

**Tech Stack:** Vanilla JS (ESM, no build) / MapLibre GL 4.7.1（globe・vector・`localIdeographFontFamily` で日本語）/ deck.gl 9.0.27（ScatterplotLayer/HeatmapLayer/PathLayer/IconLayer）/ OpenFreeMap（`https://tiles.openfreemap.org`：planet vector / fonts / sprites、キー不要・CORS可）/ node:test / Playwright。

**実装順序:** A 浮かぶ地球 → B ネオンベクター地図 → C 紛争/抗議ヒート → D flyTo マーカー → E ガイド/ラベル → F 微調整。

**OpenFreeMap 確認済み事実:** `sources.openmaptiles = { type:'vector', url:'https://tiles.openfreemap.org/planet' }`。glyphs=`https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`、sprite=`https://tiles.openfreemap.org/sprites/ofm_f384/ofm`。vector_layers に `water`/`landcover`/`boundary`/`place` あり、`place` は `name:ja` フィールドを持つ。日本語グリフは Map の `localIdeographFontFamily` でローカル描画。

**テストコマンド:** JS=`node --test tests/*.test.js`。e2e=`npx playwright test`。Python=`python3 -m pytest -q`（本フェーズ変更なし）。
**コミット作者メール必須（GH007回避）:** `git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "..."`。

---

## ファイル構成
- 新規 `js/style.js` — `buildBaseStyle()`（OpenFreeMap 源＋ネオン濃紺の海陸/行政界/日本語ラベル）。純粋に style オブジェクトを返す。
- 変更 `js/map.js` — `DARK_STYLE` を `buildBaseStyle()` に差し替え、不透明背景を廃止（球体浮遊）、`localIdeographFontFamily` 追加。globe/overlay/getTooltip は維持。
- 変更 `js/layers/conflict.js` / `js/layers/protests.js` — `toDeckLayer` を `[HeatmapLayer, pickableScatter]` に。純粋部 `buildHeatConfig`/`buildPickConfig` を分離。
- 変更 `js/layers/quakes.js`/`flights.js`/`trade.js`/`conflict.js`/`protests.js` — `tooltip()` をラベル付き文面に。
- 変更 `js/layers/registry.js` — 各レイヤーに `desc`（1行説明）を追加。
- 変更 `js/ui/panel.js` — 各行にレイヤー説明を表示。
- 変更 `js/main.js` — `selected` 状態＋ `selectedMarkerLayer()` を drawAll に重畳、フィードクリックで selected 更新。
- 変更 `css/orbis.css` — パネル説明・ツールチップ体裁。
- 変更 `tests/e2e/smoke.spec.js` — ベースマップ差し替え後も壊れないこと＋selected-marker 出現。
- 新規テスト: `tests/style.test.js`、`tests/heat.test.js`。tooltip 文面は `tests/tooltip.test.js` を更新。

---

## Task 1: ネオン濃紺ベクタースタイル（js/style.js）

**Files:** Create `js/style.js`, `tests/style.test.js`

- [ ] **Step 1: 失敗するテスト `tests/style.test.js`**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBaseStyle } from '../js/style.js';

test('buildBaseStyle: OpenFreeMap ベクター源とフォントを参照', () => {
  const s = buildBaseStyle();
  assert.equal(s.version, 8);
  assert.equal(s.sources.openmaptiles.type, 'vector');
  assert.match(s.sources.openmaptiles.url, /openfreemap\.org\/planet/);
  assert.match(s.glyphs, /openfreemap\.org\/fonts/);
});

test('buildBaseStyle: 不透明な黒背景レイヤーを持たない（球体を星空に浮かせる）', () => {
  const s = buildBaseStyle();
  const opaqueBg = s.layers.find(
    (l) => l.type === 'background' && l.paint && l.paint['background-color'] === '#05080f'
  );
  assert.equal(opaqueBg, undefined);
});

test('buildBaseStyle: 海洋/陸/行政界/国名ラベルのレイヤーを含む', () => {
  const s = buildBaseStyle();
  const byLayer = (sl) => s.layers.find((l) => l['source-layer'] === sl);
  assert.ok(byLayer('water'), 'water fill');
  assert.ok(byLayer('landcover') || byLayer('landuse'), 'land');
  assert.ok(byLayer('boundary'), 'boundary');
  const place = s.layers.find((l) => l['source-layer'] === 'place' && l.type === 'symbol');
  assert.ok(place, 'place symbol');
  // 日本語ラベル: text-field が name:ja を含む（coalesce）
  assert.ok(JSON.stringify(place.layout['text-field']).includes('name:ja'));
});
```

- [ ] **Step 2: 失敗確認** `node --test tests/style.test.js` → FAIL（module not found）

- [ ] **Step 3: `js/style.js` 実装**
```javascript
// ネオン濃紺ベクターベースマップ（OpenFreeMap・キー不要）。
// 背景レイヤーを置かないことで globe の外側が透明になり、背面の星空が見える。
const OFM = 'https://tiles.openfreemap.org';

export function buildBaseStyle() {
  const jaLabel = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
  return {
    version: 8,
    glyphs: `${OFM}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${OFM}/sprites/ofm_f384/ofm`,
    sources: {
      openmaptiles: { type: 'vector', url: `${OFM}/planet` },
    },
    layers: [
      // 背景レイヤーなし（透明＝星空に浮く球体）
      // 海洋：深い紺
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water',
        paint: { 'fill-color': '#081a30' } },
      // 陸：海よりわずかに明るいスレート（陸を引き立てる）
      { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover',
        paint: { 'fill-color': '#182a47', 'fill-opacity': 0.55 } },
      { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse',
        paint: { 'fill-color': '#182a47', 'fill-opacity': 0.35 } },
      // 国境：シアングロー
      { id: 'boundary', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary',
        filter: ['<=', ['get', 'admin_level'], 4],
        paint: { 'line-color': '#39d0ff', 'line-opacity': 0.4, 'line-width': 0.7, 'line-blur': 0.6 } },
      // 国名（日本語・低ズームから）
      { id: 'place-country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        filter: ['==', ['get', 'class'], 'country'],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 1, 11, 4, 15], 'text-max-width': 8 },
        paint: { 'text-color': '#dbeafe', 'text-halo-color': '#05080f', 'text-halo-width': 1.5 } },
      // 主要都市（中ズーム以上・日本語）
      { id: 'place-city', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        minzoom: 3, filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
        layout: { 'text-field': jaLabel, 'text-font': ['Noto Sans Regular'], 'text-size': 11,
          'text-max-width': 8 },
        paint: { 'text-color': '#8fb8e8', 'text-halo-color': '#05080f', 'text-halo-width': 1.2 } },
    ],
  };
}
```

- [ ] **Step 4: 通過確認** `node --test tests/style.test.js` → PASS（3 tests）。`node --test tests/*.test.js` → 全緑。

- [ ] **Step 5: コミット**
```bash
git add js/style.js tests/style.test.js
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(style): neon deep-navy OpenFreeMap vector basemap (ja labels)"
```

---

## Task 2: 浮かぶ地球＋ベースマップ差し替え（js/map.js）

**Files:** Modify `js/map.js`（WIRING・e2e で検証）

- [ ] **Step 1: 現 js/map.js を読み、`DARK_STYLE` 定義を削除して `buildBaseStyle` を使う**
冒頭に import 追加：
```javascript
import { buildBaseStyle } from './style.js';
```
`const DARK_STYLE = { ... }`（背景 bg + carto raster を含む現スタイル）を**丸ごと削除**。

- [ ] **Step 2: initMap の Map 生成を差し替え**
```javascript
export function initMap(container, getTooltip) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(),
    center: [0, 20],
    zoom: 1.2,
    minZoom: 0,
    attributionControl: true,
    localIdeographFontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif", // CJK をローカル描画
  });
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [], getTooltip });
  map.addControl(overlay);
  return { map, overlay };
}
```
（`setDeckLayers` は変更しない。CARTO 由来の attribution 文字列は削除でよい＝OpenFreeMap/OSM の attribution は MapLibre が source から自動表示。）

- [ ] **Step 3: 検証**
- `node --test tests/*.test.js` → 全緑（map.js はテスト対象外だが回帰確認）。
- `node --check js/map.js js/style.js` → 構文エラーなし。
- ローカル目視（任意）: `python3 -m http.server 8000` → 引くとネオン濃紺の球体が星空に浮き、海陸が色分けされ国名が日本語。自動確認は Task 7 の e2e。

- [ ] **Step 4: コミット**
```bash
git add js/map.js
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(globe): swap to neon vector basemap, transparent bg so globe floats"
```

---

## Task 3: 紛争/抗議を赤/緑ヒートマップ＋薄い pickable 点に

**Files:** Modify `js/layers/conflict.js`, `js/layers/protests.js`; Create `tests/heat.test.js`

- [ ] **Step 1: 失敗するテスト `tests/heat.test.js`**
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHeatConfig, buildPickConfig } from '../js/layers/conflict.js';
import { buildHeatConfig as buildHeatP, buildPickConfig as buildPickP } from '../js/layers/protests.js';

const snap = { points: [{ id: 'a', lon: 1, lat: 2, mentions: 5 }, { id: 'b', lon: 3, lat: 4, mentions: 0 }] };

test('conflict buildHeatConfig: data 反映・weight=mentions・id=conflict-heat', () => {
  const c = buildHeatConfig(snap);
  assert.equal(c.id, 'conflict-heat');
  assert.equal(c.data.length, 2);
  assert.deepEqual(c.getPosition(snap.points[0]), [1, 2]);
  assert.equal(c.getWeight(snap.points[0]), 5);
  assert.equal(c.getWeight(snap.points[1]), 1); // 0/欠損は最小1
  assert.ok(Array.isArray(c.colorRange) && c.colorRange.length >= 2);
});

test('conflict buildPickConfig: 小半径・pickable・id=conflict', () => {
  const p = buildPickConfig(snap);
  assert.equal(p.id, 'conflict');     // tooltipFor が conflict→conflict で発火
  assert.equal(p.pickable, true);
  assert.ok(p.getRadius() <= 5);
});

test('protests も同形（id=protests-heat / protests）', () => {
  assert.equal(buildHeatP(snap).id, 'protests-heat');
  assert.equal(buildPickP(snap).id, 'protests');
  assert.equal(buildPickP(snap).pickable, true);
});
```

- [ ] **Step 2: 失敗確認** `node --test tests/heat.test.js` → FAIL

- [ ] **Step 3: js/layers/conflict.js を実装**（`buildConflictConfig` は削除し heat/pick に置換。tooltip は Task 4 で更新するので現状維持）
```javascript
// 紛争レイヤー（赤ヒートマップ＋薄い pickable 点）。
import { hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';

const RED_RANGE = [
  [40, 0, 10], [110, 12, 28], [180, 28, 46], [230, 45, 64], [255, 90, 110], [255, 170, 180],
];

export function buildHeatConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict-heat', data,
    getPosition: (p) => [p.lon, p.lat],
    getWeight: (p) => Number(p.mentions) || 1,
    radiusPixels: 38, intensity: 1, threshold: 0.05, colorRange: RED_RANGE, pickable: false,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [255, 60, 80, 60],
  };
}

export const conflictLayer = {
  id: 'conflict',
  label: '紛争',
  legend: [{ color: 'rgb(255,60,80)', label: '紛争（赤・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('conflict'); },
  toDeckLayer(snapshot) {
    return [new deck.HeatmapLayer(buildHeatConfig(snapshot)), new deck.ScatterplotLayer(buildPickConfig(snapshot))];
  },
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`; // ラベル付き文面は Task 4 で一括更新
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `紛争 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'conflict', lon: p.lon, lat: p.lat,
    }));
  },
};
```
（注: 既存の `eventRadius` import は不要になったので削除。**tooltip 文面はこの Task ではまだ現状のまま**（`${place}（${domain}）`）にして既存 `tooltip.test.js` を緑に保つ。ラベル付きへの変更は Task 4 で全レイヤー一括＋テスト更新する。）

- [ ] **Step 4: js/layers/protests.js を実装**（緑 GREEN_RANGE、id=protests-heat / protests）
```javascript
// 抗議レイヤー（緑ヒートマップ＋薄い pickable 点）。
import { hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';

const GREEN_RANGE = [
  [0, 30, 16], [10, 80, 44], [24, 140, 78], [50, 200, 120], [94, 255, 166], [180, 255, 210],
];

export function buildHeatConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests-heat', data,
    getPosition: (p) => [p.lon, p.lat],
    getWeight: (p) => Number(p.mentions) || 1,
    radiusPixels: 38, intensity: 1, threshold: 0.05, colorRange: GREEN_RANGE, pickable: false,
  };
}

export function buildPickConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests', data, radiusUnits: 'pixels', pickable: true,
    getPosition: (p) => [p.lon, p.lat], getRadius: () => 4, getFillColor: () => [94, 255, 166, 60],
  };
}

export const protestsLayer = {
  id: 'protests',
  label: '抗議',
  legend: [{ color: 'rgb(94,255,166)', label: '抗議（緑・GDELT 24h）' }],
  async fetch(getSnapshot) { return getSnapshot('protests'); },
  toDeckLayer(snapshot) {
    return [new deck.HeatmapLayer(buildHeatConfig(snapshot)), new deck.ScatterplotLayer(buildPickConfig(snapshot))];
  },
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`; // ラベル付き文面は Task 4 で一括更新
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `抗議 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'protests', lon: p.lon, lat: p.lat,
    }));
  },
};
```

- [ ] **Step 5: 旧テストを削除**（`tests/conflict.test.js` と `tests/protests.test.js` は削除済みの `buildConflictConfig`/`buildProtestsConfig` を import しており壊れる。`tests/heat.test.js` が新関数を両レイヤーぶんカバーするので、2ファイルを削除する）：
```bash
git rm tests/conflict.test.js tests/protests.test.js
```
その後 `node --test tests/*.test.js` → 全緑を確認（heat.test.js を含む）。

- [ ] **Step 6: コミット**
```bash
git add js/layers/conflict.js js/layers/protests.js tests/heat.test.js
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(conflict/protests): red/green heatmap + thin pickable points"
```

---

## Task 4: ガイド付きツールチップ＋レイヤー説明（registry desc）

**Files:** Modify `js/layers/quakes.js`, `flights.js`, `trade.js`, `conflict.js`, `protests.js`（tooltip 文面をラベル付きに）; `js/layers/registry.js`（desc）。Test: update `tests/tooltip.test.js`

- [ ] **Step 1: `tests/tooltip.test.js` をラベル付き文面に更新**（弱めず、新文面を assert）
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooltipFor } from '../js/layers/registry.js';

test('quakes tooltip: ラベル付き', () => {
  assert.equal(tooltipFor('quakes', { mag: 3.6, place: 'Alaska' }), '地震 M3.6｜Alaska');
});
test('flights tooltip: 便名/高度/速度ラベル（空中）', () => {
  assert.equal(tooltipFor('flights', { callsign: 'RTY484 ', alt: 1821.18, velocity: 56.83, on_ground: false }),
    '便名 RTY484｜高度 1821m｜速度 57m/s');
});
test('flights tooltip: 地上', () => {
  assert.equal(tooltipFor('flights', { callsign: 'AIC1TA', alt: null, velocity: 7.46, on_ground: true }),
    '便名 AIC1TA｜高度 地上｜速度 7m/s');
});
test('conflict/protests tooltip: ラベル付き', () => {
  assert.equal(tooltipFor('conflict', { place: 'FR', url: 'https://www.dailymail.com/x' }), '紛争｜FR｜出典 dailymail.com');
  assert.equal(tooltipFor('protests', { place: 'US', url: 'https://www.sacurrent.com/x' }), '抗議｜US｜出典 sacurrent.com');
});
test('trade tooltip: 要衝/航路ラベル', () => {
  assert.equal(tooltipFor('trade-chokepoints', { properties: { name: 'Suez Canal' } }), '要衝 Suez Canal');
  assert.equal(tooltipFor('trade-routes', { properties: { name: 'Trans-Pacific' } }), '航路 Trans-Pacific');
});
test('tooltipFor: null/未知は null', () => {
  assert.equal(tooltipFor('quakes', null), null);
  assert.equal(tooltipFor('ghost', {}), null);
});
```

- [ ] **Step 2: 失敗確認** `node --test tests/tooltip.test.js` → FAIL（旧文面）

- [ ] **Step 3: 各 tooltip を更新**
quakes.js の tooltip：
```javascript
  tooltip(o) {
    if (!o) return null;
    return `地震 M${o.mag}｜${o.place}`;
  },
```
flights.js の tooltip：
```javascript
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
```
trade.js の tooltip（航路/要衝で接頭辞。feature の geometry.type で判定）：
```javascript
  tooltip(o) {
    if (!o || !o.properties) return null;
    const name = o.properties.name;
    if (!name) return null;
    const isRoute = o.geometry && o.geometry.type === 'LineString';
    return `${isRoute ? '航路' : '要衝'} ${name}`;
  },
```
conflict.js の tooltip（Task 3 で旧文面のままなのでここでラベル付きに）：
```javascript
  tooltip(o) {
    if (!o) return null;
    return `紛争｜${o.place}｜出典 ${hostnameOf(o.url)}`;
  },
```
protests.js の tooltip：
```javascript
  tooltip(o) {
    if (!o) return null;
    return `抗議｜${o.place}｜出典 ${hostnameOf(o.url)}`;
  },
```

- [ ] **Step 4: registry.js に各レイヤー `desc` を追加**（パネル説明用）。`layers` 配列の各レイヤーオブジェクトに後付けする小ヘルパ、または各レイヤー定義に `desc` を持たせる。ここでは registry でまとめて付与：
```javascript
// 各レイヤーの1行説明（パネル表示用）。id→説明。
const DESCRIPTIONS = {
  quakes: '直近の地震（USGS・円の大きさ=規模）',
  flights: '飛行中の航空機（OpenSky・向き=進行方向）',
  conflict: '紛争関連報道の集中（GDELT・24h・赤い面）',
  protests: '抗議関連報道の集中（GDELT・24h・緑の面）',
  trade: '主要な海上貿易ルートと要衝',
};
export function descFor(id) { return DESCRIPTIONS[id] || ''; }
```

- [ ] **Step 5: 通過確認** `node --test tests/tooltip.test.js` → PASS。`node --test tests/*.test.js` → 全緑。

- [ ] **Step 6: コミット**
```bash
git add js/layers/quakes.js js/layers/flights.js js/layers/trade.js js/layers/conflict.js js/layers/protests.js js/layers/registry.js tests/tooltip.test.js
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(tooltip): labeled tooltips + per-layer descriptions"
```

---

## Task 5: パネルにレイヤー説明を表示（panel.js）

**Files:** Modify `js/ui/panel.js`, `js/main.js`（descFor を渡す）, `css/orbis.css`（WIRING）

- [ ] **Step 1: panel.js の renderPanel に説明行を追加**
`renderPanel(root, layers, getEnabled, getCounts, onChange, descFor)` の最後の引数で説明取得関数を受ける。各 `.layer-row` の直後に小さな説明を出す。行マークアップを：
```javascript
  root.innerHTML = layers.map((l) => {
    const sw = (l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)';
    const desc = descFor ? descFor(l.id) : '';
    return `<div class="layer-item">
      <label class="layer-row" data-id="${l.id}">
        <input type="checkbox" class="layer-toggle" />
        <span class="swatch" style="color:${sw};background:${sw}"></span>
        <span class="layer-label">${l.label}</span>
        <span class="layer-count" data-count="${l.id}">–</span>
      </label>
      ${desc ? `<div class="layer-desc">${desc}</div>` : ''}
    </div>`;
  }).join('');
```
（`syncChecks`/`updateCounts` のセレクタ `.layer-row`/`.layer-count` は据え置きで動く。イベント委譲も `.layer-toggle`/`.layer-row` のままでよい。）

- [ ] **Step 2: main.js で descFor を渡す**
import に追加：`import { layers, buildDeckLayers, tooltipFor, feedLayers, descFor } from './layers/registry.js';`
`renderPanel(...)` 呼び出しの最後に `descFor` を追加：
```javascript
  panel = renderPanel(
    document.getElementById('panel-rows'), layers,
    () => ENABLED, () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); },
    descFor
  );
```

- [ ] **Step 3: css に説明文スタイル**（末尾）
```css
.layer-item { margin: 4px 0 7px; }
.layer-desc { margin: 1px 0 0 24px; font-size: 10px; line-height: 1.3; color: var(--muted); }
```

- [ ] **Step 4: 検証** `node --test tests/*.test.js` → 全緑。`node --check js/ui/panel.js js/main.js` → OK。

- [ ] **Step 5: コミット**
```bash
git add js/ui/panel.js js/main.js css/orbis.css
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(panel): per-layer descriptions for non-expert clarity"
```

---

## Task 6: flyTo 着地マーカー（selected highlight）

**Files:** Modify `js/main.js`（WIRING）

- [ ] **Step 1: selected 状態を追加**（モジュールスコープ、`let pulses = [];` 付近）
```javascript
let selected = null; // { lon, lat, title } フィードで選択中のイベント
```

- [ ] **Step 2: selectedMarkerLayer() を追加**（drawAll の近く）
```javascript
// 選択中イベントのネオンハイライト（持続リング＋中心ドット）。
function selectedMarkerLayer() {
  if (!selected) return null;
  return new deck.ScatterplotLayer({
    id: 'selected-marker', data: [selected], radiusUnits: 'pixels',
    stroked: true, filled: true, lineWidthUnits: 'pixels', getLineWidth: 2.5,
    getPosition: (d) => [d.lon, d.lat], getRadius: 13,
    getFillColor: [255, 255, 255, 35], getLineColor: [57, 208, 255, 255], pickable: false,
  });
}
```

- [ ] **Step 3: drawAll に重畳**（`const pl = pulseLayer(now); if (pl) extra.push(pl);` の後）
```javascript
  const sm = selectedMarkerLayer(); if (sm) extra.push(sm);
```

- [ ] **Step 4: refreshFeed のクリックで selected を更新→flyTo→再描画**
```javascript
function refreshFeed() {
  const items = buildFeed(feedLayers(), snapshots, ENABLED);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    selected = { lon: it.lon, lat: it.lat, title: it.title };
    window.__orbis.map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500 });
    drawAll(window.__orbis.overlay); // マーカーを即時表示
  });
}
```
（`window.__orbis.overlay` は boot で設定済み。`drawAll` は overlay を引数に取り `_overlay` も更新する既存実装。）

- [ ] **Step 5: 検証** `node --test tests/*.test.js` → 全緑。`node --check js/main.js` → OK。

- [ ] **Step 6: コミット**
```bash
git add js/main.js
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "feat(feed): neon highlight marker at flyTo target"
```

---

## Task 7: e2e 更新・最終確認・README・デプロイ

**Files:** Modify `tests/e2e/smoke.spec.js`, `README.md`

- [ ] **Step 1: e2e にベースマップ堅牢性＋selected-marker を追加**（既存アサーションは弱めない）
既存 `tests/e2e/smoke.spec.js` の末尾、ズーム確認の前後に追記：
```javascript
  // フィードクリックで selected-marker（deck レイヤー）が出る
  await page.locator('#feed .feed-row').first().click();
  await page.waitForTimeout(300);
  const hasMarker = await page.evaluate(() => {
    const layers = window.__orbis?.overlay?._props?.layers || window.__orbis?.overlay?.props?.layers || [];
    return layers.some((l) => l && l.id === 'selected-marker');
  });
  expect(hasMarker).toBe(true);
```
（`overlay` 内部の layers 参照が取れない場合は、`window.__orbis` に `selected` を露出する小改修を main.js に入れて `window.__orbis.selected` を確認する方式へ切替可。アサーションは「クリックで選択が記録される」ことを弱めず確認すること。）

- [ ] **Step 2: e2e 実行** `npx playwright test`（必要なら `npx playwright install chromium`）→ 1 PASS。ベースマップ差し替えで globe/パネル/フィード/zoom が壊れていないこと。OpenFreeMap タイル取得はネットワーク依存だが、deck レイヤーの counts と DOM 操作は基盤に依存しないため従来どおり緑になるはず。失敗時は原因（CORS/タイル/セレクタ）を特定して修正（アサーションは弱めない）。

- [ ] **Step 3: 全テスト** `node --test tests/*.test.js`（全緑）＋ `python3 -m pytest -q`（11 緑）。

- [ ] **Step 4: README にデザイン刷新を1段落追記**（ネオン濃紺ベクター地図/日本語国名/海陸色分け/紛争抗議ヒート/着地マーカー/ガイド）。

- [ ] **Step 5: コミット**
```bash
git add tests/e2e/smoke.spec.js README.md
git -c user.email="210495115+sg55555@users.noreply.github.com" -c user.name="sg55555" commit -m "test(e2e)+docs: phase-3.5 basemap/marker coverage + README"
```

- [ ] **Step 6: main へマージ＆本番デプロイ（※コントローラがユーザー確認の上で実行）**
```bash
git checkout main
git merge --no-ff phase-3.5 -m "merge: ORBIS Phase 3.5 (neon vector basemap, JA labels, heat, marker, guides)"
git push origin main
```
Vercel 自動デプロイ後、本番 https://orbis-beta.vercel.app/ を Playwright で検証（浮かぶ球体・日本語国名・海陸色・紛争抗議ヒート・フィードクリックの着地マーカー・ガイド・コンソールエラー無し）。Obsidian `Projects/orbis.md` を更新。

---

## 完了基準（spec §5）
引くとネオン濃紺の地球が星空に浮かび、海陸が色で分かれ国名が日本語で読め、紛争/抗議は赤/緑の面でにじみ、マーカーにホバーで意味が分かり、フィードクリックで飛び先にハイライト。全テスト緑→本番デプロイで確認。

## 非目標（YAGNI）
完全多言語UI・3D地形/建物・詳細POI・道路網。snapshot間補間/地震波紋（P5）。船舶（P2b）・拡張層（P4）・ニュース混在グリッド（別途）。OpenFreeMap セルフホスト（P5）。
