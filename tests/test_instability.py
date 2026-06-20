import json
from collectors.lib import instability as I

CFG = json.load(open("config/instability.json", encoding="utf-8"))

# 小さな手製ポリゴン（四角）: code "XA" = 経度0..10,緯度0..10
SQUARE = {"features": [{"type": "Feature", "properties": {"code": "XA", "name": "Square"},
          "geometry": {"type": "Polygon",
          "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]}}]}

def _polys():
    from collectors.lib.geo_country import load_polygons
    return load_polygons(SQUARE)

def test_aggregate_conflict_protests_by_fips():
    snaps = {
        "conflict": {"points": [
            {"place": "IZ", "root": "19", "mentions": 9, "tone": "-6", "lon": 44.0, "lat": 33.0},
            {"place": "IZ", "root": "20", "mentions": 0, "tone": "-2", "lon": 44.1, "lat": 33.1}]},
        "protests": {"points": [
            {"place": "US", "root": "14", "mentions": 4, "tone": "-1", "lon": -77.0, "lat": 38.9}]},
    }
    agg = I.aggregate(snaps, [], CFG)
    assert agg["IZ"]["counts"]["conflict"] == 2
    assert agg["IZ"]["conflict"] > 0
    assert agg["US"]["counts"]["protests"] == 1
    # 重心は寄与イベント近傍
    assert 43.5 < agg["IZ"]["lon"] < 44.5

def test_aggregate_news_quakes_resolved_by_polygon():
    snaps = {
        "news": {"items": [
            {"category": "conflict", "lon": 5.0, "lat": 5.0, "title_ja": "見出し", "url": "https://x"},
            {"category": "politics", "lon": 99.0, "lat": 80.0, "title_ja": "圏外", "url": "https://y"}]},
        "quakes": {"points": [
            {"mag": 6.0, "lon": 6.0, "lat": 6.0, "place": "near XA", "url": "https://q"},
            {"mag": 2.0, "lon": 6.0, "lat": 6.0, "place": "tiny", "url": "https://q2"}]},
    }
    agg = I.aggregate(snaps, _polys(), CFG)
    assert agg["XA"]["counts"]["news"] == 1      # 圏外(99,80)は None で除外
    assert agg["XA"]["counts"]["quakes"] == 1    # mag2.0 は閾値未満で除外
    assert agg["XA"]["news"] > 0 and agg["XA"]["quakes"] > 0
    assert any(ev["title"] == "見出し" for ev in agg["XA"]["top_events"])
