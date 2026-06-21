"""AI FORECASTS: 信号集約（8ドメイン×地理単位）。"""
import re
import math
from collectors.lib.geo_country import point_country
from collectors.lib.instability import _conflict_contrib, _protest_contrib, _quake_contrib, _percentile, _median


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
            if dom == "military":
                b["approx"] = True  # 紛争データ流用＝近似（spec §6）
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
        for q in quakes:
            c = _quake_contrib(q.get("mag"), cfg)
            if c <= 0:
                continue
            lat, lon = q.get("lat"), q.get("lon")
            if lat is None or lon is None:
                continue
            if _haversine_km(cp["lat"], cp["lon"], lat, lon) <= cp["radius_km"]:
                b["raw"] += c; b["counts"]["quakes"] = b["counts"].get("quakes", 0) + 1
    # market / cyber：news キーワード（GLOBAL）
    for dom in ("market", "cyber"):
        kws = cfg["keywords"].get(dom, [])
        b = _bucket(acc, f"{dom}:GLOBAL", dom, "global", "GLOBAL")
        for it in (snaps.get("news") or {}).get("items", []) or []:
            text = f"{it.get('title_ja','')} {it.get('summary_ja','')}"
            if any(k in text for k in kws):  # 1記事=1カウント（複数KWマッチでも加算1回）
                _add(b, "news", 1.0)
    # 重心確定（point/country）
    for b in acc.values():
        w = b.pop("_w"); lo = b.pop("_lon"); la = b.pop("_lat")
        if b["scope"] in ("country", "point", "chokepoint") and w > 0:
            b["lat"] = round(la / w, 3); b["lon"] = round(lo / w, 3)
    return acc


def confidence_of(item, cfg):
    if item.get("domain") in ("market", "cyber"):
        return "low"
    n = sum(1 for v in (item.get("counts") or {}).values() if v)
    return "high" if n >= 3 else "med" if n == 2 else "low"


def _instab_score(instab, code):
    for c in (instab or {}).get("countries", []):
        if c.get("code") == code:
            return c.get("score", 0)
    return 0


def score_attention(agg, history, instab, cfg):
    """各 Bucket にモメンタム主軸の注視度スコア(0-100)/level(1-5)/momentum を付与し score 降順で返す。"""
    w = cfg["weights"]
    bl = cfg["baseline"]
    items = []
    for key, b in agg.items():
        hist = history.get(key, [])
        raws = [h["raw"] for h in hist]
        if len(raws) >= bl["min_samples"]:
            med = _median(raws)
            momentum = min(cfg["momentum_clamp"], b["raw"] / med) if med > 0 else \
                       (cfg["momentum_clamp"] if b["raw"] > 0 else 1.0)
        else:
            momentum = 1.0  # 履歴不足→中立（絶対水準主体）
        level_term = math.log1p(b["raw"])
        instab_term = (_instab_score(instab, b["place_key"]) / 100.0) \
            if b["domain"] in cfg["instab_domains"] and b["scope"] == "country" else 0.0
        raw_att = w["momentum"] * (momentum - 1.0) * level_term + w["level"] * level_term + w["instab"] * instab_term * 5.0
        b2 = dict(b)
        b2["key"] = key
        b2["raw_att"] = max(0.0, raw_att)
        b2["momentum"] = round(momentum, 2)
        items.append(b2)
    base = _percentile([i["raw_att"] for i in items if i["raw_att"] > 0], cfg["normalize_pct"])
    th = cfg["level_thresholds"]
    for i in items:
        score = 0 if base <= 0 else max(0, min(100, round(100 * i["raw_att"] / base)))
        lvl = 1 + sum(1 for t in th if score >= t)
        i["score"] = int(score)
        i["level"] = int(lvl)
    items.sort(key=lambda i: (-i["score"], -sum(i["counts"].values())))
    return items


def trend_of(score_now, hist, cfg):
    """直近 hist の最新 score と比較して trend 判定を返す。

    Args:
        score_now: 現在のスコア
        hist: [{t, raw, score}, ...] の履歴リスト（昇順）
        cfg: 設定辞書（"trend": {"up_delta": 8, "down_delta": 8} を含む）

    Returns:
        "new" / "up" / "down" / "flat"
    """
    if not hist:
        return "new"
    ref = hist[-1]["score"]
    d = score_now - ref
    t = cfg["trend"]
    return "up" if d >= t["up_delta"] else "down" if d <= -t["down_delta"] else "flat"


_SIG_LABEL = {"conflict": "紛争", "protests": "抗議", "news": "報道", "quakes": "地震", "ships": "船舶"}
_SIG_SRC = {"conflict": "GDELT", "protests": "GDELT", "news": "news", "quakes": "USGS", "ships": "AIS"}


def _signals_from_counts(item):
    out = []
    for src, n in (item.get("counts") or {}).items():
        if n:
            out.append({"label": f"{_SIG_LABEL.get(src, src)} {n}件",
                        "source": _SIG_SRC.get(src, src), "kind": src})
    if item.get("momentum", 1.0) > 1.2:
        out.append({"label": f"勢い ×{item['momentum']}", "source": "trend", "kind": "momentum"})
    if item.get("approx"):
        out.append({"label": "※近似(紛争データ流用)", "source": "conflict", "kind": "meta"})
    return out


