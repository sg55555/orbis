# 地域プロフィール Phase2.5a（パイプライン＋日本サブセット）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地域（国/県/都市）の Wikipedia/Wikidata 由来の事実を Claude で日本語プロフィールに整形して静的 JSON 化する build パイプラインを作り、日本（FIPS=JA）分を生成して品質・コスト・カバレッジを実測する。

**Architecture:** 純関数（`scripts/lib/profile_prep.py`・stdlib のみ・pytest 対象）に QID 解決/事実抽出/プロンプト組立/応答パース/schema 整形/オーケストレーション（I/O 注入）を置く。I/O ラッパ（`scripts/build_profiles.py`）が requests で Wikidata/Wikipedia を取得・anthropic で整形・キャッシュ・ファイル書出し・対象地域反復を担う。`build_cities.py` を拡張し都市に `qid` を付与（client が profile を引けるように）。Orbis の collector パターン（オフライン LLM→静的配信）に従いランタイム LLM 無し。

**Tech Stack:** Python 3（stdlib: json/re/os/gzip/time/urllib）、requests>=2.31.0、anthropic>=0.39.0、Claude Sonnet 4.6（`claude-sonnet-4-6`）、node:test/pytest。

> **⚠️ 今回の実行範囲＝ダミーモード（ユーザー決定 2026-06-25）**：実 LLM 生成（約11,600件・数千円）は**将来タスクへ延期**。今回は **`PROFILE_DUMMY=1` でダミーのセクション本文を埋めた日本サブセットを生成**し、**UI（別途 2.5b）でデザイン・体裁が分かるところまで**を目標とする。Wikidata/Wikipedia 取得も省略可（ダミーは facts も簡易）。将来「やはりこう生成したい」となったら Task 9 の `ask_llm` を実 Claude にして全生成（2.5c）。Task 1-8（純関数）・Task 9（build_profiles・ダミー分岐込み）・Task 10（ダミー生成）を subagent-driven で実装する。real LLM 生成（旧 Task 10 の API キー版）は本計画の対象外＝将来タスク。

## Global Constraints

- 純関数は **stdlib のみ**（profile_prep.py は json/re/math/urllib のみ。requests/anthropic は build_profiles.py だけ）。
- LLM モデルは `PROFILE_LLM_MODEL` env で切替可・既定 `claude-sonnet-4-6`。`messages.create(..., temperature=0)`。
- Claude 呼び出しは `os.environ.get("ANTHROPIC_API_KEY")` ガードの内側のみ。未設定や例外は best-effort で degraded にし build を止めない。
- 出力スキーマ（厳守）: `{id, level, name_ja, facts{population,area_km2,lat,lon,elevation_m}, sections[{title,body}], source{qid,wikipedia_url}, degraded}`。
- セクション集合（順序固定）: `["概要","気候","特産・名物","主要産業","交通・地理","観光名所"]`。該当のみ・空は省略。
- 出力: `data/static/profiles/{country,admin1,city}/<id>.json(.gz)`（admin1/city は gzip、country は素 JSON）＋ `data/static/profiles_manifest.json`。
- キャッシュ: `scripts/.cache/profiles/`（gitignore 済の `scripts/.cache/` 配下）。raw と生成を保存し再実行はスキップ。
- 実行は `PYTHONPATH=. python3 scripts/<name>.py`。

---

## File Structure

- Create `scripts/lib/profile_prep.py` — 純関数群（QID 解決/事実抽出/プロンプト/パース/schema/generate_profile）。
- Create `scripts/build_profiles.py` — I/O オーケストレータ（fetch/llm/cache/write/manifest/反復）。
- Modify `scripts/build_cities.py` — 都市レコードに `qid` を追加。
- Create `tests/test_profile_prep.py` — pytest（純関数）。
- Modify `tests/test_build_cities*`（無ければ pytest 内で）— cities が `qid` を持つ回帰。
- Generated（2.5a は日本のみ）: `data/static/profiles/**`, `data/static/profiles_manifest.json`。

---

### Task 1: build_cities.py に都市 `qid` を付与

**Files:**
- Modify: `scripts/build_cities.py`（`place_to_record`）
- Test: `tests/test_profile_prep.py`（新規・本タスクで作成し city qid 回帰も入れる）

