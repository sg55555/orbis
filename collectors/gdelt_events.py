"""GDELT 2.0 Events CSV を取得し、抗議/紛争イベントを地理点として書き出す。"""
import csv
import io
import json
import os
import zipfile
from datetime import datetime, timezone
import requests
from collectors.lib.manifest import update_manifest

LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"
PROTEST_CODES = {"14"}
CONFLICT_CODES = {"18", "19", "20"}
MAX_PER_LAYER = 2000
WINDOW_HOURS = 24
# NumSources(r[32]) の下限。単一ソース(=1)の event は信頼性が低く、偽陽性が多い:
#   ・エンタメ/アニメの "fight" 等が CAMEO root 19(FIGHT) に誤分類される
#   ・他地域の記事が GDELT の誤ジオコーディングで無関係な都市(例: 東京)に置かれる
# 複数ソースで報じられた event だけ残す（実測: 日本の偽紛争はすべて単一ソースだった）。
MIN_SOURCES = 2
# 紛争(root 18/19/20)のみ AvgTone(r[34]) の上限。CAMEO の QuadClass/GoldsteinScale は
# EventCode から決まる決定値で誤コードを見抜けない（root 19 は常に QuadClass4/Goldstein≤-7）。
# 一方 AvgTone は記事群の感情で、実暴力は強い負値・司法/政治/エンタメの誤コードは中立寄り。
# 例「旧統一教会の解散命令確定」は多ソースで NumSources は通過するが中立トーンで除外できる。
# 抗議(root 14)は中立報道もあり過剰除外を避けるため tone 条件は課さない。
MAX_CONFLICT_TONE = -3.5


def parse_rows(rows):
    """GDELT export TSV 行（list[str]）→ 抗議/紛争イベント dict 配列（純粋）。
    NumSources < MIN_SOURCES（単一ソース）は偽陽性が多いため除外。
    紛争は AvgTone > MAX_CONFLICT_TONE（中立/正トーン＝非暴力ニュースの誤コード）も除外。"""
    out = []
    for r in rows:
        if len(r) < 61:
            continue
        root = r[28]
        if root not in PROTEST_CODES and root not in CONFLICT_CODES:
            continue
        lat, lon = r[56], r[57]
        if not lat or not lon:
            continue
        try:
            latf, lonf = float(lat), float(lon)
        except ValueError:
            continue
        try:
            mentions = int(r[31]) if r[31] else 0
        except ValueError:
            mentions = 0
        try:
            sources = int(r[32]) if r[32] else 0
        except ValueError:
            sources = 0
        if sources < MIN_SOURCES:
            continue  # 単一ソースの偽陽性（エンタメ誤分類・誤ジオコーディング）を除外
        try:
            tone = float(r[34]) if r[34] else 0.0
        except ValueError:
            tone = 0.0
        if root in CONFLICT_CODES and tone > MAX_CONFLICT_TONE:
            continue  # 中立/正トーンの紛争コード＝非暴力ニュース（司法/政治/エンタメ）の誤コードを除外
        out.append({
            "id": r[0], "root": root, "lon": lonf, "lat": latf,
            "place": r[53], "mentions": mentions, "sources": sources, "tone": r[34],
            "date": r[59], "url": r[60],
        })
    return out


def split_events(events):
    """(protests, conflict) に分割（純粋）。"""
    protests = [e for e in events if e["root"] in PROTEST_CODES]
    conflict = [e for e in events if e["root"] in CONFLICT_CODES]
    return protests, conflict


def _parse_date(s):
    try:
        return datetime.strptime(s, "%Y%m%d%H%M%S")
    except (ValueError, TypeError):
        return None


def merge_rolling(prev, new, now=None, window_hours=WINDOW_HOURS, cap=MAX_PER_LAYER):
    """前回＋新規を id で重複排除し、直近 window_hours 内に絞り、新しい順に cap 件（純粋）。"""
    now = now or datetime.utcnow()
    by_id = {}
    for e in prev + new:  # new が後勝ち
        by_id[e["id"]] = e
    cutoff = now.timestamp() - window_hours * 3600
    kept = []
    for e in by_id.values():
        d = _parse_date(e.get("date", ""))
        if d is None or d.timestamp() >= cutoff:
            kept.append(e)
    kept.sort(key=lambda e: e.get("date", ""), reverse=True)
    return kept[:cap]


SNAPSHOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "snapshots"))


def fetch_latest_rows(timeout=40):
    """lastupdate.txt → 最新 export.CSV.zip を取得し TSV 行配列を返す。"""
    lu = requests.get(LASTUPDATE_URL, timeout=timeout, headers={"User-Agent": "orbis-collector"})
    lu.raise_for_status()
    export_url = None
    for line in lu.text.splitlines():
        parts = line.split()
        if parts and parts[-1].endswith("export.CSV.zip"):
            export_url = parts[-1]
            break
    if not export_url:
        raise RuntimeError("no export.CSV.zip in lastupdate")
    z = requests.get(export_url, timeout=timeout, headers={"User-Agent": "orbis-collector"})
    z.raise_for_status()
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    raw = zf.read(zf.namelist()[0]).decode("latin-1")
    return list(csv.reader(io.StringIO(raw), delimiter="\t"))


def _load_prev(path):
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f).get("points", [])
        except Exception:
            return []
    return []


def _write(path, layer, points, now_iso, manifest_path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"layer": layer, "updated": now_iso, "count": len(points), "points": points},
                  f, ensure_ascii=False, separators=(",", ":"))
    update_manifest(manifest_path, layer, now_iso, len(points))


def main():
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    manifest_path = os.path.join(SNAPSHOT_DIR, "manifest.json")
    p_path = os.path.join(SNAPSHOT_DIR, "protests.json")
    c_path = os.path.join(SNAPSHOT_DIR, "conflict.json")
    now = datetime.now(timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        rows = fetch_latest_rows()
    except Exception as e:
        print(f"[gdelt] fetch failed: {e}; keeping previous snapshots")
        return 1
    protests_new, conflict_new = split_events(parse_rows(rows))
    protests = merge_rolling(_load_prev(p_path), protests_new, now=now.replace(tzinfo=None))
    conflict = merge_rolling(_load_prev(c_path), conflict_new, now=now.replace(tzinfo=None))
    _write(p_path, "protests", protests, now_iso, manifest_path)
    _write(c_path, "conflict", conflict, now_iso, manifest_path)
    print(f"[gdelt] protests={len(protests)} conflict={len(conflict)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
