# メディア領域刷新（スクロール大画面＋ニュース/カメラ） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 下部の小窓ライブバーを廃止し、ページをスクロール可能にして地球儀(100vh)の下に大画面メディア領域 `#media`（ニュース/カメラのカテゴリタブ＋大プレーヤー＋セレクタ）を置く。選択で本拠地へ flyTo＋マーカー、可視時のみ再生。

**Architecture:** `js/ui/streams.js` を `js/ui/media.js` に改称・刷新（純粋ヘルパ＋`renderMedia`）。`config/live_channels.json`（ニュース・既存）と `config/live_cameras.json`（カメラ・新規）を `media.js` が両方読み、カテゴリタブで切替。`buildEmbedUrl` は `video_id`/`channel_id` 両対応。`IntersectionObserver` で `#media` 可視時のみ再生。flyTo は既存 `selected`＋`buildReticleConfigs` を流用。

**Tech Stack:** Vanilla JS(ESM) / MapLibre flyTo / YouTube埋め込み(key不要) / IntersectionObserver / node --test / Playwright。

参照 spec: `docs/superpowers/specs/2026-06-18-orbis-media-section-design.md`

**重要制約:** headless Chromium は YouTube を再生(decode)できない（[[youtube-embed-headless-no-playback]]）。自動テストは構造（描画・タブ切替・src・flyTo・可視時src設定）のみ。再生はオーナー実ブラウザ確認。

---

## File Structure

- Create: `config/live_cameras.json` — 街角カメラ定義（検証済みID）
- Rename/rework: `js/ui/streams.js` → `js/ui/media.js`（buildEmbedUrl[video_id対応]/defaultItem/itemById/renderMedia）
- Rename/rework: `tests/streams.test.js` → `tests/media.test.js`
- Modify: `index.html` — `#streams` 削除、`#map-wrap` 後に `#media` 追加
- Modify: `css/orbis.css` — スクロール解禁＋`.stream-*` 削除＋`.media-*` 追加
- Modify: `js/main.js` — import 差替・2 config 読込・`renderMedia`・onSelectでflyTo+マーカー・IntersectionObserver・sw 連動なし
- Modify: `sw.js` — CACHE v21→v22
- Rename/rework: `tests/e2e/streams.spec.js` → `tests/e2e/media.spec.js`

---

## Task 1: カメラ設定（検証済みID）

**Files:** Create `config/live_cameras.json`

- [ ] **Step 1: Create the config**

`config/live_cameras.json`（ブレストで埋め込みロードを実測済みのIDを使用）:

```json
[
  { "id": "shibuya", "name": "渋谷スクランブル交差点", "region": "東京", "lat": 35.66, "lon": 139.70, "video_id": "8H3nRCFVR6Y" },
  { "id": "timessquare", "name": "Times Square", "region": "ニューヨーク", "lat": 40.758, "lon": -73.985, "video_id": "z-jYdOIKcTQ" },
  { "id": "london", "name": "London Live", "region": "ロンドン", "lat": 51.51, "lon": -0.13, "video_id": "M3EYAY2MftI" },
  { "id": "paris", "name": "Paris / Eiffel", "region": "パリ", "lat": 48.86, "lon": 2.29, "video_id": "OzYp4NRZlwQ" },
  { "id": "venice", "name": "Venice", "region": "ヴェネツィア", "lat": 45.44, "lon": 12.34, "video_id": "a1mcaV3Sf9U" }
]
```

- [ ] **Step 2: Re-verify embeddability (Playwright)**

ライブ動画IDは終了し得るので実装時点で再検証する。`/tmp/cam-check.js`:

