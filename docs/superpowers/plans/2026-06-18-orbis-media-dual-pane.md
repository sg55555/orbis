# メディア領域 2ペイン化（ニュース｜地域カメラ監視） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#media` を左右50/50フル幅の2ペイン（左=ニュース局タブ＋大プレーヤー／右=地域タブ×分割1/4/6のサムネ＋選択1再生カメラ監視）に再設計する。

**Architecture:** `js/ui/media.js`（純粋ヘルパ＋`renderMedia`オーケストレーション）から、`js/ui/news-pane.js`（局タブ＋単一プレーヤー）と `js/ui/cams-pane.js`（地域タブ＋分割＋サムネグリッド＋選択再生）を分離。カメラには地域コード `area` を持たせ、サムネは `i.ytimg.com` 静止画。同時再生は左ニュース＋右選択カメラの最大2本、`IntersectionObserver` で可視時のみ。

**Tech Stack:** Vanilla JS(ESM) / MapLibre flyTo / YouTube埋め込み＋サムネ(キー不要) / IntersectionObserver / node --test / Playwright。

参照 spec: `docs/superpowers/specs/2026-06-18-orbis-media-dual-pane-design.md`

**重要制約:** headless Chromium は YouTube を再生(decode)できない（[[youtube-embed-headless-no-playback]]）。自動テストは構造（描画・タブ切替・分割・src・flyTo・可視時src設定）のみ。再生はオーナー実ブラウザ確認。

---

## File Structure

- Modify: `config/live_cameras.json` — 各カメラに `area` 追加＋各地域カメラ収集・拡充（検証済みID）
- Rework: `js/ui/media.js` — 純粋ヘルパ拡充（thumbUrl/areasPresent/camsByArea/gridCount/gridSlots＋AREA_ORDER/AREA_LABEL）＋`renderMedia`をオーケストレーションに
- Create: `js/ui/news-pane.js` — `renderNewsPane`（局タブ＋単一プレーヤー）
- Create: `js/ui/cams-pane.js` — `renderCamsPane`（地域タブ＋分割モード＋サムネグリッド＋選択1再生）
- Modify: `tests/media.test.js` — 純粋ヘルパのテスト拡充
- Modify: `index.html` — `#media` を2ペイン markup に
- Modify: `css/orbis.css` — フル幅2カラム＋グリッド＋セル＋タブCSS（旧 .media-cat/.media-item/.media-selector 等を置換）
- Modify: `js/main.js` — `renderMedia` 呼びの onSelect で space カメラの flyTo を除外
- Modify: `sw.js` — CACHE v22→v23
- Modify: `tests/e2e/media.spec.js` — 2ペイン構造 e2e に更新

---

## Task 1: カメラ設定に area 追加＋地域カメラ収集（検証済みID）

**Files:** Modify `config/live_cameras.json`

- [ ] **Step 1: 既存5カメラに area を付与**

`config/live_cameras.json` を次に更新（既存5カメラに `area` 追加）:

```json
[
  { "id": "shibuya", "name": "渋谷スクランブル交差点", "region": "東京", "area": "asia", "lat": 35.66, "lon": 139.70, "video_id": "8H3nRCFVR6Y" },
  { "id": "timessquare", "name": "Times Square", "region": "ニューヨーク", "area": "americas", "lat": 40.758, "lon": -73.985, "video_id": "z-jYdOIKcTQ" },
  { "id": "london", "name": "London Live", "region": "ロンドン", "area": "europe", "lat": 51.51, "lon": -0.13, "video_id": "M3EYAY2MftI" },
  { "id": "paris", "name": "Paris / Eiffel", "region": "パリ", "area": "europe", "lat": 48.86, "lon": 2.29, "video_id": "OzYp4NRZlwQ" },
  { "id": "venice", "name": "Venice", "region": "ヴェネツィア", "area": "europe", "lat": 45.44, "lon": 12.34, "video_id": "a1mcaV3Sf9U" }
]
```

- [ ] **Step 2: 各地域のライブカメラ候補をYouTubeライブ検索で収集**

`/tmp/cam-discover.js` を作成（ライブ絞り込み検索→候補 videoId 抽出）:

