# ORBIS デザイントークン体系化 ＋ アイコン刷新（favicon/PWA）設計

- date: 2026-06-24
- thread: デザイン監修（リッチ化）/ アイコン横展開（残1=orbis）
- status: design（承認待ち）
- worktree: `worktree-design-tokens-icon`（base main cfdc20d）
- 関連: Obsidian `Projects/orbis-design-supervision.md` / `Workflows/icon-brushup.md` / `Preferences/app-design-patterns.md`

## 1. 目的

ORBIS（世界リアルタイム監視ダッシュボード）のデザイン基盤を2点で底上げする。

- **A. カラー体系化**：色リテラル（hex 約100＋rgba 約228）がCSS全体に散在し、`:root` のトークンはごく一部のみ。セマンティックなトークン体系を `:root` に確立し、保守性・一貫性・将来のリッチ化追記の安定性を上げる。
- **B. アイコン刷新**：現アイコンは PIL 生成の素朴なワイヤーフレーム球で、本体の「Deep Navy＋Aurora globe」ルックと乖離。さらに **ブラウザタブ用 favicon が未設置**（index.html に `<link rel="icon">` が無い）。本体世界観に統一したアイコンへ刷新し、favicon を新設する。

オーナーの確定事項（2026-06-24・実物比較）:
- アイコン採用 = **B 軌道環（orbit-rings）**：globe＋傾きの違う軌道環2本＋発光観測ノード＋オーロラグロー。
- トークン方針 = **基盤先行・クラスタ集約 承認**。

## 2. ゴール / 非ゴール

### ゴール
- A: 完全なセマンティックトークン体系（6グループ・約115トークン）を `:root` に定義。既存変数は名称も値も維持。主要サーフェス（foundation surfaces）からトークンへ移行。
- B: 採用案Bを master SVG 化し、PWA アイコン（192/512/apple-touch 180）を SVG→Chromium で再生成。globe 性を強めた favicon（svg＋png フォールバック）を新設し index.html に結線。

### 非ゴール
- 全色リテラルの全面トークン置換（巨大diff・回帰/衝突リスク大）はしない。foundation surfaces 以外は段階移行（追って）。
- 既存変数（`--bg`/`--cyan`/`--line`/`--text`/`--muted`/`--panel`/`--glass-*`/`--neb-*`/`--font-*`/`--edge-pad`）の値変更はしない。
- globe 本体描画（globe-density スレッド）・起動演出（design-loading スレッド）の領分には踏み込まない。

## 3. Part A — カラートークン体系（基盤先行）

### 3.1 トークン分類（6グループ・約115トークン）
| グループ | 接頭辞 | 役割 | 数 |
|---|---|---|---|
| 背景層 | `--bg-*` | 深宇宙→面パネルへ向かう暗→明の階段（層0ベース/層1星空/層2パネル/カード/スクリム/タブバー等） | 26 |
| アクセント・オーロラ | `--accent-*` `--aurora-*` | 主シアン/紫アクセント＋オーロラ細線・地平線シーム（線で見せる溶け込み） | 13 |
| テキスト階層 | `--text-*` `--muted` | 明→暗の8段＋特殊（映像上純白/プレースホルダ/淡補助） | 12 |
| カテゴリ色 | `--cat-*` | 層/状態の意味色（紛争赤/トレンド緑/件数ピンク/stale アンバー/海流・水温ランプ） | 21 |
| グラス・縁 | `--glass-*` `--rim-*` | 面の縁取り・内側ハイライト（cyan 縁段 .08〜.68/紺縁/白inset） | 22 |
| グロー・発光 | `--glow-*` | 外側光・text-shadow・ドロップ影（cyan 発光段/紫/緑/黒影/字幕アウトライン） | 21 |

完全な `:root` は本spec末尾の付録に全文掲載（実ファイル: `design/taxonomy-rootblock.css`）。

### 3.2 クラスタ集約ポリシー（承認済み）
- 視覚的に区別困難な近接重複値は**代表値1つに集約**してトークン乱立を回避（例：見出し系 `#e7f3ff`/`#e8f0ff`/`#e8f2ff` → `--text-heading` に1本化）。
- 集約による色の微差は知覚閾下。各トークンのコメントに「どの実値群を集約したか」を明記済み。
- 値が実リテラルと完全一致するサーフェスは**完全一致置換**（ゼロ変化）を優先。代表値が元と異なる箇所のみ知覚閾下の微差が生じる。

### 3.3 移行スコープ（foundation surfaces のみ・今回）
定義は全トークンを行うが、**リテラル→`var()` 置換は以下の主要サーフェスに限定**する（残りは段階移行・追って）:

> **未使用トークンは意図的**：`:root` には全グループを定義するが今回 `var()` 参照されないトークン（foundation 以外）が残る。これは「散在リテラルの整理＝体系の文書化」そのもので、将来サーフェスを触る人が `var(--token)` を引くための**正準パレット**。グループ化＋クラスタ集約済みで「乱立」ではない（無参照CSS変数は実行時コストゼロ）。

1. 背景層3階段：`--bg-0`/`--bg-1`/`--bg-panel`(=panel)/`--bg-control`/`--bg-card` を `#starfield`・`#loading`・各パネル（side-panel/freshness/popup）・タブ/ボタンへ。
2. アクセント基軸：`--accent-cyan`(=cyan)/`--accent-purple` をワードマーク/boot/active枠/オーロラ細線の基準に一本化。
3. テキスト階層：`--text-bright`/`--text-heading`/`--text`/`--text-2`/`--text-muted`/`--muted`/`--text-muted-2`/`--text-muted-3` を見出し・本文・ミュートへ。
4. グラス・縁：`--glass-rim`＋`--rim-cyan-16/18/20/22/35/46/68`＋`--rim-white-05` を side-panel/media-player/cam-cell/panel-head の border・inset へ。
5. グロー・発光：`--glow-cyan`(.34)/`--glow-cyan-strong`(.5)/`--glow-cyan-active`(.65)/`--glow-cyan-aurora`＋`--glow-shadow` を active glow・見出し text-shadow・mp/mobile-tab のドロップ影へ。
6. 状態色 stale：`--cat-stale`/`--cat-amber-border`/`--cat-amber-glow` を `#freshness.stale`・src-stale・alert へ。

### 3.4 ファイル
- `css/orbis.css` 冒頭 `:root`：既存定義の**直後にセマンティック層を増設**（既存行は不変）。
- `css/orbis.css` 本文：foundation surfaces の該当リテラルを `var(--token)` に置換。

### 3.5 回帰防止
- 移行は CSS のみ（JS/HTML 不変）。
- **before/after の実描画スクショ差分**で検証（localhost `?data=github` で AI/データ系セクションも描画させ、主要サーフェスを 4K/FHD で撮り比較）。GPU 依存（blur/glow）は headless と乖離するため、最終はオーナー実機でも確認。
- look トグル（`js/lib/look.js` が一部CSS変数を上書き）との競合に注意：look が触る変数名は変えない（`--glass-*` 等は既存名維持済み）。

## 4. Part B — アイコン刷新（採用案B 軌道環）

### 4.1 master / favicon の意匠
- **master（512 viewBox・リッチ版）**：採用案B `orbit-rings`。濃紺globe（中心256,256・半径122）＋外縁 rim halo（r138）＋傾きの違う楕円軌道環2本（オーロラ cyan→purple→teal のグロー）＋環上の発光観測ノード（376,316）＋四隅の淡い星。
  - マスカブル安全域：globe本体・ハロ・ノードは中央80%安全円（r205）内。軌道環の先端のみ安全円をわずかに越える（**「環の端はクロップ前提」＝仕様通り**）。四隅の星は装飾でクロップ可。背景 `#05080f` 全面ブリード。
- **favicon（16〜32px向け簡素版）**：微細グロー/星/オーロラpool/softglowフィルタを全廃、ストロークを6〜13pxに増強、メリディアンを1本に削減。
  - **追加要件**：B は小サイズで原子記号的に見えやすい。faviconは **globe 性を最優先**（球＋赤道/メリディアンのシルエットを主役にし、軌道環は1〜2本に絞って従属させる）。**16px 実レンダで「球体」と読めることを必須の受入基準**とし、不足なら環をさらに簡素化する。

### 4.2 生成パイプライン
- master を `icon-master.svg`（リポルート）として配置。
- `scripts/make_icons.py` を **PIL方式 → SVG→Chromium方式に書き換え**（既存PILは glow/gradient を再現不可）。playwright 同梱 Chromium で `icon-master.svg` を 512/192 PNG、apple-touch を 180 PNG に書き出し（既存 `apple-touch-icon.png`/`icon-192.png`/`icon-512.png` を同名上書き）。
  - 既存実績（nexus/kakeibo 等の gen_icons.py）と同じ data:base64 + `<img>` スクショ方式。
- `favicon.svg`（リポルート）を favicon 簡素版に。`favicon-32.png`（PNGフォールバック）も Chromium で生成。

