# ORBIS メディア領域 2ペイン化（ニュース｜地域カメラ監視）設計

- 日付: 2026-06-18
- 対象: ORBIS（`~/apps/orbis`）
- 種別: 既存 `#media`（単一プレーヤー＋カテゴリタブ）の 2ペイン再設計
- 前提 spec: `docs/superpowers/specs/2026-06-18-orbis-media-section-design.md`（スクロール大画面化・streams→media 改称・本番稼働済 main 0fe08d6 / sw v22）

## 背景

`#media` は現在「カテゴリタブ[ニュース|カメラ]＋単一大プレーヤー＋セレクタ」。オーナーの追加要望：
1. 動画を少し大きく、**左半分=ニュース／右半分=各地区カメラの画面分割**。
2. 右カメラは**上部タブで地域（すべて/中東/欧州/米/アジア/宇宙/アフリカ/オセアニア）と分割数（1/4/6）を選べる**。
3. **左右50/50・画面端まで埋めきる・各セクションに見出し・チャンネルは上部タブボタンで統一感**。

## 確定済みの設計判断（ユーザー承認）

1. **レイアウト = 左右50/50 フル幅2ペイン**。globe(100vh) の下、`#media` を `max-width` 撤廃しフル幅 flex 2カラム。狭幅画面は縦積みフォールバック。各ペイン見出し（「📺 ニュース」「📷 ライブカメラ」）。
2. **左ニュース = 独立**（現 5局 aljazeera/dw/france24/nhk/euronews を**上部タブボタン**で切替・単一プレーヤー）。地域タブには連動しない。
3. **右カメラ = 地域タブ × 分割モード × サムネ＋選択1再生**。
   - **地域タブ8種**：すべて/中東/ヨーロッパ/アメリカ/アジア/アフリカ/オセアニア/宇宙。**カメラが1件も無い地域タブは出さない**（空タブ禁止）。
   - **分割モード 1/4/6**：上部ボタンで切替。各枠にはその地域カメラの**静止サムネ画像**を並べ、**クリックした1枠だけ実 iframe 再生**（他はサムネのまま）。1画面モードは選択カメラを右ペイン全体に大きく再生。
4. **同時再生は最大2本**（左ニュース1＋右カメラ選択1）。サムネは画像で負荷なし。4〜5本同時より大幅に軽い。
5. **可視時のみ再生**：既存 `IntersectionObserver`（threshold 0.4）で `#media` 可視時に両ペイン再生、離れたら両方停止（src 空）。

## アーキテクチャ

### ファイル構成（3分割）

- `js/ui/media.js` — オーケストレーション。`renderMedia(rootEl, {news, cameras}, {onSelect})` が左右ペインをマウントし、可視制御 `setPlaying` を両ペインへ伝播。純粋ヘルパを集約。
- `js/ui/news-pane.js` — `renderNewsPane(paneEl, news, {onSelect})`：局タブ行＋単一プレーヤー。現 media.js のニュース挙動を移植。返り値 `{select(id), setPlaying(on), current()}`。
- `js/ui/cams-pane.js` — `renderCamsPane(paneEl, cams, {onSelect})`：地域タブ行＋分割モードボタン＋サムネグリッド＋選択1再生。返り値 `{selectArea(area), setMode(n), selectCam(id), setPlaying(on), current()}`。

**分離理由**：カメラ側は「地域フィルタ×分割×サムネ選択再生」とロジック量が多く、ニュース側（局切替のみ）と責務が明確に分かれる。1ファイル肥大化を避け、テスト・見通しを良くする。

### 純粋ヘルパ（`js/ui/media.js` に集約・両ペインが import）

- `buildEmbedUrl(item)` … 既存。`item.video_id` あれば `https://www.youtube.com/embed/<video_id>`、無ければ `https://www.youtube.com/embed/live_stream?channel=<channel_id>`。末尾 `?autoplay=1&mute=1&playsinline=1`（`?`有無で結合分岐）。
- `thumbUrl(item)` … `item.video_id` あれば `https://i.ytimg.com/vi/<video_id>/hqdefault.jpg`、無ければ `''`（プレースホルダ表示にフォールバック）。
- `defaultItem(items)` … 先頭 / 空・null は null（既存）。
- `itemById(items, id)` … 一致 or null（既存）。
- `areasPresent(cams)` … cams に実在する area コードを**定義順**で返し、先頭に `'all'` を付ける。例 `['all','europe','asia','americas','space']`。空 area は含めない。
- `camsByArea(cams, area)` … `area==='all'` なら全件、else `c.area===area` でフィルタ。
- `gridCount(mode)` … `mode∈{1,4,6}` をそのまま枠数で返す（不正値は 4 にフォールバック）。

### 地域コード（`area`）と表示順・ラベル