```javascript
const { chromium } = require('playwright');
// 各地域の街角/都市ライブを検索。地域コードは config の area に対応。
const QUERIES = [
  { area: 'middle_east', region: 'ドバイ', lat: 25.20, lon: 55.27, q: 'dubai live camera' },
  { area: 'middle_east', region: 'イスタンブール', lat: 41.01, lon: 28.98, q: 'istanbul live camera' },
  { area: 'europe', region: 'ローマ', lat: 41.90, lon: 12.50, q: 'rome live camera street' },
  { area: 'europe', region: 'アムステルダム', lat: 52.37, lon: 4.90, q: 'amsterdam live camera' },
  { area: 'americas', region: 'マイアミ', lat: 25.79, lon: -80.13, q: 'miami beach live camera' },
  { area: 'americas', region: 'ラスベガス', lat: 36.17, lon: -115.14, q: 'las vegas live camera' },
  { area: 'asia', region: 'ソウル', lat: 37.57, lon: 126.98, q: 'seoul live camera street' },
  { area: 'asia', region: 'バンコク', lat: 13.75, lon: 100.50, q: 'bangkok live camera street' },
  { area: 'africa', region: 'ケープタウン', lat: -33.92, lon: 18.42, q: 'cape town live camera' },
  { area: 'africa', region: 'サファリ', lat: -24.40, lon: 31.49, q: 'africa safari live camera waterhole' },
  { area: 'oceania', region: 'シドニー', lat: -33.86, lon: 151.21, q: 'sydney live camera harbour' },
  { area: 'oceania', region: 'クイーンズタウン', lat: -45.03, lon: 168.66, q: 'queenstown live camera' },
  { area: 'space', region: '宇宙（ISS）', lat: 0, lon: 0, q: 'ISS live earth from space' },
  { area: 'space', region: '宇宙（地球）', lat: 0, lon: 0, q: 'live earth from space nasa' },
];
(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const item of QUERIES) {
    const page = await browser.newPage();
    try {
      await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(item.q)}&sp=EgJAAQ%253D%253D`,
        { waitUntil: 'domcontentloaded', timeout: 25000 });
      await page.waitForTimeout(3500);
      const ids = await page.evaluate(() => {
        const out = []; const seen = new Set();
        const re = /"videoId":"([\w-]{11})"/g; let m;
        const html = document.documentElement.innerHTML;
        while ((m = re.exec(html)) && out.length < 5) { if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]); } }
        return out;
      });
      console.log(`[${item.area}] ${item.region} (${item.q}) -> ${JSON.stringify(ids)}`);
    } catch (e) { console.log(`[${item.area}] ${item.region} ERR ${e.message.slice(0, 50)}`); }
    await page.close();
  }
  await browser.close();
})();
```

Run: `cd ~/.claude/plugins/cache/playwright-skill/playwright-skill/*/skills/playwright-skill && node run.js /tmp/cam-discover.js`

各地域・各都市について先頭の候補 videoId を控える（地域あたり都市2つ×候補数）。

- [ ] **Step 3: 候補IDの埋め込み再検証（DROP curate）**

控えた候補で `config/live_cameras.json` に**仮追加**（既存5件＋各地域の候補。idは `area` と都市のローマ字、name/region は上記 QUERIES の region を都市名として、lat/lon も QUERIES の値を使う）。例:
```json
{ "id": "dubai", "name": "Dubai", "region": "ドバイ", "area": "middle_east", "lat": 25.20, "lon": 55.27, "video_id": "<候補>" }
```
（spaceカメラは `lat:0, lon:0` のまま・region は「宇宙（ISS）」等。）

`/tmp/cam-check.js` を作成（埋め込み構築可否を実測）:

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
    console.log(`${ok ? 'OK  ' : 'DROP'} ${c.area}/${c.id} (${c.video_id}) ${note}`);
    await page.close();
  }
  await browser.close();
})();
```

Run: `cd ~/.claude/plugins/cache/playwright-skill/playwright-skill/*/skills/playwright-skill && node run.js /tmp/cam-check.js`

判定:
- `OK` のみ残し `DROP`/`ERR` は削除。
- **各地域は集まった分でよい（最低0でも可＝空地域タブは出さない仕様）。全体で既存5＋新規が混在**。1地域あたり最大6（6分割枠ぶん）あれば十分、それ以上は採らない。
- 候補が全滅した地域はスキップ（その地域タブは出ない）。**最終的に既存5カメラ＋OKだった新規**で `config/live_cameras.json` を確定。

- [ ] **Step 4: JSON 妥当性確認**

Run: `cd ~/apps/orbis && node -e "const c=require('./config/live_cameras.json'); console.log('count', c.length); console.log('areas', [...new Set(c.map(x=>x.area))]); c.forEach(x=>{if(!x.id||!x.name||!x.area||x.lat==null||x.lon==null||!x.video_id) throw new Error('bad '+x.id)});"`
Expected: count（5以上）・areas 一覧表示・例外なし。

- [ ] **Step 5: Commit**

```bash
cd ~/apps/orbis
git add config/live_cameras.json
git commit -m "feat(media): add area codes + regional live cameras (verified)"
```

---

## Task 2: media.js 純粋ヘルパ拡充 ＋ tests

**Files:** Modify `js/ui/media.js`, `tests/media.test.js`

- [ ] **Step 1: 失敗するテストを書く — `tests/media.test.js` を次の内容に置換**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEmbedUrl, thumbUrl, defaultItem, itemById,
  areasPresent, camsByArea, gridCount, gridSlots, AREA_LABEL,
} from '../js/ui/media.js';

const NEWS = [
  { id: 'aljazeera', name: 'Al Jazeera English', channel_id: 'UCNye-wNBqNL5ZzHSJj3l8Bg', region: 'ドーハ', lat: 25.28, lon: 51.53 },
  { id: 'dw', name: 'DW News', channel_id: 'UCknLrEdhRCp1aegoMqRaCZg', region: 'ベルリン', lat: 52.52, lon: 13.40 },
];
const CAMS = [
  { id: 'shibuya', name: '渋谷', region: '東京', area: 'asia', video_id: '8H3nRCFVR6Y', lat: 35.66, lon: 139.70 },
  { id: 'london', name: 'London', region: 'ロンドン', area: 'europe', video_id: 'M3EYAY2MftI', lat: 51.51, lon: -0.13 },
  { id: 'paris', name: 'Paris', region: 'パリ', area: 'europe', video_id: 'OzYp4NRZlwQ', lat: 48.86, lon: 2.29 },
];

test('buildEmbedUrl: channel_id 形式', () => {
  const u = buildEmbedUrl(NEWS[0]);
  assert.ok(u.startsWith('https://www.youtube.com/embed/live_stream?channel=UCNye-wNBqNL5ZzHSJj3l8Bg'));
  assert.ok(u.includes('autoplay=1') && u.includes('mute=1'));
});

test('buildEmbedUrl: video_id 形式', () => {
  const u = buildEmbedUrl(CAMS[0]);
  assert.ok(u.startsWith('https://www.youtube.com/embed/8H3nRCFVR6Y?'));
  assert.ok(u.includes('playsinline=1') && !u.includes('live_stream'));
});

test('thumbUrl: video_id あり/なし', () => {
  assert.equal(thumbUrl(CAMS[0]), 'https://i.ytimg.com/vi/8H3nRCFVR6Y/hqdefault.jpg');
  assert.equal(thumbUrl({ id: 'x', channel_id: 'C' }), '');
});

test('defaultItem / itemById', () => {
  assert.equal(defaultItem(NEWS), NEWS[0]);
  assert.equal(defaultItem([]), null);
  assert.equal(defaultItem(null), null);
  assert.equal(itemById(CAMS, 'paris'), CAMS[2]);
  assert.equal(itemById(CAMS, 'nope'), null);
  assert.equal(itemById(null, 'x'), null);
});

test('areasPresent: 実在areaを定義順＋先頭all・空除外', () => {
  // CAMS は asia, europe を含む。定義順は middle_east,europe,americas,asia,... なので europe が asia より前。
  assert.deepEqual(areasPresent(CAMS), ['all', 'europe', 'asia']);
  assert.deepEqual(areasPresent([]), ['all']);
});

test('camsByArea: all=全件 / 指定=フィルタ / 不一致=空', () => {
  assert.equal(camsByArea(CAMS, 'all').length, 3);
  assert.deepEqual(camsByArea(CAMS, 'europe').map((c) => c.id), ['london', 'paris']);
  assert.deepEqual(camsByArea(CAMS, 'africa'), []);
});

test('gridCount: 1/4/6 維持・不正は4', () => {
  assert.equal(gridCount(1), 1);
  assert.equal(gridCount(4), 4);
  assert.equal(gridCount(6), 6);
  assert.equal(gridCount(3), 4);
  assert.equal(gridCount('6'), 6);
});

test('gridSlots: 先頭count枚＋不足はnullパディング', () => {
  assert.deepEqual(gridSlots(CAMS, 1).map((s) => s && s.id), ['shibuya']);
  assert.deepEqual(gridSlots(CAMS, 4).map((s) => s && s.id), ['shibuya', 'london', 'paris', null]);
  assert.equal(gridSlots(CAMS, 6).length, 6);
});

test('AREA_LABEL: 主要キーが日本語', () => {
  assert.equal(AREA_LABEL.all, 'すべて');
  assert.equal(AREA_LABEL.space, '宇宙');
  assert.equal(AREA_LABEL.middle_east, '中東');
});
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/apps/orbis && node --test tests/media.test.js`
Expected: FAIL（`thumbUrl`/`areasPresent` 等が未 export）。