```javascript
const { chromium } = require('playwright');
const fs = require('fs');
const cams = JSON.parse(fs.readFileSync('~/apps/orbis/config/live_cameras.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const c of cams) {
    const page = await browser.newPage();
    let ok = false, note = '';
    try {
      await page.goto(`https://www.youtube.com/embed/${c.video_id}?autoplay=1&mute=1`, { waitUntil: 'load', timeout: 20000 });
      await page.waitForTimeout(3500);
      ok = await page.evaluate(() => !!document.querySelector('video'));
      if (!ok) note = (await page.locator('body').textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 50);
    } catch (e) { note = 'ERR ' + e.message.slice(0, 40); }
    console.log(`${ok ? 'OK  ' : 'DROP'} ${c.id} (${c.video_id}) ${note}`);
    await page.close();
  }
  await browser.close();
})();
```

Run: `cd ~/.claude/plugins/cache/playwright-skill/playwright-skill/*/skills/playwright-skill && node run.js /tmp/cam-check.js`
Expected: 大半が `OK`。`DROP` のものは `config/live_cameras.json` から削除。最低3件残ればよい（全滅した場合は DONE_WITH_CONCERNS で報告し、ブレスト時の5件をそのまま残す）。

- [ ] **Step 3: Commit**

```bash
git add config/live_cameras.json
git commit -m "feat(media): curated live city camera config"
```

---

## Task 2: media.js（streams.js を改称・刷新）＋ tests

**Files:**
- Delete: `js/ui/streams.js`, `tests/streams.test.js`
- Create: `js/ui/media.js`, `tests/media.test.js`

- [ ] **Step 1: Write the failing test — `tests/media.test.js`**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbedUrl, defaultItem, itemById } from '../js/ui/media.js';

const NEWS = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];
const CAM = { id: 'shibuya', name: '渋谷', channel_id: undefined, video_id: '8H3nRCFVR6Y', region: '東京', lat: 35.66, lon: 139.70 };

test('buildEmbedUrl: channel_id 形式（live_stream）', () => {
  const u = buildEmbedUrl(NEWS[0]);
  assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
});

test('buildEmbedUrl: video_id 形式（embed/<id>）', () => {
  const u = buildEmbedUrl(CAM);
  assert.ok(u.startsWith('https://www.youtube.com/embed/8H3nRCFVR6Y?'));
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1') && u.includes('playsinline=1'));
  assert.ok(!u.includes('live_stream')); // video_id 優先
});

test('defaultItem: 先頭 / 空・null は null', () => {
  assert.equal(defaultItem(NEWS), NEWS[0]);
  assert.equal(defaultItem([]), null);
  assert.equal(defaultItem(null), null);
});

test('itemById: 一致 / 不一致 null', () => {
  assert.equal(itemById(NEWS, 'dw'), NEWS[1]);
  assert.equal(itemById(NEWS, 'nope'), null);
  assert.equal(itemById(null, 'dw'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/media.test.js` → expect "Cannot find module '../js/ui/media.js'".

- [ ] **Step 3: Delete old streams files and write media.js**

```bash
git rm js/ui/streams.js tests/streams.test.js
```

`js/ui/media.js`:

```javascript
// メディア領域（下部・スクロール大画面）。ニュース/カメラのカテゴリタブ＋大プレーヤー＋セレクタ。
// 純粋ヘルパ（URL生成・選択ロジック）＋描画（renderMedia）。

// キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
// autoplay はミュート必須・iOS向け playsinline。
export function buildEmbedUrl(item) {
  const base = item.video_id
    ? `https://www.youtube.com/embed/${item.video_id}`
    : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}autoplay=1&mute=1&playsinline=1`;
}

export function defaultItem(items) {
  return (Array.isArray(items) && items.length) ? items[0] : null;
}

export function itemById(items, id) {
  return (Array.isArray(items) ? items : []).find((c) => c.id === id) || null;
}

// メディア領域を描画。lists = { news:[], cameras:[] }。onSelect(item) は項目選択時（flyTo 等）。
// 返り値 API: select(id) / selectCategory(cat) / setPlaying(on) / current()。
export function renderMedia(rootEl, lists, { onSelect } = {}) {
  const frame = rootEl.querySelector('#media-frame');
  const selEl = rootEl.querySelector('#media-selector');
  const nowEl = rootEl.querySelector('.media-now');
  const catBtns = Array.from(rootEl.querySelectorAll('.media-cat'));
  let cat = 'news';
  let curId = defaultItem(lists[cat]) ? defaultItem(lists[cat]).id : null;
  let visible = false;

  const items = () => lists[cat] || [];

  function highlight() {
    selEl.querySelectorAll('.media-item').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
    catBtns.forEach((c) => c.classList.toggle('active', c.dataset.cat === cat));
  }
  function setNow(it) { if (nowEl && it) nowEl.textContent = `${it.name}｜${it.region}`; }
  function play() { const it = itemById(items(), curId); if (visible && it) frame.src = buildEmbedUrl(it); }

  function renderSelector() {
    selEl.innerHTML = '';
    for (const it of items()) {
      const b = document.createElement('button');
      b.className = 'media-item';
      b.dataset.id = it.id;
      b.textContent = it.name;
      b.addEventListener('click', () => select(it.id));
      selEl.appendChild(b);
    }
    highlight();
  }

  function select(id) {
    const it = itemById(items(), id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) frame.src = buildEmbedUrl(it);
    if (onSelect) onSelect(it);
  }

  function selectCategory(c) {
    if (!lists[c]) return; // 未知/欠落カテゴリは無視
    cat = c;
    curId = defaultItem(items()) ? defaultItem(items()).id : null;
    renderSelector();
    setNow(itemById(items(), curId));
    play(); // カテゴリ切替時、可視なら新カテゴリ先頭を再生（flyTo はしない）
  }

  catBtns.forEach((b) => b.addEventListener('click', () => selectCategory(b.dataset.cat)));
  renderSelector();
  setNow(itemById(items(), curId));

  return {
    select,
    selectCategory,
    current: () => ({ cat, id: curId }),
    // 可視/不可視に応じて再生制御（IntersectionObserver から呼ぶ）。
    setPlaying(on) {
      visible = on;
      if (on) play();
      else frame.src = '';
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/media.test.js` → expect 4 tests pass.
Then full suite: `node --test tests/*.test.js` → all pass (streams.test.js gone, media.test.js added).

- [ ] **Step 5: Commit**

```bash
git add js/ui/media.js tests/media.test.js
git commit -m "feat(media): rework streams.js into media.js (news+cameras, video_id support)"
```

---

## Task 3: レイアウト restructure（index.html + css）

**Files:** Modify `index.html`, `css/orbis.css`

- [ ] **Step 1: Remove the `#streams` overlay and add `#media` section in index.html**

`index.html` の `#streams` ブロック全体（`<div id="streams" class="stream-bar collapsed">` ～ 対応する `</div>`）を削除する。
そして `#map-wrap` の閉じタグ `</div>`（`#app` 内・`#loading` を含む map-wrap の終わり）の**直後**に `#media` セクションを追加する:

```html
      <section id="media" class="media-section">
        <div class="media-head">
          <div class="media-cats">
            <button class="media-cat active" data-cat="news">📺 ニュース</button>
            <button class="media-cat" data-cat="cameras">📷 カメラ</button>
          </div>
          <span class="media-now">—</span>
        </div>
        <div class="media-player">
          <iframe id="media-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
        </div>
        <div id="media-selector" class="media-selector"></div>
      </section>
```

注: `#media` は `#app` の直下（`#map-wrap` と兄弟）に置くこと。`#map-wrap` 内ではない。

- [ ] **Step 2: Make the page scrollable + remove stream CSS + add media CSS**

`css/orbis.css` の冒頭3ブロックを次に置き換える（スクロール解禁・globe を 100vh 固定）:

```css
html, body { margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, "Segoe UI", sans-serif; overflow-x: hidden; }
#app { display: flex; flex-direction: column; }
#map-wrap { position: relative; height: 100vh; }
```

`.stream-*` の CSS ブロック（`/* 下部の YouTube Live バー... */` から `.stream-bar.collapsed .stream-body { display: none; }` まで）を**削除**し、ファイル末尾に `#media` のスタイルを追加:

```css
/* 下部メディア領域（スクロール大画面・ニュース/カメラ） */
.media-section { padding: 24px 16px 40px; max-width: 980px; margin: 0 auto; }
.media-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.media-cats { display: flex; gap: 8px; }
.media-cat { background: rgba(10, 18, 32, .6); border: 1px solid var(--line); color: var(--text);
  font-size: 13px; padding: 6px 14px; border-radius: 999px; cursor: pointer; }
.media-cat.active { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 10px rgba(57, 208, 255, .3); }
.media-now { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.media-player { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px;
  overflow: hidden; background: #000; border: 1px solid var(--glass-rim);
  box-shadow: 0 8px 40px rgba(0, 0, 0, .5); }
.media-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.media-selector { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.media-item { background: rgba(10, 18, 32, .6); border: 1px solid var(--line); color: var(--text);
  font-size: 12px; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.media-item.active { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 8px rgba(57, 208, 255, .3); }
```

- [ ] **Step 3: Sanity check (no JS changed)**

Run: `node --test tests/*.test.js`
Expected: PASS（変更なし・サニティ）。

- [ ] **Step 4: Commit**

```bash
git add index.html css/orbis.css
git commit -m "feat(media): scrollable layout + media section markup/styles; remove streams bar"
```

---

## Task 4: main.js 配線 ＋ sw v22

