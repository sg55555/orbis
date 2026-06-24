#!/usr/bin/env python3
"""NE 10m admin1 を国別 split＋name:ja 付与＋頂点間引き＋gzip 出力。

出力:
  data/static/admin1/<FIPS>.geojson.gz  properties={a1code,name_en,name_ja,bbox}
  data/static/admin1_bbox.json          {fips:{countryBbox, admin1:{a1code:bbox}}}
EXTRA68（admin1 無し）国は空 FeatureCollection を明示出力（404 回避）。

入力 NE 10m admin1 は scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson に
手調達。name:ja キャッシュ（scripts/.cache/name_ja_*.json）は無ければ空 dict。
実行: PYTHONPATH=. uv run python scripts/build_admin1.py
"""
import gzip
import json
import os
import re

from scripts.lib.ne_prep import (
    resolve_fips, pick_name_ja, split_by_country, largest_polygon_bbox, simplify_ring,
    union_country_bbox,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE_ADMIN1 = os.path.join(ROOT, "scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson")
OUT_DIR = os.path.join(ROOT, "data/static/admin1")
BBOX_OUT = os.path.join(ROOT, "data/static/admin1_bbox.json")
EPS = 0.01


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


def simplify_geometry(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(r, EPS) for r in coords]}
    if gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[simplify_ring(r, EPS) for r in poly] for poly in coords]}
    return geom


def a1code_of(props):
    for k in ("iso_3166_2", "code_hasc", "adm1_code", "fips"):
        v = props.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def main():
    fips_ja = load_fips_ja()
    name_index = load_name_index()
    wiki = load_cache("name_ja_wikidata.json")
    geo = load_cache("name_ja_geonames.json")
    ne = json.load(open(NE_ADMIN1, encoding="utf-8"))

    groups = split_by_country(ne.get("features", []), lambda f: resolve_fips(f.get("properties") or {}, name_index))
    os.makedirs(OUT_DIR, exist_ok=True)
    # Critical-3: 正準形 {country: {fips: [w,s,e,n]}, extra: {fips: {lon,lat,margin}}}
    # country_index.js countryBbox が bboxIndex.country[fips] を読む形に統一する。
    country_bboxes = {}  # {fips: [w,s,e,n]}

    for fips, feats in groups.items():
        out_feats, a1_bboxes = [], {}
        feat_bboxes = []
        for f in feats:
            props = f.get("properties") or {}
            geom = simplify_geometry(f.get("geometry") or {})
            bbox = largest_polygon_bbox(geom)
            if bbox is None:
                continue
            a1 = a1code_of(props) or f"{fips}-{len(out_feats)}"
            name_en = props.get("name") or props.get("NAME") or a1
            name_ja = pick_name_ja(props, wiki, geo)
            out_feats.append({
                "type": "Feature",
                "properties": {"a1code": a1, "name_en": name_en, "name_ja": name_ja, "bbox": bbox},
                "geometry": geom,
            })
            a1_bboxes[a1] = bbox
            feat_bboxes.append(bbox)
        fc = {"type": "FeatureCollection", "features": out_feats}
        path = os.path.join(OUT_DIR, f"{fips}.geojson.gz")
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))
        # 国 bbox は union_country_bbox で日付変更線跨ぎ（NZ 等）を折返し形に補正する
        # （naive min/max は偽の全幅 bbox を生み flyTo が地球全体にズームアウトする）。
        cb = union_country_bbox(feat_bboxes)
        if cb is not None:
            country_bboxes[fips] = cb

    # EXTRA68（admin1 無し国）は空 FC を出力（404 回避）。
    for fips in fips_ja:
        path = os.path.join(OUT_DIR, f"{fips}.geojson.gz")
        if not os.path.exists(path):
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                json.dump({"type": "FeatureCollection", "features": []}, fh, ensure_ascii=False)

    # FIPS_JA 全キーと生成対象の過不足を検証する（gen_country_centroids.py と同型）。
    # out_codes = NE から生成した国コード集合 + FIPS_JA から空 FC 補完したコード集合
    #           = FIPS_JA 全キー ∪ NE 由来コード
    # missing = FIPS_JA にあるが out_codes に無い（現実装では補完があるため発生しない）
    # surplus = out_codes にあるが FIPS_JA に無い（NE に未知コードが含まれる場合）
    ne_codes = set(groups.keys())
    fips_codes = set(fips_ja)
    out_codes = ne_codes | fips_codes  # 補完ループで fips_codes 全体をカバー済み
    missing = sorted(fips_codes - out_codes)
    surplus = sorted(ne_codes - fips_codes)
    assert not missing, f'FIPS_JA にあるが admin1 未生成: {missing}'
    assert not surplus, f'NE データにあるが FIPS_JA に無し（FIPS_JA に追加せよ）: {surplus}'

    # Critical-3: 正準形で出力。extra は build_drilldown_manifest.py が追記するので空 dict を基底に置く。
    # admin1_bbox.json の最終形は build_drilldown_manifest.py（後段）が extra を上書きマージする。
    bbox_out = {"country": country_bboxes, "extra": {}}
    json.dump(bbox_out, open(BBOX_OUT, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(groups)} country admin1 files + {len(fips_ja)-len(groups)} empty / bbox_index country={len(country_bboxes)}")


if __name__ == "__main__":
    main()
