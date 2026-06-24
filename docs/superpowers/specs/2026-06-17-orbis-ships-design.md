# ORBIS 船舶レイヤー（Ships / AIS）設計

- date: 2026-06-17
- status: approved（ブレスト承認済み・実装前）
- branch: `ships`
- related: [[orbis]] / 2026-06-13-orbis-snapshot-architecture / 2026-06-16-orbis-air-temperature-design / deckgl-9.3-iconlayer-globe-broken

## 目的・スコープ

AISStream.io の全球リアルタイム AIS（船舶位置）を定期取得して snapshot 化し、globe 上に
**進行方向を向く船体シルエットの面（既定 OFF）** として描く新レイヤー `ships` を追加する。
「生命化した地球」テーマに沿い、海上の動きを可視化する（Phase 2b 相当）。

あわせて、同じ描画コードを触る延長で **既存 flights のマーカーを三角形→飛行機シルエット多角形へ格上げ**
する（ユーザー要望「船舶および航空も」に対応）。どちらも globe で実績のある SolidPolygon 経路を維持する。

既存の registry 駆動・snapshot 方式・パネルトグル・localStorage 永続の延長で実装する。

### 非目標（YAGNI）
- 軌跡（航跡ライン）・時系列アニメーション。今回は「現在位置の静止マーカー」のみ。
- 船舶クリック時の推定進路（航空の projectedArrival 相当）。将来候補。
- 船種別の色分け。色は単一の海色系（型はツールチップ表示のみ）。
- IconLayer による画像アイコン。**deck.gl 9.3.4 + globe で IconLayer/TextLayer は全滅**するため不可
  （[[deckgl-9.3-iconlayer-globe-broken]]）。シルエットは SolidPolygon の多角形で表現する。

## データ取得 — `collectors/ships.py`

- **ソース**: AISStream.io WebSocket（`wss://stream.aisstream.io/v0/stream`）。無料・要 API キー。
- **キー**: GitHub リポジトリ Secret `AISSTREAM_API_KEY`（データ同期は GitHub Actions で走るため。
  Vercel env var は同期に不使用）。生キーは AI に見せず、オーナーが直接 Secret に設定する。
- **購読**: 接続直後に購読メッセージを送信。全球 BBox `[[[-90,-180],[90,180]]]`、
  `FilterMessageTypes=["PositionReport","ShipStaticData"]`。
- **時間枠リッスン**: `LISTEN_SECONDS`（既定 28s）。socket タイムアウト＋全体 deadline でループ制御。
  - `positions[mmsi]` = 最新 `{lon, lat, cog, sog}`（逐次上書き。全メッセージは保持しない）
  - `statics[mmsi]` = `{name, type}`（ShipStaticData を蓄積）
- deadline 到達 → close → MMSI で join → `MAX_POINTS`（5000）へ等間隔間引き → 書き出し。
- **キー未設定**（ローカル等）は即 skip して `exit 0`。無メッセージ（キー無効）時は前回 snapshot を保持。
- **出力**: `data/snapshots/ships.json`
  ```json
  {
    "layer": "ships",
    "updated": "2026-06-17T12:00:00Z",
    "count": 1234,
    "points": [
      {"mmsi": 123456789, "lon": 1.234, "lat": 5.678,
       "cog": 45.0, "sog": 12.3, "name": "EVER GIVEN", "type": "貨物船"}
    ]
  }
  ```
  `cog` / `name` / `type` は null 許容（cog 欠損船はドット描画、name/type 欠損はツールチップで MMSI のみ）。
- **cron**: 既存 `collect.yml`（*/15）に `Collect ships` ステップを追加。
  `env: AISSTREAM_API_KEY: ${{ secrets.AISSTREAM_API_KEY }}`、`python -m collectors.ships || echo "ships skipped"`。
- **依存追加**: `requirements.txt` に `websocket-client`（同期 WebSocket）。

### Python 純関数（pytest 対象・ネットワーク不要）
- `parse_position(msg) -> dict|None` — PositionReport メッセージ（サンプル dict）→ `{mmsi,lon,lat,cog,sog}`。
  緯度経度欠損は None、座標は小数 3 桁。cog/sog 欠損は None 値を保持。
- `parse_static(msg) -> dict|None` — ShipStaticData → `{mmsi,name,type}`（type は AIS 船種コード→日本語）。
- `ship_type_label(code) -> str` — AIS 船種コード→日本語カテゴリ。代表マッピング：
  30 漁船 / 36 帆船 / 37 プレジャーボート / 50 水先 / 51 捜索救助 / 52 曳航 / 60-69 旅客船 /
  70-79 貨物船 / 80-89 タンカー、未知・範囲外は「船舶」。
- `merge_records(positions, statics) -> list` — MMSI で結合。静的欠損は name/type=None。
- `downsample(points, max_points)` / `build_snapshot(points, updated_iso)` — flights と同型。
- I/O 隔離: `collect(api_key, seconds) -> (positions, statics)` が WS を開閉。テストは純関数のみ検証。

## 描画 — `js/layers/ships.js`（registry 登録）＋ `js/layers/flights.js`（格上げ）

