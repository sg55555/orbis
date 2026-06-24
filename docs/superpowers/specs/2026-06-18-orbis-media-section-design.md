# ORBIS メディア領域刷新（スクロール大画面＋ニュース/カメラ）設計

- 日付: 2026-06-18
- 対象: ORBIS（`~/apps/orbis`）
- 種別: レイアウト刷新 ＋ 既存 YouTube Live バーの再構成 ＋ 街角カメラ追加

## 背景

YouTube Live を下部の小窓オーバーレイバー（`#streams`）として実装済（2026-06-18, sub-project B）。
ユーザーフィードバック：①小窓ではなく**スクロールで降りると大々的に**見たい ②世界の**首都/街角カメラ**も見たい。
本書はこの2点に応える「メディア領域」への刷新を設計する（既存の `#streams` 小窓は廃止し置換）。

## 確定済みの設計判断（ユーザー承認）

1. **ページをスクロール可能に**：地球儀（globe）を最初の1画面（100vh）とし、その下に新セクション `#media` を置く。
2. **メディア領域 = 大画面＋セレクタ＋カテゴリタブ**：上部に [📺ニュース][📷カメラ] タブ、中央に大きな 16:9 プレーヤー1つ、下に現在カテゴリのセレクタ行。同時再生は常に1つ（性能安全）。
3. **カメラ源 = YouTube街角ライブを流用**：ニュースと同じキー不要埋め込み。`channel_id`（チャンネルlive）と `video_id`（固定ライブ動画）の両対応（カメラは video_id 形式が多い・実機で構築を確認済 2026-06-18）。
4. **選択で地図連動**：選択ソースの本拠地へ `map.flyTo` ＋ 既存リティクルでマーカー表示。自動スクロールはしない。
5. **再生制御**：`IntersectionObserver` で `#media` が画面に入ったら現在ソースを再生、離れたら停止（src を空に）。

## アーキテクチャ

### レイアウト restructure（`index.html` / `css/orbis.css`）

現状: `html,body{height:100%;overflow:hidden}` / `#app{height:100vh;flex-direction:column}` / `#map-wrap{flex:1}`（スクロール不可）。

変更:
- `body` のスクロール解禁（`overflow-x:hidden; overflow-y:auto`、`height:auto`）。`#app` を `height:auto`。
- `#map-wrap` を `height:100vh; flex:none`（地球儀＝最初の1画面・MapLibre は従来通り絶対配置で充填）。
- `#map-wrap` の直後（`#app` 内）に `#media` セクションを追加。
- `#streams` オーバーレイバーの markup と `.stream-*` CSS は**削除**。
- 左パネル/右フィード/loading は従来どおり `#map-wrap` 内の絶対配置（地球儀セクションに固定・スクロールで上に流れる）。

### メディア領域 `#media`（markup）

```html
<section id="media" class="media-section">
  <div class="media-head">
    <div class="media-cats">
      <button class="media-cat active" data-cat="news">📺 ニュース</button>
      <button class="media-cat" data-cat="cameras">📷 カメラ</button>
    </div>
    <span class="media-now">—</span>
  </div>
  <div class="media-player"><iframe id="media-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
  <div id="media-selector" class="media-selector"></div>
</section>
```
（`<iframe>` は初期 src 無し。IntersectionObserver と選択で制御。）

### モジュール `js/ui/media.js`（`js/ui/streams.js` を改称・刷新）

責務が「ライブ配信バー」→「メディア領域（ニュース＋カメラ）」に広がるため改称する。

- 純粋ヘルパ:
  - `buildEmbedUrl(item)` … `item.video_id` があれば `https://www.youtube.com/embed/<video_id>`、
    無ければ `https://www.youtube.com/embed/live_stream?channel=<channel_id>`。末尾に `?autoplay=1&mute=1&playsinline=1`（既に `?` を含むので結合は条件分岐）。
  - `defaultItem(items)` … 先頭、空/非配列は null。
  - `itemById(items, id)` … 一致 or null。
- 描画 `renderMedia(rootEl, { news, cameras }, { onSelect })`:
  - カテゴリタブ（`.media-cat`）クリックで活性カテゴリを切替→セレクタ行を再描画（そのカテゴリの items）。
  - セレクタ項目クリックで `select(category, id)`：現在ソースを更新・活性強調・`media-now` 更新・`onSelect(item)`（flyTo）・**`#media` が可視なら** `#media-frame` src をセット。
  - 返り値 API `{ selectCategory(cat), select(cat,id), setPlaying(on), current() }`。
    - `setPlaying(on)`: on→現在ソースの src をセット（再生）、off→src を空（停止）。IntersectionObserver から呼ぶ。
- 既定: カテゴリ=news、ソース=news の先頭。初期 src は空（可視になるまで再生しない）。

### 配線 `js/main.js`

