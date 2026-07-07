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
    assert f == {"population": None, "area_km2": None, "lat": None, "lon": None, "elevation_m": None,
                 "gdp_per_capita": None}


def _q(entity_qid):
    return f"http://www.wikidata.org/entity/{entity_qid}"


def _area(amount, unit_qid=None, rank="normal"):
    v = {"amount": amount}
    if unit_qid is not None:
        v["unit"] = _q(unit_qid)
    return {"mainsnak": {"datavalue": {"value": v}}, "rank": rank}


def _pop(amount, year=None, rank="normal"):
    c = {"mainsnak": {"datavalue": {"value": {"amount": amount}}}, "rank": rank}
    if year is not None:
        c["qualifiers"] = {"P585": [{"datavalue": {"value": {"time": f"+{year}-00-00T00:00:00Z"}}}]}
    return c


def test_wikidata_facts_area_m2_unit_normalized_to_km2():
    # P2046 面積が m²(Q25343) 単位なら km² に正規化する（10^6 で割る）
    claims = {"P2046": [_area("+1324390000", "Q25343")]}
    f = wikidata_facts({"claims": claims})
    assert f["area_km2"] == 1324.39


def test_wikidata_facts_area_km2_unit_kept():
    # 単位が km²(Q712226) ならそのまま
    claims = {"P2046": [_area("+100295", "Q712226")]}
    f = wikidata_facts({"claims": claims})
    assert f["area_km2"] == 100295.0


def test_wikidata_facts_area_no_unit_defaults_km2():
    # 単位欠落は km² 既定（後方互換・既存生成物と一致）
    claims = {"P2046": [_area("+2194")]}
    f = wikidata_facts({"claims": claims})
    assert f["area_km2"] == 2194.0


def test_wikidata_facts_population_prefers_preferred_rank():
    # 複数 P1082 統計。rank=preferred が配列順の先頭より優先される
    claims = {"P1082": [_pop("+25012374", 1960, "normal"),
                        _pop("+51466201", 2017, "preferred")]}
    f = wikidata_facts({"claims": claims})
    assert f["population"] == 51466201


def test_wikidata_facts_population_latest_point_in_time_when_no_preferred():
    # preferred が無ければ P585 時点が最新の統計を選ぶ（先頭=古い値を拾わない）
    claims = {"P1082": [_pop("+25012374", 1960, "normal"),
                        _pop("+51628117", 2022, "normal")]}
    f = wikidata_facts({"claims": claims})
    assert f["population"] == 51628117


def test_wikidata_facts_elevation_foot_unit_normalized_to_m():
    # P2044 標高が foot(Q3710) なら m に正規化
    claims = {"P2044": [{"mainsnak": {"datavalue": {"value": {
        "amount": "+100", "unit": _q("Q3710")}}}, "rank": "normal"}]}
    f = wikidata_facts({"claims": claims})
    assert f["elevation_m"] == 30.48


def test_wikidata_facts_gdp_per_capita_prefers_latest_point_in_time():
    # P2132 一人当たりGDP も配列先頭でなく最新時点を選ぶ（人口と同じ stale バグの解消）
    claims = {"P2132": [_pop("+20000", 2005, "normal"), _pop("+35000", 2022, "normal")]}
    f = wikidata_facts({"claims": claims})
    assert f["gdp_per_capita"] == 35000


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
