# 国家不安定性インデックス 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存OSINTスナップショット（GDELT紛争/抗議・USGS地震・翻訳ニュース）から国別の決定論的「不安定性スコア」＋トレンド（昨日比/平常比）＋上位国のAIナラティブを毎時合成し、briefing 下の新セクションにランキング/急上昇として描画する。

**Architecture:** Python 純粋関数（`geo_country` 点内判定＋`instability` 集約/スコア/トレンド/ナラティブ）→ `collectors/instability.py` が IO/LLM/履歴を束ねて `instability.json`＋`instability_history.json` を生成（毎時 cron）。フロントは `js/ui/instability.js`（純粋ヘルパ＋`renderInstability`）が `#instability` を描画し、クリックで globe flyTo。globe レイヤーは増やさない。

**Tech Stack:** Python 3.12（新規pip依存なし・PIPは純Python）／Vanilla JS ESモジュール／node:test／Playwright（workers:1）／anthropic（既存・Haiku）。

## Global Constraints

- 国キーは **FIPS 10-4 を正準**（GDELT準拠。CH=中国/AS=豪州 等）。news/quakes は lat/lon→FIPS に解決。
- **新規 pip 依存を増やさない**（点内判定は純Python ray-casting）。
- **globe デッキレイヤーを増やさない**（UIは DOM セクション＋既存 flyTo のみ）。
- 決定論部分は **ANTHROPIC_API_KEY 不要で必ず出力**。ナラティブのみキーゲート（未設定/失敗でも score/trend は出す＝graceful degradation）。
- コレクタは **best-effort**（例外時は前回 `instability.json` を温存・他コレクタと同方針）。
- スコア定数は **`config/instability.json` に集約**。テストは「振る舞い（単調性・寄与・境界）」を固定し、定数値そのものは固定しない。
- XSS 防止：表示 URL は `http(s)` のみ・テキストはエスケープ/`textContent`。
- Service Worker は index.html/main.js/css 変更時に **`orbis-v37`→`orbis-v38`**。
- 検証コマンド：`python -m pytest tests/ -q` ／ `npm run test:js` ／ `npm run test:e2e`。
- コミットはこまめに（タスク単位）。コミット文は日本語。

---

### Task 1: 設定ファイル（重み定数＋FIPS→日本語名）

**Files:**
- Create: `config/instability.json`
- Create: `config/fips_countries.json`
- Test: `tests/test_instability_config.py`

**Interfaces:**
- Produces: `config/instability.json`（`root_w, protest_w, news_sev, quake{mag_min,base,cap}, tone_div, tone_clamp, weights{conflict,protests,news,quakes}, normalize_pct, top_n_narrative, rank_show, movers_show, history_days, trend{...}`）／`config/fips_countries.json`（`{ "JA":"日本", ... }`）。

- [ ] **Step 1: 失敗するテストを書く**

```python
# tests/test_instability_config.py
import json

def test_instability_config_shape():
    cfg = json.load(open("config/instability.json", encoding="utf-8"))
    for k in ["root_w","protest_w","news_sev","quake","tone_div","tone_clamp",
              "weights","normalize_pct","top_n_narrative","rank_show","movers_show",
              "history_days","trend"]:
        assert k in cfg, k
    assert set(cfg["weights"]) == {"conflict","protests","news","quakes"}
    assert cfg["quake"]["mag_min"] > 0
    for k in ["dod_hours","dod_tol_hours","dod_delta","normal_pct","normal_min_samples"]:
        assert k in cfg["trend"], k

def test_fips_countries_known_entries():
    fips = json.load(open("config/fips_countries.json", encoding="utf-8"))
    assert fips["JA"] == "日本"
    assert fips["CH"] == "中国"     # FIPS の罠（ISO とは別系統）
    assert fips["IZ"] == "イラク"
    assert len(fips) > 150
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability_config.py -q`
Expected: FAIL（ファイルが無い）

- [ ] **Step 3: `config/instability.json` を作成**

```json
{
  "root_w": {"18": 1.0, "19": 1.3, "20": 1.8},
  "protest_w": 0.6,
  "news_sev": {"conflict": 1.0, "disaster": 0.9, "environment": 0.4, "politics": 0.5,
               "economy": 0.3, "society": 0.3, "science": 0.2, "other": 0.2},
  "quake": {"mag_min": 4.5, "base": 2.0, "cap": 8.0},
  "tone_div": 6.0,
  "tone_clamp": 12.0,
  "weights": {"conflict": 1.0, "protests": 0.8, "news": 1.5, "quakes": 1.2},
  "normalize_pct": 95,
  "top_n_narrative": 8,
  "rank_show": 15,
  "movers_show": 5,
  "history_days": 7,
  "trend": {"dod_hours": 24, "dod_tol_hours": 6, "dod_delta": 5, "normal_pct": 15, "normal_min_samples": 3}
}
```

- [ ] **Step 4: `config/fips_countries.json` を `js/lib/places.js` の `FIPS_JA` から生成**

Run（worktree ルートで・`FIPS_JA` の中身を JSON 化して書き出す）:
```bash
python3 - <<'PY'
import re, json
src = open("js/lib/places.js", encoding="utf-8").read()
m = re.search(r"FIPS_JA\s*=\s*\{(.*?)\}\s*;", src, re.S)
body = m.group(1)
pairs = re.findall(r"([A-Z]{2})\s*:\s*'([^']*)'", body)
d = {k: v for k, v in pairs}
json.dump(d, open("config/fips_countries.json","w",encoding="utf-8"), ensure_ascii=False, indent=0)
print("wrote", len(d), "entries")
PY
```
（`FIPS_JA` が単一引用符なので上記正規表現で抽出。`places.js` 側はフロント用にそのまま残す＝二重管理を避けるため将来この JSON へ寄せられるが本PJでは触らない。）

- [ ] **Step 5: テストが通ることを確認**

Run: `python -m pytest tests/test_instability_config.py -q`
Expected: PASS（`len(fips) > 150` 含む）

- [ ] **Step 6: コミット**

```bash
git add config/instability.json config/fips_countries.json tests/test_instability_config.py
git commit -m "feat(instability): スコア定数とFIPS→日本語名の設定ファイル"
```

---

### Task 2: 国境ポリゴン点内判定 `geo_country.py`

**Files:**
- Create: `collectors/lib/geo_country.py`
- Create: `data/static/country_bounds.geojson`（Natural Earth 110m Admin-0 を簡略化・FIPS付）
- Test: `tests/test_geo_country.py`

**Interfaces:**
- Produces:
  - `load_polygons(geojson: dict) -> list[dict]`（各 `{code:str, name:str|None, bbox:(minx,miny,maxx,maxy), rings:list[list[tuple[float,float]]]}`）
  - `point_country(lon, lat, polys: list) -> str|None`（lon/lat が None/範囲外→None、海洋等で無一致→None）

- [ ] **Step 1: 国境データを取得・簡略化して同梱**

