# ORBIS YouTube Live 下部グリッド 設計（P3 サブプロジェクトB）

- 日付: 2026-06-18
- 対象: ORBIS（`~/apps/orbis`）
- 種別: 新UI領域追加（下部の世界ニュース・ライブ配信バー）

## 背景・位置づけ

P3「ニュース」は2つの独立サブシステムに分解した。本書は**B（YouTube Live 下部グリッド）**の設計。
A（翻訳・地図連動ニュース＝RSS→Claude翻訳→snapshot→地図ピン）は別サイクルで後続。Bを先行する
（キー/cron/コスト不要・低リスク・「動くライブ映像」が即出る）。

## 目的

世界の24時間ニュースのライブ配信を ORBIS 下部に常設し、1画面で再生しながらチャンネルを切替えられる
ようにする。チャンネル選択時はその本拠地へ地球儀が flyTo し、コマンドセンターの地理的文脈を保つ。

## 確定済みの設計判断（ユーザー承認）

1. **1画面再生＋チャンネル選択**：常に同時再生は1つ（性能安全）。大きめの単一プレーヤー＋横並びタブ。
2. **チャンネル選択で本拠地へ flyTo**（地図連動）。
3. **既定は折りたたみ**。ヘッダの「🔴 LIVE」トグルで開く→開いた瞬間に選択中チャンネルが再生。
4. **設定駆動**（`config/live_channels.json`・非機密・ブラウザfetch）。コード変更なしで増減・並べ替え可。
5. キー不要の埋め込み（`youtube.com/embed/live_stream?channel=<id>`）。

## 重要な前提（実機検証で判明・2026-06-18）

- `embed/live_stream?channel=<CHANNEL_ID>` は **プレーヤー（video要素）まではロードされる**（HTTP 200）。
- **playwright 同梱の headless Chromium は YouTube の必須コーデック（H.264等）/Widevine を持たず、
  通常動画も含め再生（decode）できない**（実測: 通常動画も `currentTime` が進まない）。
  → **自動テストで確認できるのは「プレーヤー構築・チャンネル切替・flyTo」まで。実際の映像再生は
  オーナーの実ブラウザ（Chrome/Edge）でのサニティ確認**とする（船舶のキー設定と同じ構図）。
- よって CI/Playwright では**再生をアサートしない**。構造（iframe src・タブ・flyTo）のみ検証する。

## アーキテクチャ

既存の `#panel`（左）・`#feed`（右）と同様、`#map-wrap` 内に絶対配置の**下部バー `#streams`** を追加。

### コンポーネント / ファイル

- **`index.html`**: `#map-wrap` 内（`#loading` の前）に下部バー markup を追加。
  ```html
  <div id="streams" class="stream-bar collapsed">
    <div class="stream-head">
      <button id="streams-toggle" class="collapse-btn" aria-label="ライブ折りたたみ">🔴 LIVE</button>
      <span class="stream-now">—</span>
    </div>
    <div class="stream-body">
      <div class="stream-player"><iframe id="stream-frame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
      <div id="stream-tabs" class="stream-tabs"></div>
    </div>
  </div>
  ```
- **`config/live_channels.json`**: チャンネル配列。各要素
  `{ "id": "<slug>", "name": "<表示名>", "channel_id": "<YouTubeチャンネルID>", "region": "<本拠地・和文>", "lat": <num>, "lon": <num> }`。
- **`js/ui/streams.js`**: 純粋ヘルパ＋描画。
  - 純粋: `buildEmbedUrl(channel)` / `defaultChannel(channels)` / `channelById(channels, id)`。
  - 描画: `renderStreams(rootEl, channels, { onSelect })` → タブ行＋プレーヤーを構築し、
    `{ select(id) }` を返す。タブクリックで iframe src を差替え＋activeタブ強調＋`onSelect(channel)` 呼び出し。
  - 折りたたみ: `wireStreamsCollapse(barEl, btnEl, getState)` →
    開く時に現在選択の src をセット（再生開始）、**閉じる時に iframe src を空にして再生停止**（隠れた所での再生回避）。
- **`js/main.js`**: `config/live_channels.json` を fetch → `renderStreams` をマウント。
  `onSelect(ch)` で `map.flyTo({ center:[ch.lon, ch.lat], zoom:4, duration:1500, essential:true })`（既存flyTo流用）。
  既定は折りたたみ・初期選択は `defaultChannel`（先頭）。
