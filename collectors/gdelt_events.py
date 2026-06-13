"""GDELT 2.0 Events CSV を取得し、抗議/紛争イベントを地理点として書き出す。"""
import csv
import io
import json
import os
import zipfile
from datetime import datetime, timezone

LASTUPDATE_URL = "http://data.gdeltproject.org/gdeltv2/lastupdate.txt"
PROTEST_CODES = {"14"}
CONFLICT_CODES = {"18", "19", "20"}
MAX_PER_LAYER = 2000
WINDOW_HOURS = 24


def parse_rows(rows):
    """GDELT export TSV 行（list[str]）→ 抗議/紛争イベント dict 配列（純粋）。"""
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
        out.append({
            "id": r[0], "root": root, "lon": lonf, "lat": latf,
            "place": r[53], "mentions": mentions, "tone": r[34],
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