### 4.3 結線（index.html / manifest / sw）
- `index.html` `<head>` に追加：
  - `<link rel="icon" type="image/svg+xml" href="favicon.svg" />`
  - `<link rel="icon" type="image/png" sizes="32x32" href="favicon-32.png" />`（SVG非対応ブラウザのフォールバック）
  - 既存 `apple-touch-icon` は icons/apple-touch-icon.png のまま（再生成で中身更新）。
- `manifest.webmanifest`：icons は現状維持（192/512）。**マスカブル可否を実検証**し、globe が安全円内で環の先端クロップが意図通りに見えるなら 512/192 に `"purpose": "any maskable"` を付与、違和感があれば `"any"` 据え置き。`background_color`/`theme_color` は `#05080f` 維持（縁色と近い）。
- `sw.js`：`CACHE` を `orbis-v44` → `orbis-v45` に bump（SHELL に index.html/css を含むため衛生面で）。SW は全面ネットワーク優先ゆえ厳密には不要だが workflow 規約に従う。

### 4.4 配信（重要）
- `vercel.json` は `{version:2, framework:null, cleanUrls:true}` で **`builds` 無し＝ゼロコンフィグ静的配信**。新規 `favicon.svg`/`favicon-32.png`/`icon-master.svg`、再生成PNGはルート/icons配下にあれば**自動配信**（icon-brushup の builds 列挙問題は非該当）。
  - 注意：`icon-master.svg` はルート配置だと配信されるが実害なし（軽量）。`.vercelignore` は `scripts/`/`docs/` を除外済（make_icons.py/spec は ship されない）。
- **本番化後は curl で 200／Content-Type／（同名上書きは size 一致）を確認**してから完了とする（ローカルにファイルがあるだけで判断しない）。

### 4.5 検証
- 生成された**実PNG**で確認（モック不可）。favicon は 16/32px 実レンダを目視。
- マスカブル安全域：採用案を iOS角丸/Android丸クロップ/正方形＋安全域破線で実画像確認。
- 本番 curl：`/favicon.svg`・`/favicon-32.png`・`/icons/icon-192.png`・`/icons/icon-512.png`・`/icons/apple-touch-icon.png` が 200／正しい型。
- 実機サニティ：OSアイコンキャッシュが強いのでホーム再追加/PWA再インストール/タブ再読込で反映確認（オーナー）。

## 5. 触れるファイル一覧
- `css/orbis.css`（:root 増設＋foundation surfaces 置換）
- `index.html`（favicon link 追加）
- `manifest.webmanifest`（purpose 検証次第）
- `sw.js`（CACHE bump）
- `scripts/make_icons.py`（PIL→Chromium 書き換え）
- 新規：`icon-master.svg`／`favicon.svg`／`favicon-32.png`／（再生成）`icons/icon-192.png`・`icon-512.png`・`apple-touch-icon.png`

## 6. テスト
- 既存 JS テスト（`tests/*.test.js`）・e2e（`tests/*.spec.js`）が回帰しないこと（immerse/mobile-shell/feed-readability 等）。今回 immerse.js は触らないので immerse.test は不変のはず。
- 必要なら **トークン健全性の軽い node テスト**（`:root` に重複定義が無い・foundation surfaces に未定義 `var()` 参照が無い）を追加検討。
- アイコンは生成PNGの存在＋本番 curl を検証根拠にする（headless スクショは GPU 演出が出ないため最終判断にしない）。

## 7. 統合・ロールアウト
- worktree で実装 → `ExitWorktree(keep)` → main で `fetch && merge worktree-design-tokens-icon && push`。
- **css 末尾は複数スレッドが追記し衝突しがち**。今回の `:root` 変更は**冒頭**なので末尾追記系（mp-/ui-/sec-/legend-/feed-/mui-）とは原則衝突しないが、main が進んでいたら冒頭 `:root` で衝突する可能性 → マージ時は両者の定義を保持。
- 本番 https://orbis-beta.vercel.app/ を push（Vercel 自動デプロイ）→ curl 検証 → オーナー実機確認 → Obsidian 所有ノート更新。

## 8. リスク
- カラー移行の視覚回帰（クラスタ集約の微差）→ before/after スクショ＋実機で担保。foundation surfaces に限定し範囲を絞る。
- B アイコンの小サイズ識別性（原子記号化）→ favicon を globe 優先に詰め、16px 受入基準を必須化。
- マスカブル時の環クロップ → 安全域実画像で意図通りか確認、不安なら purpose any 据え置き。

## 付録：提案 `:root`（全文）

実ファイル `design/taxonomy-rootblock.css` を参照（160行）。グループ構成は §3.1 の表、ポリシーは §3.2 の通り。実装時は既存 `:root`（12〜19行相当）を残し、その直後に背景層以降を増設する。
