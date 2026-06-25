# Orbis 地域プロフィール・ドリルダウン（Phase2.5）設計

> 2026-06-24 brainstorming 確定。Phase2（国ドリルダウン本格版・本番LIVE main 6ac9990）を土台に、
> ドリルダウンの**中身**を「イベント集計（紛争/抗議/地震カウント）」から**地域プロフィール**
> （気候・特産・産業・交通・地理・観光）へ置き換える。太田さん実機フィードバック起点。

## 1. 背景・目的

Phase2 ドリルダウンは国クリック→admin1 別のイベント集計（instability スコア＋紛争/抗議/地震の件数ランキング）を表示する。太田さんの実機フィードバック：
- 「紛争の状況とかは必ずしも表示してほしいわけではなく、その都市自体の特徴（気候・特産・産業・交通などの地理的特徴・観光名所）が表示されればいい」
- 「ただドリルダウンするというより**個別ページ風（フロートページでもよい）**」

→ ドリルダウンを「いま何が起きているか（イベント）」中心から「**この地域はどういう所か（プロフィール）**」中心へ転換する。

## 2. スコープ（確定事項）

| 項目 | 決定 |
|------|------|
| データ源 | **ハイブリッド**＝Wikipedia(ja)/Wikidata で事実を取得 → Claude で日本語プロフィールに整形 |
| 整形モデル | **Claude Sonnet 4.6**（`LT_LLM_MODEL` 同様に切替可能にする）。grounding 済で事実精度はモデル非依存、差は日本語の自然さ |
| 粒度 | **全レベル**＝国(246)＋県/州 admin1(約4,575)＋都市(約6,775) ≒ **11,600 プロフィール** |
| 生成方式 | **build 時オフライン生成→静的 JSON 配信**（Orbis の collector パターン準拠・ランタイム LLM 無し・クリック毎コスト無し） |
| 構成 | **全レベルがプロフィール中心**。イベント（近隣の最近の動向）は**下部に折りたたみで小さく任意表示** |
| UI | **ページ風フロートパネル**＝Phase2 の #drilldown パネル基盤を流用してリッチ化 |

