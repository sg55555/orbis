# ORBIS メディア＋ブリーフィング帯 視覚仕上げ（デザイン監修）

- date: 2026-06-20
- status: 承認済み（基調 A 既定＋B を ?param 比較）／visual-polish 軽量フロー（nv/cfx/look 同様）
- scope: 下半分（#media ＋ #ai-brief）のみ。globe 非編集。

## 背景・問題（本番 sw v37 を desktop/mobile 実機レビュー）
globe（主役・縁の大気ハロ＝線/光）に対し、下半分が視覚言語を断絶している:
- プレーヤー/カメラセルが純黒ドロップシャドウ（`.media-player box-shadow:0 8px 40px rgba(0,0,0,.5)` / `.cam-cell border:--line(暗紺)`）＝「黒い穴」。globe ハロの「縁に光が乗ったガラス」言語と噛み合わず沈む。
- 投資済みの nv tint（青/紫・`body.mbg-deep #media` の radial）がプレーヤーの黒に隠れ余白にしか出ない。
- 見出し（📺/📷/🧭・pane-title 15px / brief-h 18px・プレーン）が小さく存在感不足。
- 左ニュース（大1枚）/右カメラ（グリッド）の非対称。
- ブリーフィングのカード（glass＋カテゴリ色左ボーダー＋severity glow）は既に良い → この言語をメディアに展開し3ゾーンを揃える。

方針: orbis＝宇宙的世界観。**反射的サイバーパンクHUDは足さない**（確定済 [[app-design-patterns]]）。globe ハロ/グラスの「線・光」言語に下半分を揃え、nv tint を**縁で**活かす。

## スコープ（変更5点・ほぼ純CSS）
1. プレーヤー/カメラセル＝発光ガラス化: 純黒影 → 外側オーロラグロー＋明るめ rim＋上端 inset ハイライト。
2. nv tint を縁で活かす: フレームのグロー色に neb-a(青)/neb-b(紫)。
3. 見出し強化＋ネオン区切り線: pane-title/brief-h を一回り大きく＋シアンアクセント＋下線グロー。3ゾーン共通の見出し言語。
4. 左右ペアの統一: 同じ発光フレームで「揃った対」に（左が黒くても縁の光で空虚に見えない）。
5. 継ぎ目（軽め・任意）: seam-a 基調維持で globe→media を地続きに。

非対象: globe ジオメトリ/密度（P0-1＝別 worktree globe-density 担当）、registry、main.js core、データ収集。

## 実装/比較方式（既存 ?param body-class 規約に乗せる）
- `js/lib/immerse.js` に純粋関数 `immerseMediaPolish(search)`（`?mp=off|b|a` → 既定 'a'）を追加し、`immerseClasses()` が常時 `mp-<x>` を push（`seam-a` と同型）。**main.js は immerseClasses() を既に body へ適用済み＝main.js 非編集**。
- `css/orbis.css` に `body.mp-a …`（A）/`body.mp-b …`（B）を追記。base CSS は不変＝現状が `?mp=off`（before）。
  - 既定 = `mp-a`（A: 大気グロー）。`?mp=off` = base（現状）。`?mp=b` = B（ネオン強め）。
- 比較: `python -m http.server` で before(`?mp=off`)/A(既定)/B(`?mp=b`) を Playwright スクショ＋オーナー実機（GPU依存 blur/glow は実機確認）。

## 基調2案
- **A 大気グロー（推奨）**: 柔らかいオーロラ光（cyan→purple, neb-a/b 同調）。cosmic・globe ハロ同調・控えめに上質。
- **B ネオン強め**: 定義のはっきりした強い縁＋常時発光の脈動（reduced-motion で静止・0 に戻さず底上げ）。nexus 寄り。

## テスト/配信
- node:test: `immerseMediaPolish` の純粋関数テスト＋`immerseClasses` に `mp-*` を含む assert。既存 node/e2e 緑維持。
- SW: v36+ でネット優先化済み → css/immerse の更新は版上げ不要の見込み（**統合前に sw.js の precache/網羅を実確認**。index.html/main.js に及べば版 up）。
- prefers-reduced-motion 尊重（B の脈動を静止）。

## リスク/配慮
- 共有 `css/orbis.css`・`js/lib/immerse.js` を触るが、globe-density はコード未 push（コードドリフト 0＝低衝突）。統合時 origin 最新へ merge。
- 変更は additive（base 不変）＝退行リスク小。`?mp=off` で即 before に戻せる。
