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
