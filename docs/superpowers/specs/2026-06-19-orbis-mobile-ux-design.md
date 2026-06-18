---
date: 2026-06-19
project: orbis
topic: mobile-ux-bottom-sheet
status: design-approved
related:
  - docs/superpowers/specs/2026-06-13-orbis-design.md
  - Projects/orbis.md
---

# ORBIS モバイル UX 是正（ボトムシート方式）— 設計

## 1. 背景・問題（実画面で確認済み）

スマホ幅でのレイアウトが構造的に破綻している。デスクトップ＋モバイル実機エミュ（Playwright・390×844）でスクショ目視して確認した事実：

- 左パネル `#panel`「LAYERS」(固定 220px) と右パネル `#feed`「FEED」(固定 260px) が、いずれも絶対配置・固定幅・上端寄せのまま出力される。
- 390px 幅では `220 + 260 > 390` で **2 枚が横方向に重なり**、さらに両方が画面上部 ~70vh を占有して **没入の主役である地球儀をほぼ覆い隠す**。
- 原因＝`css/orbis.css` に `.side-panel` / `.feed-panel` 用のメディアクエリが一切無い（既存 `@media` は `.media-section` の縦積み 1 件のみ）。デスクトップの絶対配置がそのままモバイルに出ている。
- 診断値：mobile エミュで `canvas 390×844 / projection=globe / counts 全>0 / console error 0`。**globe 自体は描画されている**。

### 実機 WebGL P0 とは別問題（重要）
ユーザー報告の「実機スマホで地球儀が出ない」P0（= 別セッションの workstream A1）は、Playwright のモバイル**エミュレーション**では再現しない（canvas は正しく 390×844・globe 投影）。あれは実機 Safari の WebGL 固有問題の可能性が高い。**本 spec が扱うのはそれとは別の「レスポンシブ崩れ」**であり、純粋に CSS/UI レイヤーの問題。globe / `#map-wrap` の高さ・canvas サイジングには本 spec では一切触れない（P0 は別セッションの領域なので干渉しない）。

## 2. ゴール / 非ゴール

### ゴール
- スマホ幅（`≤768px`）で **globe を全画面の主役**にする。
- LAYERS / FEED を **ボトムシート**（下端タブ → タップで下からせり上がる）で提供し、既定では globe を覆わない。
- 下部メディアウォール（ニュース/カメラ）への **控えめなスクロール導線**を追加（メディアの存在に気づけない問題の解消）。
- **デスクトップ（>768px）の挙動は完全に不変**。
- **他セッションと衝突しない**（`js/main.js`・`js/layers/registry.js`・`collectors/*` を一切編集しない）。

### 非ゴール（別タスク／別セッション）
- 実機 Safari の WebGL globe P0（信頼性セッション・A1）。
- デスクトップの空間構成・没入感の刷新（黒余白・globe の存在感）。
- 右フィードの情報設計（紛争一色の単調さ・絞り込み）。
- 下部メディア領域の構造再編（2 ペインのまま）。

## 3. 確定した設計判断（ユーザー承認済み）

| 論点 | 確定 |
|------|------|
| 最初の重点 | モバイル UX 是正 |
| パネルの出し方 | **ボトムシート**（globe 全画面・下端 2 タブ・タップでせり上がり） |
| メディア導線 | **縦スクロール維持＋『▼ メディア』導線**（media 構造は現状の縦積みを活用） |
| デスクトップ | 不変 |

## 4. アプローチ：衝突ゼロの独立モジュール

**採用＝新規 `js/ui/mobile-nav.js` を `index.html` の独自 `<script type="module">` で読み込み、DOM を直接操作（CSS クラスの付け外し）して開閉する。**