**Interfaces:**
- Produces: cities/<FIPS>.json の各要素が `qid`（str・NE WIKIDATAID 由来・欠落は ""）を持つ。

- [ ] **Step 1: 失敗するテストを書く**（`tests/test_profile_prep.py` 新規）

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scripts.build_cities import place_to_record

def test_place_to_record_includes_qid():
    feat = {"properties": {"NAME": "Tokyo", "NAME_JA": "東京都", "POP_MAX": "35676000",
                           "WIKIDATAID": "Q1490"},
            "geometry": {"coordinates": [139.75, 35.68]}}
    rec = place_to_record(feat, {}, {})
    assert rec["qid"] == "Q1490"
    assert rec["name"] == "Tokyo" and rec["lon"] == 139.75 and rec["pop"] == 35676000

def test_place_to_record_qid_blank_when_missing():
    feat = {"properties": {"NAME": "X"}, "geometry": {"coordinates": [0, 0]}}
    assert place_to_record(feat, {}, {})["qid"] == ""
```

- [ ] **Step 2: 失敗を確認**

Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q`
Expected: FAIL（`rec["qid"]` KeyError）

- [ ] **Step 3: 実装**（`scripts/build_cities.py` の `place_to_record` 戻り値に qid 追加）

`place_to_record` の `return {...}` を次に変更（既存キーは保持）:

```python
    qid = props.get("WIKIDATAID") or props.get("wikidataid") or ""
    return {"name": name, "name_ja": name_ja, "lon": lon, "lat": lat, "pop": pop,
            "qid": qid.strip() if isinstance(qid, str) else ""}
```

- [ ] **Step 4: 合格を確認**

Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q`
Expected: PASS（2 件）

- [ ] **Step 5: コミット**

```bash
git add scripts/build_cities.py tests/test_profile_prep.py
git commit -m "feat(profiles): build_cities に都市 qid(Wikidata) を付与"
```

---

### Task 2: resolve_qid（NE props → Wikidata QID）

**Files:**
- Create: `scripts/lib/profile_prep.py`
- Test: `tests/test_profile_prep.py`

**Interfaces:**
- Produces: `resolve_qid(props: dict) -> str | None`（"Q…" を返す・無効は None）。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import resolve_qid

def test_resolve_qid_variants():
    assert resolve_qid({"wikidataid": "Q1490"}) == "Q1490"
    assert resolve_qid({"WIKIDATAID": " Q64 "}) == "Q64"
    assert resolve_qid({"wikidataid": ""}) is None
    assert resolve_qid({"wikidataid": "-99"}) is None
    assert resolve_qid({}) is None
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py::test_resolve_qid_variants -q` Expected: FAIL（import error）

- [ ] **Step 3: 実装**（`scripts/lib/profile_prep.py` 新規）

```python
"""地域プロフィール生成の純関数群（stdlib のみ・pytest 対象）。I/O は build_profiles.py。"""
import json
import re

SECTIONS = ["概要", "気候", "特産・名物", "主要産業", "交通・地理", "観光名所"]


def resolve_qid(props):
    """NE feature properties → Wikidata QID（"Q…"）。無効/欠落は None。"""
    for k in ("wikidataid", "WIKIDATAID", "wikidataId"):
        v = props.get(k)
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("Q") and v[1:].isdigit():
                return v
    return None
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/profile_prep.py tests/test_profile_prep.py
git commit -m "feat(profiles): resolve_qid（NE→Wikidata QID）"
```

---

### Task 3: wikidata_facts（Wikidata entity → facts）

**Files:**
- Modify: `scripts/lib/profile_prep.py`
- Test: `tests/test_profile_prep.py`

**Interfaces:**
- Consumes: Wikidata `wbgetentities` の 1 エンティティ dict（`{"claims": {...}, "sitelinks": {...}}`）。
- Produces: `wikidata_facts(entity) -> {"population","area_km2","lat","lon","elevation_m"}`（欠落は None）。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import wikidata_facts

def _amt(pid, amount):
    return {pid: [{"mainsnak": {"datavalue": {"value": {"amount": amount}}}}]}

