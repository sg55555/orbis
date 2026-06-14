# ORBIS Phase 4.0 — マーカー視認性／flyTo・進路／ホバー改善 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 航空機を進行方向に向くズーム適応の塗り三角形に、地震を中空リングにして区別し、flyTo 着地表示と航空の進路予測を強化、ホバー感度を上げる。

**Architecture:** deck.gl 9.3.4 + globe では Icon/Text(テクスチャ系)が描画されないため、形状はジオメトリ層（SolidPolygon/Scatter/Line）のみで作る。地理座標サイズの拡縮は「現在ズームから度長を再計算」して一定ピクセルに見せる。純粋関数（度長計算・三角形頂点・推定到達点・popup HTML）を分離し node:test で検証、実描画は Playwright スクショで画素目視。

**Tech Stack:** Vanilla JS(ESM, no build) / deck.gl 9.3.4(CDN) / MapLibre GL 5.24(CDN) / node:test / Playwright

---

## File Structure

- `js/lib/geo.js` — 純粋ヘルパに `degLenForZoom`, `projectedArrival` を追加。旧 `headingEndpoint` は削除。
- `js/layers/flights.js` — `flightTrianglePolygon`, `buildTriangleConfig`, `buildDotConfig`(null heading 用) に作り替え。`toDeckLayer(snapshot, ctx)`。
- `js/layers/quakes.js` — `buildScatterConfig` → `buildRingConfig`(中空リング)。
- `js/layers/registry.js` — `buildDeckLayers(enabled, snapshots, layersOverride, ctx)`、`DECK_TO_LAYER` に `flights-dot`。
- `js/lib/selection.js` — `selectionPopupHtml` 拡張、`flightPopupHtml` 追加、`buildReticleConfigs` 強化。
- `js/map.js` — overlay に `pickingRadius:8`、`onClick` 配線（`initMap(container, getTooltip, onClick)`）。
- `js/main.js` — `drawAll` で ctx.zoom 注入、`map.on('zoom')` 再描画、flight クリック選択＋進路レイヤー、地震波紋。
- `sw.js` — CACHE 版を上げる。
- tests: `tests/geo2.test.js`(degLen/projected 追加・heading削除), `tests/flights.test.js`(刷新), `tests/quakes.test.js`(新規 or 既存修正), `tests/selection.test.js`(追加), `tests/e2e/smoke.spec.js`(検証追加)。

---

## Task 1: D — ホバー感度（pickingRadius）

**Files:**
- Modify: `js/map.js`
- Modify: `js/main.js`（initMap 呼び出しに onClick を渡す土台。onClick 本体は Task 10。ここでは未指定でも安全に）

- [ ] **Step 1: map.js の overlay に pickingRadius と onClick 引数を追加**

`js/map.js` の `initMap` を次に変更:

```js
export function initMap(container, getTooltip, onClick) {
  const map = new maplibregl.Map({
    container,
    style: buildBaseStyle(),
    center: [0, 20],
    zoom: 1.2,
    minZoom: 0,
    renderWorldCopies: false,
    attributionControl: true,
    localIdeographFontFamily: "'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif",
  });
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({
    interleaved: false, layers: [], getTooltip,
    pickingRadius: 8,                 // カーソル近傍8pxを判定（小ドット・細線でも拾う）
    onClick: onClick || undefined,
  });
  map.addControl(overlay);
  return { map, overlay };
}
```

- [ ] **Step 2: 手動確認（pickingRadius の効果）**

Run: `python3 -m http.server 8000` で起動し、ブラウザで貿易ルート線の近く（真上でなく数px外）にホバー → tooltip が出ること。e2e は Task 11 で。

- [ ] **Step 3: Commit**

```bash
git add js/map.js
git commit -m "feat(pick): overlay に pickingRadius:8 と onClick 引数を追加（ホバー感度改善）"
```

---

## Task 2: A — degLenForZoom（純粋関数）

**Files:**
- Modify: `js/lib/geo.js`
- Test: `tests/geo2.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/geo2.test.js` の import に `degLenForZoom` を追加し、末尾にテストを足す:

```js
import { iconAngle, eventRadius, degLenForZoom } from '../js/lib/geo.js';

test('degLenForZoom: 正の度長を返し、ズームが大きいほど小さい', () => {
  const a = degLenForZoom(2);
  const b = degLenForZoom(5);
  assert.ok(a > 0 && b > 0);
  assert.ok(b < a, 'ズームインで度長は小さくなる');
});

test('degLenForZoom: targetPx に比例', () => {
  assert.ok(Math.abs(degLenForZoom(4, 20) - degLenForZoom(4, 10) * 2) < 1e-9);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/geo2.test.js`