def _place_ja(item, fips_ja):
    s = item["scope"]
    if s == "country":
        return fips_ja.get(item["place_key"], item["place_key"])
    if s == "global":
        return "グローバル"
    return item.get("place_ja") or item["place_key"]


def build_cards(items, history, fips_ja, now_ms, cfg):
    """各 item を Card 化し、ドメインごとに上位 domain_show 件に絞って返す。"""
    by_dom = {}
    cards = []
    for it in items:
        dom = it["domain"]
        by_dom[dom] = by_dom.get(dom, 0) + 1
        if by_dom[dom] > cfg["domain_show"]:
            continue
        no_signal = not any((it.get("counts") or {}).values())
        watch = it["score"] < cfg["watch_score_min"] or no_signal
        card = {
            "domain": dom, "scope": it["scope"],
            "place_ja": _place_ja(it, fips_ja), "place_key": it["place_key"],
            "attention_score": int(it["score"]), "attention_level": int(it["level"]),
            "trend": trend_of(it["score"], history.get(it["key"], []), cfg),
            "confidence": confidence_of(it, cfg), "horizon": "24-72h",
            "signals": _signals_from_counts(it),
            "outlook_ja": "", "rationale_ja": "", "ai_generated": False,
            "status": "watch" if watch else "active"}
        if isinstance(it.get("lat"), (int, float)) and isinstance(it.get("lon"), (int, float)) \
                and (it["lat"] or it["lon"]):
            card["lat"] = float(it["lat"]); card["lon"] = float(it["lon"])
        cards.append(card)
    return cards


FORECAST_SYSTEM = (
    "あなたは地政学/リスクアナリストです。各項目について、与えたデータ（信号）のみを根拠に、"
    "今後24〜72hの『見通し(outlook)』と『なぜ注視か(rationale)』を日本語各1文で書きます。"
    "データに無い固有名詞・数値を作らない（捏造禁止）。"
    "投資・軍事・政治的行動などの助言は一切しない（推測の提示のみ）。"
    "断定を避け『〜の恐れ』『〜が起こりうる』等の不確実表現を使う。出力は JSON のみ。")


def forecast_prompt(cards, cfg):
    n = cfg["top_n_narrative"]
    per = {}
    lines = []
    for c in cards:
        if c.get("status") != "active":
            continue
        dom = c["domain"]; per[dom] = per.get(dom, 0) + 1
        if per[dom] > n:
            continue
        key = f'{dom}:{c["place_key"]}'
        sig = "; ".join(s["label"] for s in c.get("signals", []))
        lines.append(f'{key} | {c["place_ja"]} | score={c["attention_score"]} | 信号: {sig}')
    body = "\n".join(lines)
    return ('次の各項目について、与えた信号のみを根拠に '
            '{"<キー>": {"outlook":"…", "rationale":"…"}} の JSON で返してください。'
            '助言禁止・捏造禁止・不確実表現。\n\n' + body)


def parse_narratives(text):
    from collectors.lib.intel import _strip_fence
    import json as _j
    try:
        d = _j.loads(_strip_fence(text))
    except (ValueError, TypeError):
        return {}
    if not isinstance(d, dict):
        return {}
    out = {}
    for k, v in d.items():
        if not isinstance(k, str) or not isinstance(v, dict):
            continue
        o = str(v.get("outlook", "")).strip()[:200]
        r = str(v.get("rationale", "")).strip()[:200]
        if o or r:
            out[k] = {"outlook": o, "rationale": r}
    return out


def apply_narratives(cards, narr):
    """active カードに outlook/rationale を in-place で充填する。is_advice 検出時は破棄。"""
    for c in cards:
        if c.get("status") != "active":
            continue
        key = f'{c["domain"]}:{c["place_key"]}'
        n = narr.get(key)
        if not n:
            continue
        o, r = n.get("outlook", ""), n.get("rationale", "")
        if is_advice(o) or is_advice(r):
            continue  # 助言は破棄（決定論カードのまま）
        c["outlook_ja"] = o; c["rationale_ja"] = r; c["ai_generated"] = True


_ADVICE_RE = re.compile(r"(べきだ|べきです|推奨|買[うい]だ|売[るり]だ|投資すべき|購入すべき|攻撃せよ|攻撃を推奨|おすすめ|お勧め|勧める|勧めます)")

def is_advice(text):
    """テキストが投資・軍事などの具体的な行動助言を含むかチェック。

    注意：「〜すべき」単体は追加しない（"注視すべき"等の正常なナラティブを誤検出するため）。
    行動助言は「投資すべき」「購入すべき」など具体動詞付きのみを検出。
    """
    return bool(_ADVICE_RE.search(text or ""))


def update_history(history, items, now_ms, cfg):
    """history を items で更新し、cfg["history_days"] の FIFO で整理。

    Args:
        history: {key: [{t, raw, score}, ...]} の履歴辞書
        items: 新規アイテム {key, raw, score} のリスト
        now_ms: 現在時刻（ミリ秒）
        cfg: 設定辞書（"history_days": 7 を含む）

    Returns:
        更新後の history 辞書
    """
    cutoff = now_ms - cfg["history_days"] * 86400_000
    out = {}
    for it in items:
        k = it["key"]
        lst = [x for x in history.get(k, []) if x["t"] >= cutoff]
        lst.append({"t": int(now_ms), "raw": round(float(it["raw"]), 3), "score": int(it["score"])})
        out[k] = lst
    return out