- [ ] **Step 3: media.js のヘルパ部分を実装（renderMedia は Task5 で差し替えるため、この Step では先頭のヘルパ群のみ追加し、既存 renderMedia は一旦残す）**

`js/ui/media.js` の先頭（`export function buildEmbedUrl` の前後）を次の構成にする。既存 `buildEmbedUrl`/`defaultItem`/`itemById` は残し、**新ヘルパと定数を追加**する（ファイル冒頭コメント直後に定数、各ヘルパを追記）:

```javascript
// メディア領域。左=ニュース(news-pane)／右=地域カメラ(cams-pane)。本ファイルは純粋ヘルパ＋renderMediaオーケストレーション。

// 地域コード（定義順）。areasPresent はこの順で実在分のみ返す。
export const AREA_ORDER = ['middle_east', 'europe', 'americas', 'asia', 'africa', 'oceania', 'space'];
export const AREA_LABEL = {
  all: 'すべて', middle_east: '中東', europe: 'ヨーロッパ', americas: 'アメリカ',
  asia: 'アジア', africa: 'アフリカ', oceania: 'オセアニア', space: '宇宙',
};

// キー不要のライブ埋め込みURL。video_id 優先（固定ライブ動画）、無ければ channel_id（チャンネルlive）。
export function buildEmbedUrl(item) {
  const base = item.video_id
    ? `https://www.youtube.com/embed/${item.video_id}`
    : `https://www.youtube.com/embed/live_stream?channel=${item.channel_id}`;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}autoplay=1&mute=1&playsinline=1`;
}

// キー不要のサムネ静止画。video_id 無しは空（プレースホルダにフォールバック）。
export function thumbUrl(item) {
  return item.video_id ? `https://i.ytimg.com/vi/${item.video_id}/hqdefault.jpg` : '';
}

export function defaultItem(items) {
  return (Array.isArray(items) && items.length) ? items[0] : null;
}

export function itemById(items, id) {
  return (Array.isArray(items) ? items : []).find((c) => c.id === id) || null;
}

// cams に実在する area を AREA_ORDER 順で返し、先頭に 'all'。空 area は含めない。
export function areasPresent(cams) {
  const present = new Set((Array.isArray(cams) ? cams : []).map((c) => c.area).filter(Boolean));
  return ['all', ...AREA_ORDER.filter((a) => present.has(a))];
}

