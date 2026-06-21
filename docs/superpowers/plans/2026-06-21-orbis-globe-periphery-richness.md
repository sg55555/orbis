# ORBIS 大画面 globe 周辺リッチ化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4K/ワイド画面で globe 周囲の黒余白が寂しい問題を、点・光の言語（星密度の4K上限緩和＋奥行き／微粒子ダスト／極淡い周辺光）で解消し、`?space=1|2|3|off` で実物比較できるようにする。globe 本体は非編集。

**Architecture:** `js/lib/starfield.js` に純粋関数（`starCount`/`generateStars` の bright 拡張/`generateDust`/`stepDust`/`dustCount`）を足し、`mountStarfield` が `immerseSpace(location.search)` を自己読みして level 連動（星 cap・dust 数・bright 比率）で描画する。周辺光は `css/orbis.css` 末尾の `body.space-N #starfield` で neb-a/neb-b の極淡い radial を四隅グラス（panel/feed/legend）を避けて重ねる。`?space` は `js/lib/immerse.js` の `immerseSpace`＋`immerseClasses` で body-class を付与（main.js 適用済機構に乗る）。

**Tech Stack:** Vanilla JS (ESM, no build) / Canvas 2D / MapLibre globe（本体は触らない）/ node:test / Playwright。

## Global Constraints

- **main.js 非編集・index.html 非編集**（既存 `#starfield` canvas をそのまま使う。level は starfield.js が `immerseSpace` 自己読み、CSS は immerseClasses の `space-` クラス）。
- **globe 本体（globe-density 領分）非編集**：`densityScale`/`blobRadius`/`js/style.js`/`setSky`(applyAtmosphere) に触れない。
- **`?space=off` は現状(before)に完全一致**：`generateStars` は `brightRatio=0` で既存の rng 消費順・r/alpha レンジを保つ（`brightRatio > 0 && rng() < brightRatio` で短絡）。星 cap=600・dust=0・周辺光なし。
- **周辺光は四隅グラス（左上 #panel／右上 #feed／右下 #legend）の背後を避け**、左右中段・下部に極淡く（panel 干渉＝星雲面廃止の主因の再発防止）。
- **CSS は末尾**に `body.space-N #starfield` ブロックを追加。他スレッドと末尾衝突時は**両ブロック保持**。
- **`immerseSpace` 既定 = `'2'`**（採用段・暫定。実物比較後に確定）。
- commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- SW（sw.js）は network-first ゆえ **bump 不要**。
- reduced-motion 時は静止描画（dust ドリフトなし）。

---

### Task 1: `?space` トグル（immerse）

**Files:**
- Modify: `js/lib/immerse.js`（`immerseSpace` 追加＋`immerseClasses` に `space-`）
- Test: `tests/immerse.test.js`（`immerseSpace` テスト追加＋既存 `immerseClasses` deepEqual に `space-2` 追加）

**Interfaces:**
- Produces: `immerseSpace(search) -> '1'|'2'|'3'|'off'`（既定 `'2'`）。`immerseClasses(search)` の戻り配列末尾に `'space-' + immerseSpace(search)`。

- [ ] **Step 1: 既存 import 行に immerseSpace を追加してテストを書く**

`tests/immerse.test.js` の import（先頭の `from '../js/lib/immerse.js'`）に `immerseSpace` を追加し、末尾に以下を追記:

```js
test('immerseSpace: 既定 2。?space=1|3|off で上書き（無効も既定2・大小無視）', () => {
  assert.equal(immerseSpace(''), '2');
  assert.equal(immerseSpace('?space=1'), '1');
  assert.equal(immerseSpace('?space=3'), '3');
  assert.equal(immerseSpace('?space=off'), 'off');
  assert.equal(immerseSpace('?space=OFF'), 'off'); // 大小無視
  assert.equal(immerseSpace('?space=9'), '2');     // 未定義段は既定
  assert.equal(immerseSpace('?space=x'), '2');     // 不正は既定
});

test('immerseClasses: space- を常時付与（既定 space-2、?space=off で space-off）', () => {
  assert.ok(immerseClasses('').includes('space-2'));
  assert.ok(immerseClasses('?space=off').includes('space-off'));
  assert.ok(immerseClasses('?space=1').includes('space-1'));
});
```

- [ ] **Step 2: 既存 immerseClasses の deepEqual テストを更新（space-2 を末尾に追加）**

