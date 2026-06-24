# Phase2 国ドリルダウン本格版（都市別精密版）＋ウォッチリスト — 最終詳細設計

作業ツリー: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`（branch `worktree-phase2-drilldown`・origin/main から fresh）

## 確定事項（2026-06-24 brainstorming でユーザー確定・変更不可）

ロック要件（5件・全て最大詳細を選択）:
1. **スコープ＝都市別精密版**（最大詳細）。
2. **集計粒度＝両方**：admin1（県/州）でグルーピング＋個別イベントに最寄り都市名（例「カリフォルニア州 — ロサンゼルスで抗議」）。
3. **UI＝分割サイドパネル**：国クリックで globe を縮め、PC は横・モバイルは下半分に詳細を並置。**globe に重ねない非重畳**（square-blur-bleed 回避）。
4. **命名＝可能な限り全日本語**：NE `name_ja` → Wikidata（`wikidataid` 経由）→ GeoNames alternateNames(ja) → 英名フォールバックの4段。英名は真の欠落時のみ。
5. **アーキ＝client 側計算＋build 時静的準備**：collector/データパイプライン/orbis-data は**無改修**。

精緻化決定（3件・設計提示後に確定）:
6. **解像度＝country_bounds も 50m 化**（最大精度）。`data/static/country_bounds.geojson` を NE 50m から再生成し、admin1（50m）と**解像度を揃えて nest 整合を上げる**。残余の取りこぼし（NE admin0/admin1 の不完全 nest）は「その他/不明」県バケットで件数可視化（安全網）。**回帰確認必須**＝country_bounds の consumer（`collectors/lib/geo_country.py`・`gen_country_centroids.py`・client FIPS 解決）への影響。`aggregateByCountry` は `p.place` 文字列キー依存で country_bounds geometry 非依存＝不影響。
7. **データ配置＝main repo にコミット**：`data/static/admin1/*` を gzip で main repo にコミットし Vercel 相対配信（設計どおり）。lazy fetch で初回ロード非影響。
8. **モバイル＝独立 bottom-sheet**：mobile-nav.js 無改修（回帰回避）。

## 0. 設計の前提（実コード検証済の事実・憶測排除）

本設計は worktree 内の実ファイルを読んで実証した事実のみに依存する。重要な確定事項:

- **deck onClick の早期 return**: `js/main.js:321-322` の onClick は冒頭で `if (!info || !info.object || !info.layer) return;` する。国クリック（空振り＝info.object 無し）は**この early return より前で拾えない**。→ 国クリックは **別系統 `map.on('click', ...)`**（MapLibre 生イベント）で受ける。deck の onClick とは独立に発火し、deck が pick した時はその map click も発火するため、後述の deck pick 排他フラグで抑制する。
- **`window.__orbis` の実内容**: `js/main.js:366` で `window.__orbis = { map, overlay, counts: {} }`。その後 `window.__orbis.instability`（:500）、`.forecasts`（:521）、`.brief`（:479）、`.selected`（多数）が追加される。**`snapshots` は載らない**（`js/main.js:58` の module-local `const snapshots = {}`）。→ 国詳細が読むイベント点群（quakes/conflict/protests/news の snapshot）は **`getSnapshots()` DI クロージャ**で boot から注入する（`window.__orbis` 経由は不可）。instability/forecasts は `window.__orbis` から読んでよい（実在）。
- **`boundary-country` レイヤー**: `js/style.js:40` で `type:'line'`、openmaptiles `boundary` source-layer、filter は `admin_level==2 && maritime!=1` のみ。**properties に FIPS/ISO/国名は無い**。→ `queryRenderedFeatures({layers:['boundary-country']})` から国コードは引けない。FIPS 解決は **`data/static/country_bounds.geojson` への client ray-casting が一次**。queryRenderedFeatures は使わない（line 層は陸地塗りでないため陸地ゲートにも無意味）。海洋判定は ray-casting の miss（null）で行う。
- **`country_bounds.geojson` の実態**: 171 features、properties=`{code(FIPS), name}` のみ、**bbox 非保持**、28 MultiPolygon、頂点数 median 37 / max 794＝**現状 110m 低解像度**（`gen_country_centroids.py:33` のコメントが明示）。→ **確定事項6 により 50m へ再生成**（admin1 と解像度を揃える）。再生成は同一スキーマ `{code(FIPS), name}` を厳守し**全 FIPS コードを保存**（FIPS_JA 過不足 assert で担保）。50m 化でファイルが増える（現 248KB → 推定 1-2MB、Vercel gzip で ~300-600KB）＝起動時 1 回 fetch（client FIPS 解決用）。FIPS 解決自体は 110m で十分だが、admin1 との nest 整合のため 50m に統一。`collectors/lib/geo_country.py` はデータのみ変更でコード不変（点内判定がより精密になるだけ）＝回帰確認対象。
- **`aggregateByCountry`（`js/lib/aggregate.js:6`）は `p.place` 文字列キーで Map グループ化**＝point-in-polygon ではない。admin1 集計は**新規実装**（イディオムは流用するが直接再利用ではない）。
- **`escapeHtml` は `js/lib/selection.js:18` で export 済**。instability.js の `esc`（:39）は private（流用不可）。→ 新規 HTML ビルダは selection.js の escapeHtml を import する。
- **`#map` CSS**: `css/orbis.css:23` で `#map { position: absolute; inset: 0; z-index: 1; }`、親 `#map-wrap { position: relative; height: 100vh; }`（:22）。absolute inset:0 の子は親の flex/grid では縮まない。→ drill-open 時に **`#map` の position を static 化（または relative + grid 配置）して grid セルに収め物理縮小**する必要がある。
- **既存 static layer 契約**（`js/layers/trade.js`）: `{id,label,static:true,fetch(),toDeckLayer(),legend,tooltip}`。`map.on('load')`（`js/main.js:416`）で `staticLayers()` を `try{...}catch{/*noop*/}` で一度 fetch。国ドリルダウンは deck レイヤーでなく **DOM セクション**（instability と同方針）なので registry には載せない。
- **mobile-nav.js**: `sheetPanelId`（:17）は `{layers,feed,legend}` の3種 hardcode、`current()`（:31）も3種のみ検証。国詳細タブを mobile-tabs に足すと **mobile-nav.js の編集が必須**。→ 本設計は mobile-nav.js を触らず、**国パネル専用の独立 bottom-sheet**（body クラス `drill-open` 駆動）で実現し回帰を避ける。
- **`degLenForZoom`（`js/lib/geo.js:62`）**: `mpp = 156543.03/2^zoom`、1度≈111320m。zoomForBbox はこの逆算で実装。
- **SW（`sw.js`）**: shell はネット優先→成功時 cache（SHELL 明示は最小・動的 import の js は自動 cache される）。bypass は `raw.githubusercontent.com` / `/data/snapshots/` / `cartocdn` のみ。`/data/static/*` は**現状ネット優先 cache 対象**（trade/currents も同様に cache 済で運用問題なし＝オンライン最新・オフライン fallback）。
- **テスト基線**: JS `node --test tests/*.test.js` = **352 pass**（実測）。pytest 別系統。
- **NE 生データは repo に無い**・`requirements.txt` に geopandas 無し（requests/Pillow/websocket-client/anthropic のみ）。→ build スクリプトは GeoJSON を標準ライブラリ（json/math）で処理し、NE 生データ＋name:ja 補完辞書は**ローカルで手調達しコミット成果物のみ実行時利用**（CI/実行時ネット非依存・gen_country_centroids と同じ運用）。

## 1. アーキテクチャ全体像

3層に厳密分離する（テスト容易性・モジュール境界＝案3思想）。

- **(A) build時（Python・I/O と純粋を分離）**: NE admin1(50m)＋populated places を国別 split＋name:ja 付与し `data/static/admin1/<FIPS>.geojson(.gz)` / `cities/<FIPS>.json` / `admin1_bbox.json` / `drilldown_manifest.json` を生成。collector/orbis-data/データパイプラインは**完全無改修**。
- **(B) client 純関数（deck/DOM/fetch/map 非依存・node:test の主対象）**: geo_poly（ray-casting）/nearest（最寄り都市）/zoom_for_bbox/aggregate_admin1（admin1集計）/drilldown_view（HTML文字列）/watchlist（純操作）。
- **(C) I/O 境界（DI seam）**: country_data（lazy fetch・timeout・abort・cache・degraded）/country_index（country_bounds 正規化）/watchlist store（localStorage 薄ラッパ）/ui/drilldown（render）/ui/country_click（map.on('click') オーケストレータ）。
- **(D) main.js 配線（最小差分）**: getSnapshots DI クロージャ・deck pick 排他フラグ・body.drill-open トグル。

データフロー: globe クリック → (C) country_click が deck pick 排他判定 → 空振りなら (B) resolveFipsAt で client ray-casting → FIPS 解決 → (C) country_data lazy fetch（manifest 事前判定）→ (B) buildDrilldown（snapshots を getSnapshots DI で取得し admin1 PIP 集計＋最寄り都市）→ (C) ui/drilldown が (B) drilldown_view の純HTML を差し込み render → map.flyTo({center, zoom: zoomForBbox(bbox)}) → 既存 selected/buildReticleConfigs 契約に合流。

## 2. コンポーネント分解（ファイルパス・純/render/IO 分離）

### 新規（build時 Python）
- **`scripts/build_admin1.py`**（I/O）: NE ne_10m_admin_1_states_provinces を読み国別 split＋name:ja 付与＋gzip 書出し。純粋部は `scripts/lib/ne_prep.py` に委譲。出力 `data/static/admin1/<FIPS>.geojson.gz`（properties=`{a1code,name_en,name_ja,bbox}`）。FIPS_JA 全キーとの過不足 assert（gen_country_centroids.py 同型）。
- **`scripts/build_cities.py`**（I/O）: NE ne_10m_populated_places を国別 split＋name:ja 付与＋人口降順 cap（maxN=400）。出力 `data/static/cities/<FIPS>.json`（`[{name,name_ja,lon,lat,pop}]`）。name:ja 解決は ne_prep と共有。
- **`scripts/lib/ne_prep.py`**（純粋・pytest 対象）: `resolve_fips(ne_props, bounds_name_index)->FIPS|None`（ISO_A2/ADM0_A3→FIPS 変換表 FIPS_OF_ISO ＋ country_bounds.geojson の name 突合の**二重チェック**で CH=中国/SF=南アフリカ/AS=豪州の罠を検出）/ `pick_name_ja(props, wikidata_idx, geonames_idx)->str`（NE name_ja → wikidataid 経由 Wikidata labels(ja) → GeoNames alternateNames(ja) → 英名フォールバックの4段）/ `split_by_country(features, key_fn)->{fips:[...]}` / `largest_polygon_bbox(geometry)->[w,s,e,n]`（MultiPolygon は最大面積ポリゴンの bbox＝米/加/フィジー/インドネシアの太平洋跨ぎ回避・`lonSpan>180` は最大ポリゴン限定）/ `simplify_ring(ring, eps)`（Douglas-Peucker 風頂点間引き）/ `nearest_city_cap(places, maxN)`。標準ライブラリ（json/math）のみ依存・geojson は dict で受ける。
- **`scripts/build_drilldown_manifest.py`**（I/O）: `data/static/admin1/` と `cities/` の実在 FIPS＋各サイズ＋EXTRA68（ポリゴン無し）の矩形フォールバック中心/マージンを `data/static/drilldown_manifest.json` に出力。`{fips:{admin1Bytes,citiesBytes,countryBbox}|extra:{lon,lat,margin}}`。country_centroids.js の EXTRA を流用。`data/static/admin1_bbox.json`（国bbox＋各admin1 bbox の集約）も出力。
- **`scripts/build_country_bounds.py`**（I/O・確定事項6）: NE `ne_50m_admin_0_countries` を読み `data/static/country_bounds.geojson` を**50m へ再生成**。現スキーマ `{code(FIPS), name}` を厳守し `resolve_fips`（ne_prep 共有）で ISO→FIPS 写像＋country_bounds 既存 name 突合＋**FIPS_JA 過不足 assert で全コード保存を build 失敗化**。admin1（50m）と同一ソース解像度に揃え nest 整合を最大化。`simplify_ring` で過度に間引かない（隙間増を防ぐ）。再生成後 `gen_country_centroids.py` を再実行し centroid/EXTRA を更新（軽微シフト）。`collectors/lib/geo_country.py` はデータのみ変更でコード不変。**回帰確認**＝既存 JS/pytest 緑＋collectors の FIPS 割当サニティ。

### 新規（client 純関数 — node:test 主対象）
- **`js/lib/drilldown/geo_poly.js`**: `pointInRings(x,y,rings)->bool`（`collectors/lib/geo_country.py:30` の even-odd 判定式 `((yi>y)!=(yj>y)) && (x<(xj-xi)*(y-yi)/(yj-yi)+xi)` を**同一に移植**・全リング横断で穴/MultiPolygon 対応）/ `loadPolygons(geojson,{codeKey})->[{code,name,name_ja,bbox,rings}]`（geo_country.py `load_polygons` 相当・bbox 計算）/ `pointInFeature(lon,lat,poly)->bool`（bbox 早期棄却→pointInRings）/ `locateFeature(lon,lat,polys)->poly|null`（最初にヒット）。Python 版と**共有フィクスチャで回帰一致を保証**。
- **`js/lib/drilldown/nearest.js`**: `sqDistDeg(aLon,aLat,bLon,bLat)->number`（equirectangular cosLat 補正二乗距離・sqrt 不要）/ `nearestCity(lon,lat,cities,{maxDeg=1.5})->city|null`（線形最近傍・0件/閾値超は null＝「都市名なし」）。cities は build cap で数百件＝grid 不要。
- **`js/lib/zoom_for_bbox.js`**: `zoomForBbox(bbox,{minZoom=2.5,maxZoom=6,pad=1.15})->number`（lon/lat span の大きい方から `degLenForZoom`（geo.js）整合の式で zoom 逆算・clamp）。fitBounds は未検証ゆえ当面これを flyTo の zoom に渡す。`?fit=1` フラグ裏で fitBounds は段階導入（既定無効）。
- **`js/lib/drilldown/aggregate_admin1.js`**: `collectCountryEvents(snapshots, fips, countryPolys, {marginDeg})->[{layerId,lon,lat,title,...}]`（全層から当該 FIPS ポリゴン内の点を bbox＋ray-casting で抽出。quakes は **place 文字列に依存せず lon/lat→locateFeature** で自前算出。news は厳密 even-odd で隣国混入を弾く）/ `assignAdmin1(events, admin1Polys)->events付きa1code`（locateFeature・全ミスは `null`＝「その他/不明」バケット＝点を捨てない）/ `aggregateByAdmin1(eventsWithA1)->[{a1code,name_ja,count,byLayer,topEvents,lon,lat}]`（aggregateByCountry の Map グループ・代表点選定イディオム流用・count 降順・同数は name_ja 安定ソート）/ `attachNearestCity(events, cities)` / `buildDrilldown({fips,snapshots,countryPolys,admin1Polys,cities,instabilityCountry,forecastCards},{MAX_POINTS=4000})->{header, regions[], events[], degraded}`（全合成・純粋・header は instabilityCountry をそのまま流用＝新規LLM生成なし・MAX_POINTS 超過時は admin1 割当をスキップし国集計のみのデグレード）。
- **`js/lib/drilldown/drilldown_view.js`**: `drilldownHeaderHtml(header)`（instability の `levelOf/scoreColor/trendArrow/rowHtml` を import 流用＋forecast 注視度）/ `regionRowHtml(region)`（県名＋件数＋内訳 ⚔📢📰🌐＋代表イベント）/ `eventLineHtml(ev)`（「カリフォルニア州 — ロサンゼルスで抗議」形式）/ `degradedNoticeHtml(kind)`（EXTRA68/海洋/欠落/fetch失敗の説明文）。全て `escapeHtml`（selection.js）経由・DOM 非依存の文字列を返す。
- **`js/lib/drilldown/watchlist.js`**: 純操作 `addCode(list,code)/removeCode(list,code)/hasCode(list,code)/orderByInstability(list,countries)`（重複排除・順序保持・上限30・instability join で score 降順）。store seam `makeWatchlistStore({storage,key='orbis.watchlist'})->{load(),save(codes)}`（state.js の readStored/writeStored 同型・破損 JSON→[] フォールバック・storage を DI）。

### 新規（client I/O 境界 — DI seam）
- **`js/lib/drilldown/country_index.js`**: `loadCountryBounds(fetchFn)->polys`（`data/static/country_bounds.geojson` を一度 fetch→loadPolygons・キャッシュ）/ `countryBbox(fips, bboxIndex)->[w,s,e,n]`（admin1_bbox.json 由来・EXTRA68 は manifest.extra の centroid±固定マージン矩形）/ `fipsCenter(fips)->[lon,lat]`（COUNTRIES/COUNTRY_CENTROIDS 流用）。
- **`js/lib/drilldown/country_data.js`**: `loadCountryGeo(fips,{signal,timeoutMs=8000,manifest})->{admin1,cities,degraded}`（manifest で有無/extra 事前判定→相対 fetch（data/static は data-source.js 非対象＝常に相対 Vercel 配信）→AbortController+timeout→失敗/欠落は `degraded:true` で空配列。同一 FIPS の in-flight Promise 共有＋成功 Map キャッシュ）。
- **`js/ui/drilldown.js`**（render）: `renderDrilldown(rootEl, model, {onSelect,onClose,onWatchToggle})`（drilldownHeaderHtml/regionRowHtml/eventLineHtml を差込・region/event 行に onSelect 配線・座標無しは disabled＝instability mkRow 同型）/ `setDrilldownState(rootEl,'loading'|'error'|'ready')` / `renderWatchlist(rootEl, countries, {onSelect,onRemove})`（instability rowHtml 流用）。map/fetch は呼ばずコールバックで外部委譲。
- **`js/ui/country_click.js`**（オーケストレータ）: `initCountryClick({map, getSnapshots, deps})`。内部: `resolveFipsAt(lon,lat,boundsPolys)->fips|null`（country_index の polys に locateFeature・海洋/極域は null）/ `handleMapClick(e)`（後述の deck pick 排他判定→空振り時のみ resolveFipsAt→openCountry）/ `openCountry(fips, anchorLngLat)`（body.drill-open 付与→map.resize→country_data lazy fetch→buildDrilldown→renderDrilldown→map.flyTo({center, zoom:zoomForBbox(bbox)})・selection token でレース破棄）/ `closeCountry()`。map/fetch を deps 注入しテスト時 fake 可能。

### 既存（modify・最小差分）
- **`js/main.js`**（配線のみ）: (1) `map.on('click', ...)` を追加し `initCountryClick({map, getSnapshots:()=>snapshots, deps:{fetch}})` を boot で初期化（**snapshots を DI クロージャで渡す＝module-local の実態に唯一適合**）。(2) deck onClick が object を拾った直後に排他フラグ更新（座標＋時刻）。(3) selected/flyTo は既存契約に合流。drawAll/rebuild/registry は不変。
- **`index.html`**: `#map-wrap` 内（`#feed` の後）に `<aside id="drilldown" class="drill-panel" hidden>`（.dd-head 閉じる/★・.dd-body・.dd-watchlist）を追加。mobile-tabs は触らない。
- **`css/orbis.css`**: 非重畳 split を追加（後述）。
- **`sw.js`**: `CACHE='orbis-v45'`。`/data/static/` の扱いは現状のネット優先 cache のままで可（trade/currents と同様に動作・admin1 は頻繁更新しない build 成果物）。明示性のため bypass 条件に `/data/static/` を加える選択肢は残すが**必須ではない**。

### 新規（テスト）
- `tests/drilldown_geo_poly.test.js` / `tests/drilldown_nearest.test.js` / `tests/zoom_for_bbox.test.js` / `tests/drilldown_aggregate.test.js` / `tests/drilldown_view.test.js` / `tests/drilldown_watchlist.test.js` / `tests/drilldown_country_data.test.js` / `tests/drilldown_country_click.test.js`（node:test）。`tests/test_ne_prep.py`（pytest）。

## 3. build時データ準備（NE処理・name:ja・国別split・bbox・gzip・サイズ）

**入力**: Natural Earth `ne_10m_admin_1_states_provinces`（admin1）と `ne_10m_populated_places`（都市）。NE 生データは repo に無いので**ローカルで手調達**（GeoJSON 化）。geopandas 不要＝標準 json で読む。

**国コード正規化（最深リスクの対処）**: NE は ISO_A2/ADM0_A3 を持つが Orbis 一次キーは FIPS（places.js FIPS_JA・239キー）。`resolve_fips` は **(a) ISO_A2→FIPS 変換表 FIPS_OF_ISO（scripts/lib に同梱・手キュレート）と (b) country_bounds.geojson の name（英名）突合の二重チェック**で取り違え（CH=中国/SF=南アフリカ/AS=豪州/KV/GZ/WE 等の係争地）を検出。未解決は build ログに出力し手キュレートへ。最後に **FIPS_JA キー集合との過不足 assert**（gen_country_centroids.py:83-87 同型）で漏れを build 失敗化。

**name:ja 解決（要件4準拠）**: `pick_name_ja` = (1) NE 属性 name_ja 一次 (2) wikidataid 経由 Wikidata labels/sitelinks(ja) (3) GeoNames alternateNames(ja) (4) 真の欠落のみ英名。(2)(3) はビルド時ネットだが、結果を `scripts/.cache/name_ja_*.json` に保存し再ビルドで再取得しない＝**build 再現性＋実行時/CI ネット非依存**（生成物をコミット）。例外は握りつぶし次段へ（build を止めない）。

**bbox（country_bounds は bbox 非保持）**: 各 admin1 feature に bbox を付与（client 早期棄却用）。国 fly 用 bbox は `largest_polygon_bbox`（MultiPolygon 最大面積ポリゴン・`lonSpan>180` 回避）で算出し `admin1_bbox.json` に集約。

**頂点間引き**: `simplify_ring(eps≈0.01度)` で 50m を間引き、client PIP の1国総頂点を数千点以内に抑制。※nest 残余対策（後述エッジ）で間引き過多にしない（country_bounds・admin1 とも 50m＝確定事項6 で隙間最小化済だが simplify 過多は隙間を再生する）。

**出力**: `data/static/admin1/<FIPS>.geojson.gz`（properties 最小=`{a1code,name_en,name_ja,bbox}`）・`cities/<FIPS>.json`（人口降順 cap maxN=400）・`admin1_bbox.json`・`drilldown_manifest.json`。**EXTRA68 国は空 FeatureCollection を明示出力**（fetch 404 を出さず client の degraded 判定を素直にする＝案2 graft）。

**サイズ**: gzip＋頂点間引き＋properties 最小化で1国 50-500KB（要件帯）。lazy fetch＝初回ロードに影響せず、起動時は country_bounds.geojson（248KB 既存）と admin1_bbox.json/manifest（小）のみ。Vercel は Content-Encoding gzip 自動配信。

## 4. client アルゴリズム（PIP＋最寄り都市・計算量）

- **FIPS 解決（国クリック）**: `country_bounds.geojson`（50m 再生成版・確定事項6）を loadPolygons で一度正規化→`locateFeature(lon,lat)`＝bbox 早期棄却→pointInRings（even-odd）。1点 PIP は bbox prefilter 後実 PIP が数地物＝即時。50m 化で頂点増だが bbox prefilter で実 PIP 対象は少数＝体感不変。boundary-country（line 層）は使わない。
- **admin1 割当**: `assignAdmin1(events, admin1Polys)` が同一 even-odd コア（geo_poly に一本化）で各イベントに a1code 付与。全ミスは `null`＝「その他/不明」バケット。
- **県別集計**: `aggregateByAdmin1` が a1code でグルーピング→count・byLayer 内訳・topEvents（aggregate.js の代表点選定流用）・重心 lon/lat。count 降順・同数 name_ja 安定ソート。
- **最寄り都市**: `nearestCity` が cosLat 補正二乗距離で線形最近傍。maxDeg=1.5 超は null。
- **計算量と大国保護**: 1国 admin1 数十〜百（露85/米51/中34）×イベント数十〜数百＝bbox prefilter 後数千〜数万演算＝1フレーム内同期完了（GPU 不要）。`MAX_POINTS=4000` 頭打ち＋超過時 admin1 割当スキップ（国集計のみのデグレード＝必ず描画）。計算は onClick 時の一回のみ（rAF ループ非介入）。重い国は `requestIdleCallback` で defer 可（案1/3 共通 graft）。
- **zoom 算出**: `zoomForBbox(countryBbox)` を flyTo の zoom に渡す（hardcode zoom 4/5 をパラメータ化）。

## 5. 相互作用フロー

1. globe 上で国土をクリック。
2. **deck.gl onClick が先に評価**され、`info.object` があれば従来通り（flights/ships/news/conflict/protests）処理（main.js:323-358 不変）。同時に排他フラグ `__deckPickedAt`（時刻＋座標）を更新。
3. **`map.on('click')`（country_click.js）が常に発火**。`handleMapClick(e)`: deck が同フレーム（数十ms 以内かつ近接座標）で pick 済なら抑制し return。※ 案3の lastPickAt 純時刻依存の弱点対処として「時刻しきい値＋座標一致」の二重判定にし低速端末の誤抑制を減らす。確実性は実機サニティで最終調整。
4. 空振り（deck 未 pick）時のみ `resolveFipsAt(lng,lat, boundsPolys)` で client ray-casting→FIPS 決定。
5. FIPS 無し（海洋/極域）→ パネルを開かず、控えめな `share-toast`（既存・index.html:56）流用トースト「この地点は国を特定できません」（無反応 UX 回避・案2 graft）。既存 selected/selPopup は変更しない。
6. FIPS 有り→ `openCountry`: (a) `body.classList.add('drill-open')`（CSS が #map を縮小）→ transitionend で `map.resize()` (b) `loadCountryGeo(fips)`（manifest 事前判定→相対 fetch・loading 表示）(c) `buildDrilldown(snapshots=getSnapshots(), fips, ...)` 純集計 (d) `renderDrilldown` で右(PC)/下(モバイル)パネル描画 (e) `map.flyTo({center, zoom:zoomForBbox(bbox), duration:1500, essential:true})`＋`selected={...,layerId:'country',code:fips}` で着地リティクル（buildReticleConfigs）流用。
7. パネル内 region 行/event 行クリック→ `onSelect({lon,lat,title,layerId})`＝既存 selected/flyTo/buildReticleConfigs に合流。
8. ヘッダ★→ watchlist store.save→ renderWatchlist 更新。
9. 閉じるボタン→ `body.classList.remove('drill-open')`→ #map 全幅復帰→ map.resize()。

## 6. 分割サイドパネル UI・CSS・モバイル・blur-bleed 回避

**blur-bleed 回避が絶対要件**（過去2回再発の square-blur-bleed＝globe 上に半透明 blur パネルを重ねると四角く滲む）。本設計は**非重畳**で構造的に回避する。

- **#map の物理縮小**（案3の核心・#map は absolute inset:0 の実態に対処）: `body.drill-open` 時に `#map-wrap` を CSS grid 化し、**`#map` の `position` を static（または relative）に上書きして grid セルに収める**。`body.drill-open #map { position: static; inset: auto; }` ＋ `body.drill-open #map-wrap { display: grid; grid-template-columns: 1fr min(38vw,380px); }`。これで globe が物理的に縮む。`#starfield`/`#freshness`/`#panel`/`#feed`/`#legend` 等の既存 absolute オーバーレイは `position:absolute` のまま参照枠（`#map-wrap` relative）を維持する（grid セルに収めるのは `#map` のみ＝他オーバーレイは map-wrap 全体基準のまま）ため**連鎖崩れしない**。※ 案3が懸念された「#map 全面書換で他オーバーレイが崩れる」リスクは #map のみ position 上書き＋他オーバーレイ維持で回避。実機サニティで確認。
- **#drilldown パネル**: `background: #070b14`（**不透明純色・backdrop-filter / glass クラス一切不使用**＝square-blur-bleed が原理的に発生しない）・`overflow-y:auto`・`z-index:6`。.side-panel（absolute overlay・blur）とは別系統。
- **map.resize 確実化**（案1 graft）: transitionend と ResizeObserver の両建てで globe 再投影歪みを防ぐ（実機サニティ必須）。
- **モバイル（≤768px）**: `body.drill-open #map-wrap { grid-template-rows: 1fr 52vh; }`（上 globe・下シート）。#drilldown を下半分 bottom-sheet 化（translateY スライド・不透明背景・ドラッグハンドル・`#sheet-scrim`流用）。**mobile-nav.js は触らず**国パネル専用の独立シート（body.drill-open 駆動）にして mobile-tabs 3ボタン hardcode への侵襲を回避。
- **パネル内構成（縦スクロール）**: (a) ヘッダ＝国名(name_ja)＋score バー/level 色(scoreColor)＋trend バッジ(trendArrow)＋components/counts(rowHtml 流用)＋narrative_ja＋forecast 注視度 (b) admin1 ランキング＝件数降順カード (c) 個別イベント＝最寄り都市付き行 (d) ウォッチリスト (e) degraded バナー（EXTRA68/海洋/欠落/fetch失敗の理由明示）。
- sec-on/scroll-reveal は使わない（globe 隣接で常時表示）。

## 7. ウォッチリスト

- localStorage `'orbis.watchlist'`（FIPS 配列）。`makeWatchlistStore({storage,key})` で I/O を DI 隔離（state.js 同型・破損→[]）。純操作 addCode/removeCode/hasCode/orderByInstability は store 非依存で node:test 完結。
- **permalink には載せない**（permalink.js / share.js を一切触らない＝共有 URL に混入しない・要件6準拠）。
- 表示は instability の rowHtml/onSelect 契約流用。`orderByInstability(list, window.__orbis.instability.countries)` で join し score 降順。instability に該当国が無い（ランキング圏外）場合は FIPS_JA＋country_centroids 座標の最小行で必ず表示（消えない）。座標あり→onSelect で flyTo、★で onRemove。
- 配置: #drilldown パネル内 .dd-watchlist。

## 8. エッジケース処理

- **EXTRA68 国クリック**: country_bounds に無く resolveFipsAt が null→国詳細は開かず無反応回避トースト。検索/instability/watchlist 経由で選択された場合は manifest.extra の centroid±固定マージン矩形で fly、admin1/cities は空 FC（404 回避）→国集計＋ヘッダのみ＋degradedNoticeHtml「小国・領土のため県別集計なし」。
- **アンチメリディアン（米/加/フィジー/インドネシア）**: build時 largest_polygon_bbox が最大面積ポリゴン基準＝太平洋跨ぎ回避。zoomForBbox もその bbox 使用＝過剰ズームアウト防止。PIP は経度正規化。
- **海洋/極域クリック（FIPS 解決失敗）**: resolveFipsAt null→パネル開かず・selPopup 出さず・share-toast「国を特定できません」。deck onClick の既存分岐は一切阻害しない。
- **name:ja 欠落**: build時 pick_name_ja の最終段で英名格納（真の欠落のみ）→client は name_ja を常に持つ。万一空は drilldown_view で英名 or コード表示・escapeHtml で安全。
- **lazy fetch 失敗/タイムアウト/オフライン**: loadCountryGeo が AbortController+timeoutMs=8000→失敗時 degraded:true で空配列→国集計＋ヘッダ＋「再試行」ボタン＋degradedNoticeHtml。fetchSnapshots（snapshot.js）の失敗スキップ方針と整合。in-flight 共有で連打安全。
- **news lon/lat ジオコーディング誤差（隣国混入）**: collectCountryEvents で当該 FIPS ポリゴン厳密 even-odd 判定＝国 bbox 外の news は出さない。隣国に落ちた点は assignAdmin1 で null→「その他」バケット（誤った admin1 強制割当より安全）。最寄り都市は maxDeg 超で null。
- **解像度 nest（確定事項6 で大幅緩和・残余の安全網）**: 確定事項6 により country_bounds・admin1 を**ともに 50m に統一**したため、国境(country_bounds)と県境(admin1)の nest 整合が大きく上がり取りこぼしは最小化される。ただし NE admin0 と admin1 は完全には dissolve 一致しないため**残余の隙間はゼロにならない**。安全網: (1) admin1 の simplify を過度にしない（eps≈0.01 に抑え隙間を増やさない）。(2) assignAdmin1 が null になった「国内だが admin1 未割当」の点は捨てず**「その他/不明」県バケットに集約して必ず件数表示**（取りこぼしを可視化＝壊れて見えない）。(3) 海岸/離島で admin1 外周外の点の最寄り admin1 近接スナップは将来オプション化。取りこぼし率は実機サニティで確認（50m 統一で実用上十分の想定）。
- **narrative_ja**: window.__orbis.instability の既存値再利用のみ（新規 LLM 生成しない）。該当国が無ければ narrative セクション省略。
- **quakes に FIPS place 無し**: lon/lat→locateFeature で FIPS/admin1 自前算出（place 文字列非依存）。
- **deck pick と国クリックの二重発火**: deck onClick が object を拾った時刻＋座標を記録し、map.on('click') は同フレーム pick があれば国解決を抑制（状態ベース＋座標一致の二重判定で案3の純時刻依存の弱点を緩和）。
- **同一国連打/fly 中の別国クリック**: in-flight Promise 共有＋成功キャッシュ＋selection token でレース破棄。flyTo essential:true で割り込み安全。

## 9. node:test 計画（baseline 352 pass を維持し上積み）

- `tests/test_ne_prep.py`（pytest）: resolve_fips（ISO_A2→FIPS・name 突合・未知→None・CH/SF/AS の罠）/ pick_name_ja（4段優先順）/ split_by_country / largest_polygon_bbox（太平洋跨ぎ回避・lonSpan<180）/ FIPS_JA 過不足 assert（gen_country_centroids 系同型）/ simplify_ring。
- `tests/drilldown_geo_poly.test.js`: pointInRings が geo_country.py と**共有フィクスチャで同一結果**（単純四角/穴あき/MultiPolygon/境界点）/ loadPolygons bbox / locateFeature 最初ヒット・bbox 棄却・海洋点→null。
- `tests/drilldown_nearest.test.js`: nearestCity 最短選択・0件→null・maxDeg 超→null・cosLat 補正・タイブレーク安定。
- `tests/zoom_for_bbox.test.js`: span→zoom 単調減少・極小国 maxZoom クランプ・大国 minZoom クランプ・アンチメリディアン bbox で過剰ズームアウトしない・EXTRA 矩形 fallback。
- `tests/drilldown_aggregate.test.js`: collectCountryEvents（当該 FIPS 内のみ・隣国除外・quakes は place 非依存）/ assignAdmin1（国外/未割当→null=その他バケット）/ aggregateByAdmin1（count 降順・同数 name_ja 安定・byLayer・topEvents 代表）/ MAX_POINTS デグレード（国集計のみ）/ buildDrilldown（instability ヘッダ流用・該当国なしでも落ちない）。
- `tests/drilldown_view.test.js`: drilldownHeaderHtml/regionRowHtml/eventLineHtml（「県名 — 都市名でイベント」整形）/ escapeHtml で XSS 無効化 / 最寄り都市なしフォールバック文 / degradedNoticeHtml 各文言。
- `tests/drilldown_watchlist.test.js`: addCode/removeCode/hasCode（重複排除・順序・上限）/ orderByInstability（join＋score 降順）/ makeWatchlistStore に fake storage DI で load/save round-trip・破損 JSON→[]。
- `tests/drilldown_country_data.test.js`: loadCountryGeo の manifest 有無分岐・timeout/abort→degraded:true・空配列・in-flight 共有（fetch を DI モック）。
- `tests/drilldown_country_click.test.js`: resolveFipsAt（海洋→null・国内→FIPS）/ handleMapClick が deck pick 直後抑制・空振り時のみ openCountry（map/fetch fake 注入）/ lazy fetch reject→error。
- 既存 352 tests 無改修で緑維持（registry/snapshot/data-source/geo 契約不変を回帰保証）。最終 `node --test tests/*.test.js` ＋ pytest 緑を verification-before-completion で確認。
- playwright e2e（DOM 存在・海洋クリックでパネル開かない）＋太田さん実機サニティ（fly 寄り具合・grid 縮小ちらつき・モバイル bottom-sheet・blur-bleed 不在・lazy fetch・ウォッチ永続・容量・admin1 精度）。GPU/視覚は実機。

## 10. リスクと対処

- **FIPS-ISO 変換表の網羅性**（最深リスク）: CH=中国/SF=南アフリカ/AS=豪州/KV/GZ/WE の取り違えは admin1 が別国に付く。→ FIPS_OF_ISO 表＋country_bounds name 突合の二重チェック＋FIPS_JA 過不足 assert で build 失敗化。係争地は手キュレート。
- **解像度 nest 残余**（確定事項6 で大幅緩和）: country_bounds も 50m 化し admin1 と揃えたため取りこぼしは最小化。残余（NE admin0/admin1 の不完全 dissolve）は「その他バケット可視化・simplify 抑制」で安全網。実機で取りこぼし率を太田さんサニティ。
- **country_bounds 50m 再生成の回帰**（確定事項6 で新規）: consumer（collectors geo_country.py・gen_country_centroids.py・client FIPS 解決）への影響。→ 同一スキーマ＋FIPS 全保存 assert＋既存 352/pytest 緑＋collectors FIPS 割当サニティで担保。起動時 fetch 増（gzip ~300-600KB）は許容。
- **#map position 上書きの globe 再投影歪み**: transitionend＋ResizeObserver の両建て map.resize。実機サニティ必須。
- **deck/map.on('click') 二重発火**: 座標一致＋時刻の二重判定。実機で誤抑制/誤発火を境界調整。
- **globe での flyTo zoom（zoomForBbox）の寄り具合**: 純テストで単調性は担保するが大国/極域の体感は実機調整。fitBounds は ?fit=1 段階導入。
- **name:ja Wikidata/GeoNames build時ネット依存**: ローカルキャッシュ＋生成物コミットで実行時/CI 非依存。初回ビルドは重い（許容）。
- **data/static 容量増（admin1×171国）**: gzip＋頂点間引き＋properties 最小化＋cities cap。lazy fetch で配信問題なし。git 履歴肥大は gzip で緩和（必要なら別途検討・orbis-data 無改修制約とは別レイヤー）。
- **SW 扱い**: v45 版up。/data/static はネット優先 cache のまま（オンライン最新・オフライン fallback）で運用可。admin1 は頻繁更新しない build 成果物。

## 11. Phase2 内実装順序（各段 node:test 緑を確認・難所を早期に潰す）

1. **純幾何コア（テストファースト）**: geo_poly.js（even-odd 移植・geo_country.py と共有フィクスチャ）＋tests。
2. **独立純関数**: nearest.js＋zoom_for_bbox.js＋tests（依存なし）。
3. **build時データ準備**: ne_prep.py（純粋・pytest）→build_country_bounds.py（country_bounds を 50m 再生成・確定事項6・FIPS 全保存 assert）→gen_country_centroids.py 再実行（centroid/EXTRA 更新）→build_admin1.py/build_cities.py/build_drilldown_manifest.py（I/O）→data/static 生成・**まず米/日/ウクライナ等代表国でサイズ（admin1 と 50m country_bounds 双方）と name:ja カバレッジ実測**（確定事項7 の総容量判断材料）。FIPS 整合 assert 緑。**回帰確認**: 既存 JS 352＋pytest 緑維持＋collectors の FIPS 割当が 50m 化で破綻しないサニティ（geo_country.py データのみ変更）。
4. **集計コア**: aggregate_admin1.js＋tests（2/3 の出力を入力にした純集計・MAX_POINTS・その他バケット）。
5. **純HTML＋watchlist**: drilldown_view.js＋watchlist.js＋tests。
6. **I/O 境界**: country_index.js＋country_data.js（lazy fetch+timeout+degraded+cache・fetch DI）＋country_click.js（map/fetch DI・resolveFipsAt・排他）＋tests（fake 注入）。
7. **render**: ui/drilldown.js＋tests（DOM stub・HTML は純関数済なので配線のみ検証）。
8. **配線**: index.html に #drilldown 追加・main.js に map.on('click')＋initCountryClick（getSnapshots DI）＋deck pick 排他フラグ・css 非重畳 split（#map position 上書き・PC 横/モバイル下半分・不透明背景・transitionend+ResizeObserver）。
9. **SW**: v45 版up。
10. **検証**: node:test＋pytest 緑（verification-before-completion）→playwright e2e→太田さん実機サニティ→finishing-a-development-branch で main 統合（Vercel push でデプロイ）→横断記憶整理（feature-roadmap 所有ノート更新）。

最小 diff 原則: 新規 14ファイル＋既存 4ファイル（main.js/index.html/orbis.css/sw.js）への局所追記。registry/collector/orbis-data/permalink/share/mobile-nav/geo.js は不変更。