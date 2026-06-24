# YouTube Live 下部グリッド Implementation Plan（P3 サブプロジェクトB）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ORBIS 下部に世界ニュースのライブ配信バー `#streams` を追加し、1画面で再生しながらチャンネルを切替え、選択チャンネルの本拠地へ地球儀を flyTo する。

**Architecture:** 既存の `#panel`/`#feed` と同様に `#map-wrap` 内へ絶対配置の折りたたみ式バーを追加。単一 `<iframe>` がキー不要の YouTube ライブ埋め込み（`embed/live_stream?channel=ID`）をミュート自動再生し、横並びタブで切替。チャンネルは `config/live_channels.json`（非機密・ブラウザfetch）で駆動。純粋ヘルパは `js/ui/streams.js`、描画も同ファイル。

**Tech Stack:** Vanilla JS(ESM, no build) / MapLibre `map.flyTo` / YouTube IFrame 埋め込み(key不要) / node --test / Playwright。

参照 spec: `docs/superpowers/specs/2026-06-18-orbis-youtube-live-design.md`

**重要な制約:** playwright 同梱の headless Chromium は YouTube のコーデック(H.264等)/Widevine を持たず**映像を再生(decode)できない**（通常動画も含む。実測済）。よって自動テストは「プレーヤー構築・タブ切替・src・flyTo」のみ検証し、**再生のアサートはしない**。実際の再生確認はオーナーの実ブラウザサニティ（Task 6）。

---

## File Structure

- Create: `config/live_channels.json` — チャンネル定義（id/name/channel_id/region/lat/lon）
- Create: `js/ui/streams.js` — 純粋ヘルパ（buildEmbedUrl/defaultChannel/channelById）＋描画（renderStreams/wireStreamsCollapse）
- Create: `tests/streams.test.js` — 純粋ヘルパの node テスト
- Modify: `index.html` — `#streams` バー markup を `#map-wrap` 内（`#loading` の前）に追加
- Modify: `css/orbis.css` — 下部バーのスタイル
- Modify: `js/main.js` — config fetch＋renderStreams マウント＋onSelectでflyTo＋折りたたみ配線
- Modify: `sw.js` — CACHE v20→v21
- Create: `tests/e2e/streams.spec.js` — 構造e2e（描画/トグル/タブ数/src/flyTo）

---

## Task 1: チャンネル設定 ＋ 埋め込みロード検証

**Files:**
- Create: `config/live_channels.json`

- [ ] **Step 1: Create the config file**

`config/live_channels.json`:

```json
[
  { "id": "aljazeera", "name": "Al Jazeera English", "channel_id": "UCNye-wNBqNL5ZzHSJj3l8Bg", "region": "ドーハ", "lat": 25.28, "lon": 51.53 },
  { "id": "dw", "name": "DW News", "channel_id": "UCknLrEdhRCp1aegoMqRaCZg", "region": "ベルリン", "lat": 52.52, "lon": 13.40 },
  { "id": "france24", "name": "France 24 English", "channel_id": "UCQfwfsi5VrQ8yKZ-UWmAEFg", "region": "パリ", "lat": 48.86, "lon": 2.35 },
  { "id": "skynews", "name": "Sky News", "channel_id": "UCoMdktPbSTixAyNGwb-UYkQ", "region": "ロンドン", "lat": 51.51, "lon": -0.13 },
  { "id": "nhk", "name": "NHK World-Japan", "channel_id": "UCSPEjw8F2nQDtmUKPFNF7_A", "region": "東京", "lat": 35.68, "lon": 139.69 },
  { "id": "bloomberg", "name": "Bloomberg Television", "channel_id": "UCIALMKvObZNtJ6AmdCLP7Lg", "region": "ニューヨーク", "lat": 40.71, "lon": -74.01 },
  { "id": "euronews", "name": "euronews", "channel_id": "UCSrZ3UV4jOidv8ppoVuvW9Q", "region": "リヨン", "lat": 45.76, "lon": 4.84 }
]
```

