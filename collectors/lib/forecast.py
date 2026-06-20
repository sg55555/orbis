"""AI FORECASTS: 信号集約（8ドメイン×地理単位）。"""
import math
from collectors.lib.geo_country import point_country
from collectors.lib.instability import _conflict_contrib, _protest_contrib, _quake_contrib


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1); dl = math.radians(lon2 - lon1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def _bucket(acc, key, domain, scope, place_key, place_ja=None):
    return acc.setdefault(key, {"domain": domain, "scope": scope, "place_key": place_key,
        "place_ja": place_ja, "raw": 0.0, "signals": [], "counts": {},
        "_lat": 0.0, "_lon": 0.0, "_w": 0.0})


def _add(b, src, contrib, lon=None, lat=None):
    b["raw"] += contrib
    b["counts"][src] = b["counts"].get(src, 0) + 1
    if lon is not None and lat is not None:
        try:
            x, y = float(lon), float(lat)
            b["_lon"] += x*contrib; b["_lat"] += y*contrib; b["_w"] += contrib
        except (TypeError, ValueError):
            pass


def _ptkey(lat, lon):
    return f"{round(float(lat),1)}_{round(float(lon),1)}"


def aggregate_signals(snaps, polys, instab, cfg):
    acc = {}
    # conflict + military（同データ・別ドメイン）
    for e in (snaps.get("conflict") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _conflict_contrib(e, cfg)
        for dom in ("conflict", "military"):
            b = _bucket(acc, f"{dom}:{code}", dom, "country", code)
            _add(b, "conflict", c, e.get("lon"), e.get("lat"))
    # political
    for e in (snaps.get("protests") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        b = _bucket(acc, f"political:{code}", "political", "country", code)
        _add(b, "protests", _protest_contrib(e, cfg), e.get("lon"), e.get("lat"))
    # infra：quakes（地点）＋ news disaster（国）
    for q in (snaps.get("quakes") or {}).get("points", []) or []:
        c = _quake_contrib(q.get("mag"), cfg)
        if c <= 0:
            continue
        lat, lon = q.get("lat"), q.get("lon")
        if lat is None or lon is None:
            continue
        b = _bucket(acc, f"infra:{_ptkey(lat,lon)}", "infra", "point", _ptkey(lat, lon),
                    place_ja=q.get("place"))
        _add(b, "quakes", c, lon, lat)
    for it in (snaps.get("news") or {}).get("items", []) or []:
        if it.get("category") == "disaster":
            code = point_country(it.get("lon"), it.get("lat"), polys)
            if code:
                b = _bucket(acc, f"infra:{code}", "infra", "country", code)
                _add(b, "news", 0.6, it.get("lon"), it.get("lat"))
    # supply_chain：要衝近傍
    ships = (snaps.get("ships") or {}).get("points", []) or []
    quakes = (snaps.get("quakes") or {}).get("points", []) or []
    confs = (snaps.get("conflict") or {}).get("points", []) or []
    for cp in cfg.get("chokepoints", []):
        b = _bucket(acc, f"supply_chain:{cp['id']}", "supply_chain", "chokepoint", cp["id"], cp["name_ja"])
        b["_lat"], b["_lon"], b["_w"] = cp["lat"], cp["lon"], 1.0  # 固定座標
        for s in ships:
            if s.get("lat") is not None and s.get("lon") is not None and \
               _haversine_km(cp["lat"], cp["lon"], s["lat"], s["lon"]) <= cp["radius_km"]:
                b["raw"] += 0.05; b["counts"]["ships"] = b["counts"].get("ships", 0) + 1
        for e in confs:
            if e.get("lat") is not None and e.get("lon") is not None and \
               _haversine_km(cp["lat"], cp["lon"], e["lat"], e["lon"]) <= cp["radius_km"]:
                b["raw"] += _conflict_contrib(e, cfg); b["counts"]["conflict"] = b["counts"].get("conflict", 0) + 1
    # market / cyber：news キーワード（GLOBAL）
    for dom in ("market", "cyber"):
        kws = cfg["keywords"][dom]
        b = _bucket(acc, f"{dom}:GLOBAL", dom, "global", "GLOBAL")
        for it in (snaps.get("news") or {}).get("items", []) or []:
            text = f"{it.get('title_ja','')} {it.get('summary_ja','')}"
            for k in kws:
                if k in text:
                    _add(b, "news", 0.5)
    # 重心確定（point/country）
    for b in acc.values():
        w = b.pop("_w"); lo = b.pop("_lon"); la = b.pop("_lat")
        if b["scope"] in ("country", "point", "chokepoint") and w > 0:
            b["lat"] = round(la / w, 3); b["lon"] = round(lo / w, 3)
    return acc
