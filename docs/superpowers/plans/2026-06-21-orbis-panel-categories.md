# ORBIS P1-2 レイヤーパネル カテゴリ分類 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** レイヤーパネルの10層を3カテゴリ（出来事/移動/環境）に分類表示し、各層の説明を既定非表示＋ⓘ（desktopホバー/mobileタップ）で出すことで縦長を解消しスキャン性を上げる。

**Architecture:** カテゴリは純データ＋純関数 `js/lib/categories.js`（`presets.js` と同流儀）。`js/ui/panel.js` の `renderPanel` を `groupLayers` で群化描画に改修し、各行に ⓘ ボタンと既定非表示の `.layer-desc` を持たせる。CSS は群見出し・ⓘ・desc 表示制御を追記。プリセット行・main.js・index.html は不変。

**Tech Stack:** Vanilla JS (ESM, no build) / `node --test`（純ロジック）/ Playwright e2e（DOM）/ CSS。

## Global Constraints

- Vanilla JS ESM・ビルド無し。新規 import は相対パスで。
- 単体テスト：`node --test tests/*.test.js`。e2e：`npx playwright test`（baseURL `http://localhost:8000`・`webServer` が自動起動・`reuseExistingServer:true`）。
- コミット author email = noreply（`210495115+sg55555@users.noreply.github.com`・設定済）。各コミット末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- `index.html` / `js/main.js` は変更しない。`renderPanel` のシグネチャ（`root, layers, getEnabled, getCounts, onChange, descFor`）は不変。
- SW は network-first（v36+・fetch成功put/失敗match）。シェル（panel.js/css）変更は次回ロードで反映されるため**版上げ原則不要**。Task 4 で `sw.js` 戦略を確認し、precache 整合上必要な場合のみ `orbis-v39`→`orbis-v40`。
- 美観は既存 `body.ui-a/.ui-b`（リッチ化ゾーン①）の見出し言語に整合。最終色味は localhost 実物確認（GPU/見えは headless 不可）。
- worktree `panel-categories`（base = origin/main 3f143bb・作成済）。

---

### Task 1: カテゴリ純データ＋ groupLayers（`js/lib/categories.js`）

**Files:**
- Create: `js/lib/categories.js`
- Test: `tests/categories.test.js`

**Interfaces:**
- Consumes: `allLayerIds`, `layers` from `js/layers/registry.js`（整合性テスト用）。
- Produces:
  - `CATEGORIES: Array<{id:string, label:string, layerIds:string[]}>`
  - `groupLayers(layers, categories=CATEGORIES) → Array<{id:string, label:string, layers:object[]}>`（カテゴリ順・群内は layerIds 順・空群スキップ・未収載は末尾 `{id:'other',label:'その他'}`）

- [ ] **Step 1: 失敗するテストを書く** — `tests/categories.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, groupLayers } from '../js/lib/categories.js';
import { allLayerIds } from '../js/layers/registry.js';

const fakeLayers = (ids) => ids.map((id) => ({ id, label: id.toUpperCase() }));
const ALL = ['quakes', 'flights', 'conflict', 'protests', 'trade', 'sst', 'currents', 'airtemp', 'ships', 'news'];

test('groupLayers: 3カテゴリを順に返し各群の中身が正しい', () => {
  const groups = groupLayers(fakeLayers(ALL));
  assert.deepEqual(groups.map((g) => g.id), ['events', 'mobility', 'environment']);
  assert.deepEqual(groups[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
  assert.deepEqual(groups[1].layers.map((l) => l.id), ['flights', 'ships', 'trade']);
  assert.deepEqual(groups[2].layers.map((l) => l.id), ['sst', 'currents', 'airtemp']);
});

test('groupLayers: 群内順は CATEGORIES.layerIds の順（入力順に依存しない）', () => {
  const groups = groupLayers(fakeLayers(['news', 'protests', 'conflict', 'quakes']));
  assert.deepEqual(groups[0].layers.map((l) => l.id), ['quakes', 'conflict', 'protests', 'news']);
});

test('groupLayers: 未収載レイヤーは末尾「その他」群', () => {
  const groups = groupLayers(fakeLayers(['quakes', 'zzz']));
  const other = groups[groups.length - 1];
  assert.equal(other.id, 'other');
  assert.equal(other.label, 'その他');
  assert.deepEqual(other.layers.map((l) => l.id), ['zzz']);
});

test('groupLayers: 該当0件のカテゴリはスキップ（空見出しを出さない）', () => {
  const groups = groupLayers(fakeLayers(['quakes']));
  assert.deepEqual(groups.map((g) => g.id), ['events']);
});

test('整合性: registry の全 layer id がちょうど1カテゴリに属す', () => {
  for (const id of allLayerIds()) {
    const hits = CATEGORIES.filter((c) => c.layerIds.includes(id));
    assert.equal(hits.length, 1, `${id} が属すカテゴリ数=${hits.length}`);
  }
});

test('整合性: CATEGORIES の全 layerId が registry に実在', () => {
  const ids = new Set(allLayerIds());
  for (const c of CATEGORIES) for (const id of c.layerIds) assert.ok(ids.has(id), `${c.id}: 未知 ${id}`);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/categories.test.js`
