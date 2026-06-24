# ORBIS 船舶（Ships / AIS）レイヤー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AISStream の全球リアルタイム AIS を時間枠リッスンして snapshot 化し、globe 上に進行方向を向く船体シルエット（既定OFF）として描く `ships` レイヤーを追加し、あわせて既存 flights を飛行機シルエットへ格上げする。

**Architecture:** 既存のスナップショット方式（cron取得→`data/snapshots/*.json`→静的配信・Vercel関数ゼロ）を踏襲。新規は取得形態のみ＝AISStream WebSocket を 28 秒リッスンし MMSI で最新位置を上書き蓄積→重複排除→JSON。描画は globe で実績ある SolidPolygonLayer + ScatterplotLayer のみ（IconLayer は deck.gl 9.3.4 + globe で全滅のため不可）。向き付き多角形は flights 三角形と同じ fwd/perp/L 基底を共有ヘルパ `silhouettePolygon` に切り出して DRY 化する。

**Tech Stack:** Vanilla JS (ESM, no build) / MapLibre GL v5.24 globe / deck.gl 9.3.4 (CDN) / Python3 collectors / `websocket-client` / GitHub Actions cron / Vercel static deploy。テスト: node:test（JS）・pytest（Python）・Playwright（e2e）。

**前提:** 本番データには GitHub Secret `AISSTREAM_API_KEY` が必要（オーナーが直接設定）。キー無しでも全テストは緑になる設計（collector は skip、フロントはデータ無しで非表示）。

---

## File Structure

- **Create** `collectors/ships.py` — AISStream 取得。純関数（parse/merge/downsample/build/type）＋ I/O（collect/main）。
- **Create** `tests/test_ships.py` — collectors/ships.py 純関数の pytest。
- **Create** `js/layers/ships.js` — ships レイヤー（シルエット＋ドット＋ツールチップ＋registry オブジェクト）。
- **Create** `tests/ships.test.js` — ships.js 純関数の node:test。
- **Modify** `js/lib/geo.js` — 共有ヘルパ `silhouettePolygon` を追加。
- **Modify** `js/layers/flights.js` — 三角形→飛行機シルエットへ格上げ（`silhouettePolygon` 利用）。
- **Modify** `tests/flights.test.js` — 関数改名・シルエットに合わせて更新。
- **Modify** `tests/geo.test.js` — `silhouettePolygon` のテスト追加。
- **Modify** `js/layers/registry.js` — ships を import/登録、DECK_TO_LAYER・DESCRIPTIONS 追加。
- **Modify** `tests/registry.test.js` / `tests/tooltip.test.js` — ships ツールチップ解決のテスト追加。
- **Modify** `js/main.js` — POLL_LAYERS・ALL_IDS・loadEnabled defaultOff に ships 追加。
- **Modify** `css/orbis.css` — `.swatch-diamond` 追加。
- **Modify** `sw.js` — `CACHE` を `orbis-v14` → `orbis-v15`。
- **Modify** `requirements.txt` — `websocket-client` 追加。
- **Modify** `.github/workflows/collect.yml` — `Collect ships` ステップ追加（Secret env）。
- **Modify** `tests/e2e/smoke.spec.js` — パネル行 7→8、ships 既定OFF→ON→描画存在を検証。

---

## Task 1: collectors/ships.py 純関数

