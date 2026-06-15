import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.airtemp import build_grid, chunk, parse_temps, build_snapshot, grid_meta

def test_build_grid_is_row_major_lat_outer_lon_inner():
    g = build_grid(-85, 85, -180, 175, 5)
    assert len(g) == 35 * 72        # nLat=35, nLon=72
    assert g[0] == (-85, -180)      # 先頭=最南西
    assert g[1] == (-85, -175)      # lon が内側で先に進む
    assert g[72] == (-80, -180)     # 1行=72点で次の緯度へ

def test_grid_meta_matches():
    m = grid_meta(-85, 85, -180, 175, 5)
    assert m == {"lat0": -85, "lon0": -180, "latStep": 5, "lonStep": 5, "nLat": 35, "nLon": 72}

def test_chunk_splits_into_max_size():
    pts = list(range(450))
    batches = chunk(pts, 200)
    assert [len(b) for b in batches] == [200, 200, 50]

def test_parse_temps_flattens_in_order_with_none_for_missing():
    responses = [
        [{"current": {"temperature_2m": 12.3}}, {"current": {"temperature_2m": -4.0}}],
        [{"current": {}}, {}],   # 欠損 → None / None
    ]
    assert parse_temps(responses) == [12.3, -4.0, None, None]

def test_build_snapshot_shape():
    temps = [1.0, None, 3.0]
    meta = {"lat0": -85, "lon0": -180, "latStep": 5, "lonStep": 5, "nLat": 1, "nLon": 3}
    snap = build_snapshot(temps, meta, "2026-06-16T12:00:00Z")
    assert snap["layer"] == "airtemp"
    assert snap["updated"] == "2026-06-16T12:00:00Z"
    assert snap["grid"] == meta
    assert snap["count"] == 2          # None を除く
    assert snap["temps"] == temps
