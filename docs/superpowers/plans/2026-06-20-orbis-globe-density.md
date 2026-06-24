# ORBIS P0-1 globe密度抑制（ズーム連動密度＋レイヤープリセット）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引き globe で紛争/抗議の赤洪水を鎮め（ズーム連動密度）、初期表示と切替を概観/紛争/気象/交通のプリセットで整理する。

**Architecture:** 既存の描画ループ（`buildBaseLayers` が `ctx={zoom,...}` を各レイヤーに渡し、`map.on('zoom')` で再描画）と状態管理（`state.js`/`panel.js`）に乗せる、疎結合な2機能。新規ロジックは純関数（`densityScale`/`presets.js`）で単体テスト可能。registry/収集は不変。

**Tech Stack:** Vanilla ES Modules, deck.gl(ScatterplotLayer/ADDITIVE_BLEND), MapLibre globe, node:test, Playwright。

## Global Constraints

- 純関数は `js/lib/`、レイヤーは `js/layers/`、UIは `js/ui/`。registry に層を足す方式は不変（今回は層追加なし）。
- テスト：`npm run test:js`（`node --test tests/*.test.js`）／`npm run test:e2e`（`playwright test`・`workers:1` 直列）。e2e は WSL2 で globe 起動が重く `test.setTimeout(60000)` を使う。
- 既存テストを壊さない（後方互換）。`densityScale(zoom)` は zoom 非数で `1`（減衰なし）。`loadEnabled` の新引数 `defaultOn` は省略時従来挙動。
- SW はネットワーク優先（`sw.js`）。版上げは厳密には不要だが慣例で `v37→v38`。`index.html`/`css`/`js` 変更はネット優先で即反映。
- 既定の有効レイヤー（保存が無い初回）＝概観プリセット＝`['quakes','news','conflict','protests','currents']`。保存があれば従来通り尊重（storage KEY は据置＝既存ユーザーの選択は保持。新規/クリア時のみ概観既定）。
- conflict 加算ブロブ alpha 基準値＝`42`、ブロブ半径＝`blobRadius(mentions)`、core 半径係数＝`0.45`、core 色＝`emberFill(...)`。これらは現状値（zoom=高で不変に保つ）。
- 密度減衰の既定ダイヤル＝`densityScale` の `z0=2.5, z1=5, min=0.22`。`?dens=z0,z1,min` で上書き可。半径係数＝`0.55 + 0.45*s`。
- プリセット定義（純データ）：overview=地震/ニュース/紛争/抗議/海流, conflict=紛争/抗議/ニュース, weather=水温/海流/気温, traffic=航空/船舶/貿易。`DEFAULT_PRESET='overview'`。

---

## Task 1: `densityScale` 純関数（geo.js）

**Files:**
- Modify: `js/lib/geo.js`（`blobRadius` の直後、105行目付近に追加）
- Test: `tests/density.test.js`（新規）

**Interfaces:**
- Produces: `densityScale(zoom: number, opts?: {z0?:number, z1?:number, min?:number}) => number`（0..1 の減衰係数）

- [ ] **Step 1: 失敗するテストを書く** — `tests/density.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { densityScale } from '../js/lib/geo.js';

test('densityScale: zoom<=z0 は min(0.22)', () => {
  assert.equal(densityScale(2.5), 0.22);
  assert.equal(densityScale(0), 0.22);
});
test('densityScale: zoom>=z1 は 1', () => {
  assert.equal(densityScale(5), 1);
  assert.equal(densityScale(9), 1);
});
test('densityScale: 中間は線形（中点3.75→0.5）', () => {
  assert.equal(densityScale(3.75), 0.5);
});
test('densityScale: 非数は 1（減衰なし＝安全側）', () => {
  assert.equal(densityScale(undefined), 1);
  assert.equal(densityScale(NaN), 1);
});
test('densityScale: opts で z0/z1/min を上書き', () => {
  assert.equal(densityScale(2, { z0: 2, z1: 6, min: 0.1 }), 0.1);
  assert.equal(densityScale(6, { z0: 2, z1: 6, min: 0.1 }), 1);
  assert.equal(densityScale(4, { z0: 2, z1: 6, min: 0.1 }), 0.5);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npm run test:js -- --test-name-pattern densityScale` 期待: FAIL（`densityScale is not exported`）。代替: `node --test tests/density.test.js`。