`tests/immerse.test.js` の `test('immerseClasses: 既定で seam-a・mbg-deep・mp-a・ui-a・font-on・sec-on・legend-on。指定で上書き', ...)` 内の各 `deepEqual` の期待配列末尾に `'space-2'` を追加（`?space` を指定しない全ケース）。完全な置換後の本体:

```js
test('immerseClasses: 既定で seam-a・mbg-deep・mp-a・ui-a・font-on・sec-on・legend-on。指定で上書き', () => {
  assert.deepEqual(immerseClasses(''), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?seam=b'), ['seam-b', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?mbg=black'), ['seam-a', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?seam=c&mbg=black&glass=off'), ['seam-c', 'glass-off', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?glass=on'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?mp=off'), ['seam-a', 'mbg-deep', 'mp-off', 'ui-a', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?ui=off&font=off'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-off', 'font-off', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?ui=b'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-b', 'font-on', 'sec-on', 'legend-on', 'space-2']);
  assert.deepEqual(immerseClasses('?sec=off'), ['seam-a', 'mbg-deep', 'mp-a', 'ui-a', 'font-on', 'sec-off', 'legend-on', 'space-2']);
});
```

- [ ] **Step 3: 実行して失敗を確認**

Run: `node --test tests/immerse.test.js`
Expected: FAIL（`immerseSpace` が未定義 / deepEqual 不一致）

- [ ] **Step 4: immerseSpace を実装し immerseClasses に追加**

`js/lib/immerse.js` の `immerseLegend`（87行付近）の直後に追加:

```js
// ?space=1|2|3|off（大小無視）。大画面 globe 周辺リッチ化（星密度/微粒子/周辺光）の強さ段。
// 既定 2（採用段・暫定）。off は before（space-off で周辺光なし・星密度 600・dust なし）。
export function immerseSpace(search) {
  const m = /[?&]space=(1|2|3|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : '2';
}
```

`immerseClasses` 内の `out.push('legend-' + immerseLegend(search));` の直後に追加:

```js
  out.push('space-' + immerseSpace(search));
```

- [ ] **Step 5: 実行して成功を確認**

Run: `node --test tests/immerse.test.js`
Expected: PASS（全件）

- [ ] **Step 6: コミット**

```bash
git add js/lib/immerse.js tests/immerse.test.js
git commit -m "feat(space): ?space=1|2|3|off トグルを immerse に追加（既定2）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `starCount`（4K 上限の段階引き上げ・純粋）

**Files:**
- Modify: `js/lib/starfield.js`（`starCount` を export 追加）
- Test: `tests/starfield.test.js`

**Interfaces:**
- Produces: `starCount(w, h, level='off', density=0.00018) -> number`。`Math.min(cap[level], round(w*h*density))`。cap = {off:600, 1:760, 2:900, 3:1100}。

- [ ] **Step 1: テストを書く**

`tests/starfield.test.js` の import に `starCount` を追加し、末尾に追記:

```js
test('starCount: off は現状の上限600・面積比例', () => {
  // 4K(3840x2160=8,294,400)*0.00018=1493 → off cap 600 で頭打ち
  assert.equal(starCount(3840, 2160, 'off'), 600);
  // FHD(1920x1080=2,073,600)*0.00018=373 → cap 未満で面積比例値
  assert.equal(starCount(1920, 1080, 'off'), Math.round(2073600 * 0.00018));
});

test('starCount: level で 4K の上限が段階的に上がる（760/900/1100）', () => {
  assert.equal(starCount(3840, 2160, '1'), 760);
  assert.equal(starCount(3840, 2160, '2'), 900);
  assert.equal(starCount(3840, 2160, '3'), 1100);
});

test('starCount: FHD/HD は上限未満なので level によらず不変（面積比例値）', () => {
  const fhd = Math.round(1920 * 1080 * 0.00018); // 373
  assert.equal(starCount(1920, 1080, '1'), fhd);
  assert.equal(starCount(1920, 1080, '3'), fhd);
  assert.equal(starCount(1920, 1080, 'off'), fhd);
});