def test_wikidata_facts_extracts():
    claims = {}
    claims.update(_amt("P1082", "+13960000"))
    claims.update(_amt("P2046", "+2194"))
    claims.update(_amt("P2044", "+40"))
    claims["P625"] = [{"mainsnak": {"datavalue": {"value": {"latitude": 35.68, "longitude": 139.75}}}}]
    f = wikidata_facts({"claims": claims})
    assert f["population"] == 13960000
    assert f["area_km2"] == 2194.0
    assert f["lat"] == 35.68 and f["lon"] == 139.75
    assert f["elevation_m"] == 40.0

def test_wikidata_facts_missing_all_none():
    f = wikidata_facts({})
    assert f == {"population": None, "area_km2": None, "lat": None, "lon": None, "elevation_m": None}
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**（`profile_prep.py` に追記）

```python
def _claim_amount(claims, pid):
    for c in claims.get(pid) or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            amt = v["amount"] if isinstance(v, dict) and "amount" in v else v
            return float(amt)
        except (KeyError, TypeError, ValueError):
            continue
    return None


def _claim_coord(claims):
    for c in claims.get("P625") or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            return float(v["latitude"]), float(v["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
    return None, None


def wikidata_facts(entity):
    """Wikidata entity → 事実 dict。P1082 人口/P2046 面積/P625 座標/P2044 標高。"""
    claims = (entity or {}).get("claims") or {}
    pop = _claim_amount(claims, "P1082")
    lat, lon = _claim_coord(claims)
    return {
        "population": int(pop) if pop is not None else None,
        "area_km2": _claim_amount(claims, "P2046"),
        "lat": lat, "lon": lon,
        "elevation_m": _claim_amount(claims, "P2044"),
    }
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add scripts/lib/profile_prep.py tests/test_profile_prep.py
git commit -m "feat(profiles): wikidata_facts（人口/面積/座標/標高抽出）"
```

---

### Task 4: ja_wikipedia_title（entity → 日本語 Wikipedia タイトル）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep.py`

**Interfaces:** Produces `ja_wikipedia_title(entity) -> str | None`（sitelinks.jawiki.title）。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import ja_wikipedia_title

def test_ja_wikipedia_title():
    assert ja_wikipedia_title({"sitelinks": {"jawiki": {"title": "東京都"}}}) == "東京都"
    assert ja_wikipedia_title({"sitelinks": {"enwiki": {"title": "Tokyo"}}}) is None
    assert ja_wikipedia_title({}) is None
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**

```python
def ja_wikipedia_title(entity):
    """entity の日本語 Wikipedia サイトリンク title。無ければ None。"""
    sl = (entity or {}).get("sitelinks") or {}
    t = (sl.get("jawiki") or {}).get("title")
    return t.strip() if isinstance(t, str) and t.strip() else None
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): ja_wikipedia_title"`

---

### Task 5: build_profile_prompt（grounding プロンプト組立）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep.py`

**Interfaces:** Produces `build_profile_prompt(name_ja, level, facts, wiki_summary) -> str`。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import build_profile_prompt

def test_build_profile_prompt_grounds_and_lists_sections():
    p = build_profile_prompt("東京都", "admin1",
                             {"population": 13960000, "area_km2": 2194, "lat": None, "lon": None, "elevation_m": None},
                             "東京都は日本の首都圏…")
    assert "東京都" in p and "admin1" in p
    assert "東京都は日本の首都圏" in p          # 要約を grounding に含む
    assert "population: 13960000" in p          # None でない事実のみ列挙
    assert "lat" not in p                        # None の事実は出さない
    assert "観光名所" in p and "概要" in p        # セクション候補を提示
    assert "根拠" in p or "事実に無い" in p       # 幻覚抑制の指示
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**

```python
def build_profile_prompt(name_ja, level, facts, wiki_summary):
    """取得事実のみを根拠に日本語プロフィールを JSON 生成させるプロンプト。"""
    facts_lines = "\n".join(f"- {k}: {v}" for k, v in (facts or {}).items() if v is not None)
    return (
        f"地域「{name_ja}」（種別: {level}）の日本語プロフィールを作成してください。\n"
        f"以下の Wikipedia 要約と事実(Wikidata)のみを根拠とし、ここに無い情報は書かないでください。\n\n"
        f"# Wikipedia 要約\n{wiki_summary or '(なし)'}\n\n"
        f"# 事実(Wikidata)\n{facts_lines or '(なし)'}\n\n"
        f"# 出力形式（JSON のみ・前後に文章を付けない）\n"
        f'{{"sections":[{{"title":"概要","body":"…"}}]}}\n'
        f"title は次から該当するものだけ・順序維持: {', '.join(SECTIONS)}。\n"
        f"各 body は 1〜3 文の簡潔な日本語。根拠が無いセクションは省略し、断定は避ける。"
    )
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): build_profile_prompt（grounding）"`