### 非対象（YAGNI）
- ランタイム LLM / サーバ関数（Orbis に api/ は無い・Hobby プラン関数上限）。
- 共有可能なルート(#/place/...)ページ＝将来拡張（permalink 統合は別途）。
- イベントソースの更なる精査（別タスクで item2=GDELT 単一ソース除外を本番反映済 80eccdd）。
- name:ja の Wikidata/GeoNames 補完（Phase2 で NE name_ja が admin1 99%/cities 100% と判明・不要）。

## 3. 地域 → Wikidata 紐付け（実現性確認済）

NE データの wikidataid カバレッジ（Phase2 で取得済の `scripts/.cache/ne/`）：
- 国 admin0 `WIKIDATAID` **100%**（242/242）
- admin1 `wikidataid` **94%**（4,332/4,596・キー a1code）
- 都市 places `WIKIDATAID` **97%**（7,192/7,342）

→ 各地域を **Wikidata QID** に一意解決できる。欠落分（3–6%）は (a) 地域名で Wikipedia(ja) 検索フォールバック、(b) それも無ければ **degraded プロフィール**（基本事実のみ＋出典リンク）。

**プロフィールのキー**（client が地域を識別する ID と一致させる）：
- 国＝FIPS（既存 client 識別子）。`profiles/country/<FIPS>.json`
- admin1＝a1code（admin1 feature の識別子）。`profiles/admin1/<a1code>.json`
- 都市＝Wikidata QID。`profiles/city/<QID>.json`。**build_cities.py を拡張**し各都市レコードに `qid`（NE WIKIDATAID 由来）を追加して client が profile を引けるようにする。QID 欠落都市は profile 無し（client は degraded 表示）。

## 4. データパイプライン（build 時・オフライン）

新規 I/O スクリプト `scripts/build_profiles.py` ＋ 純関数 `scripts/lib/profile_prep.py`（標準 lib のみ・pytest 対象）。

### 4.1 フロー（地域ごと）
1. **QID 解決**：NE キャッシュ（admin0/admin1/places）から地域→QID。欠落は名前で Wikipedia(ja) opensearch。
2. **grounding 取得**（キャッシュ越しに 1 回だけ）：
   - Wikidata claims：`P1082`(人口)・`P2046`(面積)・`P625`(座標)・`P2044`(標高) ほか取得可能な範囲。
   - 日本語 Wikipedia：QID の ja サイトリンク→REST `/api/rest_v1/page/summary/{title}`（要約＋サムネ可）。
3. **整形（Claude Sonnet 4.6）**：取得した Wikipedia 要約＋Wikidata 事実**のみ**を根拠に、日本語プロフィール（後述セクション）を JSON で生成。プロンプトに「事実に無いことは書かない・不明セクションは省略・断定を避ける」を明記（幻覚抑制）。
4. **出力**：`data/static/profiles/{country,admin1,city}/<id>.json.gz`（admin1/city は gz、country は素 JSON でも可）。

### 4.2 キャッシュ・再現性（NE name_ja キャッシュと同型）
- `scripts/.cache/profiles/wikidata_<QID>.json`・`wikipedia_<QID>.json`・`generated_<QID>.json` に raw と生成結果を保存。
- 再実行は**キャッシュ済をスキップ**＝増分生成・ネット/LLM 非依存で再ビルド可能・生成物はコミット。
- 失敗（取得不可/LLM エラー）は握りつぶし degraded で記録、build を止めない。

### 4.3 出力 manifest
`data/static/profiles_manifest.json`：
```
{ "country": {"<FIPS>": {"bytes": int, "degraded": bool}, ...},
  "admin1":  {"<a1code>": {...}, ...},
  "city":    {"<QID>": {...}, ...} }
```
client は fetch 前に存在/degraded を判定（404 回避・Phase2 manifest と同方針）。

## 5. プロフィール schema

```
{
  "id": "<FIPS|a1code|QID>",
  "level": "country" | "admin1" | "city",
  "name_ja": "東京都",
  "facts": { "population": 13960000, "area_km2": 2194, "lat": 35.6, "lon": 139.7, "elevation_m": null },
  "sections": [
    { "title": "概要",        "body": "…" },
    { "title": "気候",        "body": "…" },
    { "title": "特産・名物",  "body": "…" },
    { "title": "主要産業",    "body": "…" },
    { "title": "交通・地理",  "body": "…" },
    { "title": "観光名所",    "body": "…" }
  ],
  "source": { "wikipedia_url": "https://ja.wikipedia.org/wiki/…", "qid": "Q1490" },
  "degraded": false
}
```
- セクションは「内容のあるものだけ」。整形側で空セクションは省略（degraded 時は facts＋出典のみ）。
- `facts` は Wikidata 由来（取得できた範囲・欠落は null）。

## 6. UI（ページ風フロートパネル）

Phase2 `js/ui/drilldown.js` / `js/lib/drilldown/drilldown_view.js` を拡張し、プロフィール描画を追加（新規 `js/lib/drilldown/profile_view.js` 純関数 ＝ schema→HTML、escapeHtml で安全）。

- **ヘッダ（hero）**：地域名(name_ja)＋種別バッジ（国/県/都市）＋キー事実（人口・面積・位置）。
- **本文**：セクションを縦スクロールのカードで（概要→気候→特産→産業→交通地理→観光）。
- **フッタ**：「近隣の最近の動向」＝Phase2 のイベント集計（buildDrilldown / aggregate_admin1）を流用、**既定折りたたみ・小さく**。＋出典（Wikipedia リンク）。
- **ナビゲーション**：国→県→都市をパネル内で遷移＋**パンくず**（例「日本 › 東京都 › 新宿区」・各段クリックで戻る）。開く際 flyTo（Phase2 bbox/bboxCenter）。
- **モバイル**：Phase2 同様 bottom-sheet。
- ウォッチリスト維持。

### 地域解決（クリック→プロフィール）
- 国＝Phase2 の country_click（country_bounds PIP）。
- 県＝admin1 ポリゴン PIP（Phase2 admin1 データ）→ a1code。
- 都市＝最寄り都市（Phase2 cities ＋ nearest.js）→ qid。
- 解決後、profiles_manifest で profile 有無を確認→ fetch→ profile_view 描画。

## 7. テスト戦略

- **pytest**（`profile_prep.py`）：QID 解決（NE 由来/名前フォールバック/欠落→None）・Wikidata claims 抽出・整形プロンプト用入力の組み立て・degraded 判定・schema 整形（空セクション省略）。LLM 呼び出しはスタブ注入。
- **node**（`profile_view.js` ほか）：schema→HTML（全セクション/一部欠落/degraded）・イベントフッタ折りたたみ・パンくず・XSS エスケープ・存在しない profile の degraded 描画。
- **生成データ健全性**：代表地域（日本）で coverage・degraded 率・サイズ・name_ja 日本語率・出典 URL 妥当性を実測。

## 8. フェーズ分け（大規模＝段階検証）

- **2.5a パイプライン基盤＋日本サブセット**：`profile_prep.py`＋`build_profiles.py`＋キャッシュ＋schema を実装し、**日本（FIPS=JA：国＋47都道府県＋JA都市約69）だけ生成**。品質（事実性/日本語）・1 件あたりコスト・カバレッジ・サイズを実測し、全生成前に方針確定。日本分はコミット。
- **2.5b UI**：`profile_view.js`＋drilldown 配線＋パンくず＋イベントフッタ折りたたみを実装。日本サブセットデータで実機サニティ（太田さん）。
- **2.5c 全生成＋統合＋本番**：残り全地域（約11,600）を生成（2.5a の単価×件数の最終コストを提示してから実行）→ data コミット → main 統合 → push → Vercel → 実機確認 → 記憶昇格。

## 9. リスク・留意

- **生成コスト**：約11,600×Sonnet 4.6。2.5a で単価実測→2.5c 着手前に総額を提示・承認。`LT_LLM_MODEL` 相当の切替で Haiku 退避可。
- **幻覚**：grounding（Wikipedia/Wikidata の取得事実のみ根拠）＋「事実に無いことは書かない」プロンプトで抑制。degraded を明示し「無い」を可視化。
- **Wikipedia/Wikidata レート**：build 時のみ・キャッシュで再取得しない・スロットリング（sleep）。
- **静的容量**：11,600×~1KB(gz) ＝ 数 MB 増。on-demand fetch（クリック地域のみ）＝起動負荷増は無し。
- **イベントフッタの粒度**：国/県は Phase2 集計流用、都市は近接半径クエリ（2.5b で簡潔に）。
- **Phase2 との関係**：admin1 イベントランキングは「近隣の動向」フッタへ降格（コードは流用・削除しない）。

## 10. 受け入れ（太田さん実機）
2.5b 完了時、日本サブセットで：国/県/都市クリック→プロフィールがページ風に出る／セクションが事実ベースで読める／イベントが下部に小さく折りたたまれる／パンくず遷移／flyTo が当該地域に寄る／モバイル bottom-sheet。OK なら 2.5c 全生成へ。
