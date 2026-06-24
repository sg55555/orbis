# ORBIS 常設「凡例＋使い方」オーバーレイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** globe の隅に常設の折りたたみオーバーレイを置き、上部タブで『凡例』（全レイヤーの全段の意味）⇄『使い方』（主要操作）を切り替えられるようにする。

**Architecture:** 各レイヤーが既に保持する `legend:[{color,label}]`／`marker`／`swatchColor` と registry の `descFor`、既存 `categories.js` の `groupLayers` を読むだけ（新データ生成なし）。純粋関数 `buildLegendModel`＋HTML ビルダ（node:test）と、DOM 配線 `renderLegend`＋index.html／css／immerse.js／mobile-nav.js（e2e）に分離。

**Tech Stack:** Vanilla JS（ESM・ビルドなし）／node:test（`node --test`）／Playwright（`tests/e2e`・localhost:8000 直列）／MapLibre+deck.gl（凡例自体は非依存）。

## Global Constraints

- **設計言語**：orbis＝宇宙的/天体的。主アクセント＝地球の縁の大気ハロ（線/光）。反射的にサイバーパンク HUD を足さない。リッチさは線の密度・精緻さ・光の連動で。`.side-panel` グラス言語に馴染ませる。
- **main.js は非編集**：body クラスは `main.js:286` が `immerseClasses()` を適用済。トグルは immerse.js への追加だけで効かせる。
- **共有ファイルは最小差分**：`index.html` / `css/orbis.css`（**末尾追記**）/ `js/lib/immerse.js` / `js/ui/mobile-nav.js` は複数スレッドが触る。追記・追加に留め、css の凡例 CSS は原則 tail ブロックに置く（モバイルシートの既存セレクタへの追記のみ例外的に許容）。
- **凡例 CSS は tail ブロック集約**：swatch 形は `.layer-row .swatch-*` に scope されているため `#legend` 用に再宣言する（mid-file 共有 CSS を書き換えない）。
- **テスト**：純粋部は node:test、DOM は Playwright（`tests/e2e/`・workers:1・baseURL localhost:8000・reuseExistingServer）。GPU 依存の見た目（blur/glow/形）はオーナー実機確認（自動テスト対象外）。
- **コミット**：各タスク末尾でコミット。メッセージ末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- **カテゴリ**：既存 `categories.js`（出来事=quakes/conflict/protests/news、移動=flights/ships/trade、環境=sst/currents/airtemp）を再利用。新カテゴリを作らない。

---

### Task 1: `immerseLegend` トグル（純粋）

**Files:**
- Modify: `js/lib/immerse.js`（`immerseSec` の直後に関数追加・`immerseClasses` に1行追加）
- Test: `tests/immerse.test.js`（import 追加＋テスト追加）

**Interfaces:**
- Consumes: 既存 `readSearch`（同ファイル内・private）。
- Produces: `immerseLegend(search: string) -> 'on'|'off'`（既定 `'on'`）。`immerseClasses(search)` の返り値配列に `'legend-on'|'legend-off'` を追加。

- [ ] **Step 1: 失敗するテストを書く**

`tests/immerse.test.js` の import に `immerseLegend` を追加し（既存 import 文の末尾に追記）、ファイル末尾に追加：

```javascript
test('immerseLegend: 未指定は既定 on。?legend=off で上書き（無効も既定 on・大小無視）', () => {
  assert.equal(immerseLegend(''), 'on');
  assert.equal(immerseLegend('?legend=off'), 'off');
  assert.equal(immerseLegend('?legend=ON'), 'on');
  assert.equal(immerseLegend('?legend=OFF'), 'off');
  assert.equal(immerseLegend('?legend=x'), 'on');
});

test('immerseClasses: legend- を常時付与（既定 legend-on、?legend=off で legend-off）', () => {
  assert.ok(immerseClasses('').includes('legend-on'));
  assert.ok(immerseClasses('?legend=off').includes('legend-off'));
});
```

import 文（既存）を次に変更：

```javascript
import {
  immerseZoom, immerseSeam, immerseGlow, immerseMediaBg, immerseClasses,
  atmosphereStops, isCompareMode, immerseGlass, DEFAULT_ZOOM, immerseNeb,
  immerseMediaPolish, immerseUi, immerseFont, immerseSec, immerseLegend,
} from '../js/lib/immerse.js';
```

- [ ] **Step 2: テストが落ちるのを確認**

Run: `node --test tests/immerse.test.js`
Expected: FAIL（`immerseLegend is not a function` / `legend-on` 不在）

- [ ] **Step 3: 実装する**

`js/lib/immerse.js`：`immerseSec` 関数の直後に追加：

```javascript
// ?legend=on|off（大小無視）。globe 隅の常設「凡例＋使い方」オーバーレイの表示。既定 on。
// off は before 比較用（body.legend-off で #legend を隠す）。
export function immerseLegend(search) {
  const m = /[?&]legend=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}
```

