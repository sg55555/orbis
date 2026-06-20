"""国家不安定性インデックス（純粋）。集約→スコア→トレンド→ナラティブ。"""
import json as _json
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


def _percentile(vals, pct):
    if not vals:
        return 0.0
    s = sorted(vals)
    k = (len(s) - 1) * pct / 100.0
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return s[int(k)]
    return s[f] * (c - k) + s[c] * (k - f)


def score_countries(agg, cfg, fips_ja):
    w = cfg["weights"]
    raws = {code: (w["conflict"] * b["conflict"] + w["protests"] * b["protests"]
                   + w["news"] * b["news"] + w["quakes"] * b["quakes"])
            for code, b in agg.items()}
    base = _percentile([v for v in raws.values() if v > 0], cfg["normalize_pct"])
    out = []
    for code, b in agg.items():
        raw = raws[code]
        score = 0 if base <= 0 else max(0, min(100, round(100 * raw / base)))
        level = min(5, 1 + score // 20) if score > 0 else 1
        out.append({
            "code": code, "name_ja": fips_ja.get(code, code),
            "score": int(score), "level": int(level),
            "lat": b["lat"], "lon": b["lon"],
            "components": {k: round(w[k] * b[k], 1) for k in ("conflict", "protests", "news", "quakes")},
            "counts": b["counts"], "top_events": b.get("top_events", [])})
    out.sort(key=lambda c: (-c["score"], -sum(c["counts"].values())))
    for i, c in enumerate(out):
        c["rank"] = i + 1
    return out


def _median(vals):
    s = sorted(vals)
    n = len(s)
    if n == 0:
        return 0
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _trend_for(score_now, hist, now_ms, t):
    dod = None
    if hist:
        target = now_ms - t["dod_hours"] * 3600_000
        tol = t["dod_tol_hours"] * 3600_000
        cand = [h for h in hist if abs(h["t"] - target) <= tol]
        if cand:
            ref = min(cand, key=lambda h: abs(h["t"] - target))["score"]
            d = score_now - ref
            dod = {"delta": int(d),
                   "dir": "up" if d >= t["dod_delta"] else "down" if d <= -t["dod_delta"] else "flat"}
    normal = None
    scores = [h["score"] for h in hist]
    if len(scores) >= t["normal_min_samples"]:
        med = _median(scores)
        pct = round(100 * (score_now - med) / max(med, 1))
        normal = {"deltaPct": int(pct),
                  "dir": "up" if pct >= t["normal_pct"] else "down" if pct <= -t["normal_pct"] else "flat"}
    is_new = dod is None and normal is None
    return {"dod": dod, "normal": normal, "isNew": bool(is_new)}


def apply_trend(countries, history, now_ms, cfg):
    t = cfg["trend"]
    for c in countries:
        c["trend"] = _trend_for(c["score"], history.get(c["code"], []), now_ms, t)


def update_history(history, countries, now_ms, cfg):
    cutoff = now_ms - cfg["history_days"] * 86400_000
    out = {}
    for c in countries:
        lst = [x for x in history.get(c["code"], []) if x["t"] >= cutoff]
        lst.append({"t": int(now_ms), "score": int(c["score"])})
        out[c["code"]] = lst
    return out


NARRATIVE_SYSTEM = ("あなたは地政学アナリスト。与えたデータのみを根拠に日本語で簡潔に。"
                    "捏造・予測・助言は禁止。JSON のみ返す。")


def narrative_prompt(countries, cfg):
    top = countries[: cfg["top_n_narrative"]]
    lines = []
    for c in top:
        ct = c["counts"]
        ev = "; ".join(e["title"] for e in c.get("top_events", []) if e.get("title"))
        lines.append(f'{c["code"]} {c.get("name_ja", c["code"])} score={c["score"]} '
                     f'紛争{ct["conflict"]}/抗議{ct["protests"]}/報道{ct["news"]}/地震{ct["quakes"]}'
                     + (f' 例: {ev}' if ev else ''))
    body = "\n".join(lines)
    return ('次の各国について、与えたデータのみを根拠に「なぜ不安定か」を日本語1文で説明してください。'
            '捏造・予測・助言は禁止。出力は {"国コード":"説明文"} の JSON のみ。\n\n' + body)


def parse_narratives(text):
    from collectors.lib.intel import _strip_fence
    try:
        d = _json.loads(_strip_fence(text))
    except (ValueError, TypeError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, v in d.items():
        if isinstance(k, str) and isinstance(v, str) and v.strip():
            out[k] = v.strip()[:160]
    return out
