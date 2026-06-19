# ORBIS デスクトップ没入感 実装計画

> **For agentic workers:** 本計画は executing-plans 相当でタスク順に実装。純粋関数は TDD、視覚は localhost(8766 no-cache)＋スクショで確認。

**Goal:** 実物比較で確定した没入ダイヤル（globe zoom 2.7 / 大気 glow=2 / 境界 seam=a / media deep / 星雲なし）を本番デフォルト化し、見限った星雲コードを撤去する。

**Architecture:** `immerse.js` の各既定値を確定値に変更（URL パラメータでの上書きは維持）。star nebula 関連コード（CSS neb-*, main.js の alpha 上書き/クラス付与, immerse の星雲ヘルパ, look.js の nebula.a/b）を撤去。`--neb-base` は #starfield の深宇宙 vignette に使うため残す。比較足場（?compare ツールバー・URL パラメータ・localhost SW 無効化）は残す。

**Tech Stack:** Vanilla JS(ESM), MapLibre v5, deck.gl 9.3.4, node:test, Playwright.

## Global Constraints
- 純粋関数は TDD（node:test）。`main.js`/`css` 変更につき `sw.js` の CACHE 版を上げる（v32 → **v33**）。
- URL パラメータ（?gz/glow/seam/mbg/glass/compare）と localhost/compare の SW 無効化は撤去しない。
- 既存挙動の回帰なし（node:test 全緑・Playwright 全緑）。

---

### Task 1: immerse.js の既定値を確定値に＋星雲ヘルパ撤去

**Files:** Modify `js/lib/immerse.js` / Test `tests/immerse.test.js`

**Interfaces:**
- Produces: `DEFAULT_ZOOM=2.7`、`immerseGlow()` 既定 2、`immerseSeam()` 既定 'a'、`immerseMediaBg()` 既定 'deep'。`scaleRgbaAlpha`/`glowNebulaFactor` は削除。

- [ ] Step 1: test 更新（RED）— 既定値を確定値に変更。`immerseZoom('')===2.7` / `immerseGlow('')===2` / `immerseSeam('')==='a'` / `immerseMediaBg('')==='deep'`。`scaleRgbaAlpha`/`glowNebulaFactor` の test を削除。`immerseClasses('')` は既定 seam-a・mbg-deep を含む形に更新（`['seam-a','mbg-deep']`）。URL 上書き（?gz=55 等）の test は維持。
- [ ] Step 2: `node --test tests/immerse.test.js` で RED 確認。
- [ ] Step 3: 実装 — `DEFAULT_ZOOM=2.7`、各 immerse* の既定を確定値に。`scaleRgbaAlpha`/`glowNebulaFactor`/`NEB_FACTOR` を削除。`immerseClasses` は seam（既定a）と mbg（既定deep）と glass(!=on) を返す。
- [ ] Step 4: `node --test tests/immerse.test.js` で GREEN。
- [ ] Step 5: 純関数のみなのでこの時点で `node --test tests/*.test.js` 全緑も確認。

### Task 2: map.js の既定 zoom/atmosphere を確定値に

**Files:** Modify `js/map.js`

**Interfaces:** Consumes: なし（既定値のハードコード）。Produces: `initMap` 既定 zoom=2.7、`applyAtmosphere` 既定 blendStops=glow2相当 `[0,0.85,6,0.45,9,0]`（現状の既定と同じ＝確認のみ）。

- [ ] Step 1: `initMap(...zoom = 2.7...)` に変更（現 1.2）。`applyAtmosphere` の既定 blendStops は既に `[0,0.85,6,0.45,9,0]`（glow2相当）なので確認のみ。
- [ ] Step 2: 視覚は Task 6 でまとめて確認（ここでは編集のみ）。

### Task 3: main.js の星雲撤去＋import 整理

**Files:** Modify `js/main.js`

- [ ] Step 1: import から `glowNebulaFactor, scaleRgbaAlpha` を削除（`immerseZoom, immerseClasses, immerseGlow, atmosphereStops, isCompareMode` は維持）。
- [ ] Step 2: boot 内の星雲 alpha 上書きブロック（`if (glow > 1) { ...setProperty('--neb-a'/'--neb-b') }`）を削除。`const glow = immerseGlow();` は atmosphereStops(glow) に使うので維持。
- [ ] Step 3: neb クラス付与ブロック（`?neb=ring|wide|corners` 分岐）を削除（星雲なしで確定）。
- [ ] Step 4: `node --test tests/*.test.js` 全緑（main.js はユニット外だが import エラーが無いことを確認）。

### Task 4: css の星雲撤去

**Files:** Modify `css/orbis.css`

- [ ] Step 1: `#starfield.neb-corners` / `#starfield.neb-ring` / `#starfield.neb-wide` の3ブロックを削除。
- [ ] Step 2: `#starfield` のベース背景 `radial-gradient(ellipse at 50% 42%, #0a1220 0%, var(--neb-base) 82%)` は残す（深宇宙 vignette）。`:root` の `--neb-a`/`--neb-b` 変数定義は使われなくなるので削除、`--neb-base` は残す。
- [ ] Step 3: 視覚は Task 6 で確認。

### Task 5: look.js の nebula.a/b 撤去

**Files:** Modify `js/lib/look.js` / Test `tests/look.test.js`

- [ ] Step 1: test 更新（RED）— `getLook` の検証から `nebula.a`/`nebula.b` を外し、`nebula.base`（vignette 用）のみ必須に。
- [ ] Step 2: 実装 — `LOOKS` 各プリセットの `nebula` を `{ base }` のみに。`applyLookCss` から `--neb-a`/`--neb-b` の setProperty を削除（`--neb-base` と glass は維持）。
- [ ] Step 3: `node --test tests/look.test.js` GREEN、`node --test tests/*.test.js` 全緑。

### Task 6: sw 版上げ・e2e・最終視覚確認

**Files:** Modify `sw.js` / `tests/e2e/smoke.spec.js`(該当あれば) / 視覚確認

- [ ] Step 1: `sw.js` の CACHE を `orbis-v32` → `orbis-v33`。
- [ ] Step 2: e2e に没入の確定値アサートを追加/確認 — 既定で `map.getZoom()` が概ね 2.7 付近（>2）、`#starfield.className` が空（星雲なし）、body に `seam-a`/`mbg-deep`。
- [ ] Step 3: `node --test tests/*.test.js` 全緑・`npx playwright test` 全緑。
- [ ] Step 4: localhost:8766（no-cache）の素の URL（パラメータ無し）で視覚確認 — globe 大・大気ハロ・seam-a・mbg-deep・星雲なし・四角なし・コンソールエラー0。スクショ目視。

---

## Self-Review
- **Spec coverage:** 確定値の本番化(Task1,2)・星雲撤去(Task3,4,5)・足場残す(全Taskで撤去せず)・sw版(Task6)・e2e(Task6)・テスト緑(各Task) — 全てカバー。
- **Placeholder:** なし（各 Task に具体的な編集対象）。
- **Type consistency:** immerse の関数名（immerseZoom/Glow/Seam/MediaBg/Classes/atmosphereStops/isCompareMode）一貫。撤去する scaleRgbaAlpha/glowNebulaFactor は main.js の import からも除去（Task3）で整合。