- [ ] **Step 3: 最小実装** — `js/lib/geo.js` の `blobRadius` 関数の直後に追加

```js
// 引き(globe)で加算ブロブが飽和→赤洪水になるのを抑える減衰係数(0..1)。
// 低ズーム=強く減衰(min)、高ズーム=1.0(現状維持)。線形ランプ。z1>z0 を前提。
// zoom が非数のときは 1（減衰なし＝安全側）。
export function densityScale(zoom, { z0 = 2.5, z1 = 5, min = 0.22 } = {}) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 1;
  const t = (z - z0) / (z1 - z0);
  return Math.max(min, Math.min(1, t));
}
```

- [ ] **Step 4: 成功を確認** — Run: `node --test tests/density.test.js` 期待: PASS（5件）。

- [ ] **Step 5: コミット**

```bash
git add js/lib/geo.js tests/density.test.js
git commit -m "feat(geo): densityScale 純関数（ズーム連動の密度減衰係数）"
```

---

## Task 2: conflict / protests のズーム連動密度

**Files:**
- Modify: `js/layers/conflict.js`（import・`buildBlobConfig`・`buildCoreConfig`・`toDeckLayer`）
- Modify: `js/layers/protests.js`（同上）
- Test: `tests/heat.test.js`（拡張）

**Interfaces:**
- Consumes: `densityScale` (Task 1)
- Produces: `buildBlobConfig(snapshot, zoom?, dens?)` / `buildCoreConfig(snapshot, emberScale?, zoom?, dens?)`（zoom/dens 省略時は減衰なし＝現状値）

- [ ] **Step 1: 失敗するテストを書く** — `tests/heat.test.js` の末尾に追加

```js
test('conflict buildBlobConfig: 引き(低zoom)で alpha/半径が減衰、寄り(高zoom)で復帰', () => {
  const p = snap.points[0]; // mentions 50
  const lo = buildBlobConfig(snap, 2.5); // s=0.22
  const hi = buildBlobConfig(snap, 5);   // s=1
  assert.ok(lo.getFillColor(p)[3] < hi.getFillColor(p)[3], '引きでalpha減');
  assert.ok(lo.getRadius(p) < hi.getRadius(p), '引きで半径減');
  assert.equal(hi.getFillColor(p)[3], 42, '寄りは現状alpha=42');
});
test('conflict buildCoreConfig: 引きで alpha/半径が減衰', () => {
  const p = sevSnap.points[1]; // mentions 100
  const lo = buildCoreConfig(sevSnap, 1, 2.5);
  const hi = buildCoreConfig(sevSnap, 1, 5);
  assert.ok(lo.getFillColor(p)[3] < hi.getFillColor(p)[3], '引きでcore alpha減');
  assert.ok(lo.getRadius(p) < hi.getRadius(p), '引きでcore半径減');
});
test('protests もズーム連動で減衰', () => {
  const p = snap.points[0];
  assert.ok(buildBlobP(snap, 2.5).getFillColor(p)[3] < buildBlobP(snap, 5).getFillColor(p)[3]);
});
test('zoom 未指定（従来呼び出し）は減衰なし＝alpha 42', () => {
  assert.equal(buildBlobConfig(snap).getFillColor(snap.points[0])[3], 42);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/heat.test.js` 期待: FAIL（`buildBlobConfig` が zoom 引数を無視し alpha 一定／`densityScale` 未 import）。

- [ ] **Step 3: 実装（conflict.js）** — import 行と3関数を置換

import 行（1箇所目の import を置換）:
```js
import { hostnameOf, blobRadius, ADDITIVE_BLEND, emberFill, densityScale } from '../lib/geo.js';
```