同ファイル `immerseClasses` の `out.push('sec-' + immerseSec(search));` の直後に1行追加：

```javascript
  out.push('legend-' + immerseLegend(search));
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/immerse.test.js`
Expected: PASS（全ケース）

- [ ] **Step 5: コミット**

```bash
git add js/lib/immerse.js tests/immerse.test.js
git commit -m "feat(legend): ?legend=on|off トグルを immerse に追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `buildLegendModel`（純粋データモデル）

**Files:**
- Create: `js/lib/legend-data.js`
- Test: `tests/legend-data.test.js`

**Interfaces:**
- Consumes: `groupLayers` from `js/lib/categories.js`。レイヤーオブジェクト（`{id,label,marker?,swatchColor?,legend?}`）。`descFor` 関数（省略時は空文字）。
- Produces: `buildLegendModel(layers, descFor?) -> Array<{ id, label, layers: Array<{ id, label, marker, swatchColor, desc, tiers: Array<{color,label}> }> }>`。
  - フォールバック規則（panel.js `rowHtml` と一致）：`marker = layer.marker || 'dot'`、`swatchColor = layer.swatchColor || legend[0]?.color || 'var(--cyan)'`、`tiers = Array.isArray(layer.legend) ? layer.legend : []`、`desc = descFor(id) || ''`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/legend-data.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLegendModel } from '../js/lib/legend-data.js';
import { layers as realLayers, descFor } from '../js/layers/registry.js';

const L = (id, label, extra = {}) => ({ id, label, ...extra });
const FULL = [
  L('quakes', '地震', { marker: 'ring', swatchColor: 'rgb(255,176,40)', legend: [{ color: 'a', label: 'M<2' }, { color: 'b', label: 'M2–4' }, { color: 'c', label: 'M4–6' }, { color: 'd', label: 'M6+' }] }),
  L('conflict', '紛争', { marker: 'dot', swatchColor: 'red', legend: [{ color: 'red', label: '紛争報道' }] }),
  L('protests', '抗議', { marker: 'dot', legend: [{ color: 'green', label: '抗議報道' }] }),
  L('news', 'ニュース', { marker: 'dot', legend: [{ color: 'x', label: '政治' }, { color: 'y', label: '災害' }] }),
  L('flights', '航空', { marker: 'triangle', swatchColor: 'cyan', legend: [{ color: 'cyan', label: '進行方向' }] }),
  L('ships', '船舶', { marker: 'diamond', legend: [{ color: 'gold', label: '進行方向' }] }),
  L('trade', '貿易ルート', { legend: [{ color: 'l', label: '主要航路' }, { color: 'm', label: '要衝' }] }),
  L('sst', '水温', { marker: 'gradient', legend: [{ color: 'c1', label: '冷' }, { color: 'c2', label: '中' }, { color: 'c3', label: '暖' }] }),
  L('currents', '海流', { marker: 'line', legend: [{ color: 'd1', label: '冷たい' }, { color: 'd2', label: '中間' }, { color: 'd3', label: '暖かい' }] }),
  L('airtemp', '気温', { marker: 'gradient', legend: [{ color: 'e1', label: '冷' }, { color: 'e2', label: '中' }, { color: 'e3', label: '暖' }] }),
];

test('buildLegendModel: カテゴリ順（出来事→移動→環境）で返す', () => {
  const m = buildLegendModel(FULL);
  assert.deepEqual(m.map((g) => g.id), ['events', 'mobility', 'environment']);
  assert.deepEqual(m[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
});

test('buildLegendModel: tiers は layer.legend と段数一致', () => {
  const m = buildLegendModel(FULL);
  const byId = {};
  m.forEach((g) => g.layers.forEach((l) => { byId[l.id] = l; }));
  assert.equal(byId.quakes.tiers.length, 4);
  assert.equal(byId.trade.tiers.length, 2);
  assert.equal(byId.currents.tiers.length, 3);
  assert.equal(byId.conflict.tiers.length, 1);
});

test('buildLegendModel: marker/swatchColor フォールバック（panel.js と一致）', () => {
  const m = buildLegendModel([L('x', 'X', { legend: [{ color: '#abc', label: 't' }] })]);
  const layer = m[m.length - 1].layers[0]; // 「その他」群
  assert.equal(layer.marker, 'dot');          // marker 既定
  assert.equal(layer.swatchColor, '#abc');    // legend[0].color
  const m2 = buildLegendModel([L('y', 'Y')]); // legend なし
  const l2 = m2[m2.length - 1].layers[0];
  assert.equal(l2.swatchColor, 'var(--cyan)');// 最終フォールバック
  assert.deepEqual(l2.tiers, []);             // legend なし → 空
});

test('buildLegendModel: desc は渡した関数の値', () => {
  const m = buildLegendModel([L('quakes', '地震')], (id) => id === 'quakes' ? '直近の地震' : '');
  assert.equal(m[0].layers[0].desc, '直近の地震');
});

test('buildLegendModel: 空配列 → 空配列', () => {
  assert.deepEqual(buildLegendModel([]), []);
});

test('整合性: registry 実レイヤーで全層が出る／quakes4・trade2・currents3・news>0', () => {
  const m = buildLegendModel(realLayers, descFor);
  const flat = m.flatMap((g) => g.layers);
  assert.equal(flat.length, realLayers.length); // 取りこぼしゼロ
  const byId = Object.fromEntries(flat.map((l) => [l.id, l]));
  assert.equal(byId.quakes.tiers.length, 4);
  assert.equal(byId.trade.tiers.length, 2);
  assert.equal(byId.currents.tiers.length, 3);
  assert.ok(byId.news.tiers.length > 0);
  assert.equal(byId.quakes.marker, 'ring');
});
```