**Files:** Modify `js/main.js`, `sw.js`

- [ ] **Step 1: Replace the import**

`js/main.js` の `import { renderStreams, wireStreamsCollapse } from './ui/streams.js';` を次に置き換える:

```javascript
import { renderMedia } from './ui/media.js';
```

- [ ] **Step 2: Replace the streams mount block with the media mount block**

`map.on('load', async () => {...})` 内の旧 streams マウントブロック（`// 下部の YouTube Live バー…` から始まり `streamsRoot.style.display = 'none';` を含む try/catch 全体）を、次に置き換える:

```javascript
    // 下部メディア領域（ニュース/カメラ）。2 config を読み、選択で本拠地へ flyTo＋マーカー。
    const mediaRoot = document.getElementById('media');
    try {
      const [news, cameras] = await Promise.all([
        fetch('config/live_channels.json').then((r) => r.json()).catch(() => []),
        fetch('config/live_cameras.json').then((r) => r.json()).catch(() => []),
      ]);
      if ((Array.isArray(news) && news.length) || (Array.isArray(cameras) && cameras.length)) {
        const mediaApi = renderMedia(mediaRoot, { news, cameras }, {
          onSelect: (item) => {
            map.flyTo({ center: [item.lon, item.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: item.lon, lat: item.lat, title: item.name, layerId: 'media', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay); // 着地リティクル（マーカー）を表示
          },
        });
        // #media が画面に入ったら再生・離れたら停止（可視時のみ再生）。
        const io = new IntersectionObserver((entries) => {
          mediaApi.setPlaying(entries[0].isIntersecting);
        }, { threshold: 0.4 });
        io.observe(mediaRoot);
        if (window.__orbis) window.__orbis.media = mediaApi; // e2e/デバッグ用
      } else {
        mediaRoot.style.display = 'none';
      }
    } catch {
      mediaRoot.style.display = 'none';
    }
```

注: `selected`・`drawAll`・`overlay` は既存のスコープ内変数（`selected` はモジュール変数、`drawAll`/`overlay` は load ハンドラ内で利用可）。

- [ ] **Step 3: Bump sw**

`sw.js` の `const CACHE = 'orbis-v21';` を `const CACHE = 'orbis-v22';` に置き換える。

- [ ] **Step 4: Verify**

Run: `node --test tests/*.test.js`
Expected: PASS（全 node テスト緑）。

- [ ] **Step 5: Commit**

```bash
git add js/main.js sw.js
git commit -m "feat(media): mount media section + flyTo/marker + IntersectionObserver; sw v22"
```

---

## Task 5: 構造 e2e（streams.spec.js を media.spec.js に刷新）

**Files:**
- Delete: `tests/e2e/streams.spec.js`
- Create: `tests/e2e/media.spec.js`

- [ ] **Step 1: Delete old spec and write the new one**

```bash
git rm tests/e2e/streams.spec.js
```

`tests/e2e/media.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

// メディア領域の構造検証（描画/カテゴリ切替/src/flyTo/可視時再生）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('media section: render, category switch, src, flyTo, visibility play', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  const media = page.locator('#media');
  await expect(media).toHaveCount(1);

  // 設定を読む
  const news = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  const cams = await page.evaluate(async () => (await (await fetch('config/live_cameras.json')).json().catch(() => [])));
  expect(news.length).toBeGreaterThan(0);

  // 既定カテゴリ=ニュース。セレクタ件数 = news 件数。
  await expect(page.locator('#media-selector .media-item')).toHaveCount(news.length);

  // #media を可視化（IntersectionObserver で再生対象がセットされる）
  await page.locator('#media').scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const src0 = await page.locator('#media-frame').getAttribute('src');
  expect(src0).toContain(news[0].channel_id); // 既定=news 先頭が channel 形式で入る

  // ニュース項目クリックで flyTo（地図中心が変化）＋ src 更新
  if (news.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.media-item[data-id="${news[1].id}"]`).click();
    await page.waitForTimeout(1800);
    expect(await page.locator('#media-frame').getAttribute('src')).toContain(news[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // カメラタブに切替 → セレクタが cameras 件数になり、src が video_id 形式に
  if (cams.length > 0) {
    await page.locator('.media-cat[data-cat="cameras"]').click();
    await page.waitForTimeout(500);
    await expect(page.locator('#media-selector .media-item')).toHaveCount(cams.length);
    const srcC = await page.locator('#media-frame').getAttribute('src');
    expect(srcC).toContain(cams[0].video_id); // 既定カメラの video_id
  }

  // 上に戻ると不可視 → src 空（停止）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  expect(await page.locator('#media-frame').getAttribute('src')).toBeFalsy();
});
```

- [ ] **Step 2: Run e2e**

Run: `npx playwright test tests/e2e/media.spec.js`
Expected: PASS。失敗時は IntersectionObserver のタイミング（waitForTimeout を増やす）かセレクタの確認に限り調整。テストを弱めて通すのは禁止。実バグなら DONE_WITH_CONCERNS/BLOCKED で報告。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/media.spec.js
git commit -m "test(media): structural e2e (render/category/src/flyTo/visibility)"
```

