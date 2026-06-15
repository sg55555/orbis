# ORBIS 気温レイヤー（Air Temperature）設計

- date: 2026-06-16
- status: approved（ブレスト承認済み・実装前）
- branch: `airtemp`
- related: [[orbis]] / 2026-06-14-orbis-ocean-currents-design / maplibre-v5-deckgl-globe-version / deckgl-9.3-iconlayer-globe-broken

## 目的・スコープ

Open-Meteo の全球 2m エア温度（現在値）を定期取得して snapshot 化し、globe 上に
**連続カラー温度面（半透明オーバーレイ・既定 OFF）** として描く新レイヤーを追加する。
「生命化した地球」テーマに沿い、globe 全体が暖色↔寒色のグラデで薄く染まる絵を狙う。

既存の registry 駆動・snapshot 方式・パネルトグル・localStorage 永続の延長で実装する。
水温（SST）は意味が海流レイヤーと重複するため今回スコープ外（将来候補）。

### 非目標（YAGNI）
- 予報（時系列）・アニメーション再生。今回は「現在値の静止カラー面」のみ。
- 等温線（コンター）・点ブロブ表現。連続カラー面に一本化。
- 高解像度気象グリッド（GFS/GRIB）。粗グリッド＋補間で十分。

## データ取得 — `collectors/airtemp.py`

- **ソース**: Open-Meteo Forecast API（`https://api.open-meteo.com/v1/forecast`、`current=temperature_2m`）。
  キー不要・無料。
- **グリッド**: 緯度経度 **5°間隔**。経度 -180..175（step5 → 72 列）、緯度 -85..85（step5 → 35 行）
  = **約 2,520 点**。連続面へ補間描画するため 5° で十分滑らか・snapshot は数十 KB に収まる。
- **バッチ取得**: Open-Meteo は `latitude=a,b,c&longitude=d,e,f` で複数地点を 1 リクエストで受ける。
  地点数上限は保守的に **1 バッチ最大 200 点** とし分割（約 13 リクエスト）。各リクエスト間に
  軽いスリープを入れレート制限を避ける。失敗時はそのバッチをスキップして欠損は前回値 or null。
- **出力**: `data/snapshots/airtemp.json`
  ```json
  {
    "ts": "2026-06-16T12:00:00Z",
    "grid": { "lat0": -85, "lon0": -180, "latStep": 5, "lonStep": 5, "nLat": 35, "nLon": 72 },
    "temps": [/* nLat*nLon の row-major（lat 昇順 × lon 昇順）。欠損は null */]
  }
  ```
  グリッド構造を保持することで、フロント側で面メッシュ／テクスチャ化が容易になる。
- **cron**: 既存 `collect.yml`（*/15）に airtemp 取得ステップを追加。気温変動は緩いが既存サイクルに相乗り。

### Python 純関数（pytest 対象）
- `build_grid(lat0, lat1, lon0, lon1, step) -> list[(lat, lon)]` — グリッド座標列の生成。
- `chunk(points, size) -> list[list]` — バッチ分割。
- `parse_temps(responses, grid_index) -> list[float|None]` — Open-Meteo レスポンス（サンプル JSON）
  を grid 順の温度配列に変換。ネットワークは呼ばず、取得済みレスポンスを純粋に整形する。
- ネットワーク I/O（`fetch_batches`）は薄いラッパに隔離し、テストはサンプルレスポンスで純関数を検証。

## 描画 — `js/layers/airtemp.js`（registry 登録）

連続カラー温度面・半透明・globe 対応・既定 OFF。

### 描画方式（第一候補と検証方針）
- **第一候補 = deck.gl `BitmapLayer`**: グリッド温度を補間して `ImageData`（例 720×360）に温度カラーを
  焼き、全球 bounds `[-180, -90, 180, 90]` のテクスチャとして貼る。GPU バイリニアで滑らか・軽量。