// area='all' なら全件、else area 一致でフィルタ。
export function camsByArea(cams, area) {
  const arr = Array.isArray(cams) ? cams : [];
  return area === 'all' ? arr.slice() : arr.filter((c) => c.area === area);
}

// 分割モードの枠数。1/4/6 はそのまま、不正は 4。
export function gridCount(mode) {
  return [1, 4, 6].includes(Number(mode)) ? Number(mode) : 4;
}

// 先頭 count 枚＋不足は null パディングしたグリッド枠配列。
export function gridSlots(cams, count) {
  const arr = (Array.isArray(cams) ? cams : []).slice(0, count);
  while (arr.length < count) arr.push(null);
  return arr;
}
```

（注: 既存の `renderMedia`（24〜89行）はこの Step では削除せず残す。Task5 で差し替える。重複 export を避けるため、`buildEmbedUrl`/`defaultItem`/`itemById` は**上記の新定義に統合し、旧定義は削除**して二重定義にしないこと。）

- [ ] **Step 4: テスト緑を確認**

Run: `cd ~/apps/orbis && node --test tests/media.test.js`
Expected: 9 テスト PASS。
Run: `node --check js/ui/media.js`
Expected: exit 0（構文OK・旧 renderMedia 残置でも可）。

- [ ] **Step 5: Commit**

```bash
cd ~/apps/orbis
git add js/ui/media.js tests/media.test.js
git commit -m "feat(media): pure helpers for thumbnails/areas/grid (TDD)"
```

---

## Task 3: news-pane.js（局タブ＋単一プレーヤー）

**Files:** Create `js/ui/news-pane.js`

- [ ] **Step 1: `js/ui/news-pane.js` を作成**

```javascript
// ニュースペイン：局タブ＋単一大プレーヤー。可視時のみ再生。
import { buildEmbedUrl, defaultItem, itemById } from './media.js';

// paneEl=#media-news。onSelect(item) は局選択時（flyTo 等）。返り値 {select,current,setPlaying}。
export function renderNewsPane(paneEl, news, { onSelect } = {}) {
  const frame = paneEl.querySelector('#news-frame');
  const tabsEl = paneEl.querySelector('#news-tabs');
  const nowEl = paneEl.querySelector('.news-now');
  let curId = defaultItem(news) ? defaultItem(news).id : null;
  let visible = false;

  function highlight() {
    tabsEl.querySelectorAll('.news-tab').forEach((t) => t.classList.toggle('active', t.dataset.id === curId));
  }
  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }
  function play() { const it = itemById(news, curId); if (visible && it) frame.src = buildEmbedUrl(it); }

  function select(id) {
    const it = itemById(news, id);
    if (!it) return;
    curId = id;
    highlight();
    setNow(it);
    if (visible) frame.src = buildEmbedUrl(it);
    if (onSelect) onSelect(it);
  }

  tabsEl.innerHTML = '';
  for (const it of news) {
    const b = document.createElement('button');
    b.className = 'news-tab';
    b.dataset.id = it.id;
    b.textContent = it.name;
    b.addEventListener('click', () => select(it.id));
    tabsEl.appendChild(b);
  }
  highlight();
  setNow(itemById(news, curId));

  return {
    select,
    current: () => curId,
    setPlaying(on) { visible = on; if (on) play(); else frame.src = ''; },
  };
}
```

- [ ] **Step 2: 構文確認**

Run: `cd ~/apps/orbis && node --check js/ui/news-pane.js`
Expected: exit 0。
Run: `node --test tests/media.test.js`
Expected: 9 PASS（既存ヘルパ不変・サニティ）。

- [ ] **Step 3: Commit**

```bash
cd ~/apps/orbis
git add js/ui/news-pane.js
git commit -m "feat(media): news pane (station tabs + single player)"
```

---

## Task 4: cams-pane.js（地域タブ＋分割＋サムネ＋選択1再生）

**Files:** Create `js/ui/cams-pane.js`

- [ ] **Step 1: `js/ui/cams-pane.js` を作成**

```javascript
// カメラペイン：地域タブ × 分割モード(1/4/6) × サムネグリッド ＋ 選択1枚だけ再生。
import {
  buildEmbedUrl, thumbUrl, itemById,
  areasPresent, camsByArea, gridCount, gridSlots, AREA_LABEL,
} from './media.js';

