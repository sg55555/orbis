# フィード均等化（ラウンドロビン）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フィードを「紛争一色」から脱却させる＝可視レイヤーをラウンドロビン巡回で均等配置し、紛争/抗議は件数降順、件数を単位つき「N件」＋件数バーで表示する。

**Architecture:** 完全クライアントサイド。新規純粋関数 `buildFeedBalanced`（層内整列＋ラウンドロビン）と `countBarPct`（件数バー正規化）を `js/lib/feed.js` に追加し、`main.js` の `refreshFeed` が可視層集合で呼ぶ。`js/ui/feed.js` の `renderFeed` が「N件」＋バーを描く。`main.js` の信頼性系・registry・collector は非破壊。

**Tech Stack:** Vanilla ES modules, node:test, Playwright, PWA(SW)。

## Global Constraints

- 完全にクライアントサイド（collector/Python・registry 不変、drawAll キャッシュ骨格・ポーリング非破壊）。
- 均等化＝**ラウンドロビン巡回**（各可視層を `layers` 登場順に1件ずつ・尽きた層はスキップ・上限100）。
- 層内整列＝紛争/抗議(`kind:'group'`)は **count 降順**、地震/ニュースは **time 降順**。
- 件数表示＝単位つき **「N件」**（例 `581件`）。`×N` は使わない。
- 件数バー＝フィード内最大件数で正規化（**log スケール** `log1p(c)/log1p(max)`）・控えめ・行高を増やさない。
- 静的ファイル（js/css）変更につき `sw.js` の CACHE を **`orbis-v36` → `orbis-v37`**（実装時に現行値を確認し increment）。
- e2e は直列（`workers:1`・既存設定）。文言は日本語。
- node:test: `npm run test:js`（単体 `node --test tests/<file>.test.js`）。e2e: `npx playwright test tests/e2e/<spec>`。
- 既存テスト（conflict.spec / smoke / feed.test）を緑のまま維持。

---

### Task 1: 件数バー正規化 `countBarPct`（純粋）

**Files:**
- Modify: `js/lib/feed.js`（末尾に追加）
- Test: `tests/feed.test.js`（import 追記＋テスト追加）

**Interfaces:**
- Produces: `countBarPct(count, maxCount) -> number`（0..100 の整数。`maxCount<=0` or `count<=0` は 0。log 正規化で単調増加）

- [ ] **Step 1: 失敗するテストを書く**

`tests/feed.test.js` の import 行に `countBarPct` を追加（既存の `from '../js/lib/feed.js'` へ）。テスト追加:

```js
test('countBarPct: 0..100・log正規化・maxCount=0 ガード・単調', () => {
  assert.equal(countBarPct(0, 100), 0);
  assert.equal(countBarPct(50, 0), 0);     // maxCount=0 ガード
  assert.equal(countBarPct(100, 100), 100); // 最大は満幅
  assert.ok(countBarPct(10, 100) < countBarPct(50, 100)); // 単調増加
  assert.ok(countBarPct(1, 100) > 0);       // 小件数でも >0
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/feed.test.js` / Expected: FAIL（`countBarPct is not a function`）

- [ ] **Step 3: 実装** — `js/lib/feed.js` 末尾に追加:

```js
// 件数バーの幅(0..100%)。フィード内最大件数で log 正規化。maxCount<=0/count<=0 は 0。
export function countBarPct(count, maxCount) {
  const c = Number(count) || 0, m = Number(maxCount) || 0;
  if (m <= 0 || c <= 0) return 0;
  return Math.round(100 * Math.log1p(c) / Math.log1p(m));
}
```

- [ ] **Step 4: 成功を確認** — Run: `node --test tests/feed.test.js` / Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/feed.js tests/feed.test.js
git commit -m "feat(feed): 件数バー正規化 countBarPct(log)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: ラウンドロビン均等化 `buildFeedBalanced`（純粋）

**Files:**
- Modify: `js/lib/feed.js`（`buildFeed` の後に追加）
- Test: `tests/feed.test.js`