- [ ] **Step 2: テストが落ちるのを確認**

Run: `node --test tests/legend-data.test.js`
Expected: FAIL（`Cannot find module '../js/lib/legend-data.js'`）

- [ ] **Step 3: 実装する**

`js/lib/legend-data.js`：

```javascript
// 凡例データモデル（純データ＋純関数・deck/DOM 非依存）。
// 各レイヤーが既に持つ legend[]/marker/swatchColor と registry の descFor を、
// categories.groupLayers のカテゴリ順に束ねるだけ（新しい分類・色は作らない）。
import { groupLayers } from './categories.js';

// フォールバックは panel.js rowHtml と一致させる（凡例とパネルで同じ見え方）。
export function buildLegendModel(layers, descFor = () => '') {
  return groupLayers(layers).map((g) => ({
    id: g.id,
    label: g.label,
    layers: g.layers.map((l) => ({
      id: l.id,
      label: l.label,
      marker: l.marker || 'dot',
      swatchColor: l.swatchColor || ((l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)'),
      desc: descFor(l.id) || '',
      tiers: Array.isArray(l.legend) ? l.legend : [],
    })),
  }));
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/legend-data.test.js`
Expected: PASS（全6ケース）

- [ ] **Step 5: コミット**

```bash
git add js/lib/legend-data.js tests/legend-data.test.js
git commit -m "feat(legend): buildLegendModel 純データモデル（categories 再利用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 凡例／使い方 HTML ビルダ（純粋）

**Files:**
- Create: `js/ui/legend.js`（このタスクではビルダ関数のみ。`renderLegend`／自己初期化は Task 4 で追加）
- Test: `tests/legend.test.js`

**Interfaces:**
- Consumes: Task 2 の `buildLegendModel` の返り値型（モデル）。
- Produces:
  - `layerBlockHtml(layerModel) -> string`：1レイヤーのブロック（代表 swatch＋名前＋各 tier 行＋説明）。tier の swatch 形は line/gradient のとき `chip`（色が出る塗りチップ）、それ以外は層 marker。
  - `legendHtml(model) -> string`：全カテゴリ（`.layer-cat-head` 見出し＋各レイヤーブロック）。
  - `helpHtml() -> string`：使い方リスト（5項目）。

- [ ] **Step 1: 失敗するテストを書く**

`tests/legend.test.js`：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layerBlockHtml, legendHtml, helpHtml } from '../js/ui/legend.js';

const quake = { id: 'quakes', label: '地震', marker: 'ring', swatchColor: 'rgb(255,176,40)', desc: '直近の地震',
  tiers: [{ color: 'rgb(1,2,3)', label: 'M<2' }, { color: 'rgb(255,60,80)', label: 'M6+' }] };
const currents = { id: 'currents', label: '海流', marker: 'line', swatchColor: 'rgb(120,170,200)', desc: '',
  tiers: [{ color: 'rgb(42,150,255)', label: '冷たい' }, { color: 'rgb(255,90,55)', label: '暖かい' }] };

test('layerBlockHtml: 名前・代表swatch形・各tierの色とラベル', () => {
  const h = layerBlockHtml(quake);
  assert.match(h, /地震/);
  assert.match(h, /swatch-ring/);          // 代表＝層 marker
  assert.match(h, /color:rgb\(1,2,3\)/);   // tier 色
  assert.match(h, /M6\+/);                  // tier ラベル
  assert.match(h, /直近の地震/);            // desc
});

test('layerBlockHtml: line/gradient の tier は chip（色が出る塗り）', () => {
  const h = layerBlockHtml(currents);
  assert.match(h, /swatch-chip/);            // tier は chip
  assert.match(h, /color:rgb\(42,150,255\)/);// 冷たいの色
  assert.match(h, /color:rgb\(255,90,55\)/); // 暖かいの色
});

test('legendHtml: カテゴリ見出し（.layer-cat-head）と全レイヤー名', () => {
  const model = [{ id: 'events', label: '出来事', layers: [quake] },
                 { id: 'environment', label: '環境', layers: [currents] }];
  const h = legendHtml(model);
  assert.match(h, /layer-cat-head/);
  assert.match(h, /出来事/);
  assert.match(h, /環境/);
  assert.match(h, /地震/);
  assert.match(h, /海流/);
});

test('helpHtml: 5つの操作項目を含む', () => {
  const h = helpHtml();
  assert.match(h, /移動/);     // クリックで flyTo
  assert.match(h, /進路/);     // 機体/船クリック
  assert.match(h, /スクロール/);// メディア
  assert.match(h, /プリセット/);// 左パネル
  assert.match(h, /ズーム/);   // ドラッグ/ホイール
  assert.equal((h.match(/<li/g) || []).length, 5);
});
```

