# ORBIS 本編UI リッチ化 ゾーン①（パネル/フィード・タイポ/ボタン）デザイン監修

- date: 2026-06-20
- status: 承認済み（A既定＋B比較＋display フォント?param）／visual-polish 軽量フロー
- scope: 本編画面の左レイヤーパネル・右フィード＋共有のタイポ/ボタン言語。globe・registry・main.js core 非編集。
- 関連: [[app-design-patterns]] [[user-design-pref]]・前段=メディア帯仕上げ(mp-a, main 5646aae)

## 背景・問題
globe（主役・縁の大気ハロ＝線/光）に対し本編パネルの作り込みが弱い:
- フォントが px 直書きでバラバラ（型スケール無し）。パネル見出し `h4` 11px・uppercase・**muted**で弱い。
- フィード行＝`border-bottom`＋bg hover のみ（カテゴリ色/浮き/glow/stagger 無し）。ブリーフィングの「左色アクセント＋glow」カードが良い言語 → フィードに展開。
- ボタン不統一（collapse-btn=地味な線、chip/tab=発光ピル）。
- 土台は良い（.side-panel グラス＋上端オーロラ線 ::before）。これを活かして richness を上げる。

方針: established な「線/光・オーロラ・グラス・揃える描画言語」でリッチ化。orbis=宇宙的ゆえ**反射的サイバーパンクHUDは足さない**（cosmic 基調）。リッチさは「塊」でなく密度・精緻さ・光の連動で（chronograph 流）。

## スコープ（変更点・ほぼ純CSS＋immerse小追加＋index.html font link）
1. **型スケール（フォント）**: :root に `--fs-*` 型スケール＋`--font-display/--font-word`。タイトルはグラデ＋トラッキング。任意 display フォント（Orbitron=ワードマーク / Saira=見出し）を `?font` で。
2. **パネル見出し**: h4 muted → 大きめ・明るいグラデ・先頭に発光ドット・上端オーロラ線強化。
3. **フィード行**: カテゴリ色の左アクセント＋ホバー浮き&glow＋新着 stagger fade-in＋タイトル/時刻の階層＋ドット glow 強化。
4. **レイヤー行**: ホバー glow をフィードと統一。
5. **ボタン/チップ/タブ/折りたたみ**: 「グラス＋ネオン縁」1言語に統一（半径・hover glow・active 発光）。

非対象: globe ジオメトリ/密度(P0-1=別セッション)、registry、main.js core、データ収集、メディア/ブリーフィング(別途・mp-a 済)。

## 実装/比較方式（既存 ?param body-class 規約）
- `js/lib/immerse.js`: `immerseUi(?ui=a|b|off, 既定a)` ＋ `immerseFont(?font=on|off, 既定on)` を純粋関数で追加し、`immerseClasses` が `ui-<x>`・`font-<x>` を常時付与（seam/glass/mp と同型・**main.js は immerseClasses 適用済で非編集**）。
- `index.html`: Google Fonts `<link>`（Orbitron＋Saira・1本）を追加（display フォント）。
- `css/orbis.css`: :root 型スケール＋`body.font-on` 適用＋`body.ui-a`(cosmic)/`body.ui-b`(instrument) 追記。共有リッチ部は `body.ui-a, body.ui-b` に、差分(A=柔/オーロラ・B=角ティック/計器密度)は各クラスに。base 不変＝`?ui=off`(before)。
- 比較: localhost で before(`?ui=off`)/A(既定)/B(`?ui=b`)＋`?font=off` を Playwright スクショ＋オーナー実機（GPU依存 glow/font は実機が正確）。

## 基調2案
- **A 大気グラス・リッチ（推奨）**: cosmic・globe ハロ/オーロラ線と同調・揃った描画言語。
- **B 計器/オブザバトリ**: 角ティック・数値計器感・密度高め（nexus 寄り・やや HUD）。

## テスト/配信
- node:test: immerseUi/immerseFont/immerseClasses(ui-*,font-*)。既存 node/e2e 緑維持。
- SW: ネット優先(v37)ゆえ css/immerse は版上げ不要。**index.html(SHELL) は変更する**が network-first で反映（要・統合前に実確認。必要なら版up）。
- prefers-reduced-motion 尊重（stagger/glow 脈動）。font-display: swap で FOUT 緩和。

## リスク/配慮
- 共有 css/immerse.js/index.html を触る。globe-density/instability は別領域だが index.html は競合し得る → 統合時に小さく寄せる（font link は <head> 追記で低競合）。
- additive（base 不変・`?ui=off`/`?font=off` で即 before）。display フォントは却下なら link+font-on 既定を外すだけ。