`buildBlobConfig` を置換:
```js
export function buildBlobConfig(snapshot, zoom, dens) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  const s = densityScale(zoom, dens);
  const rk = 0.55 + 0.45 * s;
  return {
    id: 'conflict-heat', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => blobRadius(p.mentions) * rk,
    radiusMinPixels: 10, radiusMaxPixels: 60, stroked: false, pickable: false,
    getFillColor: () => [RED[0], RED[1], RED[2], Math.round(42 * s)], // 引きで加算飽和を抑える
    parameters: ADDITIVE_BLEND,
  };
}
```

`buildCoreConfig` を置換:
```js
export function buildCoreConfig(snapshot, emberScale = 1, zoom, dens) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  const s = densityScale(zoom, dens);
  const rk = 0.55 + 0.45 * s;
  return {
    id: 'conflict-core', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => Math.max(3, blobRadius(p.mentions) * 0.45) * rk,
    radiusMinPixels: 3, radiusMaxPixels: 26, stroked: false, pickable: false,
    getFillColor: (p) => {
      const c = emberFill(p.mentions, severityRank(p.root) / 3, emberScale, [200, 40, 50]);
      return [c[0], c[1], c[2], Math.round(c[3] * s)];
    },
    parameters: ADDITIVE_BLEND,
  };
}
```

`toDeckLayer` を置換:
```js
  toDeckLayer(snapshot, ctx) {
    const scale = (ctx && ctx.cfx && ctx.cfx.emberScale) || 1;
    const zoom = ctx && ctx.zoom;
    const dens = ctx && ctx.dens;
    return [
      new deck.ScatterplotLayer(buildBlobConfig(snapshot, zoom, dens)),
      new deck.ScatterplotLayer(buildCoreConfig(snapshot, scale, zoom, dens)),
      new deck.ScatterplotLayer(buildPickConfig(snapshot)),
    ];
  },
```

- [ ] **Step 4: 実装（protests.js）** — conflict と同形

import 行を置換:
```js
import { hostnameOf, blobRadius, ADDITIVE_BLEND, emberFill, densityScale } from '../lib/geo.js';
```

`buildBlobConfig` を置換:
```js
export function buildBlobConfig(snapshot, zoom, dens) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  const s = densityScale(zoom, dens);
  const rk = 0.55 + 0.45 * s;
  return {
    id: 'protests-heat', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => blobRadius(p.mentions) * rk,
    radiusMinPixels: 10, radiusMaxPixels: 60, stroked: false, pickable: false,
    getFillColor: () => [GREEN[0], GREEN[1], GREEN[2], Math.round(42 * s)],
    parameters: ADDITIVE_BLEND,
  };
}
```

`buildCoreConfig` を置換:
```js
export function buildCoreConfig(snapshot, emberScale = 1, zoom, dens) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  const s = densityScale(zoom, dens);
  const rk = 0.55 + 0.45 * s;
  return {
    id: 'protests-core', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => Math.max(3, blobRadius(p.mentions) * 0.45) * rk,
    radiusMinPixels: 3, radiusMaxPixels: 26, stroked: false, pickable: false,
    getFillColor: (p) => {
      const c = emberFill(p.mentions, 0, emberScale, [40, 200, 120]);
      return [c[0], c[1], c[2], Math.round(c[3] * s)];
    },
    parameters: ADDITIVE_BLEND,
  };
}
```

`toDeckLayer` を置換:
```js
  toDeckLayer(snapshot, ctx) {
    const scale = (ctx && ctx.cfx && ctx.cfx.emberScale) || 1;
    const zoom = ctx && ctx.zoom;
    const dens = ctx && ctx.dens;
    return [
      new deck.ScatterplotLayer(buildBlobConfig(snapshot, zoom, dens)),
      new deck.ScatterplotLayer(buildCoreConfig(snapshot, scale, zoom, dens)),
      new deck.ScatterplotLayer(buildPickConfig(snapshot)),
    ];
  },
```

- [ ] **Step 5: 成功を確認** — Run: `node --test tests/heat.test.js` 期待: PASS（既存6＋新規4）。

- [ ] **Step 6: コミット**