- [ ] **Step 2: テストが落ちるのを確認**

Run: `node --test tests/legend.test.js`
Expected: FAIL（`Cannot find module '../js/ui/legend.js'`）

- [ ] **Step 3: 実装する**

`js/ui/legend.js`（ビルダ部のみ。Task 4 で renderLegend と自己初期化を追記）：

```javascript
// 常設「凡例＋使い方」オーバーレイ。各層の legend[]/marker を地表に出す（読む専用）。
// 純粋な HTML ビルダ（node:test 対象）と DOM 配線 renderLegend（e2e 対象）を同居。

const HELP_ITEMS = [
  ['🖱', 'フィード／地図上のイベントをクリック → その地点へ移動'],
  ['🛩', '航空機・船をクリック → 推定進路を表示'],
  ['⏬', '下にスクロール → ライブメディア（ニュース／カメラ）'],
  ['🎛', '左パネル → レイヤーの ON/OFF・プリセット切替'],
  ['🌐', 'ドラッグ／ホイール → 地球を回転・ズーム'],
];

// 1レイヤーのブロック。line/gradient は currentColor を無視する形なので、
// tier は色が出る chip で描く（冷/中/暖の色を見せる）。それ以外は層 marker の形。
export function layerBlockHtml(lm) {
  const tierMarker = (lm.marker === 'line' || lm.marker === 'gradient') ? 'chip' : lm.marker;
  const rows = (lm.tiers || []).map((t) =>
    `<div class="legend-tier"><span class="swatch swatch-${tierMarker}" style="color:${t.color}"></span>`
    + `<span class="legend-tier-label">${t.label}</span></div>`
  ).join('');
  return `<div class="legend-layer">`
    + `<div class="legend-layer-head">`
    + `<span class="swatch swatch-${lm.marker}" style="color:${lm.swatchColor}"></span>`
    + `<span class="legend-layer-name">${lm.label}</span></div>`
    + rows
    + (lm.desc ? `<div class="legend-desc">${lm.desc}</div>` : '')
    + `</div>`;
}

export function legendHtml(model) {
  return model.map((g) =>
    `<div class="legend-cat"><div class="layer-cat-head">${g.label}</div>`
    + g.layers.map(layerBlockHtml).join('')
    + `</div>`
  ).join('');
}

export function helpHtml() {
  return `<ul class="legend-help-list">`
    + HELP_ITEMS.map(([icon, txt]) =>
        `<li><span class="legend-help-icon">${icon}</span><span>${txt}</span></li>`).join('')
    + `</ul>`;
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `node --test tests/legend.test.js`
Expected: PASS（全4ケース）

- [ ] **Step 5: コミット**

```bash
git add js/ui/legend.js tests/legend.test.js
git commit -m "feat(legend): 凡例/使い方 HTML ビルダ（純粋）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: DOM 配線・index.html・CSS（デスクトップ）＋ e2e

**Files:**
- Modify: `js/ui/legend.js`（`renderLegend` ＋自己初期化を追記）
- Modify: `index.html`（`#map-wrap` 内に `#legend` コンテナ＋末尾に script）
- Modify: `css/orbis.css`（**末尾**に「凡例(legend-)」ブロック追記）
- Test: `tests/e2e/legend.spec.js`

**Interfaces:**
- Consumes: Task 3 の `legendHtml`/`helpHtml`、Task 2 の `buildLegendModel`、registry の `layers`/`descFor`。
- Produces: `renderLegend(rootEl, layers, descFor) -> { setOpen(bool), setTab(which) }`。DOM 構造：`#legend.side-panel.legend-panel` > `.panel-head`（h4＋`.legend-collapse`）＋`.legend-tabs`（`.legend-tab[data-tab]`×2）＋`.legend-body[data-body="legend"]`＋`.legend-body[data-body="help"][hidden]`。既定は折りたたみ（`.open` 無し）。

- [ ] **Step 1: 失敗する e2e テストを書く**

`tests/e2e/legend.spec.js`：

