"""USGS 地震フィードを取得して data/snapshots/quakes.json に書き出す。"""
import json
import os
from datetime import datetime, timezone

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
