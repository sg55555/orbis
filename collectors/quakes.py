"""USGS 地震フィードを取得して data/snapshots/quakes.json に書き出す。"""
import json
import os
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest

USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"


def transform(geojson):
    """USGS GeoJSON を ORBIS の軽量 points 配列に変換する（純粋関数）。"""
    points = []
    for f in (geojson.get("features") or []):
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        props = f.get("properties") or {}
        if len(coords) < 2:
            continue
        if props.get("mag") is None:
            continue
        points.append({
            "id": f.get("id"),
            "lon": coords[0],
            "lat": coords[1],
            "depth": coords[2] if len(coords) > 2 else None,
            "mag": props.get("mag"),
            "place": props.get("place"),
            "time": props.get("time"),
            "url": props.get("url"),
        })
    return points


def build_snapshot(points, updated_iso):
    """配信用スナップショット dict を組み立てる（純粋関数）。"""
    return {
        "layer": "quakes",
        "updated": updated_iso,
        "count": len(points),
        "points": points,
    }


SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def fetch(url=USGS_URL, timeout=30):
    """USGS から GeoJSON を取得する。"""
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def main():
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "quakes.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        points = transform(fetch())
    except Exception as e:  # 失敗時は前回スナップショットを温存（堅牢性）
        print(f"[quakes] fetch/transform failed: {e}; keeping previous snapshot")
        return 1
    snap = build_snapshot(points, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    update_manifest(manifest_path, "quakes", now_iso, len(points))
    print(f"[quakes] wrote {len(points)} points -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
