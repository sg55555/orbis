#!/usr/bin/env python3
"""NE 10m populated_places を国別 split＋name:ja 付与＋人口降順 cap400 出力。

出力:
  data/static/cities/<FIPS>.json  [{name,name_ja,lon,lat,pop}]・人口降順・最大400件

入力 NE 10m populated_places は
  scripts/.cache/ne/ne_10m_populated_places.geojson に手調達。
name:ja キャッシュ（scripts/.cache/name_ja_*.json）は無ければ空 dict（英名フォールバック）。
実行: PYTHONPATH=. uv run python scripts/build_cities.py
"""
import json
import os
import re

from scripts.lib.ne_prep import (
    resolve_fips, pick_name_ja, split_by_country, nearest_city_cap,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE_PLACES = os.path.join(ROOT, "scripts/.cache/ne/ne_10m_populated_places.geojson")
OUT_DIR = os.path.join(ROOT, "data/static/cities")
MAX_CITIES = 400


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def load_name_index():
    gj = json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))
    return {f["properties"]["name"]: f["properties"]["code"] for f in gj["features"]}


def load_cache(name):
    p = os.path.join(ROOT, "scripts/.cache", name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def place_to_record(feat, wiki, geo):
    """NE populated_places feature → {name,name_ja,lon,lat,pop}。"""
    props = feat.get("properties") or {}
    geom = feat.get("geometry") or {}
    coords = geom.get("coordinates") or [0, 0]
    lon, lat = coords[0], coords[1]
    name = props.get("NAME") or props.get("name") or ""
    name_ja = pick_name_ja(props, wiki, geo)
    pop = props.get("POP_MAX") or props.get("pop_max") or props.get("POP") or props.get("pop") or 0
    try:
        pop = int(pop)
    except (TypeError, ValueError):
        pop = 0
    qid = props.get("WIKIDATAID") or props.get("wikidataid") or ""
    return {"name": name, "name_ja": name_ja, "lon": lon, "lat": lat, "pop": pop,
            "qid": qid.strip() if isinstance(qid, str) else ""}


def main():
    fips_ja = load_fips_ja()
    name_index = load_name_index()
    wiki = load_cache("name_ja_wikidata.json")
    geo = load_cache("name_ja_geonames.json")
    ne = json.load(open(NE_PLACES, encoding="utf-8"))

    # populated_places は ISO_A2 で国を持つので resolve_fips を流用。
    groups = split_by_country(
        ne.get("features", []),
        lambda f: resolve_fips(f.get("properties") or {}, name_index),
    )
    os.makedirs(OUT_DIR, exist_ok=True)

    for fips, feats in groups.items():
        places = [place_to_record(f, wiki, geo) for f in feats]
        capped = nearest_city_cap(places, MAX_CITIES)
        path = os.path.join(OUT_DIR, f"{fips}.json")
        json.dump(capped, open(path, "w", encoding="utf-8"),
                  ensure_ascii=False, separators=(",", ":"))

    # EXTRA68 / 未カバー国は空リストを出力（404 回避）。
    for fips in fips_ja:
        path = os.path.join(OUT_DIR, f"{fips}.json")
        if not os.path.exists(path):
            json.dump([], open(path, "w", encoding="utf-8"))

    print(f"wrote cities for {len(groups)} countries + "
          f"{len(fips_ja) - len(groups)} empty (total {len(fips_ja)})")


if __name__ == "__main__":
    main()
