# Orbis 国家不安定性インデックス — 設計（spec）

- date: 2026-06-20
- project: orbis
- status: design（ユーザー確認待ち）
- worktree: `worktree-instability`
- related: AIインテリジェンス層（第1サブPJ＝ワールド・ブリーフィング `2026-06-20-orbis-ai-briefing-design.md` の後続・第2サブPJ）

## 1. 背景・目的

AIインテリジェンス層の第2サブプロジェクト。既存OSINTスナップショット（GDELT紛争/抗議・USGS地震・翻訳ニュース）を集約し、**国別の「不安定性スコア」を定量算出**して、

1. **現時点で最も不安定な国のランキング**（ホットスポット俯瞰）
2. **不安定化の検知（トレンド）**＝昨日比の悪化＋平常比の高まり（「次に荒れる国」の予兆）

をメディア領域の下（briefing の下）に新セクションとして提供する。クリックで該当国へ globe flyTo。

ブリーフィング（現状の俯瞰）に対し、本PJは **定量・国別・時系列** の軸を足す。バックボーン（国別集約・点内判定・履歴）は後続（AI FORECASTS／戦略趨勢）でも再利用する。

## 2. 確定済みの方針（ユーザー承認済み）

| 論点 | 決定 | 根拠 |
|---|---|---|
| 主目的 | **ランキング＋トレンド両方** | ユーザー選択 |
| スコア算出 | **決定論的な式**。AIは数値に触れない | mistakes.md「LLM数値は自信満々に外す」。再現性・透明性・低コスト |
| AIの役割 | 上位N国の**根拠ナラティブのみ**（Haiku・毎時・捏造禁止） | 説明可能性を足しつつ数値の健全性を保つ |
| シグナル範囲 | **conflict＋protests＋news＋quakes** | ユーザー選択（網羅性） |
| 国キー | **FIPS 国コードを正準**。news/quakes は lat/lon→国に解決 | conflict/protests は FIPS を持つ。news/quakes は持たない |
| 国解決 | **同梱の FIPS 付き国境ポリゴン＋純Python点内判定(PIP)** | 正確・再利用可（FORECASTS/全球マップでも使える） |
| UI | **新セクションのみ**（globe レイヤーは増やさない） | YAGNI・一貫性・deck×globe の既知の地雷（IconLayer不動等）を回避 |
| トレンド | **昨日比（vs 24h前）＋平常比（vs 7日中央値）の両方** | ユーザー選択 |
| 運用 | `collect-instability.yml` **毎時**・出力 `instability.json`・既存 `ANTHROPIC_API_KEY` 流用 | briefing と同型 |

### 非目標（v1 でやらない＝YAGNI）
- globe 上の常設マップレイヤー（色分けマーカー）。← `instability.json` に重心+score を持たせるので後続で容易に追加可能。
- LLM によるスコア補正・将来予測（FORECASTS は別サブPJ）。
- 国内（地方）粒度。v1 は国粒度のみ。

## 3. データ入力（既存スナップショット）

実データで確認済みの形（2026-06-20）。

| ソース | ファイル | 件数/窓 | 国キー | 使うフィールド |
|---|---|---|---|---|
| 紛争 | `conflict.json` | 直近24h・最大2000 | `place`=FIPS | `root`(18暴行/19戦闘/20大量暴力), `mentions`, `tone`(文字列), `lat/lon` |
| 抗議 | `protests.json` | 直近24h | `place`=FIPS | `root`(14固定), `mentions`, `tone`, `lat/lon` |
| ニュース | `news.json` | 直近24h・最大30 | なし（`place`=日本語地名＋`lat/lon`） | `category`, `lat/lon`, `title_ja`, `url` |
| 地震 | `quakes.json` | all_day | なし（`place`=USGS文字列＋`lat/lon`） | `mag`, `lat/lon`, `time`, `url` |

GDELT 由来の重要事実：
- `tone` は**文字列**（例 `"-2.83"`）。要 `float()`。負ほど対立的（conflict 平均 ≈ -4.4、protests ≈ -2.9）。
- conflict は root 18/19/20 のみ、protests は 14 のみ（`gdelt_events.py` で抽出済み・二重計上の心配なし）。
- FIPS は GDELT 特有（CH=中国, AS=豪州 の罠）。日本語名は既存 `js/lib/places.js` の `FIPS_JA` 準拠。

## 4. アーキテクチャ