**Interfaces:**
- Consumes: 各 layer の `toFeedItems(snapshot)`（GroupRow は `{kind:'group', layerId, count, time, ...}`／個別は `{layerId, time, title, ...}`）
- Produces: `buildFeedBalanced(layers, snapshots, visible, cap = 100) -> item[]`。`visible`=表示する layerId の Set。層内整列（group=count降順/他=time降順）→ `layers` 登場順にラウンドロビン巡回→ cap 件。

- [ ] **Step 1: 失敗するテストを書く**

`tests/feed.test.js` の import に `buildFeedBalanced` を追加。テスト追加:

```js
const balLayers = [
  { id: 'quakes', toFeedItems: (s) => s.q },
  { id: 'conflict', toFeedItems: (s) => s.c },
  { id: 'news', toFeedItems: (s) => s.n },
];
const balSnap = {
  quakes: { q: [{ layerId: 'quakes', time: 100 }, { layerId: 'quakes', time: 300 }] },
  conflict: { c: [
    { kind: 'group', layerId: 'conflict', count: 5, time: 200 },
    { kind: 'group', layerId: 'conflict', count: 50, time: 200 },
  ] },
  news: { n: [{ layerId: 'news', time: 250 }] },
};

test('buildFeedBalanced: ラウンドロビン巡回・層内整列・cap', () => {
  const out = buildFeedBalanced(balLayers, balSnap, new Set(['quakes', 'conflict', 'news']));
  // 1周目: quakes先頭(time降順→300), conflict先頭(count降順→50), news(250)
  assert.equal(out[0].layerId, 'quakes'); assert.equal(out[0].time, 300);
  assert.equal(out[1].layerId, 'conflict'); assert.equal(out[1].count, 50); // 件数降順で50が先
  assert.equal(out[2].layerId, 'news');
  // 2周目: quakes(100), conflict(count5)。news は尽きてスキップ
  assert.equal(out[3].layerId, 'quakes'); assert.equal(out[3].time, 100);
  assert.equal(out[4].layerId, 'conflict'); assert.equal(out[4].count, 5);
  assert.equal(out.length, 5);
});

test('buildFeedBalanced: visible フィルタ・cap・空安全', () => {
  const only = buildFeedBalanced(balLayers, balSnap, new Set(['conflict']));
  assert.ok(only.every((it) => it.layerId === 'conflict'));
  assert.equal(only[0].count, 50); // 件数降順
  assert.deepEqual(buildFeedBalanced(balLayers, balSnap, new Set()), []);
  assert.equal(buildFeedBalanced(balLayers, balSnap, new Set(['quakes', 'conflict', 'news']), 2).length, 2); // cap
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test tests/feed.test.js` / Expected: FAIL（未定義）

- [ ] **Step 3: 実装** — `js/lib/feed.js` の `buildFeed` 関数の直後に追加:

```js
// フィード項目の層内比較（純粋）。group(紛争/抗議)は count 降順、他は time 降順。
// 各 queue は単一レイヤーの項目なので均質（全 group か全 個別）。
function feedItemCmp(a, b) {
  if (a.kind === 'group' && b.kind === 'group') {
    const d = (Number(b.count) || 0) - (Number(a.count) || 0);
    if (d) return d;
  }
  return (b.time || 0) - (a.time || 0);
}

// 可視レイヤーを層内整列し、layers 登場順にラウンドロビン巡回して cap 件（純粋）。
export function buildFeedBalanced(layers, snapshots, visible, cap = CAP) {
  const queues = [];
  for (const l of layers) {
    if (!visible.has(l.id) || typeof l.toFeedItems !== 'function') continue;
    const snap = snapshots[l.id];
    if (!snap) continue;
    const items = l.toFeedItems(snap).slice().sort(feedItemCmp);
    if (items.length) queues.push(items);
  }
  const out = [];
  for (let i = 0; out.length < cap; i += 1) {
    let took = false;
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); took = true; if (out.length >= cap) break; }
    }
    if (!took) break; // 全層尽きた
  }
  return out;
}
```

- [ ] **Step 4: 成功を確認** — Run: `node --test tests/feed.test.js` / Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/feed.js tests/feed.test.js
git commit -m "feat(feed): ラウンドロビン均等化 buildFeedBalanced(層内整列+巡回)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 「N件」＋件数バー描画＋配線（renderFeed / refreshFeed / css / sw）

