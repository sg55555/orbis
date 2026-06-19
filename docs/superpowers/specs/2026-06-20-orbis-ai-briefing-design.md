# Orbis AIインテリジェンス基盤 ＋ ワールド・ブリーフィング 設計

> AIインテリジェンス層（[[orbis-ai-intelligence]]）の**第1サブプロジェクト**。共通バックボーン（既存スナップショット集約→LLM合成→スナップショット→ダッシュボード）と、その最初の出力＝**ワールド・ブリーフィング**（現在の世界の俯瞰リード＋トップ展開カード）を作る。以降の Forecasts / 国家不安定性 / 戦略趨勢 がこのバックボーンに乗る。

- date: 2026-06-20
- status: 設計確定（実装は worktree `worktree-ai-briefing`）
- related: `2026-06-18-orbis-news-layer-*`（news の 2 段 LLM 同型）, Obsidian `Projects/orbis-ai-intelligence.md`

## 1. 目的・スコープ
### 目的
メディアセクションの**さらに下**に、AI が**現在の世界情勢を全ソース横断で合成**した「ワールド・ブリーフィング」を出す。既存 news レイヤー（個別記事の翻訳ピン）と差別化＝**合成と優先順位付け**（"効いている動き"の俯瞰）。

### やること
- `#ai-brief` セクション（globe→media の下、ページスクロール内）。
- **俯瞰リード**（数文の現状俯瞰）＋**トップ展開カード**（重要 N 件・AI 要約・出典・座標）。
- 1 時間ごとに 1 回 Sonnet 合成 → `data/snapshots/briefing.json`。
- 座標ありカードはクリックで globe flyTo ＋ リティクル（既存 selection.js）。
- **再利用バックボーン**：スナップショット集約 `build_context` ＋ 出力検証 `parse_brief`（後続サブプロジェクトが再利用）。

### やらないこと（YAGNI／非スコープ）
- **予測**（Forecasts は別サブプロジェクト。本ブリーフィングは現状報告に限定）。
- 国家不安定性インデックス・戦略趨勢（後続）。
- フィード連動・本文ピンハイライト・ウォッチリスト（将来オプション）。
- 汎用 AI セクション・シェルの抽象化（2 つ目のセクションが来たら一般化。今は briefing.js 具象で）。

## 2. 制約・既知事実
- Orbis は **Vercel 静的・関数ゼロ**。AI は **GitHub Actions cron** で実行（news/ships と同型）。`ANTHROPIC_API_KEY` ゲート（未設定は skip exit0）。
- 既存スナップショット：`data/snapshots/{news,conflict,protests,quakes,...}.json`。news は `{title_ja,summary_ja,category,lat,lon,place,url,...}` を持つ最良のテキスト源。
- 既存 8 カテゴリ色 `js/lib/news_categories.js`（briefing カードも**これを再利用**＝視覚一貫・DRY）。
- selection.js に `buildReticleConfigs`／popup ヘルパ（flyTo＋着地リティクルを既存層と共用）。
- SW は**ネットワーク優先**（`sw.js`）。新規ファイルは初回ネット取得・SHELL 変更も版上げ不要で配信（ただし慣例で必要なら CACHE を上げる）。
- 実装は **worktree 分離**（main ツリー直編集なし・統合は main ツリーで cherry-pick/merge→push）。

## 3. アーキテクチャ
```
[cron 1h] collectors/briefing.py (ANTHROPIC_API_KEY ゲート)
   │  read data/snapshots/{news,conflict,protests,quakes}.json
   ▼  collectors/lib/intel.py build_context(snapshots, sources_cfg)  # コンパクト化（純粋）
   │  → 1 回の Sonnet messages.create（grounding プロンプト）
   ▼  collectors/lib/intel.py parse_brief(llm_json)  # 検証/クランプ（純粋）
   data/snapshots/briefing.json  { generated_at, model, lead, cards[] }
   │  (commit by cron, news/ships と同経路)
   ▼
[client] js/main.js → fetch briefing.json → js/ui/briefing.js render(#ai-brief)
   - 俯瞰リード（lead）＋カードグリッド（cards・カテゴリ色/severity）
   - カード click → selection.js で flyTo＋リティクル（layerId:'brief'・座標あり時）
```

### 再利用バックボーン
- `config/briefing_sources.json`：合成対象スナップショットと圧縮方法を列挙（**将来の災害層追加はここに 1 行**）。例：
  ```json
  [
    {"id":"news","file":"news.json","take":18,"fields":["title_ja","summary_ja","category","place","url"]},
    {"id":"conflict","file":"conflict.json","take":8,"summarize":"top_countries"},
    {"id":"protests","file":"protests.json","take":8,"summarize":"top_countries"},
    {"id":"quakes","file":"quakes.json","take":5,"summarize":"top_magnitude"}
  ]
  ```
- `collectors/lib/intel.py`（純粋・TDD）：
  - `build_context(snapshots: dict, sources_cfg: list) -> str`：各層を設定どおり圧縮し、LLM 用の簡潔なコンテキスト文字列に。
  - `parse_brief(text: str) -> dict`：LLM 出力（JSON フェンス耐性）を検証し `{lead, cards[]}` に整形。category は既知集合に丸め、severity を 1–5 にクランプ、lat/lon を範囲検証、url は http(s) のみ採用、cards を上限 N に制限。
