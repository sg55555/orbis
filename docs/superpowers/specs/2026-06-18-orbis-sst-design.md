# ORBIS 水温(SST)レイヤー 設計

- 日付: 2026-06-18
- 対象: ORBIS（`~/apps/orbis`）
- 種別: 新レイヤー追加（海面水温 Sea Surface Temperature）

> **実装時の修正（2026-06-18）**: 本文中の「全球 5° グリッド -85..85 / 35行 / 2520点」は実装時に
> **-80..80 / 33行 / 2376点** に変更した。理由＝Open-Meteo Marine API は海洋モデル範囲外（±85 等の極域）の
> 地点で「No data」=HTTP 400 を返し、その地点を含む 200点バッチ全体が失敗する（陸は null を返すので可・極域だけが 400）。
> 実測で ±80 以内なら全バッチ 200。回帰防止テスト `tests/test_sst.py::test_production_grid_is_within_marine_domain_pm80`。

## 目的

全球の海面水温(SST)を地球儀上に連続カラーの面で可視化する。既存の `airtemp`（気温）
レイヤーが BitmapLayer による全球温度面のほぼ完全なテンプレートになるため、それを踏襲して
最小コストで追加する。

## 確定済みの設計判断（ユーザー承認）

1. **データソース = Open-Meteo Marine API**（キー不要・無料）。
   - エンドポイント: `https://marine-api.open-meteo.com/v1/marine`、`current=sea_surface_temperature`。
   - 実証確認済み（2026-06-18）: キー不要で °C を返す。**陸（内陸）は `sea_surface_temperature=null`** を返す＝
     陸マスクは API 側で済んでいる（沿岸はごく近傍の海セルにスナップして値を返すことがある＝許容）。
2. **海流レイヤーとの住み分け = 全海背景＋別色リボン**。
   - SST = 全海面の**絶対温度バックドロップ**（BitmapLayer・静的ヒート）。
   - 既存 `currents`（海流）= その上を流れる**別色リボン**（変更しない）。
   - 形（面 vs 帯）＋海流の動く発光で分離。色は海流の青→緑→赤と区別できる別系統にする。
3. **既定 OFF**（`airtemp`/`ships` と同じ。新規ユーザーには出さない）。
4. **カラーパレットと温度レンジは実アプリ比較で確定**（`?sstmap=` で複数候補を比較。
   `airtemp` の `?tmin=`・`currents` の `?cmap=` と同じ手法）。

## アーキテクチャ（airtemp 踏襲・疎結合）

既存 `currents`/`airtemp` には一切手を入れず、独立した `sst` レイヤーとして追加する。

### コレクタ `collectors/sst.py`（`airtemp.py` の複製＋差分）

- 全球 5° グリッド（lat -85..85=35行 × lon -180..175=72列 = 2520点、row-major）。
- `API_URL = "https://marine-api.open-meteo.com/v1/marine"`、`current=sea_surface_temperature`。
- レート制限対策は airtemp と同一: `BATCH=200`・`SLEEP_S=25`・429 で `RETRY_WAIT_S=65`×3 リトライ。
  （Marine API も同じ Open-Meteo 基盤。2520点 ÷ 200 ≒ 13 バッチ × 25s ≒ 約5.5分／回。GitHub Actions で許容）。
- 出力 `data/snapshots/sst.json`: `{ layer:"sst", updated, grid:{lat0,lon0,latStep,lonStep,nLat,nLon}, temps:[…row-major, 陸/欠損はnull] }`。
- 純関数（airtemp と同型・TDD）: `build_grid` / `grid_meta` / `chunk` / `parse_temps` / `build_snapshot`。
  - `parse_temps` はバッチ応答 `current.sea_surface_temperature` を grid 順に平坦化、欠損は `None`。
- manifest 更新は `collectors.lib.manifest.update_manifest` を使う（airtemp と同じ）。

### フロントレイヤー `js/layers/sst.js`（`airtemp.js` の複製＋SST調整）

- deck.gl **BitmapLayer**（360×180 ImageData テクスチャを bounds `[-180,-90,180,90]` に貼る・双線形補間）。
  globe で正しく球面ラップすることは airtemp で実証済み。陸/欠損セルは `alpha=0`（透明）。
- 純関数（airtemp と同型・TDD）:
  - `sstToColor(tempC)` … `SMIN..SMAX` を 0..1 に正規化して STOPS を線形補間。
  - `buildSstField(snapshot, w, h)` … グリッドを w×h に双線形補間して RGBA を返す（null=透明）。
  - `sstAt(snapshot, lat, lon)` … 最近傍セルの水温（範囲外/欠損は null）。ホバー用。
