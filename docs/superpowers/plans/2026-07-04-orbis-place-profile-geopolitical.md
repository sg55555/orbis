# 地域プロフィール 地政学再設計 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orbis の地域プロフィールを、因果レイヤー（地勢→産業→社会→地政→外交）＋確度ラベル＋年表＋観光の「根拠つき地政学分析レポート」へ再設計し、日本＋近隣数カ国のパイロットまで実生成する。

**Architecture:** `scripts/lib/profile_prep.py` の純関数群を新スキーマ v2 用に刷新（Wikidata固有名整形／Wikipedia本文の節抽出／プロンプト構築／応答パース／組立）。`scripts/build_profiles.py` は逐次取得（Wikidata/Wikipedia・キャッシュ）＋ **Anthropic Message Batches API** で LLM 呼び出しを集約。`js/lib/drilldown/profile_view.js` は新スキーマ v2 を描画。純関数は stdlib のみで pytest、描画は node:test。

**Tech Stack:** Python 3.14（stdlib＋requests＋anthropic SDK）、Vanilla JS（ESM）、node:test、pytest。

## Global Constraints（各タスクに暗黙適用）

- モデル＝`claude-sonnet-4-6`（env `PROFILE_LLM_MODEL`）・`temperature=0`・Batch API（50%オフ）。
- 確度ラベル＝`certain`｜`inferred`｜`time_sensitive`（本文はプレーン散文、確度は `confidence` 配列で構造化）。
- **具体名列挙**（カテゴリ要約禁止：4公用語→言語名／宗教→宗教名／産業→産業名／隣接→国名）。固有名は可能な限り Wikidata から供給。
- 因果レイヤー5層＋観光独立枠。レベル別縮退（国＝地政・外交フル／県・都市＝立地・産業因果、地政は"国内での位置づけ"、外交は所属国へリンク）。
- 純関数（profile_prep）は **stdlib のみ**・I/O は注入（テスト可能）。build_profiles が I/O。
- 出力スキーマ v2（spec §6）を単一の真実とする。`degraded`（QID無し／本文無し／layers皆無）は事実のみ表示にフォールバック。
- 段階導入＝`PROFILE_FIPS` で対象国指定。パイロット＝日本＋近隣（韓国/中国/台湾/シンガポール/タイ 等）。
- キャッシュ `scripts/.cache/profiles/`（v2は別キャッシュ名 `v2_*` で旧ダミーと衝突回避）。
- フロート UI は面禁則（不透明フロート内で glow/線/縁）を遵守。

**参照 spec:** `docs/superpowers/specs/2026-07-04-orbis-place-profile-geopolitical-redesign.md`

---

## File Structure

- `scripts/lib/profile_prep.py`（**大改修**）：LAYERS 定義／Wikidata拡張＋固有名整形／節抽出／プロンプトv2／パースv2／組立v2／generate_profile_v2。純関数。
- `scripts/build_profiles.py`（**大改修**）：Wikidataプロパティ取得（wbgetentities）／本文取得（extracts explaintext）／Batch API 生成／custom_id ひも付け／書き出し。
- `tests/test_profile_prep_v2.py`（**新規**）：純関数の pytest。
- `js/lib/drilldown/profile_view.js`（**大改修**）：v2スキーマ描画（layers/確度バッジ/evidence/dig_deeper/timeline/tourism/belongs_to）。
- `tests/node/profile_view_v2.test.js`（**新規 or 既存拡張**）：描画の node:test。
- `css/`（該当ファイル）：確度バッジ・年表・観光枠のスタイル。
- 既存 `profile_data.js`/`resolve_place.js`：スキーマ整合の微修正。

各タスクは TDD（**テスト作成 → 失敗確認 → 実装 → 通過確認 → commit** の5ステップ）。以下は各タスクの核心コードとインターフェースを示す（自明な run/fail/pass ステップは定型のため省略記載）。

---

### Task 1: Wikidata プロパティ拡張＋固有名整形（純関数）

**Files:** Modify `scripts/lib/profile_prep.py` / Test `tests/test_profile_prep_v2.py`