Expected: FAIL（`Cannot find module '../js/lib/categories.js'`）

- [ ] **Step 3: 最小実装** — `js/lib/categories.js`

```js
// レイヤーのカテゴリ分類（純データ＋純関数・deck/DOM 非依存）。
// presets.js と同じ流儀。各 layerId は registry に実在すること（categories.test.js が整合性を検証）。
export const CATEGORIES = [
  { id: 'events',      label: '出来事', layerIds: ['quakes', 'conflict', 'protests', 'news'] },
  { id: 'mobility',    label: '移動',   layerIds: ['flights', 'ships', 'trade'] },
  { id: 'environment', label: '環境',   layerIds: ['sst', 'currents', 'airtemp'] },
];

// layers（registry の layer オブジェクト配列）をカテゴリ順にグループ化して返す（純粋）。
// 群内順は CATEGORIES.layerIds の順。該当0件の群は返さない。
// どのカテゴリにも属さない layer は末尾「その他」群にまとめる（将来レイヤー追加時の取りこぼし防止）。
export function groupLayers(layers, categories = CATEGORIES) {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const used = new Set();
  const out = [];
  for (const c of categories) {
    const ls = c.layerIds.map((id) => byId.get(id)).filter(Boolean);
    ls.forEach((l) => used.add(l.id));
    if (ls.length) out.push({ id: c.id, label: c.label, layers: ls });
  }
  const rest = layers.filter((l) => !used.has(l.id));
  if (rest.length) out.push({ id: 'other', label: 'その他', layers: rest });
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/categories.test.js`
Expected: PASS（6 tests）

- [ ] **Step 5: 全単体テストが緑なことを確認**

Run: `node --test tests/*.test.js`
Expected: 既存全テスト＋categories 6 が PASS（既存は不変）

- [ ] **Step 6: コミット**

```bash
git add js/lib/categories.js tests/categories.test.js
git commit -m "$(printf 'feat: レイヤーカテゴリ純データ categories.js（groupLayers）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: パネルの群化描画＋カテゴリ見出し（`js/ui/panel.js` + CSS + e2e）

**Files:**
- Modify: `js/ui/panel.js`（`renderPanel` を群化・行 HTML を `rowHtml` ヘルパに抽出）
- Modify: `css/orbis.css`（`.layer-cat` / `.layer-cat-head` 追記）
- Create: `tests/e2e/panel-categories.spec.js`（カテゴリ見出しの e2e）

**Interfaces:**
- Consumes: `groupLayers` from `js/lib/categories.js`（Task 1）。
- Produces: `#panel-rows` 内に `.layer-cat[data-cat=<id>]` > `.layer-cat-head` ＋ 既存 `.layer-item` 行。`.layer-row[data-id]` / `.layer-count[data-count]` / `.layer-toggle` のセレクタは不変（既存 e2e 互換）。

- [ ] **Step 1: 失敗する e2e を書く** — `tests/e2e/panel-categories.spec.js`

```js
import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
}

test('レイヤーパネルが3カテゴリ見出しで分類表示される', async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  const heads = await page.$$eval('#panel-rows .layer-cat-head', (els) => els.map((e) => e.textContent.trim()));
  expect(heads).toEqual(['出来事', '移動', '環境']);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="events"] .layer-row[data-id="quakes"]')).toHaveCount(1);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="mobility"] .layer-row[data-id="flights"]')).toHaveCount(1);
  await expect(page.locator('#panel-rows .layer-cat[data-cat="environment"] .layer-row[data-id="sst"]')).toHaveCount(1);
});
```

