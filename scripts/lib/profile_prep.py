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
    """Wikidata entity → 事実 dict。P1082 人口/P2046 面積/P625 座標/P2044 標高/P2132 一人当たりGDP。"""
    claims = (entity or {}).get("claims") or {}
    pop = _claim_amount(claims, "P1082")
    lat, lon = _claim_coord(claims)
    return {
        "population": int(pop) if pop is not None else None,
        "area_km2": _claim_amount(claims, "P2046"),
        "lat": lat, "lon": lon,
        "elevation_m": _claim_amount(claims, "P2044"),
        "gdp_per_capita": _claim_amount(claims, "P2132"),
    }


def _prop_qids(claims, pid):
    """claims[pid] の各 claim から item 値の QID を抽出（壊れた claim は無視）。"""
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
    """順序保持で重複除去・空/None を除外。"""
    seen, out = set(), []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def named_props(entity, *, label_resolver):
    """Wikidata entity → 固有名（日本語ラベル）dict。P37 公用語/P47 隣接/P463 加盟機関。
    label_resolver(qids) -> {qid: ja_label} を注入（未解決は None→dedup_names で除外）。"""
    claims = (entity or {}).get("claims") or {}
    langs = _prop_qids(claims, "P37")
    borders = _prop_qids(claims, "P47")
    members = _prop_qids(claims, "P463")
    lut = label_resolver(langs + borders + members) if (langs or borders or members) else {}
    name = lambda qs: dedup_names([lut.get(q) for q in qs])
    return {"languages": name(langs), "borders": name(borders), "memberships": name(members)}


def ja_wikipedia_title(entity):
    """entity の日本語 Wikipedia サイトリンク title。無ければ None。"""
    sl = (entity or {}).get("sitelinks") or {}
    t = (sl.get("jawiki") or {}).get("title")
    return t.strip() if isinstance(t, str) and t.strip() else None


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


# 正規化キー: geography/history/economy/politics/foreign/society/tourism/transport/overview
SECTION_SYNONYMS = {
    "概要": "overview", "地理": "geography", "地理・地域": "geography", "自然環境": "geography", "気候": "geography",
    "歴史": "history", "国名": "history",
    "経済": "economy", "産業": "economy", "経済・産業": "economy",
    "政治": "politics",
    "国際関係": "foreign", "対外関係": "foreign",
    "国民": "society", "人口": "society", "都民": "society", "民族": "society", "文化": "society",
    "観光": "tourism", "文化・スポーツ・観光": "tourism",
    "交通": "transport",
}
SECTION_ALLOW = {"overview", "geography", "history", "economy", "politics", "foreign", "society", "tourism", "transport"}
_HEAD = re.compile(r"^(={2,})\s*(.+?)\s*\1\s*$", re.M)


def extract_sections(plaintext, *, max_chars=6000):
    """Wikipedia extracts(explaintext) 本文 → allowlist 節のみを結合した本文。
    見出し(== 見出し ==)で分割し SECTION_SYNONYMS で正規化・SECTION_ALLOW でフィルタ。
    先頭(最初の見出し前)は概要相当として残す。max_chars で末尾トリム。"""
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
        nl = plaintext.find("\n", pos)
        body_start = len(plaintext) if nl == -1 else nl + 1
        body_end = marks[i + 1][0] if i + 1 < len(marks) else len(plaintext)
        body = plaintext[body_start:body_end].strip()
        if body:
            blocks.append((key, f"【{head}】\n{body}"))
    text = "\n\n".join(b for _, b in blocks)
    return text[:max_chars]


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


