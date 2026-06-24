# Orbis モバイル操作UIシェルのリッチ化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モバイル(≤768px)の操作UIシェル（下端タブバー＋ボトムシート＋ディマー）を、宇宙的トーンで上品な「一体の観測コンソール」にリッチ化する。

**Architecture:** 既存 `?param` ダイヤル規約に新キー `?mui=a|b|off` を1つ追加（`immerse.js` の純粋関数＋`immerseClasses` が body に `mui-*` を常時付与）。見た目は全て `css/orbis.css` 末尾の新ブロックに `@media(max-width:768px)` 内 `body.mui-a/b` スコープで追記し、既存レイアウト機構には触れない。タブアイコンのみ `index.html` に inline SVG を足す（off は ≡ フォールバック）。

**Tech Stack:** Vanilla JS (ESM)・CSS・node:test（純粋関数の単体）・Playwright（モバイル viewport の e2e）。

## Global Constraints

- 対象は **`@media (max-width: 768px)` のみ**。デスクトップ(>768px)の挙動は不変。
- 設計言語：**線/光・グラス**。**面装飾（radial-gradient の"面"）禁止**（グラス越しに四角く滲む＝star/space 面廃止と同根）。サイバーパンクHUD（脈動/グリッチ/スキャンライン）禁止。発光は**抑制的**で globe 主役を邪魔しない。
- **非編集ファイル**：`js/main.js` / `js/ui/mobile-nav.js` / `js/ui/feed.js` / `js/ui/legend.js` / `js/ui/panel.js`（DOM配線・データ・行生成は不変。見た目のみ CSS＋タブアイコン markup）。
- CSS は `css/orbis.css` **末尾**に「モバイル操作シェル(mui-)」ブロックを追記。**既存 `@media(max-width:768px)` レイアウトquery は不変**（上乗せのみ）。css 末尾は複数スレッドが追記し衝突しがち→マージ時は両ブロック保持。
- `?mui=a|b|off`（大小無視・既定 `a`）。`a`=上品(採用候補)／`b`=もう一段攻め(比較用)／`off`=before(`≡`)。
- 色トークン（`:root`）：`--cyan:#39d0ff` / `--glass-bg:rgba(10,18,32,0.55)` / `--glass-rim:rgba(90,200,255,0.22)` / `--font-display:'Saira'`。
- オーロラ言語（既存 sec-h と統一・verbatim）：下線 `border-bottom:1px solid rgba(57,208,255,.18); box-shadow:0 1px 0 rgba(57,208,255,.08)`／区切りグラデ `linear-gradient(90deg, transparent, rgba(57,208,255,.5), rgba(138,92,246,.4), transparent); box-shadow:0 0 14px rgba(57,208,255,.22)`。
- `immerseClasses` の現配列順は `seam,(mbg-deep),(glass-),mp,ui,font,sec,legend,search,feed,space`。**`mui-` は末尾に追加**。
- DOM 事実：3シートとも見出しは `.side-panel .panel-head > h4`。リスト行は `#panel` が `.layer-row`、`#feed` が `.feed-row`。タブは `#mobile-tabs > button.mobile-tab[data-sheet="layers|feed|legend"]`。

---

## File Structure

- **Modify** `js/lib/immerse.js` — `immerseMobileUi()` 追加＋`immerseClasses` に `mui-` push。
- **Modify** `tests/immerse.test.js` — `immerseMobileUi`／`immerseClasses` の mui- 検証。
- **Modify** `index.html` — `#mobile-tabs` の3タブに inline SVG アイコン追加（`≡ ` テキストは除去）。
- **Modify** `css/orbis.css` — 末尾に「モバイル操作シェル(mui-)」ブロック（Task 2〜5 で段階構築）。
- **Create** `tests/e2e/mobile-shell.spec.js` — モバイル viewport で mui-a クラス・アイコン・off フォールバック・見出し下線を検証（data 非依存）。

---

### Task 1: `immerseMobileUi` 関数と `immerseClasses` 配線

