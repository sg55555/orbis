# ORBIS Phase 3（操作性・分かりやすさ・動き）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引くと丸い地球が宇宙に浮いて見え、左パネルでレイヤーを絞れ（永続化）、マーカーにホバーで内容が分かり、右フィードで最新イベントを追えてクリックで飛べる。貿易ルートに流れ、新規イベントにパルス。

**Architecture:** 既存の疎結合アーキ（1レイヤー=1モジュール、純粋部を分離してnode:testでテスト、deckはCDNグローバル）を踏襲。Phase 3 では純粋ロジック（state/feed/motion/starfield 生成・各レイヤーの tooltip/toFeedItems）を `js/lib` と各レイヤーに追加し、UI描画（panel/feed/starfield canvas）と rAF モーションループを `js/ui` と `js/main.js` に結線する。deck 再構築は既存の `buildDeckLayers(ENABLED, snapshots)` をそのまま使い、ENABLED を localStorage 永続化に置き換える。

**Tech Stack:** Vanilla JS (ESM, no build) / MapLibre GL 4.7.1 (globe) / deck.gl 9.0.27 (MapboxOverlay) / node:test（JSユニット）/ Playwright（e2e）。

**実装順序:** A 地球ズームアウト → B 左トグルパネル → C ツールチップ → D 右フィード → D 動的モーション（最後）。各段階で単独に意味があり、コミット単位。

**確認済みデータスキーマ（実データ由来）:**
- quakes points: `{ id, lon, lat, depth, mag, place, time(ms epoch), url }`
- flights points: `{ icao24, callsign, lon, lat, alt(m,null可), on_ground, velocity(m/s), heading }`（離散時刻なし→フィード対象外）
- conflict/protests points: `{ id, root, lon, lat, place(国コード), mentions, tone, date("YYYYMMDDHHMMSS" UTC文字列), url }`
- trade GeoJSON features: LineString/Point とも `properties.name`（航路名・要衝名）
- deck レイヤーID: `quakes` / `flights` / `conflict` / `protests` / `trade-routes` / `trade-chokepoints`

**テスト実行コマンド（既存）:** JSユニット = `node --test tests/*.test.js`（e2e除外）。e2e = `npx playwright test`。Python = `python3 -m pytest`（本フェーズは変更なし）。

---

## ファイル構成

**新規作成:**
- `js/lib/state.js` — ENABLED の純粋操作 `loadEnabled` / `toggleEnabled` ＋ I/O薄ラッパ `readStored` / `writeStored`
- `js/lib/feed.js` — `buildFeed(layers, snapshots, enabled)`（集約・降順・cap）＋ `parseGdeltDate`
- `js/lib/motion.js` — `pointAlongPath(coords, t)` / `diffNewIds(prevIds, curr)`
- `js/lib/starfield.js` — `generateStars(count, w, h, rng)`（純粋）＋ `drawStars(canvas, stars)`（描画）
- `js/ui/panel.js` — 左トグルパネル描画＋トグル結線（永続化は state.js 経由）
- `js/ui/feed.js` — 右イベントフィード描画＋クリックで flyTo
- 各テスト: `tests/state.test.js` / `tests/feed.test.js` / `tests/motion.test.js` / `tests/starfield.test.js` / `tests/tooltip.test.js`

**変更:**
- `js/map.js` — `minZoom`/初期 zoom 調整、overlay に `getTooltip` 配線（main から差し込めるよう）
- `js/layers/*.js`（quakes/flights/conflict/protests/trade）— 各に `tooltip(object)` を追加、quakes/conflict/protests に `toFeedItems(snapshot)` を追加
- `js/layers/registry.js` — `tooltipFor(deckLayerId, object)` ＋ フィード対象列挙ヘルパ `feedLayers()`
- `js/main.js` — パネル/フィード結線、getTooltip、ENABLED 永続化、rAF モーションループ
- `index.html` — 星空 canvas、左パネル `#panel`、右フィード `#feed` の要素追加（`#legend` を `#panel` に発展）
- `css/orbis.css` — パネル/フィード/星空/パルスのスタイル
- `tests/e2e/smoke.spec.js` — 凡例→パネル構造変更に追随＋トグル/フィード/ズームのアサーション追加

---

## Task 1: ENABLED の純粋状態管理 + 永続化（state.js）

**Files:**
- Create: `js/lib/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/state.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnabled, toggleEnabled } from '../js/lib/state.js';

const ALL = ['quakes', 'flights', 'conflict', 'protests', 'trade'];

test('loadEnabled: stored が null なら全レイヤー ON', () => {
  const e = loadEnabled(ALL, null);
  assert.deepEqual([...e].sort(), [...ALL].sort());
});

test('loadEnabled: stored 配列は有効idのみに絞る（未知idは捨てる）', () => {
  const e = loadEnabled(ALL, ['quakes', 'trade', 'ghost']);
  assert.deepEqual([...e].sort(), ['quakes', 'trade']);
});

test('loadEnabled: stored が空配列なら全 OFF', () => {
  assert.equal(loadEnabled(ALL, []).size, 0);
});

test('loadEnabled: 壊れた stored（非配列）は全 ON にフォールバック', () => {
  assert.equal(loadEnabled(ALL, 'garbage').size, ALL.length);
});

test('toggleEnabled: 新しい Set を返し、元を破壊しない', () => {
  const base = new Set(['quakes']);
  const off = toggleEnabled(base, 'quakes');
  assert.equal(off.has('quakes'), false);
  assert.equal(base.has('quakes'), true); // 元は不変
  const on = toggleEnabled(base, 'flights');
  assert.equal(on.has('flights'), true);
  assert.equal(on.has('quakes'), true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/state.test.js`
Expected: FAIL（`Cannot find module ... state.js`）

- [ ] **Step 3: 最小実装**