Expected: FAIL（degLenForZoom is not a function）

- [ ] **Step 3: 実装**

`js/lib/geo.js` の `headingEndpoint` 関数を**丸ごと削除**し、代わりに次を追加（`eventRadius` の前あたり）:

```js
// 画面上で約 targetPx ピクセルに見える地理度長を、現在ズームから求める。
// 赤道 metersPerPixel ≈ 156543.03 / 2^zoom、1度 ≈ 111320m。
export function degLenForZoom(zoom, targetPx = 10) {
  const mpp = 156543.03 / Math.pow(2, zoom);
  return (targetPx * mpp) / 111320;
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/geo2.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/lib/geo.js tests/geo2.test.js
git commit -m "feat(geo): degLenForZoom 追加・旧 headingEndpoint 削除"
```

---

## Task 3: A — flightTrianglePolygon（純粋関数）

**Files:**
- Modify: `js/layers/flights.js`
- Test: `tests/flights.test.js`（刷新）

- [ ] **Step 1: 失敗するテストを書く（flights.test.js を全置換）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flightTrianglePolygon, buildTriangleConfig, buildDotConfig } from '../js/layers/flights.js';

test('flightTrianglePolygon: 北(0)は tip が北、3頂点', () => {
  const tri = flightTrianglePolygon({ lon: 0, lat: 0, heading: 0 }, 1);
  assert.equal(tri.length, 3);
  const [tip] = tri;
  assert.ok(tip[1] > 0, '北向きは tip の緯度が増える');
});

test('flightTrianglePolygon: 東(90)は tip が東', () => {
  const [tip] = flightTrianglePolygon({ lon: 0, lat: 0, heading: 90 }, 1);
  assert.ok(tip[0] > 0, '東向きは tip の経度が増える');
});