// paneEl=#media-cams。onSelect(item) はカメラ選択時（flyTo 等。space は呼び出し側で除外）。
// 返り値 {selectArea,setMode,selectCam,current,setPlaying}。
export function renderCamsPane(paneEl, cams, { onSelect } = {}) {
  const tabsEl = paneEl.querySelector('#area-tabs');
  const modeEl = paneEl.querySelector('#mode-btns');
  const gridEl = paneEl.querySelector('#cams-grid');
  const nowEl = paneEl.querySelector('.cams-now');
  let area = 'all';
  let mode = 4;
  let curId = null;
  let visible = false;

  const list = () => camsByArea(cams, area);

  function setNow(it) { if (nowEl) nowEl.textContent = it ? `${it.name}｜${it.region}` : '—'; }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const a of areasPresent(cams)) {
      const b = document.createElement('button');
      b.className = 'area-tab';
      b.dataset.area = a;
      b.textContent = AREA_LABEL[a] || a;
      b.classList.toggle('active', a === area);
      b.addEventListener('click', () => selectArea(a));
      tabsEl.appendChild(b);
    }
  }
  function highlightMode() {
    modeEl.querySelectorAll('.mode-btn').forEach((m) => m.classList.toggle('active', Number(m.dataset.mode) === mode));
  }
  function highlightCells() {
    gridEl.querySelectorAll('.cam-cell').forEach((c) => c.classList.toggle('active', c.dataset.id === curId));
  }
  // 選択セルだけ iframe 再生・他はサムネ。可視時のみ再生。
  function playCells() {
    const it = itemById(cams, curId);
    gridEl.querySelectorAll('.cam-cell').forEach((c) => {
      const f = c.querySelector('iframe');
      const img = c.querySelector('img');
      const isCur = c.dataset.id === curId;
      if (isCur && visible && it) {
        if (img) img.style.display = 'none';
        if (f) f.src = buildEmbedUrl(it);
      } else {
        if (f) f.src = '';
        if (img) img.style.display = '';
      }
    });
  }
  function renderGrid() {
    const cols = mode === 6 ? 3 : mode === 4 ? 2 : 1;
    gridEl.className = `cams-grid cols-${cols}`;
    gridEl.innerHTML = '';
    for (const it of gridSlots(list(), gridCount(mode))) {
      const cell = document.createElement('div');
      cell.className = 'cam-cell';
      if (!it) {
        cell.classList.add('empty');
        cell.innerHTML = '<span class="cam-label">—</span>';
        gridEl.appendChild(cell);
        continue;
      }
      cell.dataset.id = it.id;
      const t = thumbUrl(it);
      const img = document.createElement('img');
      if (t) { img.src = t; img.alt = ''; cell.appendChild(img); }
      const f = document.createElement('iframe');
      f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
      f.setAttribute('allowfullscreen', '');
      cell.appendChild(f);
      const label = document.createElement('span');
      label.className = 'cam-label';
      label.textContent = it.name;
      cell.appendChild(label);
      cell.addEventListener('click', () => selectCam(it.id));
      gridEl.appendChild(cell);
    }
    highlightCells();
    playCells();
  }

  function selectCam(id) {
    const it = itemById(cams, id);
    if (!it) return;
    curId = id;
    setNow(it);
    highlightCells();
    playCells();
    if (onSelect) onSelect(it);
  }
  function selectArea(a) {
    area = a;
    renderTabs();
    const first = list()[0];
    curId = first ? first.id : null;
    renderGrid();
    setNow(itemById(cams, curId));
    if (curId && onSelect) onSelect(itemById(cams, curId));
  }
  function setMode(n) {
    mode = gridCount(n);
    highlightMode();
    // 選択カメラが新枠内に残らなければ先頭に。
    const slots = gridSlots(list(), gridCount(mode));
    if (!slots.some((s) => s && s.id === curId)) {
      const first = list()[0];
      curId = first ? first.id : null;
    }
    renderGrid();
    setNow(itemById(cams, curId));
  }

  modeEl.querySelectorAll('.mode-btn').forEach((m) => m.addEventListener('click', () => setMode(Number(m.dataset.mode))));

  // 初期化（onSelect は呼ばない＝ロード時 flyTo を避ける）。
  curId = list()[0] ? list()[0].id : null;
  renderTabs();
  highlightMode();
  renderGrid();
  setNow(itemById(cams, curId));

  return {
    selectArea,
    setMode,
    selectCam,
    current: () => ({ area, mode, id: curId }),
    setPlaying(on) { visible = on; playCells(); },
  };
}
```

- [ ] **Step 2: 構文確認**

Run: `cd ~/apps/orbis && node --check js/ui/cams-pane.js`
Expected: exit 0。

- [ ] **Step 3: Commit**

```bash
cd ~/apps/orbis
git add js/ui/cams-pane.js
git commit -m "feat(media): cameras pane (region tabs + split modes + thumb/select-play)"
```

---

## Task 5: media.js renderMedia をオーケストレーションに刷新

**Files:** Modify `js/ui/media.js`

- [ ] **Step 1: 旧 renderMedia を削除し、新 renderMedia を追記**

`js/ui/media.js` の**旧 `renderMedia`（カテゴリタブ＋単一プレーヤー実装）を削除**し、ファイル末尾（ヘルパ群の後）に次を追加:

```javascript
import { renderNewsPane } from './news-pane.js';
import { renderCamsPane } from './cams-pane.js';

// 2ペインをマウントし可視制御を伝播。lists={news,cameras}。onSelect(item) は両ペイン共通（flyTo 等）。
// 返り値 {news,cams,setPlaying}。
export function renderMedia(rootEl, { news = [], cameras = [] } = {}, { onSelect } = {}) {
  const newsEl = rootEl.querySelector('#media-news');
  const camsEl = rootEl.querySelector('#media-cams');
  let newsApi = null;
  let camsApi = null;

  if (Array.isArray(news) && news.length && newsEl) newsApi = renderNewsPane(newsEl, news, { onSelect });
  else if (newsEl) newsEl.style.display = 'none';

  if (Array.isArray(cameras) && cameras.length && camsEl) camsApi = renderCamsPane(camsEl, cameras, { onSelect });
  else if (camsEl) camsEl.style.display = 'none';

  return {
    news: newsApi,
    cams: camsApi,
    setPlaying(on) {
      if (newsApi) newsApi.setPlaying(on);
      if (camsApi) camsApi.setPlaying(on);
    },
  };
}
```

注: ESM の `import` 文はファイル先頭にホイストされるため、`renderNewsPane`/`renderCamsPane` の import 行はファイル**冒頭**（最初のコメント行の直後・`export const AREA_ORDER` の前）に移動して書いてよい。末尾 import でも動くが、冒頭に置くのが読みやすい。実装者はどちらか一貫した位置に置くこと。

- [ ] **Step 2: 検証**

Run: `cd ~/apps/orbis && node --check js/ui/media.js && node --test tests/media.test.js`
Expected: 構文OK・9 テスト PASS（ヘルパ不変）。

- [ ] **Step 3: Commit**

```bash
cd ~/apps/orbis
git add js/ui/media.js
git commit -m "feat(media): renderMedia orchestrates news + cameras panes"
```

---

## Task 6: index.html 2ペイン markup ＋ css

**Files:** Modify `index.html`, `css/orbis.css`

- [ ] **Step 1: `index.html` の `#media` セクションを2ペインに置換**

