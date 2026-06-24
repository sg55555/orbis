# ORBIS 起動画面リッチ化 実装計画（③ 地球生成 ＋ 観測網テレメトリ 融合）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 起動画面を「星屑→経緯線 globe 生成＋大気ハロ＋実レイヤーのテレメトリ点呼」に作り替え、最小表示×map ready の合成で本物 globe へ溶暗 handoff する。

**Architecture:** DOM 非依存の純粋関数を `js/lib/boot-fx.js` に、canvas 描画＋テレメトリ＋handoff 制御を `js/ui/boot.js`（`initBoot()→controller`）に置く。`index.html` の `#loading` 内マークアップと `css/orbis.css` の `.boot*` を差し替え、`main.js` は `initBoot()` を起動し `map.on('load')` で `controller.requestHandoff()` を呼ぶ。

**Tech Stack:** Vanilla ESM（`"type":"module"`）、canvas 2D、CSS アニメーション、node:test、@playwright/test。

## Global Constraints

- 設計 spec：`docs/superpowers/specs/2026-06-20-orbis-boot-screen-design.md`。
- 採用＝③ globe 主導の融合。既定 variant=`12`。`?boot=1|2|3|12` / `?bootmin=<ms>`（既定 2400）で実機調整可。
- handoff＝「最小表示 minMs」AND「map ready」両満たしで `#loading` に `.hidden` を付与（既存 `transition: opacity .6s` でフェード）。
- 共有ファイル（`css/orbis.css` / `js/main.js` / `sw.js` 版番号）は**並行セッションと直列**。本作業の中心は新規 2 ファイル＋ `#loading` 部＋ `main.js` 1 行で衝突面を最小化。
- SW は**ネットワーク優先化済（main `d83eeda`）**＝版上げ原則不要。最終 Task で本番反映を curl/実機確認し、必要時のみ `sw.js` 版を上げる。
- **視覚の最終判定は実機**（headless≠実機GPU・mistakes.md）。e2e は構造/配線の回帰ガードに限定。
- 既存テストを緑に保つ：`npm run test:js`（`node --test tests/*.test.js`）と `npm run test:e2e`。特に `tests/e2e/smoke.spec.js` の「`#loading` が `hidden` になる」契約を壊さない。
- node テストは `import { test } from 'node:test'; import assert from 'node:assert/strict';`、`../js/lib/...` から import。

---

### Task 1: `js/lib/boot-fx.js` — DOM 非依存の純粋関数

**Files:**
- Create: `js/lib/boot-fx.js`
- Test: `tests/boot-fx.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `clamp(v,a,b): number` / `smooth(x:0..1): number` / `ease(t,a,b): number(0..1)`
  - `currentBootVariant(search?: string): '1'|'2'|'3'|'12'`（既定 `'12'`）
  - `bootMinMs(search?: string): number`（既定 `2400`）
  - `bootFeeds(variant: string): Array<[string,string]>`（`'2'`=7件 full、その他=5件 slim）
  - `remainingHold(elapsedMs, minMs): number`（`max(0, minMs-elapsed)`）
  - `progressFor(done, total): number(0..1)`
  - `project(latDeg, lonDeg, rot, tilt, R, cx, cy): {x,y,z}`（`z>0` が前面）

- [ ] **Step 1: 失敗するテストを書く**

Create `tests/boot-fx.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp, smooth, ease, currentBootVariant, bootMinMs,
  bootFeeds, remainingHold, progressFor, project,
} from '../js/lib/boot-fx.js';

test('clamp: 範囲内/外', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(0.5, 0, 1), 0.5);
});

test('smooth: 端点と中点、域外はクランプ', () => {
  assert.equal(smooth(0), 0);
  assert.equal(smooth(1), 1);
  assert.equal(smooth(0.5), 0.5);
  assert.equal(smooth(-1), 0);
  assert.equal(smooth(2), 1);
});

test('ease: 区間を 0..1 に正規化して smooth', () => {
  assert.equal(ease(50, 0, 100), 0.5);
  assert.equal(ease(-10, 0, 100), 0);
  assert.equal(ease(150, 0, 100), 1);
});

test('currentBootVariant: ?boot を読む・既定は 12', () => {
  assert.equal(currentBootVariant('?boot=1'), '1');
  assert.equal(currentBootVariant('?x=1&boot=3'), '3');
  assert.equal(currentBootVariant('?boot=12'), '12');
  assert.equal(currentBootVariant(''), '12');
  assert.equal(currentBootVariant('?boot=9'), '12');
});

test('bootMinMs: 既定2400・数値のみ採用', () => {
  assert.equal(bootMinMs('?bootmin=1000'), 1000);
  assert.equal(bootMinMs('?bootmin=0'), 0);
  assert.equal(bootMinMs(''), 2400);
  assert.equal(bootMinMs('?bootmin=abc'), 2400);
});