**Files:**
- Create: `collectors/ships.py`
- Test: `tests/test_ships.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_ships.py
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.ships import (
    ship_type_label, parse_position, parse_static, merge_records,
    downsample, build_snapshot,
)

def test_ship_type_label_ranges():
    assert ship_type_label(30) == "漁船"
    assert ship_type_label(36) == "帆船"
    assert ship_type_label(37) == "プレジャーボート"
    assert ship_type_label(50) == "水先船"
    assert ship_type_label(51) == "捜索救助"
    assert ship_type_label(52) == "曳航船"
    assert ship_type_label(60) == "旅客船" and ship_type_label(69) == "旅客船"
    assert ship_type_label(70) == "貨物船" and ship_type_label(79) == "貨物船"
    assert ship_type_label(80) == "タンカー" and ship_type_label(89) == "タンカー"
    assert ship_type_label(0) == "船舶" and ship_type_label(99) == "船舶"
    assert ship_type_label(None) == "船舶" and ship_type_label("x") == "船舶"

def test_parse_position_valid():
    msg = {"MessageType": "PositionReport",
           "MetaData": {"MMSI": 123456789},
           "Message": {"PositionReport": {"Latitude": 35.611, "Longitude": 139.777,
                                          "Cog": 45.2, "Sog": 12.34}}}
    p = parse_position(msg)
    assert p == {"mmsi": 123456789, "lon": 139.777, "lat": 35.611, "cog": 45.2, "sog": 12.3}

def test_parse_position_missing_coords_is_none():
    msg = {"MetaData": {"MMSI": 1}, "Message": {"PositionReport": {"Latitude": None, "Longitude": 1.0}}}
    assert parse_position(msg) is None

def test_parse_position_sentinel_cog_sog_to_none():
    msg = {"MetaData": {"MMSI": 1},
           "Message": {"PositionReport": {"Latitude": 0.0, "Longitude": 0.0, "Cog": 360.0, "Sog": 102.3}}}
    p = parse_position(msg)
    assert p["cog"] is None and p["sog"] is None

def test_parse_static_name_and_type():
    msg = {"MessageType": "ShipStaticData", "MetaData": {"MMSI": 7},
           "Message": {"ShipStaticData": {"Name": "EVER GIVEN  ", "Type": 71}}}
    assert parse_static(msg) == {"mmsi": 7, "name": "EVER GIVEN", "type": "貨物船"}

def test_parse_static_name_falls_back_to_meta_and_unknown_type():
    msg = {"MetaData": {"MMSI": 8, "ShipName": "NIPPON MARU"},
           "Message": {"ShipStaticData": {}}}
    assert parse_static(msg) == {"mmsi": 8, "name": "NIPPON MARU", "type": "船舶"}

def test_merge_records_joins_and_handles_missing_static():
    positions = {1: {"mmsi": 1, "lon": 0, "lat": 0, "cog": 1.0, "sog": 2.0},
                 2: {"mmsi": 2, "lon": 1, "lat": 1, "cog": None, "sog": None}}
    statics = {1: {"mmsi": 1, "name": "A", "type": "貨物船"}}
    out = merge_records(positions, statics)
    assert {"mmsi": 1, "lon": 0, "lat": 0, "cog": 1.0, "sog": 2.0, "name": "A", "type": "貨物船"} in out
    p2 = next(p for p in out if p["mmsi"] == 2)
    assert p2["name"] is None and p2["type"] is None

def test_downsample_caps_count():
    pts = [{"mmsi": i, "lon": 0, "lat": 0} for i in range(100)]
    out = downsample(pts, 10)
    assert len(out) <= 10 and out[0]["mmsi"] == 0

def test_build_snapshot_shape():
    snap = build_snapshot([{"mmsi": 1}], "2026-06-17T00:00:00Z")
    assert snap["layer"] == "ships" and snap["count"] == 1 and snap["updated"].endswith("Z")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_ships.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'collectors.ships'`

- [ ] **Step 3: Write the pure functions**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_ships.py -v`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add collectors/ships.py tests/test_ships.py
git commit -m "feat(ships): AIS collector pure functions (parse/merge/type)"
```

---

## Task 2: collectors/ships.py I/O（collect/main）＋ 依存・cron 配線

**Files:**
- Modify: `collectors/ships.py`（末尾に追記）
- Modify: `requirements.txt`
- Modify: `.github/workflows/collect.yml`

- [ ] **Step 1: Append collect() and main() to collectors/ships.py**

```python
def collect(api_key, seconds=LISTEN_SECONDS):
    """AISStream に接続し seconds 秒リッスン。(positions, statics) を返す（I/O）。"""
    import websocket  # websocket-client
    positions, statics = {}, {}
    ws = websocket.create_connection(API_URL, timeout=10)
    try:
        sub = {"APIKey": api_key,
               "BoundingBoxes": [[[-90, -180], [90, 180]]],
               "FilterMessageTypes": ["PositionReport", "ShipStaticData"]}
        ws.send(json.dumps(sub))
        ws.settimeout(3)
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                raw = ws.recv()
            except websocket.WebSocketTimeoutException:
                continue
            except Exception:
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
```

- [ ] **Step 2: Add dependency to requirements.txt**

Append this line to `requirements.txt`:

```
websocket-client>=1.7.0
```

- [ ] **Step 3: Add cron step to .github/workflows/collect.yml**

Insert this step after the `Collect air temperature` step and before `Commit snapshots`:

```yaml
      - name: Collect ships
        env:
          AISSTREAM_API_KEY: ${{ secrets.AISSTREAM_API_KEY }}
        run: python -m collectors.ships || echo "ships skipped"
```

- [ ] **Step 4: Verify the module imports and skips cleanly without a key**

Run: `AISSTREAM_API_KEY= .venv/bin/python -m collectors.ships; echo "exit=$?"`
Expected: prints `[ships] AISSTREAM_API_KEY not set; skipping` and `exit=0`