```
[snapshots: conflict/protests/news/quakes]
        │
        ▼  (collectors/instability.py: IO)
  ┌─────────────────────────────────────────────┐
  │ collectors/lib/geo_country.py (純粋)          │ ← data/static/country_bounds.geojson (FIPS付)
  │   point_country(lon,lat) = FIPS or None  (PIP)│
  ├─────────────────────────────────────────────┤
  │ collectors/lib/instability.py (純粋)          │ ← config/instability.json (重み等)
  │   aggregate() → 国別 components/counts/centroid│ ← config/fips_countries.json (FIPS→日本語名)
  │   score_countries() → score/level/rank        │
  │   apply_trend(history) → dod / normal          │
  │   narrative_prompt() / parse_narratives()      │
  └─────────────────────────────────────────────┘
        │ (collectors/instability.py: Haiku 呼び出し=上位N国ナラティブ・履歴更新)
        ▼
  data/snapshots/instability.json   +   data/snapshots/instability_history.json
        │
        ▼  (js/main.js: fetch)
  js/ui/instability.js (renderInstability) → <section #instability>（ランキング＋急上昇）
        └ クリック → selection.js flyTo + リティクル（layerId 'instability'）
```

### 新規・変更ファイル
**新規（collector / 純粋ロジック）**
- `collectors/lib/geo_country.py` — 国境 GeoJSON をパースし、`point_country(lon, lat)` で FIPS を返す純粋関数（PIP・bbox 事前絞り）。
- `collectors/lib/instability.py` — 集約・スコア・正規化・レベル・重心・トレンド・ナラティブ用プロンプト/パースの**純粋関数群**。
- `collectors/instability.py` — IO（スナップショット読込・Haiku 呼び出し・履歴 read/write・`instability.json` 書き出し・manifest 更新・キーゲート）。
- `config/instability.json` — スコア重み・閾値・上位N等のチューニング定数（コードにマジックナンバーを散らさない）。
- `config/fips_countries.json` — FIPS→日本語名（Python 側の単一真実源。`places.js` の `FIPS_JA` から生成・内容一致）。
- `data/static/country_bounds.geojson` — Natural Earth 110m Admin-0（Public Domain）を簡略化し `FIPS_10_` と名称を保持。数百KB。`trade_routes.geojson` と同じ同梱方式。

**新規（フロント）**
- `js/ui/instability.js` — 純粋ヘルパ（`scoreColor`/`levelOf`/`trendArrow`/`fmtSignedPct`/`rankTop`/`topMovers`/`rowHtml`）＋ `renderInstability(container, data, onSelect)`。
- `tests/unit/instability.test.js`（node）／`tests/e2e/instability.spec.js`（Playwright・route mock）。
- `tests/test_instability.py`／`tests/test_geo_country.py`（pytest）。

**変更**
- `index.html` — `#ai-brief` の直後に `<section id="instability">`。
- `js/main.js` — `instability.json` を fetch → `renderInstability` → onSelect で flyTo+リティクル。
- `css/orbis.css` — セクション/行/スコアバー/トレンド矢印（glass 調・既存と一貫）。
- `.github/workflows/collect-instability.yml` — 毎時（briefing と同型）。**concurrency group `collect` を共有**して collect/collect-slow/briefing と直列化（push 競合回避）・cron は別オフセット（例 `:37`）・commit 後 `git pull --rebase origin main`→push。**決定論部分はキー不要で必ず動く・ナラティブのみ `ANTHROPIC_API_KEY` キーゲート**（未設定でも score/trend は出力）。新規 pip 依存なし（PIP は純Python）。
- Service Worker 版番号を上げる（index.html/main.js/css 変更のため。**現行 v37 → v38**）。
- 鮮度系：`manifest.json` に `instability` を加える（`update_manifest`）。

## 5. スコア式（決定論・正確版）

すべての定数は `config/instability.json` に置く。下記は既定値（チューニング可能）。**テストは「振る舞い（単調性・寄与・境界）」を固定し、マジックナンバーそのものは固定しない**（mistakes.md＝症状でなく能力/振る舞いを検証）。

### 5.1 イベント単位の寄与
```
tone_pen(tone)   = 1 + clamp(-float(tone), 0, 12) / 6        # tone 0→1.0, -6→2.0, -12→3.0
conflict_event   = ROOT_W[root] * ln(1+mentions) * tone_pen   # ROOT_W={18:1.0, 19:1.3, 20:1.8}
protest_event    = PROTEST_W   * ln(1+mentions) * tone_pen    # PROTEST_W=0.6（root14固定）
news_item        = NEWS_SEV[category]                         # conflict:1.0,disaster:0.9,politics:0.5,
                                                              #   economy:0.3,society:0.3,environment:0.4,その他:0.2
quake_event      = 0  if mag < MAG_MIN(=4.5)
                 = min(QUAKE_CAP=8, 2 ** (mag - 4.5))          # 4.5→1,5.5→2,6.5→4,7.5→8（上限8）
```