---

### Task 6: parse_profile_response（LLM 応答 → sections）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep.py`

**Interfaces:** Produces `parse_profile_response(text) -> list[{"title","body"}]`（SECTIONS のみ・空 body 除外・重複除外・順序は応答順）。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import parse_profile_response

def test_parse_profile_response_valid_and_filtered():
    text = '前置き {"sections":[{"title":"概要","body":"…"},{"title":"気候","body":" "},' \
           '{"title":"不正","body":"x"},{"title":"観光名所","body":"名所が多い"}]} 後置き'
    out = parse_profile_response(text)
    assert [s["title"] for s in out] == ["概要", "観光名所"]   # 空body/不正title 除外
    assert out[1]["body"] == "名所が多い"

def test_parse_profile_response_bad_json():
    assert parse_profile_response("not json") == []
    assert parse_profile_response(None) == []
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**

```python
def parse_profile_response(text):
    """LLM 応答テキスト→ sections。SECTIONS の title・非空 body のみ・重複除外。"""
    if not isinstance(text, str):
        return []
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return []
    out, seen = [], set()
    for s in (data or {}).get("sections") or []:
        t = (s or {}).get("title")
        b = (s or {}).get("body")
        if t in SECTIONS and t not in seen and isinstance(b, str) and b.strip():
            out.append({"title": t, "body": b.strip()})
            seen.add(t)
    return out
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): parse_profile_response"`

---

### Task 7: assemble_profile ＋ is_degraded（schema 整形）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep.py`

**Interfaces:** Produces `assemble_profile(pid, level, name_ja, facts, sections, source, degraded) -> dict` / `is_degraded(qid, sections) -> bool`。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import assemble_profile, is_degraded

def test_is_degraded():
    assert is_degraded(None, [{"title": "概要", "body": "x"}]) is True   # QID 無し
    assert is_degraded("Q1", []) is True                                  # セクション皆無
    assert is_degraded("Q1", [{"title": "概要", "body": "x"}]) is False

def test_assemble_profile_schema():
    p = assemble_profile("JA", "country", "日本", {"population": 1}, [], {"qid": "Q17", "wikipedia_url": None}, True)
    assert p["id"] == "JA" and p["level"] == "country" and p["name_ja"] == "日本"
    assert p["facts"] == {"population": 1} and p["sections"] == []
    assert p["source"] == {"qid": "Q17", "wikipedia_url": None} and p["degraded"] is True
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**

```python
def is_degraded(qid, sections):
    """QID 無し or セクション皆無 = degraded（事実のみ表示にフォールバック）。"""
    return (not qid) or (len(sections) == 0)


def assemble_profile(pid, level, name_ja, facts, sections, source, degraded):
    """出力スキーマに整形。"""
    return {
        "id": pid, "level": level, "name_ja": name_ja,
        "facts": facts, "sections": sections,
        "source": source, "degraded": bool(degraded),
    }
```

- [ ] **Step 4: 合格確認** — Run: same Expected: PASS
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): assemble_profile/is_degraded"`

---

### Task 8: generate_profile（I/O 注入オーケストレーション）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep.py`

**Interfaces:**
- Consumes: 上記全純関数。`fetch_wikidata(qid)->entity|None` / `fetch_wikipedia(title)->summary|None` / `ask_llm(prompt)->text` を注入。
- Produces: `generate_profile(level, pid, name_ja, qid, *, fetch_wikidata, fetch_wikipedia, ask_llm) -> profile dict`。

- [ ] **Step 1: 失敗テスト**

