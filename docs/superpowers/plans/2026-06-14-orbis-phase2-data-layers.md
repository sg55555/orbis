# ORBIS Phase 2（データレイヤー）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の地球儀（地震レイヤー）に、認証不要で取得できる4レイヤー（✈️航空・🔥紛争・✊抗議・📦貿易ルート）を追加し、レジストリ駆動の凡例で全レイヤーを表示する。

**Architecture:** Phase 1 と同じスナップショット方式。Python collectors（GitHub Actions cron `*/15`）が OpenSky（航空）と GDELT v2 Events CSV（紛争/抗議）を取得して `data/snapshots/*.json` を書く。貿易ルートは静的 GeoJSON。フロントは統一レイヤーI/F `{id,label,fetch,toDeckLayer,legend}` に各レイヤーを追加し、`registry.buildDeckLayers` を「1レイヤーが複数 deck レイヤーを返せる」よう拡張。航空は deck.gl IconLayer で進行方向に回転（`sizeUnits:'meters'`＋ピクセルクランプでズーム連動）。

**Tech Stack:** Vanilla JS(ESM, no build) / MapLibre GL + deck.gl(CDN) / Python3(requests) / pytest / node:test / Playwright / GitHub Actions.

**前提（ライブ検証済み 2026-06-14）:**
- OpenSky `/api/states/all` は匿名で200/JSON。state vector index: 0=icao24,1=callsign,5=lon,6=lat,7=baro_alt,8=on_ground,9=velocity,10=true_track。
- GDELT GEO API は廃止(404)。`http://data.gdeltproject.org/gdeltv2/lastupdate.txt` → `*.export.CSV.zip`(15分毎)。TSV 61列。index: 0=GlobalEventID,28=EventRootCode,31=NumMentions,34=AvgTone,53=ActionGeo_FullName,56=ActionGeo_Lat,57=ActionGeo_Long,59=DATEADDED,60=SOURCEURL。rootcode 14=抗議 / 18,19,20=紛争。

---

## ファイル構成（Phase 2 で作成/変更）

```
collectors/
  flights.py        # OpenSky → flights.json（純粋: transform/downsample）
  gdelt_events.py   # GDELT CSV → protests.json + conflict.json（純粋: parse/filter/merge）
js/
  lib/geo.js        # 追記: iconAngle(heading), eventRadius(mentions)
  layers/
    flights.js      # IconLayer（進行方向矢印・ズーム連動）
    conflict.js     # ScatterplotLayer（赤）
    protests.js     # ScatterplotLayer（緑）
    trade.js        # PathLayer(航路) + ScatterplotLayer(要衝)
    registry.js     # 変更: 配列返却を flat 化、4レイヤー登録
  main.js           # 変更: 4レイヤーのポーリング/静的ロード、registry駆動の凡例
data/static/trade_routes.geojson   # 手作成（主要航路+要衝）
.github/workflows/collect.yml      # 変更: flights+gdelt 追加、cron */15
tests/
  test_flights.py / test_gdelt.py
  flights.test.js / conflict.test.js / protests.test.js / trade.test.js / registry.test.js / geo2.test.js
  e2e/smoke.spec.js  # 変更: 複数レイヤー描画を検証
```

**疎結合の原則（Phase 1 と同じ）:** 1ソース=1収集器=1スナップショット=1レイヤーモジュール。純粋変換部を分離して node:test/pytest。各収集器は失敗時に前回スナップショットを温存。本番配信 JSON は git 追跡（gitignore 禁止）。e2e は読み取りのみ。

---

### Task 1: レジストリの複数レイヤー対応（node:test TDD）

**Files:**
- Modify: `js/layers/registry.js`
- Test: `tests/registry.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/registry.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckLayers } from '../js/layers/registry.js';

// 偽レイヤー：単体を返すものと配列を返すものを混在
const single = { id: 'a', toDeckLayer: (snap) => ({ kind: 'one', v: snap.v }) };
const multi = { id: 'b', toDeckLayer: (snap) => [{ kind: 'p' }, { kind: 'q' }] };

test('buildDeckLayers flattens single and array results, only enabled+present', () => {
  const enabled = new Set(['a', 'b']);
  const snaps = { a: { v: 1 }, b: {} };
  const out = buildDeckLayers(enabled, snaps, [single, multi]);
  assert.deepEqual(out, [{ kind: 'one', v: 1 }, { kind: 'p' }, { kind: 'q' }]);
});

test('buildDeckLayers skips disabled and missing-snapshot layers', () => {
  const out = buildDeckLayers(new Set(['a']), {}, [single, multi]); // a enabled but no snapshot
  assert.deepEqual(out, []);
});
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/registry.test.js`
Expected: FAIL（`buildDeckLayers` の第3引数 layersOverride 未対応／flat 化していない）

