# ORBIS 船舶ツールチップ見出し＋クリック推定進路 設計

- date: 2026-06-17
- status: approved（ブレスト承認済み・実装前）
- branch: `ship-projection`
- related: [[orbis]] / 2026-06-17-orbis-ships-design

## 目的・スコープ

船舶レイヤーに、航空機と同等の2機能を追加する。

1. **ツールチップの全項目に見出し**: 現 `船名 X｜貨物船｜12kn｜航路 045°` の船種・速度に見出しが無い → 全項目を見出し付きに。
2. **クリックで推定進路表示**: 航空クリック（進路ライン/到達リング/流れる粒子/到達パルス＋詳細ポップアップ）を船舶に同型展開。`cog`(針路)＋`sog`(速度kn)で1時間先を推定、色はマゼンタ（航空と統一）。

### 非目標（YAGNI）
- 航跡（過去軌跡）。今回は未来推定のみ。
- 目的地の実データ参照（AIS は目的地フィールドもあるが今回は使わない・COG/SOG延長の推定に一本化）。
- 推定時間のユーザー可変UI（固定60分）。

## 1. ツールチップ見出し（`js/layers/ships.js`）

`shipTooltip(o)` を、船種・速度に見出しを付けた形へ：
- 全項目あり: `船名 EVER GIVEN｜船種 貨物船｜速度 12kn｜航路 045°`
- 船名/船種欠損: `MMSI 123456789｜速度 12kn｜航路 045°`（欠損項目は省略・cog 360→000 ラップは維持）
- 既存ラベル `船名`/`MMSI`/`航路` は変更しない（最小差分）。追加するのは `船種 ` と `速度 ` の見出しのみ。

## 2. クリック推定進路

### 2-1. 投影計算（`js/lib/geo.js`）
- 現 `projectedArrival(p, minutes)` は `p.heading`(deg)＋`p.velocity`(m/s) 前提。船は `p.cog`(deg)＋`p.sog`(**knot**)。
- 共通純粋コアを抽出: **`projectAhead(lon, lat, headingDeg, speedMps, minutes) -> [lon,lat]|null`**。
  欠損/非有限/`speedMps <= 0` は null。既存の cosLat 補正ロジックを踏襲。
- `projectedArrival(p, minutes)` は `projectAhead(p.lon, p.lat, p.heading, p.velocity, minutes)` へ委譲（回帰テストで挙動不変を担保）。
- 新規 **`shipArrival(p, minutes) -> [lon,lat]|null`**: `projectAhead(p.lon, p.lat, p.cog, (p.sog ?? 0) * 0.514444, minutes)`（kn→m/s）。
  cog/sog 欠損・sog 0 は null（=進路なし）。

### 2-2. 進路レイヤー config（`js/lib/selection.js`・DRY化）
- 航空・船で line/ring/flow/pulse がほぼ同一 → 純粋 config ビルダ **`buildProjectionConfigs(sel, motionT, opts)`** を新設
  （`buildReticleConfigs` と同流儀＝deck 非依存、config 配列を返す）。
  - 入力 `sel = { src:[lon,lat], arrival:[lon,lat]|null, prefix }`。`arrival` が null なら空配列。
  - 返す config（`prefix`-route / -arrival / -flow / -pulse）: マゼンタ `PROJ_RGB=[255,90,220]`／flow は `PROJ_FLOW_RGB=[255,150,235]`。
    - route: LineLayer config（src→arrival、幅2px、α200）
    - arrival: ScatterplotLayer 中空リング（半径9px、α240）
    - flow: `opts.reduced` 時は省略。`pointAlongPath([src,arrival], t)` で PER=6 粒子（α脈動）
    - pulse: `opts.reduced` 時は省略。到達点の拡大リング（motionT 位相）
  - 既存 `flightProjectionLayers()`（main.js）も**このビルダに載せ替え**（prefix='flight'・見た目バイト等価）。flow/pulse 用に `pointAlongPath` は既存 import を流用。
