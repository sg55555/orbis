# tests/test_ships.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.ships import (
    ship_type_label, parse_position, parse_static, merge_records,
    downsample, build_snapshot,
)

def test_ship_type_label_ranges():
    assert ship_type_label(30) == "漁船"
    assert ship_type_label(36) == "帆船"
    assert ship_type_label(37) == "プレジャーボート"
    assert ship_type_label(50) == "水先船"
    assert ship_type_label(51) == "捜索救助"
    assert ship_type_label(52) == "曳航船"
    assert ship_type_label(60) == "旅客船" and ship_type_label(69) == "旅客船"
    assert ship_type_label(70) == "貨物船" and ship_type_label(79) == "貨物船"
    assert ship_type_label(80) == "タンカー" and ship_type_label(89) == "タンカー"
    assert ship_type_label(0) == "船舶" and ship_type_label(99) == "船舶"
    assert ship_type_label(None) == "船舶" and ship_type_label("x") == "船舶"

def test_parse_position_valid():
    msg = {"MessageType": "PositionReport",
           "MetaData": {"MMSI": 123456789},
           "Message": {"PositionReport": {"Latitude": 35.611, "Longitude": 139.777,
                                          "Cog": 45.2, "Sog": 12.34}}}
    p = parse_position(msg)
    assert p == {"mmsi": 123456789, "lon": 139.777, "lat": 35.611, "cog": 45.2, "sog": 12.3}

def test_parse_position_missing_coords_is_none():
    msg = {"MetaData": {"MMSI": 1}, "Message": {"PositionReport": {"Latitude": None, "Longitude": 1.0}}}
    assert parse_position(msg) is None

def test_parse_position_sentinel_cog_sog_to_none():
    msg = {"MetaData": {"MMSI": 1},
           "Message": {"PositionReport": {"Latitude": 0.0, "Longitude": 0.0, "Cog": 360.0, "Sog": 102.3}}}
    p = parse_position(msg)
    assert p["cog"] is None and p["sog"] is None

def test_parse_static_name_and_type():
    msg = {"MessageType": "ShipStaticData", "MetaData": {"MMSI": 7},
           "Message": {"ShipStaticData": {"Name": "EVER GIVEN  ", "Type": 71}}}
    assert parse_static(msg) == {"mmsi": 7, "name": "EVER GIVEN", "type": "貨物船"}

def test_parse_static_name_falls_back_to_meta_and_unknown_type():
    msg = {"MetaData": {"MMSI": 8, "ShipName": "NIPPON MARU"},
           "Message": {"ShipStaticData": {}}}
    assert parse_static(msg) == {"mmsi": 8, "name": "NIPPON MARU", "type": "船舶"}

def test_merge_records_joins_and_handles_missing_static():
    positions = {1: {"mmsi": 1, "lon": 0, "lat": 0, "cog": 1.0, "sog": 2.0},
                 2: {"mmsi": 2, "lon": 1, "lat": 1, "cog": None, "sog": None}}
    statics = {1: {"mmsi": 1, "name": "A", "type": "貨物船"}}
    out = merge_records(positions, statics)
    assert {"mmsi": 1, "lon": 0, "lat": 0, "cog": 1.0, "sog": 2.0, "name": "A", "type": "貨物船"} in out
    p2 = next(p for p in out if p["mmsi"] == 2)
    assert p2["name"] is None and p2["type"] is None

def test_downsample_caps_count():
    pts = [{"mmsi": i, "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10 and out[0]["mmsi"] == 0

def test_build_snapshot_shape():
    snap = build_snapshot([{"mmsi": 1}], "2026-06-17T00:00:00Z")
    assert snap["layer"] == "ships" and snap["count"] == 1 and snap["updated"].endswith("Z")
