# Phase2 国ドリルダウン subagent-driven 進捗ledger

BASE(branch start)=618d5c5 / plan committed=cb56b64
実装ユニット=クラスタ単位(C1→C2→C3→C4→C5→C6→C7→最終検証)。NEデータ要のdata-genは後回し(option A)。

## 状態
- [x] C1 純幾何コア (geo_poly)
- [x] C2 独立純関数 (nearest/zoom_for_bbox)
- [x] C3 build時データ準備 (ne_prep純粋+pytest緑 / build_*.py コードのみ・data-gen deferred)
- [x] C4 admin1集計コア
- [x] C5 HTMLビルダ+watchlist
- [x] C6 I/O境界
- [x] C7 render+配線+SW
- [x] FINAL whole-branch review ✅READY_TO_MERGE (opus)・統合判断は次

## ログ

- C1: complete (commits 46945ba..8f8bf31, 4 commits, review clean / spec✅ quality Approved / 373 pass). Minor(final-triage): loadPolygons name は `?? null` で簡略可(動作同一).
- C2: complete (commits 48645e6..82e2a4c, 2 commits, review clean / spec✅ quality Approved / 395 pass). Minor(final-triage): (1)zoomForBbox整合テストが a===b 決定論のみで数値回帰未担保→期待値固定テスト追加余地 (2)nearestCity の不正city要素はNaN→null(spec準拠).
- C3: complete (commits e20b983..8833b44 含む fix 8833b44, review clean after fix / spec✅ quality Approved / pytest19 node395). 修正=build_admin1 FIPS過不足assert追加・manifest load_centroids を COUNTRY_CENTROIDS パースに修正。Minor(final-triage): build_*.py 間の load_fips_ja/simplify 重複→io_helpers.py 抽出余地・commit 671c1eb メッセージ不正確・pick_name_ja geonames別キー未テスト。**deferred(NEデータ後)=build_country_bounds/admin1/cities/manifest 実行＋gen_country_centroids 再実行＋data/static生成**.
- C4: complete (commits b809a27, fix cc685ee, review clean after fix / spec✅ quality Approved / patch#1#2 yes / 429 pass). 修正=region.topEvents に regionName 付与(潜在null解消・新規2テスト)。Minor(final-triage): collectCountryEvents の marginDeg 未使用(命名/JSDoc)・summarizeForecast 先頭カードのみ・attachNearestCity テストが nearestCity 閾値に暗黙依存.
- C5: complete (commits 2bf8c40..c8a0b51, review clean / spec✅ quality Approved / patch#1#2 yes / 470 pass). instability.js は既に全export済で無改変。Minor(final-triage): drilldownHeaderHtml の style=--dd-lvl:${col} 未escape(scoreColor出力ゆえ低リスク)・_byLayerHtml が数値を escapeHtml に渡す(String()先行が堅牢).
- C6: complete (commits 5b02bce..a5117d1, fix 71aa817, review clean after fix / spec✅ quality Approved / patch#3-#6 yes / 495 pass). 修正=degraded非キャッシュ(一時障害の恒久degraded化防止・再試行テスト)・未使用import削除。Minor(final-triage): timeoutMs=0 テストのタイミング依存・openCountry の map.resize 反映タイミング(実機)・gunzip(.gz DecompressionStream)経路がテスト未走行(実機確認要).
- C7: complete (commits c4d5fba..b775662, fix 9d5beaf, review clean / spec✅ quality Approved / patch#4#5#7 yes / blur-bleed yes / main-diff-safety yes / 529 pass). 修正=concern2件(map.on二重登録解消・watchlist join joinWatchCountries配線)＋M-1実バグ(renderDrilldown二重発火→onclick=)。Minor(final-triage): M-2 (payload.lon||payload.lat) が lon=0/lat=0 有効座標を disabled・M-3 selected 変数名shadowing(可読性).

## 最終レビュー結果 (opus・2回目=修正後)
- verdict=READY_TO_MERGE。3 Critical 全解消(C1=openCountry の17 deps を main.js が全注入・fetch↔fetchFn解消, C2=#drilldown hidden を open で removeAttribute/close で復帰, C3=bboxIndex 正準形 {country,extra} で consumer/producer 一致)。Important-4(アンチメリディアン単一リング wrap)・Minor(watchlist 圏外国 name_ja=FIPS_JA日本語化・Kosovo XK→KV)done。smoke テスト(drilldown_open_smoke 実openCountry+実render)で C1/C2 盲点を恒久ガード。new-issues none。
- **最終テスト(独立検証): node 556 pass/0 fail(smoke3含む)・pytest 24 pass。**
- 全commit範囲 cb56b64..ba312ab (実装+レビュー修正)。

## 残ゲート(merge ブロッカーでない・別ゲート)
- **[deferred] NEデータ生成**: build_country_bounds/admin1/cities/manifest.py を NE生データ(ne_50m_admin_0 / ne_10m_admin_1 / ne_10m_populated_places)で実行→data/static/* 生成→gen_country_centroids 再実行。未実行ゆえ _bboxIndex/_manifest 空=全国 fipsCenter±2° graceful fallback(クラッシュなし)。
- **[non-blocking follow-up] EXTRA68 extra 未配線**: build_admin1.py が extra を admin1_bbox.json に書かず drilldown_manifest.json のみ→countryBbox が manifest.extra を見ないため EXTRA68 小国は 5.0マージン矩形でなく fipsCenter±2°。data-gen 統合時に countryBbox を manifest.extra も参照 or build_admin1 が extra マージ、で手当て。
- **[実機] 太田さんサニティ**: 国クリック→drill-open スライドイン/PC横grid非重畳/モバイル下半分bottom-sheet/blur-bleed不在/deck pick排他/既存popup-flyTo不破壊/flyTo寄り具合/SW v45/watchlist永続。GPU/CSS/globe は headless 不可。