- ルックの初期値（実アプリで確定するための出発点）:
  - `SMIN=-2, SMAX=32`（海洋SSTの実域。airtemp の -40..40 より狭く海の温度差を分解）。
  - 開始パレット = **青→白→赤のダイバージング**（緑なし・白い中点。海流の緑を含む青→緑→赤と明確に分離）。
  - `opacity = 0.40`（airtemp 0.45 よりわずかに薄い背景に徹し、海流リボン・地震等を透す）。
  - `?sstmap=` パラメータで候補パレット（例: `div`=青白赤 / `thermal` 等）を切替えて実物比較。
- レイヤーメタ: `id:'sst'`, `label:'水温'`, `marker:'gradient'`（airtemp と同じグラデスウォッチを再利用）,
  `legend:[{冷たい},{中間},{暖かい}]`。
- `tooltip()` は `null`（BitmapLayer のピック object に座標が無い）。ホバー文字列は main.js が生成。

### 配線（最小差分）

- `js/layers/registry.js`:
  - `import { sstLayer } from './sst.js';`
  - `layers` 配列の **`currentsLayer` の直前**に `sstLayer` を挿入（SST 背景を海流リボンの下に描く＝deck は配列が後ろほど上に重なる）。
  - `DECK_TO_LAYER` に `sst: 'sst'` を追加。
- `js/main.js`:
  - `ALL_IDS` に `'sst'` を追加、`POLL_LAYERS` に `'sst'` を追加（スナップショットを持つ）。
  - `loadEnabled(ALL_IDS, readStored(), ['airtemp','ships','sst'])` … 既定 OFF に `'sst'`。
  - `import { sstAt } from './layers/sst.js';`
  - ホバー分岐に `if (info.layer.id === 'sst') { const c = info.coordinate; const t = sstAt(snapshots.sst, c[1], c[0]); return t==null?null:\`水温 ${Math.round(t)}°C｜${c[1].toFixed(0)}, ${c[0].toFixed(0)}\`; }`
    （airtemp の分岐と同型）。
- `.github/workflows/collect.yml`: `Collect air temperature` ステップの後に
  `Collect sea surface temperature`（`python -m collectors.sst || echo "sst skipped"`）を追加。
- `sw.js`: `CACHE` を `orbis-v18` → **`orbis-v19`**（main.js を更新するため SHELL キャッシュを更新）。
- CSS 追加なし（`marker:'gradient'` のスウォッチは airtemp で実装済みを再利用）。

## データフロー

1. GitHub Actions cron（collect.yml, */15）→ `collectors.sst` が Marine API を 5°グリッドで取得 → `data/snapshots/sst.json` をコミット。
2. クライアント: `snapshot.js` のポーリングが `sst.json` を取得 → `snapshots.sst`。
3. `registry.buildDeckLayers` が（SSTが有効なら）`sstLayer.toDeckLayer` を呼び BitmapLayer を生成。
4. ホバー時、main.js が `info.coordinate` と `sstAt` で「水温 N°C｜lat,lon」を表示。

## エラー処理・エッジケース

- API 失敗/429: airtemp と同じ `fetch_with_retry`（429 で 65s 待ち×3）。collect ステップは `|| echo "sst skipped"` で
  非ブロッキング（他レイヤーの収集を止めない）。
- 全セル null（万一）: フィールド全透明＝何も描かれない（クラッシュしない）。
- 陸セル null: 透明＝大陸は塗られない（意図通り）。
- BitmapLayer が globe で破綻した場合のフォールバック: airtemp では不要だった（同じ BitmapLayer 経路なので不要見込み）。
  実機検証で破綻が出たら airtemp と同様に SolidPolygon 格子フォールバックを検討（保険）。

## テスト

- **node**（`tests/sst.test.js`）: `sstToColor`（-2/0/32 とクランプ境界）/ `buildSstField`（陸=透明・補間値）/ `sstAt`（範囲外 null・最近傍）。
- **pytest**（`tests/test_sst.py`）: `build_grid`（点数2520・row-major順）/ `chunk` / `parse_temps`（null 保持・平坦化）/ `build_snapshot`（形）。
- **e2e**: トグル ON で deck 層 `sst` が出現し `counts.sst>0`（airtemp の既存 e2e と同型）。
- **実機（本番 Playwright）**: 「暖海（サンゴ海/赤道）が暖色・極が寒色・大陸は透明・海流リボンが SST 上で読める・エラー0」を画素確認。

## 進め方

branch `sst` → spec（本書）→ plan → subagent 駆動（実装 sonnet / レビュー haiku 二段）→ 最終レビュー →
main マージ → `git push origin main`（Vercel 自動デプロイ）→ 本番 Playwright 検証 → `?sstmap=`/`SMIN/SMAX`/`opacity` を実物比較で確定。
コミット作者メールは noreply 必須。JS ユニットは `node --test tests/*.test.js`。

## YAGNI（やらないこと）

- 海流レイヤーの改修・統合（独立追加のみ）。
- 時系列アニメ／過去データ（現在値のみ）。
- 0.25°など高解像度（5°で十分・レート制限内）。
- SST 異常値（anomaly）表示。
- 専用 CSS スウォッチ（gradient を再利用）。
