# ORBIS 起動画面リッチ化 設計（③ 地球生成 ＋ 観測網テレメトリ 融合）

- date: 2026-06-20
- project: orbis
- status: design（承認済み・実装計画待ち）
- 関連: `2026-06-19-orbis-desktop-immersion-design.md`, look.js / immerse.js のダイヤル思想

## 目的

起動（ローディング）画面を ORBIS の「署名」に引き上げる。第一印象でこのサイトの主役＝
**地球（リアルタイム世界監視）**を予告し、本物の globe へ継ぎ目なく受け渡す。オーナーの嗜好
（深紺×オーロラ×粒子のリッチ感・nexus 級）と、デスクトップ没入で globe を主役（zoom 2.7）に
振ってきた方針に整合させる。

## 採用判断

4 方向（①地球生成のみ／②観測網テレメトリのみ／③1+2 融合／④旧来ボットの拡張）を試作
（`proto/boot.html?boot=1|2|12|3|current`）で実機比較し、**③ 1+2 融合（globe 主導の配分）** を採用。
- ① 単体は awe だが「何を監視するか」を語らない（装飾寄り）。
- ② 単体は本質に直結するが地球が脇役・やや硬質。
- ③ は両取り：**地球を主役（約 65%）＋スリムなテレメトリ（約 35%）**。最もリッチかつ意味がある。
- ④ は安全だが署名性が控えめ。比較用に本番でも `?boot=3` でプレビュー可能とする。

## スコープ

- 対象：起動画面（`#loading`）の描画・モーション・本物 globe への handoff。
- 非対象：地図/レイヤー/フィード/メディアの挙動、データ取得ロジック（別セッション・別 spec）。

## アーキテクチャ

### ファイル構成

| ファイル | 変更 |
|---|---|
| `js/ui/boot.js`（新規） | canvas FX ＋ テレメトリ点呼 ＋ handoff 制御を所有する ESM モジュール。 |
| `js/lib/boot-fx.js`（新規） | **DOM に触れない**純粋関数（feed 定義・タイミング・ease・正射影・handoff 判定）。node ユニットテストから直接 import できるよう boot.js から分離。 |
| `index.html` | `#loading` 内の `.boot` マークアップを新構造（canvas＋overlay＋telemetry＋wordmark＋bar）へ差し替え。`#loading` の器は維持。 |
| `css/orbis.css` | `.boot*` 群を新スタイルへ置換/拡張。**共有ファイル＝並行セッションと直列で扱う。** |
| `js/main.js` | `boot()` 冒頭で `initBoot()` を起動。`map.on('load')` で `controller.requestHandoff()` を呼ぶよう配線。 |

### モジュール境界とインターフェース

```
// js/ui/boot.js — ?boot / ?bootmin は内部で読む（look.js / immerse.js と同流儀）
export function initBoot({ reduced }) -> controller
controller = {
  requestHandoff(): void   // 「map ready」シグナル。最小表示を満たし次第 handoff を実行。
  destroy(): void          // rAF/timer 停止（保険）。
}
```

- boot.js は起動直後にアニメを開始（`#loading` は最初から可視）。`boot-fx.js` の純粋関数を import。
- main.js は **「map ready」だけ**を `requestHandoff()` で渡す。**「最小表示×map ready」の合成判定は
  boot.js 内**に閉じる（main.js はタイミングを知らない＝関心の分離）。
- handoff 実行＝`#loading` に `.hidden`（既存 CSS の `transition: opacity .6s` でフェード）を付与し、
  rAF を停止。背後の本物 globe（map z1）が露出する。

## ブート FX（描画要素）

### canvas 層（`#fx`、`cfg.globe` 有効時のみ）

- **星屑**：微細な明滅（reduced 時は静止）。
- **粒子収束**：画面外から globe の縁へ流れ込み「物質が集まって惑星になる」感（0〜約 1.0s）。
- **経緯線 globe（正射影）**：赤道→極へ伸びる draw-on（約 0.6〜1.9s）。緩い回転＋軸傾き。前面
  半球のみ描画し縁で減衰。
- **大気ハロ**：globe 外周に点灯（約 1.6〜2.5s）・微パルス。
- **表面データ点**：ランダム lat/lon に瞬く点（約 2.1〜2.9s）。シアン/エメラルド。

### DOM 層（overlay）

- **ワードマーク**：`letter-spacing` 1.1em→.42em へ収束＋ぼかし解除＋glow bloom（約 0.9s 開始）。
- **テレメトリ（スリム）**：globe 直下に実レイヤー名を順次点呼（後述）。
- **進捗バー**：点呼の充填（fill モード）。
- **オーロラの淡い光**：背面で浮遊（CSS blur ブロブ）。

## handoff とタイミング（肝）

現状は `map.on('load')` で即 `#loading` を消す。新仕様は **「最小表示 minMs（既定 2400ms）」AND
「map ready」** の両方を満たしたら handoff：

