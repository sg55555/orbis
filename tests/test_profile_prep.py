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
