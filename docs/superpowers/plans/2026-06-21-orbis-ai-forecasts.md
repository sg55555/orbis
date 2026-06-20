# AI FORECASTS（ドメイン別リスク見通し）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** orbis の OSINT 信号を「ドメイン×地理単位」に集約し、モメンタム主軸の決定論「注視度スコア」＋AI 根拠ナラティブで 8 ドメインのリスク/エスカレーション見通しをメディア下 `#forecasts` に描画する。

**Architecture:** 既存 briefing/instability と同型（cron→決定論→Haiku 説明→JSON→DOM セクション）。決定論で注視度・confidence・trend・signals を算出し、AI は `outlook_ja`/`rationale_ja` の 2 文だけ生成（数値・ランクに非関与）。score 算出は `forecast_history.json` の平常基準（7 日中央値）を使うモメンタム主軸。

**Tech Stack:** Python3（純粋関数＋anthropic SDK・Haiku）／Vanilla JS ESM（deck/maplibre は既存 selection.js 経由）／GitHub Actions cron／pytest・node:test・Playwright。

## Global Constraints

これらは全タスクの要件に暗黙的に含まれる（spec から逐語コピー）。

- **決定論優先**：`attention_score` / `attention_level` / `confidence` / `trend` / `signals` は決定論。AI が触れるのは `outlook_ja` / `rationale_ja` のみ。数値・ランク・confidence を AI に変更させない。
- **健全性ガード**：全 AI 生成カードに「🤖 AI生成・推測」バッジ＋ confidence 常時表示。助言回避（プロンプト禁止＋生成後に禁止語チェック→検出時はナラティブ破棄し決定論カードに降格）。捏造禁止（AI は `signals` 範囲のみ）。全文字列はフロントで HTML エスケープ。
- **信号無しは予測しない**：決定論で十分な信号が立たない項目は `status:"watch"`（監視中）・`ai_generated:false`・ナラティブ空。
- **モデル**：`claude-haiku-4-5` ・`max_tokens=3000`・`temperature=0`。
- **キーゲート**：`ANTHROPIC_API_KEY` 未設定なら決定論カードのみ（`model:null`）。追加 secret 不要。
- **頻度**：cron 毎時 `:37`。
- **SW**：`index.html`/`js/main.js`/`css/orbis.css` を変更したら `sw.js` を **v40** に上げる（SHELL キャッシュ）。
- **e2e**：`workers:1` 直列。
- **commit**：日本語メッセージ。末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。コミットメールは noreply。
- **テスト実行**：pytest は `python -m pytest`、JS 単体は `node --test tests/*.test.js`、e2e は `npx playwright test`。
- DRY・YAGNI・TDD・頻繁 commit。

## File Structure

| ファイル | 責務 |
|---|---|
| `config/forecast.json` | ドメイン定義・重み・閾値・基準窓・news キーワード・要衝リスト・top_n |
| `collectors/lib/forecast.py` | 純粋ロジック：集約／モメンタム score／confidence／trend／history／build_cards／prompt／parse／sanitize |
| `collectors/forecast.py` | コレクタ：snaps 読込→決定論→キーゲート Haiku→`forecast.json`＋`forecast_history.json`→manifest |
| `.github/workflows/collect-forecast.yml` | cron 毎時 :37（group collect 直列） |
| `js/ui/forecast.js` | フロント純粋ヘルパ＋`renderForecasts`（タブ・カード・予測ログ・flyTo） |
| `index.html` | `#forecasts` セクション（`#instability` の後） |
| `js/main.js` | fetch＋render＋flyTo 配線（instability ミラー） |
| `css/orbis.css` | `#forecasts` スタイル |
| `sw.js` | CACHE v40 |
| `tests/test_forecast.py` | Python 純粋ロジック TDD |
| `tests/forecast.test.js` | JS 純粋ヘルパ TDD |
| `tests/e2e/forecast.spec.js` | e2e（route mock） |

## データ契約（全タスク共通の参照）

```
# forecast.json
{ "generated_at": ISO, "model": "claude-haiku-4-5"|null,
  "thresholds": {...}, "cards": Card[] }   # cards は全ドメイン混在・score 降順

# Card
{ domain, scope, place_ja, place_key, lat?, lon?,
  attention_score:0-100, attention_level:1-5,
  trend:"up"|"flat"|"down"|"new", confidence:"low"|"med"|"high",
  horizon:"24-72h", signals:[{label,source,kind}],
  outlook_ja, rationale_ja, ai_generated:bool, status:"active"|"watch" }

# forecast_history.json
{ "<domain>:<place_key>": [ {t:ms, raw:float, score:int}, ... ] }  # 直近7日 FIFO
```

ドメイン定数（全タスク共通）：`DOMAINS = ["conflict","political","infra","supply_chain","military","market","cyber"]`（`all` はフロント横断・バックエンドでは生成しない）。

---

### Task 1: config/forecast.json ＋ aggregate_signals（信号→ドメイン×キー集約）

**Files:**
- Create: `config/forecast.json`
- Create: `collectors/lib/forecast.py`
- Test: `tests/test_forecast.py`

**Interfaces:**
- Consumes: 既存スナップショット（`conflict.json`/`protests.json`/`news.json`/`quakes.json`/`ships.json`）、`instability.json`、`geo_country.point_country`、`config/fips_countries.json`。
- Produces: `aggregate_signals(snaps, polys, instab, cfg) -> dict`。返り値 = `{ "<domain>:<key>": Bucket }`、`Bucket = {"domain","place_key","place_ja"?,"scope","raw":float,"signals":[{label,source,kind,value}],"counts":{src:int},"_lat","_lon","_w"}`（重心は後段で確定）。`key` は国=FIPS、地点=`round(lat,1)_round(lon,1)`、要衝=要衝 id、グローバル=`"GLOBAL"`。

集約方針（ドメイン別サブ関数）：
- `conflict` / `military`：`conflict.json` points を `place`(FIPS) 別に `log1p(mentions)` 加重（instability `_conflict_contrib` 流用）。military は同データを別ドメインとして複製し signal label に「※近似（紛争データ流用）」。
- `political`：`protests.json` を `place` 別（instability `_protest_contrib` 流用）。
- `infra`：`quakes.json` を地点キー（`mag>=cfg.quake.mag_min` のみ・`_quake_contrib` 流用）＋ `news.json` の `category=="disaster"` を `point_country` で国別に加算。
- `supply_chain`：`cfg.chokepoints`（id,name_ja,lat,lon,radius_km）ごとに、近傍（haversine<=radius）の `ships` 数と `conflict`/`quakes` を集約。
- `market` / `cyber`：`news.json` items の `title_ja`/`summary` を `cfg.keywords[domain]` で決定論マッチしカウント（キーは `"GLOBAL"`・scope=global）。

- [ ] **Step 1: Write config/forecast.json**

