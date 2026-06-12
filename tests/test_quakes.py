import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.quakes import transform, build_snapshot

SAMPLE = {
    "features": [
        {
            "id": "us1000",
            "geometry": {"coordinates": [139.7, 35.6, 30.0]},
            "properties": {"mag": 5.2, "place": "near Tokyo", "time": 1700000000000,
                           "url": "https://example.com/us1000"},
        },
        # mag が None → 除外
        {"id": "x", "geometry": {"coordinates": [0, 0, 0]}, "properties": {"mag": None}},
        # 座標不足 → 除外
        {"id": "y", "geometry": {"coordinates": [1]}, "properties": {"mag": 3.0}},
    ]
}

def test_transform_filters_invalid_and_maps_fields():
    pts = transform(SAMPLE)
    assert len(pts) == 1
    p = pts[0]
    assert p["id"] == "us1000"
    assert p["lon"] == 139.7 and p["lat"] == 35.6 and p["depth"] == 30.0
    assert p["mag"] == 5.2 and p["place"] == "near Tokyo"
    assert p["time"] == 1700000000000
    assert p["url"] == "https://example.com/us1000"

def test_build_snapshot_shape():
    pts = transform(SAMPLE)
    snap = build_snapshot(pts, "2026-06-13T12:00:00Z")
    assert snap["layer"] == "quakes"
    assert snap["updated"] == "2026-06-13T12:00:00Z"
    assert snap["count"] == 1
    assert snap["points"] == pts
