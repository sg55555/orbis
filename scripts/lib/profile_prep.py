"""地域プロフィール生成の純関数群（stdlib のみ・pytest 対象）。I/O は build_profiles.py。"""
import json
import re

SECTIONS = ["概要", "気候", "特産・名物", "主要産業", "交通・地理", "観光名所"]


def resolve_qid(props):
    """NE feature properties → Wikidata QID（"Q…"）。無効/欠落は None。"""
    for k in ("wikidataid", "WIKIDATAID", "wikidataId"):
        v = props.get(k)
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("Q") and v[1:].isdigit():
                return v
    return None


def _claim_amount(claims, pid):
    for c in claims.get(pid) or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            amt = v["amount"] if isinstance(v, dict) and "amount" in v else v
            return float(amt)
        except (KeyError, TypeError, ValueError):
            continue
    return None


def _claim_coord(claims):
    for c in claims.get("P625") or []:
        try:
            v = c["mainsnak"]["datavalue"]["value"]
            return float(v["latitude"]), float(v["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
    return None, None


def wikidata_facts(entity):
    """Wikidata entity → 事実 dict。P1082 人口/P2046 面積/P625 座標/P2044 標高。"""
    claims = (entity or {}).get("claims") or {}
    pop = _claim_amount(claims, "P1082")
    lat, lon = _claim_coord(claims)
    return {
        "population": int(pop) if pop is not None else None,
        "area_km2": _claim_amount(claims, "P2046"),
        "lat": lat, "lon": lon,
        "elevation_m": _claim_amount(claims, "P2044"),
    }


def ja_wikipedia_title(entity):
    """entity の日本語 Wikipedia サイトリンク title。無ければ None。"""
    sl = (entity or {}).get("sitelinks") or {}
    t = (sl.get("jawiki") or {}).get("title")
    return t.strip() if isinstance(t, str) and t.strip() else None