```bash
git add js/layers/conflict.js js/layers/protests.js tests/heat.test.js
git commit -m "feat(layers): 紛争/抗議のズーム連動密度（引きで赤洪水を鎮める・寄りで復帰）"
```

---

## Task 3: `presets.js` 純モジュール

**Files:**
- Create: `js/lib/presets.js`
- Test: `tests/presets.test.js`（新規）

**Interfaces:**
- Produces: `PRESETS: Array<{id,label,layers:string[]}>`, `DEFAULT_PRESET: 'overview'`, `presetById(id)=>preset|null`, `applyPreset(id)=>Set<string>`, `activePresetId(enabledSet:Set)=>string|null`

- [ ] **Step 1: 失敗するテストを書く** — `tests/presets.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, DEFAULT_PRESET, presetById, applyPreset, activePresetId } from '../js/lib/presets.js';
import { allLayerIds } from '../js/layers/registry.js';

test('PRESETS の全レイヤーIDが registry に実在', () => {
  const ids = new Set(allLayerIds());
  for (const p of PRESETS) for (const id of p.layers) assert.ok(ids.has(id), `${p.id}: 未知レイヤー ${id}`);
});
test('DEFAULT_PRESET は overview / 概観の中身', () => {
  assert.equal(DEFAULT_PRESET, 'overview');
  assert.deepEqual(presetById('overview').layers, ['quakes', 'news', 'conflict', 'protests', 'currents']);
});
test('applyPreset: その層だけの排他集合', () => {
  assert.deepEqual([...applyPreset('weather')].sort(), ['airtemp', 'currents', 'sst']);
});
test('applyPreset: 未知idは空集合', () => {
  assert.equal(applyPreset('zzz').size, 0);
});
test('activePresetId: 完全一致でid、部分/余分は null(カスタム)', () => {
  assert.equal(activePresetId(new Set(['sst', 'currents', 'airtemp'])), 'weather');
  assert.equal(activePresetId(new Set(['sst', 'currents'])), null);
  assert.equal(activePresetId(new Set(['sst', 'currents', 'airtemp', 'quakes'])), null);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/presets.test.js` 期待: FAIL（`presets.js` 不在）。

- [ ] **Step 3: 実装** — `js/lib/presets.js`

```js
// レイヤープリセット（純データ＋純関数・deck/DOM 非依存）。
// 概観=世界の出来事の俯瞰を既定にし「初期から情報過多」を断つ。各層IDは registry に実在すること。
export const PRESETS = [
  { id: 'overview', label: '概観', layers: ['quakes', 'news', 'conflict', 'protests', 'currents'] },
  { id: 'conflict', label: '紛争', layers: ['conflict', 'protests', 'news'] },
  { id: 'weather', label: '気象', layers: ['sst', 'currents', 'airtemp'] },
  { id: 'traffic', label: '交通', layers: ['flights', 'ships', 'trade'] },
];
export const DEFAULT_PRESET = 'overview';

export function presetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// プリセット適用後の ENABLED 集合（純粋・排他＝その層だけ）。未知idは空集合。
export function applyPreset(id) {
  const p = presetById(id);
  return new Set(p ? p.layers : []);
}

// 現在の ENABLED 集合がどのプリセットと完全一致するか。一致なし=null（カスタム）。
export function activePresetId(enabledSet) {
  for (const p of PRESETS) {
    if (p.layers.length === enabledSet.size && p.layers.every((id) => enabledSet.has(id))) return p.id;
  }
  return null;
}
```

- [ ] **Step 4: 成功を確認** — Run: `node --test tests/presets.test.js` 期待: PASS（5件）。

- [ ] **Step 5: コミット**

```bash
git add js/lib/presets.js tests/presets.test.js
git commit -m "feat(presets): レイヤープリセット純モジュール（概観/紛争/気象/交通）"
```

---

## Task 4: `state.js` の `defaultOn`（既定=概観の土台）

**Files:**
- Modify: `js/lib/state.js`（`loadEnabled`）
- Test: `tests/state.test.js`（拡張）