| area | ラベル | 備考 |
|---|---|---|
| `all` | すべて | 仮想・フィルタなし・常に先頭 |
| `middle_east` | 中東 | |
| `europe` | ヨーロッパ | |
| `americas` | アメリカ | 南北 |
| `asia` | アジア | |
| `africa` | アフリカ | |
| `oceania` | オセアニア | |
| `space` | 宇宙 | ISS Live・地球周回ライブ等（lat/lon は代表値・flyTo は無効化 or 赤道0,0） |

`AREA_ORDER`/`AREA_LABEL` を cams-pane.js に定数定義。`areasPresent` は `AREA_ORDER` 順で実在分のみ返す。

### 設定ファイル `config/live_cameras.json`

各カメラに **`area`（地域コード）** を追加。`region`（地名・表示用）は維持（media-now 右に「name｜region」表示）。スキーマ：
```json
{ "id": "shibuya", "name": "渋谷スクランブル交差点", "region": "東京", "area": "asia",
  "lat": 35.66, "lon": 139.70, "video_id": "8H3nRCFVR6Y" }
```
既存5カメラの area 割当：shibuya→asia / timessquare→americas / london→europe / paris→europe / venice→europe。
**実装 Task で各地域のカメラを収集・拡充**：地域あたり集まった分（最低2〜3枚目安・6分割を埋めるなら6枚理想）。YouTube ライブ検索→埋め込み再検証（`<video>` 構築可否）で **OK のものだけ採用**（DROP curate）。宇宙は ISS Live／地球周回ライブを充てる。中東/アフリカ/オセアニアは数が限られるため集まった分のみ（空なら出さない＝spec の空タブ禁止と整合）。

### マークアップ（`index.html`）

`#media` を 2ペインに再構成：
```html
<section id="media" class="media-section">
  <div id="media-news" class="media-pane">
    <div class="pane-head"><h3 class="pane-title">📺 ニュース</h3>
      <div class="news-tabs" id="news-tabs"></div></div>
    <div class="media-player"><iframe id="news-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
    <div class="pane-now news-now">—</div>
  </div>
  <div id="media-cams" class="media-pane">
    <div class="pane-head"><h3 class="pane-title">📷 ライブカメラ</h3>
      <div class="cams-controls">
        <div class="area-tabs" id="area-tabs"></div>
        <div class="mode-btns" id="mode-btns">
          <button class="mode-btn" data-mode="1">1</button>
          <button class="mode-btn active" data-mode="4">4</button>
          <button class="mode-btn" data-mode="6">6</button>
        </div>
      </div></div>
    <div class="cams-grid" id="cams-grid"></div>
    <div class="pane-now cams-now">—</div>
  </div>
</section>
```
`#media` は `#app` 直下・`#map-wrap` の兄弟（既存通り）。news-tabs/area-tabs は JS で生成。

### CSS（`css/orbis.css`）

- `.media-section`：`max-width` 撤廃 → フル幅。`display:flex; gap:16px; padding:24px 16px 40px;`。`@media (max-width:860px)` で `flex-direction:column`（縦積み）。
- `.media-pane`：`flex:1 1 0; min-width:0;`（左右50/50・端まで）。
- `.pane-head`：見出し＋タブ行を横並び・折返し可。`.pane-title` 見出しスタイル（既存 h4 調）。
- `.news-tabs`/`.area-tabs`：`.media-cat` 同様のピル型ボタン群（active=cyan）。`.mode-btn`：小さめ角丸ボタン（active=cyan）。
- `.media-player`：既存（16:9・黒・グロー）。news-frame に適用。
- `.cams-grid`：`display:grid; gap:8px; aspect-ratio` はモードで可変。
  - mode1 → `grid-template-columns:1fr;`（1枠・16:9）
  - mode4 → `grid-template-columns:1fr 1fr;`（2×2）
  - mode6 → `grid-template-columns:1fr 1fr;`（2行3列…実際は 2列×3行 or 3列×2行）→ **3列2行 `repeat(3,1fr)`** に統一（横3×縦2）。mode4 は `repeat(2,1fr)`。クラス `.cols-1/.cols-2/.cols-3` をグリッドに付与。
- `.cam-cell`：`position:relative; aspect-ratio:16/9; border-radius:8px; overflow:hidden; background:#000; border:1px solid var(--line); cursor:pointer;`。
- `.cam-cell.active`：cyan ボーダー＋グロー。`.cam-cell img`（サムネ）：`width/height:100%; object-fit:cover;`。`.cam-cell iframe`：絶対配置充填。`.cam-cell .cam-label`：下部に半透明帯でカメラ名。空枠 `.cam-cell.empty`：淡いプレースホルダ（「—」）。
- `.pane-now`：既存 media-now 調（地名表示）。

### 配線（`js/main.js`）