- [ ] **Step 2: Structural embeddability check (Playwright, network)**

各 `channel_id` の `embed/live_stream?channel=ID` を実ブラウザで開き、`<video>` 要素（プレーヤー）が構築されるかを確認する。
`/tmp/yt-channel-check.js`:

```javascript
const { chromium } = require('playwright');
const fs = require('fs');
const channels = JSON.parse(fs.readFileSync(process.cwd() + '/config/live_channels.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const ch of channels) {
    const page = await browser.newPage();
    let hasVideo = false, note = '';
    try {
      await page.goto(`https://www.youtube.com/embed/live_stream?channel=${ch.channel_id}&autoplay=1&mute=1`, { waitUntil: 'load', timeout: 25000 });
      await page.waitForTimeout(5000);
      hasVideo = await page.evaluate(() => !!document.querySelector('video'));
      if (!hasVideo) note = (await page.locator('body').textContent().catch(() => '')).replace(/\s+/g, ' ').slice(0, 60);
    } catch (e) { note = 'ERR ' + e.message.slice(0, 50); }
    console.log(`${hasVideo ? 'OK  ' : 'DROP'} ${ch.id} (${ch.channel_id}) ${note}`);
    await page.close();
  }
  await browser.close();
})();
```

Run: `cd ~/.claude/plugins/cache/playwright-skill/playwright-skill/*/skills/playwright-skill && node run.js /tmp/yt-channel-check.js`
Expected: AJ/DW/France24 は `OK`。`DROP` になったチャンネルは `config/live_channels.json` から削除する（プレーヤーが構築されない＝IDが無効/ライブ無し）。最低3件（AJ/DW/France24）が残ればよい。

注: 再生(decode)は headless では起きない。ここで見るのは「プレーヤーが構築されるか」のみ。最終的な"実際に映るか"は Task 6 の実ブラウザ確認。

- [ ] **Step 3: Commit (curated config)**

```bash
git add config/live_channels.json
git commit -m "feat(streams): curated live news channel config"
```

---

## Task 2: streams.js（純粋ヘルパ TDD ＋ 描画）

**Files:**
- Create: `js/ui/streams.js`
- Test: `tests/streams.test.js`

- [ ] **Step 1: Write the failing test**

`tests/streams.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmbedUrl, defaultChannel, channelById } from '../js/ui/streams.js';

const CH = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];

test('buildEmbedUrl: channel_id を埋め込み autoplay/mute を含む', () => {
  const u = buildEmbedUrl(CH[0]);
  assert.ok(u.includes('channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
  assert.ok(u.includes('autoplay=1'));
  assert.ok(u.includes('mute=1'));
  assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream'));
});

test('defaultChannel: 先頭を返す / 空配列・非配列は null', () => {
  assert.equal(defaultChannel(CH), CH[0]);
  assert.equal(defaultChannel([]), null);
  assert.equal(defaultChannel(null), null);
});

test('channelById: 一致を返す / 不一致は null', () => {
  assert.equal(channelById(CH, 'dw'), CH[1]);
  assert.equal(channelById(CH, 'nope'), null);
  assert.equal(channelById(null, 'dw'), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/streams.test.js`
Expected: FAIL（`Cannot find module '../js/ui/streams.js'`）

- [ ] **Step 3: Write streams.js**

`js/ui/streams.js`:

```javascript
// 下部の YouTube Live バー。1画面再生＋チャンネル選択＋本拠地flyTo。
// 純粋ヘルパ（URL生成・選択ロジック）＋描画（renderStreams/wireStreamsCollapse）。

// キー不要のライブ埋め込みURL（autoplay はミュート必須・iOS向け playsinline）。
export function buildEmbedUrl(channel) {
  return `https://www.youtube.com/embed/live_stream?channel=${channel.channel_id}&autoplay=1&mute=1&playsinline=1`;
}

export function defaultChannel(channels) {
  return (Array.isArray(channels) && channels.length) ? channels[0] : null;
}

export function channelById(channels, id) {
  return (Array.isArray(channels) ? channels : []).find((c) => c.id === id) || null;
}

// バーを描画。onSelect(channel) はタブ選択時に呼ばれる（flyTo 等）。
// 返り値 API: select(id) / setOpen(open) / currentId()。
export function renderStreams(rootEl, channels, { onSelect } = {}) {
  const frame = rootEl.querySelector('#stream-frame');
  const tabsEl = rootEl.querySelector('#stream-tabs');
  const nowEl = rootEl.querySelector('.stream-now');
  let currentId = defaultChannel(channels) ? defaultChannel(channels).id : null;

  tabsEl.innerHTML = '';
  for (const ch of channels) {
    const b = document.createElement('button');
    b.className = 'stream-tab';
    b.dataset.id = ch.id;
    b.textContent = ch.name;
    b.addEventListener('click', () => select(ch.id));
    tabsEl.appendChild(b);
  }

  function highlight() {
    tabsEl.querySelectorAll('.stream-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.id === currentId);
    });
  }
  function isOpen() { return !rootEl.classList.contains('collapsed'); }
  function setNow(ch) { if (nowEl && ch) nowEl.textContent = `${ch.name}｜${ch.region}`; }

  function select(id) {
    const ch = channelById(channels, id);
    if (!ch) return;
    currentId = id;
    highlight();
    setNow(ch);
    if (isOpen()) frame.src = buildEmbedUrl(ch); // 開いている時だけ再生
    if (onSelect) onSelect(ch);
  }

  highlight();
  setNow(channelById(channels, currentId));

  return {
    select,
    currentId: () => currentId,
    // 折りたたみ開閉に応じて再生を制御（隠れた所での再生を避ける）。
    setOpen(open) {
      const ch = channelById(channels, currentId);
      if (open && ch) frame.src = buildEmbedUrl(ch);
      else frame.src = '';
    },
  };
}

// 折りたたみトグルの配線。api は renderStreams の返り値。
export function wireStreamsCollapse(barEl, btnEl, api) {
  btnEl.addEventListener('click', () => {
    barEl.classList.toggle('collapsed');
    api.setOpen(!barEl.classList.contains('collapsed'));
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/streams.test.js`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add js/ui/streams.js tests/streams.test.js
git commit -m "feat(streams): pure helpers + bar render/collapse"
```

---

## Task 3: index.html マークアップ ＋ CSS

**Files:**
- Modify: `index.html`
- Modify: `css/orbis.css`

- [ ] **Step 1: Add markup**

`index.html` の `#map-wrap` 内、`<div id="loading">` の直前に追加:

```html
      <div id="streams" class="stream-bar collapsed">
        <div class="stream-head">
          <button id="streams-toggle" class="collapse-btn" aria-label="ライブ折りたたみ">🔴 LIVE</button>
          <span class="stream-now">—</span>
        </div>
        <div class="stream-body">
          <div class="stream-player">
            <iframe id="stream-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
          </div>
          <div id="stream-tabs" class="stream-tabs"></div>
        </div>
      </div>
```

（`<iframe>` に `src` は付けない＝既定折りたたみ・初期再生なし。）

- [ ] **Step 2: Add CSS**

`css/orbis.css` の末尾に追加:

```css
/* 下部の YouTube Live バー（折りたたみ式・1画面再生＋タブ） */
.stream-bar { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 6;
  max-width: 760px; margin: 0 auto; padding: 8px 10px; border-radius: 12px;
  background: var(--glass-bg); border: 1px solid var(--glass-rim);
  backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: blur(var(--glass-blur)); }
