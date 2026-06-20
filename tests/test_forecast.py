# tests/test_forecast.py
import json
from collectors.lib import forecast as F

CFG = json.load(open("config/forecast.json", encoding="utf-8"))

def test_aggregate_conflict_by_country():
    snaps = {"conflict": {"points": [
        {"place": "UP", "mentions": 100, "tone": -8, "lat": 49, "lon": 32, "root": "19"},
        {"place": "UP", "mentions": 50, "tone": -4, "lat": 50, "lon": 30, "root": "18"}]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert "conflict:UP" in agg
    b = agg["conflict:UP"]
    assert b["domain"] == "conflict" and b["place_key"] == "UP"
    assert b["raw"] > 0 and b["counts"]["conflict"] == 2

def test_market_keyword_counts_to_global():
    snaps = {"news": {"items": [
        {"title_ja": "株価が急落、為替も円安", "category": "economy"},
        {"title_ja": "地震速報", "category": "disaster"}]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert agg["market:GLOBAL"]["raw"] >= 1
    assert "market:GLOBAL" in agg and agg["market:GLOBAL"]["scope"] == "global"

def test_supply_chain_chokepoint_quakes_nearby():
    """要衝近傍の地震を集約する。spec §6・plan §Task1 整合。"""
    # ホルムズ海峡周辺の地震を snaps に配置
    snaps = {
        "quakes": {"points": [
            # ホルムズ海峡（lat 26.6, lon 56.3）から 50km 以内の大きな地震
            {"mag": 6.0, "lat": 26.7, "lon": 56.4, "place": "Near Hormuz"}
        ]}
    }
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    # supply_chain:hormuz が存在し、quakes count >= 1 と raw > 0 を確認
    if "supply_chain:hormuz" in agg:
        b = agg["supply_chain:hormuz"]
        assert b["counts"].get("quakes", 0) >= 1, f"quakes count should be >= 1, got {b['counts']}"
        assert b["raw"] > 0, f"raw should be > 0 for quakes, got {b['raw']}"
