# 海流チェイス（区切れた面の順送り）Implementation Plan

> **⚠️ 撤回済み（2026-06-14）**: 本プランは実装・本番前の実物比較で **棄却**。ユーザー判断で旧来の「面＋波(waveFactor)」を採用し、チェイス機構は撤去した（commit fce3822）。経緯と最終判断は spec `2026-06-14-orbis-ocean-currents-design.md` の「最終判断」節を参照。本ファイルは履歴として残す。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 海流の流れを「離散セル(面)が頭→尾へ順送りに点灯するチェイス」で描き、引き(ズームアウト)でも流れの向きが一目で読めるようにする。

**Architecture:** 既存の `buildCurrentField`(経路を密サンプルし各点に phase=経路上0..1位置・水温色を付与、純粋・テスト済)を土台に流用し、点ごとの明るさ計算を sine 波 `waveFactor` から新・純粋関数 `chaseFactor` に置換する。淡い水温面(SST)を常時表示し、その上を明るいセルが順送りで走る2層構造。`waveFactor` は `?flow=wave` 比較用に残す。流れの調整値は URL パラメータ経由で ctx に載せ、`python -m http.server` で実物比較して既定を確定する。重複していた `currents-flow` 微粒子(ScatterplotLayer)は一本化のため削除する。

**Tech Stack:** Vanilla JS (ESM)、deck.gl 9.3.4 (ScatterplotLayer・加算合成)、MapLibre globe、node:test、Playwright。

---

## File Structure

- `js/layers/currents.js`（変更）: `chaseFactor`・`cyclicDist` を追加し `toDeckLayer` を chase/wave 分岐に。`waveFactor` は残す。
- `tests/currents.test.js`（変更）: `chaseFactor`・`cyclicDist` のテスト追加。既存テストは維持。
- `js/main.js`（変更）: URL から `FLOW`・`CHASE` を読み ctx に載せる。`currentsFlowLayer()`・`currentsPaths`・`CURRENT_PARTICLES`・`drawAll` 内の currents-flow 行・不要 import を削除。
- `js/layers/registry.js`（変更）: `DECK_TO_LAYER` から `'currents-flow'` を削除。
- `sw.js`（変更）: CACHE 版を v12→v13。

---

## Task 1: `chaseFactor` / `cyclicDist` 純粋関数

**Files:**
- Modify: `js/layers/currents.js`（`waveFactor` 定義の直後に追加）
- Test: `tests/currents.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/currents.test.js` の import に `cyclicDist, chaseFactor` を追加する（既存 import 行を置換）:

```js
import {
  colorForTemp, lerpStops, buildCurrentField, tempAtT, currentsLayer, CMAPS, DEFAULT_CMAP,
  cyclicDist, chaseFactor,
} from '../js/layers/currents.js';
```

ファイル末尾に以下を追加:

```js
test('cyclicDist: 巡回距離（ラップ考慮・対称・0..0.5）', () => {
  assert.ok(Math.abs(cyclicDist(0.2, 0.3) - 0.1) < 1e-9);
  assert.ok(Math.abs(cyclicDist(0.1, 0.9) - 0.2) < 1e-9, 'ラップ');
  assert.ok(Math.abs(cyclicDist(0.9, 0.1) - 0.2) < 1e-9, '対称');
  assert.equal(cyclicDist(0.5, 0.5), 0);
});

test('chaseFactor: ヘッド位置で最大・前方は base・尾は中間（glide）', () => {
  const o = { cells: 4, tail: 0.25, speed: 1, base: 0.5, peak: 1.5, step: 'glide' };
  // head = (motionT*speed) mod 1 = 0.5
  const atHead = chaseFactor(0.5, 0.5, o);
  const behind = chaseFactor(0.4, 0.5, o); // ヘッドの後方（尾）= phase が小さい側
  const ahead = chaseFactor(0.7, 0.5, o);  // ヘッド前方（暗い）
  assert.ok(Math.abs(atHead - 2.0) < 1e-9, 'ヘッドで base+peak');
  assert.ok(ahead <= 0.5 + 1e-9, '前方は base');
  assert.ok(behind > 0.5 && behind < atHead, '尾は base と最大の間');
});

test('chaseFactor: base を下回らない / step hard はセル内一定・glide は連続', () => {
  const o = { cells: 5, tail: 0.2, speed: 1, base: 0.6, peak: 1.0, step: 'hard' };
  for (const ph of [0, 0.13, 0.37, 0.5, 0.88, 1]) {
    assert.ok(chaseFactor(ph, 0.3, o) >= 0.6 - 1e-9, 'base 以上');
  }
  // cells=5 → セル0は phase[0,0.2)。同一セル内の2点は同値（量子化）
  assert.equal(chaseFactor(0.02, 0.3, o), chaseFactor(0.18, 0.3, o));
  // glide は連続なので同一セル内でも異なる
  const g = { ...o, step: 'glide' };
  assert.notEqual(chaseFactor(0.02, 0.3, g), chaseFactor(0.18, 0.3, g));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/currents.test.js`