**Interfaces:**
- Produces: `loadEnabled(allIds, stored, defaultOff=[], defaultOn=null)`（`defaultOn` 配列指定かつ stored 無しなら `defaultOn ∩ allIds`）

- [ ] **Step 1: 失敗するテストを書く** — `tests/state.test.js` の末尾に追加

```js
test('loadEnabled: stored=null かつ defaultOn 指定で defaultOn の集合になる', () => {
  const e = loadEnabled(['quakes', 'flights', 'conflict', 'news'], null, [], ['quakes', 'news']);
  assert.deepEqual([...e].sort(), ['news', 'quakes']);
});
test('loadEnabled: defaultOn は allIds に無いidを含めない', () => {
  const e = loadEnabled(['quakes', 'news'], null, [], ['quakes', 'ghost']);
  assert.deepEqual([...e], ['quakes']);
});
test('loadEnabled: stored 指定時は defaultOn を無視', () => {
  const e = loadEnabled(['quakes', 'news'], ['news'], [], ['quakes']);
  assert.deepEqual([...e], ['news']);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/state.test.js` 期待: FAIL（`defaultOn` 未対応＝stored=null で全ON にフォールバック）。

- [ ] **Step 3: 実装** — `js/lib/state.js` の `loadEnabled` を置換

```js
// stored: 有効idの配列（保存形式）。null/不正なら:
//   defaultOn 指定時は defaultOn の集合、未指定時は defaultOff を除く全 ON。
export function loadEnabled(allIds, stored, defaultOff = [], defaultOn = null) {
  if (!Array.isArray(stored)) {
    if (Array.isArray(defaultOn)) return new Set(allIds.filter((id) => defaultOn.includes(id)));
    return new Set(allIds.filter((id) => !defaultOff.includes(id)));
  }
  return new Set(allIds.filter((id) => stored.includes(id)));
}
```

- [ ] **Step 4: 成功を確認** — Run: `node --test tests/state.test.js` 期待: PASS（既存7＋新規3）。

- [ ] **Step 5: コミット**

```bash
git add js/lib/state.js tests/state.test.js
git commit -m "feat(state): loadEnabled に defaultOn 追加（既定=概観プリセットの土台・後方互換）"
```

---

## Task 5: プリセットUI＋main.js配線＋e2e整合（既定=概観の反映）

**Files:**
- Modify: `index.html`（`#panel-presets` 追加）
- Modify: `css/orbis.css`（`.preset-chips`/`.preset-chip`）
- Modify: `js/ui/panel.js`（import＋`renderPresets` 追加）
- Modify: `js/main.js`（既定=概観・`?dens` ctx・`renderPresets` 配線・chip/トグル同期）
- Modify: `tests/e2e/flight-projection.spec.js`（flights を `.check()`）
- Modify: `tests/e2e/smoke.spec.js`（flights 描画前提箇所で ON 化）
- Test: `tests/e2e/presets.spec.js`（新規）

**Interfaces:**
- Consumes: `PRESETS`/`applyPreset`/`activePresetId`/`presetById`/`DEFAULT_PRESET` (Task 3)、`densityScale`（ctx.dens 経由・Task 2 が消費）
- Produces: `renderPresets(root, getEnabled, onApply) => { refresh() }`

- [ ] **Step 1: e2e（プリセット）の失敗テストを書く** — `tests/e2e/presets.spec.js`