- import は `renderMedia`（`./ui/media.js`）のまま。`renderMedia` 内部で news-pane/cams-pane を呼ぶ。
- 既存マウントブロックはほぼ不変：2 config を Promise.all で読み、`renderMedia(mediaRoot, {news, cameras}, {onSelect})`。
- `onSelect(item)`：両ペイン共通。`map.flyTo({center:[item.lon,item.lat],zoom:4,...})` ＋ `selected={lon,lat,title:item.name,layerId:'media',at}` ＋ `drawAll(overlay)`。**space カメラは flyTo 無効**（`item.area==='space'` なら flyTo/マーカーをスキップ）。
- IntersectionObserver は既存通り `mediaApi.setPlaying(isIntersecting)`。`renderMedia` の `setPlaying` が news/cams 両ペインへ伝播。
- `window.__orbis.media = mediaApi`（e2e）。

### sw.js

`CACHE` を v22 → **v23**（index.html/css/main.js は SHELL キャッシュ対象）。

## データフロー

1. ロード → globe が最初の1画面。`#media` は下・src 空（再生なし）。
2. 下スクロール → `#media` 可視 → `setPlaying(true)` → 左=news 先頭局再生、右=現 area の先頭カメラ再生（選択枠）。
3. 左 局タブ → news プレーヤー差替＋flyTo（本拠地）。
4. 右 地域タブ → グリッドがその地域カメラに→先頭カメラを選択再生＋flyTo（撮影地・space除く）。
5. 右 分割ボタン[1/4/6] → グリッド枠数変更（選択カメラは枠内に残れば維持・無ければ先頭）。
6. 右 サムネクリック → その枠を再生（iframe 差替）＋flyTo。
7. 上スクロール → `#media` 不可視 → 両ペイン停止（src 空）。

## エラー処理・エッジケース

- 片方の config fetch 失敗 → 取得できたペインのみ表示（両方失敗で `#media` 非表示）。news 空ならニュースペイン非表示、cameras 空ならカメラペイン非表示（残った側がフル幅）。
- 分割枠数 > 地域カメラ数 → 余り枠は `.cam-cell.empty` プレースホルダ。
- video_id も channel_id も無いカメラ → サムネは空プレースホルダ・選択時は再生スキップ。
- space カメラ：flyTo/マーカー無効（宇宙に地上座標が無いため）。media-now は「name｜region」表示（region に「宇宙」等）。
- MapLibre：`#map-wrap` は 100vh 固定でスクロールしてもサイズ不変（map.resize 不要）。

## テスト

- **node**（`tests/media.test.js` 拡充）:
  - `buildEmbedUrl`：video_id 形式／channel_id 形式（既存）。
  - `thumbUrl`：video_id → `i.ytimg.com/vi/<id>/hqdefault.jpg`／video_id 無し → `''`。
  - `areasPresent`：実在 area を定義順＋先頭 all／空 area は除外。
  - `camsByArea`：all=全件／指定 area=フィルタ／不一致=空。
  - `gridCount`：1→1／4→4／6→6／不正→4。
  - `defaultItem`/`itemById`（既存）。
- **Playwright（構造のみ・`tests/e2e/media.spec.js` 更新）**:
  - `#media-news` と `#media-cams` の2ペイン存在。
  - 局タブ件数 = news 件数。局タブクリックで `#news-frame` src がその局 channel に。
  - 地域タブが areasPresent 件数。地域タブクリックでグリッドのカメラ集合が変わる。
  - 分割ボタン[1/4/6]クリックで `.cam-cell` 件数（=枠数 or カメラ数の少ない方＋空枠）が変わる。
  - サムネ(`.cam-cell`)クリックでそのセルが iframe 化し src がそのカメラ video_id に。
  - 可視化→news/選択cam の src がセット、`window.scrollTo(0,0)` で両 src 空。
  - flyTo：ニュース局クリック / 地上カメラクリックで `map.getCenter()` 変化。space カメラは flyTo しない（中心不変）をアサート（space カメラがあれば）。
  - **再生（currentTime進行）はアサートしない**（headless コーデック制約 [[youtube-embed-headless-no-playback]]）。
- **オーナー実ブラウザ**：左ニュース大画面再生・右地域タブ切替・分割[1/4/6]・サムネ選択で1枠再生・flyTo・上スクロールで停止。

## 進め方

branch `media-dual-pane` → subagent駆動（実装sonnet/spec haiku/品質sonnet/最終opus）→ main統合 → push →
構造Playwright・再生は実ブラウザ。コミットメール noreply 必須。**カメラ収集 Task は埋め込み再検証で DROP curate**。

## YAGNI（やらないこと）

- 4枠以上の同時再生（サムネ＋選択1再生に限定）。
- 左ニュースの地域連動（独立）。
- YouTube Data API/キー（埋め込み・サムネとも不要）。
- 地域内カメラ数 > 枠数のときのページング（先頭N枚のみ・地域で絞る前提）。
- サブプロジェクトA（翻訳・地図連動ニュース）要素（別サイクル）。

## 次サイクル（参考）

サブA「翻訳・地図連動ニュース」: 無料RSS → Claude Haiku 日本語訳＋緯度経度 → collect cron snapshot → フィード＋地図ピン flyTo（`ANTHROPIC_API_KEY` GitHub Secret）。本メディア領域にニュース記事カテゴリとして将来統合も可。
