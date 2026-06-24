# ORBIS A-1 翻訳・地図連動ニュースレイヤー 設計

**日付**: 2026-06-18
**ステータス**: 設計確定（実装計画待ち）

## 目的（成功条件）

「いま世界で何が起きているか」の**重要ニュースを少数精選**し、**日本語訳＋要約＋カテゴリ**を付けて globe 上の発生地にピン表示する。クリックで現地へ flyTo し、日本語ポップアップで読める。既存のフィードにも流れる。

YouTube 埋め込みの日本語字幕が YouTube 側制約で不可だったため、**テキストを我々が完全に握れるニュース翻訳**で日本語化を確実に実現する。

## 全体方針

既存のスナップショット方式（Vercel 関数ゼロ・collector が `data/snapshots/*.json` を書き、静的配信、GitHub Actions cron）に **新 `news` レイヤー**として乗せる。船舶レイヤー同型の**キーゲート**（`ANTHROPIC_API_KEY` 未設定なら skip exit0）。

LLM コストを抑えるため**2段構え**：
- **段1（バッチ1回）**：取得した全候補見出しを Claude Haiku に1回投げ、世界的重要度でランキング → 上位30件を選定。
- **段2（上位のみ・URLキャッシュ）**：上位30件のうち**前回未処理のURLだけ** Haiku で `{日本語見出し, 1〜2文要約, カテゴリ, 緯度, 経度, 地名}` を JSON 取得。前回 `news.json` を URL→item のキャッシュとして再利用し、定常コストは新着分のみ。

## パラメータ（確定）

- 表示件数：**重要度上位30件**、**直近24時間**ローリング窓。
- 既定表示：**ON**（目玉機能）。GDELT 紛争/抗議（報道集中の面）とは役割が違うため**独立レイヤーとして併存**。
- モデル：`claude-haiku-4-5-20251001`（安価・大量翻訳向き。AIアプリだが本用途はコスト最優先で Haiku を選択）。
- ジオコード：Claude が緯度経度＋地名を返す。範囲 [-90,90]/[-180,180] を検証し、**座標を得られない記事はピン化せず除外**（v1）。

## カテゴリ（色分け）

固定8カテゴリ。ピンと凡例・フィードのバッジで共用。

| キー | 表示 | 色(RGB) |
|---|---|---|
| politics | 政治・外交 | [120,170,255] 青 |
| conflict | 紛争・安全保障 | [255,70,90] 赤 |
| disaster | 災害・事故 | [255,170,60] 橙 |
| economy | 経済・市場 | [80,220,160] 緑 |
| society | 社会 | [200,140,255] 紫 |
| science | 科学・技術 | [90,220,255] シアン |
| environment | 環境 | [150,220,90] 黄緑 |
| other | その他 | [180,190,205] 灰 |

Haiku には**このキー集合のいずれかを必ず選ばせる**（範囲外は other に丸める）。

## コンポーネントとファイル

### 1. `config/news_feeds.json`（非機密・新規）
厳選した世界ニュース RSS フィードの配列 `[{id, name, url}]`。候補（実装時に到達性を検証し、死んでいるものは除外。collector は1フィード失敗でも他を継続）：
- Al Jazeera English `https://www.aljazeera.com/xml/rss/all.xml`
- BBC World `https://feeds.bbci.co.uk/news/world/rss.xml`
- The Guardian World `https://www.theguardian.com/world/rss`
- DW (English) `https://rss.dw.com/rdf/rss-en-world`
- France24 (English) `https://www.france24.com/en/rss`
- NPR World `https://feeds.npr.org/1004/rss.xml`

### 2. `collectors/lib/rss.py`（純粋・新規・TDD）
- `parse_feed(xml_text, source) -> list[dict]`：RSS/Atom の `item`/`entry` から `{title, url, published_iso, source}` を抽出（標準ライブラリ `xml.etree`）。不正要素はスキップ。
- `dedup(articles) -> list[dict]`：正規化タイトル（小文字・記号除去）＋URL で重複排除。
- `recent(articles, now, hours=24) -> list[dict]`：published が直近 hours 内のもの。