- 観点【衝突回避・保守性】：`main.js`・`registry.js` を一切編集しない。別セッションの残 main.js 作業（`drawAll`/`motionLoop` 分離）と非衝突。
- 既存の `#panel` / `#feed` 要素は**再配置するだけ**。中身の再描画（`renderPanel` / `renderFeed`）・トグル配線・`.collapsed` 折りたたみ機構はそのまま温存する。
- `mobile-nav.js` はアプリ状態（snapshots/ENABLED/overlay）に依存しない。DOM（`#panel`/`#feed`/新規タブバー/`#media`）だけを参照して動く純粋な UI シェル制御。
- SW：`index.html`・`css/orbis.css` は SHELL キャッシュ対象。両者を編集するので `sw.js` の `CACHE` を `orbis-v29 → orbis-v30` にバンプ。新規 `mobile-nav.js` は SHELL 外＝常にネット取得（キャッシュ問題なし）。

### なぜ main.js に書かないか
`boot()` 内に書くと別セッションの main.js 編集とコンフリクトする。`#panel`/`#feed` は単なる DOM 要素で、開閉はクラス操作だけで完結するため、エントリ（index.html）に script を 1 行足すだけで独立初期化できる。

## 5. 詳細挙動仕様

ブレークポイント＝`@media (max-width: 768px)`（以下「モバイル」）。`>768px` は現状のまま。

### 5.1 globe 画面（モバイル既定）
- `#panel` / `#feed` を画面外に退避（`transform: translateY(110%)` など）。globe 全画面。
- 右上の鮮度ピル `#freshness` は小型化して残す（位置調整のみ）。
- デスクトップ用折りたたみボタン（`#panel-toggle` `#feed-toggle`）はモバイルでは `display:none`（シート自前の閉手段を使う）。

### 5.2 下端タブバー（新規 DOM）
- `index.html` に `#mobile-tabs`（`role="tablist"`）を追加。`[≡ レイヤー]` `[≡ フィード]` の 2 ボタン。
- モバイルのみ `display:flex`、デスクトップは `display:none`。
- セーフエリア対応：`padding-bottom: env(safe-area-inset-bottom)`。

### 5.3 シート開閉
- タブをタップ → 対応する `#panel` または `#feed` がシートとして下からせり上がる（高さ `min(72dvh, 560px)`・上端角丸・上端にドラッグハンドル・内部は既存の行がスクロール）。
- **同時に開くシートは 1 つ**（相互排他）。別タブをタップしたら今のを閉じて切替。
- 閉じる手段：①同じタブを再タップ ②背景（globe 側）のディマー幕タップ ③下スワイプ ④ハンドルタップ ⑤Esc キー。
- ディマー幕：シート開時に globe 上へ半透明オーバーレイ（`#sheet-scrim`）。タップで閉じる。
- 状態は `body[data-sheet="layers|feed|none"]` 属性で表現。CSS が属性に応じて表示。

### 5.4 メディア導線
- `#media` が存在し（`display:none` でない）かつ globe 画面が見えている間のみ、タブバー直上に控えめな `▼ メディア` ピルを表示。
- タップで `#media` へ `scrollIntoView({behavior:'smooth'})`。
- `#media` が画面に入ったら導線を隠す（IntersectionObserver か scroll 監視）。

### 5.5 アクセシビリティ／モーション
- タブ＝`<button>`・`aria-expanded`・`aria-controls`。シートに `aria-label`。開いたらシート内にフォーカス移動、閉じたらタブへ戻す。
- `prefers-reduced-motion: reduce` 時はスライドを廃しフェード／即時表示に。
- ブレークポイント跨ぎ（リサイズ/回転）で `matchMedia` 監視し、デスクトップ幅に戻ったらシート状態をリセット（開きっぱなし防止）。

### 5.6 iOS Safari の高さ
- シート高は `dvh`（動的ビューポート）基準。`#map-wrap` の高さ・canvas サイジングには**触らない**（WebGL P0 は別セッション）。シートはあくまで overlay として重畳。

## 6. モジュール責務（テスト可能化）

`js/ui/mobile-nav.js`：
- **純粋関数（node:test 対象）**
  - `nextSheet(current, clicked)`：現在開いているシート（`'layers'|'feed'|null`）とタップされたタブから次状態を返す（同じなら null=閉、違うなら切替）。相互排他ロジックの中核。
  - （必要に応じ）`shouldShowMediaHint(mediaVisible, mediaInView)` 等の小さな判定。