**Interfaces:**
- Produces:
  - `wikidata_facts(entity) -> dict`（既存拡張：`gdp_per_capita` 追加、P2132）
  - `named_props(entity, *, label_resolver) -> dict`＝`{"languages":[名], "borders":[名], "memberships":[名]}`。`label_resolver(qids:list[str]) -> dict[qid,ja_label]` を注入。
  - `dedup_names(names) -> list`（順序保持・重複除去・空/None除去）

**核心コード:**
```python
def _prop_qids(claims, pid):
    out = []
    for c in claims.get(pid) or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            if isinstance(v, dict) and "id" in v:
                out.append(v["id"])
        except (KeyError, TypeError):
            continue
    return out

def dedup_names(names):
    seen, out = set(), []
    for n in names:
        if n and n not in seen:
            seen.add(n); out.append(n)
    return out

def named_props(entity, *, label_resolver):
    claims = (entity or {}).get("claims") or {}
    langs = _prop_qids(claims, "P37")
    borders = _prop_qids(claims, "P47")
    members = _prop_qids(claims, "P463")
    lut = label_resolver(langs + borders + members) if (langs or borders or members) else {}
    name = lambda qs: dedup_names([lut.get(q) for q in qs])
    return {"languages": name(langs), "borders": name(borders), "memberships": name(members)}
```
`wikidata_facts` は既存に `"gdp_per_capita": _claim_amount(claims, "P2132")` を追加（None 許容）。

**テスト核心:**
```python
def test_named_props_resolves_ja_labels():
    entity = {"claims": {"P37": [{"mainsnak":{"datavalue":{"value":{"id":"Q1860"}}}}],
                         "P47": [{"mainsnak":{"datavalue":{"value":{"id":"Q833"}}}},
                                 {"mainsnak":{"datavalue":{"value":{"id":"Q833"}}}}]}}  # 重複
    res = named_props(entity, label_resolver=lambda qs: {"Q1860":"英語","Q833":"マレーシア"})
    assert res["languages"] == ["英語"]
    assert res["borders"] == ["マレーシア"]  # dedup
```

Commit: `feat(profiles): Wikidata固有名整形(named_props)+dedup+gdp facts`

---

### Task 2: Wikipedia 本文の節抽出（純関数）

**Files:** Modify `scripts/lib/profile_prep.py` / Test 同上

**Interfaces:**
- Produces: `extract_sections(plaintext:str, *, max_chars:int=6000) -> str`
- 定数: `SECTION_ALLOW`（正規化キー集合）、`SECTION_SYNONYMS`（見出し→キー）

**設計（scout知見）:** extracts explaintext は `== 見出し ==` を保持。全文を見出しで分割し、allowlist の節のみ結合、`max_chars` でトリム（レイヤー描画に必要な地理/歴史/経済/産業/政治/国際関係/社会・人口/観光/交通に限定）。

**核心コード:**
```python
import re

# 正規化キー: geography/history/economy/politics/foreign/society/tourism/transport/overview
SECTION_SYNONYMS = {
    "概要":"overview","地理":"geography","地理・地域":"geography","自然環境":"geography","気候":"geography",
    "歴史":"history","国名":"history",
    "経済":"economy","産業":"economy","経済・産業":"economy",
    "政治":"politics",
    "国際関係":"foreign","対外関係":"foreign",
    "国民":"society","人口":"society","都民":"society","民族":"society","文化":"society",
    "観光":"tourism","文化・スポーツ・観光":"tourism",
    "交通":"transport",
}
SECTION_ALLOW = {"overview","geography","history","economy","politics","foreign","society","tourism","transport"}
_HEAD = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$", re.M)

def extract_sections(plaintext, *, max_chars=6000):
    if not plaintext:
        return ""
    # 分割点（見出し位置）を集める
    marks = [(m.start(), m.group(2).strip()) for m in _HEAD.finditer(plaintext)]
    # 先頭（最初の見出し前）＝概要相当
    blocks = []
    lead_end = marks[0][0] if marks else len(plaintext)
    lead = plaintext[:lead_end].strip()
    if lead:
        blocks.append(("overview", lead))
    for i, (pos, head) in enumerate(marks):
        key = SECTION_SYNONYMS.get(head)
        if key not in SECTION_ALLOW:
            continue
        body_start = plaintext.find("\n", pos) + 1
        body_end = marks[i+1][0] if i+1 < len(marks) else len(plaintext)
        body = plaintext[body_start:body_end].strip()
        if body:
            blocks.append((key, f"【{head}】\n{body}"))
    text = "\n\n".join(b for _, b in blocks)
    return text[:max_chars]
```