# 因果レイヤー5層（diplomacy は国のみ・県/都市はレベル別縮退で省略し所属国へ集約）
LAYERS = [
    {"key": "geography", "title": "地勢・立地", "levels": {"country", "admin1", "city"}},
    {"key": "economy", "title": "産業の成り立ちと近代化", "levels": {"country", "admin1", "city"}},
    {"key": "society", "title": "社会・人口", "levels": {"country", "admin1", "city"}},
    {"key": "geopolitics", "title": "地政学的位置づけ", "levels": {"country", "admin1", "city"}},
    {"key": "diplomacy", "title": "外交姿勢と国際的立場", "levels": {"country"}},  # 国のみ
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
    """因果レイヤー(地勢→産業→社会→地政→外交)＋確度ラベル＋年表＋観光の分析プロンプトを構築。
    diplomacy はレベル別縮退（国のみフル・県/都市は省略し所属国へ集約）。"""
    layers = [layer for layer in LAYERS if level in layer["levels"]]
    has_diplomacy = any(layer["key"] == "diplomacy" for layer in layers)
    layer_lines = "\n".join(f'  - {layer["key"]}: {layer["title"]}' for layer in layers)
    facts_lines = "\n".join(f"- {k}: {v}" for k, v in (facts or {}).items() if v is not None)
    named_lines = "\n".join(f"- {k}: {', '.join(v)}" for k, v in (named or {}).items() if v)
    # レベル別縮退：diplomacy 層が対象外のとき（県・都市）は省略し所属国へ集約する旨を明示。
    # 縮退時はプロンプト全体から "diplomacy" という語自体を排し、diplomacy 層が完全に不在であることを保証する。
    dip_note = ("" if has_diplomacy else
                f"\n※この地域は{level}のため外交層は省略（外交は所属国「{belongs_to_name}」に集約）。")
    dip_guidance = (
        "・外交(diplomacy)は恒常的な立場を certain/inferred で、時々刻々の動向は time_sensitive とし dig_deeper へ。"
        if has_diplomacy else ""
    )
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
        f"{dip_guidance}"
    )


_LAYER_KEYS = {layer["key"] for layer in LAYERS}
_CONF = {"certain", "inferred", "time_sensitive"}


def parse_profile_v2(text):
    """build_profile_prompt_v2 応答テキスト → {layers,timeline,tourism}（検証済）。
    未知 layer key・不正 confidence label・空 body はフィルタして捨てる。"""
    if not isinstance(text, str):
        return {"layers": [], "timeline": [], "tourism": []}
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return {"layers": [], "timeline": [], "tourism": []}
    try:
        data = json.loads(m.group(0))
    except ValueError:
        return {"layers": [], "timeline": [], "tourism": []}
    layers, seen = [], set()
    for s in (data.get("layers") or []):
        k = (s or {}).get("key")
        b = (s or {}).get("body")
        if k in _LAYER_KEYS and k not in seen and isinstance(b, str) and b.strip():
            conf = [c for c in (s.get("confidence") or [])
                    if isinstance(c, dict) and c.get("label") in _CONF and c.get("note")]
            dig = [d for d in (s.get("dig_deeper") or []) if isinstance(d, str) and d.strip()]
            layers.append({"key": k, "title": s.get("title") or k, "body": b.strip(),
                           "confidence": conf, "evidence": (s.get("evidence") or "").strip(),
                           "dig_deeper": dig})
            seen.add(k)
    timeline = [{"year": str(t.get("year")), "event": t.get("event", "").strip(),
                 "confidence": t.get("confidence") if t.get("confidence") in _CONF else "certain",
                 "cause_note": (t.get("cause_note") or "").strip()}
                for t in (data.get("timeline") or []) if isinstance(t, dict) and t.get("event")]
    tourism = [x.strip() for x in (data.get("tourism") or []) if isinstance(x, str) and x.strip()]
    return {"layers": layers, "timeline": timeline, "tourism": tourism}


def is_degraded_v2(qid, parsed):
    """QID 無し or layers 皆無 = degraded（v2）。"""
    return (not qid) or (len(parsed.get("layers") or []) == 0)


def assemble_profile_v2(pid, level, name_ja, facts, parsed, source, degraded, belongs_to, generated_at):
    """出力スキーマ v2 に整形。"""
    return {
        "id": pid, "level": level, "name_ja": name_ja, "belongs_to": belongs_to,
        "facts": facts, "layers": parsed["layers"], "timeline": parsed["timeline"],
        "tourism": parsed["tourism"], "source": source, "degraded": bool(degraded),
        "generated_at": generated_at,
    }
