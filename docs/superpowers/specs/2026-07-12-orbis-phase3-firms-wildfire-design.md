# Orbis Phase 3: NASA FIRMS 山火事（active fire）レイヤー 設計

- date: 2026-07-12
- status: approved（brainstorming 承認済み・実装計画へ）
- related: `docs/superpowers/specs/2026-06-23-orbis-feature-roadmap-and-phase0-design.md`（G FIRMS）

## ゴール / 背景
ロードマップ Phase 3。全球の活火点（山火事）を点レイヤーとして globe に追加する。既存 `collectors/quakes.py`／`js/layers/quakes.js` の統一パターンを踏襲し、スナップショット方式（collector→orbis-data→frontend）に乗せる。

**コスト方針**：本レイヤーは **Anthropic API（プロフィール生成）を一切使わない**。データ源は NASA FIRMS（無料）。コード＋単体テスト＋配線は**今すぐ無課金**で実装・検証でき、**実データ活性化は太田さんが無料 MAP_KEY を取得して GitHub secret に追加**した時点で cron が配信を始める（それまで collector はキー無しで skip）。

## データ源（NASA FIRMS Area API・実確認済み 2026-07-12）
- エンドポイント（最新データ・日付省略形）：
  `https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/{SOURCE}/{AREA}/{DAY_RANGE}`
- `SOURCE`＝**`VIIRS_NOAA20_NRT`**（既定・375m・運用衛星）。定数で `VIIRS_SNPP_NRT`／`VIIRS_NOAA21_NRT` に切替可。
- `AREA`＝`world`（全球）。
- `DAY_RANGE`＝**`1`**（直近 24h の active fire）。有効範囲 1..5。
- レート制限＝MAP_KEY あたり 5000 transactions / 10 分（本用途＝1日数回の world 取得なので余裕）。
- CSV は **ヘッダ行で列名パース**（列順ハードコードしない＝堅牢）。VIIRS NRT の想定列：
  `latitude, longitude, bright_ti4, scan, track, acq_date, acq_time, satellite, instrument, confidence, version, bright_ti5, frp, daynight`。
  - `confidence`＝VIIRS は `l`/`n`/`h`（low/nominal/high）。単語形 `low`/`nominal`/`high` も許容してマップする。
  - `frp`＝火放射パワー（MW）。`bright_ti4`＝輝度温度（K）。

## データ scope（承認＝顕著な山火に絞る）
全球 VIIRS は 1 日で数万点になり得るため、`transform` で以下に絞る（**すべて定数＝後から調整可**）：
1. **信頼度フィルタ**：`confidence ∈ {nominal, high}`（`n`/`h`）。`low`/`l` は除外。
2. **FRP 閾値**：`frp >= FRP_MIN`（既定 `FRP_MIN = 10.0` MW＝小さな農地火・恒常燃焼を落とす）。
3. **上限 cap**：**FRP 降順で上位 `CAP`（既定 `CAP = 1500`）** に制限（スナップショット肥大・globe 密集・描画負荷の抑制）。cap で切った件数は log する（silent truncation を避ける）。
- これにより「notable events」美学（地震／紛争と同じ）に揃え、スナップショットを軽量（数百〜1500点）に保つ。

## Collector `collectors/firms.py`（quakes.py 同型・純関数 TDD）
- `parse_csv(text) -> list[dict]`（純）：ヘッダ行から列名→値の dict 列にする（列順非依存）。空/不正行はスキップ。
- `transform(rows) -> list[point]`（純）：信頼度・FRP でフィルタ → FRP 降順ソート → 先頭 `CAP` 件。各 point：
  `{id, lon, lat, frp, confidence, bright, acq_date, acq_time, daynight, satellite}`。
  - `id` は `f"{lat}_{lon}_{acq_date}_{acq_time}"`（FIRMS は固有 id を持たないため合成・pick/feed 用に一意）。
  - `confidence` は `n`/`h`→`nominal`/`high` に正規化。`frp`/`bright` は float 化（不正は None でなく除外）。
- `build_snapshot(points, updated_iso) -> {layer:"firms", updated, count, points}`（純）。
- `fetch(map_key, source, day_range, timeout) -> str`：Area API を GET し CSV テキストを返す（`raise_for_status`）。
- `main()`：`FIRMS_MAP_KEY` を env から読む。**未設定なら print して skip**（`briefing`/`news` と同型）。設定時＝`fetch`→`parse_csv`→`transform`→`build_snapshot`→`data/snapshots/firms.json` 書き出し＋`update_manifest(manifest_path, "firms", updated_iso, count)`。
- **例外時**：`fetch`/`parse` 失敗は既存 collector と同じく非致命（cron step は `|| echo skipped`）。空 CSV・全除外は `count=0` の snapshot を書く（レイヤーは空表示＝壊れない）。

### snapshot スキーマ（`data/snapshots/firms.json`）
```json
{ "layer": "firms", "updated": "2026-07-12T00:00:00Z", "count": 842,
  "points": [ { "id":"…", "lon":133.1, "lat":-24.0, "frp":42.5,
    "confidence":"high", "bright":330.1, "acq_date":"2026-07-12",
    "acq_time":"0312", "daynight":"D", "satellite":"N20" } ] }
```

