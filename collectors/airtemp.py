"""Open-Meteo の全球 2m エア温度を取得して data/snapshots/airtemp.json に書く。"""
import json
import os
import time
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest

API_URL = "https://api.open-meteo.com/v1/forecast"
# 全球 5° グリッド（lat -85..85=35行, lon -180..175=72列 = 2520点）
LAT0, LAT1, LON0, LON1, STEP = -85, 85, -180, 175, 5
BATCH = 200          # 1リクエストの座標数（保守的）
SLEEP_S = 1.0        # バッチ間スリープ（レート制限回避）


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