**Files:**
- Modify: `js/lib/immerse.js`（`immerseSpace` の後、`immerseClasses` の前あたりに関数追加／`immerseClasses` 内 `space-` push の後に1行）
- Modify: `tests/immerse.test.js`（import 行に `immerseMobileUi` 追加／既定配列テストに `mui-a` 追加／新規 test 2件）

**Interfaces:**
- Produces: `immerseMobileUi(search: string) => 'a'|'b'|'off'`（既定 `'a'`）。`immerseClasses(search)` の返す配列末尾に `'mui-' + immerseMobileUi(search)`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/immerse.test.js` の import に `immerseMobileUi` を追加（既存 import 文の関数リストに加える）。既定配列テスト（93-94行付近）の期待値末尾に `'mui-a'` を追加し、さらに末尾へ新規テストを追記:

```javascript
test('immerseMobileUi: 既定 a・?mui=b|off で上書き（無効も既定a・大小無視）', () => {
  assert.equal(immerseMobileUi(''), 'a');
  assert.equal(immerseMobileUi('?mui=b'), 'b');
  assert.equal(immerseMobileUi('?mui=off'), 'off');
  assert.equal(immerseMobileUi('?mui=OFF'), 'off');
  assert.equal(immerseMobileUi('?mui=x'), 'a'); // 無効は既定
});

test('immerseClasses: mui- を末尾に常時付与（既定 mui-a、?mui=off で mui-off）', () => {
  assert.ok(immerseClasses('').includes('mui-a'));
  assert.ok(immerseClasses('?mui=off').includes('mui-off'));
  assert.ok(immerseClasses('?mui=b').includes('mui-b'));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/immerse.test.js`
Expected: FAIL（`immerseMobileUi is not a function` ＋既定配列テストが `mui-a` 不在で不一致）

- [ ] **Step 3: 最小実装**

`js/lib/immerse.js` の `immerseSpace`（110行付近）の直後に追加:

```javascript
// ?mui=a|b|off（大小無視）。モバイル(≤768px)の操作UIシェル（下端タブバー＋ボトムシート＋ディマー）の
// リッチ化。a=上品(採用候補・既定)／b=もう一段攻め(比較用)／off=before(base のまま・タブは ≡)。
export function immerseMobileUi(search) {
  const m = /[?&]mui=(a|b|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'a';
}
```

`immerseClasses` 内の `out.push('space-' + immerseSpace(search));` の直後に1行追加:

```javascript
  out.push('mui-' + immerseMobileUi(search));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/immerse.test.js`
Expected: PASS（全 test green・既定配列末尾に `mui-a`）

- [ ] **Step 5: コミット**

```bash
git add js/lib/immerse.js tests/immerse.test.js
git commit -m "feat(mobile): ?mui=a|b|off を immerse に追加（操作UIシェル）"
```

---

### Task 2: タブアイコン（線画SVG）＋ off フォールバック＋ e2e 骨組み

**Files:**
- Modify: `index.html`（44-46行の3タブ：`≡ ラベル` → `<svg class="tab-svg">…</svg>ラベル`）
- Modify: `css/orbis.css`（末尾に mui- ブロックを新設＝アイコン出し分けのみ）
- Create: `tests/e2e/mobile-shell.spec.js`

**Interfaces:**
- Consumes: Task 1 の `body.mui-a/b/off` クラス。
- Produces: `.mobile-tab > svg.tab-svg`（3タブ）＋ `body.mui-off .mobile-tab::before { content:'≡' }`。

- [ ] **Step 1: 失敗する e2e テストを作成**

`tests/e2e/mobile-shell.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function ready(page) {
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });
}

test('mui-a: タブに線画SVGアイコンが出る・body に mui-a', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await ready(page);
  await expect(page.locator('body')).toHaveClass(/mui-a/);
  // 3タブそれぞれに表示中の svg.tab-svg
  for (const s of ['layers', 'feed', 'legend']) {
    await expect(page.locator(`.mobile-tab[data-sheet="${s}"] svg.tab-svg`)).toBeVisible();
  }
});