### 5.2 国別集約
- conflict/protests：`place`(FIPS) で集約。
- news/quakes：`geo_country.point_country(lon,lat)` で FIPS 解決（None は破棄＝海洋等）。news は `mag` 無いので category のみ。
- 各国 c について：
```
C = Σ conflict_event ;  P = Σ protest_event ;  N = Σ news_item ;  Q = Σ quake_event
raw(c) = WC*C + WP*P + WN*N + WQ*Q        # WC=1.0, WP=0.8, WN=1.5, WQ=1.2
counts(c) = {conflict, protests, news, quakes(mag≥MAG_MIN)} の件数
components(c) = {conflict:WC*C, protests:WP*P, news:WN*N, quakes:WQ*Q}（小数1桁丸め・内訳表示用）
```

### 5.3 正規化・レベル
- `raw>0` の国の **95パーセンタイル** P95 を基準に `score(c) = round(100 * raw(c) / P95)`、`clamp(0,100)`（外れ値1国で全体が潰れないため）。P95==0 のときは全 score=0。
- レベル（色）：`level = 1+floor(score/20)` を 1..5 に丸め。
  - 1 平穏(0–19) / 2 留意(20–39) / 3 緊張(40–59) / 4 高(60–79) / 5 危機(80–100)。
  - 色は `scoreColor`（青緑→黄→橙→赤の連続。news_categories とは別スケール。実物比較で微調整可）。

### 5.4 重心（マーカー/flyTo 用）
- 各国の寄与イベント点（conflict/protest/news/quake の lat/lon）を**寄与重み付き平均**して `lat,lon`。
- 経度の素朴平均は経度180度線跨ぎで不正確になり得るが、国単位のイベントは集中するため v1 は許容（既知の限界として明記）。

## 6. トレンド（昨日比＋平常比）

### 6.1 履歴ファイル `instability_history.json`
```
{ "FIPS": [ {"t": epoch_ms, "score": int}, ... ], ... }   # 毎時1サンプル・7日保持(≤168点/国)
```
毎回 collector が現 score を追記し、`now - 7日` より古いものを切り詰める。破損時は空から開始（堅牢）。

### 6.2 算出（純粋 `apply_trend`）
- **昨日比 (dod)**：`now-24h` に最も近いサンプル（±6h 許容）を基準に `delta = score_now - score_then`。`dir = up if delta≥5 / down if ≤-5 / flat`。基準が無ければ `null`。
- **平常比 (normal)**：直近7日サンプルの **中央値 med** に対し `deltaPct = round(100*(score_now-med)/max(med,1))`。`dir = up if deltaPct≥15 / down if ≤-15 / flat`。サンプル<3 は `null`。
- 履歴が乏しい国：`isNew=true`（トレンドは `—` 表示）。

## 7. AI ナラティブ（上位N国・Haiku・任意）

- 対象：score 上位 **N=8** 国のみ。
- 入力：各国の `name_ja, score, components, counts` と、**実データの代表イベント**（mentions 上位の conflict/protest の `place/tone`、news の `title_ja`）。
- 1回のバッチ呼び出しで `{ "FIPS": "日本語1文の根拠" }` を返す。
  - system：`intel.BRIEFING_SYSTEM` と同趣旨（与えたデータのみ・捏造禁止・予測/助言しない・JSONのみ）。
  - `model=claude-haiku-4-5, temperature=0, max_tokens=2000`（8国×〜150字を安全に収める＝briefing の途中切れバグ [max_tokens過少] の教訓を反映）。
- パース（純粋 `parse_narratives`）：JSON 抽出（`_strip_fence` 再利用）→ `code→str`、各160字に丸め、空/型不正は除外。
- **キー未設定・呼び出し失敗・parse 空 → ナラティブ無しで続行**（決定論スコア/トレンドは必ず出る＝graceful degradation）。

## 8. 出力スキーマ `instability.json`
```json
{
  "updated": "2026-06-20T..Z",
  "model": "claude-haiku-4-5",
  "thresholds": {"mag_min": 4.5, "top_n": 8, "...": "config 由来"},
  "countries": [
    {
      "code": "IZ", "name_ja": "イラク", "score": 87, "level": 5, "rank": 1,
      "lat": 33.2, "lon": 43.9,
      "components": {"conflict": 120.4, "protests": 8.1, "news": 3.0, "quakes": 0.0},
      "counts": {"conflict": 210, "protests": 7, "news": 2, "quakes": 0},
      "trend": {"dod": {"delta": 12, "dir": "up"}, "normal": {"deltaPct": 34, "dir": "up"}, "isNew": false},
      "narrative_ja": "…（上位N国のみ・実データ接地）",
      "top_events": [{"title": "…", "place": "…", "url": "https://…"}]
    }
  ]
}
```
- `countries` は score 降順。frontend は配列から「ランキング上位」「急上昇（movers）」を純粋ヘルパで導出。
- `manifest.json` に `instability` の `updated/count` を反映。

