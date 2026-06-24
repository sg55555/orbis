import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.gdelt_events import parse_rows, split_events, merge_rolling
from datetime import datetime

def make_row(eid, root, lat, lon, mentions="3", url="http://x", sources="3", tone="-5.0"):
    r = [""] * 61
    r[0] = eid; r[28] = root; r[31] = mentions; r[32] = sources; r[34] = tone
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

def test_parse_rows_filters_single_source():
    # 単一ソース(sources<2)の event は偽陽性が多いため除外。複数ソースは残す。
    rows = [
        make_row("multi", "19", "35.6", "139.7", sources="2"),   # 残る
        make_row("single", "19", "35.6", "139.7", sources="1"),  # 除外
        make_row("zero", "14", "1", "1", sources="0"),           # 除外（欠落相当）
        make_row("many", "18", "2", "2", sources="9"),           # 残る
    ]
    ids = sorted(e["id"] for e in parse_rows(rows))
    assert ids == ["many", "multi"]
    e = next(e for e in parse_rows(rows) if e["id"] == "multi")
    assert e["sources"] == 2  # sources を出力に保持


def test_parse_rows_filters_mild_tone_conflict():
    # 紛争(root 18/19/20)は中立/正トーン(>-3.5)を除外（司法/政治/エンタメの誤コード対策）。
    # 抗議(root 14)は中立トーンでも残す（過剰除外回避）。
    rows = [
        make_row("violent", "19", "1", "1", tone="-7.0"),   # 紛争・強い負→残る
        make_row("mild", "19", "1", "1", tone="-1.0"),      # 紛争・中立→除外(例:解散命令)
        make_row("positive", "18", "1", "1", tone="2.0"),   # 紛争・正→除外
        make_row("protest", "14", "1", "1", tone="-1.0"),   # 抗議・中立→残る(tone条件なし)
    ]
    ids = sorted(e["id"] for e in parse_rows(rows))
    assert ids == ["protest", "violent"]


def test_split_events_by_category():
    evs = parse_rows([make_row("1", "14", "1", "1"), make_row("2", "18", "2", "2"),
                      make_row("3", "20", "3", "3")])
    protests, conflict = split_events(evs)
    assert [e["id"] for e in protests] == ["1"]
    assert sorted(e["id"] for e in conflict) == ["2", "3"]

def test_merge_rolling_dedupes_windows_and_caps():
    now = datetime(2026, 6, 14, 12, 0, 0)
    prev = [{"id": "old", "date": "20260612120000", "lon": 0, "lat": 0},
            {"id": "keep", "date": "20260614000000", "lon": 1, "lat": 1}]
    new = [{"id": "keep", "date": "20260614010000", "lon": 1, "lat": 1},
           {"id": "fresh", "date": "20260614110000", "lon": 2, "lat": 2}]
    merged = merge_rolling(prev, new, now=now, window_hours=24, cap=10)
    ids = sorted(e["id"] for e in merged)
    assert ids == ["fresh", "keep"]

def test_merge_rolling_caps_to_newest():
    now = datetime(2026, 6, 14, 12, 0, 0)
    new = [{"id": str(i), "date": f"202606141{i:01d}0000", "lon": 0, "lat": 0} for i in range(5)]
    merged = merge_rolling([], new, now=now, window_hours=24, cap=3)
    assert len(merged) == 3
    assert merged[0]["id"] == "4"