現在の `<section id="media" class="media-section"> … </section>`（media-head/media-player/media-selector を含む）を次に置換:

```html
      <section id="media" class="media-section">
        <div id="media-news" class="media-pane">
          <div class="pane-head">
            <h3 class="pane-title">📺 ニュース</h3>
            <div class="news-tabs" id="news-tabs"></div>
          </div>
          <div class="media-player">
            <iframe id="news-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
          </div>
          <div class="pane-now news-now">—</div>
        </div>
        <div id="media-cams" class="media-pane">
          <div class="pane-head">
            <h3 class="pane-title">📷 ライブカメラ</h3>
            <div class="cams-controls">
              <div class="area-tabs" id="area-tabs"></div>
              <div class="mode-btns" id="mode-btns">
                <button class="mode-btn" data-mode="1">1</button>
                <button class="mode-btn active" data-mode="4">4</button>
                <button class="mode-btn" data-mode="6">6</button>
              </div>
            </div>
          </div>
          <div class="cams-grid cols-2" id="cams-grid"></div>
          <div class="pane-now cams-now">—</div>
        </div>
      </section>
```

- [ ] **Step 2: `css/orbis.css` の `.media-*` ブロックを置換**

Task(前回)で追加した `.media-section`〜`.media-item.active` のブロック（`/* 下部メディア領域（スクロール大画面・ニュース/カメラ） */` から `.media-item.active { … }` まで）を**削除**し、次に置換:

```css
/* 下部メディア領域（2ペイン: ニュース｜地域カメラ・フル幅50/50） */
.media-section { display: flex; gap: 16px; padding: 24px 16px 40px; }
.media-pane { flex: 1 1 0; min-width: 0; }
.pane-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
.pane-title { margin: 0; font-size: 15px; color: var(--text); white-space: nowrap; letter-spacing: .02em; }
.news-tabs, .area-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
.cams-controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.news-tab, .area-tab { background: rgba(10, 18, 32, .6); border: 1px solid var(--line); color: var(--text);
  font-size: 12px; padding: 5px 12px; border-radius: 999px; cursor: pointer; }
.news-tab.active, .area-tab.active { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 8px rgba(57, 208, 255, .3); }
.mode-btns { display: flex; gap: 4px; }
.mode-btn { background: rgba(10, 18, 32, .6); border: 1px solid var(--line); color: var(--text);
  font-size: 12px; width: 28px; height: 26px; border-radius: 6px; cursor: pointer; }
.mode-btn.active { border-color: var(--cyan); color: var(--cyan); box-shadow: 0 0 8px rgba(57, 208, 255, .3); }
.media-player { position: relative; width: 100%; aspect-ratio: 16 / 9; border-radius: 12px;
  overflow: hidden; background: #000; border: 1px solid var(--glass-rim); box-shadow: 0 8px 40px rgba(0, 0, 0, .5); }
.media-player iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.cams-grid { display: grid; gap: 8px; }
.cams-grid.cols-1 { grid-template-columns: 1fr; }
.cams-grid.cols-2 { grid-template-columns: 1fr 1fr; }
.cams-grid.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
.cam-cell { position: relative; aspect-ratio: 16 / 9; border-radius: 8px; overflow: hidden;
  background: #000; border: 1px solid var(--line); cursor: pointer; }
.cam-cell.active { border-color: var(--cyan); box-shadow: 0 0 10px rgba(57, 208, 255, .35); }
.cam-cell img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cam-cell iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
.cam-cell .cam-label { position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 6px;
  font-size: 11px; color: var(--text); background: linear-gradient(transparent, rgba(0, 0, 0, .7));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cam-cell.empty { background: rgba(10, 18, 32, .4); cursor: default; }
.cam-cell.empty .cam-label { background: none; color: var(--muted); text-align: center; }
.pane-now { font-size: 12px; color: var(--muted); margin-top: 10px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 860px) { .media-section { flex-direction: column; } }
```

- [ ] **Step 3: サニティ**

Run: `cd ~/apps/orbis && node --test tests/*.test.js`
Expected: 全 PASS（JS未変更・サニティ）。
Run: `grep -n "media-cat\|media-item\|media-selector\|media-frame" index.html css/orbis.css`
Expected: 出力なし（旧クラス/idの残骸ゼロ）。report に貼る。

- [ ] **Step 4: Commit**

```bash
cd ~/apps/orbis
git add index.html css/orbis.css
git commit -m "feat(media): two-pane markup + full-width 50/50 styles + camera grid"
```

---

## Task 7: main.js 配線（space flyTo除外）＋ sw v23