- 後続（Forecasts/不安定性）は `build_context` を再利用し、合成プロンプトと出力スキーマだけ差し替える。

## 4. 出力スキーマ（`data/snapshots/briefing.json`）
```json
{
  "generated_at": "2026-06-20T07:00:00Z",
  "model": "claude-sonnet-4-6",
  "lead": "ここ数時間の世界の俯瞰を数文で（現状報告・予測なし）。",
  "cards": [
    {
      "id": "b1",
      "title_ja": "見出し（日本語）",
      "summary_ja": "1–2 文の要約（日本語）",
      "category": "conflict",            // news_categories.js の 8 カテゴリ
      "severity": 4,                       // 1–5（視覚的優先度）
      "lat": 50.45, "lon": 30.52,          // 任意（globe flyTo 用）
      "place": "キーウ",                   // 任意（表示用）
      "sources": [{"title":"…","url":"https://…"}]   // news 等の実出典
    }
  ]
}
```

## 5. グラウンディング（信頼性の肝）
- システムプロンプトで「**渡したデータ内の事実のみを使う・入力に無い出来事を作らない（捏造禁止）**」を明示。
- `lead` は現状の合成（**予測・助言をしない**）。cards は全ソース横断で**重複排除・重要度で優先順位付け**。
- 各 card は可能な限り news の**実 URL を出典**として付ける（`parse_brief` が http(s) のみ採用）。
- UI に「**AI 合成・出典付き**」ラベル。座標は news/イベントの実座標由来のみ（推定座標は付けない）。
- 出力は厳格 JSON、`temperature=0`。

## 6. クライアント / UI
- `index.html`：`#media` の後ろ（兄弟）に `#ai-brief` セクション（globe→media→ai-brief のページスクロール）。見出し＋「AI 合成・出典付き／毎時更新」注記。
- `js/ui/briefing.js`：
  - `renderBriefing(rootEl, brief, { onSelect })`：lead 段落＋カードグリッド描画。カテゴリ色は `news_categories.js`、severity で強調（枠/サイズ）。
  - カード click → 座標ありなら `onSelect(card)`（main.js が flyTo＋リティクル `layerId:'brief'`）。
  - 純粋ヘルパ（node テスト対象）：`briefCards(brief)`（cards 取り出し・空安全）、`cardColor(category)`（news_categories 経由）など。
- `js/main.js`：`fetch('data/snapshots/briefing.json')` → `renderBriefing` マウント、`onSelect` で `map.flyTo`＋`buildReticleConfigs`（既存 media/news と同パターン）。データ無し/空はセクション非表示。
- `css/orbis.css`：`#ai-brief`・`.brief-lead`・`.brief-card`（カテゴリ色ドット/severity 枠）。視覚の濃淡は **localhost 実物比較**で後詰め（look.js 流）。

## 7. コスト / 頻度
- **1 時間ごと × Sonnet**（claude-sonnet-4-6）。入力は数 KB（圧縮済）＝1 回あたり 1 円前後・1 日数十円未満。
- 新規 workflow `.github/workflows/collect-briefing.yml`（hourly・`ANTHROPIC_API_KEY` ゲート・news/ships と同じ commit 経路）。

## 8. テスト
- **pytest**（`collectors/lib/intel.py`）：`build_context`（各層の圧縮・take 数・欠損安全）、`parse_brief`（JSON フェンス除去・category 丸め・severity クランプ・座標範囲・url http(s) フィルタ・cards 上限）。
- **node**（`js/ui/briefing.js` 純粋ヘルパ）：`briefCards`/`cardColor` 等。
- **Playwright**：seed した `briefing.json` で `#ai-brief` が lead＋カードを描画／座標ありカード click で globe 中心が変化（flyTo）。実 LLM は seed/手動。
- e2e は既存 `workers:1` 踏襲。

## 9. 受入（DoD）
- pytest／node／Playwright 緑（既存も回帰なし）。
- seed briefing.json でローカル視覚サニティ（lead＋カード・カテゴリ色・カード click flyTo・エラー 0）。
- 本番：`ANTHROPIC_API_KEY` で cron 実行 → briefing.json 生成 → `#ai-brief` 描画。
- worktree で実装 → main 統合（cherry-pick/merge）→ push → 本番反映。記憶昇格（Obsidian/auto-memory）は統合セッション（私）が実施。

## 10. ファイル構成
- Create: `collectors/briefing.py`, `collectors/lib/intel.py`, `config/briefing_sources.json`, `js/ui/briefing.js`, `.github/workflows/collect-briefing.yml`
- Create(test): `tests/test_intel.py`, `tests/briefing.test.js`, `tests/e2e/briefing.spec.js`
- Modify: `index.html`（#ai-brief）, `js/main.js`（fetch＋render＋flyTo 配線）, `css/orbis.css`（#ai-brief スタイル）, `requirements.txt`（anthropic は既存）
- データ: `data/snapshots/briefing.json`（cron 生成・seed 可）
