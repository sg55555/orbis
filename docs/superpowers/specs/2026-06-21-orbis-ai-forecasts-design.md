# Orbis AI FORECASTS（ドメイン別リスク見通し）設計

- date: 2026-06-21
- project: orbis
- status: design (approved in brainstorming, pending spec review)
- サブプロジェクト: AIインテリジェンス層 **第3サブプロジェクト**
- 関連: ワールド・ブリーフィング（第1・本番）/ 国家不安定性インデックス（第2・本番）/ AI戦略趨勢（第4・未着手）
- 再利用バックボーン: `collectors/lib/intel.py` / `collectors/lib/instability.py` / `collectors/lib/geo_country.py` / `js/lib/news_categories.js` / `js/lib/selection.js`

---

## 1. 目的とスコープ

orbis の OSINT スナップショット群を入力に、**8 ドメインの「リスク/エスカレーション見通し」**（今後 24〜72h に注視すべき事象・地域）を提示する、AIインテリジェンス層の第 3 機能。

この機能は AI 層で**最も野心的かつ高リスク**（幻覚・予測精度・金融/軍事助言・ToS）であるため、**健全性を最優先**に設計する。中心思想は「**決定論で"どこを・どれだけ注視すべきか"を算出し、AI は"なぜ・何が起こりうるか"を説明するだけ**」（第 2 サブPJ 不安定性インデックスと同じ哲学）。

### スコープ内（第1弾）
- 8 ドメイン枠: `ALL / Conflict / Market / Supply Chain / Political / Military / Cyber / Infra`。
- 決定論「注視度スコア」＋信頼度帯＋トレンド。
- 上位項目への AI ナラティブ（見通し＋根拠）。
- メディア下 `#forecasts` セクション（ドメインタブ＋カード＋globe flyTo）。
- 予測ログ（`forecast_history.json`・透明性のため過去スナップショットを保持。的中判定はしない）。
- 毎時 cron・Haiku・キーゲート graceful。

### スコープ外（第1弾では作らない）
- **的中追跡/的中率判定**（第2弾。イベント照合の定義が曖昧で複雑）。
- **Market/Cyber 専用信号ソース**（将来タスク。第1弾は news 決定論カウントのみ）。
- **globe 新 deck レイヤー**（既存 `selection.js` の flyTo/リティクルのみ）。
- ドメイン別の可変 horizon（第1弾は全ドメイン `24-72h` 固定）。

---

## 2. 確定方針（ブレスト MC・2026-06-21）

1. **予測の性質＝リスク/エスカレーション見通し**（既存信号の前方投影＋信頼度帯）。
2. **全 8 ドメイン枠＋信号で濃淡**（Conflict/Political◎・Infra/災害○・Supply Chain/Military△・Market/Cyber✗=news 決定論カウントのみ・ALL 横断）。
3. **決定論ランク＋AI ナラティブ**（注視度・信頼度・signals は決定論、AI は `outlook_ja`/`rationale_ja` のみ＝数値・ランクに AI 非関与）。
4. **予測ログを history に保存**（直近 7 日・的中判定なし）。

---

## 3. アーキテクチャ（既存パターン踏襲）

```
既存スナップショット（conflict / protests / quakes / news / ships / airtemp / sst）
   ＋ instability.json（国別スコア・トレンド）
        │  ① collectors/lib/forecast.py（純粋）が
        │     信号を「ドメイン × 地理単位」に集約
        ▼
   決定論「注視度スコア」算出（モメンタム主軸）＋ confidence ＋ trend   ← AI 非関与
        │  ② 各ドメインのトップ N だけ Haiku に渡す
        ▼
   AI ナラティブ（outlook_ja / rationale_ja）だけ生成        ← 数値・ランク・signals は変更禁止
        ▼
   data/snapshots/forecast.json（＋ forecast_history.json に追記）
        ▼
   js/ui/forecast.js → メディア下 #forecasts（ドメインタブ ＋ カード ＋ globe flyTo）
```

運用は briefing（cron→Sonnet→JSON→#ai-brief）/ instability（cron→決定論+Haiku→JSON→#instability）と同型。collect ワークフロー群（cron）に直列追加する。

---

## 4. 決定論「注視度スコア」（心臓部）

各「ドメイン × 地理単位」について `attention_score`（0–100）を決定論的に算出する。**モメンタム（変化率）を主軸**にして「これから悪化しそう」を捉える（instability の絶対水準寄りとは役割を分ける）。