**テスト核心:**
```python
def test_extract_sections_keeps_allow_drops_deny():
    raw = "冒頭概要。\n\n== 歴史 ==\n歴史本文。\n\n== 著名な出身者 ==\n人名。\n\n== 経済 ==\n経済本文。"
    out = extract_sections(raw, max_chars=9999)
    assert "歴史本文" in out and "経済本文" in out
    assert "人名" not in out  # denylist(未定義キー)は除外
def test_extract_sections_trims():
    assert len(extract_sections("x"*10000, max_chars=100)) == 100
```

Commit: `feat(profiles): Wikipedia本文の節抽出(allowlist+同義語+トリム)`

---

### Task 3: プロンプト構築 v2（純関数）

**Files:** Modify `scripts/lib/profile_prep.py` / Test 同上

**Interfaces:**
- Produces: `LAYERS`（`[{key,title,levels}]`）、`build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_to_name=None) -> str`

**核心コード:**
```python
LAYERS = [
    {"key":"geography","title":"地勢・立地","levels":{"country","admin1","city"}},
    {"key":"economy","title":"産業の成り立ちと近代化","levels":{"country","admin1","city"}},
    {"key":"society","title":"社会・人口","levels":{"country","admin1","city"}},
    {"key":"geopolitics","title":"地政学的位置づけ","levels":{"country","admin1","city"}},
    {"key":"diplomacy","title":"外交姿勢と国際的立場","levels":{"country"}},  # 国のみ
]

PROFILE_SYSTEM_V2 = (
    "あなたは地理・地政学の事典編集者兼アナリストです。与えられた事実(Wikidata)と"
    "Wikipedia本文の抜粋のみを根拠に、地域を『因果の連鎖』で読み解く日本語の分析プロフィールを作ります。\n"
    "規則: (1)カテゴリ要約でなく固有名を列挙(『4公用語』でなく言語名、宗教・産業・隣接国も固有名)。"
    "(2)断定は根拠のある事実に限り、因果の解釈は confidence=inferred、時事依存は time_sensitive と明示。"
    "(3)材料に無い情報を創作しない。書けない層は省略してよい。"
    "(4)各層に evidence(何を見たか)と dig_deeper(次に見る指標)を付す。出力はJSONのみ。"
)

def build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_to_name=None):
    layers = [l for l in LAYERS if level in l["levels"]]
    layer_lines = "\n".join(f'  - {l["key"]}: {l["title"]}' for l in layers)
    facts_lines = "\n".join(f"- {k}: {v}" for k,v in (facts or {}).items() if v is not None)
    named_lines = "\n".join(f"- {k}: {', '.join(v)}" for k,v in (named or {}).items() if v)
    dip_note = ("" if level=="country" else
                f"\n※この地域は{level}のため diplomacy 層は省略（外交は所属国「{belongs_to_name}」に集約）。")
    return (
        f"地域「{name_ja}」(種別: {level}) の因果分析プロフィールをJSONで作成。{dip_note}\n\n"
        f"# 対象レイヤー(この順・書ける層のみ)\n{layer_lines}\n\n"
        f"# 事実(Wikidata)\n{facts_lines or '(なし)'}\n"
        f"# 固有名(Wikidata・そのまま使う)\n{named_lines or '(なし)'}\n\n"
        f"# Wikipedia本文(抜粋)\n{section_text or '(なし)'}\n\n"
        f'# 出力形式(JSONのみ)\n'
        '{"layers":[{"key":"geography","title":"地勢・立地","body":"…因果の散文…",'
        '"confidence":[{"label":"certain","kind":"地理","note":"…"},{"label":"inferred","kind":"解釈","note":"…"}],'
        '"evidence":"…","dig_deeper":["…","…"]}],'
        '"timeline":[{"year":"1819","event":"…","confidence":"certain","cause_note":"…(推定)"}],'
        '"tourism":["…"]}\n'
        "・body は1〜4文の散文。confidence は label∈{certain,inferred,time_sensitive}。"
        "・timeline は近代化の経緯(economy層に対応・年号は certain)。tourism は観光の固有名(都市は厚め)。"
        "・外交(diplomacy)は恒常的な立場を certain/inferred で、時々刻々の動向は time_sensitive とし dig_deeper へ。"
    )
```

