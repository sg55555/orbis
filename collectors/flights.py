"""adsb.fi の全球タイルを集めて data/snapshots/flights.json に書き出す。

【なぜ OpenSky をやめたか（2026-09-10）】
障害ではなく**規約**。OpenSky の Terms は §1 で非営利の研究・教育に用途を限り、
§3(iii) でデータセットを第三者へ distribute / disclose すること、§3(vi) で REST API を
live product・service・**automated system** に組み込む operational 利用（非営利でも書面ライセンスが必要）
を禁じている。orbis の「15分毎に自動収集 → PUBLIC リポ orbis-data へ commit → 公開サイトで配信」は
egress をどう変えても規約の範囲外だったため、再配信できるソースへ移した。

【adsb.fi の条件（README 逐語・2026-09-10 確認）】
  "adsb.fi open data is for personal, non-commercial use only. You may not license, sell, rent,
   or lease any part of the data or the service. ... You must cite adsb.fi and include a link to
   our home page."
  公開エンドポイントは **1 request per second**。400/401/403/404/429 の多発は一時 IP 制限。
→ cite 義務は UI（js/ui/sources.js・attribution.html）と snapshot 自身（source / source_url）の
  両方で果たす。snapshot は orbis-data 経由で単体でも配られるため、データにも焼き込む。

【タイル方式である理由】
v3 の全球エンドポイント（/v2/snapshot）は feeder 限定で使えない。使えるのは
`/v3/lat/{lat}/lon/{lon}/dist/{dist}`（最大 250NM）だけなので、交通密集地に円を並べて集める。
円は互いに重なるため hex で重複を除く（同じ機体は seen_pos が小さい＝新しい位置を採る）。
"""
import json
import math
import os
import time
from datetime import datetime, timezone

import requests

from collectors.lib.manifest import update_manifest

API_BASE = "https://opendata.adsb.fi/api/v3"
SOURCE_NAME = "adsb.fi"
SOURCE_URL = "https://adsb.fi/"
USER_AGENT = "orbis-collector"

TILE_DIST_NM = 250      # v3 の最大距離
PACE_S = 1.05           # 公開エンドポイントの上限 1 req/s を守る（少し余裕を持たせる）
MIN_OK_RATIO = 0.5      # 成功タイルがこれを下回ったら書かずに前回を残す
MAX_POINTS = 6000

FT_TO_M = 0.3048        # alt_baro は ft（OpenSky の baro_altitude は m だった）
KT_TO_MS = 0.514444     # gs は kt（OpenSky の velocity は m/s だった）

# 交通密集地優先の 42 タイル（250NM 円）。候補 69 点を実測（2026-09-10）して確定：
#  - feeder が構造的に居ない地域は外した。現地が昼でも 0〜9 機しか返らない（ロシア・中央アジア・
#    イラン・パキスタン・インド西部・アフリカ内陸・南米内陸・グアム）。タイルを足しても機体は増えず、
#    先方への無効リクエストが増えるだけになる。
#  - 円が実質重なるものは片方だけ（シンガポール⊂クアラルンプール・ヒューストン⊂ダラス）。
#  - このセットで候補 69 点の 96.7%（4,561/4,715 機）を拾う。1 run あたり 42 req・約 46 秒。
TILES = (
    # 北米
    ("us-northeast",     40.7,  -74.0),
    ("us-chicago",       41.9,  -87.6),
    ("us-southeast",     33.6,  -84.4),
    ("us-texas",         32.9,  -97.0),
    ("us-mountain",      39.8, -104.7),
    ("us-socal",         34.0, -118.2),
    ("us-pacnw",         46.5, -122.3),
    ("us-florida",       26.5,  -80.5),
    ("ca-toronto",       43.7,  -79.6),
    # 欧州（最も密。円が重なっても単独損失が大きいので9枚置く）
    ("eu-london",        51.5,   -0.45),
    ("eu-paris",         48.8,    2.55),
    ("eu-frankfurt",     50.0,    8.5),
    ("eu-madrid",        40.5,   -3.6),
    ("eu-rome",          41.8,   12.3),
    ("eu-istanbul",      41.0,   28.8),
    ("eu-stockholm",     59.6,   17.9),
    ("eu-warsaw",        52.2,   21.0),
    ("eu-athens",        37.9,   23.7),
    # 東アジア
    ("jp-tokyo",         35.6,  139.7),
    ("jp-osaka",         34.4,  135.2),
    ("kr-seoul",         37.5,  126.8),
    ("cn-beijing",       40.1,  116.6),
    ("cn-shanghai",      31.2,  121.3),
    ("cn-guangzhou",     23.4,  113.3),
    ("tw-taipei",        25.1,  121.2),
    # 東南アジア
    ("th-bangkok",       13.7,  100.7),
    ("my-kualalumpur",    3.1,  101.7),
    ("id-jakarta",       -6.1,  106.7),
    ("ph-manila",        14.5,  121.0),
    # 南アジア・中東
    ("in-delhi",         28.6,   77.1),
    ("in-chennai",       13.0,   80.2),
    ("me-dubai",         25.3,   55.4),
    ("me-riyadh",        24.7,   46.7),
    # 豪州
    ("au-sydney",       -33.9,  151.2),
    ("au-melbourne",    -37.7,  144.8),
    ("au-perth",        -31.9,  115.9),
    ("au-brisbane",     -27.4,  153.1),
    # 南米
    ("br-saopaulo",     -23.4,  -46.5),
    ("ar-buenosaires",  -34.8,  -58.5),
    # アフリカ
    ("eg-cairo",         30.1,   31.4),
    ("ma-casablanca",    33.4,   -7.6),
    ("za-johannesburg", -26.1,   28.2),
)

SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


class RateLimited(Exception):
    """429 を受けた。規約上ここで叩き続けると一時 IP 制限を招くので、その run は打ち切る。"""


def tile_url(lat, lon, dist=TILE_DIST_NM):
    return "%s/lat/%s/lon/%s/dist/%s" % (API_BASE, lat, lon, dist)


def _num(v):
    """数値なら float、そうでなければ None。上流が想定外の型を返しても1機捨てるだけで済ませる。"""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return float(v)


def _heading(a):
    """進行方向。track 欠損（実測 11.3%・うち9割は地上機）を calc_track → true_heading で埋める。

    UI は heading 欠損機を飛行機シルエットから小ドットへ落とすため、埋めないと OpenSky 比で
    見た目が劣化する。実測では「3つとも欠損かつ飛行中」の機体は0だった。
    """
    for key in ("track", "calc_track", "true_heading"):
        v = _num(a.get(key))
        if v is not None:
            return round(v, 1)
    return None


def transform_aircraft(a):
    """adsb.fi の1機 → orbis の point（純粋）。位置か識別子が無ければ None。"""
    if not isinstance(a, dict):
        return None
    icao24 = a.get("hex")
    lat, lon = _num(a.get("lat")), _num(a.get("lon"))
    if not icao24 or lat is None or lon is None:
        return None
    alt_baro = a.get("alt_baro")
    on_ground = alt_baro == "ground"        # 数値ではなく文字列 'ground' が来る（実測 13%）
    alt_ft = None if on_ground else _num(alt_baro)
    gs = _num(a.get("gs"))
    return {
        "icao24": icao24,
        "callsign": str(a.get("flight") or "").strip(),   # 末尾スペース込みで来る
        "lon": round(lon, 3),
        "lat": round(lat, 3),
        "alt": None if alt_ft is None else round(alt_ft * FT_TO_M),
        "on_ground": on_ground,
        "velocity": None if gs is None else round(gs * KT_TO_MS, 1),
        "heading": _heading(a),
    }


def _aircraft(payload):
    """v3 は 'ac'、v2 は 'aircraft'。どちらでもない/壊れていれば空。"""
    if not isinstance(payload, dict):
        return []
    return payload.get("ac") or payload.get("aircraft") or []


def transform(payload):
    """1タイル分のレスポンス → points 配列（純粋）。"""
    out = []
    for a in _aircraft(payload):
        p = transform_aircraft(a)
        if p is not None:
            out.append(p)
    return out


def _fresher(new_seen, old_seen):
    """seen_pos（位置を最後に受信してからの秒数）が小さい方が新しい。欠落は既存を上書きしない。"""
    if new_seen is None:
        return False
    if old_seen is None:
        return True
    return new_seen < old_seen


