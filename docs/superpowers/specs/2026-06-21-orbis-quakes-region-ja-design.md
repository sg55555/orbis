# 地震レイヤー 地名表示の日本語化（地域・国名）設計

**日付:** 2026-06-21
**対象:** orbis / `js/layers/quakes.js`（→ 純粋部を `js/lib/quake_place.js` に分離）
**位置づけ:** P1-1（FIPS 補完で紛争/抗議の国名を日本語化）の地震版。実機で紛争/抗議の日本語化を確認した太田さんが「地震も同様に直したい」と要望。

## ゴール

地震ツールチップ／フィードの震源表示に残る **英語の「地域・国名」を日本語化**する。紛争/抗議が「国・地域名は日本語」になったのと同水準に揃える。**都市・ランドマークの固有名詞（Cobb 等）は英語のまま**（地球規模で無数にあり静的マップ不可・無名町名の片仮名化は価値が薄い＝今回スコープ外＝LLM 翻訳の方針②は不採用）。

## 現状（実測 2026-06-21 スナップショット 206 件）

既存 `quakePlaceJa()` は `"10 km WNW of Cobb, CA"` → `"Cobb の西北西 10km（カリフォルニア州）"` に整形済み。だが英語が残るのは2系統：

1. **地域・国名の取りこぼし**：`REGION_JA` は約20件のみ。実データで英語のまま漏れたもの＝ `Colorado` / `U.S. Virgin Islands` / `Puerto Rico` / `El Salvador` / `Saint Helena` / `Dominican Republic` / `Argentina` / `MX`(メキシコ略号) / `Japan region` 等。
2. **カンマ無し形式がパーサ未対応**：`South Sandwich Islands region` / `west of Macquarie Island` 等は `^(.*),\s*([^,]+)$` に当たらず丸ごと英語素通し。

（都市固有名詞は本日だけでユニーク105件＝スコープ外で英語維持）

## 方針（採用＝①地域・国名のみ・決定論）

### アーキテクチャ
- 純粋部（地名マップ＋整形関数）を **`js/lib/quake_place.js`** に分離（`places.js` が FIPS_JA を持つのと同じ構成）。
- `js/layers/quakes.js` は `quakePlaceJa` を import して使い、後方互換のため **re-export**（既存 import 経路 `../js/layers/quakes.js` を壊さない）。
- 関数シグネチャ不変・出力がより日本語になるだけ＝消費側（tooltip/feed/selection）は無改修。
- スナップショット schema 不変・コレクタ無改修・API 不使用。SW は network-first のため版上げ不要。

### `REGION_JA` 網羅拡張（約200件）
- **米国 全50州**（フルネーム＋2文字略号。USGS は California のみ "CA" 略号・他は州名フル、両方収載で保険）。
- **準州・特別区**：Puerto Rico / U.S. Virgin Islands / Guam / American Samoa / Northern Mariana Islands / D.C.。
- **主要国**（USGS が出す英語国名 ≈120）：中南米・カリブ・欧州・中東・南アジア・東南アジア・東アジア・旧ソ連・アフリカ・オセアニア。
- **略号**：MX→メキシコ。
- **特殊地域**（海・島嶼・海嶺）：Saint Helena / South Sandwich Islands / Macquarie Island / Kuril Islands / Aleutian Islands / Banda Sea / Sea of Okhotsk / Mid-Atlantic Ridge 等の代表的震源域。
- 既知の曖昧性：`Georgia` は USGS では米州が大多数のため「ジョージア州」を採用（国ジョージアは極稀・許容）。

### パーサ拡張（USGS の他形式）
`quakePlaceJa(place)` の分岐を拡張（カンマ有り形式は現状維持）。カンマ無しを追加対応：
- `"{X} region"` → `"{X_JA} 付近"`（例 "Japan region"→"日本 付近"）
- `"off the coast of {X}"` → `"{X_JA} 沖"`
- `"near the coast of {X}"` → `"{X_JA} 沿岸"`
- `"{word-dir} of {X}"`（north/south/east/west/...）→ `"{X_JA} の{方角}"`（例 "west of Macquarie Island"→"マッコーリー島 の西"）
- `"{N} km {DIR} of {X}"`（カンマ無し）→ `"{X_JA} の{方角} {N}km"`
- 上記いずれにも当たらない単独語 → `regionJa()` で訳す（既知なら日本語・未知なら英語フォールバック）

整形の house style：英語トークンと日本語方角語の間は半角空白（既存 "The Geysers の西 3km" に合わせる）。

### 残る英語（既知・許容）
- 都市/ランドマークの固有名詞（Cobb 等）。
- ガゼッティア未収載の長尾の海嶺・小島（極稀）。→ 英語フォールバックで素通し（silent 切り捨てではなく既知の仕様）。

## テスト（TDD・`tests/quakes.test.js` 拡張）
1. 既存回帰：CA / Alaska / Nevada単独 / 空文字 / "Island of Foo, Nowhere"（未知地域は括弧付き英語）。
2. 州拡張：Colorado / 2文字略号（例 "..., NV"）。
3. 準州：Puerto Rico / U.S. Virgin Islands。
4. 国拡張：El Salvador / Dominican Republic / Argentina / Saint Helena。
5. 略号：MX（region 位置で "X km N of Y, MX"→…（メキシコ））。
6. カンマ無し：Japan region→"日本 付近" / South Sandwich Islands region→"サウスサンドウィッチ諸島 付近" / off the coast of Oregon→"オレゴン州 沖" / west of Macquarie Island→"マッコーリー島 の西"。

完了基準：単体 緑（既存＋追加）。実スナップショットを再走査し、地域・国名の英語残渣 0 を確認（都市固有名詞を除く）。

## 統合・デプロイ
- 専用 worktree `quakes-region-ja`（origin/main 18b6947 基準）。
- CLAUDE.md「origin/main 基準」厳守で `HEAD:main` ff push（ローカル main の ai-forecasts 未push 温存）。
- orbis は git push 単独では即デプロイされず、cron 周期（~15-20分）のデプロイが最新 main を本番化＝手動 redeploy 不要（P1-1 で確認済の運用知見）。本番 curl で `quake_place.js` 反映を確認。