- import を `./ui/streams.js` → `./ui/media.js`（`renderMedia`）。
- `map.on('load')` 内で `config/live_channels.json` と `config/live_cameras.json` を並行 fetch。
- `renderMedia(document.getElementById('media'), { news, cameras }, { onSelect: (item) => { flyTo＋selected リティクル } })`。
  - onSelect: `map.flyTo({ center:[item.lon,item.lat], zoom:4, duration:1500, essential:true })`；
    `selected = { lon:item.lon, lat:item.lat, title:item.name, layerId:'media', at:performance.now() }`；
    `window.__orbis.selected = selected`；`drawAll(overlay)` でリティクル表示（既存 `buildReticleConfigs` が `selected` を描く）。
- `IntersectionObserver`（threshold 0.4）で `#media` の可視/不可視に応じて `mediaApi.setPlaying(true/false)`。
- fetch 失敗/両方空 → `#media` を `display:none`。
- `window.__orbis.media = mediaApi`（e2e/デバッグ）。

### CSS（`css/orbis.css`）

`#media` の大画面スタイル（最大幅 960px 中央寄せ・グラス・大きな 16:9 プレーヤー・カテゴリタブ・セレクタ行の横スクロール）。`.media-cat.active`/`.media-item.active` は cyan 強調。globe セクションとの境界に余白/区切り。

### 設定ファイル

- `config/live_channels.json`（既存・ニュース 5ch: aljazeera/dw/france24/nhk/euronews）。スキーマ流用。
- `config/live_cameras.json`（新規・街角カメラ）。各 `{ id, name, region, lat, lon, video_id?|channel_id? }`。
  実装 Task で候補を埋め込みロード検証→DROP curate。確実に出るものを採用。

### sw.js

`CACHE` を v21 → **v22**（index.html / css / main.js は SHELL キャッシュ対象）。

## 重要な前提（再掲）

playwright 同梱の headless Chromium は YouTube の必須コーデックを持たず**映像を再生(decode)できない**
（[[youtube-embed-headless-no-playback]]）。自動テストは構造（セクション描画・タブ切替・src・flyTo・可視時src設定）のみ。
**実際の再生はオーナーの実ブラウザサニティ**。

## データフロー

1. ページロード → globe が最初の1画面。`#media` は下にあり src 空（再生なし）。
2. 下にスクロール → `#media` が可視 → IntersectionObserver が `setPlaying(true)` → 既定ソース（news先頭）再生。
3. カテゴリタブ [カメラ] → セレクタが cameras 一覧に → 項目選択で大プレーヤー差替＋flyTo＋マーカー。
4. 上にスクロールで globe に戻る → `#media` 不可視 → `setPlaying(false)`（src 空・停止）。

## エラー処理・エッジケース

- 片方の config fetch 失敗 → 取得できたカテゴリのみ表示（両方失敗で `#media` 非表示）。空配列カテゴリはタブを出さない/無効化。
- video_id も channel_id も無い項目 → スキップ（buildEmbedUrl は channel_id 経路にフォールバックするが、両方無しは select 時に無視）。
- 再生不可ソース → プレーヤーが「再生できません」表示・他ソースへ切替可（致命的でない）。
- MapLibre: `#map-wrap` は 100vh 固定なのでスクロールでサイズ変化なし（map.resize 不要）。

## テスト

- **node**（`tests/media.test.js`）:
  - `buildEmbedUrl`：`{video_id:'X'}` → `embed/X?...`；`{channel_id:'Y'}` → `embed/live_stream?channel=Y&...`；両者に `autoplay=1&mute=1` を含む。
  - `defaultItem`：先頭／空・null は null。
  - `itemById`：一致／不一致 null。
- **Playwright（構造のみ・`tests/e2e/media.spec.js`）**:
  - `#media` セクションが存在。
  - カテゴリタブ [カメラ] クリックで `#media-selector .media-item` が cameras 件数に変わる（news と別集合）。
  - 項目クリックで `#media-frame` src がそのソースの埋め込み（channel= か /video_id）になる。
  - 項目クリックで `window.__orbis.map.getCenter()` が flyTo で変化。
  - `#media` を `scrollIntoView` で可視化→src セット、`window.scrollTo(0,0)` で不可視→src 空（IntersectionObserver）。
  - 再生（currentTime 進行）はアサートしない。
- **オーナー実ブラウザ**：スクロールで大画面再生・タブ切替・flyTo・上で停止を最終確認。

## 進め方

branch `media-section` → spec → plan → subagent駆動（実装sonnet/レビューhaiku/最終opus）→ main統合 → push →
構造Playwright・再生は実ブラウザ。コミットメール noreply 必須。

## YAGNI（やらないこと）

- 複数同時再生・ビデオウォール（1画面）。
- YouTube Data API/キー（埋め込みは不要）。
- 自動スクロール連動（flyTo のみ・スクロールはユーザー操作）。
- カメラの地図ピン常設レイヤー化（選択時の一時マーカーのみ）。
- サブプロジェクトA（翻訳・地図連動ニュース）の要素（別サイクル）。

## 次サイクル（参考）

サブA「翻訳・地図連動ニュース」: 無料RSS → Claude Haiku 日本語訳＋主要地点の緯度経度 → collect cron snapshot →
フィード＋地図ピン flyTo（`ANTHROPIC_API_KEY` GitHub Secret・cronコスト設計）。本メディア領域にニュース記事カテゴリとして将来統合も可。