- [ ] **Step 3: 実装** — `js/layers/registry.js` を以下に置換（quakes 登録は維持、import は Task 8/9/10/11 で追加する。まずは flat 化と layersOverride 引数）
```javascript
// レイヤーの登録と一括描画。Phase 2+ はここに import を足すだけで拡張できる。
import { quakesLayer } from './quakes.js';

export const layers = [quakesLayer];

export function getLayer(id) {
  return layers.find((l) => l.id === id);
}

// 有効レイヤーの deck レイヤー配列を組み立てる。
// toDeckLayer は単体または配列を返してよい（配列は flat 化）。
// layersOverride: テスト用に layers を差し替え可能。
export function buildDeckLayers(enabled, snapshots, layersOverride) {
  const ls = layersOverride || layers;
  return ls
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .flatMap((l) => {
      const r = l.toDeckLayer(snapshots[l.id]);
      return Array.isArray(r) ? r : [r];
    });
}
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/registry.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: 既存JSテストの回帰確認**
Run: `cd ~/apps/orbis && node --test tests/*.test.js`
Expected: 既存（geo/quakes）＋registry すべて PASS

- [ ] **Step 6: Commit**
```bash
cd ~/apps/orbis
git add js/layers/registry.js tests/registry.test.js
git commit -m "feat: registry supports layers returning multiple deck layers"
```

---

### Task 2: geo.js に航空角度・イベント半径ヘルパ追加（node:test TDD）

**Files:**
- Modify: `js/lib/geo.js`
- Test: `tests/geo2.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/geo2.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iconAngle, eventRadius } from '../js/lib/geo.js';

test('iconAngle converts compass heading to deck CCW icon angle', () => {
  assert.equal(iconAngle(0), 0);     // 北向き
  assert.equal(iconAngle(90), 270);  // 東向き = CCW 270
  assert.equal(iconAngle(180), 180);
  assert.equal(iconAngle(360), 0);
  assert.equal(iconAngle(null), 0);  // 欠損は0
});

test('eventRadius grows with mentions and is clamped', () => {
  assert.equal(eventRadius(0), 5);
  assert.equal(eventRadius(undefined), 5);
  assert.equal(eventRadius(100), 15);   // 5 + sqrt(100)=15
  assert.equal(eventRadius(10000), 18); // clamp 18
});
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/geo2.test.js`
Expected: FAIL（`iconAngle`/`eventRadius` 未定義）

- [ ] **Step 3: 実装** — `js/lib/geo.js` の末尾に追記
```javascript
// 方位（北0°時計回り）を deck.gl IconLayer の角度（反時計回り）へ変換。
export function iconAngle(headingDeg) {
  const h = Number(headingDeg) || 0;
  return ((360 - (h % 360)) % 360);
}

// イベントの言及数から描画半径(px)。floor 5, 上限 18。
export function eventRadius(mentions) {
  const m = Number(mentions) || 0;
  return Math.min(18, Math.round(5 + Math.sqrt(m)));
}
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/geo2.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**
```bash
cd ~/apps/orbis
git add js/lib/geo.js tests/geo2.test.js
git commit -m "feat: geo helpers iconAngle + eventRadius"
```

---

### Task 3: 航空データ変換（Python・純粋関数 TDD）

**Files:**
- Create: `collectors/flights.py`
- Test: `tests/test_flights.py`

- [ ] **Step 1: 失敗するテストを書く** — `tests/test_flights.py`
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.flights import transform, downsample, build_snapshot

# OpenSky states: [icao24,callsign,country,tpos,lastcontact,lon,lat,baro_alt,on_ground,vel,track,...]
SAMPLE = {"time": 1781368722, "states": [
    ["abc123", "ANA221  ", "Japan", 1, 1, 139.7, 35.6, 10000.0, False, 250.0, 90.0, 0,0,0,0,0,0],
    ["def456", "JAL10   ", "Japan", 1, 1, None, 35.0, 9000.0, False, 200.0, 45.0, 0,0,0,0,0,0],  # lon None → 除外
]}

def test_transform_maps_and_filters():
    pts = transform(SAMPLE)
    assert len(pts) == 1
    p = pts[0]
    assert p["icao24"] == "abc123"
    assert p["callsign"] == "ANA221"   # strip 済み
    assert p["lon"] == 139.7 and p["lat"] == 35.6
    assert p["alt"] == 10000.0 and p["on_ground"] is False
    assert p["velocity"] == 250.0 and p["heading"] == 90.0

def test_downsample_caps_count():
    pts = [{"icao24": str(i), "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10
    assert out[0]["icao24"] == "0"  # stride sampling は先頭を含む

def test_build_snapshot_shape():
    snap = build_snapshot([{"icao24": "a"}], "2026-06-14T00:00:00Z")
    assert snap["layer"] == "flights" and snap["count"] == 1 and snap["updated"].endswith("Z")
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_flights.py -v`
Expected: FAIL（ModuleNotFoundError: collectors.flights）

- [ ] **Step 3: 実装** — `collectors/flights.py`
```python
"""OpenSky の全機 state vector を取得して data/snapshots/flights.json に書き出す。"""
import json
import os
from datetime import datetime, timezone

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
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_flights.py -v`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**
```bash
cd ~/apps/orbis
git add collectors/flights.py tests/test_flights.py
git commit -m "feat: OpenSky flights transform + downsample (pure)"
```

---

### Task 4: 航空 収集CLI（取得＋書き出し）

**Files:**
- Modify: `collectors/flights.py`（fetch + main を追加）

- [ ] **Step 1: 実装を追記** — `collectors/flights.py` 末尾
```python
import requests
from collectors.lib.manifest import update_manifest

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
    except Exception as e:  # 429/ネットワーク失敗時は前回スナップショットを温存
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
```
（`json.dump` は `separators=(",",":")` で容量圧縮。`import requests` 等は先頭に移動してもよい。）

- [ ] **Step 2: 実データで1回実行して初期スナップショット生成（ネットワーク）**
Run: `cd ~/apps/orbis && python3 -m collectors.flights`
Expected: `[flights] wrote N points -> .../flights.json`（N>0）。429 等で失敗した場合は数十秒おいて再試行。どうしても取得できなければ DONE_WITH_CONCERNS で報告（後続 e2e のため flights.json が必要）。

- [ ] **Step 3: 既存テスト回帰**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_flights.py -v`
Expected: PASS（fetch/main 追加で既存も維持）

- [ ] **Step 4: Commit（生成スナップショットも追跡）**
```bash
cd ~/apps/orbis
git add collectors/flights.py data/snapshots/flights.json data/snapshots/manifest.json
git commit -m "feat: flights collector writes snapshot"
```

---

### Task 5: GDELT イベント parse + filter（Python TDD）

**Files:**
- Create: `collectors/gdelt_events.py`
- Test: `tests/test_gdelt.py`

- [ ] **Step 1: 失敗するテストを書く** — `tests/test_gdelt.py`
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.gdelt_events import parse_rows, split_events

def make_row(eid, root, lat, lon, mentions="3", url="http://x"):
    r = [""] * 61
    r[0] = eid; r[28] = root; r[31] = mentions; r[34] = "-2.5"
    r[53] = "Tokyo, Japan"; r[56] = lat; r[57] = lon; r[59] = "20260614120000"; r[60] = url
    return r

def test_parse_rows_filters_invalid_and_maps():
    rows = [
        make_row("1", "14", "35.6", "139.7"),       # protest, ok
        make_row("2", "19", "48.8", "2.3"),         # conflict, ok
        make_row("3", "01", "10.0", "10.0"),        # 対象外 rootcode → 除外
        make_row("4", "14", "", ""),                # 座標なし → 除外
        ["short"],                                  # 列不足 → 除外
    ]
    evs = parse_rows(rows)
    ids = sorted(e["id"] for e in evs)
    assert ids == ["1", "2"]
    e = next(e for e in evs if e["id"] == "1")
    assert e["root"] == "14" and e["lon"] == 139.7 and e["lat"] == 35.6
    assert e["place"] == "Tokyo, Japan" and e["mentions"] == 3 and e["url"] == "http://x"
    assert e["date"] == "20260614120000"

def test_split_events_by_category():
    evs = parse_rows([make_row("1", "14", "1", "1"), make_row("2", "18", "2", "2"),
                      make_row("3", "20", "3", "3")])
    protests, conflict = split_events(evs)
    assert [e["id"] for e in protests] == ["1"]
    assert sorted(e["id"] for e in conflict) == ["2", "3"]
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_gdelt.py -v`
Expected: FAIL（ModuleNotFoundError: collectors.gdelt_events）

- [ ] **Step 3: 実装** — `collectors/gdelt_events.py`
```python
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
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_gdelt.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**
```bash
cd ~/apps/orbis
git add collectors/gdelt_events.py tests/test_gdelt.py
git commit -m "feat: GDELT events parse + split (pure)"
```

---

### Task 6: GDELT ローリングマージ（24h・重複排除・cap）（Python TDD）

**Files:**
- Modify: `collectors/gdelt_events.py`（merge_rolling 追加）
- Test: `tests/test_gdelt.py`（追記）

- [ ] **Step 1: 失敗するテストを追記** — `tests/test_gdelt.py` 末尾
```python
from collectors.gdelt_events import merge_rolling

def test_merge_rolling_dedupes_windows_and_caps():
    now = datetime(2026, 6, 14, 12, 0, 0)
    prev = [{"id": "old", "date": "20260612120000", "lon": 0, "lat": 0},   # 48h前 → 窓外で除外
            {"id": "keep", "date": "20260614000000", "lon": 1, "lat": 1}]  # 12h前 → 残る
    new = [{"id": "keep", "date": "20260614010000", "lon": 1, "lat": 1},   # 重複id → 1件
           {"id": "fresh", "date": "20260614110000", "lon": 2, "lat": 2}]
    merged = merge_rolling(prev, new, now=now, window_hours=24, cap=10)
    ids = sorted(e["id"] for e in merged)
    assert ids == ["fresh", "keep"]  # old は窓外、keep は重複排除

def test_merge_rolling_caps_to_newest():
    now = datetime(2026, 6, 14, 12, 0, 0)
    new = [{"id": str(i), "date": f"202606141{i:01d}0000", "lon": 0, "lat": 0} for i in range(5)]
    merged = merge_rolling([], new, now=now, window_hours=24, cap=3)
    assert len(merged) == 3
    assert merged[0]["id"] == "4"  # 新しい順
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_gdelt.py -v`
Expected: FAIL（merge_rolling 未定義）

- [ ] **Step 3: 実装** — `collectors/gdelt_events.py` に追記
```python
def _parse_date(s):
    try:
        return datetime.strptime(s, "%Y%m%d%H%M%S")
    except (ValueError, TypeError):
        return None


def merge_rolling(prev, new, now=None, window_hours=WINDOW_HOURS, cap=MAX_PER_LAYER):
    """前回＋新規を id で重複排除し、直近 window_hours 内に絞り、新しい順に cap 件（純粋）。"""
    now = now or datetime.utcnow()
    by_id = {}
    for e in prev + new:  # new が後勝ち（最新の言及数等を反映）
        by_id[e["id"]] = e
    cutoff = now.timestamp() - window_hours * 3600
    kept = []
    for e in by_id.values():
        d = _parse_date(e.get("date", ""))
        if d is None or d.timestamp() >= cutoff:
            kept.append(e)
    kept.sort(key=lambda e: e.get("date", ""), reverse=True)
    return kept[:cap]
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_gdelt.py -v`
Expected: PASS（4 件）

- [ ] **Step 5: Commit**
```bash
cd ~/apps/orbis
git add collectors/gdelt_events.py tests/test_gdelt.py
git commit -m "feat: GDELT rolling merge (24h window, dedupe, cap)"
```

---

### Task 7: GDELT 収集CLI（lastupdate→zip→protests/conflict 書き出し）

**Files:**
- Modify: `collectors/gdelt_events.py`（fetch_latest + main 追加）

- [ ] **Step 1: 実装を追記** — `collectors/gdelt_events.py` 末尾
```python
import requests

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
    from collectors.lib.manifest import update_manifest as _um
    globals()["update_manifest"] = _um
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
```
注: `_write` は `update_manifest` を使う。ファイル先頭に `from collectors.lib.manifest import update_manifest` を置く構成でよい（main 内の再代入トリックは不要なら削除可）。シンプルに**先頭で import** してよい。

- [ ] **Step 2: 実データで1回実行**
Run: `cd ~/apps/orbis && python3 -m collectors.gdelt_events`
Expected: `[gdelt] protests=N conflict=M`。`protests.json`/`conflict.json`/`manifest.json` 生成。（1バッチで0件のこともあるが、その場合でもファイルは作られる。可能なら数バッチ分溜めるため2回実行してもよい。）

- [ ] **Step 3: テスト回帰**
Run: `cd ~/apps/orbis && python3 -m pytest tests/test_gdelt.py -v`
Expected: PASS（4 件）

- [ ] **Step 4: Commit（生成スナップショット追跡）**
```bash
cd ~/apps/orbis
git add collectors/gdelt_events.py data/snapshots/protests.json data/snapshots/conflict.json data/snapshots/manifest.json
git commit -m "feat: GDELT collector writes protests + conflict snapshots"
```

---

### Task 8: 航空レイヤーモジュール（node:test TDD）

**Files:**
- Create: `js/layers/flights.js`
- Modify: `js/layers/registry.js`（flights 登録）
- Test: `tests/flights.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/flights.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIconConfig } from '../js/layers/flights.js';

const SNAP = { layer: 'flights', points: [{ icao24: 'a', callsign: 'ANA1', lon: 139.7, lat: 35.6, heading: 90 }] };

test('buildIconConfig builds zoom-aware rotated icon props', () => {
  const cfg = buildIconConfig(SNAP);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.sizeUnits, 'meters');     // ズーム連動
  assert.ok(cfg.sizeMinPixels >= 3 && cfg.sizeMaxPixels <= 40);
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [139.7, 35.6]);
  assert.equal(cfg.getAngle(p), 270);        // iconAngle(90)
  assert.deepEqual(cfg.getColor(p), [57, 208, 255, 220]);
});

test('buildIconConfig tolerates empty', () => {
  assert.deepEqual(buildIconConfig({ points: [] }).data, []);
});
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/flights.test.js`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 実装** — `js/layers/flights.js`
```javascript
// 航空レイヤー。IconLayer で進行方向に回転、sizeUnits:'meters'+ピクセルクランプでズーム連動。
import { iconAngle } from '../lib/geo.js';

// 北向きの三角（機影）SVG を data URI に。mask:true で getColor 着色。
const ARROW_SVG = 'data:image/svg+xml;base64,' + btoaSafe(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<polygon points="32,4 52,60 32,46 12,60" fill="white"/></svg>'
);
function btoaSafe(s) {
  // Node(テスト)とブラウザ双方で動く base64 変換
  return (typeof btoa !== 'undefined') ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

export function buildIconConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'flights',
    data,
    getIcon: () => ({ url: ARROW_SVG, width: 64, height: 64, mask: true, anchorX: 32, anchorY: 32 }),
    sizeUnits: 'meters',
    getSize: () => 40000,
    sizeMinPixels: 4,
    sizeMaxPixels: 30,
    billboard: true,
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getAngle: (p) => iconAngle(p.heading),
    getColor: () => [57, 208, 255, 220],
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  legend: [{ color: 'rgb(57,208,255)', label: '航空機（向き=進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot) { return new deck.IconLayer(buildIconConfig(snapshot)); },
};
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/flights.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: registry に登録** — `js/layers/registry.js` を編集
```javascript
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';

export const layers = [quakesLayer, flightsLayer];
```
（`buildDeckLayers`/`getLayer` は変更不要）

- [ ] **Step 6: 全JSテスト回帰**
Run: `cd ~/apps/orbis && node --test tests/*.test.js`
Expected: 全 PASS

- [ ] **Step 7: Commit**
```bash
cd ~/apps/orbis
git add js/layers/flights.js js/layers/registry.js tests/flights.test.js
git commit -m "feat: flights layer (heading-rotated zoom-aware icons)"
```

---

### Task 9: 紛争レイヤーモジュール（node:test TDD）

**Files:**
- Create: `js/layers/conflict.js`
- Modify: `js/layers/registry.js`
- Test: `tests/conflict.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/conflict.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConflictConfig } from '../js/layers/conflict.js';

const SNAP = { layer: 'conflict', points: [{ id: '1', lon: 2.3, lat: 48.8, mentions: 100, place: 'Paris' }] };

test('buildConflictConfig builds red scatter with mention-based radius', () => {
  const cfg = buildConflictConfig(SNAP);
  assert.equal(cfg.id, 'conflict');
  assert.equal(cfg.radiusUnits, 'pixels');
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [2.3, 48.8]);
  assert.equal(cfg.getRadius(p), 15);                 // eventRadius(100)
  assert.deepEqual(cfg.getFillColor(p), [255, 60, 80, 200]);
});

test('empty tolerated', () => {
  assert.deepEqual(buildConflictConfig({ points: [] }).data, []);
});
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/conflict.test.js`
Expected: FAIL

- [ ] **Step 3: 実装** — `js/layers/conflict.js`
```javascript
// 紛争レイヤー（赤）。言及数で半径。
import { eventRadius } from '../lib/geo.js';

export function buildConflictConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'conflict',
    data,
    radiusUnits: 'pixels',
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => eventRadius(p.mentions),
    getFillColor: () => [255, 60, 80, 200],
  };
}

export const conflictLayer = {
  id: 'conflict',
  label: '紛争',
  legend: [{ color: 'rgb(255,60,80)', label: '紛争イベント（GDELT・24h）' }],
  async fetch(getSnapshot) { return getSnapshot('conflict'); },
  toDeckLayer(snapshot) { return new deck.ScatterplotLayer(buildConflictConfig(snapshot)); },
};
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/conflict.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: registry に登録** — `js/layers/registry.js`
```javascript
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';
import { conflictLayer } from './conflict.js';

export const layers = [quakesLayer, flightsLayer, conflictLayer];
```

- [ ] **Step 6: Commit**
```bash
cd ~/apps/orbis
git add js/layers/conflict.js js/layers/registry.js tests/conflict.test.js
git commit -m "feat: conflict layer (GDELT red scatter)"
```

---

### Task 10: 抗議レイヤーモジュール（node:test TDD）

**Files:**
- Create: `js/layers/protests.js`
- Modify: `js/layers/registry.js`
- Test: `tests/protests.test.js`

- [ ] **Step 1: 失敗するテストを書く** — `tests/protests.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProtestsConfig } from '../js/layers/protests.js';

const SNAP = { layer: 'protests', points: [{ id: '1', lon: -0.1, lat: 51.5, mentions: 0, place: 'London' }] };

test('buildProtestsConfig builds green scatter', () => {
  const cfg = buildProtestsConfig(SNAP);
  assert.equal(cfg.id, 'protests');
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [-0.1, 51.5]);
  assert.equal(cfg.getRadius(p), 5);                  // eventRadius(0)
  assert.deepEqual(cfg.getFillColor(p), [94, 255, 166, 200]);
});

test('empty tolerated', () => {
  assert.deepEqual(buildProtestsConfig({ points: [] }).data, []);
});
```

- [ ] **Step 2: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/protests.test.js`
Expected: FAIL

- [ ] **Step 3: 実装** — `js/layers/protests.js`
```javascript
// 抗議レイヤー（緑）。言及数で半径。
import { eventRadius } from '../lib/geo.js';

export function buildProtestsConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'protests',
    data,
    radiusUnits: 'pixels',
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => eventRadius(p.mentions),
    getFillColor: () => [94, 255, 166, 200],
  };
}

export const protestsLayer = {
  id: 'protests',
  label: '抗議',
  legend: [{ color: 'rgb(94,255,166)', label: '抗議イベント（GDELT・24h）' }],
  async fetch(getSnapshot) { return getSnapshot('protests'); },
  toDeckLayer(snapshot) { return new deck.ScatterplotLayer(buildProtestsConfig(snapshot)); },
};
```

- [ ] **Step 4: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/protests.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: registry に登録** — `js/layers/registry.js`
```javascript
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';
import { conflictLayer } from './conflict.js';
import { protestsLayer } from './protests.js';

export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer];
```

- [ ] **Step 6: Commit**
```bash
cd ~/apps/orbis
git add js/layers/protests.js js/layers/registry.js tests/protests.test.js
git commit -m "feat: protests layer (GDELT green scatter)"
```

---

### Task 11: 貿易ルート 静的データ＋レイヤー（node:test TDD）

**Files:**
- Create: `data/static/trade_routes.geojson`, `js/layers/trade.js`
- Modify: `js/layers/registry.js`
- Test: `tests/trade.test.js`

- [ ] **Step 1: 静的 GeoJSON を作成** — `data/static/trade_routes.geojson`
```json
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { "name": "Trans-Pacific" }, "geometry": { "type": "LineString", "coordinates": [[121.5,31.2],[139.7,35.0],[180,40],[-122.4,37.8]] } },
    { "type": "Feature", "properties": { "name": "Asia-Europe (Suez)" }, "geometry": { "type": "LineString", "coordinates": [[103.8,1.3],[80,6],[43,12.5],[32.5,29.9],[14,40],[-5,36],[4,51]] } },
    { "type": "Feature", "properties": { "name": "Trans-Atlantic" }, "geometry": { "type": "LineString", "coordinates": [[-74,40.7],[-40,45],[-9,38.7],[4,51]] } },
    { "type": "Feature", "properties": { "name": "Panama-Asia" }, "geometry": { "type": "LineString", "coordinates": [[-79.5,9],[-110,15],[-160,20],[121.5,31.2]] } },
    { "type": "Feature", "properties": { "name": "Persian Gulf-Asia" }, "geometry": { "type": "LineString", "coordinates": [[56.3,26.6],[68,18],[80,6],[103.8,1.3]] } },
    { "type": "Feature", "properties": { "name": "Australia-Asia" }, "geometry": { "type": "LineString", "coordinates": [[151.2,-33.9],[130,-10],[118,5],[103.8,1.3]] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Suez" }, "geometry": { "type": "Point", "coordinates": [32.55,29.97] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Hormuz" }, "geometry": { "type": "Point", "coordinates": [56.3,26.57] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Malacca" }, "geometry": { "type": "Point", "coordinates": [100.3,2.5] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Panama" }, "geometry": { "type": "Point", "coordinates": [-79.52,9.08] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Bab-el-Mandeb" }, "geometry": { "type": "Point", "coordinates": [43.33,12.58] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Bosphorus" }, "geometry": { "type": "Point", "coordinates": [29.0,41.1] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Gibraltar" }, "geometry": { "type": "Point", "coordinates": [-5.35,36.0] } },
    { "type": "Feature", "properties": { "name": "chokepoint", "label": "Dover" }, "geometry": { "type": "Point", "coordinates": [1.4,51.0] } }
  ]
}
```

- [ ] **Step 2: 失敗するテストを書く** — `tests/trade.test.js`
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTradeConfigs } from '../js/layers/trade.js';

const GEO = {
  type: 'FeatureCollection',
  features: [
    { properties: { name: 'R1' }, geometry: { type: 'LineString', coordinates: [[0, 0], [10, 10]] } },
    { properties: { name: 'chokepoint', label: 'X' }, geometry: { type: 'Point', coordinates: [5, 5] } },
  ],
};

test('buildTradeConfigs splits lines vs points into two configs', () => {
  const { pathConfig, pointConfig } = buildTradeConfigs(GEO);
  assert.equal(pathConfig.id, 'trade-routes');
  assert.equal(pathConfig.data.length, 1);
  assert.deepEqual(pathConfig.getPath(pathConfig.data[0]), [[0, 0], [10, 10]]);
  assert.equal(pointConfig.id, 'trade-chokepoints');
  assert.equal(pointConfig.data.length, 1);
  assert.deepEqual(pointConfig.getPosition(pointConfig.data[0]), [5, 5]);
});

test('tolerates missing features', () => {
  const { pathConfig, pointConfig } = buildTradeConfigs({});
  assert.deepEqual(pathConfig.data, []);
  assert.deepEqual(pointConfig.data, []);
});
```

- [ ] **Step 3: 失敗を確認**
Run: `cd ~/apps/orbis && node --test tests/trade.test.js`
Expected: FAIL

- [ ] **Step 4: 実装** — `js/layers/trade.js`
```javascript
// 貿易ルートレイヤー。航路(LineString)=PathLayer、要衝(Point)=ScatterplotLayer。
// toDeckLayer は配列を返す（registry が flat 化）。

export function buildTradeConfigs(geojson) {
  const features = (geojson && geojson.features) ? geojson.features : [];
  const lines = features.filter((f) => f.geometry && f.geometry.type === 'LineString');
  const points = features.filter((f) => f.geometry && f.geometry.type === 'Point');
  return {
    pathConfig: {
      id: 'trade-routes',
      data: lines,
      getPath: (f) => f.geometry.coordinates,
      getColor: [70, 230, 255, 90],
      widthUnits: 'pixels',
      getWidth: 1.5,
      widthMinPixels: 1,
      jointRounded: true,
    },
    pointConfig: {
      id: 'trade-chokepoints',
      data: points,
      radiusUnits: 'pixels',
      pickable: true,
      getPosition: (f) => f.geometry.coordinates,
      getRadius: 6,
      getFillColor: [255, 176, 40, 230],
    },
  };
}

export const tradeLayer = {
  id: 'trade',
  label: '貿易ルート',
  legend: [
    { color: 'rgb(70,230,255)', label: '主要航路' },
    { color: 'rgb(255,176,40)', label: '要衝（チョークポイント）' },
  ],
  async fetch() {
    const res = await fetch('data/static/trade_routes.geojson');
    return res.json();
  },
  toDeckLayer(geojson) {
    const { pathConfig, pointConfig } = buildTradeConfigs(geojson);
    return [new deck.PathLayer(pathConfig), new deck.ScatterplotLayer(pointConfig)];
  },
};
```

- [ ] **Step 5: 通過を確認**
Run: `cd ~/apps/orbis && node --test tests/trade.test.js`
Expected: PASS（2 件）

- [ ] **Step 6: registry に登録** — `js/layers/registry.js`
```javascript
import { quakesLayer } from './quakes.js';
import { flightsLayer } from './flights.js';
import { conflictLayer } from './conflict.js';
import { protestsLayer } from './protests.js';
import { tradeLayer } from './trade.js';

export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer, tradeLayer];
```

- [ ] **Step 7: Commit**
```bash
cd ~/apps/orbis
git add data/static/trade_routes.geojson js/layers/trade.js js/layers/registry.js tests/trade.test.js
git commit -m "feat: trade routes layer (static GeoJSON: lanes + chokepoints)"
```

---

### Task 12: main.js を全レイヤー対応に（統合）

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: `js/main.js` を以下に置換**
```javascript
import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers } from './layers/registry.js';
import { startPolling, fetchManifest, fetchSnapshot } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';

const POLL_MS = 60000;
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests']; // スナップショットを持つ層
const ENABLED = new Set(['quakes', 'flights', 'conflict', 'protests', 'trade']);

const snapshots = {};        // id -> snapshot（trade は静的、その他はポーリングで更新）

function renderLegend() {
  const rows = document.getElementById('legend-rows');
  rows.innerHTML = layers.map((l) => {
    const items = (l.legend || []).map(
      (e) => `<div class="row"><span class="dot" style="color:${e.color};background:${e.color}"></span>${e.label}</div>`
    ).join('');
    return `<div class="legend-group"><div class="legend-title">${l.label}</div>${items}</div>`;
  }).join('');
}

async function updateFreshness() {
  try {
    const m = await fetchManifest();
    const q = m.layers && m.layers.quakes;
    const f = m.layers && m.layers.flights;
    const parts = [];
    if (q) parts.push(`地震 ${q.count}（${formatFreshness(q.updated)}）`);
    if (f) parts.push(`航空 ${f.count}`);
    document.getElementById('freshness').textContent = parts.length ? parts.join(' / ') : 'データ取得中…';
  } catch { /* noop */ }
}

