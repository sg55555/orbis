---
date: 2026-06-21
tags: [orbis, design, richness, starfield, globe]
project: orbis
related: [[orbis-design-supervision]]
---

# ORBIS 大画面 globe 周辺リッチ化 設計書（spec）

## Goal

4K/ワイド画面で globe 周囲の黒余白が広く第一印象が寂しい問題を、**点・光の言語**（星密度・微粒子・極淡い周辺光）で解消する。globe 本体（主役）は一切触らず、周辺の演出だけを足す。`?space=1|2|3|off` で強さを実物比較し採用段を確定する（デザイン監修スレッドの確立フロー）。

## 背景・現状計測（コード根拠・headless 乖離ではない）

- **星に上限**：`js/lib/starfield.js` の星数は `Math.min(600, w*h*0.00018)`。4K（3840×2160）は理論 ~1493 だが **600 で頭打ち** → 面積が FHD の4倍なのに星は ~1.6倍しか増えず**相対的に疎**。FHD ~373・HD ~189（これらは上限未満なので不変）。GPU 非依存の設計上限ゆえ実機でも同じ。
- **星雲（面）は廃止済み**：現状 globe 画面の背景は `#starfield` の radial vignette（中央 `#0a1220` → 縁 `--neb-base`）＋点の星のみ。
- **星雲面を廃止した主因（main.js:285 に明記）**：「**globe 拡大時に panel と干渉し四角く見える**ため廃止＝アクセントは大気ハロに一本化」。＝面の光が panel/feed/legend の `backdrop-filter:blur`（グラス）越しに四角く滲んだ。
- `--neb-a`(青 `rgba(46,111,179,0.12)`) / `--neb-b`(紫 `rgba(138,92,246,0.08)`) は media 帯（`body.mbg-deep #media`）の隅 radial でのみ使用。globe 画面では未使用。
- 大気ハロ（`map.setSky`・`applyAtmosphere`）は globe 本体に密着し、globe と画面端の間の広い余白は埋めない。

## 設計言語・制約

- ORBIS＝宇宙的/天体的。主アクセント＝地球の縁の大気ハロ（線/光）。**反射的にサイバーパンク HUD を足さない**。
- **リッチさは「塊」でなく線の密度・精緻さ・光の連動で**（[[orbis-design-supervision]]／user_design_pref）。
- **最重要制約＝panel グラス干渉の回避**：周辺光は四隅のグラスパネル（左上 `#panel`／右上 `#feed`／右下 `#legend`）の背後を避け、パネルのない領域に極淡く置く。これが星雲面廃止の主因なので、**実物比較で「panel 越しに四角く見えないこと」を採用条件とする**。
- **触らない領分（globe-density セッション）**：globe 本体＝`densityScale`／`blobRadius`／海陸色（`style.js`）／`setSky`（大気ハロ）。本作業は `#starfield`（背景 canvas）と CSS 背景・`immerse.js`・テストのみ。
- **退避路**：`?space=off` で完全に現状（before）へ戻せる。

## コンポーネント

### 1. 星の質と量（`js/lib/starfield.js` 拡張）

- **純粋関数 `starCount(w, h, level)`**：面積比例＋level 別上限。
  - `density = 0.00018` 維持。`cap = { 1: 760, 2: 900, 3: 1100 }[level]`（off は現状の 600）。
  - `return Math.min(cap, Math.round(w * h * density))`。FHD（理論373）は cap 未満で**不変**、4K（理論1493）で level に応じ増。
- **奥行き（`generateStars` 拡張）**：星を2階層に。
  - 微小多数（~92%）：`r 0.3–0.9`、`alpha 0.20–0.60`。
  - 明るい少数（~8%）：`r 1.2–2.2`、`alpha 0.7–1.0`、描画時に淡いグロー（`shadowBlur` か二重 arc）。
  - star オブジェクトに `bright:boolean` を持たせる（純粋・テスト可能）。`brightRatio` は引数化（既定 0.08）。
- 既存の twinkle（明滅）・流れ星はそのまま。reduced-motion は静止描画（既存 `drawStars` を bright 対応に拡張）。

### 2. 微粒子ダスト（`js/lib/starfield.js` に統合）

- **純粋関数 `generateDust(count, w, h, rng)`**：`{ x, y, r: 0.3–0.8, vx, vy: 極低速 ±0.003–0.012 px/ms, alpha: 0.05–0.18 }`。
- **純粋関数 `stepDust(dust, dt, w, h)`**：位置をドリフト＋画面外ラップ（純粋・テスト可能）。
- `count` は level 連動：`{ 1: 18, 2: 32, 3: 48 }`。星と同一 canvas・同一 rAF ループで描画。
- alpha 極淡ゆえ globe 上に重なっても視認を妨げない。reduced-motion で静止（ドリフトせず初期位置に淡く描画）。