Run（FIPS_10_ と NAME とジオメトリだけ残す。Public Domain）:
```bash
python3 - <<'PY'
import json, urllib.request
URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
raw = json.load(urllib.request.urlopen(URL, timeout=60))
feats = []
for f in raw["features"]:
    p = f.get("properties") or {}
    fips = p.get("FIPS_10_") or p.get("FIPS_10") or ""
    fips = (fips or "").strip()
    if not fips or fips.startswith("-99"):
        continue
    feats.append({"type":"Feature",
                  "properties":{"code":fips,"name":p.get("NAME") or p.get("ADMIN")},
                  "geometry":f["geometry"]})
out = {"type":"FeatureCollection","features":feats}
json.dump(out, open("data/static/country_bounds.geojson","w",encoding="utf-8"),
          ensure_ascii=False, separators=(",",":"))
print("countries:", len(feats))
PY
```
Expected: `countries:` がおおむね 170 以上。

- [ ] **Step 2: 失敗する能力テストを書く**

```python
# tests/test_geo_country.py
import json
from collectors.lib.geo_country import load_polygons, point_country

def _polys():
    return load_polygons(json.load(open("data/static/country_bounds.geojson", encoding="utf-8")))

def test_known_points_resolve_to_fips():
    polys = _polys()
    assert point_country(139.69, 35.68, polys) == "JA"   # 東京
    assert point_country(2.35, 48.85, polys) == "FR"      # パリ
    assert point_country(31.24, 30.04, polys) == "EG"     # カイロ
    assert point_country(-149.9, 61.2, polys) == "US"     # アンカレッジ（マルチポリゴン）

def test_ocean_and_bad_input_return_none():
    polys = _polys()
    assert point_country(-140.0, 0.0, polys) is None      # 太平洋中央
    assert point_country(None, None, polys) is None
    assert point_country("x", "y", polys) is None
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `python -m pytest tests/test_geo_country.py -q`
Expected: FAIL（モジュール無し）

- [ ] **Step 4: `geo_country.py` を実装**

```python
# collectors/lib/geo_country.py
"""国境ポリゴンの点内判定（純Python ray-casting）。lat/lon→FIPS 国コード。"""


def load_polygons(geojson):
    polys = []
    for f in (geojson.get("features") or []):
        props = f.get("properties") or {}
        code = props.get("code")
        if not code:
            continue
        geom = f.get("geometry") or {}
        gtype = geom.get("type")
        coords = geom.get("coordinates") or []
        rings = []
        if gtype == "Polygon":
            rings = [[(pt[0], pt[1]) for pt in ring] for ring in coords]
        elif gtype == "MultiPolygon":
            for poly in coords:
                for ring in poly:
                    rings.append([(pt[0], pt[1]) for pt in ring])
        if not rings:
            continue
        xs = [pt[0] for r in rings for pt in r]
        ys = [pt[1] for r in rings for pt in r]
        polys.append({"code": code, "name": props.get("name"),
                      "bbox": (min(xs), min(ys), max(xs), max(ys)), "rings": rings})
    return polys


def _point_in_rings(x, y, rings):
    """全リング横断の even-odd（穴・マルチポリゴンを正しく扱う）。"""
    inside = False
    for ring in rings:
        n = len(ring)
        j = n - 1
        for i in range(n):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
    return inside


def point_country(lon, lat, polys):
    if lon is None or lat is None:
        return None
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return None
    for p in polys:
        b = p["bbox"]
        if x < b[0] or x > b[2] or y < b[1] or y > b[3]:
            continue
        if _point_in_rings(x, y, p["rings"]):
            return p["code"]
    return None
```

- [ ] **Step 5: テストが通ることを確認**

Run: `python -m pytest tests/test_geo_country.py -q`
Expected: PASS（4点の国一致＋海洋/不正入力 None）

- [ ] **Step 6: コミット**

```bash
git add collectors/lib/geo_country.py data/static/country_bounds.geojson tests/test_geo_country.py
git commit -m "feat(instability): 国境ポリゴン点内判定(geo_country)とNE110m同梱"
```

---

### Task 3: 集約 `instability.aggregate`

**Files:**
- Create: `collectors/lib/instability.py`
- Test: `tests/test_instability.py`

**Interfaces:**
- Consumes: `geo_country.point_country`、Task1 の cfg。
- Produces: `aggregate(snaps: dict, polys: list, cfg: dict) -> dict[str, dict]`。
  - 戻り値 `code -> {conflict:float, protests:float, news:float, quakes:float, counts:{conflict,protests,news,quakes:int}, lat:float, lon:float, top_events:list[{title,place,url}]}`。
  - `snaps` は `{"conflict":{...},"protests":{...},"news":{...},"quakes":{...}}`（各スナップショット dict、欠落可）。

- [ ] **Step 1: 失敗するテストを書く**

```python
# tests/test_instability.py
import json
from collectors.lib import instability as I

CFG = json.load(open("config/instability.json", encoding="utf-8"))