```python
from scripts.lib.profile_prep import generate_profile

def test_generate_profile_happy():
    entity = {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+100"}}}}]},
              "sitelinks": {"jawiki": {"title": "東京都"}}}
    prof = generate_profile(
        "admin1", "JP-13", "東京都", "Q1490",
        fetch_wikidata=lambda q: entity,
        fetch_wikipedia=lambda t: "東京都は…",
        ask_llm=lambda p: '{"sections":[{"title":"概要","body":"日本の首都圏"}]}',
    )
    assert prof["degraded"] is False
    assert prof["facts"]["population"] == 100
    assert prof["sections"][0]["title"] == "概要"
    assert prof["source"] == {"qid": "Q1490", "wikipedia_url": "https://ja.wikipedia.org/wiki/東京都"}

def test_generate_profile_no_qid_degraded():
    prof = generate_profile("city", "Qx", "謎の町", None,
                            fetch_wikidata=lambda q: None, fetch_wikipedia=lambda t: None,
                            ask_llm=lambda p: "")
    assert prof["degraded"] is True and prof["sections"] == []

def test_generate_profile_no_jawiki_skips_llm():
    called = {"n": 0}
    def ask(p): called["n"] += 1; return ""
    prof = generate_profile("city", "Q9", "X", "Q9",
                            fetch_wikidata=lambda q: {"claims": {}, "sitelinks": {}},
                            fetch_wikipedia=lambda t: None, ask_llm=ask)
    assert called["n"] == 0 and prof["degraded"] is True   # ja Wikipedia 無→LLM 呼ばず degraded
```

- [ ] **Step 2: 失敗確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: FAIL

- [ ] **Step 3: 実装**

```python
def generate_profile(level, pid, name_ja, qid, *, fetch_wikidata, fetch_wikipedia, ask_llm):
    """1 地域のプロフィール生成。I/O は注入（テスト可能）。
    qid 無し or ja Wikipedia 無し or セクション皆無 → degraded（事実のみ）。"""
    if not qid:
        return assemble_profile(pid, level, name_ja, wikidata_facts({}), [],
                                {"qid": None, "wikipedia_url": None}, True)
    entity = fetch_wikidata(qid) or {}
    facts = wikidata_facts(entity)
    title = ja_wikipedia_title(entity)
    summary = fetch_wikipedia(title) if title else None
    sections = []
    if summary:
        sections = parse_profile_response(ask_llm(build_profile_prompt(name_ja, level, facts, summary)))
    wiki_url = f"https://ja.wikipedia.org/wiki/{title}" if title else None
    return assemble_profile(pid, level, name_ja, facts, sections,
                            {"qid": qid, "wikipedia_url": wiki_url}, is_degraded(qid, sections))
```