```json
{
  "weights": {"momentum": 1.4, "level": 1.0, "instab": 0.8},
  "momentum_clamp": 3.0,
  "normalize_pct": 95,
  "level_thresholds": [20, 40, 60, 80],
  "watch_score_min": 8,
  "baseline": {"window_days": 7, "min_samples": 3},
  "trend": {"up_delta": 8, "down_delta": 8},
  "history_days": 7,
  "top_n_narrative": 4,
  "all_show": 12,
  "domain_show": 8,
  "quake": {"mag_min": 4.5, "base": 2.0, "cap": 8.0},
  "tone_div": 6.0, "tone_clamp": 12.0,
  "root_w": {"18": 1.0, "19": 1.3, "20": 1.8}, "protest_w": 0.6,
  "instab_domains": ["conflict", "political", "military"],
  "chokepoints": [
    {"id": "hormuz", "name_ja": "ホルムズ海峡", "lat": 26.6, "lon": 56.3, "radius_km": 300},
    {"id": "malacca", "name_ja": "マラッカ海峡", "lat": 2.5, "lon": 101.0, "radius_km": 400},
    {"id": "suez", "name_ja": "スエズ運河", "lat": 30.5, "lon": 32.3, "radius_km": 250},
    {"id": "babelmandeb", "name_ja": "バブ・エル・マンデブ海峡", "lat": 12.6, "lon": 43.4, "radius_km": 250},
    {"id": "taiwan", "name_ja": "台湾海峡", "lat": 24.5, "lon": 119.5, "radius_km": 300},
    {"id": "panama", "name_ja": "パナマ運河", "lat": 9.1, "lon": -79.7, "radius_km": 200}
  ],
  "keywords": {
    "market": ["市場", "株価", "株式", "為替", "金利", "インフレ", "景気", "ドル", "原油", "金融", "債券", "中央銀行", "利上げ", "利下げ"],
    "cyber": ["サイバー", "ハッキング", "ハッカー", "ランサム", "情報漏洩", "脆弱性", "不正アクセス", "DDoS", "マルウェア"]
  }
}
```

- [ ] **Step 2: Write the failing test（集約の骨子）**

```python
# tests/test_forecast.py
import json
from collectors.lib import forecast as F

CFG = json.load(open("config/forecast.json", encoding="utf-8"))

def test_aggregate_conflict_by_country():
    snaps = {"conflict": {"points": [
        {"place": "UP", "mentions": 100, "tone": -8, "lat": 49, "lon": 32, "root": "19"},
        {"place": "UP", "mentions": 50, "tone": -4, "lat": 50, "lon": 30, "root": "18"}]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert "conflict:UP" in agg
    b = agg["conflict:UP"]
    assert b["domain"] == "conflict" and b["place_key"] == "UP"
    assert b["raw"] > 0 and b["counts"]["conflict"] == 2

def test_market_keyword_counts_to_global():
    snaps = {"news": {"items": [
        {"title_ja": "株価が急落、為替も円安", "category": "economy"},
        {"title_ja": "地震速報", "category": "disaster"}]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert agg["market:GLOBAL"]["raw"] >= 1
    assert "market:GLOBAL" in agg and agg["market:GLOBAL"]["scope"] == "global"
```

Run: `python -m pytest tests/test_forecast.py -k aggregate -v` → Expected: FAIL（`aggregate_signals` 未定義）

- [ ] **Step 3: Implement aggregate_signals**

`instability.py` の `_tone_pen`/`_conflict_contrib`/`_protest_contrib`/`_quake_contrib`/`_addpt` をこのモジュールへ移植（同一実装・DRY のため import でも可：`from collectors.lib.instability import _tone_pen, _conflict_contrib, _protest_contrib, _quake_contrib`）。新規：

```python
import math
from collectors.lib.geo_country import point_country
from collectors.lib.instability import _conflict_contrib, _protest_contrib, _quake_contrib

def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * r * math.asin(min(1, math.sqrt(a)))

def _bucket(acc, key, domain, scope, place_key, place_ja=None):
    return acc.setdefault(key, {"domain": domain, "scope": scope, "place_key": place_key,
        "place_ja": place_ja, "raw": 0.0, "signals": [], "counts": {},
        "_lat": 0.0, "_lon": 0.0, "_w": 0.0})

def _add(b, src, contrib, lon=None, lat=None):
    b["raw"] += contrib
    b["counts"][src] = b["counts"].get(src, 0) + 1
    if lon is not None and lat is not None:
        try:
            x, y = float(lon), float(lat)
            b["_lon"] += x*contrib; b["_lat"] += y*contrib; b["_w"] += contrib
        except (TypeError, ValueError):
            pass

def _ptkey(lat, lon):
    return f"{round(float(lat),1)}_{round(float(lon),1)}"

def aggregate_signals(snaps, polys, instab, cfg):
    acc = {}
    # conflict + military（同データ・別ドメイン）
    for e in (snaps.get("conflict") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _conflict_contrib(e, cfg)
        for dom in ("conflict", "military"):
            b = _bucket(acc, f"{dom}:{code}", dom, "country", code)
            lab = f"GDELT紛争 {e.get('mentions',0)}件" + (" ※近似(紛争データ流用)" if dom == "military" else "")
            _add(b, "conflict", c, e.get("lon"), e.get("lat"))
    # political
    for e in (snaps.get("protests") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        b = _bucket(acc, f"political:{code}", "political", "country", code)
        _add(b, "protests", _protest_contrib(e, cfg), e.get("lon"), e.get("lat"))
    # infra：quakes（地点）＋ news disaster（国）
    for q in (snaps.get("quakes") or {}).get("points", []) or []:
        c = _quake_contrib(q.get("mag"), cfg)
        if c <= 0:
            continue
        lat, lon = q.get("lat"), q.get("lon")
        if lat is None or lon is None:
            continue
        b = _bucket(acc, f"infra:{_ptkey(lat,lon)}", "infra", "point", _ptkey(lat, lon),
                    place_ja=q.get("place"))
        _add(b, "quakes", c, lon, lat)
    for it in (snaps.get("news") or {}).get("items", []) or []:
        if it.get("category") == "disaster":
            code = point_country(it.get("lon"), it.get("lat"), polys)
            if code:
                b = _bucket(acc, f"infra:{code}", "infra", "country", code)
                _add(b, "news", 0.6, it.get("lon"), it.get("lat"))
    # supply_chain：要衝近傍
    ships = (snaps.get("ships") or {}).get("points", []) or []
    quakes = (snaps.get("quakes") or {}).get("points", []) or []
    confs = (snaps.get("conflict") or {}).get("points", []) or []
    for cp in cfg.get("chokepoints", []):
        b = _bucket(acc, f"supply_chain:{cp['id']}", "supply_chain", "chokepoint", cp["id"], cp["name_ja"])
        b["_lat"], b["_lon"], b["_w"] = cp["lat"], cp["lon"], 1.0  # 固定座標
        for s in ships:
            if s.get("lat") is not None and s.get("lon") is not None and \
               _haversine_km(cp["lat"], cp["lon"], s["lat"], s["lon"]) <= cp["radius_km"]:
                b["raw"] += 0.05; b["counts"]["ships"] = b["counts"].get("ships", 0) + 1
        for e in confs:
            if e.get("lat") is not None and e.get("lon") is not None and \
               _haversine_km(cp["lat"], cp["lon"], e["lat"], e["lon"]) <= cp["radius_km"]:
                b["raw"] += _conflict_contrib(e, cfg); b["counts"]["conflict"] = b["counts"].get("conflict", 0) + 1
    # market / cyber：news キーワード（GLOBAL）
    for dom in ("market", "cyber"):
        kws = cfg["keywords"][dom]
        b = _bucket(acc, f"{dom}:GLOBAL", dom, "global", "GLOBAL")
        for it in (snaps.get("news") or {}).get("items", []) or []:
            text = f"{it.get('title_ja','')} {it.get('summary_ja','')}"
            if any(k in text for k in kws):
                _add(b, "news", 0.5)
    # 重心確定（point/country）
    for b in acc.values():
        w = b.pop("_w"); lo = b.pop("_lon"); la = b.pop("_lat")
        if b["scope"] in ("country", "point", "chokepoint") and w > 0:
            b["lat"] = round(la / w, 3); b["lon"] = round(lo / w, 3)
    return acc
```