```javascript
import { test, expect } from '@playwright/test';

test('凡例：既定折りたたみ→展開でタブ2つ・全段表示・タブ切替', async ({ page }) => {
  await page.goto('/');
  const legend = page.locator('#legend');
  await expect(legend).toBeVisible();
  // 既定は折りたたみ（タブ非表示）
  await expect(page.locator('#legend .legend-tabs')).toBeHidden();
  // 展開
  await page.locator('#legend .legend-collapse').click();
  await expect(page.locator('#legend .legend-tabs')).toBeVisible();
  await expect(page.locator('#legend .legend-tab')).toHaveCount(2);
  // 凡例タブ：全10レイヤーのブロック＋地震は4段
  await expect(page.locator('#legend .legend-body[data-body="legend"] .legend-layer')).toHaveCount(10);
  const quake = page.locator('#legend .legend-layer', { hasText: '地震' });
  await expect(quake.locator('.legend-tier')).toHaveCount(4);
  // 使い方タブへ切替
  await page.locator('#legend .legend-tab[data-tab="help"]').click();
  await expect(page.locator('#legend .legend-help-list li')).toHaveCount(5);
  await expect(page.locator('#legend .legend-body[data-body="legend"]')).toBeHidden();
});

test('?legend=off で凡例を隠す', async ({ page }) => {
  await page.goto('/?legend=off');
  await expect(page.locator('#legend')).toBeHidden();
});
```

- [ ] **Step 2: テストが落ちるのを確認**

Run: `npx playwright test tests/e2e/legend.spec.js`
Expected: FAIL（`#legend` が存在しない）

- [ ] **Step 3a: index.html にコンテナと script を追加**

`index.html` の `#feed` ブロック（`</div>` 終わり・37行目付近）の直後、`<div id="sheet-scrim"></div>` の前に追加：

```html
      <aside id="legend" class="side-panel legend-panel" aria-label="凡例と使い方">
        <div class="panel-head"><h4>凡例 / Legend</h4>
          <button class="collapse-btn legend-collapse" type="button" aria-label="凡例の開閉" aria-expanded="false">▸</button></div>
      </aside>
```

`index.html` 末尾の script 群（`scroll-reveal.js` の行の直後）に追加：

```html
  <script type="module" src="js/ui/legend.js"></script>
```

- [ ] **Step 3b: legend.js に renderLegend と自己初期化を追記**

`js/ui/legend.js` の末尾（`helpHtml` の後）に追加：

```javascript
import { buildLegendModel } from '../lib/legend-data.js';
import { layers, descFor } from '../layers/registry.js';

// #legend を描画し、タブ切替・折りたたみを配線する。状態は DOM クラスだけで持つ。
export function renderLegend(rootEl, layersArg = layers, descForArg = descFor) {
  if (!rootEl) return null;
  const model = buildLegendModel(layersArg, descForArg);
  const head = rootEl.querySelector('.panel-head');
  const collapse = rootEl.querySelector('.legend-collapse');
  rootEl.insertAdjacentHTML('beforeend', `
    <div class="legend-tabs" role="tablist">
      <button class="legend-tab active" type="button" data-tab="legend" role="tab" aria-selected="true">凡例</button>
      <button class="legend-tab" type="button" data-tab="help" role="tab" aria-selected="false">使い方</button>
    </div>
    <div class="legend-body" data-body="legend">${legendHtml(model)}</div>
    <div class="legend-body" data-body="help" hidden>${helpHtml()}</div>`);

  function setOpen(open) {
    rootEl.classList.toggle('open', open);
    if (collapse) { collapse.setAttribute('aria-expanded', String(open)); collapse.textContent = open ? '▾' : '▸'; }
  }
  function setTab(which) {
    rootEl.querySelectorAll('.legend-tab').forEach((b) => {
      const on = b.dataset.tab === which;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on));
    });
    rootEl.querySelectorAll('.legend-body').forEach((bd) => { bd.hidden = bd.dataset.body !== which; });
  }
  if (head) head.addEventListener('click', () => setOpen(!rootEl.classList.contains('open')));
  rootEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.legend-tab');
    if (tab) setTab(tab.dataset.tab);
  });
  setOpen(false); // 既定＝折りたたみ
  return { setOpen, setTab };
}

// 自己初期化（ブラウザのみ。node:test では document が無いので実行されない）。
if (typeof document !== 'undefined' && document.getElementById('legend')) {
  renderLegend(document.getElementById('legend'));
}
```

注：`head` 全体クリックで開閉（折りたたみ時に押しやすい）。展開時の閉じも同 head クリックで効く。`.legend-collapse` は見た目の矢印。

- [ ] **Step 3c: css/orbis.css の末尾に凡例ブロックを追記**

`css/orbis.css` の最終行の後に追加：