- **globe 投影リスク**: deck.gl 9.3 + globe では一部レイヤーが破綻する前例あり（IconLayer 全滅
  → [[deckgl-9.3-iconlayer-globe-broken]]）。**BitmapLayer の globe 動作は実物検証で確認**し、
  破綻する場合は **SolidPolygon 格子（セル単位塗り・航空三角で globe 実績あり）にフォールバック**する。
  方式の最終確定は python http.server での実物比較で行う（クロノグラフ／海流流の確立フロー）。
- **既存パターン**: `toDeckLayer(snapshot, ctx)` で zoom 等を受け、単体 or 配列を返す。

### 配色・透明度
- `tempToColor(tempC) -> [r,g,b]` 純関数。寒色→暖色（青→シアン→緑→黄→橙→赤）。
  レンジ **-40〜40°C** でクランプ。区間ごとの線形補間。
- `?cmap=` で配色プリセット比較可（既定 1 種）。look.js に寄せるか専用 cmap モジュール。
- αブレンド **opacity ≈ 0.45**（加算ではなく通常αで薄く染める）。
- 既定 OFF・localStorage 永続（既存 state.js）。

### JS 純関数（node --test 対象）
- `tempToColor(tempC) -> [r,g,b]` — カラーマップ。境界値（<-40 / >40 / null）を含む。
- `buildTempField(snapshot, w, h) -> Uint8ClampedArray` — グリッド→補間済み RGBA ピクセル配列
  （BitmapLayer 用 ImageData の元）。null セルは近傍 or 透明扱い。
- グリッド最寄り値 `tempAt(snapshot, lat, lon) -> number|null`（ホバー用）。

## UI

- **パネルトグル**: registry に airtemp を登録（id `airtemp`、label「気温」）。
  スウォッチ＝温度グラデのバー（新 swatch 種 `gradient`、css `.swatch-gradient`）。
- **凡例**: 温度カラーバー（-40 ↔ 40°C・主要目盛）。パネル内 or 凡例領域。
- **ホバー**: 「気温 12°C｜<座標 or 地名>」。`tempAt` でグリッド最寄り値を引く
  （BitmapLayer の picking は限定的なため overlay の coordinate から最寄りセル参照）。
- **DECK_TO_LAYER**: 描画レイヤー id（`airtemp` / フォールバック時の格子 id）→ 論理 id `airtemp` を登録。

## テスト

- **pytest**: `build_grid` / `chunk` / `parse_temps`（サンプル Open-Meteo レスポンス JSON で）。
- **node --test**: `tempToColor`（境界含む）/ `buildTempField` / `tempAt`。
- **e2e（Playwright）**: airtemp トグル ON → 描画存在（canvas 更新 / レイヤー数増）・コンソールエラー 0。
  既存 e2e の存在チェック方式に合わせる。
- **本番 Playwright 検証**: 本番 URL で globe に温度面が描画・他レイヤー併用で破綻なし・エラー 0 を画素確認。
- **sw キャッシュ版**: v13 → **v14** に上げる（必須）。

## 進め方

1. branch `airtemp`（済）→ この spec（済）
2. writing-plans で実装プラン作成
3. subagent 駆動（実装 sonnet / レビュー haiku 二段。spec 準拠＋品質）
4. 描画方式は python http.server で実物比較 → BitmapLayer or SolidPolygon 格子を確定
5. 最終レビュー → main マージ → `git push origin main`（Vercel 自動デプロイ）
6. 本番 Playwright 検証。push 拒否時は collect cron 競合 → `git pull --no-rebase`。コミットメール noreply 必須。

## リスク・確認事項

- **Open-Meteo の複数地点リクエスト上限／レート制限**: 実装時に小バッチで実測し size を確定。
  上限が厳しければグリッドを粗く（例 6°）or バッチ数調整。
- **BitmapLayer の globe 対応**: 破綻時は SolidPolygon 格子へフォールバック（spec で許容済み）。
- **面が他レイヤーを潰す懸念**: opacity 0.45・既定 OFF で緩和。実物で濃度微調整。