- [ ] **Step 4: Run tests** → `python -m pytest tests/test_forecast.py -k "aggregate or market" -v` → Expected: PASS
- [ ] **Step 5: Commit**

```bash
git add config/forecast.json collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): config＋信号集約(8ドメイン×地理単位)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: score_attention（モメンタム主軸の決定論スコア）

**Files:**
- Modify: `collectors/lib/forecast.py`
- Test: `tests/test_forecast.py`

**Interfaces:**
- Consumes: `aggregate_signals` の `agg`、`forecast_history.json` 相当の `history`（`{key:[{t,raw,score}]}`）、`instab`（`instability.json` の `{countries:[{code,score}]}`）、`cfg`。
- Produces: `score_attention(agg, history, instab, cfg) -> list[dict]`。各要素に `key,domain,place_key,place_ja,scope,lat?,lon?,raw,score:int(0-100),level:int(1-5),signals,counts,momentum:float` を付与し score 降順。`_percentile(vals,pct)` も提供（instability から移植）。

- [ ] **Step 1: Write the failing test**

```python
def test_momentum_boosts_rising_signal():
    agg = {"conflict:UP": {"domain":"conflict","place_key":"UP","scope":"country",
            "raw":30.0,"signals":[],"counts":{"conflict":3},"lat":49,"lon":32,"place_ja":None}}
    # 平常 raw 中央値 10 → 今 30 は +200%
    hist = {"conflict:UP": [{"t":1,"raw":10,"score":20},{"t":2,"raw":9,"score":18},
                            {"t":3,"raw":11,"score":22}]}
    instab = {"countries":[{"code":"UP","score":70}]}
    out = F.score_attention(agg, hist, instab, CFG)
    assert out[0]["place_key"] == "UP"
    assert out[0]["score"] > 0 and 1 <= out[0]["level"] <= 5
    assert out[0]["momentum"] > 1.0  # 上昇

def test_first_run_no_history_neutral_momentum():
    agg = {"market:GLOBAL": {"domain":"market","place_key":"GLOBAL","scope":"global",
            "raw":5.0,"signals":[],"counts":{"news":5}}}
    out = F.score_attention(agg, {}, {}, CFG)  # 履歴なし
    assert out[0]["momentum"] == 1.0  # 中立
    assert out[0]["score"] >= 0
```

Run: `python -m pytest tests/test_forecast.py -k momentum -v` → FAIL

- [ ] **Step 2: Implement**

```python
def _median(vals):
    s = sorted(vals); n = len(s)
    if n == 0: return 0.0
    return float(s[n//2]) if n % 2 else (s[n//2-1] + s[n//2]) / 2.0

def _percentile(vals, pct):
    if not vals: return 0.0
    s = sorted(vals); k = (len(s)-1) * pct / 100.0
    f = math.floor(k); c = math.ceil(k)
    if f == c: return s[int(k)]
    return s[f]*(c-k) + s[c]*(k-f)

def _instab_score(instab, code):
    for c in (instab or {}).get("countries", []):
        if c.get("code") == code:
            return c.get("score", 0)
    return 0

def score_attention(agg, history, instab, cfg):
    w = cfg["weights"]; bl = cfg["baseline"]
    items = []
    for key, b in agg.items():
        hist = history.get(key, [])
        raws = [h["raw"] for h in hist]
        if len(raws) >= bl["min_samples"]:
            med = _median(raws)
            momentum = min(cfg["momentum_clamp"], b["raw"] / med) if med > 0 else \
                       (cfg["momentum_clamp"] if b["raw"] > 0 else 1.0)
        else:
            momentum = 1.0  # 履歴不足→中立（絶対水準主体）
        level_term = math.log1p(b["raw"])
        instab_term = (_instab_score(instab, b["place_key"]) / 100.0) \
            if b["domain"] in cfg["instab_domains"] and b["scope"] == "country" else 0.0
        raw_att = w["momentum"]*(momentum-1.0)*level_term + w["level"]*level_term + w["instab"]*instab_term*5.0
        b2 = dict(b); b2["key"] = key; b2["raw_att"] = max(0.0, raw_att); b2["momentum"] = round(momentum, 2)
        items.append(b2)
    base = _percentile([i["raw_att"] for i in items if i["raw_att"] > 0], cfg["normalize_pct"])
    th = cfg["level_thresholds"]
    for i in items:
        score = 0 if base <= 0 else max(0, min(100, round(100 * i["raw_att"] / base)))
        lvl = 1 + sum(1 for t in th if score >= t)
        i["score"] = int(score); i["level"] = int(lvl)
    items.sort(key=lambda i: (-i["score"], -sum(i["counts"].values())))
    return items
```

- [ ] **Step 3: Run** → `python -m pytest tests/test_forecast.py -k momentum -v` → PASS
- [ ] **Step 4: Commit**

```bash
git add collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): モメンタム主軸の決定論注視度スコア(P95正規化)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: confidence_of（決定論の信頼度帯）

**Files:** Modify `collectors/lib/forecast.py` / Test `tests/test_forecast.py`

**Interfaces:** Produces `confidence_of(item, cfg) -> "low"|"med"|"high"`。判定＝寄与した独立信号源（`counts` の非ゼロ src 数）。news only や market/cyber は常に low。

- [ ] **Step 1: Failing test**

```python
def test_confidence_by_signal_diversity():
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3,"news":1,"protests":1}}, CFG) == "high"
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3,"news":1}}, CFG) == "med"
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3}}, CFG) == "low"
    assert F.confidence_of({"domain":"market","counts":{"news":9}}, CFG) == "low"
    assert F.confidence_of({"domain":"cyber","counts":{"news":9}}, CFG) == "low"
```

Run: `python -m pytest tests/test_forecast.py -k confidence -v` → FAIL

- [ ] **Step 2: Implement**

```python
def confidence_of(item, cfg):
    if item.get("domain") in ("market", "cyber"):
        return "low"
    n = sum(1 for v in (item.get("counts") or {}).values() if v)
    return "high" if n >= 3 else "med" if n == 2 else "low"
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): confidence帯(信号多様性ベース・決定論)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: trend_of ＋ update_history

**Files:** Modify `collectors/lib/forecast.py` / Test `tests/test_forecast.py`

**Interfaces:**
- Produces `trend_of(score_now, hist, cfg) -> "up"|"flat"|"down"|"new"`（直近 hist の最新 score と比較）。
- Produces `update_history(history, items, now_ms, cfg) -> dict`（`{key:[{t,raw,score}]}`・7 日 FIFO）。

- [ ] **Step 1: Failing test**

```python
def test_trend_up_flat_down_new():
    assert F.trend_of(50, [], CFG) == "new"
    assert F.trend_of(50, [{"t":1,"raw":5,"score":40}], CFG) == "up"     # +10 >= up_delta(8)
    assert F.trend_of(40, [{"t":1,"raw":5,"score":42}], CFG) == "flat"   # -2
    assert F.trend_of(30, [{"t":1,"raw":5,"score":45}], CFG) == "down"   # -15

def test_update_history_appends_and_trims():
    old = {"conflict:UP": [{"t": 1, "raw": 5, "score": 40}]}
    items = [{"key":"conflict:UP","raw":9.0,"score":55}]
    out = F.update_history(old, items, now_ms=10_000_000_000, cfg=CFG)
    assert out["conflict:UP"][-1] == {"t": 10_000_000_000, "raw": 9.0, "score": 55}
```

Run: `python -m pytest tests/test_forecast.py -k "trend or history" -v` → FAIL

- [ ] **Step 2: Implement**

```python
def trend_of(score_now, hist, cfg):
    if not hist:
        return "new"
    ref = hist[-1]["score"]
    d = score_now - ref
    t = cfg["trend"]
    return "up" if d >= t["up_delta"] else "down" if d <= -t["down_delta"] else "flat"

def update_history(history, items, now_ms, cfg):
    cutoff = now_ms - cfg["history_days"] * 86400_000
    out = {}
    for it in items:
        k = it["key"]
        lst = [x for x in history.get(k, []) if x["t"] >= cutoff]
        lst.append({"t": int(now_ms), "raw": round(float(it["raw"]), 3), "score": int(it["score"])})
        out[k] = lst
    return out
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): trend判定＋history FIFO(7日)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: build_cards（カード組み立て・scope・signals・watch）