`js/lib/state.js`:
```javascript
// ENABLED（有効レイヤー集合）の純粋操作と localStorage 薄ラッパ。
const KEY = 'orbis.enabled.v1';

// stored: 有効idの配列（保存形式）。null/不正なら全 ON。
export function loadEnabled(allIds, stored) {
  if (!Array.isArray(stored)) return new Set(allIds);
  return new Set(allIds.filter((id) => stored.includes(id)));
}

// id をトグルした新しい Set を返す（不変）。
export function toggleEnabled(set, id) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// I/O（テストでは未使用。ブラウザのみ）。
export function readStored(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return null;
  try { return JSON.parse(storage.getItem(KEY)); } catch { return null; }
}
export function writeStored(set, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  if (!storage) return;
  try { storage.setItem(KEY, JSON.stringify([...set])); } catch { /* noop */ }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/state.test.js`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add js/lib/state.js tests/state.test.js
git commit -m "feat(state): pure loadEnabled/toggleEnabled + localStorage wrapper"
```

---

## Task 2: 各レイヤーの tooltip(object) + registry.tooltipFor

**Files:**
- Modify: `js/layers/quakes.js`, `js/layers/flights.js`, `js/layers/conflict.js`, `js/layers/protests.js`, `js/layers/trade.js`
- Modify: `js/layers/registry.js`
- Test: `tests/tooltip.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/tooltip.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tooltipFor } from '../js/layers/registry.js';

test('quakes tooltip: M{mag} {place}', () => {
  const o = { mag: 3.6, place: '93 km SSE of Perryville, Alaska' };
  assert.equal(tooltipFor('quakes', o), 'M3.6 93 km SSE of Perryville, Alaska');
});

test('flights tooltip: callsign + 高度 + 速度（空中）', () => {
  const o = { callsign: 'RTY484 ', alt: 1821.18, velocity: 56.83, on_ground: false };
  assert.equal(tooltipFor('flights', o), 'RTY484 · 1821m · 57m/s');
});

test('flights tooltip: 地上は「地上」表記', () => {
  const o = { callsign: 'AIC1TA', alt: null, velocity: 7.46, on_ground: true };
  assert.equal(tooltipFor('flights', o), 'AIC1TA · 地上 · 7m/s');
});

test('conflict tooltip: {place}（domain）', () => {
  const o = { place: 'FR', url: 'https://www.dailymail.com/tv/article-1.html' };
  assert.equal(tooltipFor('conflict', o), 'FR（dailymail.com）');
});

test('protests tooltip: {place}（domain）', () => {
  const o = { place: 'US', url: 'https://www.sacurrent.com/news/x' };
  assert.equal(tooltipFor('protests', o), 'US（sacurrent.com）');
});

test('trade-chokepoints / trade-routes tooltip: properties.name', () => {
  const choke = { properties: { name: 'Suez Canal' } };
  const route = { properties: { name: 'Trans-Pacific' } };
  assert.equal(tooltipFor('trade-chokepoints', choke), 'Suez Canal');
  assert.equal(tooltipFor('trade-routes', route), 'Trans-Pacific');
});

test('tooltipFor: 未知 deckLayerId や null object は null', () => {
  assert.equal(tooltipFor('quakes', null), null);
  assert.equal(tooltipFor('ghost', {}), null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/tooltip.test.js`
Expected: FAIL（`tooltipFor is not a function`）

- [ ] **Step 3: 各レイヤーに tooltip を追加 + ドメイン抽出ヘルパ**

`js/lib/geo.js` の末尾に追加（純粋なURL→ドメイン抽出。Node/ブラウザ両対応、`www.` を除去）:
```javascript
// URL からドメインを抽出（www. 除去）。失敗時は空文字。
export function hostnameOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}
```

`js/layers/quakes.js` の `quakesLayer` オブジェクトに（`toDeckLayer` の後ろ、閉じ `};` の前）追加:
```javascript
  tooltip(o) {
    if (!o) return null;
    return `M${o.mag} ${o.place}`;
  },
```

`js/layers/flights.js` の `flightsLayer` に追加:
```javascript
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    const spd = `${Math.round(o.velocity || 0)}m/s`;
    return `${String(o.callsign || '').trim()} · ${alt} · ${spd}`;
  },
```

`js/layers/conflict.js` 冒頭の import を差し替え、`conflictLayer` に tooltip を追加:
```javascript
import { eventRadius, hostnameOf } from '../lib/geo.js';
```
```javascript
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`;
  },
```

`js/layers/protests.js` も同様（import に hostnameOf を追加し、`protestsLayer` に同じ tooltip を追加）:
```javascript
import { eventRadius, hostnameOf } from '../lib/geo.js';
```
```javascript
  tooltip(o) {
    if (!o) return null;
    return `${o.place}（${hostnameOf(o.url)}）`;
  },
```

`js/layers/trade.js` の `tradeLayer` に追加（航路・要衝とも GeoJSON feature の properties.name）:
```javascript
  tooltip(o) {
    if (!o || !o.properties) return null;
    return o.properties.name || null;
  },
```

- [ ] **Step 4: registry に tooltipFor を追加**

`js/layers/registry.js`（`getLayer` の後ろ）に追加:
```javascript
// deck レイヤーID → 論理レイヤーID（trade は2つの deck レイヤーに分かれる）。
const DECK_TO_LAYER = {
  quakes: 'quakes', flights: 'flights', conflict: 'conflict', protests: 'protests',
  'trade-routes': 'trade', 'trade-chokepoints': 'trade',
};

// deck の picking 結果から、レイヤー別フォーマット済みツールチップ文字列を返す。
export function tooltipFor(deckLayerId, object) {
  const l = getLayer(DECK_TO_LAYER[deckLayerId]);
  return (l && l.tooltip) ? l.tooltip(object) : null;
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test tests/tooltip.test.js`
Expected: PASS（7 tests）。続けて既存も緑であることを確認: `node --test tests/*.test.js`

- [ ] **Step 6: コミット**

```bash
git add js/lib/geo.js js/layers/*.js tests/tooltip.test.js
git commit -m "feat(tooltip): per-layer tooltip(object) + registry.tooltipFor"
```