**テスト核心:**
```python
def test_prompt_omits_diplomacy_for_city():
    p = build_profile_prompt_v2("大阪市","city",{},{},"", belongs_to_name="日本")
    assert "diplomacy" not in p and "所属国「日本」" in p
def test_prompt_includes_named_props():
    p = build_profile_prompt_v2("X","country",{},{"languages":["英語","タミル語"]},"")
    assert "英語, タミル語" in p and "geography" in p and "diplomacy" in p
```

Commit: `feat(profiles): プロンプトv2(レイヤー/確度/年表/観光/レベル別縮退)`

---

### Task 4: 応答パース＋組立 v2（純関数）

**Files:** Modify `scripts/lib/profile_prep.py` / Test 同上

**Interfaces:**
- Produces: `parse_profile_v2(text) -> dict`（`{layers,timeline,tourism}`・検証済）、`assemble_profile_v2(...) -> dict`、`is_degraded_v2(qid, parsed) -> bool`

**核心コード:**
```python
_LAYER_KEYS = {l["key"] for l in LAYERS}
_CONF = {"certain","inferred","time_sensitive"}

def parse_profile_v2(text):
    if not isinstance(text, str): return {"layers":[],"timeline":[],"tourism":[]}
    m = re.search(r"\{.*\}", text, re.S)
    if not m: return {"layers":[],"timeline":[],"tourism":[]}
    try: data = json.loads(m.group(0))
    except ValueError: return {"layers":[],"timeline":[],"tourism":[]}
    layers, seen = [], set()
    for s in (data.get("layers") or []):
        k = (s or {}).get("key"); b = (s or {}).get("body")
        if k in _LAYER_KEYS and k not in seen and isinstance(b,str) and b.strip():
            conf = [c for c in (s.get("confidence") or [])
                    if isinstance(c,dict) and c.get("label") in _CONF and c.get("note")]
            dig = [d for d in (s.get("dig_deeper") or []) if isinstance(d,str) and d.strip()]
            layers.append({"key":k,"title":s.get("title") or k,"body":b.strip(),
                           "confidence":conf,"evidence":(s.get("evidence") or "").strip(),
                           "dig_deeper":dig})
            seen.add(k)
    timeline = [{"year":str(t.get("year")),"event":t.get("event","").strip(),
                 "confidence":t.get("confidence") if t.get("confidence") in _CONF else "certain",
                 "cause_note":(t.get("cause_note") or "").strip()}
                for t in (data.get("timeline") or []) if isinstance(t,dict) and t.get("event")]
    tourism = [x.strip() for x in (data.get("tourism") or []) if isinstance(x,str) and x.strip()]
    return {"layers":layers,"timeline":timeline,"tourism":tourism}

def is_degraded_v2(qid, parsed):
    return (not qid) or (len(parsed.get("layers") or []) == 0)

def assemble_profile_v2(pid, level, name_ja, facts, parsed, source, degraded, belongs_to, generated_at):
    return {"id":pid,"level":level,"name_ja":name_ja,"belongs_to":belongs_to,
            "facts":facts,"layers":parsed["layers"],"timeline":parsed["timeline"],
            "tourism":parsed["tourism"],"source":source,"degraded":bool(degraded),
            "generated_at":generated_at}
```

**テスト核心:**
```python
def test_parse_v2_filters_bad_confidence_and_keys():
    txt = '{"layers":[{"key":"geography","title":"地勢","body":"本文",'\
          '"confidence":[{"label":"bogus","note":"x"},{"label":"certain","kind":"地理","note":"y"}],'\
          '"dig_deeper":["a"]},{"key":"nope","body":"z"}],"timeline":[{"year":1819,"event":"開港"}],"tourism":["名所"]}'
    r = parse_profile_v2(txt)
    assert [l["key"] for l in r["layers"]] == ["geography"]
    assert [c["label"] for c in r["layers"][0]["confidence"]] == ["certain"]
    assert r["timeline"][0]["year"] == "1819" and r["tourism"] == ["名所"]
def test_degraded_v2_when_no_layers():
    assert is_degraded_v2("Q1", {"layers":[]}) is True
```