### 3. `collectors/lib/news_enrich.py`（純粋・新規・TDD）
LLM 応答のパースとプロンプト組み立て、マージ/窓を**純粋関数**として分離（anthropic 呼び出し自体は `news.py` の薄いラッパで実施し、テストはモック）。
- `rank_prompt(articles) -> str`：見出し一覧→重要度ランキング依頼プロンプト（番号付き・上位IDをカンマ区切りで返させる）。
- `parse_rank(text, articles, top_n=30) -> list[dict]`：応答から上位 article を順序付きで取り出す（不正・欠番は無視、足りなければ recency 順で補完）。
- `enrich_prompt(article) -> str`：1記事→ `{title_ja, summary_ja, category, lat, lon, place}` を**JSONのみ**で返させるプロンプト。
- `parse_enrich(text) -> dict|None`：JSON 抽出（```json フェンス耐性）・必須キー検証・category をキー集合に丸め・lat/lon 範囲検証。座標不正は None。
- `merge_window(prev_items, new_items, now, hours=24, cap=30) -> list[dict]`：URL で重複排除し prev を再利用、直近 hours、重要度順（rank index）→ time 降順で cap 件。

### 4. `collectors/news.py`（キーゲート・新規）
quakes.py 同型の `main()`：
1. `ANTHROPIC_API_KEY` 未設定 → `print(skip)` して return 0（ships 同型）。
2. `config/news_feeds.json` 読み込み→各フィード fetch（失敗は継続）→ `parse_feed`→`dedup`→`recent`。
3. 段1：`rank_prompt`→Haiku 1回→`parse_rank`→上位30。
4. 前回 `news.json` を URL→item キャッシュ化。上位30のうち未キャッシュURLのみ段2：`enrich_prompt`→Haiku→`parse_enrich`。座標 None は除外。
5. `merge_window`→`news.json` 書き出し＋`update_manifest("news", now, len)`。失敗時は前回 snapshot 温存。

スナップショット形：`{updated, items:[{id,url,source,time,title_ja,summary_ja,category,lon,lat,place}]}`。

### 5. `js/layers/news.js`（新規）
- `newsLayer = { id:'news', label:'ニュース', legend:[…8カテゴリ], marker:'dot', fetch, toDeckLayer, tooltip, toFeedItems }`。
- `toDeckLayer(snapshot)`：`deck.ScatterplotLayer`（カテゴリ色の塗り＋白縁・pickable・半径固定 px）。globe 整合のため既存レイヤー同様 SolidPolygon 不要（点は ScatterplotLayer で可）。
- `tooltip(o)`：`[カテゴリ表示] 日本語見出し｜出典host`。
- クリック時のポップアップ（`selection.js`/`main.js` の既存 popup 機構を流用）：日本語見出し（太字）＋要約＋カテゴリバッジ＋出典host＋相対時刻＋元記事リンク（新規タブ）。
- `toFeedItems(snapshot)`：`{id, time, title:'[カテゴリ] 日本語見出し（host）', layerId:'news', lon, lat}`。
- `CATEGORY`（キー→{label,color}）を純粋にエクスポートし、凡例・色・バッジで共用。
- `registry.js` に登録（`DESCRIPTIONS.news` も追加）。

### 6. 配線
- `collect.yml`：`ANTHROPIC_API_KEY` を env に渡すキーゲート手順を追加（`|| echo "news skipped"`）。
- `requirements.txt`：`anthropic` 追加。
- 初回本番データはオーナーがローカル collector 実行（要 `ANTHROPIC_API_KEY`）で seed、または CI 手動起動。

## エラーハンドリング

- フィード個別失敗・LLM 応答不正・JSON 崩れは**その記事/フィードをスキップして継続**（全体は前回 snapshot 温存で堅牢）。
- LLM が座標を出せない/範囲外 → ピン化しない（v1 は地図必須）。
- キー未設定はサイレント skip（exit0）で CI を壊さない。

## テスト

- **pytest（純粋）**：`parse_feed`（RSS/Atom 両形）/`dedup`/`recent`/`parse_rank`（欠番・補完）/`parse_enrich`（JSONフェンス・category丸め・座標範囲）/`merge_window`（URL再利用・窓・cap・順序）。anthropic 呼び出しはモック。
- **node（純粋・JS）**：`CATEGORY` の整合、`toFeedItems`、`tooltip`、カテゴリ→色。
- **e2e（構造）**：ローカル seed snapshot で `news` レイヤー行表示・トグル・ピン描画（deck 層存在）・クリックで flyTo・ポップアップに日本語見出し。データが無い環境でも例外を出さないこと（ships/sst 同型）。

## スコープ外（YAGNI / 将来）

- 記事本文の全文翻訳（見出し＋要約に限定）。
- 重複ニュースのクラスタリング/トピックまとめ。
- 多言語 UI 切替・カテゴリのユーザーフィルタ（将来候補）。
- 画像サムネ。

## 非機密の確認

`news_feeds.json` は公開 RSS の URL のみ（非機密）。`ANTHROPIC_API_KEY` は GitHub Secret（コード・スナップショットに平文を含めない）。