**Files:** Modify `collectors/lib/forecast.py` / Test `tests/test_forecast.py`

**Interfaces:** Produces `build_cards(items, history, fips_ja, now_ms, cfg) -> list[Card]`。各 item を Card 化：`signals` を `counts` から人間可読ラベルに、`place_ja`（country=fips_ja・point=既存 place_ja・chokepoint=name_ja・global="グローバル"）、`status`（`score < watch_score_min` または信号無し→`"watch"`）、`trend`=`trend_of`、`confidence`=`confidence_of`、`horizon="24-72h"`、`outlook_ja`/`rationale_ja`=""（AI 後付け）、`ai_generated=False`。各ドメイン上位 `domain_show` 件に絞る。

- [ ] **Step 1: Failing test**

```python
def test_build_cards_shape_and_watch():
    items = [{"key":"conflict:UP","domain":"conflict","place_key":"UP","scope":"country",
              "raw":30.0,"score":80,"level":5,"momentum":2.0,"lat":49,"lon":32,
              "counts":{"conflict":3,"news":1},"place_ja":None},
             {"key":"cyber:GLOBAL","domain":"cyber","place_key":"GLOBAL","scope":"global",
              "raw":0.0,"score":0,"level":1,"momentum":1.0,"counts":{},"place_ja":None}]
    cards = F.build_cards(items, history={}, fips_ja={"UP":"ウクライナ"}, now_ms=1, cfg=CFG)
    c0 = [c for c in cards if c["place_key"]=="UP"][0]
    assert c0["place_ja"] == "ウクライナ" and c0["scope"] == "country"
    assert c0["confidence"] in ("low","med","high") and c0["trend"] == "new"
    assert c0["status"] == "active" and c0["ai_generated"] is False
    assert any("紛争" in s["label"] for s in c0["signals"])
    cy = [c for c in cards if c["domain"]=="cyber"][0]
    assert cy["status"] == "watch"
```

Run: `python -m pytest tests/test_forecast.py -k build_cards -v` → FAIL

- [ ] **Step 2: Implement**

```python
_SIG_LABEL = {"conflict": "紛争", "protests": "抗議", "news": "報道", "quakes": "地震", "ships": "船舶"}
_SIG_SRC = {"conflict": "GDELT", "protests": "GDELT", "news": "news", "quakes": "USGS", "ships": "AIS"}

def _signals_from_counts(item):
    out = []
    for src, n in (item.get("counts") or {}).items():
        if n:
            out.append({"label": f"{_SIG_LABEL.get(src, src)} {n}件",
                        "source": _SIG_SRC.get(src, src), "kind": src})
    if item.get("momentum", 1.0) > 1.2:
        out.append({"label": f"勢い ×{item['momentum']}", "source": "trend", "kind": "momentum"})
    return out

def _place_ja(item, fips_ja):
    s = item["scope"]
    if s == "country":
        return fips_ja.get(item["place_key"], item["place_key"])
    if s == "global":
        return "グローバル"
    return item.get("place_ja") or item["place_key"]

def build_cards(items, history, fips_ja, now_ms, cfg):
    by_dom = {}
    cards = []
    for it in items:
        dom = it["domain"]
        by_dom[dom] = by_dom.get(dom, 0) + 1
        if by_dom[dom] > cfg["domain_show"]:
            continue
        no_signal = not any((it.get("counts") or {}).values())
        watch = it["score"] < cfg["watch_score_min"] or no_signal
        card = {
            "domain": dom, "scope": it["scope"],
            "place_ja": _place_ja(it, fips_ja), "place_key": it["place_key"],
            "attention_score": int(it["score"]), "attention_level": int(it["level"]),
            "trend": trend_of(it["score"], history.get(it["key"], []), cfg),
            "confidence": confidence_of(it, cfg), "horizon": "24-72h",
            "signals": _signals_from_counts(it),
            "outlook_ja": "", "rationale_ja": "", "ai_generated": False,
            "status": "watch" if watch else "active"}
        if isinstance(it.get("lat"), (int, float)) and isinstance(it.get("lon"), (int, float)) \
                and (it["lat"] or it["lon"]):
            card["lat"] = float(it["lat"]); card["lon"] = float(it["lon"])
        cards.append(card)
    return cards
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): build_cards(scope/signals/watch/trend/confidence)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: forecast_prompt ＋ parse_narratives ＋ sanitize（健全性）

**Files:** Modify `collectors/lib/forecast.py` / Test `tests/test_forecast.py`

**Interfaces:**
- Produces `FORECAST_SYSTEM`（system プロンプト）、`forecast_prompt(active_cards, cfg) -> str`（active かつ各ドメイン上位 `top_n_narrative` 件のみ・カードキーは `"<domain>:<place_key>"`）、`parse_narratives(text) -> dict`（`{key: {outlook, rationale}}`）、`is_advice(text) -> bool`（助言/禁止語検出）。

- [ ] **Step 1: Failing test**

```python
def test_forecast_prompt_lists_only_active_with_signals():
    cards = [{"domain":"conflict","place_key":"UP","place_ja":"ウクライナ","attention_score":80,
              "status":"active","signals":[{"label":"紛争 3件","source":"GDELT","kind":"conflict"}]},
             {"domain":"cyber","place_key":"GLOBAL","place_ja":"グローバル","attention_score":0,
              "status":"watch","signals":[]}]
    p = F.forecast_prompt(cards, CFG)
    assert "conflict:UP" in p and "ウクライナ" in p
    assert "cyber:GLOBAL" not in p  # watch は除外