Expected: FAIL（`cyclicDist`/`chaseFactor` は未エクスポートで `undefined is not a function` 等）

- [ ] **Step 3: 最小実装を書く**

`js/layers/currents.js` の `waveFactor`（行95付近）定義の直後に追加:

```js
// チェイス調整の既定値（?flow=chase 時。URL/ctx で上書き可能）。
const CHASE_CELLS = 6;     // 1海流あたりのセル(面)数
const CHASE_TAIL = 0.22;   // 尾の長さ（phase 単位の減衰幅）
const CHASE_SPEED = 0.7;   // motionT に対するヘッド進行速度
const CHASE_BASE = 0.55;   // 消灯セルの明るさ（淡い水温面を常時見せる）
const CHASE_PEAK = 1.6;    // 点灯セルの追加明るさ
const CHASE_STEP = 'hard'; // 'hard'=セル量子化 / 'glide'=連続

// 0..1 の2位相間の巡回距離（0..0.5、ラップ考慮・対称）。
export function cyclicDist(a, b) {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

// チェイスの明るさ係数。各点を cells 個のセルに量子化し、動く点灯ヘッドの「後方(尾)」を
// 明るく、前方を暗く（＝流れ方向が読める）。戻り値 base..(base+peak)。
export function chaseFactor(phase, motionT, opts = {}) {
  const cells = opts.cells || CHASE_CELLS;
  const tail = opts.tail || CHASE_TAIL;
  const speed = opts.speed || CHASE_SPEED;
  const base = opts.base != null ? opts.base : CHASE_BASE;
  const peak = opts.peak != null ? opts.peak : CHASE_PEAK;
  const step = opts.step || CHASE_STEP;
  // hard はセル中心に量子化（セル単位でステップ点灯）、glide は連続。
  const pos = step === 'glide' ? phase : (Math.floor(phase * cells) + 0.5) / cells;
  const head = ((motionT * speed) % 1 + 1) % 1;
  // ヘッドより「後方(phase が小さい側)」への距離。0=ヘッド、増えるほど尾の後ろ、前方は ~1。
  const behind = ((head - pos) % 1 + 1) % 1;
  const lit = Math.max(0, 1 - behind / tail);
  return base + peak * lit * lit; // 二乗で crest を鋭く
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/currents.test.js`
Expected: PASS（全テスト緑。`cyclicDist`/`chaseFactor` 3件＋既存）

- [ ] **Step 5: コミット**

```bash
git add js/layers/currents.js tests/currents.test.js
git commit -m "feat(currents): chaseFactor/cyclicDist 純粋関数（離散セルの順送りチェイス）"
```

---

## Task 2: `toDeckLayer` を chase/wave 分岐に

**Files:**
- Modify: `js/layers/currents.js:124-140`（`toDeckLayer`）

- [ ] **Step 1: 失敗するテストを書く**

`tests/currents.test.js` 末尾に追加（`deck` をモックして `toDeckLayer` の getFillColor 挙動を検証）:

```js
test('toDeckLayer: flow=chase は chaseFactor、flow=wave は waveFactor で alpha 駆動', () => {
  const captured = [];
  globalThis.deck = { ScatterplotLayer: function (cfg) { captured.push(cfg); Object.assign(this, cfg); } };
  const chase = currentsLayer.toDeckLayer(GEO, { cmap: 'sst', motionT: 0.25, flow: 'chase', chase: { step: 'hard' } });
  assert.equal(chase.length, 1);
  const cfg = captured[0];
  const sample = cfg.data[0];
  const col = cfg.getFillColor(sample);
  assert.equal(col.length, 4);
  assert.ok(col[3] >= 0 && col[3] <= 255, 'alpha は 0..255');
  // wave 分岐も呼べる（例外なく配列1件）
  const wave = currentsLayer.toDeckLayer(GEO, { cmap: 'sst', motionT: 0.25, flow: 'wave' });
  assert.equal(wave.length, 1);
  delete globalThis.deck;
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/currents.test.js`
Expected: FAIL（現 `toDeckLayer` は `flow` を見ず `waveFactor` 固定。chase 分岐が無く alpha 計算経路が異なる＝アサート不一致、または `chase` ctx 未対応）