```js
import { test, expect } from '@playwright/test';

test('default initial view is the overview preset', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  const on = await page.$$eval('#panel-rows .layer-row',
    (rows) => rows.filter((r) => r.querySelector('.layer-toggle').checked).map((r) => r.dataset.id).sort());
  expect(on).toEqual(['conflict', 'currents', 'news', 'protests', 'quakes']);
  await expect(page.locator('#panel-presets .preset-chip[data-preset="overview"]')).toHaveClass(/active/);
});

test('preset chips set the enabled set exclusively + custom state', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#panel-presets .preset-chip')).toHaveCount(4);

  await page.locator('#panel-presets .preset-chip[data-preset="weather"]').click();
  await page.waitForTimeout(300);
  const on = await page.$$eval('#panel-rows .layer-row',
    (rows) => rows.filter((r) => r.querySelector('.layer-toggle').checked).map((r) => r.dataset.id).sort());
  expect(on).toEqual(['airtemp', 'currents', 'sst']);
  await expect(page.locator('#panel-presets .preset-chip[data-preset="weather"]')).toHaveClass(/active/);

  // 個別トグルでズレたら custom（どの chip も active でない・カスタムラベル表示）
  await page.locator('#panel-rows .layer-row[data-id="quakes"] .layer-toggle').check();
  await page.waitForTimeout(200);
  await expect(page.locator('#panel-presets .preset-chip.active')).toHaveCount(0);
  await expect(page.locator('#panel-presets .preset-custom')).toBeVisible();
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx playwright test tests/e2e/presets.spec.js` 期待: FAIL（`#panel-presets` 不在・既定が概観でない）。

- [ ] **Step 3: `index.html` に `#panel-presets` を追加** — `.panel-head`（`</div>` 終端）の直後・`<div id="panel-rows"></div>` の直前に挿入

置換前（`#panel` ブロック）:
```html
      <div id="panel" class="side-panel">
        <div class="panel-head"><h4>レイヤー / Layers</h4>
          <button id="panel-toggle" class="collapse-btn" aria-label="パネル折りたたみ">‹</button></div>
        <div id="panel-rows"></div>
```
置換後:
```html
      <div id="panel" class="side-panel">
        <div class="panel-head"><h4>レイヤー / Layers</h4>
          <button id="panel-toggle" class="collapse-btn" aria-label="パネル折りたたみ">‹</button></div>
        <div id="panel-presets" class="preset-chips"></div>
        <div id="panel-rows"></div>
```

- [ ] **Step 4: `css/orbis.css` に chip スタイルを追加**（`.feed-chip` 準拠・末尾に追記）

```css
/* レイヤープリセット chip（.feed-chip 準拠で見た目統一） */
.preset-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; align-items: center; }
#panel.collapsed .preset-chips { display: none; }
.preset-chip {
  font-size: 11px; padding: 3px 9px; border-radius: 999px; cursor: pointer;
  color: var(--text, #cfe); background: rgba(255, 255, 255, .04);
  border: 1px solid rgba(255, 255, 255, .14); opacity: .75; transition: opacity .15s, border-color .15s, box-shadow .15s;
}
.preset-chip:hover { opacity: 1; }
.preset-chip.active { opacity: 1; border-color: var(--cyan, #6cf); box-shadow: 0 0 8px -2px var(--cyan, #6cf); background: rgba(108, 204, 255, .12); }
.preset-custom { font-size: 10px; opacity: .5; margin-left: 2px; }
```

- [ ] **Step 5: `js/ui/panel.js` に `renderPresets` を追加** — ファイル先頭の import の下に presets import を足し、ファイル末尾に関数を追加

import 追加（既存 `import { toggleEnabled, writeStored } from '../lib/state.js';` の下）:
```js
import { PRESETS, applyPreset, activePresetId } from '../lib/presets.js';
```

ファイル末尾に追加:
```js
// プリセット chip 行。クリックでそのプリセットの層だけ ON（排他）。アクティブ強調＋カスタム表示。
// root: #panel-presets, getEnabled: ()=>Set, onApply(nextSet): 適用コールバック。
export function renderPresets(root, getEnabled, onApply) {
  if (!root) return { refresh() {} };
  root.innerHTML = PRESETS.map((p) =>
    `<button type="button" class="preset-chip" data-preset="${p.id}">${p.label}</button>`
  ).join('') + '<span class="preset-custom" hidden>カスタム</span>';

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset-chip');
    if (!btn) return;
    onApply(applyPreset(btn.dataset.preset));
  });

  const api = {
    refresh() {
      const active = activePresetId(getEnabled());
      root.querySelectorAll('.preset-chip').forEach((b) =>
        b.classList.toggle('active', b.dataset.preset === active));
      const custom = root.querySelector('.preset-custom');
      if (custom) custom.hidden = active != null;
    },
  };
  api.refresh();
  return api;
}
```