def test_parse_narratives_ok():
    txt = '{"conflict:UP": {"outlook": "今後72hで再拡大の恐れ", "rationale": "紛争件数が増加"}}'
    d = F.parse_narratives(txt)
    assert d["conflict:UP"]["outlook"].startswith("今後")

def test_is_advice_detects_recommendation():
    assert F.is_advice("今すぐ株を買うべきだ") is True
    assert F.is_advice("攻撃を推奨する") is True
    assert F.is_advice("紛争件数が平常比で増加している") is False
```

Run: `python -m pytest tests/test_forecast.py -k "prompt or parse or advice" -v` → FAIL

- [ ] **Step 2: Implement**

```python
FORECAST_SYSTEM = (
    "あなたは地政学/リスクアナリストです。各項目について、与えたデータ（信号）のみを根拠に、"
    "今後24〜72hの『見通し(outlook)』と『なぜ注視か(rationale)』を日本語各1文で書きます。"
    "データに無い固有名詞・数値を作らない（捏造禁止）。"
    "投資・軍事・政治的行動などの助言は一切しない（推測の提示のみ）。"
    "断定を避け『〜の恐れ』『〜が起こりうる』等の不確実表現を使う。出力は JSON のみ。")

def forecast_prompt(cards, cfg):
    n = cfg["top_n_narrative"]
    per = {}
    lines = []
    for c in cards:
        if c.get("status") != "active":
            continue
        dom = c["domain"]; per[dom] = per.get(dom, 0) + 1
        if per[dom] > n:
            continue
        key = f'{dom}:{c["place_key"]}'
        sig = "; ".join(s["label"] for s in c.get("signals", []))
        lines.append(f'{key} | {c["place_ja"]} | score={c["attention_score"]} | 信号: {sig}')
    body = "\n".join(lines)
    return ('次の各項目について、与えた信号のみを根拠に '
            '{"<キー>": {"outlook":"…", "rationale":"…"}} の JSON で返してください。'
            '助言禁止・捏造禁止・不確実表現。\n\n' + body)

def parse_narratives(text):
    from collectors.lib.intel import _strip_fence
    import json as _j
    try:
        d = _j.loads(_strip_fence(text))
    except (ValueError, TypeError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, v in d.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        o = str(v.get("outlook", "")).strip()[:200]
        r = str(v.get("rationale", "")).strip()[:200]
        if o or r:
            out[k] = {"outlook": o, "rationale": r}
    return out

_ADVICE_RE = None
def is_advice(text):
    import re
    global _ADVICE_RE
    if _ADVICE_RE is None:
        _ADVICE_RE = re.compile(r"(べきだ|べきです|推奨|買う|売る|投資すべき|攻撃せよ|攻撃を推奨|おすすめ)")
    return bool(_ADVICE_RE.search(text or ""))
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): AIプロンプト＋parse＋助言検出(健全性)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: collectors/forecast.py（コレクタ・main・キーゲート）

**Files:** Create `collectors/forecast.py` / Test `tests/test_forecast.py`

**Interfaces:** `main()` が決定論カードを生成し、キーありなら Haiku で `outlook_ja`/`rationale_ja` を埋め（`is_advice` 検出時は破棄＝決定論降格）、`forecast.json`＋`forecast_history.json`＋manifest を書く。`collectors/instability.py` を雛形にする（`_load`/`_ask` 同型）。

- [ ] **Step 1: Failing test（キーゲート graceful の純粋部分）**

`apply_narratives(cards, narr) -> None`（in-place で active カードに outlook/rationale を充填・`is_advice` で破棄）を切り出してテスト：

```python
def test_apply_narratives_drops_advice():
    cards = [{"domain":"conflict","place_key":"UP","status":"active","outlook_ja":"","rationale_ja":"","ai_generated":False}]
    F.apply_narratives(cards, {"conflict:UP": {"outlook":"再拡大の恐れ","rationale":"件数増加"}})
    assert cards[0]["ai_generated"] is True and cards[0]["outlook_ja"] == "再拡大の恐れ"
    cards2 = [{"domain":"market","place_key":"GLOBAL","status":"active","outlook_ja":"","rationale_ja":"","ai_generated":False}]
    F.apply_narratives(cards2, {"market:GLOBAL": {"outlook":"今すぐ買うべきだ","rationale":"上昇"}})
    assert cards2[0]["ai_generated"] is False and cards2[0]["outlook_ja"] == ""  # 助言は破棄
```

Run: `python -m pytest tests/test_forecast.py -k apply_narratives -v` → FAIL

- [ ] **Step 2: Implement apply_narratives in forecast.py（lib）**

```python
def apply_narratives(cards, narr):
    for c in cards:
        if c.get("status") != "active":
            continue
        key = f'{c["domain"]}:{c["place_key"]}'
        n = narr.get(key)
        if not n:
            continue
        o, r = n.get("outlook", ""), n.get("rationale", "")
        if is_advice(o) or is_advice(r):
            continue  # 助言は破棄（決定論カードのまま）
        c["outlook_ja"] = o; c["rationale_ja"] = r; c["ai_generated"] = True
```

- [ ] **Step 3: Implement collectors/forecast.py**（instability コレクタを雛形に）