Commit: `feat(profiles): 応答パースv2+組立v2+degraded判定`

---

### Task 5: 取得配線＋Batch生成（build_profiles.py）

**Files:** Modify `scripts/build_profiles.py` / Test `tests/test_profile_prep_v2.py`（generate_profile_v2 の統合をダミーI/Oで）

**Interfaces:**
- Produces: `generate_profile_v2(level, pid, name_ja, qid, belongs_to, generated_at, *, fetch_wikidata, fetch_article, label_resolver, ask_llm) -> dict`（profile_prep に置く・I/O注入）
- build_profiles: `fetch_wikidata_props`(wbgetentities batch ja labels)、`fetch_article_plaintext`(extracts explaintext)、Batch 送信/回収。

**generate_profile_v2（profile_prep・純度保持のためI/O注入）:**
```python
def generate_profile_v2(level, pid, name_ja, qid, belongs_to, generated_at,
                        *, fetch_wikidata, fetch_article, label_resolver, ask_llm):
    if not qid:
        return assemble_profile_v2(pid, level, name_ja, wikidata_facts({}),
                                   {"layers":[],"timeline":[],"tourism":[]},
                                   {"qid":None,"wikipedia_url":None,"wikidata_props":[]},
                                   True, belongs_to, generated_at)
    entity = fetch_wikidata(qid) or {}
    facts = wikidata_facts(entity)
    named = named_props(entity, label_resolver=label_resolver)
    title = ja_wikipedia_title(entity)
    section_text = extract_sections(fetch_article(title)) if title else ""
    parsed = {"layers":[],"timeline":[],"tourism":[]}
    if section_text:
        belongs_name = (belongs_to or {}).get("name_ja") if belongs_to else None
        prompt = build_profile_prompt_v2(name_ja, level, facts, named, section_text, belongs_name)
        parsed = parse_profile_v2(ask_llm(prompt))
    url = f"https://ja.wikipedia.org/wiki/{title}" if title else None
    props = [p for p,v in [("P37",named["languages"]),("P47",named["borders"]),("P463",named["memberships"])] if v]
    return assemble_profile_v2(pid, level, name_ja, facts, parsed,
                               {"qid":qid,"wikipedia_url":url,"wikidata_props":props},
                               is_degraded_v2(qid, parsed), belongs_to, generated_at)
```

**build_profiles.py の Batch フロー（2パス）:** PASS1＝全対象の取得＋プロンプト構築（LLM未呼び出し）。PASS2＝Batch 送信・回収・パース・書き出し。

```python
import time
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

def run_batch(prompts):            # prompts: list[(custom_id, prompt)]
    import anthropic
    client = anthropic.Anthropic()
    reqs = [Request(custom_id=cid, params=MessageCreateParamsNonStreaming(
                model=MODEL, max_tokens=2000, temperature=0, system=PROFILE_SYSTEM_V2,
                messages=[{"role": "user", "content": p}]))
            for cid, p in prompts]
    batch = client.messages.batches.create(requests=reqs)
    while client.messages.batches.retrieve(batch.id).processing_status != "ended":
        time.sleep(30)
    out = {}
    for r in client.messages.batches.results(batch.id):
        if r.result.type == "succeeded":
            out[r.custom_id] = next((b.text for b in r.result.message.content if b.type == "text"), "")
    return out                     # custom_id(=f"{level}:{pid}") -> response text
```

- **PASS1**: 各 target で `fetch_wikidata`/`fetch_article`/`named_props` を実施。`section_text` を作れたものだけ `(f"{level}:{pid}", build_profile_prompt_v2(...))` を貯める。`qid`無し/`section_text`無しは即 degraded で `_write`（batch 対象外）。
- **PASS2**: `run_batch(prompts)` → 各 `custom_id` を `level:pid` に分解 → `parse_profile_v2` → `assemble_profile_v2` → `_write`。結果は任意順のため custom_id でひも付け（位置で対応させない）。
- `label_resolver` = wbgetentities を batch＋キャッシュ。`ANTHROPIC_API_KEY` 必須（無ければ全 degraded）。`PROFILE_BATCH=0` で `generate_profile_v2` 逐次フォールバック（少数検証/ダミー用）。
- `region_label`（任意フィールド）: PASS1 で FIPS→地域マップ or Wikidata P30(大陸) から付与。パイロットでは省略可（YAGNI）。

