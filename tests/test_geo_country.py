# tests/test_geo_country.py
import json
from collectors.lib.geo_country import load_polygons, point_country

def _polys():
    return load_polygons(json.load(open("data/static/country_bounds.geojson", encoding="utf-8")))

def test_known_points_resolve_to_fips():
    polys = _polys()
    assert point_country(139.69, 35.68, polys) == "JA"   # 東京
    assert point_country(2.35, 48.85, polys) == "FR"      # パリ
    assert point_country(31.24, 30.04, polys) == "EG"     # カイロ
    assert point_country(-149.9, 61.2, polys) == "US"     # アンカレッジ（マルチポリゴン）

def test_ocean_and_bad_input_return_none():
    polys = _polys()
    assert point_country(-140.0, 0.0, polys) is None      # 太平洋中央
    assert point_country(None, None, polys) is None
    assert point_country("x", "y", polys) is None