- [ ] **Step 4: 合格確認** — Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q` Expected: PASS（全 task の test）
- [ ] **Step 5: コミット** — `git commit -am "feat(profiles): generate_profile（I/O 注入）"`

---

### Task 9: build_profiles.py（実 I/O・キャッシュ・反復・manifest）

**Files:**
- Create: `scripts/build_profiles.py`
- （テストは Task 1-8 の純関数で担保。build_profiles は実ネット/LLM のため node/pytest 対象外＝Task 10 の実走で検証）

**Interfaces:**
- Consumes: `profile_prep.generate_profile` ほか・NE キャッシュ（`scripts/.cache/ne/`）・`data/static/admin1/*.gz`・`data/static/cities/*.json`・`js/lib/places.js`（FIPS_JA）。
- Produces: `data/static/profiles/{country,admin1,city}/<id>.json(.gz)` ＋ `data/static/profiles_manifest.json`。env `PROFILE_FIPS`（カンマ区切り・既定全部）で対象国を絞る。

- [ ] **Step 1: 実装**（`scripts/build_profiles.py` 新規）

```python
#!/usr/bin/env python3
"""地域(国/県/都市)の Wikipedia(ja)/Wikidata 事実を Claude で日本語プロフィール化し
data/static/profiles/** ＋ profiles_manifest.json を生成する（build 時オフライン）。

対象国は env PROFILE_FIPS（カンマ区切り FIPS・既定=FIPS_JA 全部）。
キャッシュ scripts/.cache/profiles/ に raw/生成を保存し再実行はスキップ。
実行: PYTHONPATH=. python3 scripts/build_profiles.py
"""
import gzip
import json
import os
import re
import time

import requests

from scripts.lib.profile_prep import generate_profile, resolve_qid, SECTIONS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE = os.path.join(ROOT, "scripts/.cache/ne")
CACHE = os.path.join(ROOT, "scripts/.cache/profiles")
OUT = os.path.join(ROOT, "data/static/profiles")
MODEL = os.environ.get("PROFILE_LLM_MODEL", "claude-sonnet-4-6")
UA = {"User-Agent": "orbis-profile-collector"}
PROFILE_SYSTEM = ("あなたは地理事典の編集者です。与えられた事実のみを根拠に、"
                  "字幕でなく説明文として自然で簡潔な日本語プロフィールを作ります。")


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def _cache_get(name):
    p = os.path.join(CACHE, name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _cache_put(name, obj):
    os.makedirs(CACHE, exist_ok=True)
    json.dump(obj, open(os.path.join(CACHE, name), "w", encoding="utf-8"), ensure_ascii=False)


def fetch_wikidata(qid):
    cached = _cache_get(f"wd_{qid}.json")
    if cached is not None:
        return cached.get("entity")
    url = f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json"
    try:
        r = requests.get(url, timeout=30, headers=UA)
        r.raise_for_status()
        entity = (r.json().get("entities") or {}).get(qid)
    except Exception:
        entity = None
    _cache_put(f"wd_{qid}.json", {"entity": entity})
    time.sleep(0.2)
    return entity


def fetch_wikipedia(title):
    key = re.sub(r"[^A-Za-z0-9_]", "_", title)[:80]
    cached = _cache_get(f"wp_{key}.json")
    if cached is not None:
        return cached.get("summary")
    url = "https://ja.wikipedia.org/api/rest_v1/page/summary/" + requests.utils.quote(title, safe="")
    try:
        r = requests.get(url, timeout=30, headers=UA)
        r.raise_for_status()
        summary = r.json().get("extract") or None
    except Exception:
        summary = None
    _cache_put(f"wp_{key}.json", {"summary": summary})
    time.sleep(0.2)
    return summary


def ask_llm(prompt):
    # ダミーモード(PROFILE_DUMMY=1): 実 LLM を呼ばずデザイン確認用のサンプル本文を返す（API キー不要）。
    if os.environ.get("PROFILE_DUMMY") == "1":
        return json.dumps({"sections": [
            {"title": t, "body": f"（サンプル）{t}の説明テキスト。デザイン・体裁確認用のダミーです。"}
            for t in SECTIONS]}, ensure_ascii=False)
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return ""
    try:
        import anthropic
        client = anthropic.Anthropic()
        msg = client.messages.create(model=MODEL, max_tokens=1200, temperature=0,
                                     system=PROFILE_SYSTEM,
                                     messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text
    except Exception as e:
        print(f"[profiles] llm error: {e}")
        return ""


DUMMY = os.environ.get("PROFILE_DUMMY") == "1"


def _dummy_wikidata(qid):
    return {"claims": {"P1082": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000000"}}}}],
                       "P2046": [{"mainsnak": {"datavalue": {"value": {"amount": "+1000"}}}}]},
            "sitelinks": {"jawiki": {"title": "（ダミー）"}}}


def _dummy_wikipedia(title):
    return "（ダミー要約）デザイン・体裁確認用のサンプル説明文です。"


def _gen_cached(level, pid, name_ja, qid):
    """generated_<level>_<pid>.json をキャッシュ。無ければ生成。ダミーは別キャッシュ名。"""
    cname = f"{'dummy_' if DUMMY else ''}gen_{level}_{re.sub(r'[^A-Za-z0-9_-]', '_', pid)}.json"
    cached = _cache_get(cname)
    if cached is not None:
        return cached
    fw = _dummy_wikidata if DUMMY else fetch_wikidata
    fwp = _dummy_wikipedia if DUMMY else fetch_wikipedia
    prof = generate_profile(level, pid, name_ja, qid or ("Q_DUMMY" if DUMMY else None),
                            fetch_wikidata=fw, fetch_wikipedia=fwp, ask_llm=ask_llm)
    _cache_put(cname, prof)
    return prof


def _write(level, pid, prof, gz):
    d = os.path.join(OUT, level)
    os.makedirs(d, exist_ok=True)
    if gz:
        path = os.path.join(d, f"{pid}.json.gz")
        with gzip.open(path, "wt", encoding="utf-8") as f:
            json.dump(prof, f, ensure_ascii=False, separators=(",", ":"))
    else:
        path = os.path.join(d, f"{pid}.json")
        json.dump(prof, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return os.path.getsize(path)


def main():
    fips_ja = load_fips_ja()
    target = os.environ.get("PROFILE_FIPS")
    targets = [c.strip() for c in target.split(",")] if target else list(fips_ja)
    manifest = {"country": {}, "admin1": {}, "city": {}}

    # 国: NE admin0 から QID。
    ne0 = json.load(open(os.path.join(NE, "ne_50m_admin_0_countries.geojson"), encoding="utf-8"))
    iso_to_qid = {}
    for f in ne0["features"]:
        p = f["properties"]
        iso_to_qid[(p.get("ISO_A2") or "").upper()] = resolve_qid(p)

    from scripts.lib.fips_of_iso import FIPS_OF_ISO
    qid_by_fips = {}
    for iso, q in iso_to_qid.items():
        fp = FIPS_OF_ISO.get(iso)
        if fp and q:
            qid_by_fips.setdefault(fp, q)

    for fips in targets:
        name_ja = fips_ja.get(fips, fips)
        prof = _gen_cached("country", fips, name_ja, qid_by_fips.get(fips))
        b = _write("country", fips, prof, gz=False)
        manifest["country"][fips] = {"bytes": b, "degraded": prof["degraded"]}

    # 県/州: NE admin1（a1code・wikidataid）。対象国のみ。
    ne1 = json.load(open(os.path.join(NE, "ne_10m_admin_1_states_provinces.geojson"), encoding="utf-8"))
    from scripts.lib.ne_prep import resolve_fips
    name_index = {f["properties"]["name"]: f["properties"]["code"]
                  for f in json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))["features"]}
    for f in ne1["features"]:
        p = f["properties"]
        fips = resolve_fips(p, name_index)
        if fips not in targets:
            continue
        a1 = p.get("iso_3166_2") or p.get("code_hasc") or p.get("adm1_code")
        if not a1:
            continue
        name_ja = p.get("name_ja") or p.get("name") or a1
        prof = _gen_cached("admin1", a1, name_ja, resolve_qid(p))
        b = _write("admin1", a1, prof, gz=True)
        manifest["admin1"][a1] = {"bytes": b, "degraded": prof["degraded"]}

    # 都市: cities/<FIPS>.json（qid 付与済）。対象国のみ。
    for fips in targets:
        cpath = os.path.join(ROOT, "data/static/cities", f"{fips}.json")
        if not os.path.exists(cpath):
            continue
        for c in json.load(open(cpath, encoding="utf-8")):
            qid = c.get("qid") or None
            if not qid:
                continue
            name_ja = c.get("name_ja") or c.get("name") or qid
            prof = _gen_cached("city", qid, name_ja, qid)
            b = _write("city", qid, prof, gz=True)
            manifest["city"][qid] = {"bytes": b, "degraded": prof["degraded"]}

    os.makedirs(OUT, exist_ok=True)
    json.dump(manifest, open(os.path.join(ROOT, "data/static/profiles_manifest.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    nc, na, ncity = len(manifest["country"]), len(manifest["admin1"]), len(manifest["city"])
    print(f"[profiles] country={nc} admin1={na} city={ncity} (targets={targets[:5]}{'…' if len(targets) > 5 else ''})")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 構文・import 検証**（実 LLM 無しで動作確認＝ANTHROPIC_API_KEY 未設定なら ask_llm が "" を返し degraded 生成）

Run: `PROFILE_FIPS=JA PYTHONPATH=. python3 -c "import scripts.build_profiles as b; print('import ok')"`
Expected: `import ok`（構文/依存解決）

- [ ] **Step 3: コミット**

```bash
git add scripts/build_profiles.py
git commit -m "feat(profiles): build_profiles.py（Wikidata/Wikipedia取得+Claude整形+cache+manifest）"
```

---

### Task 10: 日本サブセット生成＋品質/コスト/カバレッジ実測

**Files:** Generated `data/static/profiles/**`（JA 分）・`data/static/profiles_manifest.json`

- [ ] **Step 1: 日本分をダミー生成**（API キー不要・実取得もダミーで省略。NE キャッシュは admin1 反復に必要＝無ければ Phase2 の取得手順で `scripts/.cache/ne/` に再取得。cities は `data/static/cities/JA.json`＝Phase2 生成済を使用）

Run: `PROFILE_DUMMY=1 PROFILE_FIPS=JA PYTHONPATH=. python3 scripts/build_profiles.py`
Expected: `[profiles] country=1 admin1=47 city=69`（日本＝1国＋47都道府県＋約69都市・全件 degraded=false でダミーセクション入り）
（将来タスク＝実 LLM 生成: `ANTHROPIC_API_KEY` を設定し `PROFILE_DUMMY` 無しで実行→全 FIPS で 2.5c）

- [ ] **Step 2: カバレッジ/サイズ/品質を実測**

```bash
PYTHONPATH=. python3 - <<'PY'
import json, gzip, os
m = json.load(open("data/static/profiles_manifest.json"))
for lvl in ("country", "admin1", "city"):
    d = m[lvl]; deg = sum(1 for v in d.values() if v["degraded"])
    print(f"{lvl}: {len(d)} 件 / degraded {deg} / 非degraded {len(d)-deg}")
# 代表サンプル（東京都 admin1）
import glob
for p in glob.glob("data/static/profiles/admin1/*.gz")[:1]:
    prof = json.load(gzip.open(p))
    print("sample:", prof["name_ja"], "sections=", [s["title"] for s in prof["sections"]])
    print("  概要:", next((s["body"] for s in prof["sections"] if s["title"]=="概要"), "(なし)")[:80])
# 総サイズ
import subprocess
print("profiles dir:", subprocess.check_output(["du","-sh","data/static/profiles"]).split()[0].decode())
PY
```
Expected: degraded 率が低く（主要県/都市は非degraded）、サンプルの概要が事実ベースの自然な日本語、総サイズ数百KB。**1 件あたり LLM コストを Anthropic ダッシュボードで確認し、×11,600 の概算を算出**（2.5c 着手判断材料）。

- [ ] **Step 3: 全 pytest 緑を確認**

Run: `PYTHONPATH=. python3 -m pytest tests/test_profile_prep.py -q`
Expected: PASS（全 task）

- [ ] **Step 4: 日本分プロフィール＋manifest をコミット**

```bash
git add data/static/profiles data/static/profiles_manifest.json data/static/cities
git commit -m "data(profiles): 日本サブセット(国+47県+主要都市)プロフィール生成"
```

- [ ] **Step 5: 結果を報告し 2.5b(UI)/2.5c(全生成) 判断を仰ぐ**

degraded 率・サンプル品質・サイズ・コスト概算を提示し、(a)プロンプト/セクション調整の要否、(b)2.5b UI 着手、(c)2.5c 全生成のコスト承認、をユーザーに確認。

---

## Self-Review

**1. Spec coverage:**
- データ源ハイブリッド（Wikipedia/Wikidata→Claude）= Task 8/9 ✓
- 全レベル（国/県/都市）= Task 9 の3反復 ✓（2.5a は PROFILE_FIPS=JA で日本のみ）
- QID 紐付け（NE wikidataid）= Task 2/9 ✓・都市 qid = Task 1 ✓
- schema（facts/sections/source/degraded）= Task 3/6/7 ✓
- grounding/幻覚抑制 = Task 5（プロンプト）＋ degraded = Task 7 ✓
- キャッシュ/再現性 = Task 9（_cache_get/put・_gen_cached）✓
- manifest = Task 9 ✓
- 整形モデル Sonnet 4.6・PROFILE_LLM_MODEL 切替・ANTHROPIC_API_KEY ガード = Task 9 ✓
- 日本サブセットで品質/コスト実測 = Task 10 ✓
- UI（2.5b）・全生成（2.5c）は本計画の対象外（別計画）= スコープ通り ✓

**2. Placeholder scan:** TODO/TBD 無し。各 step に実コード/実コマンド/期待値あり。

**3. Type consistency:** `generate_profile` の引数（level,pid,name_ja,qid＋注入3つ）は Task 8 定義と Task 9 呼び出しで一致。`wikidata_facts`/`parse_profile_response`/`assemble_profile`/`is_degraded`/`resolve_qid`/`ja_wikipedia_title`/`build_profile_prompt` のシグネチャは定義タスクと generate_profile/build_profiles の利用箇所で一致。schema キーは spec と一致。
