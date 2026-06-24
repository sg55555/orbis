# ORBIS Phase 4.0 — マーカー視認性 ＋ flyTo/進路 ＋ ホバー改善（設計）

日付: 2026-06-14 / 対象: `~/apps/orbis`

## 背景と目的
ユーザー本番フィードバック:
1. 航空機がドットだけで**進行方向が分からない**。
2. 航空と地震が**同じ丸**で紛らわしい。
3. **flyTo の到着地表示**（着地マーカー/ポップアップ）がうまく機能していない＋航空の到達点・詳細が欲しい。
4. 貿易ルート・航空などで**ホバー感度が悪く**詳細が見にくい。

本フェーズで A〜D を一括改善する。

### 技術制約（実機スパイクで確定・遵守）
- deck.gl **9.3.4 + globe + MapboxOverlay** では **IconLayer も TextLayer も描画されない**（テクスチャ/フォントアトラス系が全滅。`Expected value to be of type number, but found null`）。globe に 9.3.4 が必須でダウングレード不可。
- → 形状は**ジオメトリ系（SolidPolygon/Path/Line/Scatter）のみ**で作る。これらは地理座標サイズのため、ピクセル一定に見せるには**現在ズームからサイズを再計算**する。知見: `Knowledge/deckgl-9.3-iconlayer-globe-broken`。
- 検証は**件数でなくスクリーンショットで画素を目視**（`mistakes.md` 2026-06-14）。

## A. 航空 = 進行方向を向く塗り三角形（ズーム適応）
- `SolidPolygonLayer`（テクスチャ非依存で確実に描画）。各機を heading 方向の二等辺三角形（塗りつぶし・シアン `[80,220,255,235]`）で描画。`pickable: true`。
- **ズーム適応**: `degLenForZoom(zoom)` = `TARGET_PX * (156543.03 / 2^zoom) / 111320`（赤道 metersPerPixel 近似）。`TARGET_PX≈10`。三角の長さ `L=degLen`、半幅 `W=L*0.55`。
- 三角形頂点（純粋関数 `flightTrianglePolygon(point, degLen)`）:
  - `cosLat = max(cos(lat), 0.2)`、`fwd=[sin(h)/cosLat, cos(h)]`、`perp=[cos(h)/cosLat, -sin(h)]`
  - `tip = pos + fwd*L`、`back = pos - fwd*L*0.5`、`left = back + perp*W`、`right = back - perp*W` → `[tip,left,right]`
  - heading が null/非数値なら `null`（三角を描かない）。
- **heading 無しの機**: 小さなドット（`buildDotConfig`、`ScatterplotLayer` 半径2.5px、pickable、layer id `flights-dot`）でフォールバック。
- **tooltip 解決**: pick 結果 `info.layer.id` の接尾辞（`-dot` 等）を除いて canonical 層 id（`flights`）に解決する（`registry.tooltipFor` を「id を `-` 前で正規化」に小改修）。三角の layer id は `flights`。
- **zoom 伝搬**: レイヤー I/F を `toDeckLayer(snapshot, ctx)` に拡張し `ctx.zoom` を渡す（registry が `buildDeckLayers(enabled, snapshots, layersOverride, ctx)` で受けて転送、他レイヤーは引数を無視）。`main.js drawAll` は `window.__orbis.map.getZoom()` を ctx に詰める。`updateTriggers:{getPolygon: degLen}` でズーム変化時のみ再計算。
- **追従**: motionLoop が毎フレーム drawAll（通常時）。reduced-motion 用に `map.on('zoom', () => drawAll(overlay))` を追加。
- legend: 「航空機（▲＝進行方向）」。tooltip 文言は現行維持（便名/高度/速度）。

## B. 地震 = 中空リング（＋淡い波紋）
- `quakes` の `buildScatterConfig` を塗り円 →「**stroked 中空リング**」に変更:
  `stroked:true, filled:false, lineWidthUnits:'pixels', getLineWidth:1.6, getRadius: magnitudeToRadius(mag), getLineColor:[...magnitudeToColor(mag),230]`。色は現行の magnitude カラー維持。
  - これで 航空=▲（塗り）／紛争・抗議=ブロブ（加算面）／地震=○（中空リング）と形が分離。
- **波紋（リッチ化・控えめ）**: 半径の大きい（M が一定以上の）地震に、外側へ拡大する淡い同心リングを 1 本重ねる動的レイヤー（`main.js` 側、motion 位相で半径アニメ）。`prefers-reduced-motion` 時は描かない。密集回避のため上位 N 件または `mag>=閾値` のみ。
- pick: ScatterplotLayer は半径内で pick されるため中空でも tooltip 可能（維持）。