- [ ] **Step 2: e2e が失敗することを確認**

Run: `npx playwright test tests/e2e/panel-categories.spec.js`
Expected: FAIL（`.layer-cat-head` が0件＝現状はフラットリスト）

- [ ] **Step 3: panel.js を群化に改修**

`js/ui/panel.js` 冒頭の import に追加：

```js
import { groupLayers } from '../lib/categories.js';
```

`renderPanel` の本体先頭（`root.innerHTML = layers.map(...)` のブロック）を次に差し替える。行マークアップは `rowHtml` ヘルパに抽出（Task 3 で ⓘ を足すため）：

```js
export function renderPanel(root, layers, getEnabled, getCounts, onChange, descFor) {
  const groups = groupLayers(layers);
  root.innerHTML = groups.map((g) => `<div class="layer-cat" data-cat="${g.id}">
      <div class="layer-cat-head">${g.label}</div>
      ${g.layers.map((l) => rowHtml(l, descFor)).join('')}
    </div>`).join('');

  syncChecks(root, getEnabled());

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
```

`renderPanel` の直後（`syncChecks` 関数の前）に `rowHtml` を追加（この時点では ⓘ 無し＝現状の行 HTML を関数化しただけ）：

```js
// 1レイヤー行の HTML（Task 3 で ⓘ を追加）。
function rowHtml(l, descFor) {
  const sw = l.swatchColor || ((l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)');
  const marker = l.marker || 'dot'; // dot | ring | triangle
  const desc = descFor ? descFor(l.id) : '';
  return `<div class="layer-item">
      <label class="layer-row" data-id="${l.id}">
        <input type="checkbox" class="layer-toggle" />
        <span class="swatch swatch-${marker}" style="color:${sw}"></span>
        <span class="layer-label">${l.label}</span>
        <span class="layer-count" data-count="${l.id}">–</span>
      </label>
      ${desc ? `<div class="layer-desc">${desc}</div>` : ''}
    </div>`;
}
```

- [ ] **Step 4: カテゴリ見出しの CSS を追記** — `css/orbis.css`

既存の `.layer-item { margin: 4px 0 7px; }`（199行付近）の**直前**に以下を追記：

```css
.layer-cat { margin: 2px 0 9px; }
.layer-cat-head {
  font-size: 9.5px; letter-spacing: .13em; text-transform: uppercase;
  color: var(--muted); opacity: .8; margin: 7px 0 3px 4px;
}
body.ui-a .layer-cat-head, body.ui-b .layer-cat-head {
  color: var(--cyan); opacity: .65; text-shadow: 0 0 6px rgba(57, 208, 255, .25);
}
```

- [ ] **Step 5: e2e が通ることを確認**

Run: `npx playwright test tests/e2e/panel-categories.spec.js`
Expected: PASS（見出し3つ＝出来事/移動/環境・各層が正しい群下）
（FAIL かつ要素0件のときは別 worktree の :8000 サーバを reuse している可能性。`npx playwright test ... --workers=1` で再試行、または専用ポートで隔離。[[orbis-uiux-improvements]] 並行e2e注意）

- [ ] **Step 6: 既存 e2e（presets/smoke）が緑なことを確認（群化でセレクタ非破壊）**

Run: `npx playwright test tests/e2e/presets.spec.js tests/e2e/smoke.spec.js`
Expected: PASS（`#panel-rows .layer-row[data-id]` は群化後も descendant 一致）

- [ ] **Step 7: コミット**

