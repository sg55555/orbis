"""OpenSky の全機 state vector を取得して data/snapshots/flights.json に書き出す。"""
import json
import os
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest

STATES_URL = "https://opensky-network.org/api/states/all"
MAX_POINTS = 6000


def transform(payload):
    """OpenSky states を軽量 points 配列へ変換（純粋）。lon/lat 欠損は除外、座標は小数3桁。"""
    points = []
    for s in (payload.get("states") or []):
        if len(s) < 11:
            continue
        lon, lat = s[5], s[6]
        if lon is None or lat is None:
            continue
        points.append({
            "icao24": s[0],
            "callsign": (s[1] or "").strip(),
            "lon": round(lon, 3),
            "lat": round(lat, 3),
            "alt": s[7],
            "on_ground": s[8],
            "velocity": s[9],
            "heading": s[10],
        })
    return points


def downsample(points, max_points=MAX_POINTS):
    """件数が max を超えたら等間隔ストライドで間引く（純粋）。"""
    n = len(points)
    if n <= max_points:
        return points
    stride = (n + max_points - 1) // max_points
    return points[::stride]


def build_snapshot(points, updated_iso):
    return {"layer": "flights", "updated": updated_iso, "count": len(points), "points": points}


SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


def fetch(url=STATES_URL, timeout=30):
    """OpenSky 全機 state を取得（匿名）。"""
    resp = requests.get(url, timeout=timeout, headers={"User-Agent": "orbis-collector"})
    resp.raise_for_status()
    return resp.json()


def main():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    snap_path = os.path.join(SNAPSHOT_DIR, "flights.json")
    manifest_path = os.path.join(SNAPSHOT_DIR, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        points = downsample(transform(fetch()))
    except Exception as e:
        print(f"[flights] fetch/transform failed: {e}; keeping previous snapshot")
        return 1
    snap = build_snapshot(points, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(manifest_path, "flights", now_iso, len(points))
    print(f"[flights] wrote {len(points)} points -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