---

## Task 3: フィード集約（feed.js）+ 各レイヤー toFeedItems

**Files:**
- Create: `js/lib/feed.js`
- Modify: `js/layers/quakes.js`, `js/layers/conflict.js`, `js/layers/protests.js`
- Modify: `js/layers/registry.js`（`feedLayers()` 追加）
- Test: `tests/feed.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/feed.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, parseGdeltDate } from '../js/lib/feed.js';

test('parseGdeltDate: "YYYYMMDDHHMMSS"(UTC) を epoch ms に', () => {
  assert.equal(parseGdeltDate('20260613173000'), Date.UTC(2026, 5, 13, 17, 30, 0));
  assert.equal(parseGdeltDate('bad'), 0);
});

// toFeedItems を持つ最小レイヤースタブ
const quakes = {
  id: 'quakes',
  toFeedItems: (s) => (s.points || []).map((p) => ({
    id: p.id, time: p.time, title: `M${p.mag}`, layerId: 'quakes', lon: p.lon, lat: p.lat,
  })),
};
const conflict = {
  id: 'conflict',
  toFeedItems: (s) => (s.points || []).map((p) => ({
    id: p.id, time: parseGdeltDate(p.date), title: p.place, layerId: 'conflict', lon: p.lon, lat: p.lat,
  })),
};

test('buildFeed: 有効レイヤーのみ集約し time 降順', () => {
  const snaps = {
    quakes: { points: [{ id: 'q1', mag: 2, lon: 1, lat: 1, time: 100 }, { id: 'q2', mag: 3, lon: 2, lat: 2, time: 300 }] },
    conflict: { points: [{ id: 'c1', place: 'US', lon: 3, lat: 3, date: '20260101000000' }] },
  };
  const out = buildFeed([quakes, conflict], snaps, new Set(['quakes', 'conflict']));
  assert.deepEqual(out.map((i) => i.id), ['c1', 'q2', 'q1']); // c1=2026 epoch が最大
});

test('buildFeed: 無効レイヤーは除外', () => {
  const snaps = { quakes: { points: [{ id: 'q1', mag: 2, lon: 1, lat: 1, time: 100 }] } };
  const out = buildFeed([quakes, conflict], snaps, new Set(['conflict']));
  assert.equal(out.length, 0);
});

test('buildFeed: cap=100 で上位のみ', () => {
  const points = Array.from({ length: 150 }, (_, i) => ({ id: `q${i}`, mag: 1, lon: 0, lat: 0, time: i }));
  const out = buildFeed([quakes], { quakes: { points } }, new Set(['quakes']));
  assert.equal(out.length, 100);
  assert.equal(out[0].id, 'q149'); // 最新（time 最大）が先頭
});

test('buildFeed: toFeedItems を持たない/snapshot欠如レイヤーは無視', () => {
  const noFeed = { id: 'flights' };
  const out = buildFeed([noFeed, quakes], {}, new Set(['flights', 'quakes']));
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/feed.test.js`
Expected: FAIL（`Cannot find module ... feed.js`）

- [ ] **Step 3: feed.js を実装**

`js/lib/feed.js`:
```javascript
// 離散時刻イベントを持つレイヤーを集約してフィード配列を作る純粋ロジック。
const CAP = 100;

// GDELT の "YYYYMMDDHHMMSS"（UTC）を epoch ms に。不正は 0。
export function parseGdeltDate(s) {
  if (typeof s !== 'string' || !/^\d{14}$/.test(s)) return 0;
  const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
  const h = +s.slice(8, 10), mi = +s.slice(10, 12), se = +s.slice(12, 14);
  return Date.UTC(y, mo, d, h, mi, se);
}

// layers: レイヤーオブジェクト配列。snapshots: {id:snap}。enabled: Set。
// 各レイヤーの任意 toFeedItems(snapshot) を集約→time降順→上位CAP件。
export function buildFeed(layers, snapshots, enabled, cap = CAP) {
  const items = [];
  for (const l of layers) {
    if (!enabled.has(l.id) || typeof l.toFeedItems !== 'function') continue;
    const snap = snapshots[l.id];
    if (!snap) continue;
    for (const it of l.toFeedItems(snap)) items.push(it);
  }
  items.sort((a, b) => b.time - a.time);
  return items.slice(0, cap);
}
```

- [ ] **Step 4: 各レイヤーに toFeedItems を追加**

`js/layers/quakes.js` の `quakesLayer` に追加（tooltip の後ろ）:
```javascript
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: p.time, title: `M${p.mag} ${p.place}`, layerId: 'quakes', lon: p.lon, lat: p.lat,
    }));
  },
```

`js/layers/conflict.js` の冒頭 import に `parseGdeltDate` を足し、`conflictLayer` に追加:
```javascript
import { eventRadius, hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';
```
```javascript
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `紛争 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'conflict', lon: p.lon, lat: p.lat,
    }));
  },
```

`js/layers/protests.js` も同様:
```javascript
import { eventRadius, hostnameOf } from '../lib/geo.js';
import { parseGdeltDate } from '../lib/feed.js';
```
```javascript
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: parseGdeltDate(p.date), title: `抗議 ${p.place}（${hostnameOf(p.url)}）`,
      layerId: 'protests', lon: p.lon, lat: p.lat,
    }));
  },
