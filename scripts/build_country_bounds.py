#!/usr/bin/env python3
"""NE 50m admin0 から data/static/country_bounds.geojson を再生成する（確定事項6）。

- スキーマ {code(FIPS), name} を厳守（name は既存 country_bounds の英名を保持）。
- resolve_fips（ne_prep）で ISO→FIPS＋既存 name 突合の二重チェック。
- simplify_ring(eps=0.01) で過度間引きを避ける（隙間抑制）。
- 既存 country_bounds の FIPS 集合が再生成後も全て残ることを assert（build 失敗化）。

入力 NE 50m GeoJSON は scripts/.cache/ne/ne_50m_admin_0_countries.geojson に
ローカルで手調達して置く（gen_country_centroids と同じ運用・生成物のみコミット）。
実行: PYTHONPATH=. uv run python scripts/build_country_bounds.py
"""
import json
import os
import re

from scripts.lib.ne_prep import resolve_fips, simplify_ring

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE_50M = os.path.join(ROOT, "scripts/.cache/ne/ne_50m_admin_0_countries.geojson")
OUT = os.path.join(ROOT, "data/static/country_bounds.geojson")
EPS = 0.01


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def load_existing_bounds():
    gj = json.load(open(OUT, encoding="utf-8"))
    name_index = {f["properties"]["name"]: f["properties"]["code"] for f in gj["features"]}
    fips_to_name = {f["properties"]["code"]: f["properties"]["name"] for f in gj["features"]}
    existing_codes = set(fips_to_name)
    return name_index, fips_to_name, existing_codes


def simplify_geometry(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(r, EPS) for r in coords]}
    if gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[simplify_ring(r, EPS) for r in poly] for poly in coords]}
    return geom


def _polygon_list(geom):
    """Polygon/MultiPolygon を polygon（[outer, hole...]）のリストに正規化する。"""
    t = geom.get("type")
    coords = geom.get("coordinates") or []
    if t == "Polygon":
        return [coords]
    if t == "MultiPolygon":
        return list(coords)
    return []


def merge_geometries(geoms):
    """複数 geometry を 1 つの (Multi)Polygon に統合する。
    NE が同一国を複数 feature に分割するケース（例: フィンランド本土＋オーランド諸島が
    別 feature で両方 FIPS=FI に解決）で「最初の1件だけ残す」と本土が落ちるため、
    同一 FIPS に解決した全 feature のポリゴンを結合する。"""
    polys = []
    for g in geoms:
        polys.extend(_polygon_list(g))
    if not polys:
        return {"type": "MultiPolygon", "coordinates": []}
    if len(polys) == 1:
        return {"type": "Polygon", "coordinates": polys[0]}
    return {"type": "MultiPolygon", "coordinates": polys}


def main():
    fips_ja = load_fips_ja()
    name_index, fips_to_name, existing_codes = load_existing_bounds()
    ne = json.load(open(NE_50M, encoding="utf-8"))

    # 同一 FIPS に解決する NE feature を全て集めて結合する（本土＋領土の分割表現対策）。
    geoms_by_code, names_by_code, order, unresolved = {}, {}, [], []
    for f in ne.get("features", []):
        props = f.get("properties") or {}
        code = resolve_fips(props, name_index)
        if not code:
            unresolved.append(props.get("ADMIN") or props.get("admin") or props.get("name"))
            continue
        if code not in geoms_by_code:
            geoms_by_code[code] = []
            order.append(code)
            names_by_code[code] = (props.get("ADMIN") or props.get("admin")
                                   or props.get("NAME") or props.get("name") or code)
        geoms_by_code[code].append(simplify_geometry(f.get("geometry") or {}))

    out_features = []
    for code in order:
        name = fips_to_name.get(code) or names_by_code.get(code) or code
        out_features.append({
            "type": "Feature",
            "properties": {"code": code, "name": name},
            "geometry": merge_geometries(geoms_by_code[code]),
        })

    out_codes = {f["properties"]["code"] for f in out_features}
    missing = sorted(existing_codes - out_codes)
    assert not missing, f"既存 country_bounds の FIPS が再生成で欠落: {missing} / 未解決NE: {unresolved}"
    # 参考表示（FIPS_JA との差は EXTRA68 を含むので assert しない）。
    print(f"resolved {len(out_features)} features / "
          f"FIPS_JA 未カバー（EXTRA含む）= {len(set(fips_ja) - out_codes)}")
    if unresolved:
        print(f"WARN 未解決 {len(unresolved)} 件: {unresolved[:10]}")

    fc = {"type": "FeatureCollection", "features": out_features}
    json.dump(fc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