**Files:**
- Modify: `js/ui/feed.js`（renderFeed）、`js/main.js`（refreshFeed・import）、`css/orbis.css`（件数バー）、`sw.js`（版上げ）
- Test: `tests/e2e/conflict.spec.js`（拡張）

**Interfaces:**
- Consumes: `buildFeedBalanced`/`countBarPct`（Task 1/2）
- Produces: なし（配線）

- [ ] **Step 1: 失敗する e2e を書く**

`tests/e2e/conflict.spec.js` の末尾に追加（本番相当データ＝conflict/quakes/protests/news がローカル snapshot に存在）:

```js
test('feed is balanced (not all conflict) and shows N件 with count order', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => window.__orbis?.counts?.conflict ?? 0), { timeout: 15000 }).toBeGreaterThan(0);
  await expect(page.locator('#feed .feed-row').first()).toBeVisible({ timeout: 15000 });

  // 先頭8行に2種類以上のレイヤー色が混在（紛争一色でない）
  const colors = await page.$$eval('#feed .feed-row .feed-dot', (ns) => ns.slice(0, 8).map((e) => e.style.background));
  expect(new Set(colors).size).toBeGreaterThan(1);

  // バッジは「N件」表記（×ではない）
  const badge = await page.locator('#feed .feed-row .feed-count').first().textContent();
  expect(badge).toMatch(/^\d+件$/);

  // チップで紛争のみ表示 → 紛争行が件数降順（先頭の件数 ≥ 2番目）
  // まず他チップをオフにして紛争だけ残す（全→各トグル）
  await page.locator('#feed-chips .feed-chip[data-chip="quakes"]').click().catch(() => {});
  await page.locator('#feed-chips .feed-chip[data-chip="protests"]').click().catch(() => {});
  await page.locator('#feed-chips .feed-chip[data-chip="news"]').click().catch(() => {});
  await page.waitForTimeout(400);
  const counts = await page.$$eval('#feed .feed-row .feed-count', (ns) => ns.slice(0, 5).map((e) => parseInt(e.textContent, 10)));
  for (let i = 1; i < counts.length; i++) expect(counts[i - 1]).toBeGreaterThanOrEqual(counts[i]);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx playwright test tests/e2e/conflict.spec.js` / Expected: FAIL（バッジが `×N` のまま・先頭が紛争一色）

- [ ] **Step 3: 実装**

(a) `js/ui/feed.js`: import に `countBarPct` を追加し、`renderFeed` に `maxCount` 引数＋「N件」＋バーを反映:

```js
import { formatFreshness } from '../lib/geo.js';
import { countBarPct } from '../lib/feed.js';
```

`renderFeed` を次に置換（badge とシグネチャのみ変更）:

```js
export function renderFeed(root, items, onPick, maxCount = 0) {
  root.innerHTML = items.map((it, i) => {
    const c = COLOR[it.layerId] || 'var(--cyan)';
    const title = it.kind === 'group'
      ? `${LABEL[it.layerId] || ''} ${escapeHtml(it.country_ja || '')}`
      : escapeHtml(it.title);
    const badge = it.kind === 'group'
      ? `<span class="feed-count" style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
      : '';
    return `<div class="feed-row" data-i="${i}">
      <span class="feed-dot" style="color:${c};background:${c}"></span>
      <span class="feed-title">${title}</span>${badge}
      <span class="feed-time">${it.time ? formatFreshness(new Date(it.time).toISOString()) : ''}</span>
    </div>`;
  }).join('') || '<div class="feed-empty">イベントなし</div>';

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
```

(b) `js/main.js`: import を更新（`applyChips` を外し `buildFeedBalanced` を追加）:

```js
import { buildFeed, buildFeedBalanced, feedChipIds, loadFeedHidden, toggleHidden, readFeedFilter, writeFeedFilter } from './lib/feed.js';
```

`refreshFeed` の「`const items = applyChips(...)` ～ `renderFeed(...)` の呼び出し」を次に置換（チップ描画部は不変）:

```js
  const visible = new Set(chipIds.filter((id) => !feedHidden.has(id)));
  const items = buildFeedBalanced(feedLayers(), snapshots, visible);
  const maxCount = items.reduce((m, it) => Math.max(m, Number(it.count) || 0), 0);
  renderFeed(document.getElementById('feed-rows'), items, (it) => {
    const at = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    selected = { lon: it.lon, lat: it.lat, title: it.title || it.country_ja || '', layerId: it.layerId, at };
    if (window.__orbis) window.__orbis.selected = selected;
    map.flyTo({ center: [it.lon, it.lat], zoom: 5, duration: 1500, essential: true });
    const html = (it.kind === 'group') ? gdeltCountryPopupHtml(it) : selectionPopupHtml(it);
    if (selPopup) selPopup.setLngLat([it.lon, it.lat]).setHTML(html).addTo(map);
    drawAll(window.__orbis.overlay);
  }, maxCount);