.stream-head { display: flex; align-items: center; gap: 10px; }
.stream-head .collapse-btn { width: auto; padding: 2px 8px; font-size: 11px; letter-spacing: .06em; }
.stream-now { font-size: 11px; color: var(--muted); letter-spacing: .04em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stream-body { margin-top: 8px; }
.stream-player { position: relative; width: 100%; aspect-ratio: 16 / 9;
  border-radius: 8px; overflow: hidden; background: #000; border: 1px solid var(--line); }
.stream-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.stream-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.stream-tab { background: rgba(10, 18, 32, .6); border: 1px solid var(--line); color: var(--text);
  font-size: 11px; padding: 4px 8px; border-radius: 999px; cursor: pointer; }
.stream-tab.active { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 8px rgba(57, 208, 255, .3); }
.stream-bar.collapsed .stream-body { display: none; }
```

- [ ] **Step 3: Commit**

```bash
git add index.html css/orbis.css
git commit -m "feat(streams): bottom bar markup + glass styling"
```

---

## Task 4: main.js 配線 ＋ sw v21

**Files:**
- Modify: `js/main.js`
- Modify: `sw.js`

- [ ] **Step 1: Add import**

`js/main.js` の import 群（`import { renderFeed, wireCollapse as wireFeedCollapse } from './ui/feed.js';` の下あたり）に追加:

```javascript
import { renderStreams, wireStreamsCollapse } from './ui/streams.js';
```

- [ ] **Step 2: Mount streams in the map 'load' handler**

`js/main.js` の `map.on('load', async () => { ... })` 内、`startPolling(...)` 呼び出しの直前に追加:

```javascript
    // 下部の YouTube Live バー（config 駆動・選択で本拠地へ flyTo・既定折りたたみ）。
    const streamsRoot = document.getElementById('streams');
    try {
      const channels = await (await fetch('config/live_channels.json')).json();
      if (Array.isArray(channels) && channels.length) {
        const streamsApi = renderStreams(streamsRoot, channels, {
          onSelect: (ch) => map.flyTo({ center: [ch.lon, ch.lat], zoom: 4, duration: 1500, essential: true }),
        });
        wireStreamsCollapse(streamsRoot, document.getElementById('streams-toggle'), streamsApi);
        if (window.__orbis) window.__orbis.streams = streamsApi; // e2e/デバッグ用
      } else {
        streamsRoot.style.display = 'none';
      }
    } catch {
      streamsRoot.style.display = 'none';
    }
```

- [ ] **Step 3: Bump service worker cache**

`sw.js` の `const CACHE = 'orbis-v20';` を次に置き換える:

```javascript
const CACHE = 'orbis-v21';
```

- [ ] **Step 4: Verify full JS suite still passes**

Run: `node --test tests/*.test.js`
Expected: PASS（既存＋streams 3 件が緑）

- [ ] **Step 5: Commit**

```bash
git add js/main.js sw.js
git commit -m "feat(streams): mount bar + flyTo on select; sw v21"
```

---

## Task 5: 構造 e2e

**Files:**
- Create: `tests/e2e/streams.spec.js`

- [ ] **Step 1: Write the e2e spec**

`tests/e2e/streams.spec.js`:

```javascript
import { test, expect } from '@playwright/test';

// YouTube Live バーの構造検証（描画/トグル/タブ/ src / flyTo）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('streams bar: render, toggle, tabs, src, flyTo', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 既定は折りたたみ・iframe src 空
  const bar = page.locator('#streams');
  await expect(bar).toHaveClass(/collapsed/);
  expect(await page.locator('#stream-frame').getAttribute('src')).toBeFalsy();

  // タブ数 = config 件数
  const channels = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  expect(channels.length).toBeGreaterThan(0);
  await expect(page.locator('#stream-tabs .stream-tab')).toHaveCount(channels.length);

  // 展開すると先頭チャンネルが再生対象になる（src に channel_id が入る）
  await page.locator('#streams-toggle').click();
  await expect(bar).not.toHaveClass(/collapsed/);
  await page.waitForTimeout(200);
  const src0 = await page.locator('#stream-frame').getAttribute('src');
  expect(src0).toContain(channels[0].channel_id);
  expect(src0).toContain('mute=1');

  // 2件以上あれば、別タブクリックで src 切替＋地図が本拠地へ flyTo
  if (channels.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.stream-tab[data-id="${channels[1].id}"]`).click();
    await page.waitForTimeout(1800); // flyTo 完了待ち
    const src1 = await page.locator('#stream-frame').getAttribute('src');
    expect(src1).toContain(channels[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // 折りたたむと src が空（再生停止）
  await page.locator('#streams-toggle').click();
  await expect(bar).toHaveClass(/collapsed/);
  await page.waitForTimeout(150);
  expect(await page.locator('#stream-frame').getAttribute('src')).toBeFalsy();
});
```

- [ ] **Step 2: Run e2e**

Run: `npx playwright test tests/e2e/streams.spec.js`
Expected: PASS（描画・トグル・タブ数・src・flyTo・停止が緑。再生は非アサート）

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/streams.spec.js
git commit -m "test(streams): structural e2e (render/toggle/tabs/src/flyTo)"
```

---

## Task 6: 統合・本番デプロイ・実機サニティ・記憶整理

- [ ] **Step 1: Full test suite**

Run: `node --test tests/*.test.js && python3 -m pytest -q`
Expected: 全 node 緑（streams 3 追加）＋pytest 緑（変化なし）。

- [ ] **Step 2: Local Playwright structural sanity（任意・スクショ）**

`playwright-skill` でローカル（`python3 -m http.server 8000`）を開き、`#streams-toggle` を開いてバー（プレーヤー枠＋タブ）が出ることをスクショ確認。
※映像は headless では映らない（黒画面）— これは想定通り。

- [ ] **Step 3: Merge to main and push**

ブランチで作業していた場合は main へマージ→`git push origin main`。
push 拒否（collect cron の data refresh 先行）時は `git fetch && git rebase origin/main` で解消（コード/データ非競合）。

- [ ] **Step 4: オーナーの実ブラウザサニティ（再生の最終確認）**

`https://orbis-beta.vercel.app/` を実 Chrome/Edge で開き:
- 「🔴 LIVE」を開く → 既定チャンネルの**ライブ映像が実際に流れる**（音はミュート）。
- タブ切替で配信が変わる＋地球儀が本拠地へ flyTo。
- 折りたたむと停止。
- 映らないチャンネルがあれば `config/live_channels.json` から削除（config だけで調整可）。

- [ ] **Step 5: 横断記憶の整理**

CLAUDE.md 方針に従い、自動メモリ（MEMORY.md 索引＋project_orbis.md）と Obsidian（Projects/orbis.md）に
本サブプロジェクトB完了を記録。spec/plan パス・採用チャンネル・headless再生不可の知見（必要なら Knowledge ノート）を明示。
サブプロジェクトA（翻訳・地図連動ニュース）が次サイクルである旨も残す。

---

## Self-Review（記録）

- **Spec coverage:** 1画面再生＋タブ(Task2,3)・選択でflyTo(Task4)・既定折りたたみ＋開で再生/閉で停止(Task2 setOpen, Task3 markup, Task4)・config駆動(Task1,4)・キー不要埋め込み(Task2 buildEmbedUrl)・テスト node/e2e(Task2,5)・実ブラウザ再生確認(Task6)・チャンネル検証(Task1) — 全 spec 項目に対応タスクあり。
- **Placeholder scan:** TBD/TODO なし。channel_id は実在候補を記載し Task1 で検証・DROP する運用（プレースホルダではない）。
- **Type consistency:** `buildEmbedUrl`/`defaultChannel`/`channelById`/`renderStreams`(返り値 `{select, currentId, setOpen}`)/`wireStreamsCollapse(barEl, btnEl, api)` はタスク間で一貫。DOM id（`#streams`/`#streams-toggle`/`#stream-frame`/`#stream-tabs`/`.stream-now`/`.stream-tab`/`.stream-bar.collapsed`）は markup・CSS・JS・e2e で一致。`window.__orbis.streams` を e2e 用に露出。
```