- [ ] **Step 5: Verify pytest still green (no network)**

Run: `pytest tests/test_ships.py -v`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
git add collectors/ships.py requirements.txt .github/workflows/collect.yml
git commit -m "feat(ships): AIS websocket collect + cron wiring (key-gated)"
```

---

## Task 3: 共有ヘルパ silhouettePolygon（geo.js）

**Files:**
- Modify: `js/lib/geo.js`（末尾に追加）
- Modify: `tests/geo.test.js`（テスト追加）

- [ ] **Step 1: Write the failing test (append to tests/geo.test.js)**

```javascript
import { silhouettePolygon } from '../js/lib/geo.js';

test('silhouettePolygon: 北(0)は前方頂点が北、頂点数は verts と一致', () => {
  const verts = [[1, 0], [-1, 0.3], [-1, -0.3]];
  const poly = silhouettePolygon(0, 0, 0, 1, verts);
  assert.equal(poly.length, 3);
  assert.ok(poly[0][1] > 0, '前方(forward+)は北で緯度が増える');
});

test('silhouettePolygon: 東(90)は前方頂点が東', () => {
  const poly = silhouettePolygon(0, 0, 90, 1, [[1, 0]]);
  assert.ok(poly[0][0] > 0, '東向きは前方頂点の経度が増える');
});