---

## Task 6: 統合・本番デプロイ・実機サニティ・記憶整理

- [ ] **Step 1: Full suite**

Run: `node --test tests/*.test.js && python3 -m pytest -q && npx playwright test`
Expected: 全 node 緑（media 4）＋pytest 33 緑＋Playwright 3 緑（smoke/ship-projection/media、workers:1 直列）。

- [ ] **Step 2: Local Playwright sanity（スクショ）**

`playwright-skill` でローカル（`python3 -m http.server 8000`）を開き、下にスクロールして `#media` の大画面＋カテゴリタブ＋セレクタが出ること、カメラタブ切替でセレクタが変わることをスクショ確認（映像は headless では黒＝想定通り）。

- [ ] **Step 3: Merge to main and push**

ブランチで作業していた場合は main へマージ→`git push origin main`。push 拒否（cron data refresh 先行）時は `git fetch && git rebase origin/main` で解消。

- [ ] **Step 4: オーナーの実ブラウザサニティ**

`https://orbis-beta.vercel.app/` を実 Chrome/Edge で開き:
- 下にスクロール → `#media` の大画面でニュースが**実際に再生**される。
- [カメラ] タブ → 渋谷/タイムズスクエア等の街角ライブに切替・再生。
- 項目選択で地球儀が本拠地へ flyTo＋マーカー（上にスクロールで確認）。
- 上に戻ると停止。
- 映らないソースは config（live_channels.json / live_cameras.json）から削除/差替で調整可。

- [ ] **Step 5: 横断記憶の整理**

CLAUDE.md 方針に従い、自動メモリ（MEMORY.md＋project_orbis.md）と Obsidian（Projects/orbis.md）にメディア領域刷新の完了を記録。
`#streams`→`#media` 改称・スクロール構造・カメラ追加・採用カメラID・残課題（再生は実機・ライブID鮮度）を明示。サブA（翻訳ニュース）が次である旨を残す。

---

## Self-Review（記録）

- **Spec coverage:** スクロール構造(Task3)・大画面＋カテゴリタブ＋セレクタ(Task2 renderMedia, Task3 markup/css)・カメラ源YouTube/video_id対応(Task1, Task2 buildEmbedUrl)・flyTo+マーカー(Task4 onSelect)・可視時再生IntersectionObserver(Task4)・streams→media改称(Task2)・2 config(Task1, Task4)・sw v22(Task4)・テスト node/e2e(Task2,5)・実機再生(Task6) — 全 spec 項目に対応。
- **Placeholder scan:** TBD/TODO なし。カメラIDは実測済み・Task1で再検証しDROP curate（プレースホルダではない）。
- **Type consistency:** `buildEmbedUrl(item)`/`defaultItem`/`itemById`/`renderMedia`(返り値 `{select, selectCategory, current, setPlaying}`) はタスク間一貫。DOM id/クラス（`#media`/`#media-frame`/`#media-selector`/`.media-cat[data-cat]`/`.media-item[data-id]`/`.media-now`）は markup・css・media.js・e2e で一致。`window.__orbis.media` 露出。`selected`/`drawAll`/`overlay` は既存。configキー `channel_id`/`video_id`/`lat`/`lon`/`name`/`region`/`id` 一貫。
```