**テスト核心（ダミーI/Oで統合）:**
```python
def test_generate_v2_degraded_without_qid():
    p = generate_profile_v2("city","Qx","街",None,{"level":"country","id":"JP","name_ja":"日本"},"2026-07-04",
        fetch_wikidata=lambda q:{}, fetch_article=lambda t:"", label_resolver=lambda qs:{}, ask_llm=lambda p:"")
    assert p["degraded"] is True and p["belongs_to"]["name_ja"]=="日本"
def test_generate_v2_builds_layers():
    ent={"claims":{"P1082":[{"mainsnak":{"datavalue":{"value":{"amount":"+100"}}}}]},"sitelinks":{"jawiki":{"title":"X"}}}
    llm='{"layers":[{"key":"geography","title":"地勢","body":"本文","confidence":[{"label":"certain","kind":"地理","note":"n"}]}],"timeline":[],"tourism":[]}'
    p = generate_profile_v2("country","XX","エックス","Q1",None,"2026-07-04",
        fetch_wikidata=lambda q:ent, fetch_article=lambda t:"== 歴史 ==\n史。", label_resolver=lambda qs:{}, ask_llm=lambda pr:llm)
    assert p["degraded"] is False and p["layers"][0]["key"]=="geography"
```

Commit: `feat(profiles): generate_v2統合+build_profiles Batch API化`

---

### Task 6: profile_view.js 新スキーマ描画（純HTML）

**Files:** Modify `js/lib/drilldown/profile_view.js` / Test `tests/node/profile_view_v2.test.js`

**Interfaces:** `profileHtml(model)` を v2 スキーマ（`layers`/`timeline`/`tourism`/`belongs_to`）対応に。全出力 `escapeHtml` 経由。確度は各 layer の `confidence` をバッジ、`evidence`/`dig_deeper` を末尾ブロック、`timeline` は economy 直後、`tourism` は独立枠、`belongs_to` は「外交＝所属国◯◯を参照」リンク（国以外で diplomacy 欠落時）。

**核心コード（追加関数）:**
```js
const CONF_LABEL = { certain:['確実','pf-conf--certain'], inferred:['推定','pf-conf--inferred'], time_sensitive:['要鮮度','pf-conf--time'] };
function confBadges(conf){
  if(!conf || !conf.length) return '';
  return '<div class="pf-conf">' + conf.map(c=>{
    const [ja,cls]=CONF_LABEL[c.label]||['?',''];
    return `<span class="pf-conf-b ${cls}">${escapeHtml(ja)}｜${escapeHtml(c.kind||'')}<i>${escapeHtml(c.note||'')}</i></span>`;
  }).join('') + '</div>';
}
function layerHtml(l){
  const dig = (l.dig_deeper&&l.dig_deeper.length)
    ? '<div class="pf-dig">深掘り: '+l.dig_deeper.map(escapeHtml).join(' / ')+'</div>' : '';
  const ev = l.evidence ? '<div class="pf-ev-basis">根拠: '+escapeHtml(l.evidence)+'</div>' : '';
  return `<section class="pf-layer" data-key="${escapeHtml(l.key)}">`
    + `<h2 class="pf-layer-h">${escapeHtml(l.title)}</h2>`
    + `<p>${escapeHtml(l.body)}</p>` + confBadges(l.confidence) + ev + dig + '</section>';
}
function timelineHtml(tl){
  if(!tl||!tl.length) return '';
  const items = tl.map(t=>`<li><b>${escapeHtml(t.year)}</b> ${escapeHtml(t.event)}`
    + (t.cause_note?`<span class="pf-tl-cause"> — ${escapeHtml(t.cause_note)}</span>`:'')+'</li>').join('');
  return `<section class="pf-timeline"><h3>近代化タイムライン</h3><ol>${items}</ol></section>`;
}
function tourismHtml(t){
  if(!t||!t.length) return '';
  return `<section class="pf-tourism"><h3>観光（実用情報）</h3><p>${t.map(escapeHtml).join(' ／ ')}</p></section>`;
}
```
`profileHtml` は `layers` を map→`layerHtml`、economy layer の直後に `timelineHtml(timeline)` を挿入、末尾に `tourismHtml(tourism)`、`belongs_to`＆diplomacy 欠落時に所属国リンク。既存 facts HUD／ミニグローブ／degraded バナー／source フッタは温存。旧 `sections` パスは後方互換で残すか、v2 のみに切替（データ移行済みのため v2 のみで可・spec §6）。