```css

/* ===== 常設「凡例＋使い方」オーバーレイ（legend-） ===== */
/* #legend は .side-panel を継承（左上）するので右下へ再配置（.feed-panel と同流儀）。 */
#legend.legend-panel { left: auto; right: 12px; top: auto; bottom: 12px; width: 240px; max-height: 64vh; }
/* 折りたたみ時は見出し（開閉トグル）だけ。展開時にタブと本文を出す。 */
#legend .legend-tabs, #legend .legend-body { display: none; }
#legend:not(.open) { width: auto; }
#legend:not(.open) .panel-head h4 { margin-bottom: 0; }
#legend.open .legend-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 8px; }
#legend.open .legend-body:not([hidden]) { display: block; }
#legend .panel-head { cursor: pointer; }

/* タブ（.preset-chip 言語に合わせたグラス＋ネオン縁） */
#legend .legend-tab { font: inherit; font-size: 11px; line-height: 1; cursor: pointer;
  padding: 4px 11px; border-radius: 999px; color: #cfe6ff;
  border: 1px solid rgba(120,180,255,.25); background: rgba(20,40,70,.4);
  opacity: .6; transition: opacity .15s, border-color .15s; }
#legend .legend-tab:hover { opacity: 1; }
#legend .legend-tab.active { opacity: 1; border-color: var(--cyan); background: rgba(108,204,255,.12);
  box-shadow: 0 0 8px -2px var(--cyan); }

/* カテゴリ／レイヤー／tier */
#legend .legend-cat { margin: 2px 0 10px; }
#legend .legend-layer { margin: 5px 0 9px; }
#legend .legend-layer-head { display: flex; align-items: center; gap: 7px; }
#legend .legend-layer-name { font-size: 11.5px; color: var(--text); }
body.font-on #legend .legend-layer-name { font-family: var(--font-display); letter-spacing: .02em; }
#legend .legend-tier { display: flex; align-items: center; gap: 7px; margin: 3px 0 3px 4px; }
#legend .legend-tier-label { flex: 1; font-size: 11px; color: var(--muted); }
#legend .legend-desc { margin: 3px 0 0 4px; font-size: 10px; line-height: 1.3; color: var(--muted); opacity: .85; }

/* swatch 形（.layer-row 版を #legend 用に再宣言＝mid-file 共有 CSS を書き換えない） */
#legend .swatch { width: 10px; height: 10px; flex: 0 0 auto; color: var(--cyan); }
#legend .swatch-dot { border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; }
#legend .swatch-ring { border-radius: 50%; border: 2px solid currentColor; background: transparent; box-shadow: 0 0 8px currentColor; }
#legend .swatch-triangle { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent;
  border-bottom: 11px solid currentColor; background: transparent; filter: drop-shadow(0 0 4px currentColor); }
#legend .swatch-diamond { width: 9px; height: 9px; background: currentColor; transform: rotate(45deg); box-shadow: 0 0 8px currentColor; }
#legend .swatch-line { width: 14px; height: 3px; border-radius: 2px;
  background: linear-gradient(90deg, rgb(42,127,255), rgb(94,224,106), rgb(255,90,50)); box-shadow: 0 0 6px rgba(120,200,255,.6); }
#legend .swatch-gradient { width: 16px; height: 8px; border-radius: 2px; box-shadow: 0 0 6px rgba(120,200,255,.5);
  background: linear-gradient(90deg, rgb(42,150,255), rgb(30,220,210), rgb(110,230,120), rgb(255,230,90), rgb(255,70,55)); }
/* chip＝line/gradient 層の tier 色を見せる塗りチップ */
#legend .swatch-chip { width: 14px; height: 8px; border-radius: 2px; background: currentColor; box-shadow: 0 0 6px currentColor; }

/* 使い方リスト */
#legend .legend-help-list { list-style: none; margin: 2px 0; padding: 0; }
#legend .legend-help-list li { display: flex; gap: 8px; align-items: flex-start; margin: 7px 0; font-size: 11px; line-height: 1.4; color: var(--text); }
#legend .legend-help-icon { flex: 0 0 auto; }

/* before 比較：?legend=off で隠す */
body.legend-off #legend { display: none; }
```

- [ ] **Step 4: e2e が通るのを確認**

Run: `npx playwright test tests/e2e/legend.spec.js`
Expected: PASS（2 spec）

- [ ] **Step 5: コミット**

```bash
git add js/ui/legend.js index.html css/orbis.css tests/e2e/legend.spec.js
git commit -m "feat(legend): renderLegend DOM 配線・index.html・CSS（デスクトップ）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: モバイル統合（ボトムシート3つ目のタブ）＋ e2e

**Files:**
- Modify: `js/ui/mobile-nav.js`（`sheetPanelId` 追加・`current()` 許容値・`setSheet` の参照解決）
- Modify: `index.html`（`#mobile-tabs` に「凡例」タブ追加）
- Modify: `css/orbis.css`（モバイルシート用の既存セレクタに `#legend` を追記＋tail にモバイル variant）
- Test: `tests/mobile-nav.test.js`（`sheetPanelId` 単体）＋ `tests/e2e/legend.spec.js`（モバイル spec 追記）