## Frontend `js/layers/firms.js`（quakes.js 同型・純関数 TDD）
統一インターフェース `{ id:'firms', label:'山火事', marker, swatchColor, legend, fetch, toDeckLayer, tooltip, toFeedItems }`。
- `fetch(getSnapshot)` → `getSnapshot('firms')`。
- **`buildFireConfig(snapshot)`（純・buildRingConfig 同型）**：`ScatterplotLayer` 設定。
  - **塗り円（filled・stroked=false）**、**暖色パレット（FRP 低→高：黄 `rgb(255,214,64)` → 橙 `rgb(255,140,32)` → 赤 `rgb(255,64,32)`）**、`getFillColor` に alpha（例 210）。
  - **半径 ∝ √FRP**（`radiusUnits:'pixels'`・`getRadius = clamp(sqrt(frp)*k, rMin, rMax)`）。純ヘルパ `frpToRadius(frp)`／`frpToColor(frp)`（`lib/geo.js` に置くか firms.js 内）。
  - 地震の中空リング・寒色と視覚的に差別化（火＝塗り暖色）。**面禁則は点描画ゆえ無関係**（globe 上の不透明「面」を置かない制約に抵触しない）。
- **地名（最寄り国の粗ラベル）**：`js/lib/country_centroids.js` の `COUNTRY_CENTROIDS` を使う純関数 **`nearestCountry(lon, lat) -> name_ja`**（全 centroid の最小球面距離）。火点は precise な地名を持たないため「◯◯付近」の粗ラベルに留める（honest）。
  - `tooltip(o)` → `「山火事 ${nearestCountry}付近｜FRP ${frp} 信頼度 ${conf_ja} ${acq_date}」`。
  - `toFeedItems(snapshot)` → `{id, time(acq_date/time→ms), title:`🔥 ${nearestCountry}付近 FRP${frp}`, layerId:'firms', lon, lat}`（クリック→既存 `onSelect→flyTo` 契約に乗る）。
- `legend`＝FRP バンド（黄=弱／橙=中／赤=強）。`marker:'dot'`（塗り点）・`swatchColor` は橙。

## 配線
- `js/layers/registry.js`：`import { firmsLayer }` ＋ `layers` 配列末尾に追加＋ id マップ（`firms:'firms'`）＋ tooltip 説明（`firms: '活火点（NASA FIRMS・色/大きさ=火の強さFRP）'`）。
- `js/ui/sources.js`：`firms: { source: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' }`。
- `.github/workflows/collect-slow.yml`：既存 airtemp/sst の後に step 追加
  `- name: Collect FIRMS wildfires` / `run: python -m collectors.firms || echo "firms skipped"` / `env: { FIRMS_MAP_KEY: ${{ secrets.FIRMS_MAP_KEY }} }`。3h 毎の slow 枠を再利用（Vercel Hobby rate-limit 対策）。
- `sw.js`：js/css 変更につき CACHE バージョンを bump。

## 今 / 後（活性化）
- **今すぐ（無課金）**：`collectors/firms.py`＋`js/layers/firms.js`＋配線＋テストを実装。collector はキー無しで skip・テストは fixture CSV／fixture snapshot でネットワーク不要。frontend はレイヤー登録済みだが snapshot が無ければ空表示（graceful）。
- **活性化（太田さん）**：① NASA FIRMS で無料 MAP_KEY 取得（https://firms.modaps.eosdis.nasa.gov/api/map_key/）② GitHub secret `FIRMS_MAP_KEY` 追加 → 次の collect-slow cron で `firms.json` が orbis-data に配信され実火点が描画される。

## テスト（TDD・先行）
- Python（pytest）：`parse_csv`（ヘッダ列順非依存・不正行スキップ）／`transform`（confidence フィルタ・FRP 閾値・降順 cap・id 合成・confidence 正規化）／`build_snapshot`／`main` の skip-without-key（fixture CSV・実 HTTP 無し）。
- JS（node:test）：`buildFireConfig`（filled/暖色/半径 √FRP）／`frpToRadius`・`frpToColor`（境界クランプ）／`nearestCountry`（既知座標→期待国）／`tooltip`・`toFeedItems`（fixture snapshot）。
- 既存 registry テスト（あれば）に firms 追加で回帰。

## 調整可能パラメータ（定数・後で実データを見て調整）
`SOURCE`（既定 VIIRS_NOAA20_NRT）／`DAY_RANGE`（既定 1）／`FRP_MIN`（既定 10.0）／`CAP`（既定 1500）／パレット閾値・半径係数。実データ活性化後に太田さんの実機所感で微調整。

## 非スコープ（YAGNI）
- 火点の precise 逆ジオコーディング（国より細かい地名）は不要（最寄り国の粗ラベルで足りる）。
- 煙・延焼予測・履歴アニメーションは対象外（active fire の現況点のみ）。
- MODIS 併用・複数衛星マージは初期は不要（VIIRS_NOAA20 単一）。必要なら定数切替で後日。
