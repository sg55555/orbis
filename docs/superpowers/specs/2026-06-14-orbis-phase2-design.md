# ORBIS Phase 2（コアレイヤー＋パネル）設計書

- **日付**: 2026-06-14
- **前提**: 全体設計 `2026-06-13-orbis-design.md` の P2。Phase 1（地球儀＋地震＋スナップショット基盤）は本番稼働済み。
- **ステータス**: データソースをライブ検証して確定。実装計画はこの後 writing-plans で作成。

## 1. スコープ

Phase 2 で追加するもの：
- **4データレイヤー**: ✈️航空 / 🔥紛争 / ✊抗議 / 📦貿易ルート（いずれも**認証不要**で実現可能なことをライブ検証済み）
- **レジストリ拡張**: 1レイヤーが複数 deck レイヤー／複数凡例を返せるように
- **左パネル**: 全レイヤーのトグル＋凡例（registry 駆動、Phase 1 のハードコード凡例を置換）。折りたたみ可。状態を localStorage 永続化
- **右パネル**: リアルタイムイベントフィード（地震＋紛争＋抗議を時系列集約、クリックで地図 flyTo）。折りたたみ可
- 収集ワークフローを 4 レイヤー対応に拡張（cron を `*/15` に）

**スコープ外（後続）**: 🚢船舶=Phase 2b（AISStream 無料キー＋WebSocket収集が必要）。🪖軍事近似ほか拡張層=P4。アニメ補間/LOD最適化/モバイル完全対応=P5。

## 2. データソース（ライブ検証済み・2026-06-14）

### ✈️ 航空 — OpenSky `/api/states/all`（匿名）
- `https://opensky-network.org/api/states/all?lamin=..&lamax=..&lomin=..&lomax=..` が**匿名で200/JSON**を返すことを確認（bbox指定でJapan周辺42機）。
- OAuth2クライアント認証は2025年以降推奨だが**匿名でも取得可**（最新state vectorのみ・10秒解像度・レート制限あり）。匿名は約400クレジット/日、`/states/all`グローバルは4クレジット → `*/15` cron＝96回/日×4＝384/日で上限内（ギリギリ）。
- **堅牢性**: 429（レート超過）時は**前回スナップショットを温存**（Phase 1 と同パターン）。将来throttleが頻発するなら OAuth2 client credentials を GitHub Secret に追加して切替（任意・後日）。
- state vector 配列の主要index: 0=icao24, 1=callsign, 2=origin_country, 5=longitude, 6=latitude, 7=baro_altitude, 8=on_ground, 9=velocity, 10=true_track(heading)。
- **容量対策**: グローバルは1〜2万機。フィールドを `{icao24, callsign, lon, lat, heading, velocity, alt, on_ground}` に間引き、座標を小数3桁に丸め、**最大約6000機にダウンサンプル**（超過時は間引き）。

### 🔥 紛争 / ✊ 抗議 — GDELT 2.0 Events CSV
- **GDELT GEO API は廃止（404）を確認**。代わりに Events 生CSVを使用（検証済み）。
- `http://data.gdeltproject.org/gdeltv2/lastupdate.txt` → 最新 `YYYYMMDDHHMMSS.export.CSV.zip` のURL（15分毎更新）→ zip取得→TSVパース。
- 1バッチ約500イベント・**61列**。主要index: 0=GlobalEventID, 1=SQLDATE, 26=EventCode, 28=EventRootCode, 30=GoldsteinScale, 34=AvgTone, 51=ActionGeo_CountryCode, 53=ActionGeo_FullName, 56=ActionGeo_Lat, 57=ActionGeo_Long, 59=DATEADDED, 60=SOURCEURL。
- **CAMEO root code フィルタ**: `14`=抗議 → protests.json。`18`(assault)/`19`(fight)/`20`(mass violence) → conflict.json。ActionGeo座標がある行のみ。
- **ローリング集約**: 1バッチの該当イベントは少数（数十）。新規バッチを前回スナップショットにマージし、**直近24時間**のイベントを GlobalEventID で重複排除して保持、各最大2000件にcap。これで意味のある密度の24h ビューになる。
- 1イベント = `{id, lon, lat, place, root, code, tone, date, url}`。