**Interfaces:**
- Consumes: 既存 `initMobileNav`／`nextSheet`（汎用・変更不要）。
- Produces: `sheetPanelId(sheet) -> 'panel'|'feed'|'legend'|null`。`current()` が `'legend'` を許容。`body[data-sheet="legend"]` で `#legend` がせり上がる。

- [ ] **Step 1: 失敗するテストを書く（単体）**

`tests/mobile-nav.test.js` の import に `sheetPanelId` を追加し、末尾に追加：

```javascript
test('sheetPanelId: シート名 → パネル要素 id（未知は null）', () => {
  assert.equal(sheetPanelId('layers'), 'panel');
  assert.equal(sheetPanelId('feed'), 'feed');
  assert.equal(sheetPanelId('legend'), 'legend');
  assert.equal(sheetPanelId('zzz'), null);
});
```

import 文を確認し（既存の `mobile-nav.js` からの import に）`sheetPanelId` を加える。例：

```javascript
import { nextSheet, shouldShowMediaHint, sheetPanelId } from '../js/ui/mobile-nav.js';
```

- [ ] **Step 2: テストが落ちるのを確認**

Run: `node --test tests/mobile-nav.test.js`
Expected: FAIL（`sheetPanelId is not a function`）

- [ ] **Step 3a: mobile-nav.js を変更**

`js/ui/mobile-nav.js`：`shouldShowMediaHint` の後（`initMobileNav` の前）に追加：

```javascript
// シート名 → 対応パネル要素 id（DOM 非依存・純粋）。
export function sheetPanelId(sheet) {
  return { layers: 'panel', feed: 'feed', legend: 'legend' }[sheet] || null;
}
```

`initMobileNav` 内の `current` を変更：

```javascript
  const current = () => {
    const v = body.getAttribute('data-sheet');
    return (v === 'layers' || v === 'feed' || v === 'legend') ? v : null;
  };
```

`setSheet` 内のパネル参照を `sheetPanelId` 経由に変更（既存の三項 `next === 'layers' ? 'panel' : 'feed'` を置換）：

```javascript
    if (next) {
      const panelEl = doc.getElementById(sheetPanelId(next));
      const focusable = panelEl && (panelEl.querySelector('input, button, [tabindex]') || panelEl);
      if (focusable && focusable.focus) focusable.focus({ preventScroll: true });
    }
```

- [ ] **Step 3b: index.html に「凡例」タブを追加**

`index.html` の `#mobile-tabs` 内、`data-sheet="feed"` のボタンの直後に追加：

```html
        <button class="mobile-tab" data-sheet="legend" aria-controls="legend" aria-expanded="false">≡ 凡例</button>
```

- [ ] **Step 3c: CSS をモバイル対応に**

`css/orbis.css` の既存モバイルセレクタ3箇所に `#legend` を追記する（追加のみ）：

1. 行 311 `#panel.side-panel, #feed.side-panel {` → `#panel.side-panel, #feed.side-panel, #legend.side-panel {`
2. 行 318 `#panel.side-panel::after, #feed.side-panel::after {` → `#panel.side-panel::after, #feed.side-panel::after, #legend.side-panel::after {`
3. 行 363 `body[data-sheet="layers"] #media-hint, body[data-sheet="feed"] #media-hint { display: none; }` → 末尾に `, body[data-sheet="legend"] #media-hint` を追加

さらに `css/orbis.css` 末尾の凡例ブロックの最後に、モバイル variant を追加：

```css

/* 凡例：モバイルはボトムシート化（panel/feed と同機構） */
@media (max-width: 768px) {
  /* デスクトップ右下指定を解除し、シート機構に委ねる */
  #legend.legend-panel { right: 0; bottom: calc(60px + env(safe-area-inset-bottom)); width: auto; max-height: min(72dvh, 560px); }
  /* モバイルでは常に展開状態で見せる（折りたたみトグルは不要） */
  #legend .legend-tabs { display: flex; }
  #legend .legend-body:not([hidden]) { display: block; }
  #legend .legend-collapse { display: none; }
  /* せり上げ＆ディマー */
  body[data-sheet="legend"] #legend.side-panel { transform: translateY(0); }
  body[data-sheet="legend"] #sheet-scrim { opacity: 1; pointer-events: auto; }
}
```

- [ ] **Step 4a: 単体テストが通るのを確認**

Run: `node --test tests/mobile-nav.test.js`
Expected: PASS

- [ ] **Step 4b: モバイル e2e を追加して確認**

`tests/e2e/legend.spec.js` の末尾に追加：