test('starCount: 不正 level は off 扱い', () => {
  assert.equal(starCount(3840, 2160, 'zzz'), 600);
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `node --test tests/starfield.test.js`
Expected: FAIL（`starCount` 未定義）

- [ ] **Step 3: starCount を実装**

`js/lib/starfield.js` の先頭（`generateStars` の前）に追加:

```js
// 星数の上限は level で段階引き上げ（4K で効く・FHD/HD は cap 未満で不変）。
// off=現状の600。density は従来値を維持（面積比例の係数）。
const STAR_CAP = { off: 600, 1: 760, 2: 900, 3: 1100 };
export function starCount(w, h, level = 'off', density = 0.00018) {
  const cap = STAR_CAP[level] || STAR_CAP.off;
  return Math.min(cap, Math.round(w * h * density));
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `node --test tests/starfield.test.js`
Expected: PASS（既存3＋新規4）

- [ ] **Step 5: コミット**

```bash
git add js/lib/starfield.js tests/starfield.test.js
git commit -m "feat(space): starCount 純粋関数（4K 上限を段階引き上げ・off=600 維持）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `generateStars` の奥行き（bright 2階層・後方互換）

**Files:**
- Modify: `js/lib/starfield.js`（`generateStars` に `brightRatio` 引数＋`bright` プロパティ）
- Test: `tests/starfield.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `generateStars(count, w, h, rng=Math.random, brightRatio=0) -> Array<{x,y,r,alpha,tw,sp,bright}>`。`brightRatio=0` で既存の rng 消費・r/alpha レンジを保つ（bright は全て false）。

- [ ] **Step 1: 後方互換と bright のテストを書く**

`tests/starfield.test.js` 末尾に追記:

```js
test('generateStars: brightRatio=0 は全て bright:false（off の後方互換）', () => {
  const stars = generateStars(100, 800, 600, seeded(3), 0);
  assert.ok(stars.every((s) => s.bright === false));
});

test('generateStars: brightRatio=0 は既存レンジを保つ（r 0.4–1.5 / alpha 0.25–0.85）', () => {
  for (const s of generateStars(300, 800, 600, seeded(4), 0)) {
    assert.ok(s.r >= 0.4 && s.r <= 1.5);
    assert.ok(s.alpha >= 0.25 && s.alpha <= 0.85);
  }
});

test('generateStars: brightRatio>0 で一部が bright（大きく明るい）', () => {
  const stars = generateStars(500, 800, 600, seeded(5), 0.3);
  const bright = stars.filter((s) => s.bright);
  assert.ok(bright.length > 0, 'bright が存在する');
  for (const s of bright) {
    assert.ok(s.r >= 1.3 && s.r <= 2.2);       // bright は大きい
    assert.ok(s.alpha >= 0.75 && s.alpha <= 1.0); // bright は明るい
  }
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `node --test tests/starfield.test.js`
Expected: FAIL（`bright` プロパティ未定義 / 5引数目未対応）

- [ ] **Step 3: generateStars を bright 対応に拡張**

`js/lib/starfield.js` の `generateStars` を以下に置換:

```js
// rng: () => [0,1) の関数（テストでは seeded を注入）。
// tw/sp は明滅の位相と速度（描画時にのみ使用。基準 alpha は変えない）。
// brightRatio>0 で一部を「明るい星」に（奥行き）。brightRatio=0 は既存挙動（rng 消費順・レンジ不変）。
export function generateStars(count, w, h, rng = Math.random, brightRatio = 0) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    const bright = brightRatio > 0 && rng() < brightRatio; // 0 なら短絡＝rng 消費なし
    stars.push({
      x: rng() * w,
      y: rng() * h,
      r: bright ? 1.3 + rng() * 0.9 : 0.4 + rng() * 1.1,
      alpha: bright ? 0.75 + rng() * 0.25 : 0.25 + rng() * 0.6,
      tw: rng() * Math.PI * 2,
      sp: 0.4 + rng() * 1.2,
      bright,
    });
  }
  return stars;
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `node --test tests/starfield.test.js`
Expected: PASS（既存テスト＋新規。`同一 seed は同一結果` も bright:false 付きで一致）

- [ ] **Step 5: コミット**

```bash
git add js/lib/starfield.js tests/starfield.test.js
git commit -m "feat(space): generateStars に奥行き（bright 2階層・brightRatio=0 で後方互換）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 微粒子ダスト（`generateDust`/`stepDust`/`dustCount`・純粋）

**Files:**
- Modify: `js/lib/starfield.js`
- Test: `tests/starfield.test.js`

**Interfaces:**
- Produces:
  - `dustCount(level='off') -> number`（{off:0,1:18,2:32,3:48}）
  - `generateDust(count, w, h, rng=Math.random) -> Array<{x,y,r,vx,vy,alpha}>`
  - `stepDust(dust, dt, w, h) -> dust`（in-place ドリフト＋画面外ラップ）

- [ ] **Step 1: テストを書く**

`tests/starfield.test.js` の import に `generateDust, stepDust, dustCount` を追加し、末尾に追記:

```js
test('dustCount: level 連動（off=0 / 1=18 / 2=32 / 3=48）', () => {
  assert.equal(dustCount('off'), 0);
  assert.equal(dustCount('1'), 18);
  assert.equal(dustCount('2'), 32);
  assert.equal(dustCount('3'), 48);
  assert.equal(dustCount('zzz'), 0);
});

test('generateDust: 指定個数・画面内・極淡 alpha・極小 r', () => {
  const dust = generateDust(40, 800, 600, seeded(11));
  assert.equal(dust.length, 40);
  for (const d of dust) {
    assert.ok(d.x >= 0 && d.x <= 800 && d.y >= 0 && d.y <= 600);
    assert.ok(d.r >= 0.3 && d.r <= 0.8);
    assert.ok(d.alpha >= 0.05 && d.alpha <= 0.18);
  }
});

test('stepDust: ドリフト後も画面内にラップされる', () => {
  const dust = generateDust(30, 100, 100, seeded(12));
  stepDust(dust, 10000, 100, 100); // 大きな dt でも
  for (const d of dust) {
    assert.ok(d.x >= 0 && d.x <= 100, 'x ラップ');
    assert.ok(d.y >= 0 && d.y <= 100, 'y ラップ');
  }
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `node --test tests/starfield.test.js`
Expected: FAIL（未定義）

- [ ] **Step 3: 実装**

`js/lib/starfield.js` の `starCount` の直後に追加:

```js
// 微粒子ダスト（globe 周辺を漂う極小の塵）。level で個数を連動。
const DUST_COUNT = { off: 0, 1: 18, 2: 32, 3: 48 };
export function dustCount(level = 'off') {
  return Object.prototype.hasOwnProperty.call(DUST_COUNT, level) ? DUST_COUNT[level] : 0;
}

export function generateDust(count, w, h, rng = Math.random) {
  const dust = [];
  for (let i = 0; i < count; i++) {
    dust.push({
      x: rng() * w,
      y: rng() * h,
      r: 0.3 + rng() * 0.5,
      vx: (rng() - 0.5) * 0.018, // ±0.009 px/ms 程度の極低速
      vy: (rng() - 0.5) * 0.018,
      alpha: 0.05 + rng() * 0.13,
    });
  }
  return dust;
}

// dt(ms) ぶんドリフトさせ、画面外に出たら反対側へラップ（in-place・テスト可能）。
export function stepDust(dust, dt, w, h) {
  for (const d of dust) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.x = ((d.x % w) + w) % w; // 負も正も [0,w) にラップ
    d.y = ((d.y % h) + h) % h;
  }
  return dust;
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `node --test tests/starfield.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/lib/starfield.js tests/starfield.test.js
git commit -m "feat(space): 微粒子ダスト generateDust/stepDust/dustCount（純粋）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `mountStarfield` 統合（immerseSpace 自己読み・level 連動・dust/bright 描画）

**Files:**
- Modify: `js/lib/starfield.js`（`drawStars`/`mountStarfield` 拡張・`immerseSpace` import・`drawDust` 追加）
- Test: `tests/starfield.test.js`（純粋部は既済。本タスクは後方互換の純粋部 green を確認）＋ローカル目視

**Interfaces:**
- Consumes: `immerseSpace`（Task 1）, `starCount`（Task 2）, `generateStars`+bright（Task 3）, `generateDust`/`stepDust`/`dustCount`（Task 4）
- Produces: `mountStarfield(canvas, opts)` が level を自己決定して星(bright含む)＋dust を描画（main.js 非編集）。

- [ ] **Step 1: import と drawDust・bright 描画ヘルパを追加**

`js/lib/starfield.js` の先頭に import を追加（ファイル冒頭のコメント直後）:

```js
import { immerseSpace } from './immerse.js';
```

`drawStars` を bright のグロー対応に置換（静止描画・reduced/非対応フォールバック）:

```js
// canvas に星を静止描画（reduced-motion・非対応時のフォールバック）。bright はグロー付き。
export function drawStars(canvas, stars) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of stars) {
    drawStar(ctx, s, s.alpha);
  }
  ctx.globalAlpha = 1;
}

// 1つの星を描く。bright は外周に淡いグロー（二重 arc・shadowBlur を使わず安価）。
function drawStar(ctx, s, alpha) {
  if (s.bright) {
    ctx.globalAlpha = Math.max(0, alpha * 0.35);
    ctx.fillStyle = '#bcd8ff';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = Math.max(0, alpha);
  ctx.fillStyle = s.bright ? '#eaf3ff' : '#cfe0f5';
  ctx.beginPath();
  ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
  ctx.fill();
}

// ダストを描く（極淡）。
function drawDust(ctx, dust) {
  if (!ctx) return;
  ctx.fillStyle = '#9fb6d8';
  for (const d of dust) {
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
```

- [ ] **Step 2: mountStarfield を level 連動に置換**

`js/lib/starfield.js` の `mountStarfield` を以下に置換:

```js
// canvas を要素サイズに合わせ、星＋ダストを生成してアニメーション描画する。
// level は immerseSpace を自己読み（main.js 非編集）。opts.level でテスト時に上書き可能。
// opts.reduced=true で静止描画。canvas ごとに一度だけ呼ぶこと。
export function mountStarfield(canvas, opts = {}) {
  const {
    density = 0.00018,
    reduced = false,
    level = immerseSpace(typeof location !== 'undefined' ? location.search : ''),
  } = opts;
  const ctx = canvas.getContext('2d');
  const brightRatio = level === 'off' ? 0 : 0.08;
  let stars = [];
  let dust = [];
  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    canvas.width = w; canvas.height = h;
    stars = generateStars(starCount(w, h, level, density), w, h, Math.random, brightRatio);
    dust = generateDust(dustCount(level), w, h);
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  if (reduced || !ctx) {
    drawStars(canvas, stars); // 星（bright 含む）静止
    drawDust(ctx, dust);      // ダスト静止（ctx 無しは drawDust 内で no-op）
    return stars;
  }

  let shooting = [];
  let last = performance.now();
  let nextShoot = 2500 + Math.random() * 4000;

  function frame(now) {
    const dt = Math.min(50, now - last); last = now;
    const t = now / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ダスト（背面・極淡・ドリフト）
    stepDust(dust, dt, canvas.width, canvas.height);
    drawDust(ctx, dust);

    // 星の明滅（bright はグロー）
    for (const s of stars) {
      let a = s.alpha * (0.55 + 0.45 * Math.sin(t * s.sp + s.tw));
      if (a < 0) a = 0;
      drawStar(ctx, s, a);
    }

    // 流れ星（同時に最大2本・低頻度）
    nextShoot -= dt;
    if (nextShoot <= 0 && shooting.length < 2) {
      const m = spawnShoot(canvas.width, canvas.height);
      m.max = m.life;
      shooting.push(m);
      nextShoot = 6000 + Math.random() * 10000;
    }
    for (const m of shooting) {
      m.life -= dt; m.x += m.vx * dt; m.y += m.vy * dt;
      const len = 64;
      const tx = m.x - m.vx * len, ty = m.y - m.vy * len;
      const g = ctx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, 'rgba(190,224,255,0.95)');
      g.addColorStop(1, 'rgba(190,224,255,0)');
      ctx.globalAlpha = Math.max(0, Math.min(1, m.life / (m.max || 1)));
      ctx.strokeStyle = g; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(tx, ty); ctx.stroke();
    }
    shooting = shooting.filter((m) => m.life > 0);

    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return stars;
}
```

- [ ] **Step 3: 純粋部の回帰と全 JS テストを確認**

Run: `npm run test:js`
Expected: PASS（全件。starfield/immerse の純粋部、既存スイート）

- [ ] **Step 4: ローカルで off と既定の星描画を目視（実物比較の前段）**

```bash
python -m http.server 8000 &
```
ブラウザで `http://localhost:8000/?space=off`（現状＝星のみ・600）と `http://localhost:8000/?space=2`（星増＋bright＋dust）を開き、コンソールエラー 0・globe が主役のままを確認。実描画は GPU 依存（最終判断は実物比較）。

- [ ] **Step 5: コミット**

```bash
git add js/lib/starfield.js
git commit -m "feat(space): mountStarfield を level 連動に（星密度/bright/dust・main.js 非編集）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 周辺光 CSS（`body.space-N #starfield`）＋ e2e

**Files:**
- Modify: `css/orbis.css`（**末尾**に `body.space-N #starfield` ブロック）
- Test: `tests/e2e/space.spec.js`（新規）

**Interfaces:**
- Consumes: `immerseClasses` の `space-1|2|3|off`（Task 1・main.js が body に付与）。`#starfield` の基底 background（既存 vignette）。

- [ ] **Step 1: e2e を書く**

`tests/e2e/space.spec.js` を新規作成:

```js
const { test, expect } = require('@playwright/test');

test('space: 既定で body.space-2・#starfield canvas が存在', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#starfield')).toHaveCount(1);
  await expect(page.locator('body')).toHaveClass(/space-2/);
});

test('space: ?space=off で body.space-off（周辺光なし・before）', async ({ page }) => {
  await page.goto('/?space=off');
  await expect(page.locator('body')).toHaveClass(/space-off/);
});

test('space: ?space=3 で body.space-3', async ({ page }) => {
  await page.goto('/?space=3');
  await expect(page.locator('body')).toHaveClass(/space-3/);
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `npx playwright test tests/e2e/space.spec.js`
Expected: FAIL（space-2 クラスは Task 1 で付与済なら PASS する場合あり。CSS 未追加でも class テストは通るため、本タスクの主眼は次の CSS 追加＝実物比較。class が付かない場合のみ FAIL）

- [ ] **Step 3: 周辺光 CSS を末尾に追加**

`css/orbis.css` の**末尾**に追加（周辺光は四隅グラスを避け左右中段・下部。neb-a/neb-b は極淡い変数。level で広がりを連動。space-off は基底 vignette のまま＝before）:

```css
/* ===== 大画面 globe 周辺リッチ化（space-・?space=1|2|3|off） =====
   星密度/bright/dust は js/lib/starfield.js が immerseSpace で level 連動。
   ここは周辺光のみ＝#starfield 背景に neb-a(青)/neb-b(紫) の極淡い radial を重ねる。
   配置は四隅グラス（左上#panel/右上#feed/右下#legend）の背後を避け左右中段・下部に。
   ＝星雲面廃止の主因（panel グラス越しに四角く滲む）の再発防止。space-off は基底 vignette のまま（before）。 */
body.space-1 #starfield {
  background:
    radial-gradient(44% 54% at 5% 56%, var(--neb-a) 0%, transparent 64%),
    radial-gradient(42% 50% at 96% 64%, var(--neb-b) 0%, transparent 64%),
    radial-gradient(ellipse at 50% 42%, #0a1220 0%, var(--neb-base) 82%);
}
body.space-2 #starfield {
  background:
    radial-gradient(50% 60% at 5% 54%, var(--neb-a) 0%, transparent 60%),
    radial-gradient(48% 56% at 96% 62%, var(--neb-b) 0%, transparent 60%),
    radial-gradient(ellipse at 50% 42%, #0a1220 0%, var(--neb-base) 82%);
}
body.space-3 #starfield {
  background:
    radial-gradient(58% 68% at 5% 52%, var(--neb-a) 0%, transparent 56%),
    radial-gradient(56% 64% at 96% 60%, var(--neb-b) 0%, transparent 56%),
    radial-gradient(ellipse at 50% 42%, #0a1220 0%, var(--neb-base) 82%);
}
```

- [ ] **Step 4: 実行して成功を確認**

Run: `npx playwright test tests/e2e/space.spec.js`
Expected: PASS（3件）

注：ポート 8000 を他プロセスが掴んでいないこと（mistakes.md：stale server 汚染回避）。

- [ ] **Step 5: コミット**

```bash
git add css/orbis.css tests/e2e/space.spec.js
git commit -m "feat(space): 周辺光 CSS（body.space-N #starfield・四隅グラス回避）＋e2e

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 実装後：実物比較（採用段の確定・太田さん）

全6タスク完了後、`python -m http.server 8000` で `?space=off|1|2|3` を 4K/FHD/モバイルで実物比較し、採用条件（spec §採用条件）を確認:
1. panel/feed/legend のグラス越しに周辺光が**四角く見えないこと**（最優先）。
2. globe が主役のまま（周辺光・dust が視認を妨げない）。
3. 4K で黒余白の寂しさが解消・FHD/モバイルが悪化しない。
4. 採用段を `immerseSpace` の既定（暫定 `'2'`）に確定（必要なら 1 or 3 に変更してコミット）。

採用段確定後に最終 whole-branch レビュー → main 統合 → push → 本番反映（cron デプロイ）→ Obsidian/メモリ更新。