- **`css/orbis.css`**: グラス調の下部バー。`collapsed` 時はヘッダ高のみ。展開時はプレーヤー（16:9）＋タブ行。activeタブ強調。
- **`sw.js`**: `CACHE` を現行（v20）→ **v21**（index.html / css/orbis.css / js/main.js はすべて SHELL キャッシュ対象）。

### 埋め込みURL

`buildEmbedUrl(channel)` = `https://www.youtube.com/embed/live_stream?channel=${channel.channel_id}&autoplay=1&mute=1&playsinline=1`
（キー不要・autoplay はミュート必須・iOS向け playsinline）。

### データフロー

1. ページロード → `#streams` は折りたたみ・iframe src 空（再生なし＝初期負荷ゼロ）。
2. ユーザーが「🔴 LIVE」を開く → 選択中（既定=先頭）チャンネルの埋め込みURLを iframe にセット→再生開始＋本拠地へflyTo。
3. タブ切替 → iframe src を差替え（前の再生は停止）＋flyTo。
4. 折りたたむ → iframe src を空に（再生停止）。

## 初期チャンネル（キュレート案）

実装 Task 1 で各 `channel_id` が**プレーヤーをロードできるか**を Playwright で検証し、ロード不可は除外する。

| id | name | region | lat, lon |
|---|---|---|---|
| aljazeera | Al Jazeera English | ドーハ | 25.28, 51.53 |
| dw | DW News | ベルリン | 52.52, 13.40 |
| france24 | France 24 English | パリ | 48.86, 2.35 |
| skynews | Sky News | ロンドン | 51.51, -0.13 |
| nhk | NHK World-Japan | 東京 | 35.68, 139.69 |
| bloomberg | Bloomberg Television | ニューヨーク | 40.71, -74.01 |
| euronews | euronews | リヨン | 45.76, 4.84 |

（AJ/DW/France24 は本ブレストでプレーヤーのロードを実測済。他は実装時に検証。最終的に確実にロードできるものへ絞る。）

## エラー処理・エッジケース

- `config/live_channels.json` の fetch 失敗 → バー自体を出さない（`#streams` 非表示）か、空タブで安全に無効化（クラッシュしない）。
- 配列が空 → バー非表示。
- 無効/再生不可チャンネル → プレーヤーは「再生できません」表示になるが他チャンネルへ切替可能（致命的でない）。
- 折りたたみ中は src 空＝バックグラウンド再生・帯域消費なし。

## テスト

- **node**（`tests/streams.test.js`）:
  - `buildEmbedUrl`：channel_id を埋め込み、`autoplay=1&mute=1` を含む正URL。
  - `defaultChannel`：先頭を返す／空配列は null。
  - `channelById`：一致を返す／不一致は undefined/null。
- **Playwright（構造のみ）**：
  - `#streams` が存在し既定で `collapsed`。
  - トグルで展開し、`#stream-tabs` のタブ数 = config件数。
  - タブクリックで `#stream-frame` の src が該当チャンネルの埋め込みURL（`channel=<id>` を含む）になる。
  - タブクリックで地図中心が本拠地付近へ移動（flyTo・`map.getCenter()` 変化）。
  - **再生（video の currentTime 進行）はアサートしない**（headless Chromium のコーデック制約）。
- **オーナー実ブラウザ**：展開で映像が実際に流れる・タブ切替で配信が変わる・flyTo の体感を最終確認。

## 進め方

branch `youtube-live` → spec（本書）→ plan → subagent駆動（実装sonnet / レビューhaiku二段 / 最終opus）→
main統合 → push → 構造はPlaywright・再生はオーナー実ブラウザ確認。コミットメール noreply 必須。

## YAGNI（やらないこと）

- YouTube Data API / キー（埋め込みは key 不要）。
- 複数同時再生・ビデオウォール（性能優先で1画面）。
- ライブ動画IDの動的解決（`live_stream?channel=` で十分・不可なら config で個別URL指定に切替可）。
- サブプロジェクトA（翻訳・地図連動ニュース）の要素（別サイクル）。
- 視聴履歴・お気に入り・音量UI 等の付加機能。

## 次サイクル（参考）

サブプロジェクトA「翻訳・地図連動ニュース」: 無料RSS → Claude Haiku で日本語訳＋主要地点の緯度経度抽出
→ collect cron で snapshot 化 → フィード＋地図ピンで flyTo（`ANTHROPIC_API_KEY` を GitHub Secret に・cronコスト設計）。