def merge_payload(acc, payload):
    """acc（icao24 → (point, seen_pos)）へ1タイル分をマージする。タイルの円は重なるので重複は必ず出る。"""
    for a in _aircraft(payload):
        p = transform_aircraft(a)
        if p is None:
            continue
        seen = _num(a.get("seen_pos"))
        prev = acc.get(p["icao24"])
        if prev is None or _fresher(seen, prev[1]):
            acc[p["icao24"]] = (p, seen)


def points_from(acc):
    return [p for p, _ in acc.values()]


def fetch_tile(lat, lon, timeout=(10, 30)):
    """1タイル取得。timeout=(connect, read)。"""
    resp = requests.get(tile_url(lat, lon), timeout=timeout,
                        headers={"User-Agent": USER_AGENT})
    if resp.status_code == 429:
        raise RateLimited("429 Too Many Requests")
    resp.raise_for_status()
    return resp.json()


def collect_tiles(tiles=TILES, fetch=fetch_tile, sleep=time.sleep, clock=time.monotonic):
    """全タイルを 1req/s のペースで集める。→ (points, ok, total, rate_limited)

    タイル単位のリトライはしない。円が重なっているので1枚落ちても穴は小さく、
    再試行はその run の所要と先方への負荷を増やすだけになる。守りは
    「半分以上落ちたら書かない」（main）と「429 で即やめる」の2つで足りる。
    """
    acc, ok, limited, last = {}, 0, False, None
    for name, lat, lon in tiles:
        if last is not None:
            wait = PACE_S - (clock() - last)
            if wait > 0:
                sleep(wait)
        last = clock()
        try:
            merge_payload(acc, fetch(lat, lon))
            ok += 1
        except RateLimited as e:
            print("[flights] rate limited at tile %s: %s; stopping this run early" % (name, e))
            limited = True
            break
        except Exception as e:
            print("[flights] tile %s failed: %s" % (name, e))
    return points_from(acc), ok, len(tiles), limited


def downsample(points, max_points=MAX_POINTS):
    """件数が max を超えたら等間隔ストライドで間引く（純粋）。"""
    n = len(points)
    if n <= max_points:
        return points
    stride = (n + max_points - 1) // max_points
    return points[::stride]


def build_snapshot(points, updated_iso, tiles_ok=None, tiles_total=None):
    """snapshot は orbis-data 経由で単体でも配られるので、cite 義務を満たす出典を必ず載せる。"""
    snap = {
        "layer": "flights",
        "updated": updated_iso,
        "count": len(points),
        "source": SOURCE_NAME,
        "source_url": SOURCE_URL,
    }
    if tiles_ok is not None:
        snap["tiles_ok"] = tiles_ok
    if tiles_total is not None:
        snap["tiles_total"] = tiles_total
    snap["points"] = points
    return snap


def main():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    snap_path = os.path.join(SNAPSHOT_DIR, "flights.json")
    manifest_path = os.path.join(SNAPSHOT_DIR, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        points, ok, total, limited = collect_tiles()
    except Exception as e:
        print("[flights] collect failed: %s; keeping previous snapshot" % e)
        return 1

    # 半分以上のタイルが落ちた結果を書くと、地図から大陸が丸ごと消えたまま updated だけ新しくなり、
    # Layer2 鮮度モニタ（age ベース）にも引っかからない。書かずに前回を残す方が安全。
    need = math.ceil(total * MIN_OK_RATIO)
    if ok < need:
        print("[flights] only %d/%d tiles succeeded (need %d, rate_limited=%s); keeping previous snapshot"
              % (ok, total, need, limited))
        return 1
    if not points:
        print("[flights] %d/%d tiles succeeded but no aircraft; keeping previous snapshot" % (ok, total))
        return 1

    points = downsample(points)
    snap = build_snapshot(points, now_iso, tiles_ok=ok, tiles_total=total)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(manifest_path, "flights", now_iso, len(points))
    if ok < total:
        print("[flights] %d/%d tiles failed (rate_limited=%s)" % (total - ok, total, limited))
    print("[flights] wrote %d aircraft from %d/%d tiles -> %s" % (len(points), ok, total, snap_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
