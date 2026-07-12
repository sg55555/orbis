import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.firms import parse_csv, transform, build_snapshot, FRP_MIN  # noqa: F401

CSV = (
    "latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n"
    "-24.0,133.1,330.1,2026-07-12,0312,N20,h,42.5,D\n"   # high・FRP大→残る
    "10.0,20.0,300.0,2026-07-12,0100,N20,n,15.0,N\n"      # nominal・FRP>=10→残る
    "5.0,5.0,295.0,2026-07-12,0200,N20,l,50.0,D\n"        # low→除外
    "6.0,6.0,295.0,2026-07-12,0200,N20,n,3.0,D\n"          # FRP<10→除外
)


def test_parse_csv_by_header_order_independent():
    rows = parse_csv("frp,latitude,longitude,confidence,acq_date,acq_time\n42.5,-24.0,133.1,h,2026-07-12,0312\n")
    assert rows[0]["latitude"] == "-24.0" and rows[0]["frp"] == "42.5"


def test_transform_filters_confidence_and_frp_and_sorts_desc():
    pts = transform(parse_csv(CSV))
    assert len(pts) == 2                      # low と FRP<10 を除外
    assert pts[0]["frp"] == 42.5 and pts[1]["frp"] == 15.0  # FRP 降順
    assert pts[0]["confidence"] == "high" and pts[1]["confidence"] == "nominal"
    assert pts[0]["id"] == "-24.0_133.1_2026-07-12_0312"
    assert pts[0]["lon"] == 133.1 and pts[0]["lat"] == -24.0


def test_transform_caps_top_n_by_frp(monkeypatch):
    import collectors.firms as f
    monkeypatch.setattr(f, "CAP", 1)
    pts = f.transform(f.parse_csv(CSV))
    assert len(pts) == 1 and pts[0]["frp"] == 42.5


def test_build_snapshot_shape():
    snap = build_snapshot([{"id": "a"}], "2026-07-12T00:00:00Z")
    assert snap["layer"] == "firms" and snap["count"] == 1 and snap["updated"].endswith("Z")


def test_main_skips_without_key(monkeypatch, capsys):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    import collectors.firms as f
    f.main()
    assert "skip" in capsys.readouterr().out