- [ ] **Step 3: 最小実装を書く**

`js/layers/currents.js` の `toDeckLayer`（行124〜140）を以下に置換:

```js
  toDeckLayer(geojson, ctx) {
    const cmap = (ctx && ctx.cmap) || DEFAULT_CMAP;
    const mt = (ctx && ctx.motionT) || 0;
    const flow = (ctx && ctx.flow) || 'chase';
    const chaseOpts = (ctx && ctx.chase) || {};
    // 明るさ係数: chase=離散セルの順送り（既定）/ wave=旧 sine 波（?flow=wave 比較用）。
    const bright = flow === 'wave'
      ? (d) => waveFactor(d.phase, mt)
      : (d) => chaseFactor(d.phase, mt, chaseOpts);
    // 温度フィールド面（加算ブロブ）。淡い水温面を常時見せ、その上をチェイスが走る。
    return [new deck.ScatterplotLayer({
      id: 'currents', data: field(geojson, cmap), pickable: true,
      radiusUnits: 'pixels', stroked: false, filled: true,
      getPosition: (d) => d.position, getRadius: 1,
      radiusMinPixels: 26, radiusMaxPixels: 54,
      getFillColor: (d) => {
        const a = Math.min(255, Math.round(FIELD_ALPHA * bright(d)));
        return [d.rgb[0], d.rgb[1], d.rgb[2], a];
      },
      updateTriggers: { getFillColor: mt },
      parameters: ADDITIVE_BLEND,
    })];
  },
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/currents.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/layers/currents.js tests/currents.test.js
git commit -m "feat(currents): toDeckLayer を chase/wave 分岐（chase 既定）"
```

---

## Task 3: main.js で URL→ctx・微粒子削除（一本化）

**Files:**
- Modify: `js/main.js`（import 行13、CMAP 付近 行15-17、`currentsFlowLayer` 行114-150、`drawAll` 行244・247）

- [ ] **Step 1: URL パラメータ読み取りを追加**

`js/main.js` の CMAP 定義（行15-17）の直後に追加:

```js
// 海流の流れ表現。?flow=chase|wave、?step=hard|glide、?cells= ?tail= ?speed= ?peak= ?base= で実物比較。
const _qs = typeof location !== 'undefined' ? location.search : '';
const _qnum = (re) => { const m = re.exec(_qs); return m ? Number(m[1]) : undefined; };
const FLOW = (/[?&]flow=(chase|wave)/i.exec(_qs) || [])[1] || 'chase';
const CHASE = {
  step: (/[?&]step=(hard|glide)/i.exec(_qs) || [])[1] || undefined,
  cells: _qnum(/[?&]cells=([\d.]+)/i),
  tail: _qnum(/[?&]tail=([\d.]+)/i),
  speed: _qnum(/[?&]speed=([\d.]+)/i),
  peak: _qnum(/[?&]peak=([\d.]+)/i),
  base: _qnum(/[?&]base=([\d.]+)/i),
};
```

（`chaseFactor` は `undefined` を既定値にフォールバックするため、未指定キーはそのまま渡してよい。）

- [ ] **Step 2: ctx にフロー設定を渡す**

`drawAll` 内の `buildDeckLayers` 呼び出し（行244）を置換:

```js
  const base = buildDeckLayers(ENABLED, snapshots, undefined, { zoom, cmap: CMAP, motionT, flow: FLOW, chase: CHASE });
```

- [ ] **Step 3: 微粒子レイヤーを削除（一本化）**

(a) `drawAll` 内の currents-flow 行（行247）を削除:

```js
  if (ENABLED.has('currents')) { const cf = currentsFlowLayer(); if (cf) extra.push(cf); }
```

(b) `currentsFlowLayer` 関数とその上のコメント・`currentsPaths`・`CURRENT_PARTICLES`（行114-150 のブロック全体）を削除:

```js
// 海流の温度フィールド面の上を流れる粒子。経路上を pointAlongPath で進む多数の点を毎フレーム
// 生成し、局所水温で色付け（白寄りに明るく）。windy 風の「流れる場」を演出する。
let currentsPaths = null;
const CURRENT_PARTICLES = 14; // 1海流あたりの粒子数
function currentsFlowLayer() {
  // ...（関数全体）...
}
```

（行150 の閉じ `}` までを丸ごと削除する。）

(c) 不要になった import を整理。`colorForTemp`/`tempAtT` は削除した `currentsFlowLayer` でのみ使用していたため、import 行13 を削除:

```js
import { colorForTemp, tempAtT } from './layers/currents.js';
```

（`pointAlongPath` は航空 projection（行217）で使用継続のため import 行11 はそのまま残す。）

- [ ] **Step 4: 残存参照が無いことを確認**

Run:
```bash
grep -n "currentsFlowLayer\|currentsPaths\|CURRENT_PARTICLES\|colorForTemp\|tempAtT" js/main.js
```
Expected: 出力なし（すべて削除済み）

- [ ] **Step 5: node テスト全件が緑であることを確認**

Run: `node --test tests/*.test.js`
Expected: PASS（全件。currents 関連の回帰なし）

- [ ] **Step 6: コミット**

```bash
git add js/main.js
git commit -m "feat(currents): URL→ctx でフロー調整・微粒子削除でチェイスに一本化"
```

---

## Task 4: registry.js の DECK_TO_LAYER を整理

**Files:**
- Modify: `js/layers/registry.js:38`

- [ ] **Step 1: `currents-flow` エントリを削除**

`js/layers/registry.js` の `DECK_TO_LAYER`（行38）を置換:

```js
  currents: 'currents',
```

（`'currents-flow': 'currents'` を削除。currents-flow レイヤーは消滅したため。`currents`(ベース)は pickable で tooltip 解決に必要なので残す。）

- [ ] **Step 2: node テストが緑であることを確認**

Run: `node --test tests/*.test.js`
Expected: PASS

- [ ] **Step 3: コミット**

```bash
git add js/layers/registry.js
git commit -m "chore(registry): currents-flow を DECK_TO_LAYER から削除"
```

---

## Task 5: Service Worker 版を更新

**Files:**
- Modify: `sw.js:2`

- [ ] **Step 1: CACHE 版を上げる**

`sw.js` 行2 を置換:

```js
const CACHE = 'orbis-v13';
```

- [ ] **Step 2: コミット**

```bash
git add sw.js
git commit -m "chore(sw): cache v13（海流チェイス）"
```

---

## Task 6: 実物比較・本番検証

**Files:** なし（検証のみ）

- [ ] **Step 1: node テスト全件**

Run: `node --test tests/*.test.js`
Expected: PASS（全件緑）

- [ ] **Step 2: ローカル実物比較（既定値の確定）**

Run: `python -m http.server 8000`（リポジトリ直下）
ブラウザで以下を開き、引き(ズームアウト)で流れの向きが一目で読めるか・密集で雑然としないかを目視比較する:
- `http://localhost:8000/?flow=chase&step=hard`（既定候補）
- `http://localhost:8000/?flow=chase&step=glide`
- `http://localhost:8000/?flow=chase&step=hard&cells=8&tail=0.18&speed=0.9`
- `http://localhost:8000/?flow=wave`（旧波と比較）

比較結果から `step`/`cells`/`tail`/`speed`/`peak`/`base` の既定値を `js/layers/currents.js` の `CHASE_*` 定数に反映する（採用値のみ変更、他は調整用に残す）。**この採用はユーザーに実物確認してもらい合意の上で確定する。**

- [ ] **Step 3: 既定値を確定したらコミット**

```bash
git add js/layers/currents.js
git commit -m "tune(currents): チェイス既定値を実物比較で確定"
```

- [ ] **Step 4: 本番 Playwright 検証**

main マージ→`git push origin main`（Vercel 自動デプロイ）後、本番 URL（orbis-beta.vercel.app）を Playwright で:
- globe・**ズームアウト**状態でスクショ → 海流の離散セルが流れ方向へ順送り点灯しているか画素で目視。
- 淡い水温面(SST)が常時見えるか確認。
- コンソールエラー0・currents トグル ON/OFF。

Expected: ズームアウトで向きが読める／エラー0。

---

## Self-Review メモ

- **spec カバレッジ**: chaseFactor(Task1)・2層描画/flow分岐(Task2)・URL→ctx＆微粒子削除(Task3)・DECK_TO_LAYER整理(Task4)・sw版(Task5)・実物比較＆本番検証(Task6) → spec の全項目に対応タスクあり。
- **型/名称整合**: `chaseFactor(phase, motionT, opts)`・`cyclicDist(a,b)`・ctx キー `flow`/`chase` を Task1-3 で一貫使用。`CHASE` オブジェクトのキー（step/cells/tail/speed/peak/base）は `chaseFactor` の `opts` と一致。
- **プレースホルダ**: なし（全ステップに実コード・実コマンド）。
- **既定値の確定（Task6 Step2）はユーザー実物確認が必要**＝ここだけ subagent 単独完結ではなく人の判断を挟む。