# 小さな手製ポリゴン（四角）: code "XA" = 経度0..10,緯度0..10
SQUARE = {"features": [{"type": "Feature", "properties": {"code": "XA", "name": "Square"},
          "geometry": {"type": "Polygon",
          "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}}]}

def _polys():
    from collectors.lib.geo_country import load_polygons
    return load_polygons(SQUARE)

def test_aggregate_conflict_protests_by_fips():
    snaps = {
        "conflict": {"points": [
            {"place": "IZ", "root": "19", "mentions": 9, "tone": "-6", "lon": 44.0, "lat": 33.0},
            {"place": "IZ", "root": "20", "mentions": 0, "tone": "-2", "lon": 44.1, "lat": 33.1}]},
        "protests": {"points": [
            {"place": "US", "root": "14", "mentions": 4, "tone": "-1", "lon": -77.0, "lat": 38.9}]},
    }
    agg = I.aggregate(snaps, [], CFG)
    assert agg["IZ"]["counts"]["conflict"] == 2
    assert agg["IZ"]["conflict"] > 0
    assert agg["US"]["counts"]["protests"] == 1
    # 重心は寄与イベント近傍
    assert 43.5 < agg["IZ"]["lon"] < 44.5

def test_aggregate_news_quakes_resolved_by_polygon():
    snaps = {
        "news": {"items": [
            {"category": "conflict", "lon": 5.0, "lat": 5.0, "title_ja": "見出し", "url": "https://x"},
            {"category": "politics", "lon": 99.0, "lat": 80.0, "title_ja": "圏外", "url": "https://y"}]},
        "quakes": {"points": [
            {"mag": 6.0, "lon": 6.0, "lat": 6.0, "place": "near XA", "url": "https://q"},
            {"mag": 2.0, "lon": 6.0, "lat": 6.0, "place": "tiny", "url": "https://q2"}]},
    }
    agg = I.aggregate(snaps, _polys(), CFG)
    assert agg["XA"]["counts"]["news"] == 1      # 圏外(99,80)は None で除外
    assert agg["XA"]["counts"]["quakes"] == 1    # mag2.0 は閾値未満で除外
    assert agg["XA"]["news"] > 0 and agg["XA"]["quakes"] > 0
    assert any(ev["title"] == "見出し" for ev in agg["XA"]["top_events"])
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: FAIL（`aggregate` 無し）

- [ ] **Step 3: `aggregate` と寄与ヘルパを実装**

```python
# collectors/lib/instability.py
"""国家不安定性インデックス（純粋）。集約→スコア→トレンド→ナラティブ。"""
import math

from collectors.lib.geo_country import point_country


def _tone_pen(tone, cfg):
    try:
        t = float(tone)
    except (TypeError, ValueError):
        t = 0.0
    return 1 + min(max(-t, 0.0), cfg["tone_clamp"]) / cfg["tone_div"]


def _conflict_contrib(e, cfg):
    w = cfg["root_w"].get(str(e.get("root")), 1.0)
    return w * math.log1p(e.get("mentions", 0) or 0) * _tone_pen(e.get("tone"), cfg)


def _protest_contrib(e, cfg):
    return cfg["protest_w"] * math.log1p(e.get("mentions", 0) or 0) * _tone_pen(e.get("tone"), cfg)


def _quake_contrib(mag, cfg):
    q = cfg["quake"]
    if mag is None or mag < q["mag_min"]:
        return 0.0
    return min(q["cap"], q["base"] ** (mag - q["mag_min"]))


def _bucket(acc, code):
    return acc.setdefault(code, {
        "conflict": 0.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
        "counts": {"conflict": 0, "protests": 0, "news": 0, "quakes": 0},
        "_lat": 0.0, "_lon": 0.0, "_w": 0.0, "top_events": []})


def _addpt(b, lon, lat, w):
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return
    b["_lon"] += x * w
    b["_lat"] += y * w
    b["_w"] += w


def _add_event(b, title, place, url):
    if len(b["top_events"]) < 3 and isinstance(url, str) and url.startswith(("http://", "https://")):
        b["top_events"].append({"title": str(title or ""), "place": str(place or ""), "url": url})


def aggregate(snaps, polys, cfg):
    acc = {}
    for e in (snaps.get("conflict") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _conflict_contrib(e, cfg)
        b = _bucket(acc, code)
        b["conflict"] += c
        b["counts"]["conflict"] += 1
        _addpt(b, e.get("lon"), e.get("lat"), c)
    for e in (snaps.get("protests") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _protest_contrib(e, cfg)
        b = _bucket(acc, code)
        b["protests"] += c
        b["counts"]["protests"] += 1
        _addpt(b, e.get("lon"), e.get("lat"), c)
    for it in (snaps.get("news") or {}).get("items", []) or []:
        code = point_country(it.get("lon"), it.get("lat"), polys)
        if not code:
            continue
        c = cfg["news_sev"].get(it.get("category"), cfg["news_sev"]["other"])
        b = _bucket(acc, code)
        b["news"] += c
        b["counts"]["news"] += 1
        _addpt(b, it.get("lon"), it.get("lat"), c)
        _add_event(b, it.get("title_ja"), it.get("place"), it.get("url"))
    for q in (snaps.get("quakes") or {}).get("points", []) or []:
        c = _quake_contrib(q.get("mag"), cfg)
        if c <= 0:
            continue
        code = point_country(q.get("lon"), q.get("lat"), polys)
        if not code:
            continue
        b = _bucket(acc, code)
        b["quakes"] += c
        b["counts"]["quakes"] += 1
        _addpt(b, q.get("lon"), q.get("lat"), c)
        _add_event(b, f"M{q.get('mag')} 地震", q.get("place"), q.get("url"))
    # 重心を確定
    for b in acc.values():
        w = b.pop("_w")
        lon = b.pop("_lon")
        lat = b.pop("_lat")
        b["lat"] = round(lat / w, 3) if w > 0 else 0.0
        b["lon"] = round(lon / w, 3) if w > 0 else 0.0
    return acc
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/instability.py tests/test_instability.py
git commit -m "feat(instability): 4シグナルの国別集約(aggregate)"
```

---

### Task 4: スコア化 `score_countries`

**Files:**
- Modify: `collectors/lib/instability.py`
- Test: `tests/test_instability.py`（追記）

**Interfaces:**
- Consumes: `aggregate` の戻り値、cfg、`fips_ja: dict`。
- Produces: `score_countries(agg: dict, cfg: dict, fips_ja: dict) -> list[dict]`。
  - 各要素 `{code, name_ja, score:int(0-100), level:int(1-5), rank:int, lat, lon, components:{conflict,protests,news,quakes:float}, counts:{...}, top_events:list}`。score 降順、rank は1始まり。

- [ ] **Step 1: 失敗するテストを追記**

```python
# tests/test_instability.py に追記
def test_score_normalizes_and_ranks():
    agg = {
        "IZ": {"conflict": 100.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
               "counts": {"conflict": 50, "protests": 0, "news": 0, "quakes": 0},
               "lat": 33.0, "lon": 44.0, "top_events": []},
        "US": {"conflict": 10.0, "protests": 5.0, "news": 0.0, "quakes": 0.0,
               "counts": {"conflict": 5, "protests": 3, "news": 0, "quakes": 0},
               "lat": 38.0, "lon": -77.0, "top_events": []},
    }
    fips = {"IZ": "イラク", "US": "アメリカ合衆国"}
    out = I.score_countries(agg, CFG, fips)
    assert [c["code"] for c in out] == ["IZ", "US"]      # score 降順
    assert out[0]["rank"] == 1 and out[0]["name_ja"] == "イラク"
    assert 0 <= out[1]["score"] <= 100 and out[0]["score"] >= out[1]["score"]
    assert 1 <= out[0]["level"] <= 5
    assert set(out[0]["components"]) == {"conflict", "protests", "news", "quakes"}

def test_score_all_zero_safe():
    out = I.score_countries({"XX": {"conflict": 0.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
                                    "counts": {"conflict": 0, "protests": 0, "news": 0, "quakes": 0},
                                    "lat": 0, "lon": 0, "top_events": []}}, CFG, {})
    assert out[0]["score"] == 0 and out[0]["level"] == 1
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: FAIL（`score_countries` 無し）

- [ ] **Step 3: `score_countries` と percentile を実装（`instability.py` に追記）**

```python
def _percentile(vals, pct):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * pct / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def score_countries(agg, cfg, fips_ja):
    w = cfg["weights"]
    raws = {code: (w["conflict"] * b["conflict"] + w["protests"] * b["protests"]
                   + w["news"] * b["news"] + w["quakes"] * b["quakes"])
            for code, b in agg.items()}
    base = _percentile([v for v in raws.values() if v > 0], cfg["normalize_pct"])
    out = []
    for code, b in agg.items():
        raw = raws[code]
        score = 0 if base <= 0 else max(0, min(100, round(100 * raw / base)))
        level = min(5, 1 + score // 20) if score > 0 else 1
        out.append({
            "code": code, "name_ja": fips_ja.get(code, code),
            "score": int(score), "level": int(level),
            "lat": b["lat"], "lon": b["lon"],
            "components": {k: round(w[k] * b[k], 1) for k in ("conflict", "protests", "news", "quakes")},
            "counts": b["counts"], "top_events": b.get("top_events", [])})
    out.sort(key=lambda c: (-c["score"], -sum(c["counts"].values())))
    for i, c in enumerate(out):
        c["rank"] = i + 1
    return out
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/instability.py tests/test_instability.py
git commit -m "feat(instability): P95正規化のスコア化とランキング(score_countries)"
```

---

### Task 5: トレンド `apply_trend` / `update_history`

**Files:**
- Modify: `collectors/lib/instability.py`
- Test: `tests/test_instability.py`（追記）

**Interfaces:**
- Consumes: `score_countries` の出力、`history: dict[code -> list[{t:int(ms),score:int}]]`、`now_ms:int`、cfg。
- Produces:
  - `apply_trend(countries: list, history: dict, now_ms: int, cfg: dict) -> None`（各 country に `trend={"dod":{delta,dir}|None,"normal":{deltaPct,dir}|None,"isNew":bool}` を付与）
  - `update_history(history: dict, countries: list, now_ms: int, cfg: dict) -> dict`（現スコアを追記し history_days で切り詰めた新 history）

- [ ] **Step 1: 失敗するテストを追記**

```python
# tests/test_instability.py に追記
H = 3600_000
DAY = 86400_000

def test_trend_dod_and_normal():
    countries = [{"code": "IZ", "score": 80}]
    hist = {"IZ": [{"t": -DAY, "score": 50}] + [{"t": -i * H, "score": 50} for i in range(1, 6)]}
    # now_ms=0、24h前(-DAY)に score50 → dod +30(up)。中央値50 → +60%(up)
    I.apply_trend(countries, hist, 0, CFG)
    tr = countries[0]["trend"]
    assert tr["dod"]["delta"] == 30 and tr["dod"]["dir"] == "up"
    assert tr["normal"]["dir"] == "up" and tr["normal"]["deltaPct"] >= 15
    assert tr["isNew"] is False

def test_trend_new_country():
    countries = [{"code": "ZZ", "score": 40}]
    I.apply_trend(countries, {}, 0, CFG)
    tr = countries[0]["trend"]
    assert tr["dod"] is None and tr["normal"] is None and tr["isNew"] is True

def test_update_history_appends_and_trims():
    hist = {"IZ": [{"t": -10 * DAY, "score": 10}, {"t": -1 * H, "score": 20}]}
    new = I.update_history(hist, [{"code": "IZ", "score": 30}], 0, CFG)
    ts = [x["t"] for x in new["IZ"]]
    assert -10 * DAY not in ts        # 7日より古いものは除去
    assert new["IZ"][-1] == {"t": 0, "score": 30}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: FAIL

- [ ] **Step 3: トレンド関数を実装（`instability.py` に追記）**

```python
def _median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return 0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _trend_for(score_now, hist, now_ms, t):
    dod = None
    if hist:
        target = now_ms - t["dod_hours"] * 3600_000
        tol = t["dod_tol_hours"] * 3600_000
        cand = [h for h in hist if abs(h["t"] - target) <= tol]
        if cand:
            ref = min(cand, key=lambda h: abs(h["t"] - target))["score"]
            d = score_now - ref
            dod = {"delta": int(d),
                   "dir": "up" if d >= t["dod_delta"] else "down" if d <= -t["dod_delta"] else "flat"}
    normal = None
    scores = [h["score"] for h in hist]
    if len(scores) >= t["normal_min_samples"]:
        med = _median(scores)
        pct = round(100 * (score_now - med) / max(med, 1))
        normal = {"deltaPct": int(pct),
                  "dir": "up" if pct >= t["normal_pct"] else "down" if pct <= -t["normal_pct"] else "flat"}
    is_new = dod is None and normal is None
    return {"dod": dod, "normal": normal, "isNew": bool(is_new)}


def apply_trend(countries, history, now_ms, cfg):
    t = cfg["trend"]
    for c in countries:
        c["trend"] = _trend_for(c["score"], history.get(c["code"], []), now_ms, t)


def update_history(history, countries, now_ms, cfg):
    cutoff = now_ms - cfg["history_days"] * 86400_000
    out = {}
    for c in countries:
        lst = [x for x in history.get(c["code"], []) if x["t"] >= cutoff]
        lst.append({"t": int(now_ms), "score": int(c["score"])})
        out[c["code"]] = lst
    return out
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/instability.py tests/test_instability.py
git commit -m "feat(instability): 昨日比/平常比トレンドと履歴更新"
```

---

### Task 6: ナラティブ用プロンプト/パース

**Files:**
- Modify: `collectors/lib/instability.py`
- Test: `tests/test_instability.py`（追記）

**Interfaces:**
- Consumes: `score_countries` 出力、cfg、`collectors.lib.intel._strip_fence`。
- Produces:
  - `narrative_prompt(countries: list, cfg: dict) -> str`（上位 `top_n_narrative` 国のみ）
  - `parse_narratives(text: str) -> dict[str, str]`（`{code: 説明文(<=160字)}`・不正は除外）

- [ ] **Step 1: 失敗するテストを追記**

```python
# tests/test_instability.py に追記
def test_narrative_prompt_includes_top_n_only():
    countries = [{"code": f"C{i}", "name_ja": f"国{i}", "score": 100 - i,
                  "counts": {"conflict": i, "protests": 0, "news": 0, "quakes": 0},
                  "top_events": []} for i in range(12)]
    p = I.narrative_prompt(countries, CFG)
    assert "C0" in p and "C7" in p          # 上位8
    assert "C8" not in p                     # 9番目以降は含めない
    assert "JSON" in p

def test_parse_narratives_filters_and_caps():
    text = '```json\n{"IZ": "  説明  ", "US": 5, "FR": "x"}\n```'
    out = I.parse_narratives(text)
    assert out["IZ"] == "説明"               # trim・フェンス除去
    assert "US" not in out                    # 文字列でない→除外
    assert out["FR"] == "x"
    assert I.parse_narratives("not json") == {}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: FAIL

- [ ] **Step 3: 実装（`instability.py` に追記）**

```python
import json as _json

NARRATIVE_SYSTEM = ("あなたは地政学アナリスト。与えたデータのみを根拠に日本語で簡潔に。"
                    "捏造・予測・助言は禁止。JSON のみ返す。")


def narrative_prompt(countries, cfg):
    top = countries[: cfg["top_n_narrative"]]
    lines = []
    for c in top:
        ct = c["counts"]
        ev = "; ".join(e["title"] for e in c.get("top_events", []) if e.get("title"))
        lines.append(f'{c["code"]} {c.get("name_ja", c["code"])} score={c["score"]} '
                     f'紛争{ct["conflict"]}/抗議{ct["protests"]}/報道{ct["news"]}/地震{ct["quakes"]}'
                     + (f' 例: {ev}' if ev else ''))
    body = "\n".join(lines)
    return ('次の各国について、与えたデータのみを根拠に「なぜ不安定か」を日本語1文で説明してください。'
            '捏造・予測・助言は禁止。出力は {"国コード":"説明文"} の JSON のみ。\n\n' + body)


def parse_narratives(text):
    from collectors.lib.intel import _strip_fence
    try:
        d = _json.loads(_strip_fence(text))
    except (ValueError, TypeError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, v in d.items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            out[k] = v.strip()[:160]
    return out
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python -m pytest tests/test_instability.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add collectors/lib/instability.py tests/test_instability.py
git commit -m "feat(instability): 上位国ナラティブのプロンプト/パース"
```

---

### Task 7: コレクタ本体 `collectors/instability.py`

**Files:**
- Create: `collectors/instability.py`
- Test: `tests/test_instability_collector.py`

**Interfaces:**
- Consumes: `instability` lib 全関数、`geo_country.load_polygons`、`manifest.update_manifest`。
- Produces: `main() -> int`。`data/snapshots/instability.json`（`{updated,model,thresholds,countries[]}`）と `data/snapshots/instability_history.json` を生成。ナラティブはキー有り時のみ。

- [ ] **Step 1: 失敗するテストを書く（LLM はモック・一時ディレクトリ）**

```python
# tests/test_instability_collector.py
import json
import os
import importlib


def _seed(tmp):
    os.makedirs(tmp / "config", exist_ok=True)
    os.makedirs(tmp / "data" / "static", exist_ok=True)
    os.makedirs(tmp / "data" / "snapshots", exist_ok=True)
    # 設定（リポジトリの実ファイルをコピー）
    root = os.path.dirname(os.path.dirname(__file__))
    for rel in ["config/instability.json", "config/fips_countries.json",
                "data/static/country_bounds.geojson"]:
        with open(os.path.join(root, rel), encoding="utf-8") as f:
            (tmp / rel).write_text(f.read(), encoding="utf-8")
    snaps = tmp / "data" / "snapshots"
    (snaps / "conflict.json").write_text(json.dumps({"points": [
        {"place": "IZ", "root": "19", "mentions": 9, "tone": "-6", "lon": 44.0, "lat": 33.0}]}), encoding="utf-8")
    (snaps / "protests.json").write_text(json.dumps({"points": []}), encoding="utf-8")
    (snaps / "news.json").write_text(json.dumps({"items": []}), encoding="utf-8")
    (snaps / "quakes.json").write_text(json.dumps({"points": []}), encoding="utf-8")


def test_main_writes_snapshot_without_key(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    mod = importlib.import_module("collectors.instability")
    importlib.reload(mod)
    assert mod.main() == 0
    out = json.load(open(tmp_path / "data" / "snapshots" / "instability.json", encoding="utf-8"))
    assert out["countries"][0]["code"] == "IZ"
    assert out["model"] is None                 # キー無し→ナラティブ無し
    assert (tmp_path / "data" / "snapshots" / "instability_history.json").exists()


def test_main_adds_narrative_with_key(tmp_path, monkeypatch):
    _seed(tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "x")
    mod = importlib.import_module("collectors.instability")
    importlib.reload(mod)
    monkeypatch.setattr(mod, "_ask", lambda prompt: '{"IZ": "紛争が集中している"}')
    assert mod.main() == 0
    out = json.load(open(tmp_path / "data" / "snapshots" / "instability.json", encoding="utf-8"))
    iz = next(c for c in out["countries"] if c["code"] == "IZ")
    assert iz["narrative_ja"] == "紛争が集中している"
    assert out["model"] == mod.MODEL
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `python -m pytest tests/test_instability_collector.py -q`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: コレクタを実装**

```python
# collectors/instability.py
"""国家不安定性インデックス：決定論スコア＋トレンド＋（任意で）Haikuナラティブを毎時合成。"""
import json
import os
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest
from collectors.lib import instability as I
from collectors.lib.geo_country import load_polygons

SNAP_DIR = "data/snapshots"
CONFIG_PATH = "config/instability.json"
FIPS_PATH = "config/fips_countries.json"
BOUNDS_PATH = "data/static/country_bounds.geojson"
HISTORY_FILE = "instability_history.json"
OUT_FILE = "instability.json"
MODEL = "claude-haiku-4-5"
SNAP_FILES = {"conflict": "conflict.json", "protests": "protests.json",
              "news": "news.json", "quakes": "quakes.json"}


def _load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def _ask(prompt):
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(model=MODEL, max_tokens=2000, temperature=0,
                                 system=I.NARRATIVE_SYSTEM,
                                 messages=[{"role": "user", "content": prompt}])
    return msg.content[0].text


def main():
    out_dir = os.path.abspath(SNAP_DIR)
    os.makedirs(out_dir, exist_ok=True)
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    now_ms = int(now.timestamp() * 1000)
    try:
        cfg = _load(CONFIG_PATH, None)
        if not cfg:
            print("[instability] no config; skip")
            return 1
        fips = _load(FIPS_PATH, {})
        polys = load_polygons(_load(BOUNDS_PATH, {"features": []}))
        snaps = {k: _load(os.path.join(out_dir, v), {}) for k, v in SNAP_FILES.items()}
        agg = I.aggregate(snaps, polys, cfg)
        countries = I.score_countries(agg, cfg, fips)
        history = _load(os.path.join(out_dir, HISTORY_FILE), {})
        I.apply_trend(countries, history, now_ms, cfg)
        new_hist = I.update_history(history, countries, now_ms, cfg)
    except Exception as e:  # best-effort：前回を温存
        print(f"[instability] failed: {e}; keeping previous")
        return 1
    model = None
    if os.environ.get("ANTHROPIC_API_KEY") and countries:
        try:
            narr = I.parse_narratives(_ask(I.narrative_prompt(countries, cfg)))
            for c in countries:
                if c["code"] in narr:
                    c["narrative_ja"] = narr[c["code"]]
            model = MODEL
        except Exception as e:
            print(f"[instability] narrative skipped: {e}")
    snap = {"updated": now_iso, "model": model,
            "thresholds": {"mag_min": cfg["quake"]["mag_min"], "top_n": cfg["top_n_narrative"]},
            "countries": countries}
    with open(os.path.join(out_dir, OUT_FILE), "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(out_dir, HISTORY_FILE), "w", encoding="utf-8") as f:
        json.dump(new_hist, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(os.path.join(out_dir, "manifest.json"), "instability", now_iso, len(countries))
    print(f"[instability] wrote {len(countries)} countries -> {OUT_FILE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: テストが通ることを確認**

Run: `python -m pytest tests/test_instability_collector.py -q`
Expected: PASS（キー無し＝model None／キー有り＝narrative 付与）

- [ ] **Step 5: 全 pytest を確認**

Run: `python -m pytest tests/ -q`
Expected: PASS（既存 + 新規）

- [ ] **Step 6: コミット**

```bash
git add collectors/instability.py tests/test_instability_collector.py
git commit -m "feat(instability): コレクタ本体(スコア/トレンド/ナラティブ/履歴/manifest)"
```

---

### Task 8: 毎時ワークフロー `collect-instability.yml`

**Files:**
- Create: `.github/workflows/collect-instability.yml`

**Interfaces:**
- Consumes: `collectors.instability.main`。`concurrency group: collect` を既存と共有して直列化。

- [ ] **Step 1: ワークフローを作成（briefing と同型・cron `:37`）**

```yaml
# .github/workflows/collect-instability.yml
name: collect-instability
on:
  schedule:
    - cron: '37 * * * *'      # 毎時:37（collect/collect-slow/briefing と別オフセット）
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: collect              # 既存と共有して直列化（push 競合回避）
  cancel-in-progress: false
jobs:
  instability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - name: Collect instability
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: python -m collectors.instability || echo "instability skipped"
      - name: Commit snapshot
        run: |
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"
          git add data/snapshots/*.json
          if git diff --cached --quiet; then
            echo "no changes"
          else
            git commit -m "data: refresh instability [skip ci]"
            git pull --rebase origin main
            git push
          fi
```

- [ ] **Step 2: YAML 妥当性を確認**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/collect-instability.yml')); print('ok')"`
Expected: `ok`（PyYAML が無ければ `python3 -c "import json"` 相当の目視確認でも可）

- [ ] **Step 3: コミット**

```bash
git add .github/workflows/collect-instability.yml
git commit -m "ci(instability): 毎時 collect-instability ワークフロー(group collect 直列)"
```

---

### Task 9: フロント純粋ヘルパ `js/ui/instability.js`

**Files:**
- Create: `js/ui/instability.js`
- Test: `tests/instability.test.js`

**Interfaces:**
- Produces（純粋・named export）:
  - `levelOf(score:number) -> 1..5`
  - `scoreColor(score:number) -> 'rgb(r,g,b)'`
  - `trendArrow(dir:'up'|'down'|'flat') -> '▲'|'▼'|'─'`
  - `fmtSignedPct(n:number) -> '+12%'|'-3%'`
  - `rankTop(countries:array, n:number) -> array`
  - `topMovers(countries:array, n:number) -> array`（`trend.isNew!==true` かつ上昇のみ・`normal.deltaPct`優先→`dod.delta`、降順）
  - `rowHtml(country:object) -> string`（XSS安全）

- [ ] **Step 1: 失敗するテストを書く**

```javascript
// tests/instability.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelOf, scoreColor, trendArrow, fmtSignedPct, rankTop, topMovers, rowHtml }
  from '../js/ui/instability.js';

test('levelOf: 0..100 を 1..5 に', () => {
  assert.equal(levelOf(0), 1);
  assert.equal(levelOf(19), 1);
  assert.equal(levelOf(20), 2);
  assert.equal(levelOf(100), 5);
});

test('scoreColor: rgb 文字列', () => {
  assert.match(scoreColor(90), /^rgb\(\d+,\d+,\d+\)$/);
});

test('trendArrow / fmtSignedPct', () => {
  assert.equal(trendArrow('up'), '▲');
  assert.equal(trendArrow('down'), '▼');
  assert.equal(trendArrow('flat'), '─');
  assert.equal(fmtSignedPct(12), '+12%');
  assert.equal(fmtSignedPct(-3), '-3%');
});

test('rankTop / topMovers', () => {
  const cs = [
    { code: 'A', score: 90, trend: { dod: { delta: 2, dir: 'up' }, normal: { deltaPct: 40, dir: 'up' }, isNew: false } },
    { code: 'B', score: 80, trend: { dod: { delta: 1, dir: 'flat' }, normal: { deltaPct: 5, dir: 'flat' }, isNew: false } },
    { code: 'C', score: 70, trend: { dod: null, normal: null, isNew: true } },
  ];
  assert.deepEqual(rankTop(cs, 2).map((c) => c.code), ['A', 'B']);
  assert.deepEqual(topMovers(cs, 5).map((c) => c.code), ['A']); // 上昇かつ新規でないのは A のみ
  assert.deepEqual(rankTop(null, 3), []);
});

test('rowHtml: 国名/スコアを含み、url は http(s) のみ', () => {
  const html = rowHtml({ code: 'IZ', name_ja: 'イラク', score: 87, level: 5,
    counts: { conflict: 10, protests: 1, news: 2, quakes: 0 },
    trend: { dod: { delta: 12, dir: 'up' }, normal: { deltaPct: 30, dir: 'up' }, isNew: false },
    narrative_ja: '紛争が集中', top_events: [{ title: 'x', place: 'y', url: 'javascript:bad' }] });
  assert.match(html, /イラク/);
  assert.match(html, /87/);
  assert.doesNotMatch(html, /javascript:bad/); // 危険 URL は出さない
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/instability.test.js`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 純粋ヘルパを実装**

```javascript
// js/ui/instability.js
// 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
const LEVEL_RGB = { 1: [90, 200, 160], 2: [150, 210, 90], 3: [240, 200, 70], 4: [245, 150, 60], 5: [240, 80, 70] };

export function levelOf(score) {
  return score > 0 ? Math.min(5, 1 + Math.floor(score / 20)) : 1;
}
export function scoreColor(score) {
  const [r, g, b] = LEVEL_RGB[levelOf(score)];
  return `rgb(${r},${g},${b})`;
}
export function trendArrow(dir) {
  return dir === 'up' ? '▲' : dir === 'down' ? '▼' : '─';
}
export function fmtSignedPct(n) {
  return (n > 0 ? '+' : '') + n + '%';
}
export function rankTop(countries, n) {
  return (countries || []).slice(0, n);
}
function _moverScore(c) {
  if (!c.trend || c.trend.isNew) return -1e9;
  const norm = c.trend.normal ? c.trend.normal.deltaPct : null;
  const dod = c.trend.dod ? c.trend.dod.delta : null;
  return norm != null ? norm : (dod != null ? dod : -1e9);
}
export function topMovers(countries, n) {
  return (countries || [])
    .filter((c) => c.trend && !c.trend.isNew && _moverScore(c) > 0)
    .sort((a, b) => _moverScore(b) - _moverScore(a))
    .slice(0, n);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function _trendBadges(tr) {
  if (!tr || tr.isNew) return '<span class="ins-new">新規</span>';
  const parts = [];
  if (tr.dod) parts.push(`<span class="ins-tr ins-${tr.dod.dir}">${trendArrow(tr.dod.dir)}昨日比${tr.dod.delta > 0 ? '+' : ''}${tr.dod.delta}</span>`);
  if (tr.normal) parts.push(`<span class="ins-tr ins-${tr.normal.dir}">${trendArrow(tr.normal.dir)}平常比${fmtSignedPct(tr.normal.deltaPct)}</span>`);
  return parts.join(' ');
}
export function rowHtml(country) {
  const c = country || {};
  const ct = c.counts || { conflict: 0, protests: 0, news: 0, quakes: 0 };
  const col = scoreColor(c.score || 0);
  const narr = c.narrative_ja ? `<p class="ins-narr">${esc(c.narrative_ja)}</p>` : '';
  return (
    `<div class="ins-row" style="--lvl:${col}">`
    + `<span class="ins-rank">${esc(c.rank || '')}</span>`
    + `<span class="ins-name">${esc(c.name_ja || c.code || '')}</span>`
    + `<span class="ins-bar"><span class="ins-fill" style="width:${Math.max(0, Math.min(100, c.score || 0))}%"></span></span>`
    + `<span class="ins-score">${esc(c.score || 0)}</span>`
    + `<span class="ins-trend">${_trendBadges(c.trend)}</span>`
    + `<span class="ins-counts">⚔${esc(ct.conflict)} 📢${esc(ct.protests)} 📰${esc(ct.news)} 🌐${esc(ct.quakes)}</span>`
    + narr
    + '</div>'
  );
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/instability.test.js`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add js/ui/instability.js tests/instability.test.js
git commit -m "feat(instability): フロント純粋ヘルパ(色/トレンド/ランキング/行HTML)"
```

---

### Task 10: フロント統合（描画＋セクション＋配線＋CSS＋SW）

**Files:**
- Modify: `js/ui/instability.js`（`renderInstability` を追記）
- Modify: `index.html`（`#ai-brief` の後に `#instability`）
- Modify: `js/main.js`（fetch→render→flyTo 配線）
- Modify: `css/orbis.css`（セクション/行/バー/トレンド）
- Modify: `sw.js`（`orbis-v37`→`orbis-v38`）

**Interfaces:**
- Consumes: Task9 の純粋ヘルパ、main.js の `map`/`selected`/`drawAll`/`window.__orbis`（briefing と同じ流儀）。
- Produces: `renderInstability(rootEl, data, { onSelect } = {}) -> void`。

- [ ] **Step 1: `renderInstability` を追記**

```javascript
// js/ui/instability.js の末尾に追記
import { } from '../lib/places.js'; // （依存なし。明示は不要なら省略可）

// rootEl=#instability。data={updated, countries:[...]}。onSelect(country) は座標ありでクリック時。
export function renderInstability(rootEl, data, { onSelect } = {}) {
  if (!rootEl) return;
  const countries = (data && data.countries) || [];
  const rankWrap = rootEl.querySelector('.ins-rank-list');
  const moveWrap = rootEl.querySelector('.ins-mover-list');
  if (!rankWrap || !moveWrap) return;
  rankWrap.innerHTML = '';
  moveWrap.innerHTML = '';
  const mkRow = (c) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ins-rowbtn';
    el.innerHTML = rowHtml(c);
    if (typeof c.lat === 'number' && typeof c.lon === 'number' && (c.lat || c.lon) && onSelect) {
      el.addEventListener('click', () => onSelect(c));
    } else {
      el.disabled = true;
    }
    return el;
  };
  rankTop(countries, 15).forEach((c) => rankWrap.appendChild(mkRow(c)));
  const movers = topMovers(countries, 5);
  moveWrap.parentElement.style.display = movers.length ? '' : 'none';
  movers.forEach((c) => moveWrap.appendChild(mkRow(c)));
}
```
（`rowHtml`/`rankTop`/`topMovers` は同ファイルの既存 export を参照。先頭の不要 import 行は入れない。）

- [ ] **Step 2: ヘルパの回帰テストを再確認（壊していないこと）**

Run: `node --test tests/instability.test.js`
Expected: PASS（`renderInstability` は DOM 依存のため node 単体では未テスト＝e2e で担保）

- [ ] **Step 3: `index.html` に `#instability` セクションを追加**

`#ai-brief` セクション（`</section>`）の直後に挿入:
```html
      <section id="instability" class="ins-section">
        <div class="ins-head">
          <h3 class="ins-h">⚠ 国家不安定性インデックス</h3>
          <span class="ins-note">AI合成・出典付き／毎時更新（決定論スコア＋トレンド）</span>
        </div>
        <div class="ins-movers">
          <h4 class="ins-sub">📈 急上昇</h4>
          <div class="ins-mover-list"></div>
        </div>
        <h4 class="ins-sub">🏴 不安定ランキング</h4>
        <div class="ins-rank-list"></div>
      </section>
```

- [ ] **Step 4: `js/main.js` に配線（briefing ブロックの直後をミラー）**

`js/main.js` の briefing ブロック（`} catch { if (briefRoot) briefRoot.style.display = 'none'; }` の閉じ後・行 436 付近）に追記。先頭の import 群に追加:
```javascript
import { renderInstability } from './ui/instability.js';
```
briefing ブロックの直後に:
```javascript
    // 国家不安定性インデックス（毎時・メディア/briefing の下）。
    const insRoot = document.getElementById('instability');
    try {
      const ins = await fetch('data/snapshots/instability.json').then((r) => r.json()).catch(() => null);
      if (ins && ins.countries && ins.countries.length && insRoot) {
        renderInstability(insRoot, ins, {
          onSelect: (c) => {
            map.flyTo({ center: [c.lon, c.lat], zoom: 4, duration: 1500, essential: true });
            selected = { lon: c.lon, lat: c.lat, title: c.name_ja, layerId: 'instability', at: performance.now() };
            if (window.__orbis) window.__orbis.selected = selected;
            drawAll(overlay);
          },
        });
        if (window.__orbis) window.__orbis.instability = ins;
      } else if (insRoot) {
        insRoot.style.display = 'none';
      }
    } catch {
      if (insRoot) insRoot.style.display = 'none';
    }
```

- [ ] **Step 5: `css/orbis.css` にスタイルを追加（`#ai-brief` の glass 調と一貫）**

```css
/* 国家不安定性インデックス */
#instability.ins-section { margin: 18px auto 40px; max-width: 980px; padding: 16px 18px;
  background: rgba(8,12,22,.55); border: 1px solid rgba(120,150,200,.18); border-radius: 14px;
  backdrop-filter: blur(8px); }
.ins-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.ins-h { margin: 0; font-size: 1.05rem; color: #e8f0ff; }
.ins-note { font-size: .72rem; color: #8ea3c4; }
.ins-sub { margin: 12px 0 6px; font-size: .82rem; color: #b9c8e6; }
.ins-rank-list, .ins-mover-list { display: flex; flex-direction: column; gap: 6px; }
.ins-rowbtn { all: unset; cursor: pointer; display: block; border-radius: 10px; }
.ins-rowbtn[disabled] { cursor: default; opacity: .8; }
.ins-rowbtn:hover:not([disabled]) { background: rgba(120,150,200,.10); }
.ins-row { display: grid; grid-template-columns: 26px 1fr 90px 34px auto; align-items: center;
  gap: 8px; padding: 6px 8px; border-left: 3px solid var(--lvl, #678); }
.ins-rank { color: #8ea3c4; font-variant-numeric: tabular-nums; text-align: right; }
.ins-name { color: #eaf1ff; font-weight: 600; }
.ins-bar { height: 8px; border-radius: 5px; background: rgba(255,255,255,.08); overflow: hidden; }
.ins-fill { display: block; height: 100%; background: var(--lvl, #678); }
.ins-score { color: #eaf1ff; font-variant-numeric: tabular-nums; text-align: right; }
.ins-trend { display: flex; gap: 8px; font-size: .72rem; }
.ins-tr.ins-up { color: #ff7a7a; } .ins-tr.ins-down { color: #7adba0; } .ins-tr.ins-flat { color: #8ea3c4; }
.ins-new { font-size: .72rem; color: #8ea3c4; }
.ins-counts { grid-column: 2 / -1; font-size: .72rem; color: #9fb2d4; }
.ins-narr { grid-column: 2 / -1; margin: 2px 0 0; font-size: .78rem; color: #c7d6f0; }
@media (max-width: 768px) { #instability.ins-section { margin: 12px 10px 28px; padding: 12px; }
  .ins-row { grid-template-columns: 22px 1fr 60px 28px; } .ins-trend { grid-column: 2 / -1; } }
```

- [ ] **Step 6: `sw.js` の版を上げる**

`sw.js:2` を変更:
```javascript
const CACHE = 'orbis-v38';
```

- [ ] **Step 7: ローカルで視覚サニティ（seed→目視→破棄）**

Run（ダミー seed を置いてセクションを目視。確認後 seed は破棄）:
```bash
python3 - <<'PY'
import json, os
os.makedirs("data/snapshots", exist_ok=True)
seed = {"updated":"2026-06-20T12:00:00Z","model":"claude-haiku-4-5",
        "thresholds":{"mag_min":4.5,"top_n":8},
        "countries":[
          {"code":"IZ","name_ja":"イラク","score":87,"level":5,"rank":1,"lat":33.2,"lon":43.9,
           "components":{"conflict":120.4,"protests":8.1,"news":3.0,"quakes":0.0},
           "counts":{"conflict":210,"protests":7,"news":2,"quakes":0},
           "trend":{"dod":{"delta":12,"dir":"up"},"normal":{"deltaPct":34,"dir":"up"},"isNew":False},
           "narrative_ja":"戦闘イベントが集中し報道も増加。","top_events":[]},
          {"code":"US","name_ja":"アメリカ合衆国","score":40,"level":3,"rank":2,"lat":38.9,"lon":-77.0,
           "components":{"conflict":10.0,"protests":12.0,"news":4.5,"quakes":1.2},
           "counts":{"conflict":5,"protests":9,"news":3,"quakes":1},
           "trend":{"dod":{"delta":-2,"dir":"flat"},"normal":{"deltaPct":-5,"dir":"flat"},"isNew":False},
           "top_events":[]}]}
json.dump(seed, open("data/snapshots/instability.json","w"), ensure_ascii=False)
print("seeded")
PY
python3 -m http.server 8000 >/dev/null 2>&1 &
echo "open http://localhost:8000/ → #instability を目視（ランキング/急上昇/クリックでflyTo）"
```
Playwright でスクショ確認（任意）後、`git checkout -- data/snapshots/instability.json 2>/dev/null || rm -f data/snapshots/instability.json` で seed を破棄。

- [ ] **Step 8: 関連テストの再確認**

Run: `node --test tests/instability.test.js && python -m pytest tests/ -q`
Expected: PASS

- [ ] **Step 9: コミット**

```bash
git add js/ui/instability.js index.html js/main.js css/orbis.css sw.js
git commit -m "feat(instability): セクション描画＋main.js配線＋CSS＋SW v38"
```

---

### Task 11: e2e（route mock）＋ 最終確認

**Files:**
- Create: `tests/e2e/instability.spec.js`

**Interfaces:**
- Consumes: Task10 のセクション/配線、`window.__orbis`。

- [ ] **Step 1: 失敗する e2e を書く**

```javascript
// tests/e2e/instability.spec.js
import { test, expect } from '@playwright/test';

const MOCK = {
  updated: '2026-06-20T12:00:00Z', model: 'claude-haiku-4-5',
  thresholds: { mag_min: 4.5, top_n: 8 },
  countries: [
    { code: 'IZ', name_ja: 'イラク', score: 87, level: 5, rank: 1, lat: 33.2, lon: 43.9,
      components: { conflict: 120, protests: 8, news: 3, quakes: 0 },
      counts: { conflict: 210, protests: 7, news: 2, quakes: 0 },
      trend: { dod: { delta: 12, dir: 'up' }, normal: { deltaPct: 34, dir: 'up' }, isNew: false },
      narrative_ja: '戦闘が集中。', top_events: [] },
    { code: 'US', name_ja: 'アメリカ合衆国', score: 40, level: 3, rank: 2, lat: 38.9, lon: -77.0,
      components: { conflict: 10, protests: 12, news: 4, quakes: 1 },
      counts: { conflict: 5, protests: 9, news: 3, quakes: 1 },
      trend: { dod: { delta: 1, dir: 'flat' }, normal: { deltaPct: 30, dir: 'up' }, isNew: false },
      top_events: [] },
  ],
};

test('国家不安定性インデックス: 描画とクリックflyTo', async ({ page }) => {
  test.setTimeout(60000); // WSL2 の WebGL globe 起動余裕
  await page.route('**/data/snapshots/instability.json', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK) }));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  const rows = page.locator('#instability .ins-rank-list .ins-rowbtn');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('#instability')).toContainText('イラク');
  await expect(page.locator('#instability .ins-mover-list .ins-rowbtn')).toHaveCount(2); // 両国 up
  await rows.first().click();
  await page.waitForFunction(() => window.__orbis && window.__orbis.selected
    && window.__orbis.selected.layerId === 'instability');
  expect(errors.filter((e) => !/favicon|font/i.test(e))).toEqual([]);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npm run test:e2e -- instability`
Expected: FAIL（セクション未配信なら）→ 実装済みなら PASS（配線確認）

- [ ] **Step 3: 必要なら配線を修正して通す**

セクション/`ins-rank-list`/`ins-mover-list`/`onSelect`（`layerId:'instability'`）が一致するよう Task10 を見直す。

- [ ] **Step 4: e2e が通ることを確認**

Run: `npm run test:e2e -- instability`
Expected: PASS

- [ ] **Step 5: 全テスト最終確認**

Run: `python -m pytest tests/ -q && npm run test:js && npm run test:e2e`
Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add tests/e2e/instability.spec.js
git commit -m "test(instability): e2e(route mock)で描画とクリックflyToを担保"
```

---

## 統合・本番化（実装完了後）

1. `ExitWorktree`（action=keep）で main ツリーへ戻る。
2. `git fetch && git merge worktree-instability`（共有 main で統合・コンフリクトは解消）→ `git push`。**merge 後に `git pull --rebase` を使わない**（[[git-shared-main-tree-integration-collision]]）。
3. Vercel 自動デプロイ。SW v38 配信を確認。
4. 初回データ生成：`gh workflow run collect-instability.yml`（成功後 `instability.json` が commit され以降毎時 :37 更新）。**追加 Secret 不要**（`ANTHROPIC_API_KEY` 既存）。
5. 本番検証：`curl` で `instability.json`、実機で `#instability`（ランキング/急上昇/クリック flyTo/エラー0）。
6. 記憶整理：MEMORY.md 索引＋ `project_orbis.md` ＋ Obsidian `Projects/orbis-ai-intelligence.md`（第2サブPJ完了・第3＝AI FORECASTS の起点）。

## Self-Review（計画→spec 照合）
- スコープ：spec の全項目（4シグナル/FIPS正準/PIP/決定論スコア/P95正規化/レベル/重心/昨日比+平常比/履歴/Haikuナラティブ/セクションUI/flyTo/毎時cron/SW v38/テスト）を Task1–11 で網羅。
- プレースホルダ：各ステップに実コードを記載（"TBD"等なし）。
- 型整合：`aggregate→score_countries→apply_trend/update_history→narrative_prompt/parse_narratives` のキー名（components/counts/trend{dod,normal,isNew}/top_events）と、フロント `rowHtml`/`renderInstability` の参照キーが一致。`onSelect` の `layerId:'instability'` は main.js/e2e で一致。