test('mui-off: SVGは隠れ ≡ フォールバック（before）', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/?mui=off');
  await ready(page);
  await expect(page.locator('body')).toHaveClass(/mui-off/);
  await expect(page.locator('.mobile-tab[data-sheet="layers"] svg.tab-svg')).toBeHidden();
  const before = await page.locator('.mobile-tab[data-sheet="layers"]').evaluate(
    (el) => getComputedStyle(el, '::before').content
  );
  expect(before).toContain('≡');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js`
Expected: FAIL（svg.tab-svg 不在 / mui クラス未付与）

- [ ] **Step 3: index.html のタブに SVG を追加**

`index.html` 44-46行を置換（`≡ ` を除去し、先頭に inline SVG。`stroke="currentColor"` で色は CSS の `color` に連動）:

```html
        <button class="mobile-tab" data-sheet="layers" aria-controls="panel" aria-expanded="false"><svg class="tab-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 3 21 8 12 13 3 8"/><polyline points="3 12 12 17 21 12"/><polyline points="3 16 12 21 21 16"/></svg>レイヤー</button>
        <button class="mobile-tab" data-sheet="feed" aria-controls="feed" aria-expanded="false"><svg class="tab-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 14 8 14 11 6 14 18 17 11 21 11"/></svg>フィード</button>
        <button class="mobile-tab" data-sheet="legend" aria-controls="legend" aria-expanded="false"><svg class="tab-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="7" r="2"/><line x1="10" y1="7" x2="20" y2="7"/><polygon points="5 14 8 19 2 19"/><line x1="11" y1="17" x2="20" y2="17"/></svg>凡例</button>
```

- [ ] **Step 4: css/orbis.css 末尾に mui- ブロックを新設（アイコン出し分け）**

ファイル末尾（フィード可読性ブロックの後）に追記:

```css
/* ===== モバイル操作UIシェル（mui-・?mui=a|b|off 既定a） =====
   下端タブバー＋ボトムシート＋ディマーを「一体の観測コンソール」に（宇宙的トーンで上品）。
   設計言語＝線/光・グラス・面装飾なし・抑制的発光。globe主役を邪魔しない。
   既存 @media(max-width:768px) のレイアウト機構(303-368/674/782/840)は不変＝視覚の上乗せのみ。
   off=before（base のまま・タブは ≡）／a=上品(採用候補)／b=もう一段攻め(比較用)。 */
@media (max-width: 768px) {
  /* アイコン出し分け：既定は隠し a/b で表示。off は擬似要素で ≡（before） */
  .mobile-tab .tab-svg { display: none; width: 16px; height: 16px; flex: 0 0 auto; }
  body.mui-a .mobile-tab .tab-svg,
  body.mui-b .mobile-tab .tab-svg { display: inline-flex; color: var(--cyan); opacity: .6; }
  body.mui-off .mobile-tab::before { content: '≡'; margin-right: 6px; opacity: .8; }
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js`
Expected: PASS（mui-a で svg 表示・mui-off で svg 非表示＋≡）

- [ ] **Step 6: コミット**

```bash
git add index.html css/orbis.css tests/e2e/mobile-shell.spec.js
git commit -m "feat(mobile): タブ線画SVGアイコン＋off=≡フォールバック（mui-）"
```

---

### Task 3: 下端タブバーの発光（上端ライン・アクティブ下線グロー・タイポ）

**Files:**
- Modify: `css/orbis.css`（mui- ブロックの `@media(max-width:768px)` 内に追記）
- Modify: `tests/e2e/mobile-shell.spec.js`（アクティブタブの下線擬似要素の存在を1件追加）

**Interfaces:**
- Consumes: `body.mui-a/b`・`.mobile-tab[aria-expanded="true"]`（mobile-nav.js が付与・既存）。

- [ ] **Step 1: e2e に検証を1件追加**

`tests/e2e/mobile-shell.spec.js` 末尾に追記:

```javascript
test('mui-a: タブバー上端にハイライトライン・アクティブで下線グロー', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await ready(page);
  // バー上端ライン（::before）が描画されている
  const barLine = await page.locator('#mobile-tabs').evaluate(
    (el) => getComputedStyle(el, '::before').content
  );
  expect(barLine).not.toBe('none'); // content:'' は '""' を返す＝存在
  // アクティブタブの下線（::after）
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  const underline = await page.locator('.mobile-tab[data-sheet="layers"]').evaluate(
    (el) => getComputedStyle(el, '::after').content
  );
  expect(underline).not.toBe('none');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js -g "ハイライトライン"`
Expected: FAIL（::before/::after が none）

- [ ] **Step 3: CSS 追記（mui- ブロックの `@media` 内、アイコン規則の後）**

```css
  /* A. タブバー：上端オーロラハイライトライン＋グラス精緻化＋タイポ */
  body.mui-a #mobile-tabs::before,
  body.mui-b #mobile-tabs::before {
    content: ''; position: absolute; top: 0; left: 10px; right: 10px; height: 1px; pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(57,208,255,.5), rgba(138,92,246,.4), transparent);
    box-shadow: 0 0 14px rgba(57,208,255,.22);
  }
  body.mui-a .mobile-tab, body.mui-b .mobile-tab { position: relative; gap: 7px; }
  body.font-on.mui-a .mobile-tab,
  body.font-on.mui-b .mobile-tab { font-family: var(--font-display); letter-spacing: .03em; }
  /* アクティブ：縁＋アイコン発光（抑制的）＋オーロラ下線 */
  body.mui-a .mobile-tab[aria-expanded="true"],
  body.mui-b .mobile-tab[aria-expanded="true"] {
    border-color: var(--cyan); color: var(--cyan);
    box-shadow: 0 0 12px -2px rgba(57,208,255,.5), inset 0 0 8px -4px rgba(57,208,255,.4);
  }
  body.mui-a .mobile-tab[aria-expanded="true"] .tab-svg,
  body.mui-b .mobile-tab[aria-expanded="true"] .tab-svg {
    opacity: 1; filter: drop-shadow(0 0 5px rgba(57,208,255,.6));
  }
  body.mui-a .mobile-tab[aria-expanded="true"]::after,
  body.mui-b .mobile-tab[aria-expanded="true"]::after {
    content: ''; position: absolute; left: 12px; right: 12px; bottom: 5px; height: 1px; pointer-events: none;
    background: linear-gradient(90deg, transparent, var(--cyan), transparent);
    box-shadow: 0 0 8px rgba(57,208,255,.5);
  }
```

注：数値（glow 半径・opacity）は採用前提の初期値。最終は Task 6 の `?mui=a|b` 実物比較で微調整。

- [ ] **Step 4: テストが通ることを確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add css/orbis.css tests/e2e/mobile-shell.spec.js
git commit -m "feat(mobile): タブバー発光（上端ライン・アクティブ下線グロー）"
```

---

### Task 4: ボトムシートの仕上げ（ハンドル発光・見出しオーロラ下線・上縁光ライン・リスト余白）

**Files:**
- Modify: `css/orbis.css`（mui- ブロック内に追記）
- Modify: `tests/e2e/mobile-shell.spec.js`（シート見出しの下線を1件追加）

**Interfaces:**
- Consumes: `body.mui-a/b`・`.side-panel .panel-head h4`（3シート共通）・`.side-panel::after`（既存ハンドル）・`.layer-row`/`.feed-row`。

- [ ] **Step 1: e2e に検証を1件追加**

```javascript
test('mui-a: シート見出しにオーロラ下線', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await ready(page);
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  const bb = await page.locator('#panel .panel-head h4').evaluate(
    (el) => getComputedStyle(el).borderBottomWidth
  );
  expect(bb).toBe('1px');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js -g "オーロラ下線"`
Expected: FAIL（borderBottomWidth が 0px）

- [ ] **Step 3: CSS 追記（mui- ブロック内）**

```css
  /* C. ボトムシート：上縁光ライン＋ハンドル発光＋見出しオーロラ下線＋リスト余白 */
  body.mui-a #panel.side-panel, body.mui-a #feed.side-panel, body.mui-a #legend.side-panel,
  body.mui-b #panel.side-panel, body.mui-b #feed.side-panel, body.mui-b #legend.side-panel {
    border-top: 1px solid rgba(57,208,255,.28);
    box-shadow: 0 -8px 30px rgba(0,0,0,.45), 0 -1px 0 rgba(57,208,255,.18);
  }
  /* ハンドル（既存 ::after を発光に） */
  body.mui-a #panel.side-panel::after, body.mui-a #feed.side-panel::after, body.mui-a #legend.side-panel::after,
  body.mui-b #panel.side-panel::after, body.mui-b #feed.side-panel::after, body.mui-b #legend.side-panel::after {
    background: var(--cyan); opacity: .7; box-shadow: 0 0 8px rgba(57,208,255,.5);
  }
  /* 見出し：オーロラ下線＋glow（font-on で Saira） */
  body.mui-a .side-panel .panel-head h4,
  body.mui-b .side-panel .panel-head h4 {
    padding-bottom: 8px; border-bottom: 1px solid rgba(57,208,255,.18);
    box-shadow: 0 1px 0 rgba(57,208,255,.08); text-shadow: 0 0 14px rgba(57,208,255,.25);
  }
  body.font-on.mui-a .side-panel .panel-head h4,
  body.font-on.mui-b .side-panel .panel-head h4 { font-family: var(--font-display); letter-spacing: .03em; }
  /* リスト：タッチ余白（密度は崩さない＝行高の最小確保のみ） */
  body.mui-a #panel .layer-row, body.mui-b #panel .layer-row { min-height: 38px; }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx playwright test tests/e2e/mobile-shell.spec.js`
Expected: PASS（全件）

- [ ] **Step 5: コミット**

```bash
git add css/orbis.css tests/e2e/mobile-shell.spec.js
git commit -m "feat(mobile): シート仕上げ（上縁光・ハンドル発光・見出し下線・リスト余白）"
```

---

### Task 5: ディマー幕の強化＋ mui-b 強度バリアント

**Files:**
- Modify: `css/orbis.css`（mui- ブロック内に追記）

**Interfaces:**
- Consumes: `body[data-sheet="layers|feed|legend"]`（mobile-nav.js が付与・既存）・`#sheet-scrim`。

- [ ] **Step 1: CSS 追記（mui- ブロック内・面は使わず単色＋blur のみ）**

```css
  /* D. ディマー幕：暗度＋blur 強化（vignette等の面は入れない＝グラス越しの四角い滲み回避） */
  body.mui-a #sheet-scrim, body.mui-b #sheet-scrim {
    -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
  }
  body[data-sheet="layers"].mui-a #sheet-scrim, body[data-sheet="feed"].mui-a #sheet-scrim, body[data-sheet="legend"].mui-a #sheet-scrim,
  body[data-sheet="layers"].mui-b #sheet-scrim, body[data-sheet="feed"].mui-b #sheet-scrim, body[data-sheet="legend"].mui-b #sheet-scrim {
    background: rgba(3,6,12,.58);
  }

  /* mui-b：もう一段攻め（発光半径・stroke を強める・比較用） */
  body.mui-b .mobile-tab .tab-svg { opacity: .72; }
  body.mui-b .mobile-tab[aria-expanded="true"] {
    box-shadow: 0 0 18px -1px rgba(57,208,255,.6), inset 0 0 10px -3px rgba(57,208,255,.5);
  }
  body.mui-b #panel.side-panel, body.mui-b #feed.side-panel, body.mui-b #legend.side-panel {
    border-top-color: rgba(57,208,255,.42);
    box-shadow: 0 -8px 34px rgba(0,0,0,.5), 0 -1px 0 rgba(57,208,255,.30);
  }
```

- [ ] **Step 2: 全テスト（単体＋e2e）が緑であることを確認**

Run: `node --test tests/immerse.test.js && npx playwright test tests/e2e/mobile-shell.spec.js`
Expected: PASS（単体22+件・e2e 4件）。回帰確認: `npx playwright test tests/e2e/mobile-nav.spec.js`（既存機構が壊れていない）

- [ ] **Step 3: コミット**

```bash
git add css/orbis.css
git commit -m "feat(mobile): ディマー強化（面なし）＋mui-b 強度バリアント"
```

---

### Task 6: 実物比較スクショ（a/b/off）＋実機確認依頼

**Files:**
- 変更なし（検証のみ）

- [ ] **Step 1: ローカルサーバ起動**

Run: `python -m http.server 8000`（バックグラウンド）

- [ ] **Step 2: a/b/off のモバイルスクショを撮る**

`/tmp/orbis-mui-shot.js`（Task 開始時の `node_modules` 解決のため `NODE_PATH` 指定で実行）で、`http://localhost:8000/?mui=a`／`?mui=b`／`?mui=off` をそれぞれ viewport 390×844 で開き、初期＋layers シート開＋feed シート開のスクショを `/tmp/orbis-mui-{a,b,off}-{initial,layers,feed}.png` に保存。

Run: `NODE_PATH=$(pwd)/node_modules node /tmp/orbis-mui-shot.js`
Expected: 9枚出力。Read で目視（線/光が揃い面の滲みが無いか・off が before と一致か・b が攻め過ぎでないか）。

- [ ] **Step 3: オーナーへ実機確認を依頼**

`?mui=a` `?mui=b` `?mui=off` を**実機スマホ**で比較してもらい（GPU依存の blur/glow は headless と乖離）、採用値（a か b か、微調整指示）を確定。AskUserQuestion で確認。

- [ ] **Step 4: （採用確定後）所有ノート・記憶を更新**

`Obsidian Projects/orbis-design-supervision.md` に状態（mui-・採用値・touchpoints・?param）を追記。`MEMORY.md` のデザイン監修行を更新。自動メモリ `project_orbis.md` に節追加。`mistakes.md` 追記は3条件該当時のみ（例：main ツリーが origin/main より古かった件＝worktree fresh が最新、は学びになり得る）。

---

## Self-Review

**1. Spec coverage:**
- A タブバー（アイコン刷新=Task2／上端ライン・アクティブ下線グロー・グラス・タイポ=Task3）✓
- B シート（上縁光ライン・ハンドル発光・見出しオーロラ下線+Saira・リスト余白=Task4）✓
- C ディマー（暗度+blur・面なし=Task5）✓
- アーキ（?mui=a|b|off・immerseClasses 配線=Task1）✓
- off=before(≡)（Task2）✓ ／ mui-b 比較用（Task5）✓
- テスト（immerse.test=Task1／e2e=Task2-4）✓ ／ 検証（実物+実機=Task6）✓
- 非ゴール（globe初期/縦セクション/タイポ体系化/デスクトップ/HUD）に触れるタスク無し ✓

**2. Placeholder scan:** TBD/TODO 無し。CSS は全て実値。リスト行・見出しは実 markup（`.layer-row`/`.panel-head h4`）で確定済み。「実物比較で微調整」は値の最終調整であり実装すべきコードは全て記載済み。

**3. Type consistency:** `immerseMobileUi` の戻り値 `'a'|'b'|'off'`／クラス `mui-a|mui-b|mui-off` が Task1〜5 で一貫。セレクタ `.tab-svg`／`.side-panel .panel-head h4`／`.mobile-tab[aria-expanded="true"]` が全タスクで一致。e2e の `ready(page)` ヘルパは spec 内で定義し全 test で共有。