## C. flyTo / 選択の強化（C1+C2+C3）
### C1 着地リティクル＋ポップアップの確実化・明確化
- 既存 `js/lib/selection.js` の `buildReticleConfigs` を強化（リング径を一回り拡大、確実に最前面）。フィードクリック時に `selPopup` を必ず `addTo`。reduced-motion でも基本リング＋ドットは表示。
### C2 航空機クリックで進路予測（推定到達点）
- overlay に `onClick` を追加。`flights`/`flights-dot` を pick したら `selectedFlight` をセット。
- 純粋関数 `projectedArrival(point, minutes)`: `dist_m = velocity * minutes*60`、heading 方向へ `dist_m` 進めた `[lon,lat]` を返す（緯度の経度収束補正、velocity/heading 欠損時 null）。既定 `minutes=10`。
- 描画: 現在地→推定到達点の**進路ライン**（`LineLayer`、細い半透明シアン）＋到達点マーカー（小リング `ScatterplotLayer`）。ポップアップに「推定到達（10分後・OpenSky は目的地データ無しのため heading×速度からの推定）」と明記。
### C3 ポップアップ詳細充実
- `selectionPopupHtml` を種別別に拡張:
  - イベント（feed 由来）: 種別・場所（日本語国名含む）・時刻・出典ホスト・座標。
  - 航空（flight クリック）: 便名・高度・速度・進行方位・推定到達点（lat,lon）。
- 既存のネオン濃紺ガラス popup スタイルを踏襲、行を増やしても収まる幅に。

## D. ホバー感度改善
- `js/map.js` の overlay 生成に `pickingRadius: 8` を追加（既定 0 → カーソル近傍 8px を判定）。これで小ドット・細い貿易ルート線・紛争/抗議の小 pick 点すべて拾いやすくなる。
- 必要に応じ貿易ルート `trade-routes` の pick 用 `getWidth` を体感優先で微増（視覚幅は変えず pickingRadius で吸収できれば変更不要）。

## コンポーネント / ユニット（疎結合・テスト可能）
- `js/lib/geo.js`: `degLenForZoom(zoom)`、`projectedArrival(point, minutes)`（純粋）。前回の `headingEndpoint`（LineLayer 版で使用）は本フェーズで不要になるため **`projectedArrival` に置換して削除**（旧テストも差し替え）。
- `js/layers/flights.js`: `flightTrianglePolygon(point, degLen)`、`buildTriangleConfig(snapshot, degLen)`、`buildDotConfig(snapshot)`（null heading 用）。旧 `buildHeadingConfig` は削除。
- `js/layers/quakes.js`: `buildRingConfig`（中空リング）。
- `js/lib/selection.js`: `selectionPopupHtml`（種別別に拡張）、`buildReticleConfigs`（強化）、`flightPopupHtml`（航空用）。
- `js/layers/registry.js`: `buildDeckLayers(..., ctx)` で zoom 転送。
- `js/main.js`: drawAll で ctx.zoom 注入、`map.on('zoom')` 再描画、overlay `onClick`（flight 選択→進路/ポップアップ）、地震波紋の動的レイヤー。
- `js/map.js`: overlay に `pickingRadius`。

## テスト
- ユニット（node:test）: `degLenForZoom`（zoom 増で減少・正値）、`flightTrianglePolygon`（tip が heading 前方／null heading→null）、`projectedArrival`（東向き→経度増・速度0/欠損→null）、`buildRingConfig`（stroked/filled:false）、`selectionPopupHtml`（種別別に必要項目を含む・エスケープ）。
- e2e（Playwright）: 航空▲が描画される／地震が中空リング／`pickingRadius` でホバー tooltip が出やすい／flight クリックで進路ライン＋ポップアップ。
- **Playwright スクショで画素目視**（globe・ズームイン両方で航空三角と地震リングの実在を確認）。

## 進め方
branch `phase-4.0-marker-interaction` → 本 spec → 実装プラン → 実装（TDD・必要に応じ subagent 駆動）→ main マージ → push（collect cron 競合時 `git pull --no-rebase`、push は安全根拠併記）→ Vercel 自動デプロイ → 本番 Playwright 検証 → 横断記憶整理。

## 非対象（YAGNI）
- 航空の**本当の目的地**（OpenSky 匿名は提供しない）。出すのは推定到達点のみ。
- 紛争/抗議・貿易の形状変更（今回は地震と航空のみ）。
- 船舶（Phase2b）・新規データ層（P4）・海流/気温/水温（将来希望、別途）。