```

（注: `applyChips` の import を外したので、main.js 内に他の `applyChips` 使用が無いことを確認。`buildFeed` は `chipIds` 導出に残る。）

(c) `css/orbis.css` の `.feed-count` 規則を次に置換（「件」表示＋件数バー＝バッジ下の細い線）:

```css
.feed-count {
  position: relative; font-size: 11px; color: #ff9bb0; margin-left: 4px;
  white-space: nowrap; padding-bottom: 3px;
}
.feed-count::after {
  content: ''; position: absolute; left: 0; bottom: 0; height: 2px;
  width: var(--barw, 0%); background: currentColor; opacity: .55; border-radius: 1px;
}
```

(d) `sw.js` の CACHE を `orbis-v36` → `orbis-v37` に更新。

- [ ] **Step 4: 成功を確認**

Run: `npx playwright test tests/e2e/conflict.spec.js`
Expected: PASS（先頭混在・「N件」・紛争のみ件数降順）

Run: `npx playwright test tests/e2e/smoke.spec.js`
Expected: PASS（回帰なし。smoke のフィードクリックは先頭行＝混在でも flyTo＋popup「移動」を満たす）

- [ ] **Step 5: コミット**

```bash
git add js/ui/feed.js js/main.js css/orbis.css sw.js tests/e2e/conflict.spec.js
git commit -m "feat(feed): ラウンドロビン均等化を配線＋「N件」＋件数バー・sw v37

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 全体検証

**Files:** なし（検証のみ）

- [ ] **Step 1: 全 node:test 緑**

Run: `npm run test:js`
Expected: 全 PASS（既存＋Task1/2 の新規。fail 0）

- [ ] **Step 2: フィード関連 e2e ＋ 回帰 緑**

Run: `npx playwright test tests/e2e/conflict.spec.js tests/e2e/smoke.spec.js`
Expected: 全 PASS

- [ ] **Step 3: 視覚サニティ（任意・実機は統合後）**

`npm run serve` → `http://localhost:8000/` でフィードを目視：先頭から地震/紛争/抗議/ニュースが混在、紛争は件数降順、バッジが「581件」等＋細い件数バー、console error 0。

---

## Self-Review

**Spec coverage:**
- ラウンドロビン均等化 → Task 2 ✅／層内整列(紛争=count降順/他=time降順) → Task 2 `feedItemCmp` ✅／件数「N件」 → Task 3 renderFeed ✅／件数バー(log正規化) → Task 1 `countBarPct`＋Task 3 css ✅／可視層巡回(チップ整合) → Task 3 refreshFeed `visible` ✅／sw 版上げ → Task 3 ✅／collector・registry 不変 → どのタスクも触れない ✅。

**Placeholder scan:** 各 step に実コード・実コマンド・期待値あり。曖昧指示なし。sw 版は現行 v36→v37 を明示。

**Type consistency:**
- `buildFeedBalanced(layers, snapshots, visible, cap)` は Task 2 定義 → Task 3 main.js 呼び出しと一致（`visible` は Set）。
- `countBarPct(count, maxCount)` は Task 1 定義 → Task 3 ui/feed.js 呼び出しと一致。
- `renderFeed(root, items, onPick, maxCount)` は Task 3 でシグネチャ拡張（第4引数 maxCount・既定0）→ main.js 呼び出しと一致。
- GroupRow の `kind/count/time/layerId/country_ja` は紛争セクション(既存)と一致。
