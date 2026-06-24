# ORBIS セクション分け＋ニュース以下リッチ化 ゾーン③ デザイン監修

- date: 2026-06-21
- status: 承認済み（共通幅に収める＋スクロール演出ON）／visual-polish 軽量フロー
- scope: 下部セクション（#media / #ai-brief / #instability）の section 構造を1つの系に。globe・registry・main.js core 非編集。
- 関連: [[app-design-patterns]]・前段=ゾーン①(ui-a, main b7029a4)・メディア帯(mp-a)

## 背景・問題（本番 sw v39 を実機精査）
ページ＝globe(全幅ヒーロー) → #media → #ai-brief → #instability(他セッション新設) だが下部が不統一:
- **幅バラバラ**：media=全幅(max-width なし)／#ai-brief=1100px中央／#instability=980px中央 → ページが分断、1本の柱に見えない。
- **セクション見出し不揃い**：#media=見出し無し（media-bar→いきなり2ペイン）／#ai-brief=.brief-head「🧭ワールド・ブリーフィング」／#instability=.ins-head「⚠国家不安定性インデックス」。
- **リッチな章区切り無し**：globe→media→brief→instability の境界が空白のみ。

方針: 縦スクロールを「世界コンソール(globe)→ライブメディア→AIブリーフィング→不安定性」の一貫した章立て文書に。established な「線/光・オーロラ・グラス・揃える描画言語」で。globe は全幅ヒーロー維持。

## スコープ（変更点）
1. **統一セクションヘッダー**：#media に見出し新設（「📡 ライブメディア」＋note）＋ CSS で `.brief-head`/`.ins-head`/新 `.media-head` を**同一の rich treatment**（Saira タイトル拡大＋glow＋**オーロラ下線**）に。※他セッション所有の #ai-brief/#instability の**markup は触らず CSS で既存クラスを統一**。
2. **幅・リズム統一**：`--content-w`（共通幅・初期 1200px）を #media/#ai-brief/#instability に適用し中央寄せ＝1本の柱。globe は全幅維持。
3. **リッチなセクション区切り**：各章頭にオーロラ地平線ライン（gradient＋glow・::before）。
4. **メディアのボタン/タブ統一**（ゾーン②内包）：news-tab/area-tab/mode-btn/cam-one-tab/cc-toggle を本編パネルと同じ「グラス＋ネオン縁」言語に。
5. **スクロール演出**：各セクション初回スクロールで fade＋rise（新 `js/ui/scroll-reveal.js`・IntersectionObserver・1回・**`body.reveal-ready` ガードで JS 失敗時も非表示にしない安全策**・reduced-motion 静止）。

非対象: globe、registry、main.js core、データ収集、#ai-brief/#instability の機能・markup（CSS統一のみ）。

## 実装/比較方式
- `js/lib/immerse.js`: `immerseSec(?sec=on|off, 既定on)` を純粋関数で追加、`immerseClasses` が `sec-*` を常時付与（mp/ui/font と同型・**main.js は immerseClasses 適用済で非編集**）。
- `index.html`: #media に section header markup を追加＋ `<script type="module" src="js/ui/scroll-reveal.js">`（mobile-nav.js 等と同じ独立モジュール＝main.js 非編集）。
- `css/orbis.css`: `body.sec-on …` に section 構造（幅/見出し/区切り/メディアボタン/reveal）を追記。base 不変＝`?sec=off`(before)。
- `js/ui/scroll-reveal.js`: 新規。`body.reveal-ready` 付与→observe #media/#ai-brief/#instability→初回 intersect で `.revealed`。失敗時は reveal-ready 無し＝常時表示（安全）。
- 比較: localhost で before(`?sec=off`)/after(既定) を Playwright スクショ＋オーナー実機。

## テスト/配信
- node:test: `immerseSec`/`immerseClasses(sec-*)`。既存 node/e2e 緑維持。
- SW: ネット優先(v39)ゆえ css/immerse/js は版上げ不要。**index.html(SHELL) は変更**するが network-first で反映（統合前に実確認）。
- reduced-motion 尊重。reveal は JS 失敗時フォールバックで content 消失させない。

## リスク/配慮
- 共有 css/immerse.js/index.html を触る。**並行で #instability(instability セッション)・design-loading 稼働中** → index.html/css は競合し得る（統合時に小さく寄せる・#ai-brief/#instability markup は非編集で競合面を最小化）。
- additive（base 不変・`?sec=off` で即 before）。幅は ?param 候補で実物調整。
