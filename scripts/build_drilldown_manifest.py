#!/usr/bin/env python3
"""ドリルダウン用マニフェストを生成する。

出力:
  data/static/drilldown_manifest.json
  {
    "<FIPS>": {
      "admin1Bytes": <int|null>,   # data/static/admin1/<FIPS>.geojson.gz のバイト数
      "citiesBytes": <int|null>,   # data/static/cities/<FIPS>.json のバイト数
      "countryBbox": [w,s,e,n]    # admin1_bbox.json から転写（無ければ null）
    },
    ...
    "extra": {                     # 小国/領土（admin1 が空）の代表座標
      "<FIPS>": {"lon": float, "lat": float, "margin": float}
    }
  }

前提: build_country_bounds.py・build_admin1.py・build_cities.py 実行済み。
実行: PYTHONPATH=. uv run python scripts/build_drilldown_manifest.py
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN1_DIR = os.path.join(ROOT, "data/static/admin1")
CITIES_DIR = os.path.join(ROOT, "data/static/cities")
BBOX_FILE = os.path.join(ROOT, "data/static/admin1_bbox.json")
CENTROIDS_FILE = os.path.join(ROOT, "js/lib/country_centroids.js")
OUT = os.path.join(ROOT, "data/static/drilldown_manifest.json")


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def load_bbox_index():
    try:
        return json.load(open(BBOX_FILE, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def load_centroids():
    """js/lib/country_centroids.js から EXTRA の lon/lat/margin を読む。"""
    try:
        src = open(CENTROIDS_FILE, encoding="utf-8").read()
        # export const EXTRA = { "AA": {lon:...,lat:...,margin:...}, ... }
        m = re.search(r"export const EXTRA\s*=\s*(\{.*?\});", src, re.S)
        if not m:
            return {}
        # JSON 化（JS オブジェクトリテラルを単純に評価）。
        raw = m.group(1)
        # キーを引用符で囲む（簡易変換）。
        raw = re.sub(r'([{,])\s*([A-Z]{2})\s*:', r'\1"\2":', raw)
        return json.loads(raw)
    except Exception:
        return {}


def file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def main():
    fips_ja = load_fips_ja()
    bbox_index = load_bbox_index()
    centroids = load_centroids()

    manifest = {}
    extra = {}

    for fips in fips_ja:
        admin1_path = os.path.join(ADMIN1_DIR, f"{fips}.geojson.gz")
        cities_path = os.path.join(CITIES_DIR, f"{fips}.json")
        admin1_bytes = file_size(admin1_path)
        cities_bytes = file_size(cities_path)
        country_bbox = bbox_index.get(fips, {}).get("countryBbox", None)
        manifest[fips] = {
            "admin1Bytes": admin1_bytes,
            "citiesBytes": cities_bytes,
            "countryBbox": country_bbox,
        }
        # EXTRA：admin1 が空（ポリゴン無し小国）かつ centroid に lon/lat がある国。
        if fips in centroids:
            c = centroids[fips]
            if "lon" in c and "lat" in c:
                extra[fips] = {
                    "lon": c["lon"],
                    "lat": c["lat"],
                    "margin": c.get("margin", 5.0),
                }

    manifest["extra"] = extra
    json.dump(manifest, open(OUT, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes) / "
          f"{len(fips_ja)} countries / {len(extra)} extra")


if __name__ == "__main__":
    main()
