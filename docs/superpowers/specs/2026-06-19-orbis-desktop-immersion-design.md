# ORBIS デスクトップ没入感 — 設計（2026-06-19）

## 背景・課題
デスクトップ（特に大画面）で:
1. globe が画面高の約40%しかなく、上下に広大な黒余白に「沈む」（主役感の欠如）。
2. globe（100vh）と下部メディアの間に巨大な黒帯（死区）があり、スクロールがぶつ切り。

前セッションのモバイルUX是正（ボトムシート）に続く UI/UX 改善。

## 方針（ユーザー合意）
- **宇宙的世界観の深化**。既存（Deep Navy + Aurora + 浮かぶ地球 + 大気グロー）の正統な延長。
- **サイバーパンク（ネオン HUD・スキャンライン・グリッチ）は入れない**。趣向の1つに過ぎず、orbis の宇宙的世界観に必ずしも合わない（ユーザー明言）。
- 度合いは `?look=A|B|C` と同じく **localhost で実物バリアント比較**して確定（確定済み）。

## 確定したダイヤル（実物比較で決定）
| ダイヤル | 確定値 | 内容 |
|---|---|---|
| globe 初期ズーム | **zoom 2.7（画面高 ~85%）** | 地球を画面の主役に拡大。ユーザーが自分でズームアウト可能なので初期は大きくてよい。 |
| 大気ハロ | **glow=2** | globe の縁の大気発光を主アクセント。`atmosphere-blend` を強さ＋減衰範囲ごと設定（高ズームでも消えない）。 |
| 境界 seam | **a（大気溶け込み）** | globe 下端の大気/グラデが media のダーク背景へフェード。死区を埋める。 |
| media 背景 | **deep（深宇宙グラデ）** | media を globe と地続きの深宇宙トーンに。 |
| 星雲（面） | **なし（廃止）** | アクセントは大気ハロに一本化。下記理由により面の星雲は使わない。 |

## 重要な学び（mistakes.md にも残す）
1. **星雲（面）は globe 拡大時に panel(`backdrop-filter: blur`) と干渉して「四角いゾーン」に見える**。星雲を panel/feed の背後に置くと blur 境界で矩形に切れる。配置調整でも解消しきれず、**宇宙的アクセントは「面」でなく「線・光」（大気ハロ）が安全**。→ 星雲廃止。
2. **headless Chromium（SwiftShader）と実機 GPU で `backdrop-filter: blur` の描画が大きく乖離**する。視覚デバッグを headless スクショだけで判断すると四角さを過小評価する。**実機（ユーザーのスクショ）での確認が必須**。
3. **ローカル PWA は SW（cache-first）＋ HTTP キャッシュで変更が反映されにくい**。CSS/JS を変えても古いシェルが配信され、headless（SW無し）と実機（SW有り）で乖離する。→ **localhost では SW を無効化**＋検証は **no-cache サーバ** or シークレットウィンドウ。

## 実装（本番化＋整理）
- **確定値を本番デフォルト化**: `immerse.js` の既定（DEFAULT_ZOOM=2.7 相当, glow=2, seam=a, mbg=deep）。`?gz/glow/seam/mbg/glass` は将来微調整用に残す（look.js と同じ思想）。
- **星雲コードの撤去**: CSS `#starfield.neb-ring|wide|corners`、`main.js` の星雲 alpha 上書き、`look.js` の `nebula.a/b`、`immerse.js` の `scaleRgbaAlpha`/`glowNebulaFactor`。`--neb-base`（深宇宙 vignette のベース色）は #starfield 背景に使うため残す。`?neb=` 分岐は撤去。
- **比較足場の扱い**: `?compare=1` ツールバー（`immerse-bar.js`）と localhost/compare の SW 無効化は**残す**（本番では出ない・開発に有用）。
- **SW**: `main.js`/`css` を変更するので CACHE 版を上げる（現 v32 → 確定実装で次版）。
- **e2e**: 確定没入（globe zoom が上がっている／seam-a の境界フェード DOM／mbg-deep／#starfield に星雲クラスが無い）を検証。
- **テスト**: 純粋関数（immerse.js）の TDD 維持、node:test 緑、Playwright 緑。

## 触るファイル
`js/lib/immerse.js`（既定値・星雲ヘルパ撤去）/ `js/main.js`（星雲撤去・既定適用）/ `js/map.js`（既定 zoom/atmosphere）/ `css/orbis.css`（neb-* 撤去・seam/mbg/glass は本番既定として整理）/ `js/lib/look.js`（nebula 撤去）/ `sw.js`（CACHE 版）/ `js/ui/immerse-bar.js`（残置）/ `tests/*`。

## スコープ外
- モバイルのボトムシート（前セッション完了・不変）。
- 実機 Safari の WebGL globe P0（A1・別領域）。
- 新規データレイヤー。