test('silhouettePolygon: heading 欠損/非数値/座標欠損は null', () => {
  assert.equal(silhouettePolygon(0, 0, null, 1, [[1, 0]]), null);
  assert.equal(silhouettePolygon(0, 0, NaN, 1, [[1, 0]]), null);
  assert.equal(silhouettePolygon(null, 0, 0, 1, [[1, 0]]), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/geo.test.js`
Expected: FAIL with `silhouettePolygon is not a function` / import error

- [ ] **Step 3: Add the helper to js/lib/geo.js**

```javascript
// 進行方向(headingDeg, 北0°時計回り)に向けたローカル多角形を地理座標へ変換する（純粋）。
// verts: [[forward, side], ...]（forward=前方+, side=右+、単位は degLen 基準）。
// flights 三角形と同じ fwd/perp/L 基底を用い、高緯度でも画素一定の向き付き形状を作る。
export function silhouettePolygon(lon, lat, headingDeg, degLen, verts) {
  if (lon == null || lat == null || headingDeg == null) return null;
  const h = Number(headingDeg);
  if (!Number.isFinite(h)) return null;
  const rad = (h * Math.PI) / 180;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const fwd = [Math.sin(rad) / cosLat, Math.cos(rad)];
  const perp = [Math.cos(rad) / cosLat, -Math.sin(rad)];
  const L = degLen * cosLat;
  return verts.map(([f, s]) => [
    lon + (fwd[0] * f + perp[0] * s) * L,
    lat + (fwd[1] * f + perp[1] * s) * L,
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/geo.test.js`
Expected: PASS（既存 + 追加3件）

- [ ] **Step 5: Commit**

```bash
git add js/lib/geo.js tests/geo.test.js
git commit -m "feat(geo): shared silhouettePolygon helper for oriented markers"
```

---

## Task 4: flights を飛行機シルエットへ格上げ

**Files:**
- Modify: `js/layers/flights.js`
- Modify: `tests/flights.test.js`

- [ ] **Step 1: Replace tests/flights.test.js with silhouette-based tests**

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planeSilhouettePolygon, buildPlaneConfig, buildDotConfig, PLANE_VERTS } from '../js/layers/flights.js';

test('planeSilhouettePolygon: 北(0)は機首が北、頂点数は PLANE_VERTS と一致', () => {
  const poly = planeSilhouettePolygon({ lon: 0, lat: 0, heading: 0 }, 1);
  assert.equal(poly.length, PLANE_VERTS.length);
  assert.ok(poly[0][1] > 0, '機首(先頭頂点)は北で緯度が増える');
});

test('planeSilhouettePolygon: 東(90)は機首が東', () => {
  const poly = planeSilhouettePolygon({ lon: 0, lat: 0, heading: 90 }, 1);
  assert.ok(poly[0][0] > 0, '東向きは機首の経度が増える');
});

test('planeSilhouettePolygon: heading 無しは null', () => {
  assert.equal(planeSilhouettePolygon({ lon: 0, lat: 0, heading: null }, 1), null);
  assert.equal(planeSilhouettePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildPlaneConfig: heading を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildPlaneConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'flights');
  assert.equal(cfg.data.length, 1, 'heading 無しはシルエットに含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, PLANE_VERTS.length);
});

test('buildDotConfig: heading 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, heading: 90 }, { lon: 1, lat: 1, heading: null },
  ] });
  assert.equal(cfg.id, 'flights-dot');
  assert.equal(cfg.data.length, 1, 'heading 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildDotConfig/buildPlaneConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildPlaneConfig(null, 1).data, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flights.test.js`
Expected: FAIL（`planeSilhouettePolygon` / `PLANE_VERTS` / `buildPlaneConfig` is not exported）

- [ ] **Step 3: Rewrite js/layers/flights.js to use the silhouette**

```javascript
// 航空レイヤー。進行方向を向く飛行機シルエット(SolidPolygonLayer)＋heading無し機の小ドット。
// 注: IconLayer/TextLayer は deck.gl 9.3.4 + globe + MapboxOverlay で描画されない
// （[[deckgl-9.3-iconlayer-globe-broken]]）。ジオメトリ層のみ・ズーム適応で一定px化する。
import { degLenForZoom, silhouettePolygon } from '../lib/geo.js';

const CYAN = [80, 220, 255];

// 機首=前方(+forward)、右翼=+side の飛行機シルエット（[forward, side] のローカル座標列）。
// 機首・後退翼・尾翼の10頂点。極小サイズでも「機体」と分かる最小限の形。
export const PLANE_VERTS = [
  [1.0, 0.0],     // 機首
  [-0.2, 0.15],   // 右胴
  [-0.45, 0.75],  // 右翼端
  [-0.6, 0.12],   // 右翼後縁
  [-1.0, 0.35],   // 右尾翼端
  [-0.9, 0.0],    // 尾部
  [-1.0, -0.35],  // 左尾翼端
  [-0.6, -0.12],  // 左翼後縁
  [-0.45, -0.75], // 左翼端
  [-0.2, -0.15],  // 左胴
];

// 機体を heading 方向に向けた飛行機シルエット頂点。heading 欠損で null。
export function planeSilhouettePolygon(p, degLen) {
  if (!p) return null;
  return silhouettePolygon(p.lon, p.lat, p.heading, degLen, PLANE_VERTS);
}

// heading を持つ機のシルエット（SolidPolygonLayer config）。degLen はズーム適応。
export function buildPlaneConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading != null);
  return {
    id: 'flights', data,
    getPolygon: (p) => planeSilhouettePolygon(p, degLen),
    getFillColor: [...CYAN, 190], stroked: false, pickable: true,
    updateTriggers: { getPolygon: degLen },
  };
}

// heading 無しの機の小ドット（ScatterplotLayer config）。
export function buildDotConfig(snapshot) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.heading == null);
  return {
    id: 'flights-dot', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 2.5, radiusMinPixels: 2, radiusMaxPixels: 3.5,
    getFillColor: [...CYAN, 220], stroked: false, pickable: true,
  };
}

export const flightsLayer = {
  id: 'flights',
  label: '航空',
  marker: 'triangle', // パネルのスウォッチ形状（簡易・進行方向の三角で近似）
  legend: [{ color: 'rgb(80,220,255)', label: '航空機（✈＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('flights'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildPlaneConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) {
    if (!o) return null;
    const alt = (o.on_ground || o.alt == null) ? '地上' : `${Math.round(o.alt)}m`;
    return `便名 ${String(o.callsign || '').trim()}｜高度 ${alt}｜速度 ${Math.round(o.velocity || 0)}m/s`;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/flights.test.js`
Expected: PASS（6 件）

- [ ] **Step 5: Verify registry/tooltip tests unaffected**

Run: `node --test tests/registry.test.js tests/tooltip.test.js`
Expected: PASS（flights のツールチップ・deck id は不変）

- [ ] **Step 6: Commit**

```bash
git add js/layers/flights.js tests/flights.test.js
git commit -m "feat(flights): upgrade triangle to plane silhouette via shared helper"
```

---

## Task 5: ships レイヤー（js/layers/ships.js）

**Files:**
- Create: `js/layers/ships.js`
- Test: `tests/ships.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/ships.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shipSilhouettePolygon, buildHullConfig, buildDotConfig, shipTooltip, SHIP_VERTS,
} from '../js/layers/ships.js';

test('shipSilhouettePolygon: 北(cog 0)は船首が北、頂点数は SHIP_VERTS と一致', () => {
  const poly = shipSilhouettePolygon({ lon: 0, lat: 0, cog: 0 }, 1);
  assert.equal(poly.length, SHIP_VERTS.length);
  assert.ok(poly[0][1] > 0, '船首(先頭頂点)は北で緯度が増える');
});

test('shipSilhouettePolygon: 東(cog 90)は船首が東', () => {
  const poly = shipSilhouettePolygon({ lon: 0, lat: 0, cog: 90 }, 1);
  assert.ok(poly[0][0] > 0, '東向きは船首の経度が増える');
});

test('shipSilhouettePolygon: cog 無しは null', () => {
  assert.equal(shipSilhouettePolygon({ lon: 0, lat: 0, cog: null }, 1), null);
  assert.equal(shipSilhouettePolygon({ lon: 0, lat: 0 }, 1), null);
});

test('buildHullConfig: cog を持つ点のみ・updateTriggers に degLen', () => {
  const cfg = buildHullConfig({ points: [
    { lon: 0, lat: 0, cog: 90 }, { lon: 1, lat: 1, cog: null },
  ] }, 0.5);
  assert.equal(cfg.id, 'ships');
  assert.equal(cfg.data.length, 1, 'cog 無しは船体に含めない');
  assert.equal(cfg.pickable, true);
  assert.equal(cfg.updateTriggers.getPolygon, 0.5);
  assert.equal(cfg.getPolygon(cfg.data[0]).length, SHIP_VERTS.length);
});

test('buildDotConfig: cog 無しの点のみドット化', () => {
  const cfg = buildDotConfig({ points: [
    { lon: 0, lat: 0, cog: 90 }, { lon: 1, lat: 1, cog: null },
  ] });
  assert.equal(cfg.id, 'ships-dot');
  assert.equal(cfg.data.length, 1, 'cog 無しのみ');
  assert.equal(cfg.pickable, true);
});

test('buildHullConfig/buildDotConfig: snapshot 無しでも安全', () => {
  assert.deepEqual(buildDotConfig(null).data, []);
  assert.deepEqual(buildHullConfig(null, 1).data, []);
});

test('shipTooltip: 船名・船種・速度・航路（全部あり）', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: 'EVER GIVEN', type: '貨物船', sog: 12.3, cog: 45 }),
    '船名 EVER GIVEN｜貨物船｜12kn｜航路 045°',
  );
});

test('shipTooltip: 船名/船種無しは MMSI ＋欠損項目を省略', () => {
  assert.equal(
    shipTooltip({ mmsi: 123456789, name: null, type: null, sog: 12.3, cog: 45 }),
    'MMSI 123456789｜12kn｜航路 045°',
  );
  assert.equal(shipTooltip({ mmsi: 1, name: null, type: null, sog: null, cog: null }), 'MMSI 1');
  assert.equal(shipTooltip(null), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ships.test.js`
Expected: FAIL（`js/layers/ships.js` が無い / 未エクスポート）

- [ ] **Step 3: Write js/layers/ships.js**

```javascript
// 船舶レイヤー。AISStream の船(points: mmsi/lon/lat/cog/sog/name/type)を、
// 進行方向(COG)を向く船体シルエット(SolidPolygonLayer)＋COG無し船の小ドットで描く。
// IconLayer は deck.gl 9.3.4 + globe で全滅のため使わない（flights と同じ姿勢）。
import { degLenForZoom, silhouettePolygon } from '../lib/geo.js';

// 海色系で航空シアンと差別化。既定=琥珀ゴールド（青い海で視認性が高い）。
// 実装時に python http.server で teal 等と実物比較して確定する。
const SHIP_RGB = [255, 205, 100];

// 船首=前方(+forward)、右舷=+side の船体シルエット（[forward, side] のローカル座標列）。
// 尖った船首・平行な舷側・方形の船尾の7頂点（航空シルエットと形を分け、一目で区別可能に）。
export const SHIP_VERTS = [
  [1.0, 0.0],     // 船首
  [0.4, 0.28],    // 右舷前
  [-0.7, 0.3],    // 右舷
  [-1.0, 0.22],   // 右船尾
  [-1.0, -0.22],  // 左船尾
  [-0.7, -0.3],   // 左舷
  [0.4, -0.28],   // 左舷前
];

// 船を COG 方向に向けた船体シルエット頂点。COG 欠損で null。
export function shipSilhouettePolygon(p, degLen) {
  if (!p) return null;
  return silhouettePolygon(p.lon, p.lat, p.cog, degLen, SHIP_VERTS);
}

// COG を持つ船の船体シルエット（SolidPolygonLayer config）。
export function buildHullConfig(snapshot, degLen) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.cog != null);
  return {
    id: 'ships', data,
    getPolygon: (p) => shipSilhouettePolygon(p, degLen),
    getFillColor: [...SHIP_RGB, 200], stroked: false, pickable: true,
    updateTriggers: { getPolygon: degLen },
  };
}

// COG 無しの船の小ドット（ScatterplotLayer config）。
export function buildDotConfig(snapshot) {
  const pts = (snapshot && snapshot.points) ? snapshot.points : [];
  const data = pts.filter((p) => p.cog == null);
  return {
    id: 'ships-dot', data, radiusUnits: 'pixels',
    getPosition: (p) => [p.lon, p.lat],
    getRadius: 2.5, radiusMinPixels: 2, radiusMaxPixels: 3.5,
    getFillColor: [...SHIP_RGB, 220], stroked: false, pickable: true,
  };
}

// ツールチップ: 船名 or MMSI ＋ 船種 ＋ 速度kn ＋ 航路°（欠損項目は省略）。
export function shipTooltip(o) {
  if (!o) return null;
  const head = o.name ? `船名 ${o.name}` : `MMSI ${o.mmsi}`;
  const sog = o.sog == null ? null : `${Math.round(o.sog)}kn`;
  const cog = o.cog == null ? null : `航路 ${String(Math.round(o.cog)).padStart(3, '0')}°`;
  return [head, o.type || null, sog, cog].filter(Boolean).join('｜');
}

export const shipsLayer = {
  id: 'ships',
  label: '船舶',
  marker: 'diamond',              // パネルのスウォッチ形状（船体を菱形で近似）
  swatchColor: 'rgb(255,205,100)',
  legend: [{ color: 'rgb(255,205,100)', label: '船舶（◆＝進行方向）' }],
  async fetch(getSnapshot) { return getSnapshot('ships'); },
  toDeckLayer(snapshot, ctx) {
    const zoom = (ctx && typeof ctx.zoom === 'number') ? ctx.zoom : 3;
    const degLen = degLenForZoom(zoom);
    return [
      new deck.SolidPolygonLayer(buildHullConfig(snapshot, degLen)),
      new deck.ScatterplotLayer(buildDotConfig(snapshot)),
    ];
  },
  tooltip(o) { return shipTooltip(o); },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ships.test.js`
Expected: PASS（9 件）

- [ ] **Step 5: Commit**

```bash
git add js/layers/ships.js tests/ships.test.js
git commit -m "feat(ships): ship hull silhouette layer + tooltip"
```

---

## Task 6: registry 登録＋ツールチップ解決

**Files:**
- Modify: `js/layers/registry.js`
- Modify: `tests/registry.test.js`（テスト追加）

- [ ] **Step 1: Write the failing test (append to tests/registry.test.js)**

```javascript
test('tooltipFor: ships-dot は ships のツールチップに解決', () => {
  assert.equal(
    tooltipFor('ships-dot', { mmsi: 7, name: 'A', type: '貨物船', sog: 10, cog: 90 }),
    '船名 A｜貨物船｜10kn｜航路 090°',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/registry.test.js`
Expected: FAIL（`ships-dot` が DECK_TO_LAYER 未登録で null が返る）

- [ ] **Step 3: Wire ships into js/layers/registry.js**

Edit imports (add after the airtemp import line):

```javascript
import { shipsLayer } from './ships.js';
```

Edit the `layers` array to append `shipsLayer`:

```javascript
export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer, tradeLayer, currentsLayer, airtempLayer, shipsLayer];
```

Edit `DECK_TO_LAYER` to add ships entries:

```javascript
const DECK_TO_LAYER = {
  quakes: 'quakes', flights: 'flights', 'flights-dot': 'flights',
  conflict: 'conflict', protests: 'protests',
  'trade-routes': 'trade', 'trade-chokepoints': 'trade',
  currents: 'currents', airtemp: 'airtemp',
  ships: 'ships', 'ships-dot': 'ships',
};
```

Edit `DESCRIPTIONS` to add ships:

```javascript
  airtemp: '全球の気温（Open-Meteo・色=暖/寒の連続グラデ・半透明）',
  ships: '航行中の船舶（AIS・◆＝進行方向・既定OFF）',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/registry.test.js tests/ships.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add js/layers/registry.js tests/registry.test.js
git commit -m "feat(ships): register in layer registry + tooltip resolution"
```

---

## Task 7: フロント配線（main.js / state defaultOff / css / sw）

**Files:**
- Modify: `js/main.js:19-21`
- Modify: `css/orbis.css`（swatch 群の近く）
- Modify: `sw.js`

- [ ] **Step 1: Update POLL_LAYERS / ALL_IDS / loadEnabled in js/main.js**

Replace lines 19-21:

```javascript
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests', 'airtemp', 'ships']; // スナップショットを持つ層
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade', 'currents', 'airtemp', 'ships'];
let ENABLED = loadEnabled(ALL_IDS, readStored(), ['airtemp', 'ships']);
```

（counts は `v.points?.length` で ships も自動集計されるため変更不要。ships のツールチップは
`info.object ? tooltipFor(info.layer.id, info.object)` の汎用経路で解決されるため main.js の getTooltip も変更不要。）

- [ ] **Step 2: Add the diamond swatch to css/orbis.css**

Add after the `.swatch-triangle` rule (around line 96):

```css
.layer-row .swatch-diamond { width: 9px; height: 9px; background: currentColor; transform: rotate(45deg);
  box-shadow: 0 0 8px currentColor; }
```

- [ ] **Step 3: Bump the service worker cache version in sw.js**

Change `const CACHE = 'orbis-v14';` to:

```javascript
const CACHE = 'orbis-v15';
```

- [ ] **Step 4: Run the full JS test suite**

Run: `node --test tests/*.test.js`
Expected: PASS（全件・ships/flights/geo/registry 追加分込み）

- [ ] **Step 5: Commit**

```bash
git add js/main.js css/orbis.css sw.js
git commit -m "feat(ships): frontend wiring (poll/default-off/swatch) + sw v15"
```

---

## Task 8: e2e スモーク更新

**Files:**
- Modify: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: Update the panel row count assertion**

Change:

```javascript
  // 左パネルに7レイヤー行（地震/航空/紛争/抗議/貿易/海流/気温）
  await expect(page.locator('#panel .layer-row')).toHaveCount(7);
```

to:

```javascript
  // 左パネルに8レイヤー行（地震/航空/紛争/抗議/貿易/海流/気温/船舶）
  await expect(page.locator('#panel .layer-row')).toHaveCount(8);
```

- [ ] **Step 2: Add ships default-OFF → toggle-ON → present check**

Insert after the airtemp toggle block (just before the final closing comment of the test):

```javascript
  // 船舶(ships)は既定OFF。ON にすると船体シルエット(SolidPolygon)が deck に描画される。
  // （本番データはキー設定後。e2e ではトグルでレイヤーが追加されることのみ検証）
  await expect(page.locator('.layer-row[data-id="ships"] .layer-toggle')).not.toBeChecked();
  await page.locator('.layer-row[data-id="ships"] .layer-toggle').check();
  await page.waitForTimeout(400);
  await expect(page.locator('.layer-row[data-id="ships"] .layer-toggle')).toBeChecked();
  // ships スナップショットがあれば deck に描画される（キー設定後の本番でのみ存在）。
  // 無くても例外が出ず、トグル ON が反映されることを担保する。
  const shipsLayerOk = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    const has = window.__orbis.counts && window.__orbis.counts.ships > 0;
    const present = ((o._props && o._props.layers) || []).some((l) => l.id === 'ships');
    return !has || present; // データがあるなら描画されているはず
  });
  expect(shipsLayerOk).toBe(true);
```

注: ships のスナップショットはキー未設定だと存在しないため、`buildDeckLayers` は
`snapshots['ships']` が無いと描画しない（堅牢性）。e2e ではトグルが ON になり例外が出ないこと、
パネル行が8であることを担保する（描画の画素検証は本番 Playwright で実施）。

- [ ] **Step 3: Run e2e**

Run: `npx playwright test tests/e2e/smoke.spec.js`
Expected: PASS（パネル8行・ships トグル操作で例外なし・既存検証も緑）

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/smoke.spec.js
git commit -m "test(ships): e2e smoke for 8 rows + ships toggle"
```

---

## Task 9: マーカー形状・色の実物比較（python http.server・手動確定）

**Files:**
- Modify（必要時）: `js/layers/ships.js`（`SHIP_RGB` / `SHIP_VERTS`）, `js/layers/flights.js`（`PLANE_VERTS`）

このタスクはコードを書くより「見て確定する」工程。キー未設定でも flights は本番データで動くため、
航空シルエットの見えはローカルで確認できる。船舶はキー設定後の本番で最終確認する（後述 Task 10）。

- [ ] **Step 1: Serve locally**

Run: `python3 -m http.server 8000`（リポジトリルートで）

- [ ] **Step 2: 航空シルエットを目視（Playwright スクショ）**

playwright-skill で `http://localhost:8000/` を開き、低ズーム（globe 全球）と
ズームイン（特定機にフォーカス）の2枚をスクショ。確認観点:
- 引きの全球で「✈ らしさ」が出るか／潰れて点に見えないか（潰れるなら `PLANE_VERTS` の翼を大きく）。
- 密集地（欧州・日本上空）で重なって真っ白にならないか（`getFillColor` の alpha 190 を下げて調整）。

- [ ] **Step 3: 船舶色の候補比較（船舶データはキー後だが、色は仮データで確認可能）**

`SHIP_RGB` を `[255,205,100]`（ゴールド）と `[60,220,180]`（ティール）で切替し、
青い海・シアン航空との見分けやすさをスクショ比較。視認性とテーマ調和でオーナーと確定。

- [ ] **Step 4: 必要なら頂点・色・alpha を微修正してコミット**

```bash
git add js/layers/ships.js js/layers/flights.js
git commit -m "tune(ships): finalize silhouette vertices and ship color from visual review"
```

（変更不要なら本タスクはコミットなしで完了マーク。）

---

## Task 10: 最終レビュー → main マージ → 本番デプロイ → 検証

**Files:** なし（リリース工程）

- [ ] **Step 1: 全テスト緑を確認**

Run: `node --test tests/*.test.js && pytest tests/ -q`
Expected: 全件 PASS

- [ ] **Step 2: superpowers:finishing-a-development-branch でマージ**

`ships` → `main` ローカルマージ。manifest.json が cron で汚れている場合は安全根拠を添えて
`git pull --no-rebase`（push 競合時）。コミット作者メールは noreply 形式必須。

- [ ] **Step 3: push（Vercel 自動デプロイ）**

```bash
git push origin main
```

- [ ] **Step 4: オーナーが GitHub Secret を設定**

リポジトリ Settings → Secrets and variables → Actions → New repository secret:
`AISSTREAM_API_KEY` = aisstream.io で取得したキー。生キーは AI に渡さない。

- [ ] **Step 5: データ生成（手動起動 or cron 待ち）**

GitHub Actions の `collect` ワークフローを `workflow_dispatch` で手動起動 → `data/snapshots/ships.json`
が生成・commit されることを確認。

- [ ] **Step 6: 本番 Playwright 検証**

`https://orbis-beta.vercel.app/` を開き、船舶トグル ON → globe に船体シルエットが描画・
`window.__orbis.counts.ships > 0`・他レイヤー併用で破綻なし・コンソールエラー0 を画素＋数値で確認。
沿岸・主要航路に船が乗っているか（外洋が疎なのは AIS の仕様で許容）。

- [ ] **Step 7: 横断記憶の整理（完了の都度ルール）**

`memory/project_orbis.md`・`MEMORY.md`・Obsidian `Projects/orbis.md` に船舶レイヤー完了を追記し、
明示報告する。

---

## Self-Review

**1. Spec coverage（spec の各要件 → タスク対応）:**
- AISStream WS 時間枠リッスン・MMSI重複排除・snapshot → Task 1,2 ✓
- キー= GitHub Secret・キー無し skip → Task 2（main の skip）, Task 10 ✓
- websocket-client 依存・cron ステップ → Task 2 ✓
- 純関数 parse_position/parse_static/ship_type_label/merge_records/downsample/build_snapshot → Task 1 ✓
- 進行方向シルエット（SolidPolygon）・COG欠損ドット → Task 5 ✓
- flights 三角→飛行機シルエット格上げ → Task 3,4 ✓
- 色=海色系・実物比較で確定 → Task 5（SHIP_RGB 既定）, Task 9 ✓
- ツールチップ（船名/船種/速度kn/航路°・欠損省略） → Task 5,6 ✓
- 既定OFF・localStorage永続 → Task 7（loadEnabled defaultOff）✓
- パネル swatch diamond・registry・DECK_TO_LAYER・DESCRIPTIONS → Task 5,6,7 ✓
- sw v14→v15 → Task 7 ✓
- pytest/node/e2e/本番Playwright → Task 1,4,5,6,8,10 ✓

**2. Placeholder scan:** 各コードステップは完全コードを掲載。"TBD/後で" なし。Task 9 は意図的な
「実物比較で確定」工程で、確定値の候補（ゴールド/ティール）を明示済み。

**3. Type consistency:** 共有ヘルパ `silhouettePolygon(lon, lat, headingDeg, degLen, verts)` を
flights（`PLANE_VERTS`/`p.heading`）と ships（`SHIP_VERTS`/`p.cog`）が同一シグネチャで使用。
deck レイヤー id（`flights`/`flights-dot`/`ships`/`ships-dot`）と DECK_TO_LAYER のキーが一致。
スナップショットの `points` フィールドは collector（`build_snapshot`）と JS（`buildHullConfig` 等）で一致。
ツールチップ整形は `shipTooltip` を ships.js が定義し registry 経由で解決（`shipsLayer.tooltip`）。
