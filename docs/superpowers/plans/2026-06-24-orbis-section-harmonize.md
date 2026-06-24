# 実装計画：ORBIS 後付けセクション馴染ませ＋トークン Wave1

date: 2026-06-24 / spec: 2026-06-24-orbis-section-harmonize-design.md / TDD

## タスク（順）

### T1. immerse トグル（TDD）
- RED: `tests/immerse.test.js` に `immerseSectionFit`（既定 on・off・大小無視・不正=on）＋ `immerseClasses` 末尾 `secfit-on` を追加。
- GREEN: `js/lib/immerse.js` に `immerseSectionFit(search)`（regex `/[?&]secfit=(on|off)/i`・既定 on）を追加し、`immerseClasses` 末尾に `'secfit-' + immerseSectionFit(search)` を push。
- 注意: 既存 `immerseClasses` 期待値テスト（94-102行）も末尾 `secfit-on` を追加して更新。

### T2. #sources ラップ（markup）
- `index.html` #sources：`.sources-head` ＋ `.src-head-row` ＋ `.src-list` を `<div class="src-panel">` で囲う。
- sources.js は `querySelector('.src-list')` ゆえ非破壊（回帰なし）。

### T3. 馴染ませ CSS（secfit ブロック・トークンで記述）
- `css/orbis.css` 末尾に「後付けセクション馴染ませ (?secfit=on|off 既定on)」ブロック追加：
  - `.src-panel` グラス箱（--bg-section/--rim-blue-grey/radius14/blur8/padding）。
  - `.src-list .src-row` 左アクセント(::before 絶対)＋`.src-name::before` glow dot＋hover＋stale アンバー。鮮度色 `--srccat`（既定 --cyan / stale --cat-stale）。
  - 列見出し行と左パディング整合。
  - #forecasts 箱トーン統一・`.fc-card` 左アクセント＋glow dot・タブ neon glow・watch 控えめ。
- 全演出は線/glow/縁。**面（新規 radial/不透明ベタ background）を足さない**。

### T4. トークン Wave1（視覚不変置換）
- cyan border `.16/.18/.20` を `var(--rim-cyan-16/18/20)` に（596/745/787/839/871/1007/1186/320）。boot 250・mui 1113 は除外。

### T5. 回帰テスト追加
- `tests/design-tokens.test.js` に Wave1 波テスト。
- `tests/secfit.test.js`（新規・CSS 文字列）で secfit 規則の存在＋面非使用を固定。

### T6. 検証
- `node --test tests/` 全緑。
- localhost `python -m http.server` ＋ `?data=github` で描画確認・`?secfit=off` 比較（layout は Playwright、glow/blur はオーナー実機）。
- ultracode 自己レビュー workflow（面禁則違反0・乖離解消・回帰なし）。

## 統合（別フェーズ・effort 降格後）
- ExitWorktree(keep) → main で merge → push → 本番 curl（cleanUrls 正準 `/`）→ 所有ノート更新。
- css 末尾は複数スレ追記で衝突しがち → 両ブロック保持で解決。