```bash
git add js/ui/panel.js css/orbis.css tests/e2e/panel-categories.spec.js
git commit -m "$(printf 'feat: レイヤーパネルをカテゴリ群化（出来事/移動/環境）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: 説明の ⓘ 開閉（ホバー/タップ）（`js/ui/panel.js` + CSS + e2e）

**Files:**
- Modify: `js/ui/panel.js`（`rowHtml` に ⓘ 追加・`renderPanel` に click ハンドラ追加）
- Modify: `css/orbis.css`（`.layer-desc` 既定非表示＋reveal・`.layer-info`）
- Modify: `tests/e2e/panel-categories.spec.js`（ⓘ トグルの e2e 追加）

**Interfaces:**
- Consumes: Task 2 の `rowHtml` / `renderPanel`。
- Produces: 各行（説明あり層）に `<button class="layer-info" aria-label="説明" aria-expanded>`。クリックで `.layer-item.desc-open` をトグル。`.layer-desc` は既定非表示。ENABLED 状態には影響しない。

- [ ] **Step 1: 失敗する e2e を追記** — `tests/e2e/panel-categories.spec.js` の末尾に追加

```js
test('ⓘ クリックで説明が開閉し、チェック状態は変わらない', async ({ page }) => {
  test.setTimeout(60000);
  await ready(page);
  const item = page.locator('#panel-rows .layer-item:has(.layer-row[data-id="quakes"])');
  const checkbox = page.locator('#panel-rows .layer-row[data-id="quakes"] .layer-toggle');
  const before = await checkbox.isChecked();
  await expect(item).not.toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeHidden();
  await item.locator('.layer-info').click();
  await expect(item).toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeVisible();
  expect(await checkbox.isChecked()).toBe(before); // ⓘ がチェックを誤トグルしない
  await item.locator('.layer-info').click();
  await expect(item).not.toHaveClass(/desc-open/);
  await expect(item.locator('.layer-desc')).toBeHidden();
});
```

- [ ] **Step 2: e2e が失敗することを確認**

Run: `npx playwright test tests/e2e/panel-categories.spec.js -g "ⓘ"`
Expected: FAIL（`.layer-info` が存在しない／`.layer-desc` が常時表示）

- [ ] **Step 3: rowHtml に ⓘ を追加** — `js/ui/panel.js` の `rowHtml` を差し替え

```js
// 1レイヤー行の HTML（説明あり層は ⓘ で開閉）。
function rowHtml(l, descFor) {
  const sw = l.swatchColor || ((l.legend && l.legend[0]) ? l.legend[0].color : 'var(--cyan)');
  const marker = l.marker || 'dot'; // dot | ring | triangle
  const desc = descFor ? descFor(l.id) : '';
  return `<div class="layer-item">
      <label class="layer-row" data-id="${l.id}">
        <input type="checkbox" class="layer-toggle" />
        <span class="swatch swatch-${marker}" style="color:${sw}"></span>
        <span class="layer-label">${l.label}</span>
        <span class="layer-count" data-count="${l.id}">–</span>
        ${desc ? `<button type="button" class="layer-info" aria-label="説明" aria-expanded="false">ⓘ</button>` : ''}
      </label>
      ${desc ? `<div class="layer-desc">${desc}</div>` : ''}
    </div>`;
}
```

- [ ] **Step 4: ⓘ クリックハンドラを追加** — `renderPanel` 内の `root.addEventListener('change', ...)` ブロックの直後に追記

```js
  // ⓘ：説明の開閉（タッチで確実）。<label> 内なので既定動作とバブリングを止めてチェック誤作動を防ぐ。
  root.addEventListener('click', (e) => {
    const info = e.target.closest('.layer-info');
    if (!info) return;
    e.preventDefault();
    e.stopPropagation();
    const item = info.closest('.layer-item');
    const open = item.classList.toggle('desc-open');
    info.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
```

- [ ] **Step 5: CSS を追記/修正** — `css/orbis.css`

既存の `.layer-desc { margin: 1px 0 0 24px; font-size: 10px; line-height: 1.3; color: var(--muted); }`（199行付近）に `display: none;` を加え、直後に reveal ルールと `.layer-info` を追記：

```css
.layer-desc { margin: 1px 0 0 24px; font-size: 10px; line-height: 1.3; color: var(--muted); display: none; }
.layer-item.desc-open .layer-desc { display: block; }
@media (hover: hover) {
  .layer-item:hover .layer-desc { display: block; } /* desktop はホバーで一時表示 */
}
.layer-info {
  margin-left: 4px; padding: 0; border: 0; background: none; cursor: pointer;
  color: var(--muted); opacity: .55; font-size: 11px; line-height: 1; flex: 0 0 auto;
}
.layer-info:hover { opacity: 1; color: var(--cyan); text-shadow: 0 0 6px var(--cyan); }
```

- [ ] **Step 6: ⓘ e2e が通ることを確認**

Run: `npx playwright test tests/e2e/panel-categories.spec.js`
Expected: PASS（見出し＋ⓘトグル両方）

- [ ] **Step 7: コミット**

```bash
git add js/ui/panel.js css/orbis.css tests/e2e/panel-categories.spec.js
git commit -m "$(printf 'feat: レイヤー説明を ⓘ ホバー/タップ開閉に（既定非表示で縦長解消）\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: 全体検証・SW確認・localhost 実物確認

**Files:**
- Modify（必要時のみ）: `sw.js`（precache 整合上 bump が要る場合のみ `orbis-v39`→`orbis-v40`）

**Interfaces:**
- Consumes: Task 1-3 の成果物。
- Produces: 全単体＋e2e 緑・実物サニティ済の統合可能ブランチ。

- [ ] **Step 1: 全単体テスト緑**

Run: `node --test tests/*.test.js`
Expected: PASS（categories 6 を含む全件）

- [ ] **Step 2: 全 e2e 緑**

Run: `npx playwright test`
Expected: PASS（panel-categories 2 件＋既存全件）
（落ちる場合はまず別 worktree の :8000 reuse を疑い、専用ポート＋`reuseExistingServer:false` で隔離再現してから真の回帰か判定。[[orbis-uiux-improvements]]）

- [ ] **Step 3: SW 戦略を確認し版上げ要否を決める**

Run: `grep -n "fetch\|CACHE\|network" sw.js | head`
判断：network-first（fetch成功→put / 失敗→cache）なら panel.js/css 変更は次回ロードで反映＝**版上げ不要**。precache リスト整合で必要な場合のみ `const CACHE = 'orbis-v39'` を `'orbis-v40'` にして `git commit`。

- [ ] **Step 4: localhost 実物確認**

```bash
python3 -m http.server 8000   # 別ターミナル。確認後 Ctrl-C
```
ブラウザ `http://localhost:8000/` で目視（headless 不可の見え）：
- パネルに「出来事 / 移動 / 環境」見出し・各層が正しい群下。
- desktop：行ホバーで説明が出る。ⓘ クリックで開閉（クリックでピン留め）。チェックは誤作動しない。
- mobile（DevTools デバイス or 実機・bottom sheet `≡ レイヤー`）：ⓘ タップで説明開閉。
- 既存プリセット chip 行が見出し群の上に従来どおり。`?ui=a` で見出しのシアン差し色が馴染むか。
（色味・余白が要調整なら CSS を微修正して再確認→該当 Task のコミットに amend せず追加コミット）

- [ ] **Step 5: 最終状態を確認（worktree クリーン・コミット履歴）**

Run: `git status --short && git log --oneline origin/main..HEAD`
Expected: クリーン・spec/categories/panel群化/ⓘ の各コミットが並ぶ。

---

## Self-Review

**1. Spec coverage:**
- カテゴリ3群（出来事/移動/環境）→ Task 1（CATEGORIES）＋Task 2（描画）。✓
- 説明 ⓘ ホバー/タップ・既定非表示 → Task 3。✓
- プリセット行維持・index.html/main.js 不変 → Global Constraints＋Task 2（renderPanel シグネチャ不変）。✓
- categories.js 純データ＋groupLayers → Task 1。✓
- テスト：groupLayers＋整合性 → Task 1（6テスト）。見出し/ⓘ e2e → Task 2/3。既存緑維持 → Task 2 Step6・Task 4 Step2。✓
- SW network-first 版上げ要否 → Task 4 Step3。✓
- 未分類フォールバック「その他」→ Task 1（groupLayers＋テスト）。✓
- ⓘ のチェック誤作動防止 → Task 3（preventDefault/stopPropagation＋e2e で before/after 一致）。✓
- モバイル hover 残留防止 → Task 3（`@media (hover:hover)`）。✓

**2. Placeholder scan:** TBD/TODO 無し。各コード手順に完全なコードを記載。✓

**3. Type consistency:** `groupLayers`/`CATEGORIES`/`rowHtml`/`.layer-cat`/`.layer-cat-head`/`.layer-info`/`.desc-open`/`.layer-desc` を全タスクで同名使用。`renderPanel` シグネチャ不変。e2e セレクタ（`#panel-rows .layer-cat[data-cat]`・`.layer-row[data-id]`・`.layer-info`・`.desc-open`）は実装と一致。✓
