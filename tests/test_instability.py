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

def test_score_normalizes_and_ranks():
    agg = {
        "IZ": {"conflict": 100.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
               "counts": {"conflict": 50, "protests": 0, "news": 0, "quakes": 0},
               "lat": 33.0, "lon": 44.0, "top_events": []},
        "US": {"conflict": 10.0, "protests": 5.0, "news": 0.0, "quakes": 0.0,
               "counts": {"conflict": 5, "protests": 3, "news": 0, "quakes": 0},
               "lat": 38.0, "lon": -77.0, "top_events": []},
    }
    fips = {"IZ": "イラク", "US": "アメリカ合衆国"}
    out = I.score_countries(agg, CFG, fips)
    assert [c["code"] for c in out] == ["IZ", "US"]      # score 降順
    assert out[0]["rank"] == 1 and out[0]["name_ja"] == "イラク"
    assert 0 <= out[1]["score"] <= 100 and out[0]["score"] >= out[1]["score"]
    assert 1 <= out[0]["level"] <= 5
    assert set(out[0]["components"]) == {"conflict", "protests", "news", "quakes"}

def test_score_all_zero_safe():
    out = I.score_countries({"XX": {"conflict": 0.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
                                    "counts": {"conflict": 0, "protests": 0, "news": 0, "quakes": 0},
                                    "lat": 0, "lon": 0, "top_events": []}}, CFG, {})
    assert out[0]["score"] == 0 and out[0]["level"] == 1

# トレンド関数テスト
H = 3600_000
DAY = 86400_000

def test_trend_dod_and_normal():
    countries = [{"code": "IZ", "score": 80}]
    hist = {"IZ": [{"t": -DAY, "score": 50}] + [{"t": -i * H, "score": 50} for i in range(1, 6)]}
    # now_ms=0、24h前(-DAY)に score50 → dod +30(up)。中央値50 → +60%(up)
    I.apply_trend(countries, hist, 0, CFG)
    tr = countries[0]["trend"]
    assert tr["dod"]["delta"] == 30 and tr["dod"]["dir"] == "up"
    assert tr["normal"]["dir"] == "up" and tr["normal"]["deltaPct"] >= 15
    assert tr["isNew"] is False

def test_trend_new_country():
    countries = [{"code": "ZZ", "score": 40}]
    I.apply_trend(countries, {}, 0, CFG)
    tr = countries[0]["trend"]
    assert tr["dod"] is None and tr["normal"] is None and tr["isNew"] is True

def test_update_history_appends_and_trims():
    hist = {"IZ": [{"t": -10 * DAY, "score": 10}, {"t": -1 * H, "score": 20}]}
    new = I.update_history(hist, [{"code": "IZ", "score": 30}], 0, CFG)
    ts = [x["t"] for x in new["IZ"]]
    assert -10 * DAY not in ts        # 7日より古いものは除去
    assert new["IZ"][-1] == {"t": 0, "score": 30}

def test_narrative_prompt_includes_top_n_only():
    countries = [{"code": f"C{i}", "name_ja": f"国{i}", "score": 100 - i,
                  "counts": {"conflict": i, "protests": 0, "news": 0, "quakes": 0},
                  "top_events": []} for i in range(12)]
    p = I.narrative_prompt(countries, CFG)
    assert "C0" in p and "C7" in p          # 上位8
    assert "C8" not in p                     # 9番目以降は含めない
    assert "JSON" in p

def test_parse_narratives_filters_and_caps():
    text = '```json\n{"IZ": "  説明  ", "US": 5, "FR": "x"}\n```'
    out = I.parse_narratives(text)
    assert out["IZ"] == "説明"               # trim・フェンス除去
    assert "US" not in out                    # 文字列でない→除外
    assert out["FR"] == "x"
    assert I.parse_narratives("not json") == {}