test('bootFeeds: 2=full(7) / その他=slim(5)・各要素は[名,状態]', () => {
  const full = bootFeeds('2');
  assert.equal(full.length, 7);
  const slim = bootFeeds('12');
  assert.equal(slim.length, 5);
  for (const f of full.concat(slim)) {
    assert.equal(Array.isArray(f), true);
    assert.equal(typeof f[0], 'string');
    assert.equal(typeof f[1], 'string');
  }
});

test('remainingHold: 最小表示までの残り（経過が min 以上なら 0）', () => {
  assert.equal(remainingHold(1000, 2400), 1400);
  assert.equal(remainingHold(3000, 2400), 0);
  assert.equal(remainingHold(0, 2400), 2400);
});

test('progressFor: 0..1・total<=0 は 0', () => {
  assert.equal(progressFor(0, 5), 0);
  assert.equal(progressFor(5, 5), 1);
  assert.equal(progressFor(2, 4), 0.5);
  assert.equal(progressFor(1, 0), 0);
});

test('project: 正面中心は z>0、裏面は z<0、縁は z≈0', () => {
  const c = project(0, 0, 0, 0, 100, 200, 200); // 赤道・本初子午線＝正面中心
  assert.ok(Math.abs(c.x - 200) < 1e-9 && Math.abs(c.y - 200) < 1e-9);
  assert.ok(c.z > 0.99);
  const back = project(0, 180, 0, 0, 100, 200, 200); // 裏側
  assert.ok(back.z < 0);
  const limb = project(0, 90, 0, 0, 100, 200, 200); // 縁
  assert.ok(Math.abs(limb.z) < 1e-9);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test:js -- tests/boot-fx.test.js`
Expected: FAIL（`Cannot find module '../js/lib/boot-fx.js'`）

- [ ] **Step 3: `js/lib/boot-fx.js` を実装**

```js
// js/lib/boot-fx.js — 起動画面の DOM 非依存な純粋関数（feed 定義・タイミング・ease・正射影・handoff）。
// node ユニットテストから直接 import する。canvas/DOM はここに置かない。

export function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
export function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }
export function ease(t, a, b) { return smooth((t - a) / (b - a)); }

function readSearch(search) {
  return typeof search === 'string'
    ? search
    : (typeof location !== 'undefined' ? location.search : '');
}

// ?boot=1|2|3|12（既定 12）。
export function currentBootVariant(search) {
  const m = /[?&]boot=(12|1|2|3)\b/.exec(readSearch(search) || '');
  return m ? m[1] : '12';
}

// ?bootmin=<ms>（既定 2400・0 以上の整数のみ採用）。
export function bootMinMs(search) {
  const m = /[?&]bootmin=(\d+)\b/.exec(readSearch(search) || '');
  return m ? Number(m[1]) : 2400;
}

// variant → テレメトリ feed 定義（[表示名, 状態語]）。2=full(7)、その他=slim(5)。
const FEEDS_FULL = [
  ['地震 USGS', '接続'], ['航空 ADS-B', '同期'], ['紛争・抗議 GDELT', '受信'],
  ['気温・水温 Open-Meteo', '取得'], ['船舶 AISStream', '接続'],
  ['海流・貿易ルート', '読込'], ['ニュース 翻訳', '起動'],
];
const FEEDS_SLIM = [
  ['地震網', ''], ['航空 ADS-B', ''], ['GDELT 紛争/抗議', ''], ['気象 全球', ''], ['ニュース', ''],
];
export function bootFeeds(variant) {
  return (variant === '2' ? FEEDS_FULL : FEEDS_SLIM).map((f) => f.slice());
}

// handoff ゲーティング：最小表示まで残り何 ms 保持するか（経過が min 以上なら 0）。
export function remainingHold(elapsedMs, minMs) { return Math.max(0, minMs - elapsedMs); }

// 進捗 0..1（total<=0 は 0）。
export function progressFor(done, total) { return total <= 0 ? 0 : clamp(done / total, 0, 1); }

// 正射影（球を正面から）。rot=経度回転, tilt=軸傾き。返り値 z>0 が前面（可視）。
export function project(latDeg, lonDeg, rot, tilt, R, cx, cy) {
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180 + rot;
  const x = Math.cos(la) * Math.sin(lo);
  const y = Math.sin(la);
  const z = Math.cos(la) * Math.cos(lo);
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const y2 = y * ct - z * st;
  const z2 = y * st + z * ct;
  return { x: cx + R * x, y: cy - R * y2, z: z2 };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npm run test:js -- tests/boot-fx.test.js`
Expected: PASS（9 tests）

- [ ] **Step 5: コミット**

```bash
git add js/lib/boot-fx.js tests/boot-fx.test.js
git commit -m "feat(boot): 起動画面の純粋関数(boot-fx)＋ユニットテスト"
```

---

### Task 2: 起動画面の構造とスタイル（`index.html` ＋ `css/orbis.css`）＋ 構造 e2e

**Files:**
- Modify: `index.html`（`#loading` 内のマークアップ差し替え）
- Modify: `css/orbis.css:34-59`（`.boot*` 群と関連 keyframes を差し替え。`#loading`/`#loading.hidden` の 30-33 は維持）
- Create: `tests/e2e/boot.spec.js`

**Interfaces:**
- Consumes: なし（この Task は静的構造とスタイルのみ。canvas 描画と handoff 制御は Task 3）
- Produces: DOM 要素 `#boot-fx` / `.boot-overlay` / `#boot-telemetry` / `.boot-word` / `.boot-sub` / `#boot-bar` / `.boot-rings`、`#loading[data-variant]`

> この Task の時点では `js/ui/boot.js` 未配線のため canvas は空・handoff は既存 `main.js` の `#loading.classList.add('hidden')`（line 359）で従来どおり行われる。e2e は「構造が存在し ORBIS が表示され、`#loading` が最終的に hidden になる」ことを確認する。

- [ ] **Step 1: `index.html` の `#loading` を差し替え**

`index.html` の現行（39-46 行）:

```html
      <div id="loading">
        <div class="boot">
          <div class="boot-rings"><span></span><span></span><span></span><i></i></div>
          <div class="boot-word">ORBIS</div>
          <div class="boot-sub">世界リアルタイム監視 — 起動中</div>
          <div class="boot-bar"><b></b></div>
        </div>
      </div>
```

を次に差し替える:

```html
      <div id="loading" data-variant="12">
        <canvas id="boot-fx" class="boot-fx"></canvas>
        <div class="boot-overlay">
          <div class="boot-aurora a1"></div>
          <div class="boot-aurora a2"></div>
          <div class="boot-rings">
            <span></span><span></span><span></span>
            <i class="boot-arc a1"></i><i class="boot-arc a2"></i><b class="boot-core"></b>
          </div>
          <ul id="boot-telemetry" class="boot-telemetry"></ul>
          <div class="boot-foot">
            <div class="boot-word">ORBIS</div>
            <div class="boot-sub" id="boot-sub">世界リアルタイム監視 — 起動中</div>
            <div class="boot-bar" id="boot-bar"><b></b></div>
          </div>
        </div>
      </div>
```

- [ ] **Step 2: `css/orbis.css` の `.boot*` ブロック（34-59 行）を差し替え**

34 行目の `/* 起動演出: ... */` コメントから 59 行目（`@media (prefers-reduced-motion: reduce){ .boot-rings i ... }`）までを削除し、次に置換する（30-33 行の `#loading` 規則は残す）:

```css
/* 起動演出（③ 地球生成＋観測網テレメトリ融合）。?boot=1|2|3|12 で variant 切替。 */
.boot-fx { position: absolute; inset: 0; z-index: 1; }
.boot-overlay { position: absolute; inset: 0; z-index: 2; }

/* オーロラの淡い光（背面で浮遊） */
.boot-aurora { position: absolute; border-radius: 50%; filter: blur(85px); opacity: .16;
  pointer-events: none; z-index: 0; animation: boot-aufloat 9s ease-in-out infinite; }
.boot-aurora.a1 { width: 520px; height: 300px; background: var(--cyan); top: 28%; left: 26%; }
.boot-aurora.a2 { width: 480px; height: 280px; background: #8a5cf6; top: 42%; right: 24%; animation-delay: -4.5s; }
@keyframes boot-aufloat { 0%,100% { transform: translateY(0) scale(1); } 50% { transform: translateY(28px) scale(1.06); } }

/* foot＝ワードマーク/サブ/バーを下部中央へ */
.boot-foot { position: absolute; left: 0; right: 0; bottom: 12vh; display: flex;
  flex-direction: column; align-items: center; gap: 13px; }
#loading[data-variant="3"] .boot-foot { bottom: 14vh; }

/* ワードマーク：字間が広→収束し glow が bloom */
.boot-word { font-size: 26px; font-weight: 700; letter-spacing: 1.1em; color: #eaf4ff;
  padding-left: 1.1em; opacity: 0; animation: boot-wordin 1.15s cubic-bezier(.2,.7,.2,1) .9s forwards; }
@keyframes boot-wordin {
  0% { opacity: 0; letter-spacing: 1.1em; filter: blur(7px); }
  55% { opacity: 1; filter: blur(0); }
  100% { opacity: 1; letter-spacing: .42em;
    text-shadow: 0 0 22px rgba(57,208,255,.55), 0 0 46px rgba(138,92,246,.32); }
}
.boot-sub { font-size: 11px; letter-spacing: .2em; color: var(--muted); opacity: 0;
  text-align: center; animation: boot-fadein .8s ease 1.55s forwards; }
@keyframes boot-fadein { to { opacity: 1; } }

/* 進捗バー */
.boot-bar { width: 194px; height: 2px; border-radius: 2px; overflow: hidden;
  background: rgba(57,208,255,.12); opacity: 1; }
.boot-bar b { display: block; height: 100%; border-radius: 2px; }
.boot-bar.shimmer b { width: 40%;
  background: linear-gradient(90deg, transparent, var(--cyan), rgba(138,92,246,.9), transparent);
  animation: boot-shimmer 1.3s ease-in-out infinite; }
@keyframes boot-shimmer { 0% { transform: translateX(-120%); } 100% { transform: translateX(320%); } }
.boot-bar.fill b { width: var(--p, 0%);
  background: linear-gradient(90deg, var(--cyan), #8a5cf6); box-shadow: 0 0 10px rgba(57,208,255,.4);
  transition: width .35s ease; }

/* テレメトリ（観測網点呼） */
.boot-telemetry { position: absolute; left: 50%; transform: translateX(-50%);
  list-style: none; margin: 0; padding: 0; display: none; flex-direction: column; gap: 6px;
  font-size: 12.5px; font-variant-numeric: tabular-nums; width: min(440px, 82vw); }
#loading[data-variant="2"] .boot-telemetry { display: flex; top: 31%; }
#loading[data-variant="12"] .boot-telemetry { display: flex; top: 57%; gap: 3px; font-size: 11px;
  width: min(360px, 78vw); opacity: .95; }
.boot-telemetry li { display: flex; align-items: center; gap: 9px; opacity: 0; transform: translateY(5px);
  color: var(--muted); letter-spacing: .02em; }
.boot-telemetry li.in { opacity: 1; transform: none; transition: opacity .32s, transform .32s; }
.boot-telemetry li .nm { color: var(--text); }
#loading[data-variant="2"] .boot-telemetry li .nm { min-width: 182px; }
.boot-telemetry li .dots { flex: 1; color: #21344c; overflow: hidden; white-space: nowrap; letter-spacing: .18em; }
.boot-telemetry li .st { color: var(--muted); min-width: 42px; text-align: right; }
.boot-telemetry li.ok .st { color: #5effa6; text-shadow: 0 0 9px rgba(94,255,166,.45); }
.boot-telemetry .online { justify-content: center; color: var(--cyan); letter-spacing: .18em;
  font-weight: 600; text-shadow: 0 0 13px rgba(57,208,255,.5); }

/* 同心リング（variant 3）。多重軌道＋発光コア */
.boot-rings { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
  width: 118px; height: 118px; display: none; }
#loading[data-variant="3"] .boot-rings { display: block; }
.boot-rings span { position: absolute; inset: 0; margin: auto; border-radius: 50%;
  border: 1px solid rgba(57,208,255,.16); }
.boot-rings span:nth-child(1) { width: 118px; height: 118px; }
.boot-rings span:nth-child(2) { width: 80px; height: 80px; border-color: rgba(138,92,246,.22); }
.boot-rings span:nth-child(3) { width: 44px; height: 44px; border-color: rgba(57,208,255,.30); }
.boot-rings .boot-arc { position: absolute; inset: 0; margin: auto; border-radius: 50%;
  border: 2px solid transparent; }
.boot-rings .boot-arc.a1 { width: 118px; height: 118px; border-top-color: var(--cyan);
  box-shadow: 0 0 16px rgba(57,208,255,.5); animation: boot-spin 1.5s linear infinite; }
.boot-rings .boot-arc.a2 { width: 80px; height: 80px; border-bottom-color: rgba(138,92,246,.85);
  box-shadow: 0 0 14px rgba(138,92,246,.45); animation: boot-spin 2.3s linear infinite reverse; }
.boot-rings .boot-core { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px;
  border-radius: 50%; transform: translate(-50%, -50%); background: var(--cyan);
  box-shadow: 0 0 16px 3px rgba(57,208,255,.7); animation: boot-corepulse 1.8s ease-in-out infinite; }
@keyframes boot-spin { to { transform: rotate(360deg); } }
@keyframes boot-corepulse { 0%,100% { opacity: .6; transform: translate(-50%,-50%) scale(.8); }
  50% { opacity: 1; transform: translate(-50%,-50%) scale(1.25); } }

@media (prefers-reduced-motion: reduce) {
  .boot-aurora, .boot-bar.shimmer b, .boot-rings .boot-arc.a1, .boot-rings .boot-arc.a2,
  .boot-rings .boot-core { animation: none; }
  .boot-word { animation: none; opacity: 1; letter-spacing: .42em;
    text-shadow: 0 0 22px rgba(57,208,255,.55); }
  .boot-sub { animation: none; opacity: 1; }
}
```

- [ ] **Step 3: 構造 e2e を書く（`tests/e2e/boot.spec.js`）**

```js
import { test, expect } from '@playwright/test';

test('起動画面: 構造と ORBIS 表示、map ready で #loading が hidden になる', async ({ page }) => {
  test.setTimeout(60000); // WSL2 の WebGL globe 起動は既定30sに張り付くため延長
  await page.goto('/');
  await expect(page.locator('#boot-fx')).toHaveCount(1);
  await expect(page.locator('#loading .boot-word')).toHaveText('ORBIS');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });
});
```

- [ ] **Step 4: テストを実行**

Run: `npm run test:e2e -- boot.spec.js`
Expected: PASS（構造あり・ORBIS 表示・`#loading` が hidden）

- [ ] **Step 5: 既存 e2e の回帰がないことを確認**

Run: `npm run test:e2e -- smoke.spec.js`
Expected: PASS（`#loading`→hidden 契約は維持）

- [ ] **Step 6: コミット**

```bash
git add index.html css/orbis.css tests/e2e/boot.spec.js
git commit -m "feat(boot): 起動画面の構造とスタイル(globe/テレメトリ/リング)＋構造e2e"
```

---

### Task 3: `js/ui/boot.js`（canvas FX＋テレメトリ＋handoff）＋ `main.js` 配線

**Files:**
- Create: `js/ui/boot.js`
- Modify: `js/main.js`（import 追加・`boot()` 冒頭で `initBoot()`・`map.on('load')` の hide を `requestHandoff()` に置換）
- Modify: `tests/e2e/boot.spec.js`（reduced-motion でもクラッシュせず handoff することを追加）

**Interfaces:**
- Consumes: `boot-fx.js`（`clamp, smooth, ease, project, bootFeeds, currentBootVariant, bootMinMs, remainingHold, progressFor`）。DOM 要素（Task 2 の `#boot-fx` 等）。
- Produces: `initBoot({ reduced?: boolean }) -> { requestHandoff(): void, destroy(): void }`

- [ ] **Step 1: `js/ui/boot.js` を実装**

```js
// js/ui/boot.js — 起動画面（#loading 内）の canvas FX ＋ テレメトリ点呼 ＋ handoff 制御。
// 採用＝③ 1+2 融合（globe 主導）。?boot=1|2|3|12 / ?bootmin=ms で実機調整可。
// canvas=星屑/粒子収束/経緯線globe/大気ハロ/データ点/レーダー、DOM=ワードマーク/テレメトリ/リング/バー。
import {
  clamp, ease, project, bootFeeds, currentBootVariant, bootMinMs, remainingHold, progressFor,
} from '../lib/boot-fx.js';

const VARIANTS = {
  '1':  { globe: 'hero',       telem: null,   bar: 'shimmer', sub: '地球を生成しています…',       radar: false },
  '2':  { globe: 'silhouette', telem: 'full', bar: 'fill',    sub: '観測網を起動しています…',       radar: true  },
  '12': { globe: 'hero',       telem: 'slim', bar: 'fill',    sub: '世界リアルタイム監視 — 起動中', radar: false },
  '3':  { globe: null,         telem: null,   bar: 'shimmer', sub: '世界リアルタイム監視 — 起動中', radar: false },
};

export function initBoot(opts) {
  const reduced = !!(opts && opts.reduced);
  const variant = currentBootVariant();
  const cfg = VARIANTS[variant] || VARIANTS['12'];
  const minMs = reduced ? 0 : bootMinMs();

  const loading = document.getElementById('loading');
  const fx = document.getElementById('boot-fx');
  const telemEl = document.getElementById('boot-telemetry');
  const barEl = document.getElementById('boot-bar');
  const subEl = document.getElementById('boot-sub');
  const ctx = fx ? fx.getContext('2d') : null;
  if (!loading || !fx || !ctx) return { requestHandoff() {}, destroy() {} };

  loading.setAttribute('data-variant', variant);
  if (subEl) subEl.textContent = cfg.sub || '';
  if (barEl) barEl.className = 'boot-bar ' + (cfg.bar || 'shimmer');

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, R = 0, stars = [], parts = [], dots = [];
  const rand = (a, b) => a + Math.random() * (b - a);

  function layout() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    fx.width = W * DPR; fx.height = H * DPR;
    fx.style.width = W + 'px'; fx.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W * 0.5;
    cy = H * (cfg.globe === 'silhouette' ? 0.40 : 0.43);
    R = Math.min(W, H) * (cfg.globe === 'silhouette' ? 0.19 : 0.17);
  }

  function gen() {
    stars = [];
    const n = Math.min(280, Math.round(W * H * 0.00020));
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: rand(0.4, 1.5),
        a: rand(0.25, 0.85), tw: rand(0, Math.PI * 2), sp: rand(0.5, 1.4) });
    }
    parts = [];
    if (cfg.globe) {
      const Rmax = Math.hypot(W, H) / 2;
      for (let j = 0; j < 150; j++) {
        parts.push({ ang: rand(0, Math.PI * 2), startR: rand(1.25, 2.0) * Rmax,
          swirl: rand(-0.5, 0.5), targetR: R * rand(0.94, 1.0), delay: rand(0, 320), seed: Math.random() });
      }
    }
    dots = [];
    if (cfg.globe) {
      for (let k = 0; k < 90; k++) {
        dots.push({ lat: rand(-78, 78), lon: rand(-180, 180), tw: rand(0, Math.PI * 2), sp: rand(0.6, 1.6) });
      }
    }
  }

  function drawStars(t) {
    for (const s of stars) {
      const a = reduced ? s.a : s.a * (0.55 + 0.45 * Math.sin(t / 1000 * s.sp + s.tw));
      ctx.globalAlpha = clamp(a, 0, 1); ctx.fillStyle = '#cfe0f5';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawConverge(t) {
    for (const p of parts) {
      const pc = ease(t, p.delay, p.delay + 950);
      if (pc <= 0) continue;
      const sm = pc * pc * (3 - 2 * pc);
      const rr = p.startR + (p.targetR - p.startR) * sm;
      const aa = p.ang + p.swirl * sm;
      ctx.globalAlpha = clamp(Math.sin(pc * Math.PI) * 0.9, 0, 1);
      ctx.fillStyle = p.seed > 0.5 ? '#9fe6ff' : '#cbb6ff';
      ctx.beginPath(); ctx.arc(cx + Math.cos(aa) * rr, cy + Math.sin(aa) * rr, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawArc(fn, a, b, step, alpha) {
    let pen = false;
    for (let s = a; s <= b + 0.001; s += step) {
      const q = fn(s);
      if (q.z > 0.02) {
        ctx.strokeStyle = 'rgba(90,200,255,' + clamp(q.z * 1.4, 0, 1) * alpha + ')';
        if (!pen) { ctx.beginPath(); ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
      } else if (pen) { ctx.stroke(); pen = false; }
    }
    if (pen) ctx.stroke();
  }

  function drawGlobe(p, rot, tilt, sil) {
    if (p <= 0) return;
    const latLimit = 6 + p * 90;
    const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
    g.addColorStop(0, 'rgba(30,70,120,' + (p * (sil ? 0.32 : 0.42)) + ')');
    g.addColorStop(1, 'rgba(6,18,34,' + (p * (sil ? 0.5 : 0.34)) + ')');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1;
    const base = sil ? 0.32 : 0.62;
    for (let lon = -180; lon < 180; lon += 30) {
      drawArc((s) => project(s, lon, rot, tilt, R, cx, cy), -latLimit, latLimit, 5, p * base);
    }
    for (const lat of [-60, -30, 0, 30, 60]) {
      if (Math.abs(lat) > latLimit) continue;
      drawArc((s) => project(lat, s, rot, tilt, R, cx, cy), -180, 180, 5, p * base * (lat === 0 ? 1.15 : 1));
    }
  }

  function drawAtmo(p, t) {
    if (p <= 0) return;
    const pulse = reduced ? 1 : (0.92 + 0.08 * Math.sin(t / 700));
    const g = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.22 * pulse);
    g.addColorStop(0, 'rgba(57,208,255,0)');
    g.addColorStop(0.35, 'rgba(57,208,255,' + (0.28 * p) + ')');
    g.addColorStop(1, 'rgba(57,208,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.22 * pulse, 0, Math.PI * 2); ctx.fill();
  }

  function drawDots(p, t, rot, tilt) {
    if (p <= 0) return;
    dots.forEach((d, i) => {
      const q = project(d.lat, d.lon, rot, tilt, R, cx, cy);
      if (q.z <= 0.05) return;
      const tw = reduced ? 0.8 : (0.45 + 0.55 * Math.sin(t / 1000 * d.sp + d.tw));
      ctx.globalAlpha = clamp(p * tw * clamp(q.z * 1.3, 0, 1), 0, 1);
      ctx.fillStyle = i % 4 === 0 ? '#eafaff' : '#5effc8';
      ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  function drawRadar(t) {
    const ang = (t / 1000) * 1.4;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    const grad = ctx.createLinearGradient(cx, cy, cx + Math.cos(ang) * R, cy + Math.sin(ang) * R);
    grad.addColorStop(0, 'rgba(57,208,255,0.28)'); grad.addColorStop(1, 'rgba(57,208,255,0)');
    ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang - 0.5, ang); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(120,230,255,0.5)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); ctx.stroke();
    ctx.restore();
    const ping = (t % 2200) / 2200;
    ctx.globalAlpha = clamp(1 - ping, 0, 1) * 0.6;
    ctx.strokeStyle = 'rgba(57,208,255,0.8)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R * (0.2 + ping * 0.85), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ---- テレメトリ ----
  const timers = [];
  function after(ms, fn) { timers.push(setTimeout(fn, ms)); }
  function rowEl(nm, st) {
    const li = document.createElement('li');
    li.innerHTML = '<span class="nm">' + nm + '</span><span class="dots">'
      + '·'.repeat(40) + '</span><span class="st">' + (st || '') + '</span>';
    telemEl.appendChild(li); return li;
  }
  function setProgress(done, total) {
    if (cfg.bar === 'fill' && barEl) barEl.style.setProperty('--p', Math.round(progressFor(done, total) * 100) + '%');
  }
  function runTelemetry() {
    if (!telemEl) return;
    const feeds = bootFeeds(variant);
    const slim = cfg.telem === 'slim';
    const revealStart = slim ? 900 : 650, step = slim ? 240 : 300, okDelay = slim ? 200 : 230;
    let done = 0;
    feeds.forEach((f, i) => {
      const reveal = () => {
        const li = rowEl(f[0], slim ? '' : f[1]);
        requestAnimationFrame(() => li.classList.add('in'));
        const mark = () => {
          li.classList.add('ok');
          li.querySelector('.st').textContent = (slim ? '' : f[1] + ' ') + '✓';
          done++; setProgress(done, feeds.length);
        };
        if (reduced) mark(); else after(okDelay, mark);
      };
      if (reduced) reveal(); else after(revealStart + i * step, reveal);
    });
    if (cfg.telem === 'full') {
      const at = revealStart + (feeds.length - 1) * step + okDelay + 300;
      const online = () => { const li = rowEl('', ''); li.className = 'online'; li.textContent = '観測網 オンライン';
        requestAnimationFrame(() => li.classList.add('in')); };
      if (reduced) online(); else after(at, online);
    }
  }

  // ---- ループ / handoff ----
  let raf = 0, running = true, handed = false;
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();

  function frame(now) {
    const t = now - t0;
    ctx.clearRect(0, 0, W, H);
    drawStars(t);
    if (cfg.globe) {
      const rot = t / 1000 * 0.18, tilt = -0.36;
      drawConverge(t);
      drawGlobe(ease(t, 600, 1900), rot, tilt, cfg.globe === 'silhouette');
      if (cfg.radar) drawRadar(t);
      drawAtmo(ease(t, 1600, 2500), t);
      drawDots(ease(t, 2100, 2900), t, rot, tilt);
    }
    if (running) raf = requestAnimationFrame(frame);
  }

  function drawStatic() {
    ctx.clearRect(0, 0, W, H); drawStars(3000);
    if (cfg.globe) { drawGlobe(1, 0.6, -0.36, cfg.globe === 'silhouette'); drawAtmo(1, 3000); drawDots(1, 3000, 0.6, -0.36); }
  }

  layout(); gen();
  if (cfg.telem) runTelemetry();
  if (reduced) { drawStatic(); running = false; } else raf = requestAnimationFrame(frame);
  window.addEventListener('resize', () => { layout(); gen(); }, { passive: true });

  function destroy() { running = false; cancelAnimationFrame(raf); timers.forEach(clearTimeout); }
  function doHandoff() {
    loading.classList.add('hidden');
    setTimeout(destroy, 700); // .6s フェード後に rAF/timer 停止
  }
  function requestHandoff() {
    if (handed) return; handed = true;
    const elapsed = ((typeof performance !== 'undefined') ? performance.now() : Date.now()) - t0;
    after(remainingHold(elapsed, minMs), doHandoff);
  }
  return { requestHandoff, destroy };
}
```

- [ ] **Step 2: `js/main.js` に import を追加**

`js/main.js` の import 群（12 行付近 `import { renderMedia } from './ui/media.js';` の直後）に追加:

```js
import { initBoot } from './ui/boot.js';
```

- [ ] **Step 3: `boot()` 冒頭で `initBoot()` を起動**

`function boot() {` の直後（現行 `const look = getLook();` の前）に追加:

```js
  const bootCtl = initBoot({ reduced: REDUCED });
```

- [ ] **Step 4: `map.on('load')` の hide を handoff に置換**

`js/main.js` の現行（359 行）:

```js
    document.getElementById('loading').classList.add('hidden');
```

を次に置換:

```js
    bootCtl.requestHandoff();
```

- [ ] **Step 5: e2e に reduced-motion ケースを追加（`tests/e2e/boot.spec.js` に追記）**

```js
test('起動画面: reduced-motion でもクラッシュせず handoff する', async ({ page }) => {
  test.setTimeout(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('#loading .boot-word')).toHaveText('ORBIS');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 20000 });
});
```

- [ ] **Step 6: 全テストを実行**

Run: `npm run test:js && npm run test:e2e -- boot.spec.js smoke.spec.js`
Expected: PASS（node 全件・boot.spec.js 2件・smoke.spec.js）

- [ ] **Step 7: コミット**

```bash
git add js/ui/boot.js js/main.js tests/e2e/boot.spec.js
git commit -m "feat(boot): canvas FX＋テレメトリ＋handoff制御をmain.jsに配線(最小表示×map ready)"
```

---

### Task 4: 実機ビジュアル確認・調整ダイヤル・配信検証

**Files:**
- Modify（必要時のみ）: `sw.js`（版番号。ネットワーク優先化済のため原則不要）
- Modify（実機調整の結果のみ）: `js/ui/boot.js` / `css/orbis.css` の定数

**Interfaces:**
- Consumes: Task 3 までの実装
- Produces: 確定した調整値（最小表示/globe サイズ・回転・傾き/テレメトリ密度・速度/配色強度）

- [ ] **Step 1: ローカル配信して実機で確認**

Run: `npm run serve`（`python3 -m http.server 8000`）
ブラウザで以下を見比べる（オーナーのレビュー）:
- `http://localhost:8000/?boot=12`（既定・採用案）
- `http://localhost:8000/?boot=1` / `?boot=2` / `?boot=3`（融合配分の比較）
- `http://localhost:8000/?bootmin=4000`（ゆっくり）/ `?bootmin=0`（最短）
- handoff（本物 globe への溶暗）が自然か、ORBIS とテレメトリの可読性、配色・globe サイズ。

- [ ] **Step 2: 調整値を反映（必要時）**

実機の所見に応じて `js/ui/boot.js`（`layout()` の `cy`/`R` 係数、`frame()` の `rot` 係数 `0.18`/`tilt` `-0.36`、`ease()` のフェーズ時刻、`drawAtmo` のアルファ）や `css/orbis.css`（配色・字間・bottom 位置）を調整。変更後は `npm run test:js && npm run test:e2e -- boot.spec.js` を再実行して緑を確認。

- [ ] **Step 3: 調整をコミット（あれば）**

```bash
git add -A
git commit -m "polish(boot): 実機比較に基づく起動画面の最終調整"
```

- [ ] **Step 4: SW / 配信の確認（統合・デプロイ時）**

- `index.html`（シェル）変更を含むが、SW はネットワーク優先化済（main `d83eeda`）のため版上げは原則不要。
- 統合は main ツリーで実施（並行セッションと直列）。merge → push 後、本番で確認:
  - `curl -s https://orbis-beta.vercel.app/ | grep boot-fx`（新シェル配信を確認）
  - 実機で `/?boot=12` の起動演出と handoff を目視。反映されない場合のみ `sw.js` の版番号を 1 つ上げて再 push。

---

## Self-Review

**1. Spec coverage（spec の各節 → 対応タスク）**
- ファイル構成（boot-fx/boot/index/css/main）→ Task 1〜3。✓
- handoff（最小表示×map ready・溶暗）→ Task 3（`remainingHold`＋`requestHandoff`＋`#loading.hidden`）。✓
- テレメトリの誠実さ（実レイヤー点呼・最終は map ready 連動）→ Task 3（`runTelemetry`＋handoff が map load 起点）。✓
- 調整ダイヤル（?boot/?bootmin）→ Task 1（`currentBootVariant`/`bootMinMs`）＋ Task 4。✓
- reduced-motion → Task 2（CSS）＋ Task 3（`drawStatic`/即 mark）＋e2e。✓
- SW/配信 → Task 4。✓
- 並行協調 → Global Constraints＋Task 4。✓
- テスト（純粋関数＋構造 e2e）→ Task 1＋Task 2/3。✓
- 既存 smoke の `#loading`→hidden 契約維持 → Task 2 Step 5・Task 3 Step 6。✓

**2. Placeholder scan:** TBD/TODO/「適切に処理」等なし。各 step に実コード・実コマンド・期待値あり。✓

**3. Type consistency:** `initBoot({reduced})→{requestHandoff,destroy}` は Task 3 で定義し main.js が `bootCtl.requestHandoff()` で使用（一致）。`project(...,R,cx,cy)` のシグネチャは boot-fx 定義と boot.js 呼び出しで一致。`bootFeeds(variant)` の返り値 `[名,状態]` は `runTelemetry` の `f[0]/f[1]` と一致。CSS クラス名（`.boot-fx/.boot-word/#boot-bar/.boot-telemetry/.boot-rings`）は index.html・boot.js・e2e で一致。✓