```

- [ ] **Step 5: registry に feedLayers() を追加**

`js/layers/registry.js`（`tooltipFor` の後ろ）に追加:
```javascript
// toFeedItems を実装するレイヤーだけを返す（フィード対象）。
export function feedLayers() {
  return layers.filter((l) => typeof l.toFeedItems === 'function');
}
```

- [ ] **Step 6: テストが通ることを確認**

Run: `node --test tests/feed.test.js`
Expected: PASS（5 tests）。続けて `node --test tests/*.test.js` 全緑を確認。

- [ ] **Step 7: コミット**

```bash
git add js/lib/feed.js js/layers/quakes.js js/layers/conflict.js js/layers/protests.js js/layers/registry.js tests/feed.test.js
git commit -m "feat(feed): buildFeed aggregation + per-layer toFeedItems + parseGdeltDate"
```

---

## Task 4: モーション純粋ロジック（motion.js）

**Files:**
- Create: `js/lib/motion.js`
- Test: `tests/motion.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/motion.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointAlongPath, diffNewIds } from '../js/lib/motion.js';

const path = [[0, 0], [10, 0], [10, 10]]; // 総長 20（各辺10）

test('pointAlongPath: t=0 は始点、t=1 は終点', () => {
  assert.deepEqual(pointAlongPath(path, 0), [0, 0]);
  assert.deepEqual(pointAlongPath(path, 1), [10, 10]);
});

test('pointAlongPath: t=0.5 は経路の中点（最初の辺の終わり）', () => {
  const p = pointAlongPath(path, 0.5);
  assert.ok(Math.abs(p[0] - 10) < 1e-6);
  assert.ok(Math.abs(p[1] - 0) < 1e-6);
});

test('pointAlongPath: t=0.75 は2辺目の中間', () => {
  const p = pointAlongPath(path, 0.75);
  assert.ok(Math.abs(p[0] - 10) < 1e-6);
  assert.ok(Math.abs(p[1] - 5) < 1e-6);
});

test('pointAlongPath: t は [0,1] にクランプ', () => {
  assert.deepEqual(pointAlongPath(path, -1), [0, 0]);
  assert.deepEqual(pointAlongPath(path, 2), [10, 10]);
});

test('pointAlongPath: 退化パス（点1個/空）は始点 or null', () => {
  assert.deepEqual(pointAlongPath([[3, 4]], 0.5), [3, 4]);
  assert.equal(pointAlongPath([], 0.5), null);
});

test('diffNewIds: 前回に無く今回にある id を返す', () => {
  const prev = new Set(['a', 'b']);
  assert.deepEqual(diffNewIds(prev, [{ id: 'b' }, { id: 'c' }, { id: 'd' }]).sort(), ['c', 'd']);
});

test('diffNewIds: prev が空（初回）は新規なし扱い', () => {
  assert.deepEqual(diffNewIds(null, [{ id: 'a' }]), []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/motion.test.js`
Expected: FAIL（`Cannot find module ... motion.js`）

- [ ] **Step 3: motion.js を実装**

`js/lib/motion.js`:
```javascript
// 動的モーション用の純粋ジオメトリ/差分ロジック。

// 折れ線 coords（[[lon,lat],...]）上を t∈[0,1] で進んだ点を線分補間で返す。
// 各辺は均等な弧長ではなく「2D直線距離」で重み付け。退化時は始点 or null。
export function pointAlongPath(coords, t) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (coords.length === 1) return coords[0].slice();
  const tt = Math.min(1, Math.max(0, t));
  // 各辺長と総長
  const segLen = [];
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const dx = coords[i + 1][0] - coords[i][0];
    const dy = coords[i + 1][1] - coords[i][1];
    const len = Math.hypot(dx, dy);
    segLen.push(len);
    total += len;
  }
  if (total === 0) return coords[0].slice();
  let target = tt * total;
  for (let i = 0; i < segLen.length; i++) {
    if (target <= segLen[i] || i === segLen.length - 1) {
      const f = segLen[i] === 0 ? 0 : target / segLen[i];
      const a = coords[i], b = coords[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    target -= segLen[i];
  }
  return coords[coords.length - 1].slice();
}

// prevIds(Set|null) に無く curr（{id}配列）にある id 一覧。
// prev が null/未指定（初回）は新規なし扱い（初回ロードで全件パルスを防ぐ）。
export function diffNewIds(prevIds, curr) {
  if (!prevIds) return [];
  const out = [];
  for (const o of curr) {
    if (o && o.id != null && !prevIds.has(o.id)) out.push(o.id);
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/motion.test.js`
Expected: PASS（7 tests）

- [ ] **Step 5: コミット**

```bash
git add js/lib/motion.js tests/motion.test.js
git commit -m "feat(motion): pure pointAlongPath + diffNewIds"
```

---

## Task 5: 星空生成（starfield.js）

**Files:**
- Create: `js/lib/starfield.js`
- Test: `tests/starfield.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/starfield.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStars } from '../js/lib/starfield.js';

// 決定的 RNG（線形合同法）でテストを再現可能に
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

test('generateStars: 指定個数を返す', () => {
  assert.equal(generateStars(50, 800, 600, seeded(1)).length, 50);
});

test('generateStars: 全ての星が画面範囲内', () => {
  for (const st of generateStars(200, 800, 600, seeded(2))) {
    assert.ok(st.x >= 0 && st.x <= 800);
    assert.ok(st.y >= 0 && st.y <= 600);
    assert.ok(st.r > 0);
    assert.ok(st.alpha > 0 && st.alpha <= 1);
  }
});

test('generateStars: 同一 seed は同一結果（再乱数しない設計の担保）', () => {
  const a = generateStars(10, 100, 100, seeded(7));
  const b = generateStars(10, 100, 100, seeded(7));
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/starfield.test.js`
Expected: FAIL（`Cannot find module ... starfield.js`）

- [ ] **Step 3: starfield.js を実装**

`js/lib/starfield.js`:
```javascript
// 軽量星空。生成（純粋）と描画（canvas）を分離。星は一度だけ生成し再乱数しない。

// rng: () => [0,1) の関数（テストでは seeded を注入）。
export function generateStars(count, w, h, rng = Math.random) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.4 + rng() * 1.1,
      alpha: 0.25 + rng() * 0.6,
    });
  }
  return stars;
}

// canvas に星を描画（ブラウザのみ）。呼び出し側でリサイズ時に再 draw する。
export function drawStars(canvas, stars) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = '#cfe0f5';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// canvas を要素サイズに合わせ、星を生成して描く。返り値は星配列（リサイズ再描画用）。
export function mountStarfield(canvas, density = 0.00018) {
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = w; canvas.height = h;
    const count = Math.min(600, Math.round(w * h * density));
    const stars = generateStars(count, w, h); // 一度生成
    drawStars(canvas, stars);
    return stars;
  };
  let stars = resize();
  window.addEventListener('resize', () => { stars = resize(); }, { passive: true });
  return stars;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/starfield.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add js/lib/starfield.js tests/starfield.test.js
git commit -m "feat(starfield): pure generateStars + canvas draw/mount"
```

---

## Task 6: 地球ズームアウト（map.js）+ 星空背景・HTML/CSS 結線

**Files:**
- Modify: `js/map.js`, `index.html`, `css/orbis.css`, `js/main.js`

- [ ] **Step 1: map.js の視点を引く + getTooltip 配線**

`js/map.js` の `initMap` の Map 生成オプションを次に変更（`minZoom: 0` を追加、初期 `zoom` を 1.2 に）:
```javascript
  const map = new maplibregl.Map({
    container,
    style: DARK_STYLE,
    center: [0, 20],
    zoom: 1.2,
    minZoom: 0,
    attributionControl: true,
  });
```
同ファイルの overlay 生成を、main から getTooltip を差せるよう関数引数化:
```javascript
export function initMap(container, getTooltip) {
  // ...上の map 生成...
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [], getTooltip });
  map.addControl(overlay);
  return { map, overlay };
}
```

- [ ] **Step 2: index.html に星空 canvas を追加**

`#map-wrap` 内、`<div id="map"></div>` の**直前**に星空 canvas を追加（背面に置く）:
```html
    <div id="map-wrap">
      <canvas id="starfield"></canvas>
      <div id="map"></div>
```

- [ ] **Step 3: css に星空スタイルを追加**

`css/orbis.css` の `#map { ... }` の直後に追加:
```css
#starfield { position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse at 50% 40%, #0a1220 0%, #05080f 70%); }
#map { z-index: 1; background: transparent; }
```
（MapLibre の globe は球外が透明になるため、背面の星空が見える）

- [ ] **Step 4: main.js で星空をマウント**

`js/main.js` の import 群に追加:
```javascript
import { mountStarfield } from './lib/starfield.js';
```
`boot()` の `const { map, overlay } = initMap('map');` 直後に追加:
```javascript
  mountStarfield(document.getElementById('starfield'));
```

- [ ] **Step 5: ローカルで目視確認**

Run: `python3 -m http.server 8000` を起動し、ブラウザで `localhost:8000` を開く。
Expected: 引くと球体の地球が宇宙（星空）に浮き、最大までズームアウトできる。既存レイヤーは従来どおり描画。
（自動確認は Task 9 の e2e で実施。ここでは手動目視のみ）

- [ ] **Step 6: コミット**

```bash
git add js/map.js index.html css/orbis.css js/main.js
git commit -m "feat(globe): zoom-out to space view + starfield background"
```

---

## Task 7: 左トグルパネル（panel.js）— 凡例をインタラクティブ化

**Files:**
- Create: `js/ui/panel.js`
- Modify: `index.html`, `css/orbis.css`, `js/main.js`

- [ ] **Step 1: index.html の #legend を #panel に置換**

`index.html` の `<div id="legend">...</div>` の行を次に置換:
```html
      <div id="panel" class="side-panel">
        <div class="panel-head"><h4>レイヤー / Layers</h4>
          <button id="panel-toggle" class="collapse-btn" aria-label="パネル折りたたみ">‹</button></div>
        <div id="panel-rows"></div>
      </div>
```

- [ ] **Step 2: panel.js を実装**

`js/ui/panel.js`:
```javascript
// 左トグルパネル。各レイヤー = チェック + 凡例スウォッチ + ライブ件数。
// 純粋な状態操作は js/lib/state.js（loadEnabled/toggleEnabled）に委譲。
import { toggleEnabled, writeStored } from '../lib/state.js';

// layers: レイヤー配列, enabled: Set, onChange(nextSet): トグル時コールバック。
// counts 取得は getCounts():{id:number}。renderPanel は要素を一度だけ生成し、
// 件数更新は updateCounts で textContent だけ差し替える（入力要素を作り直さない）。
export function renderPanel(root, layers, getEnabled, getCounts, onChange) {
  root.innerHTML = layers.map((l) => {
    const sw = (l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)';
    return `<label class="layer-row" data-id="${l.id}">
      <input type="checkbox" class="layer-toggle" />
      <span class="swatch" style="color:${sw};background:${sw}"></span>
      <span class="layer-label">${l.label}</span>
      <span class="layer-count" data-count="${l.id}">–</span>
    </label>`;
  }).join('');

  // 初期チェック状態を反映
  syncChecks(root, getEnabled());

  // イベント委譲（再生成に強い）
  root.addEventListener('change', (e) => {
    const cb = e.target.closest('.layer-toggle');
    if (!cb) return;
    const id = cb.closest('.layer-row').dataset.id;
    const next = toggleEnabled(getEnabled(), id);
    writeStored(next);
    onChange(next);
  });

  return {
    updateCounts() {
      const counts = getCounts();
      root.querySelectorAll('.layer-count').forEach((el) => {
        const n = counts[el.dataset.count];
        el.textContent = (n == null) ? '–' : String(n);
      });
    },
    syncChecks() { syncChecks(root, getEnabled()); },
  };
}

function syncChecks(root, enabled) {
  root.querySelectorAll('.layer-row').forEach((row) => {
    const cb = row.querySelector('.layer-toggle');
    if (cb) cb.checked = enabled.has(row.dataset.id);
  });
}

// 折りたたみボタン結線（パネルに collapsed クラスをトグル）。
export function wireCollapse(panelEl, btnEl) {
  btnEl.addEventListener('click', () => {
    panelEl.classList.toggle('collapsed');
    btnEl.textContent = panelEl.classList.contains('collapsed') ? '›' : '‹';
  });
}
```

- [ ] **Step 3: css にパネルスタイルを追加**

`css/orbis.css` の末尾に追加（旧 `#legend` 系の規則は残置可だが、`#panel` を主に使う）:
```css
.side-panel { position: absolute; left: 12px; top: 12px; z-index: 5; width: 220px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; backdrop-filter: blur(8px); font-size: 12px; max-height: 70vh; overflow-y: auto; }
.panel-head { display: flex; align-items: center; justify-content: space-between; }
.side-panel h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); }
.collapse-btn { background: none; border: 1px solid var(--line); color: var(--muted);
  border-radius: 6px; cursor: pointer; width: 22px; height: 22px; line-height: 1; }
.layer-row { display: flex; align-items: center; gap: 7px; margin: 5px 0; cursor: pointer; }
.layer-row .swatch { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 8px currentColor; flex: 0 0 auto; }
.layer-label { flex: 1; }
.layer-count { color: var(--cyan); font-variant-numeric: tabular-nums; font-size: 11px; }
.side-panel.collapsed #panel-rows { display: none; }
.side-panel.collapsed { width: auto; }
```

- [ ] **Step 4: main.js を結線（renderLegend を置換、ENABLED を永続化）**

`js/main.js` を次のように変更:

import 群:
```javascript
import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers, tooltipFor } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';
import { loadEnabled, readStored } from './lib/state.js';
import { mountStarfield } from './lib/starfield.js';
import { renderPanel, wireCollapse } from './ui/panel.js';
```

`ENABLED` の固定 Set 定義を削除し、代わりに可変の状態として持つ:
```javascript
const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests'];
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade'];
let ENABLED = loadEnabled(ALL_IDS, readStored());

const snapshots = {};
let panel;
```

`renderLegend()` 関数を削除する。

`rebuild(overlay)` はそのまま（`buildDeckLayers(ENABLED, snapshots)` を使用）。末尾に panel 件数更新を追加:
```javascript
function rebuild(overlay) {
  setDeckLayers(overlay, buildDeckLayers(ENABLED, snapshots));
  window.__orbis.counts = Object.fromEntries(
    Object.entries(snapshots).map(([k, v]) => [k, (v && (v.points?.length ?? v.features?.length)) ?? 0])
  );
  if (panel) panel.updateCounts();
}
```

`boot()` を次に変更（initMap に getTooltip、星空マウント、panel 結線）:
```javascript
function boot() {
  const { map, overlay } = initMap('map', (info) =>
    (info.object && info.layer) ? tooltipFor(info.layer.id, info.object) : null
  );
  mountStarfield(document.getElementById('starfield'));
  window.__orbis = { map, overlay, counts: {} };

  panel = renderPanel(
    document.getElementById('panel-rows'),
    layers,
    () => ENABLED,
    () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); }
  );
  wireCollapse(document.getElementById('panel'), document.getElementById('panel-toggle'));

  map.on('load', async () => {
    document.getElementById('loading').classList.add('hidden');
    try {
      const trade = layers.find((l) => l.id === 'trade');
      if (trade) snapshots.trade = await trade.fetch();
    } catch { /* noop */ }
    rebuild(overlay);

    startPolling(POLL_LAYERS, POLL_MS, (polled) => {
      Object.assign(snapshots, polled);
      rebuild(overlay);
      updateFreshness();
    });
  });
}
```

- [ ] **Step 5: JSユニット全緑を確認**

Run: `node --test tests/*.test.js`
Expected: PASS（既存 + 新規。tooltipFor の import が main 経由で増えるが registry は変更済）

- [ ] **Step 6: ローカル目視 + コミット**

`localhost:8000` でトグルON/OFFがレイヤー描画に反映、件数表示、折りたたみが効くことを目視。
```bash
git add js/ui/panel.js index.html css/orbis.css js/main.js
git commit -m "feat(panel): interactive layer toggle panel with live counts + persistence"
```

---

## Task 8: 右イベントフィード（feed.js UI）+ flyTo

**Files:**
- Create: `js/ui/feed.js`
- Modify: `index.html`, `css/orbis.css`, `js/main.js`

- [ ] **Step 1: index.html に右フィード要素を追加**

`#map-wrap` 内、`#loading` の**直前**に追加:
```html
      <div id="feed" class="side-panel feed-panel">
        <div class="panel-head"><h4>イベント / Feed</h4>
          <button id="feed-toggle" class="collapse-btn" aria-label="フィード折りたたみ">›</button></div>
        <div id="feed-rows"></div>
      </div>
```

- [ ] **Step 2: feed.js（UI）を実装**

`js/ui/feed.js`:
```javascript
// 右イベントフィード描画。クリックで地図 flyTo。集約は js/lib/feed.js。
import { formatFreshness } from '../lib/geo.js';

const COLOR = { quakes: 'rgb(255,176,40)', conflict: 'rgb(255,60,80)', protests: 'rgb(94,255,166)' };

// root に items を描画。onPick(item) はクリック時コールバック。
export function renderFeed(root, items, onPick) {
  root.innerHTML = items.map((it, i) => {
    const c = COLOR[it.layerId] || 'var(--cyan)';
    return `<div class="feed-row" data-i="${i}">
      <span class="feed-dot" style="color:${c};background:${c}"></span>
      <span class="feed-title">${escapeHtml(it.title)}</span>
      <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
    </div>`;
  }).join('') || '<div class="feed-empty">イベントなし</div>';

  // イベント委譲（再生成に強い）。直近 items をクロージャで参照。
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function wireCollapse(panelEl, btnEl) {
  btnEl.addEventListener('click', () => {
    panelEl.classList.toggle('collapsed');
    btnEl.textContent = panelEl.classList.contains('collapsed') ? '‹' : '›';
  });
}
```

- [ ] **Step 3: css にフィードスタイルを追加**

`css/orbis.css` 末尾に追加:
```css
.feed-panel { left: auto; right: 12px; width: 260px; }
.feed-row { display: flex; align-items: center; gap: 7px; padding: 5px 4px; cursor: pointer;
  border-bottom: 1px solid rgba(28,44,72,.5); }
.feed-row:hover { background: rgba(57,208,255,.08); }
.feed-dot { width: 8px; height: 8px; border-radius: 50%; box-shadow: 0 0 6px currentColor; flex: 0 0 auto; }
.feed-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.feed-time { color: var(--muted); font-size: 10px; flex: 0 0 auto; }
.feed-empty { color: var(--muted); padding: 8px 4px; }
.feed-panel.collapsed #feed-rows { display: none; }
.feed-panel.collapsed { width: auto; }
```

- [ ] **Step 4: main.js でフィードを結線**

import に追加:
```javascript
import { buildFeed } from './lib/feed.js';
import { feedLayers } from './layers/registry.js';
import { renderFeed, wireCollapse as wireFeedCollapse } from './ui/feed.js';
```
（注: `feedLayers` は registry からの追加 export。panel の `wireCollapse` と名前衝突するため feed 側は別名 import）

モジュールスコープに `let feedView;` は不要（renderFeed は毎回呼ぶ）。`rebuild` の末尾（panel.updateCounts の後）にフィード更新を追加:
```javascript
  refreshFeed();
```
新しい関数を `rebuild` の下に追加:
```javascript
function refreshFeed() {
  const items = buildFeed(feedLayers(), snapshots, ENABLED);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    window.__orbis.map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500 });
  });
}
```
`boot()` の panel 結線の後にフィード折りたたみ結線を追加:
```javascript
  wireFeedCollapse(document.getElementById('feed'), document.getElementById('feed-toggle'));
```

- [ ] **Step 5: JSユニット全緑 + 目視**

Run: `node --test tests/*.test.js` → PASS。
`localhost:8000` で右フィードに地震/紛争/抗議イベントが時系列で並び、クリックで地図がその座標へ flyTo することを目視。

- [ ] **Step 6: コミット**

```bash
git add js/ui/feed.js index.html css/orbis.css js/main.js
git commit -m "feat(feed-ui): right event feed with click-to-flyTo + collapse"
```

---

## Task 9: 動的モーション（フロー粒子 + 新規イベントパルス）

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: フロー粒子レイヤーを作る関数を追加**

`js/main.js` の import に追加:
```javascript
import { pointAlongPath, diffNewIds } from './lib/motion.js';
```
モジュールスコープに状態を追加:
```javascript
const REDUCED = typeof matchMedia !== 'undefined'
  && matchMedia('(prefers-reduced-motion: reduce)').matches;
let motionT = 0;          // 0..1 ループする位相
let prevIds = {};         // layerId -> Set（前回のid集合。新規検出用）
let pulses = [];          // { lon, lat, born } 出現パルス
```

貿易航路のフロー粒子（ScatterplotLayer）を作る関数を追加:
```javascript
// trade スナップショットの LineString 上を流れる粒子レイヤー（1航路あたり数粒子）。
function flowParticlesLayer() {
  const geo = snapshots.trade;
  if (!geo || !geo.features || REDUCED) return null;
  const lines = geo.features.filter((f) => f.geometry && f.geometry.type === 'LineString');
  const PER = 3; // 1航路あたり粒子数（軽量）
  const pts = [];
  for (const f of lines) {
    for (let k = 0; k < PER; k++) {
      const t = (motionT + k / PER) % 1;
      const p = pointAlongPath(f.geometry.coordinates, t);
      if (p) pts.push({ position: p });
    }
  }
  return new deck.ScatterplotLayer({
    id: 'trade-flow', data: pts, radiusUnits: 'pixels',
    getPosition: (d) => d.position, getRadius: 2.5,
    getFillColor: [120, 240, 255, 220], pickable: false,
  });
}
```

新規イベントのパルスリング（ScatterplotLayer・stroke のみ）を作る関数:
```javascript
// pulses（出現後 ~1.5s）の拡大リング。期限切れは描画前に除去。
const PULSE_MS = 1500;
function pulseLayer(now) {
  pulses = pulses.filter((p) => now - p.born < PULSE_MS);
  if (REDUCED || pulses.length === 0) return null;
  return new deck.ScatterplotLayer({
    id: 'event-pulse', data: pulses, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => 6 + 30 * ((now - p.born) / PULSE_MS),
    getLineColor: (p) => [120, 240, 255, Math.round(220 * (1 - (now - p.born) / PULSE_MS))],
    updateTriggers: { getRadius: now, getLineColor: now },
    pickable: false,
  });
}
```

- [ ] **Step 2: 新規イベント検出を rebuild に組み込む**

`js/main.js` の `rebuild` を拡張し、ポーリング更新時に新規 id を pulses へ積む。`rebuild` の先頭（setDeckLayers の前）に追加:
```javascript
  // 新規イベント検出（quakes/conflict/protests）。初回(prevIds 空)はパルスしない。
  for (const id of ['quakes', 'conflict', 'protests']) {
    const snap = snapshots[id];
    if (!snap || !snap.points) continue;
    const newIds = diffNewIds(prevIds[id], snap.points);
    if (prevIds[id]) {
      const byId = new Map(snap.points.map((p) => [p.id, p]));
      for (const nid of newIds) {
        const p = byId.get(nid);
        if (p) pulses.push({ lon: p.lon, lat: p.lat, born: performance.now() });
      }
    }
    prevIds[id] = new Set(snap.points.map((p) => p.id));
  }
```

- [ ] **Step 3: rAF ループで動的レイヤーを重畳**

`buildDeckLayers` の結果に動的レイヤーを足して描く形へ。`rebuild` の `setDeckLayers(...)` 行を次に置換:
```javascript
  drawAll(overlay);
```
新しい `drawAll` と rAF ループを追加（`rebuild` の下）:
```javascript
let _overlay = null;
function drawAll(overlay) {
  _overlay = overlay;
  const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const base = buildDeckLayers(ENABLED, snapshots);
  const extra = [];
  if (ENABLED.has('trade')) { const fp = flowParticlesLayer(); if (fp) extra.push(fp); }
  const pl = pulseLayer(now); if (pl) extra.push(pl);
  setDeckLayers(overlay, [...base, ...extra]);
}

function motionLoop() {
  motionT = (motionT + 0.0016) % 1; // 1周 ~10秒
  if (_overlay && !REDUCED) drawAll(_overlay);
  requestAnimationFrame(motionLoop);
}
```
`boot()` の `map.on('load', ...)` 内、`rebuild(overlay)` の後（startPolling の前）に rAF 起動を追加:
```javascript
    if (!REDUCED) requestAnimationFrame(motionLoop);
```

注意: `window.__orbis.counts` の更新ロジックは `drawAll` ではなく `rebuild` 内に残す（rAF では再計算しない）。`rebuild` は「データ更新時のフル再構築（counts/feed/pulse 含む）」、`drawAll` は「現在の snapshots/ENABLED から deck レイヤー配列を組んで描くだけ」に役割分担する。

- [ ] **Step 4: JSユニット全緑 + 目視**

Run: `node --test tests/*.test.js` → PASS（motion の純粋部は Task 4 で担保済み）。
`localhost:8000` で貿易航路上を粒子が流れること、ポーリング更新（または手動でスナップショットの新規 id 追加）でパルスリングが出ることを目視。OS の「視差効果を減らす」設定時は粒子/パルスが止まることも確認。

- [ ] **Step 5: コミット**

```bash
git add js/main.js
git commit -m "feat(motion): trade flow particles + new-event pulse rings (reduced-motion aware)"
```

---

## Task 10: e2e 更新（パネル構造・トグル・フィード・ズーム）

**Files:**
- Modify: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: e2e を Phase 3 に追随させる**

`tests/e2e/smoke.spec.js` を次に置換（凡例 `.legend-group` → パネル `.layer-row` へ。トグル・フィード・低ズームを追加）:
```javascript
import { test, expect } from '@playwright/test';

test('globe boots, layers render, panel toggles, feed flies', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('#starfield')).toBeVisible();

  // 左パネルに5レイヤー行
  await expect(page.locator('#panel .layer-row')).toHaveCount(5);

  // データ到着
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.quakes ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.flights ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.trade ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // トグル: quakes を OFF にすると ENABLED から消える
  await page.locator('.layer-row[data-id="quakes"] .layer-toggle').uncheck();
  await expect.poll(
    async () => page.evaluate(() => !!window.__orbis?.map && document.querySelector('.layer-row[data-id="quakes"] .layer-toggle').checked)
  ).toBe(false);

  // フィード: item が出てクリックで地図中心が変わる
  await expect(page.locator('#feed .feed-row').first()).toBeVisible({ timeout: 15000 });
  const before = await page.evaluate(() => window.__orbis.map.getCenter());
  await page.locator('#feed .feed-row').first().click();
  await page.waitForTimeout(1800); // flyTo 完了待ち
  const after = await page.evaluate(() => window.__orbis.map.getCenter());
  expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);

  // ズームアウトで低 zoom（球体ビュー）に到達できる
  await page.evaluate(() => window.__orbis.map.setZoom(0.3));
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__orbis.map.getZoom())).toBeLessThan(1);
});
```

- [ ] **Step 2: e2e を実行**

Run: `npx playwright test`
Expected: PASS（1 test）。失敗時はアサーションを弱めず、原因（セレクタ/タイミング/結線）を修正する。

- [ ] **Step 3: コミット**

```bash
git add tests/e2e/smoke.spec.js
git commit -m "test(e2e): cover panel toggle, event feed flyTo, zoom-out globe"
```

---

## Task 11: 最終確認・README・本番デプロイ

**Files:**
- Modify: `README.md`（レイヤー操作・フィードの記述追記）

- [ ] **Step 1: 全テスト緑を確認**

Run: `node --test tests/*.test.js && python3 -m pytest -q && npx playwright test`
Expected: 全 PASS。

- [ ] **Step 2: README にPhase 3 機能を1段落追記**

`README.md` の機能説明に「左パネルでレイヤー切替（永続化）・ホバーで詳細・右フィードで最新イベント＋クリックで移動・貿易フロー/新規イベントの動き」を追記。

- [ ] **Step 3: コミット**

```bash
git add README.md
git commit -m "docs: README covers phase-3 controls/feed/motion"
```

- [ ] **Step 4: main へマージして本番デプロイ**

（このステップはユーザー確認の上で実行する。Vercel は main push で自動デプロイ）
```bash
git checkout main
git merge --no-ff phase-3 -m "merge: ORBIS Phase 3 (controls, clarity, motion)"
git push origin main
```
注意: コミット作者メールは noreply（`210495115+sg55555@users.noreply.github.com`）必須（GH007 回避）。

- [ ] **Step 5: 本番 Playwright 検証**

`https://orbis-beta.vercel.app/` を Playwright で開き、球体ビュー・5レイヤー描画・パネルトグル・フィード flyTo・動的モーションを確認。Obsidian `Projects/orbis.md` の進捗を Phase 3 完了に更新。

---

## 完了基準（spec §5）

引くと丸い地球が宇宙に浮いて見え（A）、左パネルでレイヤーを絞れ永続化され（B）、マーカーにホバーで内容が分かり（C）、右フィードで最新イベントを追えてクリックで飛べる（D）。貿易ルートに流れ、新規イベントにパルス（D）。全テスト緑 → 本番デプロイで確認。

## 非目標（spec §6 / YAGNI）

船・航空機の snapshot 間移動補間、地震の本格波紋（Phase 5）。船舶レイヤー（Phase 2b）、拡張層（P4）、下部ニュース混在グリッド（別途）。完全なモバイル最適化（P5。本フェーズはパネル折りたたみまで）。
