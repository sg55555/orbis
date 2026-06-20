---
date: 2026-06-21
tags: [orbis, ui, fips, data]
project: orbis
related: [[orbis-uiux-improvements]]
---

# Orbis P1-1: 未収載 FIPS コード補完 設計

**Goal:** GDELT 由来の未収載 FIPS 10-4 コードが生のまま（例「紛争 GZ ×3」）表示される問題を、`FIPS_JA` へのデータ追加で解消する。

## 背景・問題
- `conflict.js`/`protests.js` のツールチップ・`selection.js`・`aggregate.js`(`country_ja`) は `js/lib/places.js` の `FIPS_JA`/`fipsToJa` で「日本語名（CODE）」に展開している。
- 未収載コードは `fipsToJa` が生コードにフォールバック（健全な設計）。ただし係争地 `GZ`（ガザ地区）等が生表示されていた。

## 調査（データ駆動 / [[mistakes]] の verify-first 方針）
- 本番スナップショット（conflict + protests）の実出現 **110 コード中、未収載は GZ・JE の2件のみ**。既存マップは GDELT の FIPS をほぼ網羅していた。
- `WE`（ヨルダン川西岸）は既収載のため対象外。

## スコープ（ユーザー承認: C・広め）
`FIPS_JA` に5コードを追加（いずれも FIPS 10-4・既存命名と整合）:
- `GZ` = ガザ地区（実データ出現。`WE`=ヨルダン川西岸 と対）
- `JE` = ジャージー（実データ出現・チャネル諸島）
- `KV` = コソボ（紛争関連・GDELT 頻出・前倒し。FIPS 10-4 で Kosovo は KV）
- `GK` = ガーンジー（JE の属領姉妹・前倒し）
- `IM` = マン島（クラウン属領・前倒し）

## 非対象（YAGNI）
- `fipsToJa`/`rootToJa`/`severityRank` のロジック変更なし。未知コードのフォールバック挙動は維持。
- 全 FIPS 10-4 の網羅追加はしない（実害・頻出のみ補完）。

## 実装・検証
- TDD: `tests/places.test.js` に①`FIPS_JA` 収載②`fipsToJa` 展開（全角括弧 `（）`）の assert を追加 → fail を確認 → `FIPS_JA` にアルファベット順で5エントリ挿入 → pass。
- 回帰: 単体スイート全緑を確認。e2e は据置（データのみ追加・UI ロジック不変）。
- SW 版上げ不要（network-first・shell 不変）。
- 統合: CLAUDE.md「origin/main 基準」厳守で `HEAD:main` を ff push → 本番 curl で `places.js` に新エントリを確認。
