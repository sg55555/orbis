import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.flights import transform, downsample, build_snapshot

SAMPLE = {"time": 1781368722, "states": [
    ["abc123", "ANA221  ", "Japan", 1, 1, 139.7, 35.6, 10000.0, False, 250.0, 90.0, 0,0,0,0,0,0],
    ["def456", "JAL10   ", "Japan", 1, 1, None, 35.0, 9000.0, False, 200.0, 45.0, 0,0,0,0,0,0],
]}

def test_transform_maps_and_filters():
    pts = transform(SAMPLE)
    assert len(pts) == 1
    p = pts[0]
    assert p["icao24"] == "abc123"
    assert p["callsign"] == "ANA221"
    assert p["lon"] == 139.7 and p["lat"] == 35.6
    assert p["alt"] == 10000.0 and p["on_ground"] is False
    assert p["velocity"] == 250.0 and p["heading"] == 90.0

def test_downsample_caps_count():
    pts = [{"icao24": str(i), "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10
    assert out[0]["icao24"] == "0"

def test_build_snapshot_shape():
    snap = build_snapshot([{"icao24": "a"}], "2026-06-14T00:00:00Z")
    assert snap["layer"] == "flights" and snap["count"] == 1 and snap["updated"].endswith("Z")
