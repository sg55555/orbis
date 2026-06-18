# ORBIS モバイル UX 是正（ボトムシート）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スマホ幅で地球儀を全画面の主役にし、LAYERS/FEED をボトムシートで出す（globe を覆わない）＋下部メディアへの導線を追加する。

**Architecture:** 新規の独立モジュール `js/ui/mobile-nav.js` を `index.html` の独自 `<script type="module">` で読み込み、DOM のクラス/属性操作だけで開閉する。`main.js`・`registry.js` は一切編集しない（別セッションと非衝突）。挙動は `@media (max-width:768px)` で発火し、デスクトップ（>768px）は完全に不変。

**Tech Stack:** Vanilla JS (ESM, no build) / CSS（メディアクエリ・`dvh`・`env(safe-area-inset-*)`）/ node:test（純粋関数）/ Playwright（モバイルエミュ e2e）。

## Global Constraints

- ブレークポイント＝`@media (max-width: 768px)`。`>768px` はデスクトップ既存挙動を維持（不変）。
- SW：`index.html`・`css/orbis.css` は SHELL キャッシュ対象 → `sw.js` の `CACHE` を `orbis-v29` → `orbis-v30` にバンプ（本プランの最後）。
- **編集してよいファイルは `index.html` / `css/orbis.css` / `js/ui/mobile-nav.js`（新規）/ `sw.js` / `tests/` のみ。** `js/main.js`・`js/layers/registry.js`・`js/ui/{panel,feed,media}.js`・`collectors/*`・`collect.yml` は触らない。
- git：`git add` は**明示パスのみ**（`-A`/`.` 禁止）。別セッションの未コミット変更（collectors/tests_py）を巻き込まないため。コミット作者メールは noreply（`210495115+sg55555@users.noreply.github.com`）。
- `prefers-reduced-motion: reduce` を尊重（スライドのトランジションを無効化）。
- JS ユニットは `node --test tests/*.test.js`（e2e 除外）。e2e は `npx playwright test`・`workers:1` 維持。

---

## File Structure

| ファイル | 責務 | 種別 |
|----------|------|------|
| `js/ui/mobile-nav.js` | モバイルのボトムシート制御（純粋関数 `nextSheet`/`shouldShowMediaHint` ＋ DOM 結線 `initMobileNav`）。アプリ状態に非依存。 | 新規 |
| `index.html` | `#sheet-scrim`・`#mobile-tabs`・`#media-hint` の DOM ＋ `mobile-nav.js` の script tag。 | 変更 |
| `css/orbis.css` | `@media(max-width:768px)` でシート化・タブバー・幕・導線・既存パネル退避。 | 変更 |
| `tests/mobile-nav.test.js` | `nextSheet`/`shouldShowMediaHint` の node:test。 | 新規 |
| `tests/e2e/mobile-nav.spec.js` | モバイル幅での開閉・相互排他・導線スクロールの e2e。 | 新規 |
| `sw.js` | `CACHE` バンプ v29→v30。 | 変更 |

---

## Task 1: 純粋関数（nextSheet / shouldShowMediaHint）

**Files:**
- Create: `js/ui/mobile-nav.js`
- Test: `tests/mobile-nav.test.js`

**Interfaces:**
- Produces:
  - `nextSheet(current: 'layers'|'feed'|null, clicked: 'layers'|'feed'): 'layers'|'feed'|null` — 同じものをタップ→`null`（閉）、違うもの→`clicked`（相互排他で切替）。
  - `shouldShowMediaHint(mediaExists: boolean, mediaInView: boolean): boolean` — `mediaExists && !mediaInView`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/mobile-nav.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSheet, shouldShowMediaHint } from '../js/ui/mobile-nav.js';

test('nextSheet: 別タブで切替（相互排他）', () => {
  assert.equal(nextSheet(null, 'layers'), 'layers');
  assert.equal(nextSheet('layers', 'feed'), 'feed');
  assert.equal(nextSheet('feed', 'layers'), 'layers');
});

test('nextSheet: 同じタブの再タップで閉じる', () => {
  assert.equal(nextSheet('layers', 'layers'), null);
  assert.equal(nextSheet('feed', 'feed'), null);
});

