# 船舶ツールチップ見出し＋クリック推定進路 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 船舶のツールチップ全項目に見出しを付け、船舶クリックで航空機と同等の推定進路（マゼンタの線/到達リング/流れる粒子/パルス＋詳細ポップアップ・1時間先）を表示する。

**Architecture:** 投影計算を共通純粋コア `projectAhead` に抽出し航空(`projectedArrival`)/船(`shipArrival`)で共用。進路レイヤーの config 生成を `js/lib/selection.js` の純粋ビルダ `buildProjectionConfigs` に集約し、航空・船の両方がこれを使う（DRY）。`main.js` はクリック配線と deck 化のみ。

**Tech Stack:** Vanilla JS (ESM, no build) / deck.gl 9.3.4 (CDN, `deck.LineLayer`/`deck.ScatterplotLayer`) / MapLibre globe / node:test。

**前提:** 本番に船舶データあり（既稼働）。色＝マゼンタ `[255,90,220]`、延長＝60分で確定済み。

---

## File Structure

- **Modify** `js/lib/geo.js` — `projectAhead` 抽出＋`projectedArrival` 委譲＋新 `shipArrival`。
- **Modify** `js/layers/ships.js` — `shipTooltip` に船種/速度の見出し追加。
- **Modify** `js/lib/selection.js` — 純粋 `buildProjectionConfigs`＋`shipPopupHtml`＋色定数 export。`pointAlongPath` を import。
- **Modify** `js/main.js` — `shipArrival`/`shipPopupHtml`/`buildProjectionConfigs` 配線、`selectedShip`、`shipProjectionLayers()`、`flightProjectionLayers()` をビルダ経由へ統一、onClick に ships 分岐、ローカル `PROJ_RGB`/`PROJ_FLOW_RGB` 撤去（selection.js から import）、未使用化する `pointAlongPath` import 削除。
- **Modify** `sw.js` — CACHE v15 → v16。
- **Test** `tests/geo.test.js` / `tests/selection.test.js` / `tests/ships.test.js`。

---

## Task 1: 投影コア `projectAhead` ＋ `shipArrival`（geo.js）

**Files:**
- Modify: `js/lib/geo.js`（`projectedArrival` 周辺・37-47行）
- Test: `tests/geo.test.js`

- [ ] **Step 1: Write failing tests (append to `tests/geo.test.js`)**

`tests/geo.test.js` 冒頭の geo.js からの import に `projectAhead, shipArrival` を加える（`projectedArrival` が未 import なら併せて追加。**既存 import 文に追記し、重複 import を作らない**）。その上で末尾に追加：

```javascript
test('projectAhead: 北(0)へ前進すると緯度↑・経度≒不変', () => {
  const out = projectAhead(0, 0, 0, 100, 10);
  assert.ok(out[1] > 0 && Math.abs(out[0]) < 1e-9);
});

test('projectAhead: 東(90)へは経度↑', () => {
  const out = projectAhead(0, 0, 90, 100, 10);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9);
});

test('projectAhead: 速度0/負・heading欠損・座標欠損は null', () => {
  assert.equal(projectAhead(0, 0, 0, 0, 10), null);
  assert.equal(projectAhead(0, 0, 0, -5, 10), null);
  assert.equal(projectAhead(0, 0, null, 100, 10), null);
  assert.equal(projectAhead(null, 0, 0, 100, 10), null);
});

test('shipArrival: cog/sog(kn)から前進・kn→m/s換算', () => {
  const out = shipArrival({ lon: 0, lat: 0, cog: 90, sog: 10 }, 60);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9, '東へ進む');
});

test('shipArrival: cog/sog 欠損・sog0・p無しは null', () => {
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: 90, sog: 0 }, 60), null);
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: null, sog: 10 }, 60), null);
  assert.equal(shipArrival({ lon: 0, lat: 0, cog: 90, sog: null }, 60), null);
  assert.equal(shipArrival(null, 60), null);
});

test('projectedArrival 回帰: heading/velocity で従来通り（東進・緯度不変）', () => {
  const out = projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 100 }, 10);
  assert.ok(out[0] > 0 && Math.abs(out[1]) < 1e-9);
  assert.equal(projectedArrival({ lon: 0, lat: 0, heading: 90, velocity: 0 }, 10), null);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/geo.test.js`
