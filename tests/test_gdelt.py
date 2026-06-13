import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.gdelt_events import parse_rows, split_events

def make_row(eid, root, lat, lon, mentions="3", url="http://x"):
    r = [""] * 61
    r[0] = eid; r[28] = root; r[31] = mentions; r[34] = "-2.5"
    r[53] = "Tokyo, Japan"; r[56] = lat; r[57] = lon; r[59] = "20260614120000"; r[60] = url
    return r

def test_parse_rows_filters_invalid_and_maps():
    rows = [
        make_row("1", "14", "35.6", "139.7"),
        make_row("2", "19", "48.8", "2.3"),
        make_row("3", "01", "10.0", "10.0"),
        make_row("4", "14", "", ""),
        ["short"],
    ]
    evs = parse_rows(rows)
    ids = sorted(e["id"] for e in evs)
    assert ids == ["1", "2"]
    e = next(e for e in evs if e["id"] == "1")
    assert e["root"] == "14" and e["lon"] == 139.7 and e["lat"] == 35.6
    assert e["place"] == "Tokyo, Japan" and e["mentions"] == 3 and e["url"] == "http://x"
    assert e["date"] == "20260614120000"

def test_split_events_by_category():
    evs = parse_rows([make_row("1", "14", "1", "1"), make_row("2", "18", "2", "2"),
                      make_row("3", "20", "3", "3")])
    protests, conflict = split_events(evs)
    assert [e["id"] for e in protests] == ["1"]
    assert sorted(e["id"] for e in conflict) == ["2", "3"]