test('flightTrianglePolygon: heading 無しは null', () => {
  assert.equal(flightTrianglePolygon({ lon: 0, lat: 0, heading: null }, 1), null);
  assert.equal(flightTrianglePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildTriangleConfig: heading を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildTriangleConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.data.length, 1, 'heading 無しは三角に含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, 3);
});

test('buildDotConfig: heading 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] });
  assert.equal(cfg.id, 'flights-dot');
  assert.equal(cfg.data.length, 1, 'heading 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildDotConfig/buildTriangleConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildTriangleConfig(null, 1).data, []);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/flights.test.js`
Expected: FAIL（flightTrianglePolygon is not a function）

- [ ] **Step 3: 実装（flights.js を全置換）**

```js
// 航空レイヤー。進行方向を向く塗り三角形(SolidPolygonLayer)＋heading無し機の小ドット。
// 注: IconLayer/TextLayer は deck.gl 9.3.4 + globe + MapboxOverlay で描画されない
// （[[deckgl-9.3-iconlayer-globe-broken]]）。ジオメトリ層のみ・ズーム適応で一定px化する。
import { degLenForZoom } from '../lib/geo.js';

const CYAN = [80, 220, 255];

// 機体を heading 方向に向けた二等辺三角形の頂点 [[lon,lat]×3]。heading 欠損で null。
export function flightTrianglePolygon(p, degLen) {
  if (!p || p.heading == null || p.lon == null || p.lat == null) return null;
  const h = Number(p.heading);
  if (!Number.isFinite(h)) return null;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
  const fwd = [Math.sin(rad) / cosLat, Math.cos(rad)];
  const perp = [Math.cos(rad) / cosLat, -Math.sin(rad)];
  const L = degLen, W = degLen * 0.55;
  const tip = [p.lon + fwd[0] * L, p.lat + fwd[1] * L];
  const back = [p.lon - fwd[0] * L * 0.5, p.lat - fwd[1] * L * 0.5];
  const left = [back[0] + perp[0] * W, back[1] + perp[1] * W];
  const right = [back[0] - perp[0] * W, back[1] - perp[1] * W];
  return [tip, left, right];
}

// heading を持つ機の三角形（SolidPolygonLayer config）。degLen はズーム適応。
export function buildTriangleConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading != null);
  return {
    id: 'flights', data,
    getPolygon: (p) => flightTrianglePolygon(p, degLen),
    getFillColor: [...CYAN, 235], stroked: false, pickable: true,
    updateTriggers: { getPolygon: degLen },
  };
}

// heading 無しの機の小ドット（ScatterplotLayer config）。
export function buildDotConfig(snapshot) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading == null);
  return {
    id: 'flights-dot', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 2.5, radiusMinPixels: 2, radiusMaxPixels: 3.5,
    getFillColor: [...CYAN, 220], stroked: false, pickable: true,
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  legend: [{ color: 'rgb(80,220,255)', label: '航空機（▲＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildTriangleConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
};
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/flights.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/layers/flights.js tests/flights.test.js
git commit -m "feat(flights): 進行方向の塗り三角形＋null heading ドットに刷新"
```

---

## Task 4: A — registry に ctx(zoom) 転送・flights-dot tooltip 解決

**Files:**
- Modify: `js/layers/registry.js`
- Test: `tests/registry.test.js`（無ければ新規作成）

- [ ] **Step 1: 失敗するテストを書く**

`tests/registry.test.js` に追記（無ければ新規。既存があれば import 行は流用）:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckLayers, tooltipFor } from '../js/layers/registry.js';

test('buildDeckLayers: ctx を toDeckLayer に渡す', () => {
  let seen = null;
  const fake = { id: 'x', toDeckLayer: (snap, ctx) => { seen = ctx; return []; } };
  buildDeckLayers(new Set(['x']), { x: { points: [] } }, [fake], { zoom: 7 });
  assert.deepEqual(seen, { zoom: 7 });
});

test('tooltipFor: flights-dot は flights のツールチップに解決', () => {
  assert.equal(tooltipFor('flights-dot', { callsign: 'AB', alt: null, on_ground: true, velocity: 0 }),
    '便名 AB｜高度 地上｜速度 0m/s');
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/registry.test.js`
Expected: FAIL（ctx undefined / flights-dot 未解決）

- [ ] **Step 3: 実装**

`js/layers/registry.js`:
- `buildDeckLayers` を ctx 受け取りに変更:

```js
export function buildDeckLayers(enabled, snapshots, layersOverride, ctx) {
  const ls = layersOverride || layers;
  return ls
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .flatMap((l) => {
      const r = l.toDeckLayer(snapshots[l.id], ctx);
      return Array.isArray(r) ? r : [r];
    });
}
```

- `DECK_TO_LAYER` に `flights-dot` を追加:

```js
const DECK_TO_LAYER = {
  quakes: 'quakes', flights: 'flights', 'flights-dot': 'flights',
  conflict: 'conflict', protests: 'protests',
  'trade-routes': 'trade', 'trade-chokepoints': 'trade',
};
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/registry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/layers/registry.js tests/registry.test.js
git commit -m "feat(registry): toDeckLayer に ctx(zoom) 転送・flights-dot tooltip 解決"
```

---

## Task 5: A — main.js で zoom 注入・zoom 再描画

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: drawAll で ctx.zoom を渡す**

`js/main.js` の `drawAll` 内、`const base = buildDeckLayers(ENABLED, snapshots);` を次に変更:

```js
  const zoom = (window.__orbis && window.__orbis.map) ? window.__orbis.map.getZoom() : 3;
  const base = buildDeckLayers(ENABLED, snapshots, undefined, { zoom });
```

- [ ] **Step 2: zoom 変化時に再描画（reduced-motion でも追従）**

`boot()` の `map.on('load', ...)` 登録の直前に追加:

```js
  map.on('zoom', () => drawAll(overlay));
```

- [ ] **Step 3: 手動確認**

Run: `python3 -m http.server 8000` → ズームイン/アウトで三角形のサイズがほぼ一定に見えること。

- [ ] **Step 4: 全ユニットテスト緑を確認**

Run: `node --test tests/*.test.js`
Expected: PASS（全件）

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(flights): drawAll に zoom 注入・zoom 変化で再描画（三角を一定px化）"
```

---

## Task 6: B — 地震を中空リングに

**Files:**
- Modify: `js/layers/quakes.js`
- Test: `tests/quakes.test.js`（無ければ新規）

- [ ] **Step 1: 失敗するテストを書く**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRingConfig } from '../js/layers/quakes.js';

test('buildRingConfig: 中空リング（stroked, filled:false）', () => {
  const cfg = buildRingConfig({ points: [{ lon: 1, lat: 2, mag: 5 }] });
  assert.equal(cfg.id, 'quakes');
  assert.equal(cfg.stroked, true);
  assert.equal(cfg.filled, false);
  assert.equal(cfg.pickable, true);
  assert.deepEqual(cfg.getPosition({ lon: 1, lat: 2 }), [1, 2]);
});

test('buildRingConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildRingConfig(null).data, []);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/quakes.test.js`
Expected: FAIL（buildRingConfig is not a function）

- [ ] **Step 3: 実装**

`js/layers/quakes.js`:
- `buildScatterConfig` を次の `buildRingConfig` に置換（名称変更）:

```js
export function buildRingConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'quakes', data, radiusUnits: 'pixels', pickable: true,
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1.6,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => magnitudeToRadius(p.mag),
    getLineColor: (p) => [...magnitudeToColor(p.mag), 230],
  };
}
```

- `toDeckLayer` を次に変更:

```js
  toDeckLayer(snapshot) {
    return new deck.ScatterplotLayer(buildRingConfig(snapshot));
  },
```

（`magnitudeToRadius`, `magnitudeToColor` の import は現状のまま）

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/quakes.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/layers/quakes.js tests/quakes.test.js
git commit -m "feat(quakes): 地震を中空リング化（航空▲と形を分離）"
```

---

## Task 7: B — 地震の波紋（動的・控えめ）

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: 波紋レイヤー関数を追加**

`js/main.js` の `pulseLayer` 関数の直後に追加（`mag>=4.5` の地震に、motionT 位相で拡大する淡い同心リングを1本）:

```js
// 規模の大きい地震に、ゆっくり拡大する淡い波紋リング（reduced-motion 時は描かない）。
function quakeRippleLayer() {
  const snap = snapshots.quakes;
  if (REDUCED || !snap || !snap.points) return null;
  const data = snap.points.filter((p) => Number(p.mag) >= 4.5);
  if (data.length === 0) return null;
  const phase = motionT; // 0..1
  return new deck.ScatterplotLayer({
    id: 'quake-ripple', data, radiusUnits: 'pixels',
    stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => magnitudeToRadius(p.mag) + 4 + 22 * phase,
    getLineColor: (p) => [...magnitudeToColor(p.mag), Math.round(170 * (1 - phase))],
    updateTriggers: { getRadius: phase, getLineColor: phase },
    pickable: false,
  });
}
```

- [ ] **Step 2: import を追加**

`js/main.js` 冒頭の import 群に追加:

```js
import { magnitudeToRadius, magnitudeToColor } from './lib/geo.js';
```

（既に `formatFreshness` を `./lib/geo.js` から import している行があるので、その行に統合してもよい）

- [ ] **Step 3: drawAll に波紋を差し込む**

`drawAll` 内、`const pl = pulseLayer(now); if (pl) extra.push(pl);` の直後に追加:

```js
  if (ENABLED.has('quakes')) { const rp = quakeRippleLayer(); if (rp) extra.push(rp); }
```

- [ ] **Step 4: 手動確認**

Run: `python3 -m http.server 8000` → M4.5+ の地震位置で淡いリングが拡大・消滅を繰り返すこと。reduced-motion で出ないこと。

- [ ] **Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat(quakes): 大規模地震の淡い波紋アニメ（reduced-motion 尊重）"
```

---

## Task 8: C2 — projectedArrival（純粋関数）

**Files:**
- Modify: `js/lib/geo.js`
- Test: `tests/geo2.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/geo2.test.js` の import に `projectedArrival` を足し、テスト追加:

```js
import { iconAngle, eventRadius, degLenForZoom, projectedArrival } from '../js/lib/geo.js';

test('projectedArrival: 東向きは経度が増える / 北向きは緯度が増える', () => {
  const e = projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 200 }, 10);
  assert.ok(e[0] > 0 && Math.abs(e[1]) < 1e-6);
  const n = projectedArrival({ lon: 0, lat: 0, heading: 0, velocity: 200 }, 10);
  assert.ok(n[1] > 0);
});

test('projectedArrival: velocity/heading 欠損や速度0は null', () => {
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 0 }, 10), null);
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: null, velocity: 200 }, 10), null);
  assert.equal(projectedArrival({ lon: 0, lat: 0, velocity: 200 }, 10), null);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/geo2.test.js`
Expected: FAIL（projectedArrival is not a function）

- [ ] **Step 3: 実装**

`js/lib/geo.js` の `degLenForZoom` の直後に追加:

```js
// 現在の heading(度) と velocity(m/s) から minutes 分後の推定到達点 [lon,lat]。
// OpenSky は目的地を持たないため「推定」であることに注意。欠損/速度0で null。
export function projectedArrival(p, minutes = 10) {
  if (!p || p.heading == null || p.velocity == null || p.lon == null || p.lat == null) return null;
  const h = Number(p.heading), v = Number(p.velocity);
  if (!Number.isFinite(h) || !Number.isFinite(v) || v <= 0) return null;
  const degLat = (v * minutes * 60) / 111320;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((p.lat * Math.PI) / 180), 0.2);
  return [p.lon + (degLat * Math.sin(rad)) / cosLat, p.lat + degLat * Math.cos(rad)];
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/geo2.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/lib/geo.js tests/geo2.test.js
git commit -m "feat(geo): projectedArrival 追加（heading×速度の推定到達点）"
```

---

## Task 9: C1+C3 — popup 拡張・flight popup・リティクル強化

**Files:**
- Modify: `js/lib/selection.js`
- Modify: `css/orbis.css`
- Test: `tests/selection.test.js`

- [ ] **Step 1: 失敗するテストを書く（selection.test.js に追記）**

```js
import { selectionPopupHtml, buildReticleConfigs, escapeHtml, flightPopupHtml } from '../js/lib/selection.js';

test('selectionPopupHtml: 座標行を含む（lon/lat があるとき）', () => {
  const html = selectionPopupHtml({ title: 'M5 Tokyo', layerId: 'quakes', lon: 139.7, lat: 35.6, time: Date.UTC(2026,5,14,2,0,0) });
  assert.match(html, /35\.6/);   // 緯度
  assert.match(html, /139\.7/);  // 経度
});

test('flightPopupHtml: 便名/高度/速度/推定到達を含み、エスケープ', () => {
  const html = flightPopupHtml({ callsign: 'AB<1>', alt: 1800, velocity: 200, heading: 90, on_ground: false }, [10.5, 20.25]);
  assert.match(html, /AB&lt;1&gt;/);
  assert.match(html, /1800m/);
  assert.match(html, /200m\/s/);
  assert.match(html, /推定到達/);
  assert.match(html, /20\.25/);
});

test('flightPopupHtml: arrival が null でも安全（—）', () => {
  const html = flightPopupHtml({ callsign: 'X', alt: null, velocity: 0, heading: 0, on_ground: true }, null);
  assert.match(html, /地上/);
  assert.match(html, /—/);
});
```

- [ ] **Step 2: テスト失敗を確認**

Run: `node --test tests/selection.test.js`
Expected: FAIL（flightPopupHtml is not a function / 座標行なし）

- [ ] **Step 3: 実装（selection.js）**

`js/lib/selection.js` の `selectionPopupHtml` を次に差し替え（座標・時刻行を追加）:

```js
// item: { title, layerId, lon, lat, time } → 着地点ポップアップの HTML。
export function selectionPopupHtml(item) {
  const it = item || {};
  const rgb = LAYER_RGB[it.layerId] || CYAN;
  const dot = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  const coord = (it.lon != null && it.lat != null)
    ? `<div class="sel-meta">座標 ${Number(it.lat).toFixed(2)}, ${Number(it.lon).toFixed(2)}</div>` : '';
  const when = it.time ? `<div class="sel-meta">${new Date(it.time).toLocaleString('ja-JP')}</div>` : '';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">${escapeHtml(it.title)}</span></div>`
    + coord + when
    + '<div class="sel-hint">📍 この地点へ移動しました</div>'
    + '</div>';
}

// 航空機クリック時のポップアップ（便名/高度/速度/方位/推定到達）。
export function flightPopupHtml(p, arrival) {
  const o = p || {};
  const cs = String(o.callsign || '').trim() || '(便名なし)';
  const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
  const spd = Math.round(o.velocity || 0);
  const hd = Math.round(o.heading || 0);
  const dot = 'rgb(80,220,255)';
  const arr = arrival ? `${Number(arrival[1]).toFixed(2)}, ${Number(arrival[0]).toFixed(2)}` : '—';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">✈ ${escapeHtml(cs)}</span></div>`
    + `<div class="sel-meta">高度 ${alt}｜速度 ${spd}m/s｜方位 ${hd}°</div>`
    + `<div class="sel-hint">📍 推定到達(10分後) ${arr}</div>`
    + '</div>';
}
```

`buildReticleConfigs` のリング径を一回り拡大（強化）: `getRadius: 26`→`30`(glow), `18`→`22`(ring), `4`→`5`(dot)。該当 3 箇所の数値を変更。

- [ ] **Step 4: css に sel-meta を追加**

`css/orbis.css` の `.sel-popup .sel-hint { ... }` の直前に追加:

```css
.sel-popup .sel-meta { font-size: 11px; color: var(--text); opacity: .9; margin-top: 3px; }
```

- [ ] **Step 5: テスト成功を確認**

Run: `node --test tests/selection.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add js/lib/selection.js css/orbis.css tests/selection.test.js
git commit -m "feat(selection): popup に座標/時刻、航空 popup、リティクル拡大"
```

---

## Task 10: C2 — 航空クリックで進路予測・到達点

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: import と状態を追加**

`js/main.js` の import に追加:

```js
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml } from './lib/selection.js';
import { projectedArrival } from './lib/geo.js';
```

（既存の selection import 行を上記に置換。`projectedArrival` は geo の import 行へ統合可）

`let selPopup = null;` の直後に追加:

```js
let selectedFlight = null; // { point, arrival[lon,lat] } 航空クリックで選択
```

- [ ] **Step 2: 進路レイヤー関数を追加**

`selectedMarkerLayers` 関数の直後に追加:

```js
// 選択中の航空機の推定進路（現在地→到達点の線）＋到達点リング。
function flightProjectionLayers() {
  if (!selectedFlight || !selectedFlight.arrival) return [];
  const { point, arrival } = selectedFlight;
  const src = [point.lon, point.lat];
  return [
    new deck.LineLayer({
      id: 'flight-route', data: [{}], widthUnits: 'pixels', getWidth: 1.6,
      getSourcePosition: () => src, getTargetPosition: () => arrival,
      getColor: [80, 220, 255, 180], pickable: false,
    }),
    new deck.ScatterplotLayer({
      id: 'flight-arrival', data: [{}], radiusUnits: 'pixels',
      stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2,
      getPosition: () => arrival, getRadius: 8, getLineColor: [80, 220, 255, 230], pickable: false,
    }),
  ];
}
```

- [ ] **Step 3: drawAll に進路を差し込む**

`drawAll` 内、`extra.push(...selectedMarkerLayers(now));` の直後に追加:

```js
  extra.push(...flightProjectionLayers());
```

- [ ] **Step 4: クリックハンドラを追加して initMap に渡す**

`boot()` の `const { map, overlay } = initMap('map', (info) => ...);` を次に変更:

```js
  const { map, overlay } = initMap(
    'map',
    (info) => (info.object && info.layer) ? tooltipFor(info.layer.id, info.object) : null,
    (info) => {
      if (!info || !info.object || !info.layer) return;
      if (info.layer.id === 'flights' || info.layer.id === 'flights-dot') {
        const p = info.object;
        const arrival = projectedArrival(p, 10);
        selectedFlight = { point: p, arrival };
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(flightPopupHtml(p, arrival)).addTo(map);
        drawAll(overlay);
      }
    }
  );
```

- [ ] **Step 5: 全ユニット緑＋手動確認**

Run: `node --test tests/*.test.js` → PASS。
`python3 -m http.server 8000` → 航空三角をクリックで進路ライン＋到達点リング＋ポップアップ（便名/高度/速度/推定到達）。

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(flights): クリックで推定進路ライン＋到達点＋詳細ポップアップ"
```

---

## Task 11: SW 版・e2e 検証追加

**Files:**
- Modify: `sw.js`
- Modify: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: SW CACHE 版を上げる**

`sw.js` の `const CACHE = 'orbis-v6';` → `const CACHE = 'orbis-v7';`

- [ ] **Step 2: e2e に検証を追加**

`tests/e2e/smoke.spec.js` の既存アサーションの後（globe 投影チェックの後ろ）に追加:

```js
  // 航空が三角(SolidPolygon)＋地震がリングで deck に存在
  const ids = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    const layers = (o._props && o._props.layers) || [];
    return layers.map((l) => ({ id: l.id, type: l.constructor.name }));
  });
  expect(ids.some((l) => l.id === 'flights')).toBe(true);
  expect(ids.some((l) => l.id === 'quakes')).toBe(true);

  // 航空機クリックで進路・到達点が出る（密集域へ寄せてからクリック）
  await page.evaluate(() => window.__orbis.map.jumpTo({ center: [8, 48], zoom: 5 }));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    // 最初の flights データ点の座標へポインタを送るための補助：onClick を直接叩く
    const o = window.__orbis.overlay;
    const fl = ((o._props && o._props.layers) || []).find((l) => l.id === 'flights');
    const p = fl && fl.props.data && fl.props.data[0];
    if (p) window.__orbis.map.fire; // no-op（座標確認用）
  });
```

> 注: deck の canvas ピックはクリック座標依存で不安定なため、進路レイヤーの存在検証は手動スクショで担保する（Step 4）。e2e は「flights/quakes レイヤー存在＋既存フロー緑」を必須とする。

- [ ] **Step 3: e2e 実行**

Run: `npx playwright test`
Expected: 1 passed

- [ ] **Step 4: Playwright スクショで画素目視（必須）**

`/tmp/p4_*.mjs` を作成して以下を撮る（reducedMotion:'reduce'、`http://localhost:8000`）:
- ズーム5・欧州: 航空▲が方向を向いて描画／地震が中空リング。
- globe(zoom1.6): 航空▲が一定サイズで見える。
- 航空をクリック相当（overlay の onClick を `page.mouse.move`+`click` で三角中心へ）→ 進路ライン＋到達点＋ポップアップ。
- 貿易ルート線の近傍ホバーで tooltip（pickingRadius 効果）。

各 PNG を Read して**画素を目視確認**（件数で代替しない）。

- [ ] **Step 5: Commit**

```bash
git add sw.js tests/e2e/smoke.spec.js
git commit -m "test(e2e): 航空三角/地震リング存在＋SW v7、スクショ目視で実描画確認"
```

---

## Task 12: 統合検証・マージ・本番確認・記憶整理

- [ ] **Step 1: 全テスト緑**

Run: `node --test tests/*.test.js && (uv run pytest -q || python3 -m pytest -q)`
Expected: 全 PASS

- [ ] **Step 2: main へマージ＆push（安全根拠を併記）**

```bash
git checkout main
git pull --no-rebase origin main   # collect cron 競合回避
git merge phase-4.0-marker-interaction --no-edit
git push origin main               # 通常push(非force・履歴非破壊)・全テスト緑・追加のみ
```

- [ ] **Step 3: 本番 Playwright 検証**

デプロイ反映後、`https://orbis-beta.vercel.app/` で航空▲・地震リング・航空クリック進路・ホバー tooltip をスクショ目視＋コンソールエラー0。

- [ ] **Step 4: 横断記憶整理（恒久ルール）**

Obsidian `Projects/orbis.md` と自動メモリ（MEMORY.md＋project_orbis.md）に Phase 4.0 完了を反映。何をどこに書いたか明示報告。

---

## Self-Review

**Spec coverage:**
- A（航空三角・ズーム適応）→ Task 2,3,4,5 ✓
- B（地震リング＋波紋）→ Task 6,7 ✓
- C1（着地マーカー/ポップアップ確実化）→ Task 9（リティクル拡大・popup）＋既存フロー ✓
- C2（航空進路予測）→ Task 8（projectedArrival）+ Task 10（クリック→進路/到達/popup）✓
- C3（popup 詳細充実）→ Task 9（座標/時刻/flight popup）✓
- D（ホバー感度）→ Task 1（pickingRadius）✓
- 検証はスクショ画素目視 → Task 11 Step4 / Task 12 Step3 ✓

**Placeholder scan:** 各コード手順に実コードあり。e2e の canvas ピック不安定箇所は手動スクショで担保すると明記（プレースホルダではなく方針）。

**Type consistency:** `degLenForZoom`/`projectedArrival`/`flightTrianglePolygon`/`buildTriangleConfig`/`buildDotConfig`/`buildRingConfig`/`flightPopupHtml`/`selectionPopupHtml` を一貫使用。layer id は三角=`flights`・ドット=`flights-dot`・地震=`quakes`、`DECK_TO_LAYER` で tooltip 解決。`toDeckLayer(snapshot, ctx)` を flights が使用、他層は ctx 無視で互換。

**未参照リスク:** `magnitudeToRadius`/`magnitudeToColor` は既存 export。`buildReticleConfigs`/`escapeHtml` は既存。OK。