test('shouldShowMediaHint: media が存在し画面外のときだけ true', () => {
  assert.equal(shouldShowMediaHint(true, false), true);
  assert.equal(shouldShowMediaHint(true, true), false);
  assert.equal(shouldShowMediaHint(false, false), false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/mobile-nav.test.js`
Expected: FAIL（`Cannot find module '../js/ui/mobile-nav.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/ui/mobile-nav.js`:
```js
// モバイル用ボトムシート・ナビ。globe を全画面の主役にし、LAYERS/FEED をシートで出す。
// main.js から import されない独立モジュール（index.html が末尾で読み込む）。
// DOM のクラス/属性操作だけで完結し、アプリ状態（snapshots/ENABLED/overlay）に依存しない。

// 現在開いているシート(current)とタップされたタブ(clicked)から次状態を返す。
// 同じ → 閉じる(null)。違う → 切替(相互排他)。
export function nextSheet(current, clicked) {
  return current === clicked ? null : clicked;
}

// #media が表示対象(display:none でない)かつ未だ画面内に入っていないなら導線を出す。
export function shouldShowMediaHint(mediaExists, mediaInView) {
  return mediaExists && !mediaInView;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/mobile-nav.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: コミット**

```bash
git add js/ui/mobile-nav.js tests/mobile-nav.test.js
git commit -m "feat(mobile): ボトムシート純粋関数 nextSheet/shouldShowMediaHint (TDD)"
```

---

## Task 2: モバイルシェルの DOM ＋ CSS（挙動なし・視覚のみ）

globe 全画面・下端タブバー・幕・導線の「見た目」を作る。この時点では JS 未結線なのでタブは無反応（`data-sheet` が付かないのでシートは閉じたまま＝globe 全画面）。

**Files:**
- Modify: `index.html`（`#feed` の `</div>` と `#loading` の間に DOM 追加）
- Modify: `css/orbis.css`（末尾に追加）

- [ ] **Step 1: index.html に DOM を追加**

`index.html` の `<div id="feed" ...>…</div>`（feed パネル閉じ）の直後、`<div id="loading">` の直前に挿入:
```html
      <div id="sheet-scrim"></div>
      <nav id="mobile-tabs" role="tablist" aria-label="モバイルナビゲーション">
        <button class="mobile-tab" data-sheet="layers" aria-controls="panel" aria-expanded="false">≡ レイヤー</button>
        <button class="mobile-tab" data-sheet="feed" aria-controls="feed" aria-expanded="false">≡ フィード</button>
      </nav>
      <button id="media-hint" type="button" aria-label="下部のメディアへ移動">▼ メディア</button>
```

- [ ] **Step 2: css/orbis.css の末尾にモバイル規則を追加**

`css/orbis.css` の末尾（既存 `@media (max-width: 860px) { .media-section ... }` の後）に追加:
```css
/* ===== モバイル ボトムシート UI（globe を主役・LAYERS/FEED はオンデマンド） ===== */
/* デスクトップ(>768px)では新規 UI を隠す＝既存挙動を不変に保つ */
#mobile-tabs, #sheet-scrim, #media-hint { display: none; }

@media (max-width: 768px) {
  /* デスクトップ用の折りたたみボタンはモバイルでは使わない（シート自前の閉手段を使う） */
  #panel-toggle, #feed-toggle { display: none; }

  /* LAYERS/FEED をボトムシート化：既定は画面外へ退避 */
  #panel.side-panel, #feed.side-panel {
    left: 0; right: 0; top: auto; bottom: 0; width: auto; max-width: none;
    max-height: min(72dvh, 560px); border-radius: 16px 16px 0 0;
    padding-top: 18px; padding-bottom: calc(10px + env(safe-area-inset-bottom));
    transform: translateY(110%); transition: transform .28s ease; z-index: 8;
  }
  /* ドラッグハンドル */
  #panel.side-panel::after, #feed.side-panel::after {
    content: ''; position: absolute; top: 7px; left: 50%; transform: translateX(-50%);
    width: 40px; height: 4px; border-radius: 2px; background: var(--glass-rim);
  }
  /* 開いているシートだけ せり上げる（JS が body[data-sheet] を付ける） */
  body[data-sheet="layers"] #panel.side-panel { transform: translateY(0); }
  body[data-sheet="feed"] #feed.side-panel { transform: translateY(0); }

  /* ディマー幕（globe 上・閉時は透明＆クリック透過） */
  #sheet-scrim {
    display: block; position: absolute; inset: 0; z-index: 6;
    background: rgba(3, 6, 12, .5);
    -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    opacity: 0; pointer-events: none; transition: opacity .28s ease;
  }
  body[data-sheet="layers"] #sheet-scrim, body[data-sheet="feed"] #sheet-scrim {
    opacity: 1; pointer-events: auto;
  }

  /* 下端タブバー */
  #mobile-tabs {
    display: flex; position: absolute; left: 0; right: 0; bottom: 0; z-index: 7;
    gap: 8px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
    background: linear-gradient(transparent, rgba(5, 8, 15, .66) 42%);
  }
  .mobile-tab {
    flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
    height: 44px; border-radius: 12px; background: var(--glass-bg);
    border: 1px solid var(--glass-rim); color: var(--text); font-size: 13px; cursor: pointer;
    -webkit-backdrop-filter: blur(var(--glass-blur)); backdrop-filter: blur(var(--glass-blur));
  }
  .mobile-tab[aria-expanded="true"] {
    border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 10px rgba(57, 208, 255, .3);
  }

  /* ▼ メディア導線（タブバー上・控えめ） */
  #media-hint {
    display: flex; position: absolute; left: 50%; transform: translateX(-50%);
    bottom: calc(64px + env(safe-area-inset-bottom)); z-index: 7;
    align-items: center; gap: 6px; padding: 5px 12px; border-radius: 999px;
    background: var(--glass-bg); border: 1px solid var(--glass-rim); color: var(--cyan);
    font-size: 11px; opacity: .85; cursor: pointer;
    -webkit-backdrop-filter: blur(var(--glass-blur)); backdrop-filter: blur(var(--glass-blur));
  }
  #media-hint.hidden { display: none; }
  body[data-sheet="layers"] #media-hint, body[data-sheet="feed"] #media-hint { display: none; }

  /* 鮮度ピル小型化 */
  #freshness { font-size: 10px; padding: 4px 7px; }
}

@media (prefers-reduced-motion: reduce) {
  #panel.side-panel, #feed.side-panel, #sheet-scrim { transition: none; }
}
```

- [ ] **Step 3: 視覚確認（モバイル幅）**

`python3 -m http.server 8791 --directory .` を起動し、Playwright（または手元ブラウザ幅 390px）で `http://localhost:8791/` を開く。
Expected: globe が全画面で見える／上に左右パネルが被っていない／下端に `[≡ レイヤー][≡ フィード]` タブと `▼ メディア` 導線が見える。タップは未反応（Task 3 で結線）。スクショ 1 枚を目視。

- [ ] **Step 4: 視覚確認（デスクトップ幅・回帰なし）**

ブラウザ幅 1440px で同 URL。
Expected: 左 LAYERS/右 FEED は従来どおり。タブバー・幕・導線は出ない（`display:none`）。

- [ ] **Step 5: コミット**

```bash
git add index.html css/orbis.css
git commit -m "feat(mobile): ボトムシートUIのDOM/CSS（globe全画面・下端タブ・導線・挙動なし）"
```

---

## Task 3: ボトムシートの結線（initMobileNav ＋ script tag）

タブ/幕/ハンドル/キーボード/スワイプ/導線/`matchMedia` を結線し、`body[data-sheet]` を切替える。

**Files:**
- Modify: `js/ui/mobile-nav.js`（`initMobileNav` を追加＋自動初期化ガード）
- Modify: `index.html`（`main.js` の script の後に `mobile-nav.js` を追加）

**Interfaces:**
- Consumes: `nextSheet`（Task 1）
- Produces: `initMobileNav(doc = document): void` — DOM を取得して結線。`#mobile-tabs` が無ければ no-op。

- [ ] **Step 1: js/ui/mobile-nav.js に initMobileNav を追記**

`js/ui/mobile-nav.js` の `shouldShowMediaHint` の後に追加:
```js
// DOM 結線。クラス/属性操作だけで開閉する（アプリ状態に非依存）。
export function initMobileNav(doc = document) {
  const body = doc.body;
  const tabs = doc.getElementById('mobile-tabs');
  if (!tabs) return; // タブが無ければ何もしない（防御的）
  const scrim = doc.getElementById('sheet-scrim');
  const hint = doc.getElementById('media-hint');
  const media = doc.getElementById('media');
  const tabBtns = Array.from(tabs.querySelectorAll('.mobile-tab'));

  const current = () => {
    const v = body.getAttribute('data-sheet');
    return (v === 'layers' || v === 'feed') ? v : null;
  };

  function setSheet(next) {
    body.setAttribute('data-sheet', next || 'none');
    tabBtns.forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.sheet === next)));
    if (next) {
      const panelEl = doc.getElementById(next === 'layers' ? 'panel' : 'feed');
      const focusable = panelEl && (panelEl.querySelector('input, button, [tabindex]') || panelEl);
      if (focusable && focusable.focus) focusable.focus({ preventScroll: true });
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => setSheet(nextSheet(current(), btn.dataset.sheet)));
  });
  if (scrim) scrim.addEventListener('click', () => setSheet(null));
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current()) setSheet(null); });

  // 下スワイプで閉じる（開いている間のみ）
  let touchY = null;
  body.addEventListener('touchstart', (e) => { if (current()) touchY = e.touches[0].clientY; }, { passive: true });
  body.addEventListener('touchend', (e) => {
    if (touchY == null) return;
    if (e.changedTouches[0].clientY - touchY > 60) setSheet(null);
    touchY = null;
  }, { passive: true });

  // ▼ メディア導線：media が存在する時のみ。画面内に入ったら隠す。
  const mediaExists = !!media && (typeof getComputedStyle === 'undefined' || getComputedStyle(media).display !== 'none');
  if (hint && media && mediaExists) {
    hint.addEventListener('click', () => media.scrollIntoView({ behavior: 'smooth' }));
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((ents) => {
        hint.classList.toggle('hidden', !shouldShowMediaHint(true, ents[0].isIntersecting));
      }, { threshold: 0.1 });
      io.observe(media);
    }
  } else if (hint) {
    hint.classList.add('hidden');
  }

  // ブレークポイント跨ぎ：デスクトップ幅へ戻ったらシート状態をリセット（開きっぱなし防止）
  if (typeof matchMedia !== 'undefined') {
    const mq = matchMedia('(max-width: 768px)');
    const onChange = () => { if (!mq.matches) setSheet(null); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  setSheet(null); // 既定は閉（globe 全画面）
}

// 自動初期化（ブラウザのみ）。module script は defer 相当で DOM 準備後に実行される。
// node:test では document が無いので実行されない（純粋関数の import は安全）。
if (typeof document !== 'undefined' && document.getElementById('mobile-tabs')) {
  initMobileNav(document);
}
```

- [ ] **Step 2: 純粋関数テストが引き続き通ることを確認（import 副作用が無いこと）**

Run: `node --test tests/mobile-nav.test.js`
Expected: PASS（3 tests・`document` 未定義のため自動初期化はスキップされる）

- [ ] **Step 3: index.html に script tag を追加**

`index.html` の `<script type="module" src="js/main.js"></script>` の直後に追加:
```html
  <script type="module" src="js/ui/mobile-nav.js"></script>
```

- [ ] **Step 4: 実機幅で手動結線確認**

`python3 -m http.server 8791 --directory .` ＋ ブラウザ幅 390px で `http://localhost:8791/`。
Expected: `レイヤー`タブ→下から LAYERS シートがせり上がる／`フィード`タブ→切替（前のは閉じる）／幕タップ・同タブ再タップ・Esc で閉じる／`▼ メディア`タップで下部メディアへスクロール。スクショで目視（globe は背後に見えたまま）。

- [ ] **Step 5: コミット**

```bash
git add js/ui/mobile-nav.js index.html
git commit -m "feat(mobile): ボトムシート結線 initMobileNav（相互排他/幕/Esc/スワイプ/導線）"
```

---

## Task 4: e2e ＋ SW バンプ ＋ 最終検証

**Files:**
- Create: `tests/e2e/mobile-nav.spec.js`
- Modify: `sw.js`（`CACHE` v29→v30）

- [ ] **Step 1: e2e を書く（失敗する状態）**

`tests/e2e/mobile-nav.spec.js`:
```js
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('mobile: globe全画面・ボトムシート開閉・相互排他・メディア導線', async ({ page }) => {
  test.setTimeout(60000); // WebGL globe 起動が WSL2 で重い
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });

  // 既定：シート閉（globe 全画面）。タブバーは表示。
  await expect(page.locator('#mobile-tabs')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // レイヤータブ → panel シート
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'layers');
  await expect(page.locator('.mobile-tab[data-sheet="layers"]')).toHaveAttribute('aria-expanded', 'true');

  // フィードタブ → feed に切替（相互排他：layers は閉じる）
  await page.locator('.mobile-tab[data-sheet="feed"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'feed');
  await expect(page.locator('.mobile-tab[data-sheet="layers"]')).toHaveAttribute('aria-expanded', 'false');

  // 同じタブ再タップで閉じる
  await page.locator('.mobile-tab[data-sheet="feed"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // 開く → 幕(globe 上部の被っていない位置)タップで閉じる
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'layers');
  await page.locator('#sheet-scrim').click({ position: { x: 195, y: 60 } });
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // 開く → Esc で閉じる
  await page.locator('.mobile-tab[data-sheet="layers"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-sheet', 'none');

  // ▼メディア導線で #media へスクロール（存在時）
  const hint = page.locator('#media-hint');
  if (await hint.isVisible()) {
    await hint.click();
    await page.waitForTimeout(900);
    const top = await page.evaluate(() => document.getElementById('media').getBoundingClientRect().top);
    expect(top).toBeLessThan(844);
  }
});
```

- [ ] **Step 2: e2e を実行（Task 1-3 実装済みなら PASS のはず）**

Run: `npx playwright test tests/e2e/mobile-nav.spec.js`
Expected: PASS（1 test）。FAIL する場合は実装（Task 2/3）の不足箇所を修正する。

- [ ] **Step 3: 既存 e2e（デスクトップ smoke）に回帰がないことを確認**

Run: `npx playwright test`
Expected: 全 PASS（smoke/media/ship-projection/mobile-nav）。smoke はデフォルト（デスクトップ）viewport なので、左右パネル挙動が不変であることの回帰ガードになる。

- [ ] **Step 4: SW の CACHE をバンプ**

`sw.js` の 2 行目を変更:
```js
const CACHE = 'orbis-v30';
```
（理由：`index.html`・`css/orbis.css` を変更した。SHELL キャッシュ対象なので版を上げないと旧版が配信される。）

- [ ] **Step 5: 全テスト緑を確認**

Run: `node --test tests/*.test.js && npx playwright test`
Expected: node 全 PASS（+3）／Playwright 全 PASS（+1）。

- [ ] **Step 6: 実機幅スクショの最終目視（mistakes.md：描画は画素で確認）**

`python3 -m http.server 8791 --directory .` ＋ Playwright で portrait(390×844)・landscape(844×390)・desktop(1440×900) を撮影。
Expected: portrait/landscape とも globe が既定で全画面・各シート開閉・導線が機能。desktop は従来どおり（回帰なし）。

- [ ] **Step 7: コミット**

```bash
git add tests/e2e/mobile-nav.spec.js sw.js
git commit -m "test(mobile): ボトムシート e2e ＋ sw v30 バンプ"
```

---

## Self-Review（spec 突き合わせ）

- **Spec coverage**：globe 全画面(Task2 CSS)／ボトムシート相互排他(Task1+3)／メディア導線(Task2+3)／デスクトップ不変(Task2 base `display:none`＋768px gate・Task4 smoke 回帰)／main.js非編集(全タスク)／SWバンプ(Task4)／a11y aria・focus(Task3)／reduced-motion(Task2)／matchModalリセット(Task3)。全項目にタスク対応あり。
- **Placeholder scan**：TBD/TODO 無し。各コード手順に実コードあり。
- **Type consistency**：`nextSheet`/`shouldShowMediaHint`/`initMobileNav` の名称・引数は Task1↔Task3↔tests で一致。`data-sheet` 値は `'layers'|'feed'|'none'` で CSS/JS/e2e 一致。タブの `data-sheet` 属性値（`layers`/`feed`）も一致。
- 既知の軽微な点：`#media` が main.js の非同期 load で後から `display:none` になるケース（config 不在時）は導線が一瞬残り得るが、live_channels/live_cameras は常時コミット済のため実害なし（YAGNI）。

---

## Execution Handoff

実行方式は実装ゲートでユーザーに確認する（サブエージェント駆動／インライン）。あわせて effort（max のまま／xhigh／high）も確認する（設計→実装の境界）。
