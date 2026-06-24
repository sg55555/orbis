# ORBIS デザイン監修：後付けセクションの馴染ませ＋トークン移行 Wave1（設計）

date: 2026-06-24
thread: デザイン監修（リッチ化）
related: 2026-06-21-orbis-section-structure-design / 2026-06-24-orbis-design-tokens-icon-design

## 背景・課題
後付けで実装した **AI FORECASTS (#forecasts)** と **データソース & 鮮度 (#sources)** が、
既に統一済みの規範デザイン言語（sec-on の「線/光・大気ハロ・グラス＋ネオン縁」）から外れて「浮いて」見える。

Understand フェーズ（4観点 workflow）で確定した乖離：

- **#forecasts（ボックス型）**：
  - `.fc-card` が**四方を囲む full border**でカテゴリ色を出す＝「面/箱」（規範は `border-left:3px`＋glow dot の「線/光」）。glow dot 皆無。← 最大の浮き要因。
  - コンテナ箱が cyan 縁＋やや明るい青地で #instability（紺縁）と非対称。
  - タブ/カードの hover が「面ハイライト」のみ（規範はネオン縁＋cyan glow）。
- **#sources（全幅ショーケース型）**：
  - 外形/見出し/章区切りは `#app>section` 自動規約に乗り規範通り。だが中身 `.src-row` が
    **背景/縁/角丸/glow/hover/左アクセント/glow dot 皆無の素のテーブル**＝最も「裸」。
  - stale が `#f3a85a`（=`--cat-stale-2`）文字色だけで、規範 stale 表現（アンバー縁＋glow）と不一致。
  - ※ `#alerts` の `.alert-chip` は既にグラス＋ネオン縁で規範適合 → 対象外。

加えて、カラートークン移行の**残り（基盤先行で :root に定義済だが本文未参照の cyan/glow/黒影/白inset）**の
うち、最も安全な **Wave1（cyan border 単一用途・視覚不変）** を本セッションで進める（オーナー 2026-06-24 指示の次起点）。

## 目標
1. #forecasts / #sources を規範デザイン言語に馴染ませる（「面」を足さず「線/光/縁」で）。
2. 馴染ませは **新 `?param` トグル（既定 on）** で before/after を localhost 実物比較できる形にする
   （既存 mp/ui/sec/feed/mui と同流儀）。
3. 馴染ませ CSS は**定義済トークンで記述**＝トークン移行を兼ねる。
4. トークン Wave1（cyan border 単一用途）を視覚不変で本文置換し、var-health 波テストで固定。

## 非目標
- globe 本体（globe-density 領分）・boot（design-loading 領分）には触れない。
- トークン Wave2-5（黒影/白inset/cyan glow/二重用途/gradient）は別セッション（各波で実物比較が要るため）。

## スコープ拡大（オーナー実機 FB により反復で追加・2026-06-24）
当初の「馴染ませ＋Wave1」から、実機レビューの FB で以下が加わった（すべて `?secfit` トグル配下）：
- **見出しシステム Option A（HUD・英語コード名主体）**：全8セクション見出しを「SVGラインアイコン＋英語コード名（Saira大文字・cyan発光）＋日本語descriptor（2行目）」に。off=emoji＋日本語名（before）。
- **色味の混色**：#instability/#forecasts の hot な neon（バー/グロー/上昇トレンド）を `color-mix` でアウロラ紫に混色し「はっきり赤」を回避（briefing の混ざったテイストへ）。
- **ガラス感強化**：カード/箱をより透明＋すりガラス化。
- **#instability 縦ライン整列**：trend を固定2カラム化。

### 所有境界に関する注記（要マージ調整）
- Option A の英語見出しは markup に英語/日本語の span が必要なため、**他スレ所有の #ai-brief（.brief-h）／#instability（.ins-h）／#media 見出しの markup を編集**した（当初 spec の「他スレ markup は変えない」を実態で更新）。CSS だけでは英語テキストを足せないため不可避。
- **#instability の縦整列のため `js/ui/instability.js` の `_trendBadges` を編集**（昨日比/平常比を常に2スロット出力。欠落側は空プレースホルダ＋`ins-dod`/`ins-normal` クラス）。
- これらは AI機能スレ所有。**統合（merge）時に origin/main（Phase2 ドリルダウンで先行・CSS 末尾は同一アンカーに追記＝衝突確実）を先に merge し、両ブロック保持で解消**。AI機能スレへ「見出し markup＋_trendBadges を触った」旨を申し送る。

## 設計言語（厳守）
- orbis＝宇宙的/天体的。主アクセント＝地球の縁の大気ハロ（線/光）。**面（不透明ベタ/radial）を足さない**。
- リッチさは塊でなく「線の密度・精緻さ・光の連動」。サーフェスも背景に馴染ませる。
- glass/blur 自体は規範（side-panel/ins-section が使用）。四角い滲み問題は「グラスパネルの背後に光面を置く」場合の話で、
  本セクションは globe 下のスクロール領域（深宇宙背景の上）ゆえ ins-section と同じく backdrop-filter:blur 可。

## 採用デザイン（オーナー確定 2026-06-24）

### #sources = instability 型ボックス
- index.html で `.sources-head`（見出し）＋表（`.src-head-row`＋`.src-list`）を **`.src-panel` でラップ**。
- `body.secfit-on .src-panel` = #instability と同じグラス箱：`--bg-section` 地＋`--rim-blue-grey` 縁＋
  border-radius 14px＋backdrop-filter blur(8px)＋内パディング。
- 各データ行（`.src-list .src-row`）に **鮮度色**の左アクセントバー（::before 絶対配置・grid を乱さない）＋
  `.src-name::before` の glow dot＋hover で `--aurora-cyan-wash` 地＋アクセント glow。
- **鮮度色＝この節の本質**：通常 = `--cyan`（大気ハロ）／stale = `--cat-stale`（アンバー）。
  → JS の層→色マップ不要。「データソース & 鮮度」の意味（新しい=cyan / 古い=アンバー）を色で直接表現。
- 列見出し行（`.src-head-row`）は dot/accent 無し（`.src-list` スコープ外）＋データ行と左パディングを揃える。

### #forecasts = カードを線/光化＋箱トーン統一
- `body.secfit-on #forecasts.panel-section`：箱の地/縁を `--bg-section`/`--rim-blue-grey` に（#instability と統一）。
- `body.secfit-on .fc-card`：full border 撤去 → `--glass-rim` 1px＋`border-left:3px var(--dom,var(--cyan))`、地 `--bg-card-soft`（brief-card と同トーン）。
- `body.secfit-on .fc-head::before`：ドメイン色の glow dot（brief-dot 言語）。
- `body.secfit-on .fc-tab:hover/.fc-tab-active`：ネオン縁＋cyan glow（sec-on news-tab と同値）。
- watch カードは左アクセントを `--rim-watch`（青灰）に（控えめ維持）。

### トグル
- `?secfit=on|off`（大小無視・既定 on）。`immerseSectionFit` → `immerseClasses` が `secfit-on|off` を body に常時付与。
- off = 現行 base CSS（before）がそのまま見える。

### トークン Wave1（cyan border 単一用途・視覚不変）
- `rgba(57,208,255,.16|.18|.20)` の **border 用途**を `var(--rim-cyan-16|18|20)` に置換（値一致）。
- 対象 8 箇所（boot=250行・mui=1113行 は領分外で除外）。
- 馴染ませ CSS も最初からトークンで記述（移行を兼ねる）。

## テスト（TDD）
- `tests/immerse.test.js`：`immerseSectionFit`（既定 on・?secfit=off・?secfit=ON・不正=on）＋ `immerseClasses` 末尾に `secfit-on`。
- `tests/design-tokens.test.js`：Wave1 波テスト＝`--rim-cyan-16/18/20` が本文で `var()` 参照されている（var-health は既存で定義を担保）。
- `tests/secfit.test.js`（新規・CSS 文字列回帰）：`body.secfit-on .src-panel`／`.fc-card` の `border-left`／glow dot（`.fc-head::before`／`.src-name::before`）／stale アンバー の各規則が存在し、**面（不透明ベタ background の新規追加）を使っていない**ことを確認。
- e2e（既存 forecasts-headline.spec.js）回帰なし＝fc-title 見出しは非編集。

## 受け入れ
- node テスト全緑・既存回帰なし。
- localhost `?data=github` で #forecasts/#sources が描画され、`?secfit=off` と比較して馴染みが改善。
- GPU 依存（glow/blur）はオーナー実機確認 → 採用確定後 main 統合・本番 curl 検証。