Expected: FAIL（`projectAhead`/`shipArrival` is not a function）

- [ ] **Step 3: Refactor `js/lib/geo.js`** — `projectedArrival`（現37-47行）を次の3関数に置換：

```javascript
// (lon,lat) から headingDeg(北0°時計回り)方向へ speedMps(m/s) で minutes 分進んだ推定点 [lon,lat]。
// 欠損/非有限/速度<=0 は null。経度は cosLat 補正（高緯度の度詰まりを補正）。
export function projectAhead(lon, lat, headingDeg, speedMps, minutes) {
  if (lon == null || lat == null || headingDeg == null || speedMps == null) return null;
  const h = Number(headingDeg), v = Number(speedMps);
  if (!Number.isFinite(h) || !Number.isFinite(v) || v <= 0) return null;
  const degLat = (v * minutes * 60) / 111320;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  return [lon + (degLat * Math.sin(rad)) / cosLat, lat + degLat * Math.cos(rad)];
}

// 航空: 現在の heading(度)＋velocity(m/s) から minutes 分後の推定到達点。
// OpenSky は目的地を持たないため「推定」。欠損/速度0で null。
export function projectedArrival(p, minutes = 10) {
  if (!p) return null;
  return projectAhead(p.lon, p.lat, p.heading, p.velocity, minutes);
}

// 船舶: AIS の cog(針路・度)＋sog(ノット) から minutes 分後の推定到達点（kn→m/s = ×0.514444）。
// cog/sog 欠損・sog0 で null。
export function shipArrival(p, minutes = 60) {
  if (!p) return null;
  const sog = p.sog == null ? null : Number(p.sog) * 0.514444;
  return projectAhead(p.lon, p.lat, p.cog, sog, minutes);
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `node --test tests/geo.test.js`
Expected: PASS（既存 geo テスト＋新規6）

- [ ] **Step 5: Run dependent suites (回帰確認)**

Run: `node --test tests/geo2.test.js tests/flights.test.js`
Expected: PASS（`projectedArrival` を使う既存テストが緑のまま）

- [ ] **Step 6: Commit**

```bash
git add js/lib/geo.js tests/geo.test.js
git commit -m "feat(geo): extract projectAhead core + shipArrival (cog/sog)"
```

---

## Task 2: 船舶ツールチップに見出し追加（ships.js）

**Files:**
- Modify: `js/layers/ships.js`（`shipTooltip`）
- Test: `tests/ships.test.js`

- [ ] **Step 1: Update the existing tooltip tests in `tests/ships.test.js`** — 該当3テストの期待値を見出し付きに差し替え：

```javascript
test('shipTooltip: 船名・船種・速度・航路（全部あり・全項目見出し付き）', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: 'EVER GIVEN', type: '貨物船', sog: 12.3, cog: 45 }),
    '船名 EVER GIVEN｜船種 貨物船｜速度 12kn｜航路 045°',
  );
});
test('shipTooltip: 船名/船種無しは MMSI ＋欠損項目を省略', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: null, type: null, sog: 12.3, cog: 45 }),
    'MMSI 123456789｜速度 12kn｜航路 045°',
  );
  assert.equal(shipTooltip({ mmsi: 1, name: null, type: null, sog: null, cog: null }), 'MMSI 1');
  assert.equal(shipTooltip(null), null);
});
test('shipTooltip: cog 359.6 は 360 ではなく 000 に丸める', () => {
  assert.equal(
    shipTooltip({ mmsi: 1, name: null, type: null, sog: 5, cog: 359.6 }),
    'MMSI 1｜速度 5kn｜航路 000°',
  );
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/ships.test.js`
Expected: FAIL（現 `shipTooltip` は船種/速度に見出しが無く `貨物船`/`12kn` を出すため不一致）

- [ ] **Step 3: Update `shipTooltip` in `js/layers/ships.js`** — 現 `shipTooltip` を次へ置換：

```javascript
// ツールチップ: 船名 or MMSI ＋ 船種 ＋ 速度kn ＋ 航路°（全項目見出し付き・欠損項目は省略）。
export function shipTooltip(o) {
  if (!o) return null;
  const head = o.name ? `船名 ${o.name}` : `MMSI ${o.mmsi}`;
  const type = o.type ? `船種 ${o.type}` : null;
  const sog = o.sog == null ? null : `速度 ${Math.round(o.sog)}kn`;
  const cog = o.cog == null ? null : `航路 ${String(Math.round(o.cog) % 360).padStart(3, '0')}°`;
  return [head, type, sog, cog].filter(Boolean).join('｜');
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `node --test tests/ships.test.js`
Expected: PASS（9テスト）

- [ ] **Step 5: Commit**

```bash
git add js/layers/ships.js tests/ships.test.js
git commit -m "feat(ships): label every tooltip field (船種/速度)"
```

---

## Task 3: 共通進路ビルダ＋船ポップアップ（selection.js）

**Files:**
- Modify: `js/lib/selection.js`
- Test: `tests/selection.test.js`

- [ ] **Step 1: Write failing tests (append to `tests/selection.test.js`)** — 先頭の selection.js import に `buildProjectionConfigs, shipPopupHtml` を追加（既存 import 文へ追記）。末尾に：

```javascript
test('buildProjectionConfigs: arrival 無し / sel 無しは空配列', () => {
  assert.deepEqual(buildProjectionConfigs({ src: [0, 0], arrival: null, prefix: 'ship' }, 0), []);
  assert.deepEqual(buildProjectionConfigs(null, 0), []);
});

test('buildProjectionConfigs: prefix 反映・line+arrival+flow+pulse の4種', () => {
  const cfgs = buildProjectionConfigs({ src: [0, 0], arrival: [1, 1], prefix: 'ship' }, 0.3, { reduced: false });
  assert.deepEqual(cfgs.map((c) => c.config.id), ['ship-route', 'ship-arrival', 'ship-flow', 'ship-arrival-pulse']);
  assert.equal(cfgs[0].kind, 'line');
  assert.equal(cfgs[1].kind, 'scatter');
});

test('buildProjectionConfigs: reduced は flow/pulse を省く', () => {
  const cfgs = buildProjectionConfigs({ src: [0, 0], arrival: [1, 1], prefix: 'flight' }, 0, { reduced: true });
  assert.deepEqual(cfgs.map((c) => c.config.id), ['flight-route', 'flight-arrival']);
});

test('shipPopupHtml: 船名・船種・速度・航路・推定到達', () => {
  const html = shipPopupHtml({ mmsi: 7, name: 'EVER GIVEN', type: '貨物船', sog: 12.3, cog: 45 }, [2.5, 1.5], 60);
  assert.match(html, /🚢 EVER GIVEN/);
  assert.match(html, /船種 貨物船｜速度 12kn｜航路 045°/);
  assert.match(html, /約60分後 1\.50, 2\.50/);
});

test('shipPopupHtml: 船名無しは MMSI、進路無しは推定不可', () => {
  const html = shipPopupHtml({ mmsi: 7, name: null, type: null, sog: null, cog: null }, null, 60);
  assert.match(html, /🚢 MMSI 7/);
  assert.match(html, /船種 不明｜速度 —｜航路 —/);
  assert.match(html, /進路推定不可/);
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `node --test tests/selection.test.js`
Expected: FAIL（`buildProjectionConfigs`/`shipPopupHtml` is not a function）

- [ ] **Step 3: Edit `js/lib/selection.js`**

(a) ファイル冒頭の import 群に追加（`escapeHtml` 等の定義より前）：

```javascript
import { pointAlongPath } from './motion.js';
```

(b) 既存の `const CYAN = [57, 208, 255];` の直後に色定数を追加（export して main.js と共有）：

```javascript
// 推定進路の色＝機体シアンの補色マゼンタ（航空・船で共通）。
export const PROJ_RGB = [255, 90, 220];
export const PROJ_FLOW_RGB = [255, 150, 235];
```

(c) ファイル末尾に純粋ビルダ＋船ポップアップを追加：

```javascript
// 推定進路の deck config 群を返す（純粋・deck 非依存。航空/船で共用）。
// sel: { src:[lon,lat], arrival:[lon,lat]|null, prefix }。motionT: 0..1。opts.reduced で flow/pulse 省略。
// 返り値: [{ kind:'line'|'scatter', config }]（呼び出し側で new deck.LineLayer/ScatterplotLayer する）。
export function buildProjectionConfigs(sel, motionT = 0, opts = {}) {
  if (!sel || !sel.src || !sel.arrival) return [];
  const { src, arrival, prefix } = sel;
  const out = [
    { kind: 'line', config: {
      id: `${prefix}-route`, data: [{}], widthUnits: 'pixels', getWidth: 2,
      getSourcePosition: () => src, getTargetPosition: () => arrival,
      getColor: [...PROJ_RGB, 200], pickable: false,
    } },
    { kind: 'scatter', config: {
      id: `${prefix}-arrival`, data: [{}], radiusUnits: 'pixels',
      stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2.5,
      getPosition: () => arrival, getRadius: 9, getLineColor: [...PROJ_RGB, 240], pickable: false,
    } },
  ];
  if (!opts.reduced) {
    const PER = 6;
    const pts = [];
    for (let k = 0; k < PER; k++) {
      const t = (motionT + k / PER) % 1;
      const pp = pointAlongPath([src, arrival], t);
      if (pp) pts.push({ position: pp, t });
    }
    out.push({ kind: 'scatter', config: {
      id: `${prefix}-flow`, data: pts, radiusUnits: 'pixels',
      getPosition: (d) => d.position, getRadius: 3,
      getFillColor: (d) => [...PROJ_FLOW_RGB, Math.round(110 + 140 * Math.sin(Math.PI * d.t))],
      updateTriggers: { getPosition: motionT, getFillColor: motionT }, pickable: false,
    } });
    const ph = motionT;
    out.push({ kind: 'scatter', config: {
      id: `${prefix}-arrival-pulse`, data: [{}], radiusUnits: 'pixels',
      stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 1.5,
      getPosition: () => arrival, getRadius: 9 + 16 * ph,
      getLineColor: [...PROJ_RGB, Math.round(220 * (1 - ph))],
      updateTriggers: { getRadius: ph, getLineColor: ph }, pickable: false,
    } });
  }
  return out;
}

// 船舶クリック時のポップアップ（船名/船種/速度/航路/推定進路）。flightPopupHtml と対。
// arrival が null（停泊/速度0/針路不明）は推定不可を明示。
export function shipPopupHtml(p, arrival, minutes = 60) {
  const o = p || {};
  const head = o.name ? escapeHtml(o.name) : `MMSI ${o.mmsi}`;
  const spd = o.sog == null ? '—' : `${Math.round(o.sog)}kn`;
  const cog = o.cog == null ? '—' : `${String(Math.round(o.cog) % 360).padStart(3, '0')}°`;
  const dot = 'rgb(255,90,220)';
  const arr = arrival ? `${Number(arrival[1]).toFixed(2)}, ${Number(arrival[0]).toFixed(2)}` : '—';
  const hint = arrival
    ? `📍 推定進路 約${minutes}分後 ${arr}<br><span class="sel-note">※AIS の COG/SOG 延長による推定（針路・速度一定と仮定）</span>`
    : '<span class="sel-note">速度0/針路不明で進路推定不可</span>';
  return '<div class="sel-popup">'
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
    + `<span class="sel-title">🚢 ${head}</span></div>`
    + `<div class="sel-meta">船種 ${escapeHtml(o.type || '不明')}｜速度 ${spd}｜航路 ${cog}</div>`
    + `<div class="sel-hint">${hint}</div>`
    + '</div>';
}
```

- [ ] **Step 4: Run to verify PASS**

Run: `node --test tests/selection.test.js`
Expected: PASS（既存 selection テスト＋新規5）

- [ ] **Step 5: Commit**

```bash
git add js/lib/selection.js tests/selection.test.js
git commit -m "feat(selection): shared projection config builder + ship popup"
```

---

## Task 4: クリック配線・進路統一・sw（main.js / sw.js）

**Files:**
- Modify: `js/main.js`
- Modify: `sw.js`

このタスクは動作中の航空進路に触れるため慎重に。**deck レイヤー id（flight-route 等）と見た目はバイト等価**を保つ（ビルダが同じ config を生成するため自動的に等価）。

- [ ] **Step 1: Update imports in `js/main.js`**

(a) geo.js の import 行（現4行目）に `shipArrival` を追加：

```javascript
import { formatFreshness, magnitudeToRadius, magnitudeToColor, projectedArrival, shipArrival } from './lib/geo.js';
```

(b) selection.js の import 行（現12行目）を次へ置換（`shipPopupHtml`/`buildProjectionConfigs`/色定数を追加）：

```javascript
import { selectionPopupHtml, buildReticleConfigs, flightPopupHtml, shipPopupHtml, buildProjectionConfigs } from './lib/selection.js';
```

(c) motion.js の import 行（現11行目）から **`pointAlongPath` を削除**（このタスク後は main.js で未使用になるため）：

```javascript
import { diffNewIds, normalizedTimestamps } from './lib/motion.js';
```

- [ ] **Step 2: Remove local color consts and add ship state in `js/main.js`**

現37-38行の次の2行を**削除**（selection.js から共有するため）：

```javascript
const PROJ_RGB = [255, 90, 220];
const PROJ_FLOW_RGB = [255, 150, 235]; // 流れる粒子は少し明るいマゼンタ
```

`let selectedFlight = null;`（現34行）の直後に追加：

```javascript
let selectedShip = null;   // { point, arrival[lon,lat] } 船舶クリックで選択
```

`const FLIGHT_PROJECT_MIN = 20;`（現35行）の直後に追加：

```javascript
const SHIP_PROJECT_MIN = 60; // 船は低速なので航空より長い延長（12knで約22km先）。
```

- [ ] **Step 3: Replace `flightProjectionLayers()` and add `shipProjectionLayers()` in `js/main.js`**

現 `flightProjectionLayers()` 関数（`function flightProjectionLayers() { ... }` 全体、現159-201行）を次の2関数へ置換：

```javascript
// new deck.* を生成するヘルパ（共通ビルダの {kind,config} を deck レイヤー化）。
function deckFromProjectionConfigs(cfgs) {
  return cfgs.map(({ kind, config }) => (kind === 'line'
    ? new deck.LineLayer(config)
    : new deck.ScatterplotLayer(config)));
}

// 選択中の航空機の推定進路（heading 延長）。マゼンタの線/到達リング/流れる粒子/パルス。
function flightProjectionLayers() {
  if (!selectedFlight || !selectedFlight.arrival) return [];
  const src = [selectedFlight.point.lon, selectedFlight.point.lat];
  return deckFromProjectionConfigs(
    buildProjectionConfigs({ src, arrival: selectedFlight.arrival, prefix: 'flight' }, motionT, { reduced: REDUCED }));
}

// 選択中の船舶の推定進路（COG/SOG 延長）。航空と同じビルダ・マゼンタ。
function shipProjectionLayers() {
  if (!selectedShip || !selectedShip.arrival) return [];
  const src = [selectedShip.point.lon, selectedShip.point.lat];
  return deckFromProjectionConfigs(
    buildProjectionConfigs({ src, arrival: selectedShip.arrival, prefix: 'ship' }, motionT, { reduced: REDUCED }));
}
```

- [ ] **Step 4: Add ship projection to `drawAll` in `js/main.js`**

`drawAll` 内の `extra.push(...flightProjectionLayers());`（現214行）の直後に追加：

```javascript
  extra.push(...shipProjectionLayers());
```

- [ ] **Step 5: Add ships click branch in the onClick handler in `js/main.js`**

`boot()` 内 `initMap(...)` の onClick コールバック、航空分岐の `}` 直後（`drawAll(overlay);` を含む if ブロックの後・現250行付近）に ships 分岐を追加：

```javascript
      if (info.layer.id === 'ships' || info.layer.id === 'ships-dot') {
        const p = info.object;
        const arrival = shipArrival(p, SHIP_PROJECT_MIN);
        selectedShip = { point: p, arrival };
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(shipPopupHtml(p, arrival, SHIP_PROJECT_MIN)).addTo(map);
        drawAll(overlay);
      }
```

- [ ] **Step 6: Bump cache in `sw.js`**

`const CACHE = 'orbis-v15';` を次へ：

```javascript
const CACHE = 'orbis-v16';
```

- [ ] **Step 7: Run the FULL JS suite (回帰含む)**

Run: `node --test tests/*.test.js`
Expected: PASS（全件）。特に `flights.test.js`/`geo*.test.js`/`selection.test.js`/`ships.test.js`/`registry.test.js` が緑。

- [ ] **Step 8: Static sanity grep**

Run: `grep -n "PROJ_RGB\|pointAlongPath\|selectedShip\|shipProjectionLayers\|SHIP_PROJECT_MIN" js/main.js`
Expected: `PROJ_RGB` は main.js から消えている（selection.js のみ）。`pointAlongPath` も main.js から消えている。`selectedShip`/`shipProjectionLayers`/`SHIP_PROJECT_MIN` が存在。

- [ ] **Step 9: Commit**

```bash
git add js/main.js sw.js
git commit -m "feat(ships): click projection + unify flight/ship projection builder; sw v16"
```

---

## Task 5: 全回帰確認＋e2e

**Files:** なし（検証）

- [ ] **Step 1: 全テスト緑を確認**

Run: `node --test tests/*.test.js && pytest tests/ -q`
Expected: node 全件 PASS（geo/selection/ships に新規追加分込み）、pytest 27 PASS。

- [ ] **Step 2: e2e スモーク（既存）が緑のままを確認**

Run: `npx playwright test tests/e2e/smoke.spec.js`
Expected: PASS。船舶クリックの canvas ピックは座標依存で不安定なため e2e では深追いせず（進路 config は `selection.test.js` で担保）。既存のトグル/描画検証が緑であればよい。

- [ ] **Step 3: （コードなし・コミット不要）** 本番反映・船舶クリックのスクショ目視検証は `finishing-a-development-branch` 後の本番 Playwright で実施（line/ring/flow/pulse のマゼンタ進路＋見出し付きポップアップ）。

---

## Self-Review

**1. Spec coverage:**
- ツールチップ全項目見出し → Task 2 ✓（船種/速度 追加・既存 船名/航路 維持）
- 投影コア抽出＋shipArrival(cog/sog kn→m/s) → Task 1 ✓
- 共通進路 config ビルダ（航空も載せ替え・DRY） → Task 3（ビルダ）＋Task 4（flights/ship 両方が使用）✓
- shipPopupHtml（船名/MMSI・到達/—・速度0注記・マゼンタ） → Task 3 ✓
- クリック配線 selectedShip / SHIP_PROJECT_MIN=60 / drawAll / onClick ships分岐 → Task 4 ✓
- 色マゼンタ共通・60分 → Task 1(60既定)/Task 3(色) ✓
- sw v15→v16 → Task 4 ✓
- テスト（geo/selection/ships 回帰含む・e2e） → Task 1,2,3,5 ✓

**2. Placeholder scan:** 各コードステップは完全コード掲載。"TBD/後で" なし。

**3. Type consistency:** `projectAhead(lon,lat,headingDeg,speedMps,minutes)` を `projectedArrival`/`shipArrival` が共用。`buildProjectionConfigs(sel{src,arrival,prefix}, motionT, opts{reduced})` の戻り `[{kind,config}]` を `deckFromProjectionConfigs` が `deck.LineLayer`/`deck.ScatterplotLayer` 化。deck id（`flight-*`/`ship-*`）一致。`shipArrival`/`shipPopupHtml`/`buildProjectionConfigs` の import 先（geo.js / selection.js）が Task 4 の import と一致。`PROJ_RGB`/`PROJ_FLOW_RGB` は selection.js が単一定義（main.js のローカルは削除）。
