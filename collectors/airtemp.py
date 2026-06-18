"""Open-Meteo の全球 2m エア温度を取得して data/snapshots/airtemp.json に書く。"""
import json
import os
import time
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest
from collectors.lib.http import retry, collect_batches

API_URL = "https://api.open-meteo.com/v1/forecast"
# 全球 5° グリッド（lat -85..85=35行, lon -180..175=72列 = 2520点）
LAT0, LAT1, LON0, LON1, STEP = -85, 85, -180, 175, 5
BATCH = 200          # 1リクエストの座標数（保守的）
SLEEP_S = 25.0       # バッチ間スリープ（Open-Meteo 分次レート制限 ~3req/min 回避）
RETRY_WAIT_S = 15    # 一時的エラー（timeout/429/5xx）でのリトライ待機秒


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
    """バッチ応答（各バッチ=座標順のリスト）を grid 順の温度配列に平坦化（純粋）。欠損は None。"""
    out = []
    for batch in responses:
        for item in batch:
            cur = (item or {}).get("current") or {}
            out.append(cur.get("temperature_2m"))
    return out


def build_snapshot(temps, meta, updated_iso):
    """配信用スナップショット dict（純粋）。"""
    return {
        "layer": "airtemp",
        "updated": updated_iso,
        "grid": meta,
        "count": sum(1 for t in temps if t is not None),
        "temps": temps,
    }


SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def fetch_batch(coords, timeout=(10, 60)):
    """座標群（[(lat,lon),...]）を1リクエストで取得し、座標順の応答リストを返す。
    timeout=(connect, read)。200点の応答は重く 30s では読取タイムアウトするため read を 60s に取る。"""
    lats = ",".join(str(la) for la, _ in coords)
    lons = ",".join(str(lo) for _, lo in coords)
    resp = requests.get(
        API_URL,
        params={"latitude": lats, "longitude": lons, "current": "temperature_2m"},
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else [data]


def fetch_with_retry(coords, attempts=4, wait=RETRY_WAIT_S, sleep=time.sleep):
    """一時的エラー（読取/接続タイムアウト・接続断・429・5xx）で wait 秒待ってリトライ。
    CI 共有IPでは 200点リクエストが散発的に Read timeout するため、429 だけでなく
    timeout も再試行して層全体を1回の失敗で落とさない。sleep はテスト用に注入可。"""
    return retry(lambda: fetch_batch(coords), attempts=attempts, wait=wait, sleep=sleep)


def main():
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "airtemp.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    grid = build_grid(LAT0, LAT1, LON0, LON1, STEP)
    meta = grid_meta(LAT0, LAT1, LON0, LON1, STEP)
    # best-effort 収集：1バッチ失敗で層全体を捨てず、失敗バッチは欠損で埋めて続行。
    # ただし連続失敗（エンドポイント障害）なら早期 abort して前回を温存。
    responses, failed, aborted = collect_batches(
        chunk(grid, BATCH), fetch_with_retry, sleep_between=lambda: time.sleep(SLEEP_S))
    if aborted:
        print(f"[airtemp] aborted after consecutive failures ({failed} batches); keeping previous snapshot")
        return 1
    temps = parse_temps(responses)
    if len(temps) != len(grid):  # 期待長と不一致は破棄（堅牢性）
        print(f"[airtemp] length mismatch {len(temps)} != {len(grid)}; abort")
        return 1
    snap = build_snapshot(temps, meta, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False)
    update_manifest(manifest_path, "airtemp", now_iso, snap["count"])
    print(f"[airtemp] wrote {snap['count']}/{len(grid)} temps ({failed} batches missing) -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