- [ ] **Step 6: `js/main.js` を配線** — 4箇所を編集

(6a) state import に `writeStored` を追加（行5）:
```js
import { loadEnabled, readStored, writeStored } from './lib/state.js';
```

(6b) panel import に `renderPresets` を追加（行9）＋ presets import を追加（その下）:
```js
import { renderPanel, renderPresets, wireCollapse } from './ui/panel.js';
```
`registry.js` import の直後あたりに追加:
```js
import { presetById, DEFAULT_PRESET } from './lib/presets.js';
```

(6c) `CFX` 定義（行27付近）の直後に `?dens` パーサと `DENS` を追加:
```js
// ズーム連動密度ダイヤル（?dens=z0,z1,min で実物比較。未指定=既定 z0=2.5,z1=5,min=0.22）。
function parseDens(search) {
  const m = /[?&]dens=([\d.]+),([\d.]+),([\d.]+)/i.exec(search || '');
  if (!m) return undefined;
  const z0 = parseFloat(m[1]), z1 = parseFloat(m[2]), min = parseFloat(m[3]);
  if (![z0, z1, min].every(Number.isFinite) || z1 <= z0) return undefined;
  return { z0, z1, min };
}
const DENS = parseDens(typeof location !== 'undefined' ? location.search : '');
```

(6d) 既定 ENABLED を概観に（行32 置換）:
```js
let ENABLED = loadEnabled(ALL_IDS, readStored(), [], presetById(DEFAULT_PRESET).layers);
```

(6e) ctx に dens を載せる（`buildBaseLayers` 内・行217 置換）:
```js
  const ctx = { zoom, cmap: CMAP, motionT, cfx: CFX, dens: DENS };
```

(6f) パネル配線（行349-357 付近）を置換してプリセットを結線:
```js
  let presetsApi;
  panel = renderPanel(
    document.getElementById('panel-rows'),
    layers,
    () => ENABLED,
    () => window.__orbis.counts,
    (next) => { ENABLED = next; rebuild(overlay); if (presetsApi) presetsApi.refresh(); },
    descFor
  );
  presetsApi = renderPresets(
    document.getElementById('panel-presets'),
    () => ENABLED,
    (next) => { ENABLED = next; writeStored(next); rebuild(overlay); panel.syncChecks(); presetsApi.refresh(); }
  );
  wireCollapse(document.getElementById('panel'), document.getElementById('panel-toggle'));
  wireFeedCollapse(document.getElementById('feed'), document.getElementById('feed-toggle'));
```

- [ ] **Step 7: 既存 e2e の回帰修正（flight-projection）** — `tests/e2e/flight-projection.spec.js` の load 直後（`#loading` hidden 待ちの直後）に flights を ON にする。コメントも更新

置換前:
```js
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // flights は既定 ON。データ到着を待つ。
  await expect.poll(
```
置換後:
```js
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // flights は概観既定では OFF。明示的に ON にしてから検証する（描画＝クリック対象が要る）。
  await page.locator('.layer-row[data-id="flights"] .layer-toggle').check();
  await expect.poll(
```

- [ ] **Step 8: 既存 e2e の回帰修正（smoke の flights 描画前提）** — `tests/e2e/smoke.spec.js` の「航空=飛行機シルエット…」ブロック直前で flights を ON にし、コメント修正

置換前:
```js
  // 航空=飛行機シルエット(SolidPolygon) が deck に存在（flights は ON のまま）
  const hasFlights = await page.evaluate(() => {
```
置換後:
```js
  // 航空=飛行機シルエット(SolidPolygon)。概観既定では OFF なので ON にしてから存在を確認。
  await page.locator('.layer-row[data-id="flights"] .layer-toggle').check();
  await page.waitForTimeout(300);
  const hasFlights = await page.evaluate(() => {
```

