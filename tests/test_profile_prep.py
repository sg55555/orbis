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


from scripts.lib.profile_prep import resolve_qid

def test_resolve_qid_variants():
    assert resolve_qid({"wikidataid": "Q1490"}) == "Q1490"
    assert resolve_qid({"WIKIDATAID": " Q64 "}) == "Q64"
    assert resolve_qid({"wikidataid": ""}) is None
    assert resolve_qid({"wikidataid": "-99"}) is None
    assert resolve_qid({}) is None


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


from scripts.lib.profile_prep import ja_wikipedia_title

def test_ja_wikipedia_title():
    assert ja_wikipedia_title({"sitelinks": {"jawiki": {"title": "東京都"}}}) == "東京都"
    assert ja_wikipedia_title({"sitelinks": {"enwiki": {"title": "Tokyo"}}}) is None
    assert ja_wikipedia_title({}) is None


from scripts.lib.profile_prep import build_profile_prompt

def test_build_profile_prompt_grounds_and_lists_sections():
    p = build_profile_prompt("東京都", "admin1",
                             {"population": 13960000, "area_km2": 2194, "lat": None, "lon": None, "elevation_m": None},
                             "東京都は日本の首都圏…")
    assert "東京都" in p and "admin1" in p
    assert "東京都は日本の首都圏" in p          # 要約を grounding に含む
    assert "population: 13960000" in p          # None でない事実のみ列挙
    assert "- lat:" not in p                      # None の事実(lat)は列挙しない（"population"内の"lat"は誤検出回避）
    assert "観光名所" in p and "概要" in p        # セクション候補を提示
    assert "根拠" in p or "事実に無い" in p       # 幻覚抑制の指示


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