```python
"""AI FORECASTS：決定論注視度＋（任意で）Haikuナラティブを毎時合成。"""
import json, os
from datetime import datetime, timezone
from collectors.lib.manifest import update_manifest
from collectors.lib import forecast as F
from collectors.lib.geo_country import load_polygons

SNAP_DIR = "data/snapshots"
CONFIG_PATH = "config/forecast.json"
FIPS_PATH = "config/fips_countries.json"
BOUNDS_PATH = "data/static/country_bounds.geojson"
HISTORY_FILE = "forecast_history.json"
OUT_FILE = "forecast.json"
MODEL = "claude-haiku-4-5"
SNAP_FILES = {"conflict": "conflict.json", "protests": "protests.json", "news": "news.json",
              "quakes": "quakes.json", "ships": "ships.json"}

def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default

def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=MODEL, max_tokens=3000, temperature=0,
                                 system=F.FORECAST_SYSTEM,
                                 messages=[{"role": "user", "content": prompt}])
    return msg.content[0].text

def main():
    out_dir = os.path.abspath(SNAP_DIR); os.makedirs(out_dir, exist_ok=True)
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ"); now_ms = int(now.timestamp() * 1000)
    try:
        cfg = _load(CONFIG_PATH, None)
        if not cfg:
            print("[forecast] no config; skip"); return 1
        fips = _load(FIPS_PATH, {})
        polys = load_polygons(_load(BOUNDS_PATH, {"features": []}))
        snaps = {k: _load(os.path.join(out_dir, v), {}) for k, v in SNAP_FILES.items()}
        instab = _load(os.path.join(out_dir, "instability.json"), {})
        history = _load(os.path.join(out_dir, HISTORY_FILE), {})
        agg = F.aggregate_signals(snaps, polys, instab, cfg)
        items = F.score_attention(agg, history, instab, cfg)
        cards = F.build_cards(items, history, fips, now_ms, cfg)
        new_hist = F.update_history(history, items, now_ms, cfg)
    except Exception as e:
        print(f"[forecast] failed: {e}; keeping previous"); return 1
    model = None
    if os.environ.get("ANTHROPIC_API_KEY") and any(c["status"] == "active" for c in cards):
        try:
            F.apply_narratives(cards, F.parse_narratives(_ask(F.forecast_prompt(cards, cfg))))
            model = MODEL
        except Exception as e:
            print(f"[forecast] narrative skipped: {e}")
    snap = {"generated_at": now_iso, "model": model,
            "thresholds": {"level": cfg["level_thresholds"], "top_n": cfg["top_n_narrative"]},
            "cards": cards}
    with open(os.path.join(out_dir, OUT_FILE), "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, HISTORY_FILE), "w", encoding="utf-8") as f:
        json.dump(new_hist, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(os.path.join(out_dir, "manifest.json"), "forecast", now_iso, len(cards))
    print(f"[forecast] wrote {len(cards)} cards -> {OUT_FILE}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run** → `python -m pytest tests/test_forecast.py -v`（全 Python テスト）→ PASS。さらに手動 smoke：`python -m collectors.forecast`（キー無し＝決定論のみ・`data/snapshots/forecast.json` が `model:null` で生成されることを確認）。
- [ ] **Step 5: Commit**

```bash
git add collectors/forecast.py collectors/lib/forecast.py tests/test_forecast.py
git commit -m "feat(forecast): コレクタ(キーゲートgraceful・助言降格・manifest)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: .github/workflows/collect-forecast.yml（cron :37）

**Files:** Create `.github/workflows/collect-forecast.yml`

**Interfaces:** `collect-instability.yml` を雛形に、`:37` スケジュール・`python -m collectors.forecast` 実行・`forecast.json`/`forecast_history.json` を commit。

- [ ] **Step 1: 既存 `collect-instability.yml` を読み、同構造でコピー**。差分のみ変更：
  - `name:` を `collect-forecast`
  - `schedule: - cron: "37 * * * *"`
  - 実行ステップ：`python -m collectors.forecast`
  - commit 対象に `data/snapshots/forecast.json data/snapshots/forecast_history.json`
  - 既存 `ANTHROPIC_API_KEY` env を踏襲（追加 secret 不要）
- [ ] **Step 2: Commit**

```bash
git add .github/workflows/collect-forecast.yml
git commit -m "ci(forecast): 毎時:37 cron(既存ANTHROPIC_API_KEY流用)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: js/ui/forecast.js 純粋ヘルパ

**Files:** Create `js/ui/forecast.js` / Test `tests/forecast.test.js`

**Interfaces:** export `DOMAIN_LABEL`（map）、`domainColor(domain)`、`levelColor(score)`、`confBadge(conf)`、`trendArrow(dir)`、`filterByDomain(cards, domain)`（'all' で score 降順全件）、`cardHtml(card)`、`esc`。`cardHtml` は active/watch を出し分け、active には「🤖 AI生成・推測」を含める。

- [ ] **Step 1: Failing test**

```js
// tests/forecast.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { filterByDomain, cardHtml, confBadge, domainColor } from '../js/ui/forecast.js';

test('filterByDomain all returns score-desc', () => {
  const cards = [{domain:'conflict',attention_score:30},{domain:'market',attention_score:80}];
  assert.equal(filterByDomain(cards, 'all')[0].attention_score, 80);
  assert.equal(filterByDomain(cards, 'conflict').length, 1);
});

test('cardHtml active shows AI badge and escapes', () => {
  const h = cardHtml({domain:'conflict',place_ja:'<b>UP</b>',attention_score:80,attention_level:5,
    trend:'up',confidence:'high',horizon:'24-72h',signals:[{label:'紛争 3件'}],
    outlook_ja:'再拡大の恐れ',rationale_ja:'件数増加',ai_generated:true,status:'active'});
  assert.match(h, /AI生成/);
  assert.match(h, /&lt;b&gt;UP&lt;\/b&gt;/);   // esc
  assert.match(h, /再拡大の恐れ/);
});

test('cardHtml watch shows 監視中, no AI badge', () => {
  const h = cardHtml({domain:'cyber',place_ja:'グローバル',attention_score:0,attention_level:1,
    trend:'new',confidence:'low',signals:[],ai_generated:false,status:'watch'});
  assert.match(h, /監視中/);
  assert.doesNotMatch(h, /AI生成/);
});

test('confBadge maps level', () => {
  assert.match(confBadge('high'), /高/);
  assert.ok(domainColor('conflict'));
});
```

Run: `node --test tests/forecast.test.js` → FAIL

- [ ] **Step 2: Implement js/ui/forecast.js**

```js
// AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
export const DOMAIN_LABEL = { all:'ALL', conflict:'紛争', market:'市場', supply_chain:'供給網',
  political:'政治', military:'軍事', cyber:'サイバー', infra:'インフラ/災害' };
const DOMAIN_RGB = { conflict:[240,90,80], market:[120,200,120], supply_chain:[200,170,90],
  political:[150,160,240], military:[210,120,120], cyber:[120,200,230], infra:[240,190,80] };
const LEVEL_RGB = {1:[90,200,160],2:[150,210,90],3:[240,200,70],4:[245,150,60],5:[240,80,70]};
const CONF = { high:{t:'信頼度 高',c:'cf-high'}, med:{t:'信頼度 中',c:'cf-med'}, low:{t:'信頼度 低',c:'cf-low'} };

