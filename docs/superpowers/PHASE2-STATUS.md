# Phase2 国ドリルダウン本格版 — 実装ステータス（2026-06-24）

> 作業ブランチ `worktree-phase2-drilldown` の再開ポインタ。**code-complete・全テスト緑・最終レビュー READY_TO_MERGE**。残＝NEデータ生成＋実機サニティ→統合(merge+push+Vercelデプロイ)。
> 詳細設計＝`docs/superpowers/specs/2026-06-24-orbis-phase2-country-drilldown-design.md` / 実装計画＝`docs/superpowers/plans/2026-06-24-orbis-phase2-country-drilldown.md`。

## 確定スコープ（brainstorming 確定）
都市別精密版／admin1グループ＋最寄り都市名／分割サイドパネル（非重畳・blur-bleed回避）／可能な限り全日本語（NE name_ja→Wikidata→GeoNames→英名）／client計算＋build時静的準備（collector/orbis-data無改修）／country_bounds も 50m 化／data は main repo コミット／モバイルは独立 bottom-sheet。

## 実装済（7クラスタ・subagent-driven・各レビュー＋fix済）
- C1 `js/lib/drilldown/geo_poly.js`（even-odd PIP・geo_country.py 同一移植）
- C2 `js/lib/drilldown/nearest.js`・`js/lib/zoom_for_bbox.js`
- C3 `scripts/lib/ne_prep.py`(+`fips_of_iso.py`)・`scripts/build_country_bounds.py`/`build_admin1.py`/`build_cities.py`/`build_drilldown_manifest.py`（**コードのみ・data-gen は deferred**）
- C4 `js/lib/drilldown/aggregate_admin1.js`（admin1集計・その他バケット・MAX_POINTS）
- C5 `js/lib/drilldown/drilldown_view.js`・`watchlist.js`
- C6 `js/lib/drilldown/country_index.js`・`country_data.js`・`js/ui/country_click.js`（DI seam）
- C7 `js/ui/drilldown.js`＋配線（`js/main.js`/`index.html`/`css/orbis.css`/`sw.js` v45）
- テスト：node 556 pass / pytest 24 pass（smoke `tests/drilldown_open_smoke.test.js` 含む）。
- 最終 whole-branch レビュー(opus)＝READY_TO_MERGE（3 Critical 配線欠陥を修正済：main.js deps 全注入／#drilldown hidden 解除／bboxIndex 正準形 {country,extra}）。

## 残ゲート（次セッション）
1. **NEデータ生成（deferred）**：`scripts/.cache/ne/` に NE生データ（`ne_50m_admin_0_countries` / `ne_10m_admin_1_states_provinces` / `ne_10m_populated_places` の GeoJSON）を配置 →
   `uv run python scripts/build_country_bounds.py`（country_bounds 50m 再生成）→ `python scripts/gen_country_centroids.py`（再実行）→ `build_admin1.py`→`build_cities.py`→`build_drilldown_manifest.py`。
   生成物：`data/static/country_bounds.geojson`(50m上書き)・`admin1/<FIPS>.geojson.gz`・`cities/<FIPS>.json`・`admin1_bbox.json`・`drilldown_manifest.json`。代表国(US/JP/UA)でサイズ・name:ja カバレッジ実測。FIPS_JA 過不足 assert 緑。
2. **non-blocking follow-up**：`build_admin1.py` が `extra` を `admin1_bbox.json` に未マージ（manifest のみ）→ EXTRA68 小国が fipsCenter±2° fallback。`countryBbox` が `manifest.extra` も参照するか build_admin1 が extra マージ、で手当て。
3. **実機サニティ（太田さん）**：国クリック→drill-open スライドイン／PC横grid非重畳／モバイル下半分bottom-sheet／blur-bleed不在／deck pick排他／既存popup-flyTo不破壊／flyTo寄り具合(zoomForBbox)／DecompressionStream gunzip／SW v45／watchlist永続。
4. **記録済み Minor**（`.superpowers/sdd/progress.md` の各クラスタ行・最終triage済）：merge前必須はゼロ。Phase2内推奨＝zoomForBbox 数値回帰テスト追加等。

## 統合手順（NEデータ＋実機OK後）
main ツリーで `git fetch && git merge worktree-phase2-drilldown`（origin/main 前進中＝共有 main.js/orbis.css のコンフリクト解消要）→ テスト緑 → `git push`（Vercel 本番デプロイ契機）→ 実機で実コンテンツ反映確認 → Obsidian `Projects/orbis-feature-roadmap.md` と MEMORY.md を昇格更新（Phase2✅本番）。