**Files:** Modify `js/main.js`, `sw.js`

- [ ] **Step 1: onSelect に space 除外を追加**

`js/main.js` の media マウントブロック内 `renderMedia(...)` の `onSelect` を次に置換（既存は `onSelect: (item) => { map.flyTo(...); selected = ...; drawAll(overlay); }`）:

```javascript
        const mediaApi = renderMedia(mediaRoot, { news, cameras }, {
          onSelect: (item) => {
            if (item.area === 'space') return; // 宇宙カメラは地上座標が無いので flyTo/マーカーしない
            map.flyTo({ center: [item.lon, item.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: item.lon, lat: item.lat, title: item.name, layerId: 'media', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
```

（IntersectionObserver ブロック・`window.__orbis.media = mediaApi`・config fetch は既存のまま不変。）

- [ ] **Step 2: sw 版数を上げる**

`sw.js` の `const CACHE = 'orbis-v22';` を `const CACHE = 'orbis-v23';` に置換。

- [ ] **Step 3: 検証**

Run: `cd ~/apps/orbis && node --check js/main.js && node --test tests/*.test.js`
Expected: 構文OK・全 PASS。

- [ ] **Step 4: Commit**

```bash
cd ~/apps/orbis
git add js/main.js sw.js
git commit -m "feat(media): wire dual-pane mount (space flyTo skip); sw v23"
```

---

## Task 8: 構造 e2e 更新（media.spec.js）

**Files:** Modify `tests/e2e/media.spec.js`

- [ ] **Step 1: `tests/e2e/media.spec.js` を次に置換**

```javascript
import { test, expect } from '@playwright/test';

// 2ペイン メディア領域の構造検証（描画/局タブ/地域タブ/分割/サムネ選択src/flyTo/可視制御）。
// 注: 映像の再生(decode)は headless Chromium のコーデック制約で不可のためアサートしない。
test('media dual-pane: news + cameras structure', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // 2ペイン存在
  await expect(page.locator('#media-news')).toHaveCount(1);
  await expect(page.locator('#media-cams')).toHaveCount(1);

  const news = await page.evaluate(async () => (await (await fetch('config/live_channels.json')).json()));
  const cams = await page.evaluate(async () => (await (await fetch('config/live_cameras.json')).json().catch(() => [])));
  expect(news.length).toBeGreaterThan(0);
  expect(cams.length).toBeGreaterThan(0);

  // 局タブ件数 = news 件数
  await expect(page.locator('#news-tabs .news-tab')).toHaveCount(news.length);

  // 可視化 → news/選択cam の src がセットされる
  await page.locator('#media').scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#news-frame').getAttribute('src'), { timeout: 3000 }).toBeTruthy();
  expect(await page.locator('#news-frame').getAttribute('src')).toContain(news[0].channel_id);

  // 局タブ切替で news-frame src 更新＋flyTo
  if (news.length > 1) {
    const before = await page.evaluate(() => window.__orbis.map.getCenter());
    await page.locator(`.news-tab[data-id="${news[1].id}"]`).click();
    await page.waitForTimeout(1800);
    expect(await page.locator('#news-frame').getAttribute('src')).toContain(news[1].channel_id);
    const after = await page.evaluate(() => window.__orbis.map.getCenter());
    expect(after.lng !== before.lng || after.lat !== before.lat).toBe(true);
  }

  // 地域タブ：先頭は「すべて」、2つ以上あるはず
  const areaTabs = page.locator('#area-tabs .area-tab');
  expect(await areaTabs.count()).toBeGreaterThanOrEqual(1);
  await expect(areaTabs.first()).toHaveText('すべて');

  // 分割モード切替：4→6でセル数変化（6枠 or 6分割）
  await page.locator('.mode-btn[data-mode="6"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(6);
  await page.locator('.mode-btn[data-mode="1"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(1);
  await page.locator('.mode-btn[data-mode="4"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('#cams-grid .cam-cell')).toHaveCount(4);

  // サムネ(非empty セル)クリックで該当セルが iframe 再生 src を持つ
  const firstCell = page.locator('#cams-grid .cam-cell:not(.empty)').first();
  await firstCell.click();
  await page.waitForTimeout(500);
  const cellSrc = await firstCell.locator('iframe').getAttribute('src');
  expect(cellSrc).toBeTruthy();
  expect(cellSrc).toContain('youtube.com/embed/');

  // 上に戻ると不可視 → news/cam の src 空（停止）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  expect(await page.locator('#news-frame').getAttribute('src')).toBeFalsy();
  const anyCamSrc = await page.locator('#cams-grid .cam-cell iframe').evaluateAll(
    (frames) => frames.map((f) => f.getAttribute('src')).filter(Boolean),
  );
  expect(anyCamSrc.length).toBe(0);
});
```

- [ ] **Step 2: e2e 実行**

Run: `cd ~/apps/orbis && npx playwright test tests/e2e/media.spec.js`
Expected: PASS。

**失敗時の方針（厳守）:** タイミング起因は `waitForTimeout`/`expect.poll` の調整のみ許可。セレクタ名は実DOMと一致確認のみ調整可。**アサートを削って通すのは禁止。** 実装バグが疑われる場合は DONE_WITH_CONCERNS/BLOCKED で「どのアサートがどの実値で落ちたか」を具体報告。

- [ ] **Step 3: 全 e2e サニティ**

Run: `npx playwright test`
Expected: smoke / ship-projection / media すべて PASS（workers:1 直列）。