### 4.1 構成要素
- **モメンタム（主）**: 直近 24h の信号量の、平常基準（**7 日中央値**・instability の `normal` と統一）からの**変化率**。急増ほど高い。履歴/基準が不足する初回 cron 等ではモメンタム寄与を中立化し、絶対水準主体でスコアする（決定論カードは初回から出る）。
- **絶対水準（従）**: 直近の絶対量を正規化した値。
- **不安定性寄与（従・該当ドメインのみ）**: Conflict/Political/Military は対象国の `instability.json` スコアを加味。
- 合成 = `w_momentum·momentum + w_level·level + w_instab·instab`（重みは `config/forecast.json`）→ **P95 正規化**（instability 同様、外れ値に強い）→ 0–100 → `attention_level` 1–5。

### 4.2 confidence（low/med/high）＝決定論
寄与した**独立信号源の本数**・**一貫性**（複数信号が同方向か）・**データ鮮度**から決める。
- `high`: 3 種以上の独立信号が同方向 ＋ 鮮度 OK。
- `med`: 2 種。
- `low`: 1 種、または news のみ、または鮮度低。
- **Market/Cyber（news のみ）は常に `low`**。閾値は config。

### 4.3 trend（up/flat/down）＝決定論
`forecast_history.json` の前回スナップショットの同一 `(domain, place_key)` の注視度と比較し、閾値（config）で `up`（悪化中）/`flat`/`down`（沈静化）。初回は履歴なしのため全 `flat`（または `new`）。

### 4.4 地理単位（scope）はドメインで可変
- Conflict / Political / Military: **国**（`geo_country.py` 点内判定＋`fips_countries.json` で国解決。instability と共通）。
- Infra/災害: **地点**（地震の震源など）/ 国。
- Supply Chain: **要衝**（海峡）/ 国。
- Market / Cyber: **グローバル / 国**。
- カードの `scope` フィールドで吸収（`country | point | chokepoint | global`）。

### 4.5 AI の役割（厳格に限定）
- 入力: そのカードの `domain / place_ja / signals / attention_score / confidence / trend`。
- 出力: `outlook_ja`（今後 24–72h の見通し＝前方投影）と `rationale_ja`（なぜ注視か＝signals の解釈）の **2 文のみ**。
- **禁止**: 数値・ランク・confidence の変更、助言、捏造、`signals` 範囲外の固有名詞・数値の生成。
- AI ナラティブ対象は**各ドメイン上位 N 件**（N は `config/forecast.json`・instability の上位 8 件に倣う）。各更新で対象をまとめて **1 回の LLM 呼び出し**（instability の `narrative_prompt`/`parse_narratives` パターン踏襲）。ALL タブの表示上限も config。

---

## 5. データ契約

### 5.1 `data/snapshots/forecast.json`
```json
{
  "generated_at": "2026-06-21T12:37:00Z",
  "model": "claude-haiku-4-5",          // キー無し時は null（決定論カードのみ）
  "thresholds": { "level": [20,40,60,80], "trend_pct": 0.15 },
  "cards": [ /* Card[]（全ドメイン混在・注視度降順） */ ]
}
```

### 5.2 Card
```json
{
  "domain": "conflict",                 // conflict|market|supply_chain|political|military|cyber|infra
  "scope": "country",                   // country|point|chokepoint|global
  "place_ja": "ウクライナ",
  "place_key": "UP",                    // FIPS 等の安定キー（trend 突合用）
  "lat": 49.0, "lon": 32.0,             // 任意（globe flyTo 用・無い場合あり）
  "attention_score": 78,                // 決定論 0-100
  "attention_level": 4,                 // 決定論 1-5
  "trend": "up",                        // 決定論 up|flat|down|new
  "confidence": "high",                 // 決定論 low|med|high
  "horizon": "24-72h",
  "signals": [                          // 決定論・実データのみ（AI の参照範囲）
    { "label": "GDELT紛争 +42%/平常", "source": "GDELT", "kind": "conflict" },
    { "label": "不安定性スコア 81 (↑)", "source": "instability", "kind": "instability" }
  ],
  "outlook_ja": "…今後72hで砲撃の再拡大が起こりうる…",   // AI（前方投影）／status=watch では空
  "rationale_ja": "…紛争イベントが平常比+42%、不安定性も上昇…", // AI（根拠）／status=watch では空
  "ai_generated": true,                 // AI ナラティブ有無
  "status": "active"                    // active | watch（監視中＝信号不足・AI ナラティブなし）
}
```
- **ALL タブ**は専用生成せず、フロントで全 `cards` を注視度降順に表示（ドメイン混在）。各ドメインタブは `domain` でフィルタ。
- **監視中カード**（Market/Cyber 等で信号不足）は `status:"watch"`・`ai_generated:false`・ナラティブ空。

