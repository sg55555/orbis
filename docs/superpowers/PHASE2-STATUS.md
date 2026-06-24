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

## ✅ NEデータ生成＋多観点検証＋follow-up 完了（2026-06-24・本セッション）
NE生データ（nvkelso ミラー: `ne_50m_admin_0_countries` / `ne_10m_admin_1_states_provinces` / `ne_10m_populated_places`）を `scripts/.cache/ne/`(gitignore) に取得 → 全5スクリプト完走で `data/static/*` を生成。**生成物コミット済**（country_bounds.geojson 50m=1.6MB / admin1/×246=3.7MB(gz) / cities/×246=1.4MB / admin1_bbox.json / drilldown_manifest.json=35KB）。

**検証で発見・修正したデータ品質バグ5件（全てテスト追加で恒久ガード）**:
1. **FI（フィンランド）本土脱落**：`build_country_bounds.py` の「同一FIPSは最初だけ」dedup が、先に来るオーランド諸島(ISO AX→FI)を残し本土をドロップ → **同一FIPSの全featureを MultiPolygon 結合**(`merge_geometries`)に変更。
2. **Norway 欠落**：NE の ISO_A2=-99 既知 quirk で resolve 不能 → `resolve_fips` に **ISO_A2_EH フォールバック**追加（Norway -99→NO 復活・インド洋領土/アシュモアを豪州AS統合）。
3. **admin1 24主要国 欠落**：NE admin1 は小文字 `iso_a2` を使うのに resolve_fips は大文字 `ISO_A2` のみ読み、国名 form 違い(United Republic of Tanzania 等)で name 突合も失敗 → **大小文字両表記対応**で Tanzania/Czechia/Serbia/Côte d'Ivoire/DR Congo 等 admin1 復活（admin1 国 211→236）。
4. **NZ 偽全幅bbox**：`build_admin1.py` の国bbox素朴 min/max union がアンチメリディアン未対応で span356°（flyTo が地球全体にズームアウト）→ `union_country_bbox` 純関数で **w>e 折返し形**に補正（NZ wrapSpan 21.6°）。
5. **AY（南極）域外bbox**：`_ring_bbox_antimeridian` が極冠(全経度-180..180)を跨ぎ誤判定し lon=-359.98 → **wrap_span<180 ガード**で全幅維持。併せて `country_click.js` の中心計算を **`bboxCenter` 純関数**(w>e正規化)に変更（naive (w+e)/2 は跨ぎ国で誤中心）。

**ユーザー決定（AskUser）**: 50m で実ジオメトリが得られた7領土/小国を **FIPS_JA に追加（239→246）**（北マリアナ/ミクロネシア連邦/シントマールテン/サンマルタン/サウスジョージア/サンバルテルミー/キュラソー・名称=NE NAME_JA）。

**検証結果（ultracode workflow 7次元 wf wycpguhry → 全 critical 修正後）**: 246 一貫(admin1/cities/centroids/manifest/FIPS_JA 完全一致)・name:ja カバレッジ admin1 99.85%/cities 100%(空0)・bbox 域外0/偽全幅0・PIP(py geo_country↔js geo_poly)一致・**pytest 134 / node 560 全緑**・city-in-country 95.2%。

### 残（非ブロッカー・既知・文書化）
- **海岸線 ~5% drop**（Auckland/Miami 等の沿岸/島嶼/国境都市）＝NE 50m データ固有。eps 調整は無効と実測確定（eps=0.01 と eps=0 で +10都市差・file は 1.6→2.1MB）＝eps=0.01 維持が最適。
- RS/FJ の bbox 東端が e=180 でクリップ（末端tipのみ・実害ほぼ無）。
- 272 個のゼロ面積スライバー（simplify 由来の退化リング・GeoJSON 妥当・PIP/描画に無影響）。
- `manifest.extra`（全246centroid）は client 未参照の死にデータ（countryBbox は admin1_bbox.country→fipsCenter で全246カバー済）。将来 cleanup 可。
- ポリゴン無し10領土(BV/CK/FG/GP/GZ/KT/MB/RE/SV/TL)は fipsCenter±2° fallback（tiny で妥当）。

## 残ゲート（次セッション）
1. **実機サニティ（太田さん）**：国クリック→drill-open スライドイン／PC横grid非重畳／モバイル下半分bottom-sheet／blur-bleed不在／deck pick排他／既存popup-flyTo不破壊／flyTo寄り具合(zoomForBbox/bboxCenter)／DecompressionStream gunzip／SW v45／watchlist永続。**特に NZ/南極等の跨ぎ国クリックで flyTo が当該国に寄るか**を確認。
2. **記録済み Minor**（`.superpowers/sdd/progress.md`）：merge前必須はゼロ。

## 統合手順（実機OK後）
main ツリーで `git fetch && git merge worktree-phase2-drilldown`（origin/main 前進中＝共有 main.js/orbis.css のコンフリクト解消要）→ テスト緑 → `git push`（Vercel 本番デプロイ契機）→ 実機で実コンテンツ反映確認 → Obsidian `Projects/orbis-feature-roadmap.md` と MEMORY.md を昇格更新（Phase2✅本番）。
