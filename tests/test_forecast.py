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
    # 修正2: 1記事 = 1カウント（any-match）
    assert agg["market:GLOBAL"]["counts"]["news"] == 1

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
    # 修正3: 無条件に assert（条件分岐での素通り防止）
    assert "supply_chain:hormuz" in agg
    b = agg["supply_chain:hormuz"]
    assert b["counts"].get("quakes", 0) >= 1, f"quakes count should be >= 1, got {b['counts']}"
    assert b["raw"] > 0, f"raw should be > 0 for quakes, got {b['raw']}"

def test_military_bucket_has_approx_flag():
    """修正1: military ドメイン Bucket は approx=True を持ち、conflict 側は持たない（spec §6 近似明示）。"""
    snaps = {"conflict": {"points": [
        {"place": "UP", "mentions": 100, "tone": -8, "lat": 49, "lon": 32, "root": "19"}
    ]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert "military:UP" in agg, "military:UP が agg に存在しない"
    assert agg["military:UP"].get("approx") == True, \
        f"military Bucket に approx=True が設定されていない: {agg['military:UP']}"
    # conflict 側は approx を持たないか False
    assert not agg["conflict:UP"].get("approx"), \
        f"conflict Bucket に不要な approx が設定されている: {agg['conflict:UP']}"

def test_market_cyber_one_article_one_count():
    """修正2: 複数キーワードにマッチしても counts['news'] は記事数（1）になる。"""
    # "株価" と "為替" の両方にマッチする 1 記事
    snaps = {"news": {"items": [
        {"title_ja": "株価と為替と金利が急変", "category": "economy"}
    ]}}
    agg = F.aggregate_signals(snaps, polys=[], instab={}, cfg=CFG)
    assert "market:GLOBAL" in agg
    assert agg["market:GLOBAL"]["counts"]["news"] == 1, \
        f"1記事は counts['news']=1 のはず。得られた値: {agg['market:GLOBAL']['counts']}"


def test_momentum_boosts_rising_signal():
    agg = {"conflict:UP": {"domain":"conflict","place_key":"UP","scope":"country",
            "raw":30.0,"signals":[],"counts":{"conflict":3},"lat":49,"lon":32,"place_ja":None}}
    # 平常 raw 中央値 10 → 今 30 は +200%
    hist = {"conflict:UP": [{"t":1,"raw":10,"score":20},{"t":2,"raw":9,"score":18},
                            {"t":3,"raw":11,"score":22}]}
    instab = {"countries":[{"code":"UP","score":70}]}
    out = F.score_attention(agg, hist, instab, CFG)
    assert out[0]["place_key"] == "UP"
    assert out[0]["score"] > 0 and 1 <= out[0]["level"] <= 5
    assert out[0]["momentum"] > 1.0  # 上昇


def test_first_run_no_history_neutral_momentum():
    agg = {"market:GLOBAL": {"domain":"market","place_key":"GLOBAL","scope":"global",
            "raw":5.0,"signals":[],"counts":{"news":5}}}
    out = F.score_attention(agg, {}, {}, CFG)  # 履歴なし
    assert out[0]["momentum"] == 1.0  # 中立
    assert out[0]["score"] >= 0


def test_confidence_by_signal_diversity():
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3,"news":1,"protests":1}}, CFG) == "high"
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3,"news":1}}, CFG) == "med"
    assert F.confidence_of({"domain":"conflict","counts":{"conflict":3}}, CFG) == "low"
    assert F.confidence_of({"domain":"market","counts":{"news":9}}, CFG) == "low"
    assert F.confidence_of({"domain":"cyber","counts":{"news":9}}, CFG) == "low"


def test_trend_up_flat_down_new():
    assert F.trend_of(50, [], CFG) == "new"
    assert F.trend_of(50, [{"t":1,"raw":5,"score":40}], CFG) == "up"     # +10 >= up_delta(8)
    assert F.trend_of(40, [{"t":1,"raw":5,"score":42}], CFG) == "flat"   # -2
    assert F.trend_of(30, [{"t":1,"raw":5,"score":45}], CFG) == "down"   # -15


def test_update_history_appends_and_trims():
    old = {"conflict:UP": [{"t": 1, "raw": 5, "score": 40}]}
    items = [{"key":"conflict:UP","raw":9.0,"score":55}]
    out = F.update_history(old, items, now_ms=10_000_000_000, cfg=CFG)
    assert out["conflict:UP"][-1] == {"t": 10_000_000_000, "raw": 9.0, "score": 55}


def test_build_cards_shape_and_watch():
    items = [{"key":"conflict:UP","domain":"conflict","place_key":"UP","scope":"country",
              "raw":30.0,"score":80,"level":5,"momentum":2.0,"lat":49,"lon":32,
              "counts":{"conflict":3,"news":1},"place_ja":None},
             {"key":"cyber:GLOBAL","domain":"cyber","place_key":"GLOBAL","scope":"global",
              "raw":0.0,"score":0,"level":1,"momentum":1.0,"counts":{},"place_ja":None}]
    cards = F.build_cards(items, history={}, fips_ja={"UP":"ウクライナ"}, now_ms=1, cfg=CFG)
    c0 = [c for c in cards if c["place_key"]=="UP"][0]
    assert c0["place_ja"] == "ウクライナ" and c0["scope"] == "country"
    assert c0["confidence"] in ("low","med","high") and c0["trend"] == "new"
    assert c0["status"] == "active" and c0["ai_generated"] is False
    assert any("紛争" in s["label"] for s in c0["signals"])
    cy = [c for c in cards if c["domain"]=="cyber"][0]
    assert cy["status"] == "watch"


def test_build_cards_approx_military():
    """military カード（approx=True）の signals に近似を明示するエントリがあること（spec §6）。"""
    items = [{"key":"military:UP","domain":"military","place_key":"UP","scope":"country",
              "raw":20.0,"score":60,"level":4,"momentum":1.5,"lat":49,"lon":32,
              "counts":{"conflict":2},"place_ja":None,"approx":True}]
    cards = F.build_cards(items, history={}, fips_ja={"UP":"ウクライナ"}, now_ms=1, cfg=CFG)
    assert len(cards) == 1
    c = cards[0]
    assert any("近似" in s["label"] for s in c["signals"]), \
        f"approx=True のカードの signals に '近似' ラベルが存在しない: {c['signals']}"
