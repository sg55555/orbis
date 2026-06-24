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
