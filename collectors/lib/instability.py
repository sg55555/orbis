"""国家不安定性インデックス（純粋）。集約→スコア→トレンド→ナラティブ。"""
import math

from collectors.lib.geo_country import point_country


def _tone_pen(tone, cfg):
    try:
        t = float(tone)
    except (TypeError, ValueError):
        t = 0.0
    return 1 + min(max(-t, 0.0), cfg["tone_clamp"]) / cfg["tone_div"]


def _conflict_contrib(e, cfg):
    w = cfg["root_w"].get(str(e.get("root")), 1.0)
    return w * math.log1p(e.get("mentions", 0) or 0) * _tone_pen(e.get("tone"), cfg)


def _protest_contrib(e, cfg):
    return cfg["protest_w"] * math.log1p(e.get("mentions", 0) or 0) * _tone_pen(e.get("tone"), cfg)


def _quake_contrib(mag, cfg):
    q = cfg["quake"]
    if mag is None or mag < q["mag_min"]:
        return 0.0
    return min(q["cap"], q["base"] ** (mag - q["mag_min"]))


def _bucket(acc, code):
    return acc.setdefault(code, {
        "conflict": 0.0, "protests": 0.0, "news": 0.0, "quakes": 0.0,
        "counts": {"conflict": 0, "protests": 0, "news": 0, "quakes": 0},
        "_lat": 0.0, "_lon": 0.0, "_w": 0.0, "top_events": []})


def _addpt(b, lon, lat, w):
    try:
        x, y = float(lon), float(lat)
    except (TypeError, ValueError):
        return
    b["_lon"] += x * w
    b["_lat"] += y * w
    b["_w"] += w


def _add_event(b, title, place, url):
    if len(b["top_events"]) < 3 and isinstance(url, str) and url.startswith(("http://", "https://")):
        b["top_events"].append({"title": str(title or ""), "place": str(place or ""), "url": url})


def aggregate(snaps, polys, cfg):
    acc = {}
    for e in (snaps.get("conflict") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _conflict_contrib(e, cfg)
        b = _bucket(acc, code)
        b["conflict"] += c
        b["counts"]["conflict"] += 1
        _addpt(b, e.get("lon"), e.get("lat"), c)
    for e in (snaps.get("protests") or {}).get("points", []) or []:
        code = e.get("place")
        if not code:
            continue
        c = _protest_contrib(e, cfg)
        b = _bucket(acc, code)
        b["protests"] += c
        b["counts"]["protests"] += 1
        _addpt(b, e.get("lon"), e.get("lat"), c)
    for it in (snaps.get("news") or {}).get("items", []) or []:
        code = point_country(it.get("lon"), it.get("lat"), polys)
        if not code:
            continue
        c = cfg["news_sev"].get(it.get("category"), cfg["news_sev"]["other"])
        b = _bucket(acc, code)
        b["news"] += c
        b["counts"]["news"] += 1
        _addpt(b, it.get("lon"), it.get("lat"), c)
        _add_event(b, it.get("title_ja"), it.get("place"), it.get("url"))
    for q in (snaps.get("quakes") or {}).get("points", []) or []:
        c = _quake_contrib(q.get("mag"), cfg)
        if c <= 0:
            continue
        code = point_country(q.get("lon"), q.get("lat"), polys)
        if not code:
            continue
        b = _bucket(acc, code)
        b["quakes"] += c
        b["counts"]["quakes"] += 1
        _addpt(b, q.get("lon"), q.get("lat"), c)
        _add_event(b, f"M{q.get('mag')} 地震", q.get("place"), q.get("url"))
    # 重心を確定
    for b in acc.values():
        w = b.pop("_w")
        lon = b.pop("_lon")
        lat = b.pop("_lat")
        b["lat"] = round(lat / w, 3) if w > 0 else 0.0
        b["lon"] = round(lon / w, 3) if w > 0 else 0.0
    return acc