**テスト核心:**
```js
test('renders layers, confidence badges, timeline, tourism', () => {
  const html = profileHtml({ profile: {
    id:'SG',level:'country',name_ja:'シンガポール',belongs_to:null,facts:{},
    layers:[{key:'economy',title:'産業',body:'積層した。',confidence:[{label:'inferred',kind:'因果',note:'立地が駆動'}],evidence:'経済節',dig_deeper:['GDP構成']}],
    timeline:[{year:'1819',event:'開港',confidence:'certain',cause_note:'立地(推定)'}],
    tourism:['マーライオン'], source:{}, degraded:false }, breadcrumb:[], events:[] });
  assert.ok(html.includes('積層した'));
  assert.ok(html.includes('推定') && html.includes('立地が駆動'));
  assert.ok(html.includes('1819') && html.includes('マーライオン'));
});
test('city without diplomacy shows belongs_to link', () => {
  const html = profileHtml({ profile:{id:'Q1',level:'city',name_ja:'大阪市',
    belongs_to:{level:'country',id:'JP',name_ja:'日本'},facts:{},layers:[{key:'geography',title:'地勢',body:'x',confidence:[],dig_deeper:[]}],
    timeline:[],tourism:[],source:{},degraded:false}, breadcrumb:[], events:[] });
  assert.ok(html.includes('日本'));
});
```

Commit: `feat(profiles): profile_view v2描画(layers/確度/年表/観光/belongs_to)`

---

### Task 7: CSS（確度バッジ・年表・観光枠）

**Files:** Modify 該当 CSS（profile_view が使う既存プロフィール CSS ファイル）

面禁則遵守（不透明フロート内・glow/線/縁）。`.pf-conf-b`＝小さな縁つきバッジ（certain=cyan縁／inferred=amber縁／time_sensitive=magenta縁＋⚠️）。`.pf-timeline ol`＝縦線＋節点。`.pf-tourism`＝分析と視覚的に分離した実用枠。`.pf-dig`/`.pf-ev-basis`＝淡色の脚注。トークン（`--rim-*` 等）を既存に合わせて使用。

Commit: `style(profiles): 確度バッジ/年表/観光枠のスタイル`

---

### Task 8: パイロット生成＋実データ検証（品質ゲート）

**Files:** 実行のみ（コード変更なし）。`PROFILE_FIPS` で日本＋近隣を指定。

- [ ] pytest / node 緑を確認（`python3 -m pytest tests/test_profile_prep_v2.py` ／ `node --test tests/node/profile_view_v2.test.js`）
- [ ] **無課金の統合サニティ**：数地域で PASS1（取得＋プロンプト構築）まで走らせ、section_text と named_props が実データで埋まるか（degraded 率）をログ確認。
- [ ] **少数の実LLM生成（数十円・要ユーザー承認）**：代表 5〜10 地域を Batch で実生成 → 出力の質（因果の説得力・確度ラベルの妥当・具体名列挙・ハルシネーション有無）を太田さんと確認。**ここが品質ゲート**。
- [ ] 良ければ **パイロット本生成**：日本（国1/県47/主要都市）＋近隣（韓国/中国/台湾/シンガポール/タイ 等）を Batch 生成 → `data/static/profiles/**` 差替。
- [ ] 実機 UI 確認（本番 or ローカル）→ SW 版 up → 統合（main merge）→ push。
- [ ] コスト実測（`count_tokens` or batch usage）を記録し、アジア全体展開の見積りを更新。

Commit（データ）: `data(profiles): 日本+近隣パイロットの実生成プロフィール`

---

## Self-Review（この計画）

（次ステップで実施：spec coverage／placeholder scan／type consistency を確認し inline 修正）