```javascript
test.describe('モバイル', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('凡例タブでシートを開く', async ({ page }) => {
    await page.goto('/');
    await page.locator('#mobile-tabs .mobile-tab[data-sheet="legend"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-sheet', 'legend');
    await expect(page.locator('#legend')).toBeVisible();
    await expect(page.locator('#legend .legend-help-list, #legend .legend-body[data-body="legend"]')).toBeTruthy();
  });
});
```

Run: `npx playwright test tests/e2e/legend.spec.js`
Expected: PASS（3 spec）

- [ ] **Step 5: コミット**

```bash
git add js/ui/mobile-nav.js index.html css/orbis.css tests/mobile-nav.test.js tests/e2e/legend.spec.js
git commit -m "feat(legend): モバイル ボトムシート3つ目のタブとして凡例を統合

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 全体回帰・SW 確認

**Files:**
- 確認のみ（必要時 `sw.js` の version）

- [ ] **Step 1: 全ユニットテスト**

Run: `npm run test:js`
Expected: PASS（既存＋新規 legend-data/legend/immerse/mobile-nav）

- [ ] **Step 2: 全 e2e（直列・既存に影響が無いこと）**

Run: `npx playwright test`
Expected: PASS（既存 spec＋legend.spec の全件）
注：8000 を他プロセスが掴んでいないこと（mistakes.md：stale server 汚染回避）。掴んでいれば停止してから実行。

- [ ] **Step 3: SW 戦略の確認**

`sw.js` を確認し、`index.html`/`css/orbis.css`/`js/**` が network-first（または非キャッシュ）で配信されるか確認する。
- network-first なら version 上げ不要。
- precache 対象（SHELL）に該当するなら、`sw.js` の CACHE 版を1つ上げる（過去ゾーンの慣例に従う）。
Run（確認）: `grep -nE "CACHE|version|network|precache|SHELL" sw.js | head`

- [ ] **Step 4: localhost 実物確認（手動・記録）**

```bash
npm run serve   # http://localhost:8000
```
ブラウザで確認（オーナー最終確認用の観点）：
- `/`：右下に折りたたみ凡例 → クリックで展開 → 『凡例』/『使い方』タブ切替。
- 凡例：地震4段リング／海流・水温・気温の冷中暖チップ／航空・船の方向記号／ニュースのカテゴリ色が出る。
- `/?legend=off`：凡例が消える（before）。
- モバイル幅（DevTools）：下タブ「≡ 凡例」でシートが開く。
- 設計言語：グラス＋オーロラ上線＋Saira 見出しが他パネルと揃う（GPU 依存は実機でオーナー確認）。

- [ ] **Step 5: コミット（必要時）**

SW 版を上げた場合のみ：

```bash
git add sw.js
git commit -m "chore(legend): SW 版更新（凡例アセット反映）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 統合（実装完了後・別手順）

CLAUDE.md「origin/main 基準・他セッション未 push を温存し ff push」厳守：
1. `ExitWorktree`（action=keep）で main ツリーへ戻る。
2. `git fetch && git merge worktree-legend-help`（css 末尾衝突は両ブロック保持）。
3. `git push`（Vercel Hobby デプロイ上限を確認のうえ）。
4. 本番 curl/Playwright 確認。
5. Obsidian `Projects/orbis-design-supervision.md`＋自動メモリ `project_orbis.md`＋`Projects/orbis-uiux-improvements.md`（P2-1 完了）を更新。

## Self-Review（計画 vs spec）

- **spec §4 アーキ5単位** → Task1(immerse)/Task2(legend-data)/Task3(builders)/Task4(renderLegend+html+css)/Task5(mobile)。✓
- **spec §5 データモデル** → Task2（フォールバック規則・空・legend欠落）。✓
- **spec §6 タブ式・折りたたみ・自己初期化** → Task4。✓
- **spec §7 配置（右下・スクロール）** → Task4 CSS（right/bottom・max-height・overflow は .side-panel 継承）。✓
- **spec §8 ?legend トグル（main.js 非編集）** → Task1＋Task4 CSS `body.legend-off`。✓
- **spec §9 モバイル（#mobile-tabs 3つ目）** → Task5。✓
- **spec §10 堅牢性** → Task2 空/欠落、Task4 自己初期化ガード。✓
- **spec §11 テスト（ユニット＋e2e＋GPUは実機）** → 各タスク＋Task6。✓
- **spec §12 SW** → Task6 Step3。✓
- **spec §13 共有ファイル** → Global Constraints＋統合手順。✓
- **型整合**：`buildLegendModel`（Task2）→ `legendHtml`/`layerBlockHtml`（Task3 が同モデル消費）→ `renderLegend`（Task4 が両方消費）。`sheetPanelId`（Task5）名前一貫。✓
- **placeholder**：TBD/TODO なし。各コード step に実コードあり。✓