### 5.3 `data/snapshots/forecast_history.json`
```json
{
  "snapshots": [
    { "at": "2026-06-21T12:37:00Z",
      "cards": [ { "domain":"conflict","place_key":"UP","score":78,"confidence":"high","outlook_short":"…" } ] }
  ]   // 直近 7 日（毎時で最大 168）。カードは要約版で軽量化。
}
```
instability の `update_history` パターンで追記・FIFO トリム。

---

## 6. ドメイン × 信号マッピング（8 ドメイン）

| ドメイン | 地理単位 | 決定論の信号 | confidence 傾向 |
|---|---|---|---|
| Conflict | 国 | GDELT 紛争数＋変化率、instability スコア | 高〜中 |
| Political | 国 | GDELT 抗議数＋変化率、instability スコア | 高〜中 |
| Infra/災害 | 地点/国 | 地震(USGS)、気温/水温異常、news | 中 |
| Supply Chain | 要衝/国 | 要衝近傍の船舶密度変化・紛争/地震、news | 低〜中 |
| Military | 国 | conflict で代替（"近似"明示）、news | 低〜中 |
| Market | グローバル/国 | 専用信号なし→**news 決定論カウントのみ** | 常に low |
| Cyber | グローバル/国 | 専用信号なし→**news 決定論カウントのみ** | 常に low |
| ALL | 混在 | 全ドメインの注視度トップを横断統合（フロント） | 各項目準拠 |

**Market/Cyber の扱い**: `config/forecast.json` の news キーワード/カテゴリで決定論的にカウントして注視度を立て、AI は該当 news 見出しの要約のみ（出典付き・**予測はしない**）。言及も無ければ `status:"watch"` プレースホルダ。

---

## 7. 健全性ガード（高リスク機能の肝）

1. **決定論優先**: 数値・ランク・confidence・signals は決定論。AI が触れるのは `outlook_ja`/`rationale_ja` のみ。
2. **AI 生成・推測の明示**: 全 AI 生成カードに「🤖 AI生成・推測」バッジを常時表示。
3. **不確実性の常時表示**: confidence バッジを常に表示。
4. **助言回避**: プロンプトで「投資/軍事/政治的行動の助言を禁止」。生成後に**禁止語/助言パターンの後処理チェック**（検出時はナラティブ破棄→決定論カードのみに降格）。
5. **捏造禁止**: AI は渡された `signals`（実データ）の範囲でのみ説明。範囲外の固有名詞・数値生成を禁止（プロンプト＋レビュー観点）。
6. **信号無しは予測しない**: 決定論で十分な信号が立たないドメイン/地域は `status:"watch"`（監視中）。AI ナラティブを出さない。
7. **XSS**: 全 AI 文字列・place 名はフロントで HTML エスケープ（instability の esc 厳守踏襲）。

---

## 8. 予測ログ（透明性）

- 各 cron 更新で要約カードを `forecast_history.json` に追記（直近 7 日・FIFO）。
- UI: `#forecasts` 内に「過去の注視推移」を**折りたたみ**で簡素表示（ドメイン別 score 推移が分かる程度）。第1弾は最小実装。
- 的中判定はしない（第2弾）。

---

## 9. 頻度・モデル・コスト・キーゲート

- **頻度＝毎時 :37**（briefing :17／instability :47 に揃える）。collect グループに直列追加。
- **モデル＝claude-haiku-4-5**（instability 実績。ナラティブは「信号からの説明」に留まるため Haiku で十分。質不足なら Sonnet へ昇格可能な設計）。
- **コスト**: 入力＝集約済み信号 数 KB、出力＝計 20〜30 カード × 短ナラティブ 2 本 → 1 更新数円未満、毎時で月数百円規模（briefing/instability 同等）。
- **キーゲート**: `ANTHROPIC_API_KEY` 未設定なら**決定論カードのみ**出力（`model:null`・`ai_generated:false`・graceful。instability と同様）。追加 secret 不要（既存キー流用）。

---

## 10. UI（メディア下・#instability の後に #forecasts）

- **ドメインタブ**: `ALL / Conflict / Market / Supply Chain / Political / Military / Cyber / Infra`（ALL 既定）。
- **各タブ**＝注視カードのリスト（注視度降順）。ALL は全カード横断。
- **カード要素**: ドメイン色アクセント・`place_ja`・注視度バー(0-100)＋level・confidence バッジ・trend 矢印・horizon・signals チップ・`outlook_ja`・`rationale_ja`・「🤖 AI生成・推測」バッジ・出典・クリックで flyTo（座標あり）。
- **監視中カード**: 淡色プレースホルダ「十分な信号なし・監視中」。
- **予測ログ**: 「過去の注視推移」折りたたみ（最小）。
- **globe 連動**: `selection.js` 再利用（flyTo＋リティクル・layerId='forecast'）。
- デザイン言語は既存リッチ化（オーロラ/グラス/ネオン）に合わせ instability/briefing と統一。ルック微調整は実装時にローカル実物比較。