- **DOM 結線（e2e 対象）**：`initMobileNav(doc)` が DOM を取得し、タブ/幕/ハンドル/導線/キーボード/`matchMedia` を結線。`body[data-sheet]` を更新。
- main.js から import されない。`index.html` の独自 `<script type="module" src="js/ui/mobile-nav.js">` が末尾で `initMobileNav(document)` を呼ぶ（DOMContentLoaded 後）。

## 7. ファイル変更一覧（全て安全圏）

| ファイル | 変更 | SHELL? |
|----------|------|--------|
| `index.html` | `#mobile-tabs`・`#sheet-scrim`・`▼メディア`導線の DOM＋`mobile-nav.js` の script tag 追加 | ○（要バンプ） |
| `css/orbis.css` | `@media (max-width:768px)` でシート化・タブバー・幕・導線・既存パネルの退避 | ○（要バンプ） |
| `js/ui/mobile-nav.js` | 新規（純粋関数＋`initMobileNav`） | ×（ネット取得） |
| `sw.js` | `CACHE` `orbis-v29 → orbis-v30` | — |

**触らない**：`js/main.js`・`js/layers/registry.js`・`js/ui/{panel,feed,media,news-pane,cams-pane}.js` の挙動・`collectors/*`・`collect.yml`・`tests/test_*.py`。

## 8. テスト方針

- **node:test**：`tests/mobile-nav.test.js`（新規）で `nextSheet` 等の純粋関数（相互排他・トグル）。
- **Playwright e2e**：`tests/e2e/mobile-nav.spec.js`（新規）。モバイル viewport（≤768px）で
  ①既定で globe 可視・両シート閉 ②`レイヤー`タブで panel シート表示・`フィード`タブで feed シート表示 ③相互排他（切替で前のが閉じる）④幕タップ/再タップで閉じる ⑤`▼メディア`で `#media` へスクロール。
  - 実 globe 起動が重いので `test.setTimeout(60000)`・`workers:1` 維持（既存方針）。再生（YouTube）はアサートしない。
- **実機幅スクショ目視**（mistakes.md：描画は画素で確認）：`python -m http.server` ＋ Playwright で portrait/landscape の globe 既定・各シート開・導線を 1 枚ずつ確認。デスクトップ幅で**回帰が無い**ことも 1 枚確認。

## 9. リスクと対策

| リスク | 対策 |
|--------|------|
| SW 版バンプ忘れ → 旧 index.html/css 配信 | 変更チェックリストに v29→v30 を明記。本番 curl で sw 版確認。 |
| 既存 `.collapsed` 機構との干渉 | モバイルは別属性 `data-sheet` で制御。`.collapsed` はデスクトップ専用のまま。折りたたみボタンはモバイルで非表示。 |
| iOS 100vh ジャンプ | シートは `dvh`。map-wrap 高さは不変（触らない）。 |
| 全面 globe へのタブ/幕の pointer 干渉 | タブバー/幕は必要時のみ `pointer-events`。globe 操作（回転/ズーム）を塞がない。 |
| landscape で globe が低い | landscape も同 breakpoint 内なら同挙動。実機幅スクショで確認。 |
| 別セッションの未コミット変更との git 衝突 | 触るファイルが完全に別（css/index.html/js/ui/sw.js vs collectors/tests）。`git add` は**明示パスのみ**、`-A`/`.` 禁止。 |

## 10. 他セッションとの衝突回避・引き継ぎ

- 実装着手時に Obsidian `Projects/orbis.md` 冒頭に **UI/UX セッションのバナー**を追記（他セッションが読む場所）：担当＝モバイル UX 是正のみ／触るファイル＝`index.html`・`css/orbis.css`・`js/ui/mobile-nav.js`（新規）・`sw.js`／**`main.js`・`registry.js`・`collectors` は非編集**。
- 既存の信頼性セッション・バナーは残す（上書きしない・追記する）。