- [ ] **Step 4: Commit**

```bash
cd ~/apps/orbis
git add tests/e2e/media.spec.js
git commit -m "test(media): dual-pane structural e2e (tabs/areas/split/select/visibility)"
```

---

## Task 9: 統合・本番デプロイ・実機サニティ・記憶整理

- [ ] **Step 1: 全スイート**

Run: `cd ~/apps/orbis && node --test tests/*.test.js && python3 -m pytest -q && npx playwright test`
Expected: 全 node 緑（media ヘルパ9）＋pytest 33 緑＋Playwright 3 緑。

- [ ] **Step 2: ローカル視覚サニティ（スクショ）**

`playwright-skill` でローカル（`python3 -m http.server <port>`）を開き、下スクロールで:
- 左ペイン「📺 ニュース」＝局タブ5＋大プレーヤー、右ペイン「📷 ライブカメラ」＝地域タブ＋[1][4][6]＋サムネグリッド、左右が画面端まで50/50。
- 地域タブ切替でグリッドのカメラが変わる・分割[1/4/6]で枠数が変わる・サムネクリックで選択枠が再生（headless では枠は黒＝想定通り）。
スクショ2〜3枚で確認。

- [ ] **Step 3: main へマージ＆ push**

ブランチ `media-dual-pane` で作業していた場合は main へ ff マージ→`git push origin main`。push 拒否（cron data refresh 先行）時は `git fetch origin && git rebase origin/main` で解消し再 push。

- [ ] **Step 4: 本番デプロイ確認（curl）**

```bash
sleep 25
curl -s -o /dev/null -w "%{http_code}\n" https://orbis-beta.vercel.app/js/ui/news-pane.js
curl -s -o /dev/null -w "%{http_code}\n" https://orbis-beta.vercel.app/js/ui/cams-pane.js
curl -s https://orbis-beta.vercel.app/sw.js | grep -m1 CACHE
curl -s https://orbis-beta.vercel.app/ | grep -o 'id="media-cams"'
```
Expected: news-pane.js 200 / cams-pane.js 200 / `orbis-v23` / `id="media-cams"`。

- [ ] **Step 5: オーナーの実ブラウザサニティ**

`https://orbis-beta.vercel.app/` を実 Chrome/Edge で開き:
- 下スクロール → 左ニュース大画面が**実際に再生**・右カメラグリッド表示。
- 局タブで切替・flyTo。地域タブ[中東/欧州/米/アジア/宇宙/アフリカ/オセアニア]切替。分割[1/4/6]。サムネクリックで選択カメラが再生＋flyTo（宇宙は flyTo なし）。
- 上スクロールで両停止。映らないソースは config から削除/差替で調整可。

- [ ] **Step 6: 横断記憶の整理**

CLAUDE.md 方針に従い、自動メモリ（MEMORY.md＋project_orbis.md）と Obsidian（Projects/orbis.md）に2ペイン化の完了を記録。`#media` 2ペイン構造・news-pane/cams-pane 分離・area 地域コード・採用カメラ（地域別）・分割1/4/6＋サムネ選択再生・sw v23・残課題（再生は実機・ライブID鮮度）を明示。サブA（翻訳ニュース）が次である旨を残す。

---

## Self-Review（記録）

- **Spec coverage:** 左右50/50フル幅(Task6 css)・見出し＋上部タブ統一(Task6 markup)・ニュース独立局タブ(Task3)・地域タブ8種＋空タブ非表示(Task2 areasPresent, Task4 renderTabs)・分割1/4/6(Task2 gridCount, Task4 setMode, Task6 cols)・サムネ＋選択1再生(Task2 thumbUrl/gridSlots, Task4 playCells)・最大2本同時(Task5 setPlaying伝播)・可視時のみ(Task7 IO既存)・space flyTo除外(Task7)・config area追加＋収集(Task1)・3ファイル分離(Task3/4/5)・sw v23(Task7)・node/e2e(Task2,8)・実機(Task9) — 全 spec 項目に対応。
- **Placeholder scan:** TBD/TODO なし。カメラID収集は Task1 で discover→verify→DROP の実行手順（プレースホルダでなく作業）。
- **Type consistency:** ヘルパ名 `buildEmbedUrl`/`thumbUrl`/`defaultItem`/`itemById`/`areasPresent`/`camsByArea`/`gridCount`/`gridSlots`＋定数 `AREA_ORDER`/`AREA_LABEL` はタスク間一貫。ペイン関数 `renderNewsPane(paneEl,news,{onSelect})`→`{select,current,setPlaying}`／`renderCamsPane(paneEl,cams,{onSelect})`→`{selectArea,setMode,selectCam,current,setPlaying}`／`renderMedia(rootEl,{news,cameras},{onSelect})`→`{news,cams,setPlaying}` 一貫。DOM id/クラス（`#media-news`/`#media-cams`/`#news-frame`/`#news-tabs`/`.news-tab[data-id]`/`#area-tabs`/`.area-tab[data-area]`/`#mode-btns`/`.mode-btn[data-mode]`/`#cams-grid`/`.cam-cell[data-id]`/`.cams-grid.cols-N`/`.news-now`/`.cams-now`）は markup・css・JS・e2e で一致。config キー `id`/`name`/`region`/`area`/`lat`/`lon`/`video_id` 一貫。`window.__orbis.media` 露出（既存）。`selected`/`drawAll`/`overlay` は既存スコープ。