### マーカー＝進行方向のシルエット多角形（SolidPolygon）
- IconLayer 画像は globe 全滅のため使えない。代わりに **多角形シルエット**で「船らしさ／飛行機らしさ」を出す。
- 既存 `flightTrianglePolygon` と同じ **forward/perp ローカル基底**（heading/COG 方向の前方ベクトル＋直交ベクトル、
  `degLenForZoom(zoom)` でズーム適応、`cosLat` 緯度補正で画素一定化）を用い、頂点を増やす。
  - **船舶**: 船体シルエット（前方に尖り後方は方形の細長い多角形。例 6 頂点：船首 tip／左右舷側前／左右船尾／…）。
  - **航空（格上げ）**: 飛行機シルエット（機首・主翼・尾翼を持つ多角形。三角形を置換）。
  - 具体的な頂点座標は実装プランで定義し、**python http.server で実物比較して最終確定**（極小サイズでの視認性と
    寄った時の形状を両立する頂点数に調整。三角/菱形に対し収穫逓減があるため過剰な頂点は避ける）。
- COG / heading 欠損の機・船は従来通り **小ドット**（ScatterplotLayer）。
- `toDeckLayer` → `[SolidPolygonLayer(silhouette), ScatterplotLayer(dot)]`。globe 実績層のみ。

### 色・透明度
- 船舶＝海色系（シアン航空と差別化。緑〜ティール or 琥珀系の候補を置く）。航空＝既存シアン維持。
- 既定色候補を置き、**実装時に python http.server で実物比較**して確定（TMIN/look ダイヤルの前例）。

### JS 純関数（node --test 対象）
- `shipSilhouettePolygon(p, degLen) -> [[lon,lat],...]|null` — COG→船体シルエット頂点。COG/座標欠損で null。
- `planeSilhouettePolygon(p, degLen) -> [[lon,lat],...]|null` — heading→飛行機シルエット頂点（三角形を置換）。
- `buildSilhouetteConfig(snapshot, degLen)` / `buildDotConfig(snapshot)` — 各レイヤーの SolidPolygon / Scatterplot
  config 分割（向き有=シルエット・向き無=ドット）。
- `tooltip(o)` の整形（name 有無で出し分け）。

## UI

- **パネルトグル**: registry に ships を登録（id `ships`、label「船舶」）。スウォッチ＝船体シルエット形
  （新 swatch 種 `diamond`／css `.swatch-diamond`。航空 `triangle` も飛行機シルエットへ寄せるか実装時判断）。
- **凡例**: 「船舶（◆＝進行方向）」。
- **ホバー**: `船名 EVER GIVEN｜貨物船｜12kn｜航路 045°`。name/type 欠損時は `MMSI 123456789｜12kn｜航路 045°`。
  速度は kn 表示（sog はノット）、航路は cog 度（欠損時は省略）。
- **既定 OFF**・localStorage 永続。`main.js` の `loadEnabled(ALL_IDS, readStored(), ['airtemp','ships'])` に追加。
- **DECK_TO_LAYER**: `ships` / `ships-dot` → 論理 id `ships`。
- **配線**: registry（layers / DECK_TO_LAYER / DESCRIPTIONS）、main.js（POLL_LAYERS / ALL_IDS / defaultOff /
  counts フォールバック）、css（`.swatch-diamond`）、sw.js **CACHE v14 → v15**、collect.yml（ships ステップ）。

## テスト

- **pytest**: parse_position / parse_static / ship_type_label（境界：29/30/36/37/50/52/59/60/69/70/79/80/89/90/未知）/
  merge_records（結合・静的欠損）/ downsample / build_snapshot。
- **node --test**: shipSilhouettePolygon / planeSilhouettePolygon（向き→頂点・null→null）/
  buildSilhouetteConfig・buildDotConfig（向き有無で分割）/ tooltip 整形（name 有無）。
  flights 格上げの既存テスト（flightTrianglePolygon）は planeSilhouettePolygon へ置換・更新。
- **e2e（Playwright）**: ships 既定 OFF → トグル ON → レイヤー存在・コンソールエラー 0。航空が引き続き描画。
- **本番 Playwright 検証**（キー設定後）: globe に船舶シルエット描画・count>0・他レイヤー併用で破綻なし・エラー 0 を画素確認。
- **sw キャッシュ版**: v14 → **v15** に上げる（必須）。

## 進め方

1. branch `ships`（済）→ この spec（済）
2. writing-plans で実装プラン作成
3. subagent 駆動（実装 sonnet / レビュー haiku 二段。spec 準拠＋品質）
4. マーカー形状・色は python http.server で実物比較 → 頂点と配色を確定
5. 最終レビュー → main マージ → `git push origin main`（Vercel 自動デプロイ）
6. オーナーが `AISSTREAM_API_KEY` を GitHub Secret に設定 → cron or workflow_dispatch で本番データ生成
7. 本番 Playwright 検証。push 拒否時は collect cron 競合 → `git pull --no-rebase`。コミットメール noreply 必須。

## リスク・確認事項

- **全球ストリーム量**: deadline＋逐次上書き＋downsample で有界（全メッセージ非保持）。CI 実行 ~30-60s 想定。
- **CI での WebSocket**: wss(TLS) は websocket-client が対応。無メッセージ（キー無効）時は前回 snapshot 保持で安全。
- **カバレッジ**: AISStream はコミュニティ AIS（陸上受信）で沿岸・欧亜が濃く外洋は疎＝現実的で許容。
- **deck.gl 9.3 globe**: SolidPolygon + Scatterplot は flights で実績ありで安全。IconLayer は使わない。
- **極小サイズの視認性**: シルエットは globe 既定ズームでは ~7px と小さく三角/菱形と差が出にくい。
  寄った時に効く前提で頂点数は控えめに。実物比較で「やり過ぎ」を避ける。
- **キー前提**: キー未設定の間は ships レイヤーはデータ無し（トグルは出るが描画されない）。実装・テストはキー無しでも緑。
