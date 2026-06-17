"""Open-Meteo Marine API の全球 SST(海面水温) を取得して data/snapshots/sst.json に書く。"""
import json
import os
import time
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest

API_URL = "https://marine-api.open-meteo.com/v1/marine"
# 全球 5° グリッド（lat -85..85=35行, lon -180..175=72列 = 2520点）
LAT0, LAT1, LON0, LON1, STEP = -85, 85, -180, 175, 5
BATCH = 200          # 1リクエストの座標数（保守的）
SLEEP_S = 25.0       # バッチ間スリープ（Open-Meteo 分次レート制限回避）
RETRY_WAIT_S = 65    # 429（分次レート制限）検知時の待機秒


def _seq(start, end, step):
    out, v = [], start
    while v <= end + 1e-9:
        out.append(round(v, 4))
        v += step
    return out


def build_grid(lat0, lat1, lon0, lon1, step):
    """row-major（lat 外側・昇順 × lon 内側・昇順）のグリッド座標列（純粋）。"""
    lats, lons = _seq(lat0, lat1, step), _seq(lon0, lon1, step)
    return [(la, lo) for la in lats for lo in lons]


def grid_meta(lat0, lat1, lon0, lon1, step):
    """フロントに渡すグリッドメタ（純粋）。"""
    return {
        "lat0": lat0, "lon0": lon0, "latStep": step, "lonStep": step,
        "nLat": len(_seq(lat0, lat1, step)), "nLon": len(_seq(lon0, lon1, step)),
    }


def chunk(points, size):
    """size ごとに分割（純粋）。"""
    return [points[i:i + size] for i in range(0, len(points), size)]


def parse_temps(responses):
    """バッチ応答（各バッチ=座標順のリスト）を grid 順の水温配列に平坦化（純粋）。陸/欠損は None。"""
    out = []
    for batch in responses:
        for item in batch:
            cur = (item or {}).get("current") or {}
            out.append(cur.get("sea_surface_temperature"))
    return out


def build_snapshot(temps, meta, updated_iso):
    """配信用スナップショット dict（純粋）。"""
    return {
        "layer": "sst",
        "updated": updated_iso,
        "grid": meta,
        "count": sum(1 for t in temps if t is not None),
        "temps": temps,
    }


SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def fetch_batch(coords, timeout=30):
    """座標群（[(lat,lon),...]）を1リクエストで取得し、座標順の応答リストを返す。"""
    lats = ",".join(str(la) for la, _ in coords)
    lons = ",".join(str(lo) for _, lo in coords)
    resp = requests.get(
        API_URL,
        params={"latitude": lats, "longitude": lons, "current": "sea_surface_temperature"},
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else [data]


def fetch_with_retry(coords, attempts=3, wait=RETRY_WAIT_S):
    """429（レート制限）時は wait 秒待って最大 attempts 回までリトライ。その他のエラーは即再送出。"""
    for k in range(attempts):
        try:
            return fetch_batch(coords)
        except requests.HTTPError as e:
            code = getattr(getattr(e, "response", None), "status_code", None)
            if code == 429 and k < attempts - 1:
                print(f"[sst] 429 rate-limited; wait {wait}s ({k + 1}/{attempts})")
                time.sleep(wait)
                continue
            raise


def main():
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "sst.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    grid = build_grid(LAT0, LAT1, LON0, LON1, STEP)
    meta = grid_meta(LAT0, LAT1, LON0, LON1, STEP)
    responses = []
    try:
        for i, batch in enumerate(chunk(grid, BATCH)):
            responses.append(fetch_with_retry(batch))
            if i + 1 < (len(grid) + BATCH - 1) // BATCH:
                time.sleep(SLEEP_S)
    except Exception as e:  # 失敗時は前回スナップショットを温存
        print(f"[sst] fetch failed: {e}; keeping previous snapshot")
        return 1
    temps = parse_temps(responses)
    if len(temps) != len(grid):  # 期待長と不一致は破棄（堅牢性）
        print(f"[sst] length mismatch {len(temps)} != {len(grid)}; abort")
        return 1
    snap = build_snapshot(temps, meta, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False)
    update_manifest(manifest_path, "sst", now_iso, snap["count"])
    print(f"[sst] wrote {snap['count']}/{len(grid)} temps -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