- [ ] **Step 9: e2e 全体を実行** — Run: `npm run test:e2e` 期待: PASS（presets 2件＋既存 smoke/conflict/flight-projection/ship-projection/media/briefing/boot/mobile-nav/live-captions すべて緑）。

- [ ] **Step 10: コミット**

```bash
git add index.html css/orbis.css js/ui/panel.js js/main.js tests/e2e/presets.spec.js tests/e2e/flight-projection.spec.js tests/e2e/smoke.spec.js
git commit -m "feat(ui): レイヤープリセット行＋既定=概観＋?dens 配線（e2e回帰修正含む）"
```

---

## Task 6: 配信（sw v38＋SHELL）＋全テスト緑＋手動確認

**Files:**
- Modify: `sw.js`（CACHE 版＋SHELL に presets.js）

**Interfaces:** なし（配信のみ）

- [ ] **Step 1: `sw.js` を更新** — CACHE 版を上げ、SHELL に presets.js を追加（オフライン precache 充実。ネット優先ゆえ必須ではないが慣例＋オフライン保険）

置換前:
```js
const CACHE = 'orbis-v37';
const SHELL = ['/', '/index.html', '/css/orbis.css', '/js/main.js'];
```
置換後:
```js
const CACHE = 'orbis-v38';
const SHELL = ['/', '/index.html', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js'];
```

- [ ] **Step 2: 単体テスト全件** — Run: `npm run test:js` 期待: PASS（density/heat/presets/state 含む全 *.test.js 緑）。

- [ ] **Step 3: e2e 全件** — Run: `npm run test:e2e` 期待: PASS（全 spec 緑）。

- [ ] **Step 4: 手動・実物比較（密度ダイヤル）** — Run: `npm run serve`（localhost:8000・SW 無効）

確認:
1. `http://localhost:8000/` で引き globe（zoom≈2.7）→ 紛争/抗議の赤が以前より淡く、地球と他レイヤーが見える。
2. 寄る（zoom5+）→ ember コアが現状どおり鮮明に復帰。
3. `?dens=2,6,0.15` 等で減衰の強さを比較し、必要なら `densityScale` 既定（z0/z1/min）を `js/lib/geo.js` で調整して再確認（変更したら Task 1 のコミットに追従コミット）。
4. プリセット chip（概観/紛争/気象/交通）を順にクリック→該当層だけ ON・アクティブ強調。個別トグルで「カスタム」表示。

スクショは画素目視（GPU 依存の見えは headless と乖離・[[mistakes]]）。最終の色味確定はオーナーの実機確認に委ねる。

- [ ] **Step 5: コミット**

```bash
git add sw.js
git commit -m "chore(sw): v38＋SHELL に presets.js（P0-1 globe密度配信）"
```

---

## 統合（実装完了後）

1. `npm run test:js && npm run test:e2e` が緑であることを最終確認。
2. main ツリーへ統合：`ExitWorktree`（keep）→ `git -C ~/apps/orbis fetch origin && git -C ... merge worktree-globe-density && git -C ... push`。共有ファイル（main.js/css/sw）に触れるので統合時にコンフリクトが出たら統合セッションが解消。
3. Vercel 自動デプロイ → `curl` で sw v38・presets.js 200 を確認 → 本番 Playwright で引き globe の赤鎮静・プリセット切替（モバイル含む）をサニティ。
4. 記憶整理：Obsidian `Projects/orbis-uiux-improvements.md` 進捗ログに P0-1 完了を追記、MEMORY.md 索引を更新（書き手は統合セッション1人）。
5. **残（オーナー）**：`?dens` の最終色味／本番実機での引き globe の見え・プリセットの実用感。

## 注意（既存ユーザーの既定）

storage KEY（`orbis.enabled.v1`）は据置のため、**過去に訪問済みのユーザー（オーナー含む）は保存済みレイヤーが優先**され、概観既定は自動適用されない。概観の初期表示を確認するには localStorage をクリアするか「概観」chip を押す。一方、**ズーム連動密度（機能A）は保存状態に関係なく全ユーザーに効く**ので、引き globe の赤洪水抑制は誰でも体感できる。
