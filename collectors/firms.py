"""NASA FIRMS active fire（山火事）を取得して data/snapshots/firms.json に書き出す。

quakes.py 同型のスナップショット collector。VIIRS の CSV を取得し、顕著な火点
（信頼度 nominal 以上＋FRP 閾値以上）に絞り、FRP 上位 CAP 件を配信する。
FIRMS_MAP_KEY 未設定なら main() は skip（他 collector 同型）。
"""
import csv
import io
import json
import os
from datetime import datetime, timezone

import requests

from collectors.lib.manifest import update_manifest
from collectors.lib.keycheck import key_or_skip

SOURCE = "VIIRS_NOAA20_NRT"   # 375m・運用衛星（VIIRS_SNPP_NRT / VIIRS_NOAA21_NRT に切替可）
DAY_RANGE = 1                 # 直近 24h（有効 1..5）
FRP_MIN = 10.0                # 火放射パワー(MW)の下限＝小さな農地火・恒常燃焼を落とす
CAP = 1500                    # FRP 上位でこの件数に制限（スナップショット肥大・描画負荷抑制）
API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
_CONF = {"h": "high", "n": "nominal", "l": "low",
         "high": "high", "nominal": "nominal", "low": "low"}


def parse_csv(text):
    """FIRMS CSV テキスト → dict 行のリスト（ヘッダ行で列名解決＝列順非依存）。"""
    return list(csv.DictReader(io.StringIO(text)))


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def transform(rows):
    """dict 行 → 配信用 points（純関数）。信頼度 nominal 以上・FRP>=FRP_MIN を残し、
    FRP 降順で先頭 CAP 件。confidence は h/n→high/nominal に正規化。"""
    out = []
    for r in rows:
        conf = _CONF.get((r.get("confidence") or "").strip().lower())
        frp = _num(r.get("frp"))
        lat = _num(r.get("latitude"))
        lon = _num(r.get("longitude"))
        if conf not in ("nominal", "high") or frp is None or frp < FRP_MIN or lat is None or lon is None:
            continue
        acq_date = (r.get("acq_date") or "").strip()
        acq_time = (r.get("acq_time") or "").strip()
        out.append({
            "id": f"{lat}_{lon}_{acq_date}_{acq_time}",
            "lon": lon, "lat": lat, "frp": frp, "confidence": conf,
            "bright": _num(r.get("bright_ti4")),
            "acq_date": acq_date, "acq_time": acq_time,
            "daynight": (r.get("daynight") or "").strip(),
            "satellite": (r.get("satellite") or "").strip(),
        })
    out.sort(key=lambda p: p["frp"], reverse=True)
    if len(out) > CAP:
        print(f"[firms] cap: {len(out)} → {CAP} 件（FRP 上位）")
        out = out[:CAP]
    return out


def build_snapshot(points, updated_iso):
    """配信用スナップショット dict（純関数）。"""
    return {"layer": "firms", "updated": updated_iso, "count": len(points), "points": points}


def fetch(map_key, source=SOURCE, day_range=DAY_RANGE, timeout=30):
    """FIRMS Area API（world・CSV）から生テキストを取得する。"""
    url = f"{API}/{map_key}/{source}/world/{day_range}"
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.text


SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def main():
    key = key_or_skip("firms", "FIRMS_MAP_KEY")
    if key is None:
        print("[firms] FIRMS_MAP_KEY not set; skip")
        return
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    points = transform(parse_csv(fetch(key)))
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(os.path.join(out_dir, "firms.json"), "w", encoding="utf-8") as fp:
        json.dump(build_snapshot(points, updated), fp, ensure_ascii=False)
    update_manifest(os.path.join(out_dir, "manifest.json"), "firms", updated, len(points))
    print(f"[firms] wrote {len(points)} points")


if __name__ == "__main__":
    main()
