# collectors/ships.py
"""AISStream の全球 AIS を時間枠リッスンして data/snapshots/ships.json に書き出す。"""
import json
import os
import time
from datetime import datetime, timezone

from collectors.lib.manifest import update_manifest

API_URL = "wss://stream.aisstream.io/v0/stream"
MAX_POINTS = 5000
LISTEN_SECONDS = 28
SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


def ship_type_label(code):
    """AIS 船種コード → 日本語カテゴリ（純粋）。未知/範囲外/非数値は「船舶」。"""
    try:
        c = int(code)
    except (TypeError, ValueError):
        return "船舶"
    if c == 30:
        return "漁船"
    if c == 36:
        return "帆船"
    if c == 37:
        return "プレジャーボート"
    if c == 50:
        return "水先船"
    if c == 51:
        return "捜索救助"
    if c == 52:
        return "曳航船"
    if 60 <= c <= 69:
        return "旅客船"
    if 70 <= c <= 79:
        return "貨物船"
    if 80 <= c <= 89:
        return "タンカー"
    return "船舶"


def parse_position(msg):
    """PositionReport メッセージ dict → {mmsi,lon,lat,cog,sog} | None（純粋）。
    座標欠損は None。Cog/Sog は AIS 番兵値(360/102.3 以上)を None 化、座標は3桁丸め。"""
    meta = msg.get("MetaData") or {}
    rep = (msg.get("Message") or {}).get("PositionReport") or {}
    mmsi = meta.get("MMSI") or rep.get("UserID")
    lat, lon = rep.get("Latitude"), rep.get("Longitude")
    if mmsi is None or lat is None or lon is None:
        return None
    if not (-90 <= float(lat) <= 90 and -180 <= float(lon) <= 180):
        return None
    cog, sog = rep.get("Cog"), rep.get("Sog")
    cog = round(float(cog), 1) if cog is not None and 0 <= cog < 360 else None
    sog = round(float(sog), 1) if sog is not None and 0 <= sog < 102.3 else None
    return {"mmsi": int(mmsi), "lon": round(float(lon), 3), "lat": round(float(lat), 3),
            "cog": cog, "sog": sog}


def parse_static(msg):
    """ShipStaticData メッセージ dict → {mmsi,name,type} | None（純粋）。"""
    meta = msg.get("MetaData") or {}
    sd = (msg.get("Message") or {}).get("ShipStaticData") or {}
    mmsi = meta.get("MMSI") or sd.get("UserID")
    if mmsi is None:
        return None
    name = (sd.get("Name") or meta.get("ShipName") or "").strip() or None
    return {"mmsi": int(mmsi), "name": name, "type": ship_type_label(sd.get("Type"))}


def merge_records(positions, statics):
    """positions({mmsi:{...}}) と statics({mmsi:{name,type}}) を MMSI 結合した points 配列（純粋）。"""
    out = []
    for mmsi, pos in positions.items():
        st = statics.get(mmsi) or {}
        out.append({**pos, "name": st.get("name"), "type": st.get("type")})
    return out


def downsample(points, max_points=MAX_POINTS):
    """件数が max を超えたら等間隔ストライドで間引く（純粋）。"""
    n = len(points)
    if n <= max_points:
        return points
    stride = (n + max_points - 1) // max_points
    return points[::stride]


def build_snapshot(points, updated_iso):
    return {"layer": "ships", "updated": updated_iso, "count": len(points), "points": points}


def collect(api_key, seconds=LISTEN_SECONDS):
    """AISStream に接続し seconds 秒リッスン。(positions, statics) を返す（I/O）。"""
    import websocket  # websocket-client
    positions, statics = {}, {}
    ws = websocket.create_connection(API_URL, timeout=10)
    try:
        sub = {"APIKey": api_key,
               "BoundingBoxes": [[[-90, -180], [90, 180]]],  # [[lat_min,lon_min],[lat_max,lon_max]] 全球
               "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}
        ws.send(json.dumps(sub))
        ws.settimeout(3)
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception as e:
                print(f"[ships] ws.recv error: {e}; closing early")
                break
            if not raw:
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            mt = msg.get("MessageType")
            if mt == "PositionReport":
                p = parse_position(msg)
                if p:
                    positions[p["mmsi"]] = p
            elif mt == "ShipStaticData":
                s = parse_static(msg)
                if s:
                    statics[s["mmsi"]] = s
    finally:
        try:
            ws.close()
        except Exception:
            pass
    return positions, statics


def main():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    api_key = os.environ.get("AISSTREAM_API_KEY")
    if not api_key:
        print("[ships] AISSTREAM_API_KEY not set; skipping")
        return 0
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        positions, statics = collect(api_key)
    except Exception as e:
        print(f"[ships] collect failed: {e}; keeping previous snapshot")
        return 1
    points = downsample(merge_records(positions, statics))
    if not points:
        print("[ships] no points received; keeping previous snapshot")
        return 1
    snap = build_snapshot(points, now_iso)
    snap_path = os.path.join(SNAPSHOT_DIR, "ships.json")
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(os.path.join(SNAPSHOT_DIR, "manifest.json"), "ships", now_iso, len(points))
    print(f"[ships] wrote {len(points)} points -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