### 📦 貿易ルート — 静的 GeoJSON（手作成）
- リアルタイムでなく既知の主要航路。`data/static/trade_routes.geojson` を手作成しコミット（収集器なし）。
- 内容: 主要航路 LineString（環太平洋・環大西洋・アジア↔欧州(スエズ)・北米↔欧州 等 8〜12本）＋ 要衝 Point（スエズ/ホルムズ/マラッカ/パナマ/バブ・エル・マンデブ/ボスポラス/ジブラルタル/ドーバー）。
- フロントは静的ファイルを1回 fetch（スナップショットのポーリング対象外）。

## 3. フロント設計

### レジストリ拡張
- `toDeckLayer(snapshot)` が **deck レイヤー単体または配列**を返せるように。`buildDeckLayers` で flat 化。
- レイヤーに **複数凡例**（`legend` 配列）と、任意の **`toFeedItems(snapshot)`**（イベントフィード用、discrete eventレイヤーのみ実装）を追加。
- ポーリング対象IDは「スナップショットを持つレイヤー」（quakes/flights/conflict/protests）。trade は静的fetch。

### レイヤーモジュール（統一I/F・純粋部を分離してテスト）
- `js/layers/flights.js`: IconLayer 風（heading で回転）or Scatter。シアン系。`buildFlightsConfig` 純粋。
- `js/layers/conflict.js`: Scatter（赤/マゼンタ、強度=GoldsteinやNumMentionsで半径）。`buildConflictConfig` 純粋。toFeedItems あり。
- `js/layers/protests.js`: Scatter（グリーン）。`buildProtestsConfig` 純粋。toFeedItems あり。
- `js/layers/trade.js`: PathLayer（航路）＋ Scatter/Icon（要衝・グロー）。`toDeckLayer` は配列を返す。`buildTradeLayers` 純粋。
- quakes は既存。toFeedItems を追加（地震もフィードに出す）。

### 左パネル（レイヤートグル）
- registry の `layers` を列挙し、各レイヤーのトグル（チェック）＋凡例を表示。Phase 1 の `#legend` ハードコードを置換。
- トグルで `enabled` Set を更新→deck レイヤー再構築。`enabled` を localStorage 永続化（次回復元）。
- 折りたたみボタンで地図を広く表示可。

### 右パネル（イベントフィード）
- enabled かつ `toFeedItems` を持つレイヤーのスナップショットから item を集約 → `time` 降順 → 上位N（例100）表示。
- item クリック → `map.flyTo({center:[lon,lat], zoom:5})`。
- 折りたたみ可。

### 横断
- パネルは折りたたみ可（地図全画面化）。モバイルは簡易対応（パネルをオフキャンバス/ボトム寄せ）。完全なモバイル最適化は P5。
- Aurora テーマのガラスUIを踏襲。

## 4. 収集ワークフロー
- `collect.yml` を拡張: quakes に加え flights・gdelt_events を実行。cron を `*/15`（OpenSky 匿名クレジット安全域＋GDELT更新間隔に整合）。
- 生成スナップショット（flights.json / conflict.json / protests.json）と manifest を commit/push。bot メールは noreply 済み。
- 各収集器は失敗時に前回スナップショットを温存（独立・疎結合）。

## 5. テスト（TDD）
- **Python**: flights transform（state vector→点・on_ground含む・ダウンサンプル）／gdelt parse（行→イベント・rootcodeフィルタ・座標必須）＋ローリングマージ（24h窓・重複排除・cap）。
- **JS(node:test)**: 各 buildConfig 純粋部／registry の配列返却 flat 化／enabled トグル＆localStorage（純粋関数化）／フィード集約（複数レイヤー集約＋time降順＋cap）。
- **Playwright**: 既存 smoke を維持しつつ、左パネルのトグルでレイヤー数が変わる／フィードに item が出る／item クリックで地図移動、を最小検証。

## 6. 完了基準
地球儀上に地震＋航空＋紛争＋抗議＋貿易ルートが表示され、左パネルでトグルでき、右フィードに最新イベントが時系列で出てクリックで地図が飛ぶ。収集ワークフローが4レイヤーを更新。全テスト緑。本番デプロイで確認。

## 7. 非目標（YAGNI）
- 船舶（Phase 2b）・軍事近似ほか拡張層（P4）。
- アニメ補間・LOD最適化・完全モバイル（P5）。
- OpenSky OAuth2（匿名で開始。必要時に後付け）。