export function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,(m)=>(
  {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
export function domainColor(d){const[r,g,b]=DOMAIN_RGB[d]||[150,150,150];return`rgb(${r},${g},${b})`;}
export function levelColor(score){const[r,g,b]=LEVEL_RGB[Math.min(5,Math.max(1,1+Math.floor((score||0)/20)))];return`rgb(${r},${g},${b})`;}
export function confBadge(conf){const c=CONF[conf]||CONF.low;return`<span class="fc-conf ${c.c}">${c.t}</span>`;}
export function trendArrow(dir){return dir==='up'?'▲':dir==='down'?'▼':dir==='new'?'•':'─';}
export function filterByDomain(cards, domain){
  const list=(cards||[]).slice().sort((a,b)=>(b.attention_score||0)-(a.attention_score||0));
  return domain==='all'?list:list.filter((c)=>c.domain===domain);
}
export function cardHtml(card){
  const c=card||{}; const col=domainColor(c.domain);
  const sig=(c.signals||[]).map((s)=>`<span class="fc-sig">${esc(s.label)}</span>`).join('');
  if(c.status==='watch'){
    return `<div class="fc-card fc-watch" style="--dom:${col}">`
      +`<div class="fc-head"><span class="fc-dom">${esc(DOMAIN_LABEL[c.domain]||c.domain)}</span>`
      +`<span class="fc-place">${esc(c.place_ja||'')}</span></div>`
      +`<p class="fc-watchmsg">十分な信号なし・監視中</p></div>`;
  }
  const ai=c.ai_generated?'<span class="fc-ai">🤖 AI生成・推測</span>':'';
  const out=c.outlook_ja?`<p class="fc-out">${esc(c.outlook_ja)}</p>`:'';
  const rat=c.rationale_ja?`<p class="fc-rat">根拠: ${esc(c.rationale_ja)}</p>`:'';
  return `<div class="fc-card" style="--dom:${col};--lvl:${levelColor(c.attention_score)}">`
    +`<div class="fc-head"><span class="fc-dom">${esc(DOMAIN_LABEL[c.domain]||c.domain)}</span>`
    +`<span class="fc-place">${esc(c.place_ja||'')}</span>`
    +`<span class="fc-tr fc-${esc(c.trend)}">${trendArrow(c.trend)}</span></div>`
    +`<div class="fc-bar"><span class="fc-fill" style="width:${Math.max(0,Math.min(100,c.attention_score||0))}%"></span></div>`
    +`<div class="fc-meta"><span class="fc-score">注視度 ${esc(c.attention_score||0)}</span>`
    +confBadge(c.confidence)+`<span class="fc-hz">${esc(c.horizon||'')}</span>${ai}</div>`
    +`<div class="fc-sigs">${sig}</div>`+out+rat+`</div>`;
}
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add js/ui/forecast.js tests/forecast.test.js
git commit -m "feat(forecast): フロント純粋ヘルパ(card/tab/conf/esc)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: renderForecasts（タブ＋カードリスト＋予測ログ折りたたみ＋flyTo）

**Files:** Modify `js/ui/forecast.js` / Test `tests/forecast.test.js`

**Interfaces:** `renderForecasts(rootEl, data, {onSelect}) -> void`。`rootEl` 内に `.fc-tabs`（ドメインタブ）と `.fc-list`（カード）を構築。タブクリックで該当ドメインに再描画。座標ありカードクリックで `onSelect(card)`。`#forecasts` の DOM 契約：`.fc-tabs` `.fc-list` `.fc-log`（折りたたみ）。テストは jsdom 無しで `globalThis.document` のスタブが要るため、DOM 操作は最小にし純粋ヘルパに寄せる（描画は e2e で主検証）。ここでは `tabsHtml(active)` を純粋関数化してテスト。

- [ ] **Step 1: Failing test（tabsHtml）**

```js
import { tabsHtml } from '../js/ui/forecast.js';
test('tabsHtml marks active and lists all domains', () => {
  const h = tabsHtml('conflict');
  assert.match(h, /data-dom="all"/);
  assert.match(h, /data-dom="conflict"[^>]*fc-tab-active/);
  assert.match(h, /data-dom="cyber"/);
});
```

Run: `node --test tests/forecast.test.js` → FAIL

- [ ] **Step 2: Implement（forecast.js に追記）**

```js
const TAB_ORDER = ['all','conflict','political','infra','supply_chain','military','market','cyber'];
export function tabsHtml(active){
  return TAB_ORDER.map((d)=>`<button type="button" class="fc-tab${d===active?' fc-tab-active':''}" `
    +`data-dom="${d}">${esc(DOMAIN_LABEL[d])}</button>`).join('');
}
export function renderForecasts(rootEl, data, { onSelect } = {}){
  if(!rootEl) return;
  const cards=(data&&data.cards)||[];
  const tabs=rootEl.querySelector('.fc-tabs');
  const list=rootEl.querySelector('.fc-list');
  if(!tabs||!list) return;
  let active='all';
  const draw=()=>{
    tabs.innerHTML=tabsHtml(active);
    list.innerHTML='';
    filterByDomain(cards, active).forEach((c)=>{
      const el=document.createElement('button'); el.type='button'; el.className='fc-cardbtn';
      el.innerHTML=cardHtml(c);
      if(typeof c.lat==='number'&&typeof c.lon==='number'&&(c.lat||c.lon)&&onSelect){
        el.addEventListener('click',()=>onSelect(c));
      } else { el.disabled=true; }
      list.appendChild(el);
    });
    tabs.querySelectorAll('.fc-tab').forEach((b)=>b.addEventListener('click',()=>{active=b.dataset.dom;draw();}));
  };
  draw();
}
```

- [ ] **Step 3: Run → PASS / Step 4: Commit**

```bash
git add js/ui/forecast.js tests/forecast.test.js
git commit -m "feat(forecast): renderForecasts(タブ切替・flyTo配線)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: 統合（index.html #forecasts ＋ main.js 配線 ＋ css ＋ sw v40）

**Files:** Modify `index.html`、`js/main.js`、`css/orbis.css`、`sw.js`

**Interfaces:** Consumes `renderForecasts`／`data/snapshots/forecast.json`。instability 配線をミラーする。

- [ ] **Step 1: index.html に `#forecasts` を `#instability` の直後に追加**

既存 `#instability` ブロックを参照し、同階層に：

```html
<section id="forecasts" class="panel-section" aria-label="AI予測">
  <h2 class="fc-title">🔮 AI FORECASTS <span class="fc-sub">ドメイン別リスク見通し（AI生成・推測）</span></h2>
  <div class="fc-tabs"></div>
  <div class="fc-list"></div>
  <details class="fc-log"><summary>過去の注視推移</summary><div class="fc-log-body"></div></details>
</section>
```

- [ ] **Step 2: js/main.js に配線（instability の fetch+render+onSelect をミラー）**

既存の instability 配線箇所を探し（`renderInstability` 呼び出し付近）、同型で：

```js
import { renderForecasts } from './ui/forecast.js';
// ... instability と同じ fetch パターン
fetch('data/snapshots/forecast.json').then((r)=>r.ok?r.json():null).then((fc)=>{
  if(!fc) return;
  renderForecasts(document.getElementById('forecasts'), fc, {
    onSelect: (card)=>{ /* instability onSelect と同じ flyTo＋リティクル。layerId='forecast' */ }
  });
}).catch(()=>{});
```
（onSelect は instability の onSelect 関数本体を再利用：座標へ `map.flyTo`＋`selection.js` のリティクル。座標は `card.lat`/`card.lon`。）

- [ ] **Step 3: css/orbis.css に `#forecasts` スタイル追加**

instability（`.ins-*`）のグラス/ネオン言語を踏襲し `.fc-*`（`.fc-tabs`/`.fc-tab`/`.fc-tab-active`/`.fc-card`/`.fc-bar`/`.fc-fill`/`.fc-conf`/`.fc-ai`/`.fc-watch`/`.fc-log`）を定義。ドメイン色は `--dom`、注視度色は `--lvl` を使用。**既存 CSS 末尾に追記し、既存ブロックと衝突しないこと**（過去にセクション末尾の衝突あり→両ブロック保持で解決）。

- [ ] **Step 4: sw.js を v40 に**

```bash
# sw.js の CACHE 名 orbis-v39 → orbis-v40
```

- [ ] **Step 5: ローカル視覚サニティ**：`python -m collectors.forecast`（seed）→ `python -m http.server` → ブラウザで `#forecasts` のタブ/カード/監視中/score バー/AI バッジを目視 → seed を `git checkout` で破棄（本番は cron 生成）。
- [ ] **Step 6: Commit**

```bash
git add index.html js/main.js css/orbis.css sw.js
git commit -m "feat(forecast): #forecasts統合(配線・css・SW v40)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 12: e2e（forecast.spec.js・route mock）

**Files:** Create `tests/e2e/forecast.spec.js`

**Interfaces:** Playwright で `forecast.json` を route mock し、セクション描画・タブ切替・カードクリック flyTo・「AI生成」バッジ・監視中カードを検証。`workers:1`。既存 `instability.spec.js`/`briefing.spec.js` を雛形に。

- [ ] **Step 1: Write e2e**

```js
// tests/e2e/forecast.spec.js
import { test, expect } from '@playwright/test';
const MOCK = { generated_at:'2026-06-21T12:37:00Z', model:'claude-haiku-4-5',
  thresholds:{level:[20,40,60,80],top_n:4},
  cards:[
    {domain:'conflict',scope:'country',place_ja:'ウクライナ',place_key:'UP',lat:49,lon:32,
     attention_score:82,attention_level:5,trend:'up',confidence:'high',horizon:'24-72h',
     signals:[{label:'紛争 3件',source:'GDELT',kind:'conflict'}],
     outlook_ja:'今後72hで再拡大の恐れ',rationale_ja:'件数が平常比増加',ai_generated:true,status:'active'},
    {domain:'cyber',scope:'global',place_ja:'グローバル',place_key:'GLOBAL',
     attention_score:0,attention_level:1,trend:'new',confidence:'low',
     signals:[],outlook_ja:'',rationale_ja:'',ai_generated:false,status:'watch'}]};

test('forecasts: render, tabs, flyTo, AI badge', async ({ page }) => {
  await page.route('**/data/snapshots/forecast.json', (r)=>r.fulfill({json:MOCK}));
  await page.goto('/');
  const sec = page.locator('#forecasts');
  await expect(sec.locator('.fc-tab')).toHaveCount(8);
  await expect(sec.locator('.fc-card').first()).toContainText('ウクライナ');
  await expect(sec.locator('.fc-ai').first()).toContainText('AI生成');
  // conflict タブ
  await sec.locator('.fc-tab[data-dom="conflict"]').click();
  await expect(sec.locator('.fc-card')).toHaveCount(1);
  // cyber タブ→監視中
  await sec.locator('.fc-tab[data-dom="cyber"]').click();
  await expect(sec.locator('.fc-watch')).toBeVisible();
  // ALL に戻してカードクリック→flyTo（地図移動）
  await sec.locator('.fc-tab[data-dom="all"]').click();
  await sec.locator('.fc-cardbtn').first().click();
  // flyTo の副作用（リティクル等）はスモーク：エラーが出ないこと
});
```

- [ ] **Step 2: Run** → `npx playwright test tests/e2e/forecast.spec.js` → PASS（必要なら `playwright.config` に既存同様 `test.setTimeout` を踏襲）。
- [ ] **Step 3: Commit**

```bash
git add tests/e2e/forecast.spec.js
git commit -m "test(forecast): e2e(route mock・タブ/flyTo/AIバッジ/監視中)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review（spec 対応確認）

- **spec §1-2 方針**：4 核心 = T2(モメンタム)/T5(8ドメイン watch)/T6(決定論+AI分離)/T4(history) で実装。✓
- **spec §3 アーキ**：T7 コレクタが briefing/instability と同型。✓
- **spec §4 注視度**：T2(モメンタム/P95)・T3(confidence)・T4(trend)・§4.4 scope=T1/T5。✓
- **spec §5 データ契約**：forecast.json/Card/history を T5/T7/T4 が生成。✓
- **spec §6 ドメインマッピング**：T1 集約に 8 ドメイン分。Market/Cyber=news キーワード。✓
- **spec §7 健全性**：AI バッジ=T9、confidence=T3/T9、助言回避=T6/T7(is_advice/apply_narratives)、捏造=T6 プロンプト、XSS=T9 esc、watch=T5。✓
- **spec §8 予測ログ**：history=T4、UI 折りたたみ=T11(`.fc-log`)。※第1弾は枠のみ（中身の推移描画は最小）。
- **spec §9 頻度/モデル/キーゲート**：T7(Haiku/max3000/キーゲート)・T8(cron:37)。✓
- **spec §10 UI**：T9-T11。✓
- **spec §11 テスト**：pytest=T1-7、node=T9-10、e2e=T12。✓
- **spec §12 ファイル**：全て対応。✓
- **型整合**：`key="<domain>:<place_key>"` を T1/T2/T4/T6/T7 で統一。Card フィールド名を T5/T9/T12 で統一（`attention_score`/`place_ja`/`status`/`ai_generated`）。✓

**注意（実装者向け）**：
- T11 の予測ログ `.fc-log` は第1弾では「枠＋簡易表示」。推移の本格可視化は将来。
- T1 の `military` は紛争データ流用の近似。signal label に明示済み。
- `instability.json` が未生成でも `instab={}` で graceful（infra/market 等は動く）。