### 3. 周辺光（CSS・`css/orbis.css` 末尾）

- `body.space-1|2|3 #starfield` の `background` に、既存 vignette へ neb-a/neb-b の極淡い radial を重ねる。
- **配置はパネルを避ける**：上部四隅（panel/feed）と右下（legend）を外し、**左右中段＋下部寄り**に置く。例（level 2）:
  ```css
  body.space-2 #starfield {
    background:
      radial-gradient(48% 60% at 6% 52%, var(--neb-a) 0%, transparent 60%),   /* 左・中段（panel/feed/legend を外す） */
      radial-gradient(46% 56% at 95% 60%, var(--neb-b) 0%, transparent 60%),   /* 右・中〜下段 */
      radial-gradient(ellipse at 50% 42%, #0a1220 0%, var(--neb-base) 82%);    /* 既存 vignette は最背面に保持 */
  }
  ```
- level で濃さを連動（1=控えめ／2=程よい／3=濃い）。neb-a/neb-b 自体が極淡い rgba ゆえ「塊」になりにくいが、level 3 でも panel グラス越しに四角く見えないことを実物確認。
- 既存の `#starfield` 基底 background（vignette）は不変（space-off は現状）。

### 4. `?param`（`js/lib/immerse.js`）

- **`immerseSpace(search)`** → `'1' | '2' | '3' | 'off'`。無効/未指定は採用段（暫定 `'2'`・実物比較後に確定）。大小無視。`immerseNeb` の直後に追加。
- `immerseClasses` に `out.push('space-' + immerseSpace(search))` を追加（既定で `space-2`・`?space=off` で `space-off`）。`main.js:288` の適用機構に自動で乗る（**main.js 非編集**）。
- **JS 側（星 cap・dust 数・bright）**：`starfield.js` が `immerseSpace(location.search)` を import して level を自己決定（main.js の `mountStarfield` 呼び出しは不変＝**main.js 非編集**）。`space-off` は現状値（cap 600・dust 0・周辺光なし）。
- CSS（周辺光）と JS（星/粒子）が同じ `immerseSpace` を参照＝level が一致。

## globe 主役の担保（退避路）

- 周辺光は globe 背後（中央 50% 45% 付近）を避け、パネルも避ける。粒子は alpha 極淡。`?space=off` で即 before。
- オーナーが「塊っぽい/うるさい/四角い」と感じたら段を下げる or off。

## 性能

- 星 arc は安価（FHD 373 が既に 60fps 稼働）。4K で cap ~1100＋dust ~48 を同一 rAF に統合。**4K 実機で fps を計測**して cap を最終調整。bright のグローは shadowBlur 多用を避け（二重 arc 等の安価手段）描画コストを抑える。reduced-motion で静止。

## テスト

- `tests/starfield.test.js`（新規 or 既存拡張）：`starCount`（cap・面積比例・level別・FHD不変）、`generateStars`（bright 比率・2階層レンジ）、`generateDust`/`stepDust`（生成レンジ・ラップ）を node:test。
- `tests/immerse.test.js`：`immerseSpace`（既定/1/2/3/off/大小無視/無効）＋ `immerseClasses` に `space-` が常時付与。
- e2e：`#starfield` canvas 存在、`?space=off` で `body.space-off`、既定で `body.space-2`（描画の画素は GPU 依存ゆえ構造のみ）。

## 採用条件（実物比較・オーナー確定）

1. ローカル `python -m http.server` で `?space=1|2|3|off` を 4K/FHD/モバイルで実物比較。
2. **panel/feed/legend のグラス越しに周辺光が四角く見えないこと**（星雲面廃止の再発防止＝最優先）。
3. globe が主役のまま（周辺光・粒子が globe の視認を妨げない）。
4. 4K で黒余白の寂しさが解消し、FHD/モバイルが現状から悪化しないこと。
5. 採用段を `immerseSpace` の既定に確定（コミット）。`off` と他段は比較用に残置。

## ファイル touchpoints

- `js/lib/starfield.js`（拡張・新規純粋関数 starCount/generateDust/stepDust・bright 対応・immerseSpace 自己読み）
- `js/lib/immerse.js`（`immerseSpace` 追加＋`immerseClasses` に `space-`）
- `css/orbis.css`（**末尾**に `body.space-N #starfield` ブロック・他スレッドと衝突時は両ブロック保持）
- `tests/starfield.test.js`・`tests/immerse.test.js`
- **main.js 非編集**・**index.html 非編集**（既存 `#starfield` をそのまま使う）・**globe 本体非編集**
- SW：network-first ゆえ bump 不要