1. boot.js は内部で経過時間 `elapsed` を保持。
2. main.js の `map.on('load')` が `requestHandoff()` を呼ぶ。
3. boot.js は `remainingHold(elapsed, minMs) = max(0, minMs - elapsed)` だけ待ってから handoff。
   - 速い回線：最小表示まで保持（署名が必ず読める）。
   - 遅い回線：map ready まで globe 回転＋テレメトリ継続で待機（既に minMs 超過なら即 handoff）。
4. handoff：boot の canvas globe を実 globe と**ほぼ同じ大きさ/位置**に置いてあるため、フェードで
   「ワイヤーフレーム→本物の惑星」に見える。

> 既存事実（`js/main.js`）：`map.on('load')` の先頭で `#loading` に `.hidden`。本実装ではこの 1 行を
> `controller.requestHandoff()` に置換する。

## テレメトリの誠実さ

実レイヤー名を順次点呼する representational 演出（地震 USGS／航空 ADS-B／GDELT 紛争・抗議／
Open-Meteo 気温・水温／AISStream 船舶／海流・貿易／ニュース 翻訳）。
- **最終ステップ／handoff は実際の `map ready` に連動**＝飾りでなく本当の準備完了に同期する。
- 進捗バーは点呼の完了数で充填。各行が空入力/欠落でも壊れない（純粋関数で固定リスト駆動）。

## 調整ダイヤル（look.js / immerse.js と同じ流儀）

- `?boot=1|2|3|12`：本番でも別案をプレビュー（既定 `12`）。④比較を残せる。
- `?bootmin=<ms>`：最小表示時間（既定 2400）。
- 配色強度・globe サイズ・回転速度・テレメトリ密度は定数化し、実機を見ながら詰める。

## reduced-motion

`prefers-reduced-motion: reduce` 時：静止の完成状態（globe ワイヤー＋大気＋ワードマーク）を 1 回描画。
rAF・粒子・長い最小表示なし。`requestHandoff()` で即 handoff。

## Service Worker / 配信

- `index.html`（シェル）変更を含む。現状 SW は**ネットワーク優先化済**（main `d83eeda`）のため、版番号を
  上げなくても更新は反映される見込み。実装時に**本番で実反映を curl/実機確認**し、必要なら `sw.js` の
  版番号を上げる（**共有ファイル＝並行セッションと直列**）。
- `js/ui/boot.js` / `js/lib/boot-fx.js` は新規 ESM。`index.html`／`main.js` から読み込む。

## 並行セッションとの協調

- 別セッションが `feed.js`／フィード論理（round-robin 均等化）を実装中。本作業は **boot 系（新規 2 ファイル）
  ＋ `index.html` の `#loading` 部 ＋ `orbis.css` の `.boot*` 部 ＋ `main.js` の 1 行** に限定し衝突面を最小化。
- 共有ファイル（`orbis.css`／`main.js`／`sw.js` 版）は統合時に直列で寄せる。boot は独立 append が中心。

## テスト戦略

### 純粋関数（node・ユニット）

- `bootFeeds(variant)`：variant ごとの feed 定義。
- `remainingHold(elapsedMs, minMs)` / `shouldHoldForMin(...)`：handoff ゲーティング。
- `progressFor(done, total)`：進捗（0..1、境界）。
- `clamp` / `smooth` / `ease`：数値域。
- `project(lat, lon, rot, tilt, R, cx, cy)`：正射影の既知点サニティ（前面 z>0、極/赤道の座標）。

### Playwright（構造のみ・headless では見た目を判定しない）

- ロード時：`#loading` 可視・`ORBIS` テキスト・`#fx` canvas 存在。
- map load 後（または規定タイムアウト後）：`#loading.hidden` が付く（handoff した）。
- reduced-motion エミュレーションでクラッシュしない。

> 注（mistakes.md）：globe/blur/モーションの見え方は headless≠実機。**最終の視覚判定はオーナーの実機**。
> e2e は配線/構造の回帰ガードに限定。

## パフォーマンス

- boot の rAF は handoff 後に停止＝定常状態のコスト増はゼロ。
- 星/粒子数は控えめ・devicePixelRatio は最大 2 にクランプ。

## スコープ外（YAGNI）

- 本物 globe と canvas globe の**厳密**な座標一致（近似で十分・フェードで吸収）。
- 進捗バーの各レイヤー fetch への 1:1 厳密連動（handoff は map ready に連動・点呼は representational）。
- WebGL での起動 globe（2D canvas で十分・依存とコストを増やさない）。

## 実機で詰める調整項目（決定後）

最小表示時間／テレメトリ密度・速度／globe サイズ・回転・傾き／大気ハロと配色の強度／粒子量。
`?boot` `?bootmin` と定数調整で実機比較しながら確定する。