## 9. フロントエンド

- `<section id="instability">`（`#ai-brief` の下）：
  - 見出し＋鮮度（`updated` を既存 freshness 方式で）。
  - **ランキング**：上位 ~15 国。各行＝`[レベル色] 国名 ── スコアバー(0-100) ── 昨日比↑/平常比↑ ── 件数内訳(⚔X 📢Y 📰Z 🌐W) ── ナラティブ(あれば)`。
  - **急上昇**：`isNew=false` のうち dod.delta または normal.deltaPct の大きい順 上位 ~5。
  - 行クリック → `onSelect(country)` → `selection.js` で `flyTo([lat,lon])`＋リティクル（`layerId:'instability'`・deck レイヤーではなく briefing カードと同じ flyTo 経路）。
- 純粋ヘルパ（node テスト）：`scoreColor(score)`/`levelOf(score)`/`trendArrow(dir)`/`fmtSignedPct(n)`/`rankTop(countries,n)`/`topMovers(countries,n)`/`rowHtml(country)`。
- セキュリティ：`url` は `http(s)` のみ・`textContent`/エスケープで XSS 防止（news レイヤーと同様）。

## 10. エラー処理・堅牢性（既存コレクタと同方針）
- いずれかのスナップショット欠落 → その component を 0 として続行（全体は出す）。
- `geo_country` が None → その点は破棄。
- 履歴破損 → 空から再構築。
- Haiku 失敗/キー無し → ナラティブ省略・決定論部分は出力。
- 例外時は前回 `instability.json` を温存（best-effort・briefing/quakes と同じ）。

## 11. テスト計画
- **pytest `test_geo_country.py`（能力テスト）**：既知点→既知国（東京(139.69,35.68)→`JA`／パリ(2.35,48.85)→`FR`／カイロ(31.24,30.04)→`EG`／アラスカ内陸→`US`(マルチポリゴン)／太平洋中央→`None`）。FIPS 属性抽出の検証。
- **pytest `test_instability.py`（振る舞い）**：
  - 単調性：mentions/tone 悪化・root 重い・件数増で raw 増。
  - 寄与：大地震(mag7)が score を押し上げる／news category で差が出る。
  - 正規化：score∈[0,100]、レベル境界、P95 基準、全0時。
  - 重心：寄与重み付き平均。
  - トレンド：dod（24h前比・基準欠如→null）、normal（中央値比・サンプル<3→null）、isNew。
  - `parse_narratives`：フェンス除去・160字丸め・不正除外。
- **node `instability.test.js`**：純粋ヘルパ（色/矢印/ランキング/movers/rowHtml の構造）。
- **e2e `instability.spec.js`**（route mock・`workers:1`）：セクション描画・行数・クリックで `window.__orbis` 経由 flyTo・console エラー0。
- **視覚サニティ**：ローカルで seed→セクションをスクショ目視（DOM パネルゆえ WebGL リスク低）。flyTo リティクルは既存 selection を流用（実績あり）。

## 12. ロールアウト
1. worktree で実装（TDD・サブユニット駆動 or 単独は着手時に確認＝effort 降格＋ultracode 提示）。
2. main へ merge → push（共有 main で統合・直 push／pull --rebase は merge 後に使わない＝[[git-shared-main-tree-integration-collision]] の教訓）。
3. SW 版 v38。Vercel 自動デプロイ。
4. `gh workflow run collect-instability.yml` で初回生成 → `instability.json` コミット（以降毎時）。**追加の Secret 設定は不要**（`ANTHROPIC_API_KEY` 既存）。
5. 本番 curl/実機で検証（ランキング・トレンド・クリック flyTo・エラー0）。
6. 完了後に記憶整理（MEMORY.md＋Obsidian `Projects/orbis-ai-intelligence.md`）。

## 13. リスクと低減
- **国境ポリゴン低解像度**：NE 110m は粗く、小国/沿岸点は誤解決し得る。→ 国粒度の指標では許容。None は破棄。限界を明記。
- **NE FIPS と GDELT FIPS の差異**：稀に不一致。→ 名称は `FIPS_JA` 無ければコード表示にフォールバック。
- **conflict 2000件キャップ**：高活動時は実質窓が短い。→ 平常比（中央値）でノイズ吸収。
- **ナラティブ途中切れ**：→ max_tokens 余裕＋graceful degradation。
- **deck×globe 地雷**：→ v1 は globe レイヤーを作らない（セクション＋flyTo のみ）。
```