- 注: deck レイヤー id は `flight-route/...` と `ship-route/...`。`updateTriggers` の motionT は呼び出し側で付与（config に含める）。

### 2-3. ポップアップ（`js/lib/selection.js`）
- 新 **`shipPopupHtml(p, arrival, minutes)`**（`flightPopupHtml` と対）。
  - タイトル: `🚢 ` ＋ 船名（無ければ `MMSI <n>`）
  - メタ: `船種 <type or 不明>｜速度 <round(sog)>kn｜航路 <pad3(round(cog)%360)>°`（cog/sog 欠損は該当項目を「—」。用語はツールチップと統一して「航路」）
  - ヒント: `📍 推定進路 約<minutes>分後 <lat,lon>`＋`<span class="sel-note">※AIS の COG/SOG 延長による推定（針路・速度一定と仮定）</span>`
  - 到達点が null（停泊/速度0/針路不明）: 到達 `—`＋注記「速度0/針路不明で進路推定不可」。
  - マゼンタのドット（`rgb(255,90,220)`）。

### 2-4. クリック配線（`js/main.js`）
- 状態追加: `let selectedShip = null;`、定数 `const SHIP_PROJECT_MIN = 60;`。
- overlay onClick: 既存の flights 分岐に並べて、`info.layer.id` が `ships`/`ships-dot` のとき
  `selectedShip = { point: p, arrival: shipArrival(p, SHIP_PROJECT_MIN) }`、selPopup に `shipPopupHtml(p, arrival, SHIP_PROJECT_MIN)`、`drawAll(overlay)`。
- `drawAll` に `shipProjectionLayers()` を追加（`selectedShip` から `buildProjectionConfigs({src, arrival, prefix:'ship'}, motionT, {reduced})` → `new deck.*`）。
  既存 `flightProjectionLayers()` も同ビルダ経由へ統一。
- import 追加: `shipArrival`（geo.js）、`shipPopupHtml`・`buildProjectionConfigs`（selection.js）。

## テスト

- **node --test**:
  - `geo.test.js`: `projectAhead`（北/東へ前進・速度0/負→null・heading欠損→null）、`shipArrival`（kn→m/s換算で前進・cog/sog欠損→null）、`projectedArrival` 回帰（従来の heading/velocity で従来結果）。
  - `selection.test.js`: `buildProjectionConfigs`（prefix 反映・id 群・arrival null→空・reduced で flow/pulse 省略）、`shipPopupHtml`（船名/MMSI・到達/—・速度0注記）。
  - `ships.test.js`: `shipTooltip` を見出し付き期待値に更新（船種/速度）。
- **e2e（smoke）**: 船舶トグル ON → 任意船クリックは canvas ピック座標依存で不安定なため deep には検証せず、`buildProjectionConfigs` の単体テストで進路 config を担保。既存の航空進路同様、本番は Playwright スクショ目視。
- **本番 Playwright**: 船をクリック→マゼンタ進路ライン/到達リング/粒子/パルス＋ポップアップ（見出し付き）描画・エラー0 を画素確認。
- **sw**: CACHE v15 → **v16**。

## リスク・確認事項
- **flights 進路の共通ビルダ載せ替え**＝動作中機能に触れる。config をバイト等価に保ち、`projectedArrival` 回帰テスト＋既存 e2e（航空進路は e2e 非検証だが描画存在は本番目視）で担保。慎重に。
- 港湾停泊船は `sog≈0`→進路なし（仕様どおり・ポップアップで明示）。
- `shipArrival` の kn→m/s 係数 0.514444（1 knot = 1.852 km/h）。

## 進め方
1. branch `ship-projection`（済）→ この spec（済）
2. writing-plans → subagent 駆動（実装sonnet/spec haiku/品質sonnet/最終opus）
3. 色・延長はマゼンタ/60分で確定済（必要なら本番スクショで微調整）
4. main マージ → push → 本番 Playwright 検証。push 拒否時は `git pull --no-rebase`。コミットメール noreply 必須。
