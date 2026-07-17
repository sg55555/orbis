"""OpenSky の全機 state vector を取得して data/snapshots/flights.json に書き出す。"""
import json
import os
import time
from datetime import datetime, timezone

import requests
from collectors.lib.manifest import update_manifest
from collectors.lib.http import retry

STATES_URL = "https://opensky-network.org/api/states/all"
MAX_POINTS = 6000
RETRY_WAIT_S = 5     # OpenSky への接続/読取の一時障害でのリトライ待機秒
DEFAULT_RETRY_ATTEMPTS = 3


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


def fetch(url=STATES_URL, timeout=(10, 30)):
    """OpenSky 全機 state を取得（匿名）。timeout=(connect, read)。"""
    resp = requests.get(url, timeout=timeout, headers={"User-Agent": "orbis-collector"})
    resp.raise_for_status()
    return resp.json()


def retry_attempts():
    """既定リトライ回数を環境変数 FLIGHTS_RETRY_ATTEMPTS から解決する（既定 3＝従来どおり）。

    2026-07-17 の監査は「GHA egress の ConnectTimeout は同一IPからの再試行では解けず
    リトライは構造的に無効」として既定1を提案したが、その根拠は**循環論法**だった：
    標本にした「直近24hの14サンプルが全て3回試行して全滅」は**失敗 run だけの標本**であり、
    attempt 2 で救われた run は success に分類されて標本に入らない。つまり
    **attempt 2 以降の成功率は測られていない**。加えて attempts を削ると
    lib/http.py の is_transient() が認める ReadTimeout / ConnectionError / 429 / 5xx の
    回復性まで一律に失う（retry() の存在理由は元々 Read timeout 側にある）。
    → 既定は安全側の 3 に据え置く。

    次の段：retry() の attempt 単位ログ（lib/http.py）を24h回して
    「attempt 2 以降の成功が本当にゼロか」を実測してから既定を見直すこと。
    遮断ウィンドウ中に空振りを減らしたい場合だけ、workflow の env に
    FLIGHTS_RETRY_ATTEMPTS=1 を明示的に差す（Python の変更は不要）。
    """
    try:
        return max(1, int(os.environ.get("FLIGHTS_RETRY_ATTEMPTS", DEFAULT_RETRY_ATTEMPTS)))
    except (TypeError, ValueError):
        return DEFAULT_RETRY_ATTEMPTS


def fetch_with_retry(attempts=None, wait=RETRY_WAIT_S, sleep=time.sleep, url=STATES_URL):
    """一時的エラー（接続/読取タイムアウト・接続断・5xx 等）で待機リトライ。
    attempts 未指定なら retry_attempts()（env 既定 1）。sleep はテスト用に注入可。"""
    n = retry_attempts() if attempts is None else attempts
    return retry(lambda: fetch(url), attempts=n, wait=wait, sleep=sleep)


def main():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    snap_path = os.path.join(SNAPSHOT_DIR, "flights.json")
    manifest_path = os.path.join(SNAPSHOT_DIR, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        points = downsample(transform(fetch_with_retry()))
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