function rebuild(overlay) {
  setDeckLayers(overlay, buildDeckLayers(ENABLED, snapshots));
  window.__orbis.counts = Object.fromEntries(
    Object.entries(snapshots).map(([k, v]) => [k, (v && (v.points?.length ?? v.features?.length)) ?? 0])
  );
}

function boot() {
  const { map, overlay } = initMap('map');
  renderLegend();
  window.__orbis = { map, overlay, counts: {} };

  map.on('load', async () => {
    document.getElementById('loading').classList.add('hidden');

    // 静的な貿易ルートを一度だけ読み込む
    try { snapshots.trade = await fetchSnapshot('../static/trade_routes'); } catch { /* noop */ }

    startPolling(POLL_LAYERS, POLL_MS, (polled) => {
      Object.assign(snapshots, polled);
      rebuild(overlay);
      updateFreshness();
    });
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
```
注意: `fetchSnapshot('../static/trade_routes')` は `data/snapshots/../static/trade_routes.json` を指してしまう。**trade は別パス**なので、`js/snapshot.js` に汎用 `fetchJson(path)` を足すか、ここで直接 `fetch('data/static/trade_routes.geojson')` する。**この Step では trade レイヤーの `fetch()` 実装（Task 11）を使い**、以下に修正：
```javascript
    // 静的な貿易ルート（trade レイヤー自身の fetch を使用）
    try {
      const trade = layers.find((l) => l.id === 'trade');
      snapshots.trade = await trade.fetch();
    } catch { /* noop */ }
```
（`trade.fetch()` は内部で `data/static/trade_routes.geojson` を読む。`fetchSnapshot` インポートは不要なら削除。）

- [ ] **Step 2: CSS に凡例グループの見た目を追加** — `css/orbis.css` 末尾に追記
```css
.legend-group { margin-bottom: 8px; }
.legend-title { font-size: 10px; letter-spacing: .06em; color: var(--cyan); margin: 4px 0 2px; }
#legend { max-height: 46vh; overflow-y: auto; }
```

- [ ] **Step 3: ローカル配信で主要アセットが 200 か確認（ヘッドレス不可なので HTTP のみ）**
```bash
cd ~/apps/orbis
python3 -m http.server 8000 >/tmp/orbis_http.log 2>&1 &
SRV=$!; sleep 1
for p in / js/main.js data/snapshots/flights.json data/snapshots/conflict.json data/snapshots/protests.json data/static/trade_routes.geojson; do
  curl -s -o /dev/null -w "$p %{http_code}\n" "http://localhost:8000/$p"
done
kill $SRV
```
Expected: すべて 200。

- [ ] **Step 4: Commit**
```bash
cd ~/apps/orbis
git add js/main.js css/orbis.css
git commit -m "feat: render all layers + registry-driven legend"
```

---

### Task 13: 収集ワークフロー拡張（flights + gdelt、cron */15）

**Files:**
- Modify: `.github/workflows/collect.yml`

- [ ] **Step 1: `.github/workflows/collect.yml` を更新** — cron と steps を変更
```yaml
name: collect
on:
  schedule:
    - cron: '*/15 * * * *'   # 15分毎（OpenSky匿名クレジット安全域＋GDELT更新間隔）
  workflow_dispatch: {}
permissions:
  contents: write
concurrency:
  group: collect
  cancel-in-progress: false
jobs:
  collect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-python@v6
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - name: Collect quakes
        run: python -m collectors.quakes
      - name: Collect flights
        run: python -m collectors.flights || echo "flights skipped"
      - name: Collect GDELT events
        run: python -m collectors.gdelt_events || echo "gdelt skipped"
      - name: Commit snapshots
        run: |
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"
          git add data/snapshots/*.json
          if git diff --cached --quiet; then
            echo "no changes"
          else
            git commit -m "data: refresh snapshots [skip ci]"
            git push
          fi
```
（`|| echo skipped` で1ソースの失敗が全体を止めない。各収集器自身も前回温存。）

- [ ] **Step 2: ローカルで3収集器が動くことを確認（ワークフローと同コマンド）**
```bash
cd ~/apps/orbis
python3 -m collectors.quakes && python3 -m collectors.flights && python3 -m collectors.gdelt_events
```
Expected: 3つとも書き出しログ。`data/snapshots/` に quakes/flights/protests/conflict.json と manifest.json。

- [ ] **Step 3: Commit（更新スナップショット含む）**
```bash
cd ~/apps/orbis
git add .github/workflows/collect.yml data/snapshots/*.json
git commit -m "ci: collect flights + GDELT events every 15 min"
```

---

### Task 14: e2e 拡張＋全テスト緑＋README更新

**Files:**
- Modify: `tests/e2e/smoke.spec.js`, `README.md`

- [ ] **Step 1: e2e を更新** — `tests/e2e/smoke.spec.js`
```javascript
import { test, expect } from '@playwright/test';

test('globe boots and all phase-2 layers render', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });
  await expect(page.locator('#map canvas.maplibregl-canvas')).toBeVisible();

  // 凡例グループが5レイヤー分（quakes/flights/conflict/protests/trade）
  await expect(page.locator('#legend .legend-group')).toHaveCount(5);

  // ポーリング＋静的ロード後、各レイヤーのカウントが入る
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.quakes ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  // flights は本番データ依存だが、committed snapshot があるので >0 を期待
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.flights ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
  // trade は静的なので必ず features を持つ
  await expect.poll(
    async () => page.evaluate(() => window.__orbis?.counts?.trade ?? 0),
    { timeout: 15000 }
  ).toBeGreaterThan(0);
});
```
注: conflict/protests は GDELT バッチによっては0件のことがあるため、e2e の必須アサーションには含めない（quakes/flights/trade で疎通を担保）。

- [ ] **Step 2: e2e を実行**
Run: `cd ~/apps/orbis && npx playwright test`
Expected: 1 passed。失敗時は `data/snapshots/flights.json` の存在と件数、`window.__orbis.counts` を確認（`page.on('console')` でエラー収集）。assertion を弱めて通すのは禁止。

- [ ] **Step 3: 全テストスイートを緑で確認**
Run: `cd ~/apps/orbis && python3 -m pytest -q && node --test tests/*.test.js && npx playwright test`
Expected: pytest（quakes2+manifest2+flights3+gdelt4=11）／node:test（geo3+quakes2+registry2+geo2:2+flights2+conflict2+protests2+trade2=17）／Playwright 1 passed。すべて緑。

- [ ] **Step 4: README のレイヤー説明を更新** — `README.md` の Phase 行を編集
```markdown
無料OSINTで世界を近リアルタイム監視するダッシュボード。Phase 2: 地球儀 + 地震(USGS) + 航空(OpenSky) + 紛争/抗議(GDELT) + 貿易ルート(静的)。
```
（収集コマンド節にも `python3 -m collectors.flights` と `python3 -m collectors.gdelt_events` を追記）

- [ ] **Step 5: Commit**
```bash
cd ~/apps/orbis
git add tests/e2e/smoke.spec.js README.md
git commit -m "test: e2e covers phase-2 layers; docs: update README"
```

---

## Self-Review（計画 vs spec）

**スペック網羅:**
- ✈️航空（OpenSky匿名・ズーム連動矢印・ダウンサンプル6000）= Task 3,4,8 ✓
- 🔥紛争 / ✊抗議（GDELT CSV・rootcode・24hローリング）= Task 5,6,7,9,10 ✓
- 📦貿易ルート（静的GeoJSON・PathLayer+要衝）= Task 11 ✓
- レジストリ複数レイヤー対応 = Task 1 ✓
- registry駆動の凡例 = Task 12 ✓
- 収集ワークフロー */15・3収集器 = Task 13 ✓
- テスト（pytout/node/e2e）= 各Task + Task14 ✓
- **意図的にPhase 3へ繰延**: 左トグルパネル（本Planは凡例表示のみ・トグルUIなし＝全レイヤー常時ON）、右イベントフィード、flyTo、localStorage、折りたたみ、動的モーション（貿易フロー/出現パルス）。spec §3後半・動的表現の一部は Phase 3 plan で扱う。

**プレースホルダ:** "TBD"/"後で"/"適宜" は無し。各コード手順に完全コードを記載。trade_routes.geojson も実データを記載。

**型/名称整合:** スナップショット `{layer,updated,count,points[]}` は Python(build_snapshot/_write)とJS(buildXConfig)で一致。`buildDeckLayers(enabled,snapshots[,override])`・`iconAngle`・`eventRadius`・`buildIconConfig`・`buildConflictConfig`・`buildProtestsConfig`・`buildTradeConfigs`・`flightsLayer/conflictLayer/protestsLayer/tradeLayer`・`window.__orbis.counts` を全タスクで統一。trade は `fetch()` が geojson を返し `toDeckLayer` が配列を返す（Task1 の flat 化で吸収）。

**既知の前提:** deck.gl IconLayer は CDN グローバル `deck` 提供。`btoaSafe` で Node テスト時も base64 変換可能（buildIconConfig 自体は getIcon 内で ARROW_SVG を参照するのみでテストは getPosition/getAngle/getColor を検証）。OpenSky 匿名がCIで429になり得るが各収集器は前回温存＋ワークフローは `|| echo skipped` で継続。