---

## 11. テスト戦略（全 TDD）

- **pytest（純粋）**: 信号集約・注視度算出（モメンタム/正規化）・confidence 判定・trend・Market/Cyber の news カウント・parse_narratives・**健全性（助言禁止語チェック／捏造ガード）**。
- **node:test（JS 純粋ヘルパ）**: カード HTML・ドメイン色・タブ切替フィルタ・score バー・**XSS esc**・監視中プレースホルダ。
- **e2e（Playwright・route mock で forecast.json）**: セクション描画・タブ切替・カードクリック flyTo・予測ログ折りたたみ・「AI生成」バッジ存在。
- **ローカル視覚サニティ**: seed → 目視 → 破棄。
- **e2e 直列化**: 既存方針（`workers:1`）に従う。

---

## 12. ファイル構成・再利用

### 新規
- `collectors/lib/forecast.py`（純粋: `aggregate_signals` / `score_attention` / `confidence_of` / `trend_of` / `build_cards` / `forecast_prompt` / `parse_narratives`）
- `collectors/forecast.py`（コレクタ・Haiku・キーゲート）
- `config/forecast.json`（ドメイン定義・重み・閾値・基準窓・news キーワード）
- `.github/workflows/collect-forecast.yml`（毎時 :37・group collect 直列・追加 secret 不要）
- `data/snapshots/forecast.json` ＋ `forecast_history.json`
- `js/ui/forecast.js`（`renderForecasts` ＋ 純粋ヘルパ: `cardHtml`/`domainColor`/`scoreBar`/`tabFilter`/`watchCardHtml`）

### 再利用
- `collectors/lib/intel.py`（`_strip_fence` 等）
- `collectors/lib/instability.py`（`aggregate`/`apply_trend`/`update_history`/P95 正規化パターン）
- `collectors/lib/geo_country.py`（`load_polygons`/`point_country`）
- `js/lib/news_categories.js`（ドメイン色）・`js/lib/selection.js`（flyTo/リティクル）
- `config/fips_countries.json`・`data/static/country_bounds.geojson`

### 変更
- `index.html`（`#forecasts` を `#instability` の後に追加）
- `js/main.js`（fetch＋render＋flyTo 配線・briefing/instability ミラー）
- `css/orbis.css`
- `sw.js`（**v40**・index.html/main.js/css は SHELL キャッシュのため版上げ必須）

---

## 13. リスクと緩和

| リスク | 緩和 |
|---|---|
| LLM の幻覚 | 決定論骨格＋AI は説明のみ＋signals 範囲限定＋捏造後処理チェック |
| 予測の過信 | confidence 帯＋「AI生成・推測」バッジ＋断定回避プロンプト |
| 金融/軍事助言・ToS | 助言禁止プロンプト＋禁止語後処理チェック（検出→ナラティブ破棄） |
| コスト膨張 | Haiku＋毎時＋トップ N 限定＋集約入力 |
| GDELT の US 報道バイアス（instability 既知） | **モメンタム主軸**で絶対量飽和の影響を低減（変化率で動きを捉える）。残存バイアスは注記 |
| 信号無しドメインの空虚さ | `status:"watch"` で正直表示・将来 Market/Cyber 専用信号で格上げ（将来タスク） |

---

## 14. 将来タスク（記録済み・第1弾外）

- **Market/Cyber 専用信号ソース**（無料 OSINT）: Market=ECB/Frankfurter・Stooq・FRED・CoinGecko・VIX、Cyber=CISA KEV・NVD CVE・ransomware.live。取得→`forecast.py` のドメイン信号に追加し「監視中」→「本格予測」へ格上げ。
- **的中追跡/的中率**（予測ログを土台に第2弾）。
- **AI 戦略趨勢**（第4サブPJ）。

---

## 15. 実装方式・統合

- **worktree**: `ai-forecasts`（origin/main 最新 130daa0 ベース・本 spec を含む）。
- 実装後: worktree → main 統合（merge→push）→ 本番（既存 `ANTHROPIC_API_KEY` で毎時 cron）→ 記憶昇格。
- 共有ファイル（`index.html`/`main.js`/`css`/`sw.js`）を触るため、統合時は他セッションとの衝突に注意（[[git-shared-main-tree-integration-collision]]）。
