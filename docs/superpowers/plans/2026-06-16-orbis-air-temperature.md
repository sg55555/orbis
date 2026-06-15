# 気温レイヤー（Air Temperature）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open-Meteo の全球 2m エア温度を定期取得して snapshot 化し、globe 上に連続カラー温度面（半透明・既定OFF）として描く新レイヤーを追加する。

**Architecture:** 既存の registry 駆動・snapshot ポーリング・パネルトグルの延長。Python collector が 5° グリッドを Open-Meteo から取得し `data/snapshots/airtemp.json`（grid+temps）に書く。フロントは `js/layers/airtemp.js` がグリッドを補間して温度カラーの ImageData を焼き、deck.gl `BitmapLayer`（globe 破綻時は SolidPolygon 格子にフォールバック）で全球テクスチャとして描画する。

**Tech Stack:** Python(requests) / vanilla JS ESM / deck.gl 9.3.4 / MapLibre v5 globe / node:test / pytest / Playwright

**前提:** branch `airtemp` で作業（作成済み）。コミットメールは noreply（`210495115+sg55555@users.noreply.github.com`）。各タスクで該当テストを緑にしてから commit。

---

## ファイル構成

- **Create** `collectors/airtemp.py` — グリッド生成・バッチ取得・レスポンス整形・snapshot 構築（純関数＋薄い I/O）
- **Create** `tests/test_airtemp.py` — collector 純関数の pytest
- **Create** `js/layers/airtemp.js` — `tempToColor` / `buildTempField` / `tempAt` / `airtempLayer`
- **Create** `tests/airtemp.test.js` — 上記純関数の node:test
- **Modify** `js/lib/state.js` — `loadEnabled` に `defaultOff` 引数（airtemp を新規ユーザーで既定OFF）
- **Modify** `tests/state.test.js` — `defaultOff` のテスト追加
- **Modify** `js/layers/registry.js` — import・layers 配列・DECK_TO_LAYER・DESCRIPTIONS に airtemp
- **Modify** `js/main.js` — ALL_IDS / POLL_LAYERS / loadEnabled(defaultOff) / counts フォールバック / tooltip closure に airtemp 特例
- **Modify** `css/orbis.css` — `.swatch-gradient`
- **Modify** `.github/workflows/collect.yml` — airtemp 取得ステップ
- **Modify** `sw.js` — CACHE v13 → v14
- **Modify** `tests/e2e/smoke.spec.js` — パネル 6→7 行・airtemp ON で描画確認
- **生成** `data/snapshots/airtemp.json` — 初回スナップショットを一度生成して commit（フロント／e2e／本番の初期データ）

---

## Task 1: Python collector の純関数（グリッド・バッチ・整形）

**Files:**
- Create: `collectors/airtemp.py`
- Test: `tests/test_airtemp.py`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_airtemp.py`:
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.airtemp import build_grid, chunk, parse_temps, build_snapshot, grid_meta

def test_build_grid_is_row_major_lat_outer_lon_inner():
    g = build_grid(-85, 85, -180, 175, 5)
    assert len(g) == 35 * 72        # nLat=35, nLon=72
    assert g[0] == (-85, -180)      # 先頭=最南西
    assert g[1] == (-85, -175)      # lon が内側で先に進む
    assert g[72] == (-80, -180)     # 1行=72点で次の緯度へ

def test_grid_meta_matches():
    m = grid_meta(-85, 85, -180, 175, 5)
    assert m == {"lat0": -85, "lon0": -180, "latStep": 5, "lonStep": 5, "nLat": 35, "nLon": 72}

def test_chunk_splits_into_max_size():
    pts = list(range(450))
    batches = chunk(pts, 200)
    assert [len(b) for b in batches] == [200, 200, 50]

def test_parse_temps_flattens_in_order_with_none_for_missing():
    responses = [
        [{"current": {"temperature_2m": 12.3}}, {"current": {"temperature_2m": -4.0}}],
        [{"current": {}}, {}],   # 欠損 → None / None
    ]
    assert parse_temps(responses) == [12.3, -4.0, None, None]

def test_build_snapshot_shape():
    temps = [1.0, None, 3.0]
    meta = {"lat0": -85, "lon0": -180, "latStep": 5, "lonStep": 5, "nLat": 1, "nLon": 3}
    snap = build_snapshot(temps, meta, "2026-06-16T12:00:00Z")
    assert snap["layer"] == "airtemp"
    assert snap["updated"] == "2026-06-16T12:00:00Z"
    assert snap["grid"] == meta
    assert snap["count"] == 2          # None を除く
    assert snap["temps"] == temps
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `.venv/bin/python -m pytest tests/test_airtemp.py -q`
Expected: FAIL（`ModuleNotFoundError: collectors.airtemp`）

- [ ] **Step 3: 純関数を実装**

`collectors/airtemp.py`（純関数部分のみ。main/fetch は Task 2）:
```python
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `.venv/bin/python -m pytest tests/test_airtemp.py -q`
Expected: PASS（5 passed）

- [ ] **Step 5: commit**

```bash
git add collectors/airtemp.py tests/test_airtemp.py
git commit -m "feat(airtemp): collector純関数（grid/chunk/parse/snapshot）+pytest"
```

---

## Task 2: Python collector の I/O（取得・main）と初回スナップショット生成

**Files:**
- Modify: `collectors/airtemp.py`（fetch_batch / main を追加）
- Modify: `.github/workflows/collect.yml`
- 生成: `data/snapshots/airtemp.json`

- [ ] **Step 1: fetch_batch / main を追記**

`collectors/airtemp.py` の末尾に追加:
```python
SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def fetch_batch(coords, timeout=30):
    """座標群（[(lat,lon),...]）を1リクエストで取得し、座標順の応答リストを返す。"""
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


def main():
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "airtemp.json")
    manifest_path = os.path.join(out_dir, "manifest.json")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    grid = build_grid(LAT0, LAT1, LON0, LON1, STEP)
    meta = grid_meta(LAT0, LAT1, LON0, LON1, STEP)
    responses = []
    try:
        for i, batch in enumerate(chunk(grid, BATCH)):
            responses.append(fetch_batch(batch))
            if i + 1 < (len(grid) + BATCH - 1) // BATCH:
                time.sleep(SLEEP_S)
    except Exception as e:  # 失敗時は前回スナップショットを温存
        print(f"[airtemp] fetch failed: {e}; keeping previous snapshot")
        return 1
    temps = parse_temps(responses)
    if len(temps) != len(grid):  # 期待長と不一致は破棄（堅牢性）
        print(f"[airtemp] length mismatch {len(temps)} != {len(grid)}; abort")
        return 1
    snap = build_snapshot(temps, meta, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False)
    update_manifest(manifest_path, "airtemp", now_iso, snap["count"])
    print(f"[airtemp] wrote {snap['count']}/{len(grid)} temps -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 初回スナップショットを生成**

Run: `.venv/bin/python -m collectors.airtemp`
Expected: `[airtemp] wrote 2520/2520 temps -> .../airtemp.json`（ネットワーク要。欠損ありでも count>2000 程度なら可）

- [ ] **Step 3: 生成物を確認**

Run: `.venv/bin/python -c "import json;d=json.load(open('data/snapshots/airtemp.json'));print(d['grid'],d['count'],len(d['temps']))"`
Expected: `{'lat0': -85, ...} 2520 2520`（temps 長 = 2520）

- [ ] **Step 4: collect.yml に airtemp ステップを追加**

`.github/workflows/collect.yml` の "Collect GDELT events" ステップの直後に追加:
```yaml
      - name: Collect air temperature
        run: python -m collectors.airtemp || echo "airtemp skipped"
```

- [ ] **Step 5: commit**

```bash
git add collectors/airtemp.py .github/workflows/collect.yml data/snapshots/airtemp.json
git commit -m "feat(airtemp): Open-Meteoバッチ取得main+cronステップ+初回snapshot"
```

---

## Task 3: state.js — loadEnabled に defaultOff（airtemp を既定OFF）

**Files:**
- Modify: `js/lib/state.js`
- Test: `tests/state.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`tests/state.test.js` の末尾に追加:
```javascript
test('loadEnabled: stored=null かつ defaultOff 指定で、その id だけ OFF・他は ON', () => {
  const e = loadEnabled(['quakes', 'airtemp'], null, ['airtemp']);
  assert.equal(e.has('quakes'), true);
  assert.equal(e.has('airtemp'), false);
});

test('loadEnabled: stored 指定時は defaultOff を無視し stored を尊重', () => {
  const e = loadEnabled(['quakes', 'airtemp'], ['airtemp'], ['airtemp']);
  assert.deepEqual([...e], ['airtemp']);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/state.test.js`
Expected: FAIL（defaultOff が効かず airtemp が ON のまま）

- [ ] **Step 3: loadEnabled を実装**

`js/lib/state.js` の `loadEnabled` を置き換え:
```javascript
// stored: 有効idの配列（保存形式）。null/不正なら defaultOff を除く全 ON。
export function loadEnabled(allIds, stored, defaultOff = []) {
  if (!Array.isArray(stored)) return new Set(allIds.filter((id) => !defaultOff.includes(id)));
  return new Set(allIds.filter((id) => stored.includes(id)));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/state.test.js`
Expected: PASS（既存テストも含め全 pass）

- [ ] **Step 5: commit**

```bash
git add js/lib/state.js tests/state.test.js
git commit -m "feat(state): loadEnabled に defaultOff（新規ユーザーで既定OFF）"
```

---

## Task 4: airtemp.js — tempToColor（カラーマップ）

**Files:**
- Create: `js/layers/airtemp.js`
- Test: `tests/airtemp.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/airtemp.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempToColor } from '../js/layers/airtemp.js';

test('tempToColor: 各成分が 0..255 の整数3要素を返す', () => {
  const c = tempToColor(15);
  assert.equal(c.length, 3);
  c.forEach((v) => { assert.ok(Number.isInteger(v) && v >= 0 && v <= 255); });
});

test('tempToColor: 寒い(-40)は青寄り・暑い(40)は赤寄り', () => {
  const cold = tempToColor(-40);
  const hot = tempToColor(40);
  assert.ok(cold[2] > cold[0]);  // 青 > 赤
  assert.ok(hot[0] > hot[2]);    // 赤 > 青
});

test('tempToColor: レンジ外はクランプ（-100 は -40 と同じ、100 は 40 と同じ）', () => {
  assert.deepEqual(tempToColor(-100), tempToColor(-40));
  assert.deepEqual(tempToColor(100), tempToColor(40));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/airtemp.test.js`
Expected: FAIL（モジュール無し）

- [ ] **Step 3: 最小実装**

`js/layers/airtemp.js`:
```javascript
// 気温レイヤー。Open-Meteo の全球 5° グリッド温度(grid+temps)を補間して温度カラーの面を描く。
// 描画: 既定は deck.gl BitmapLayer（全球テクスチャ）。globe で破綻する場合は SolidPolygon 格子に
// フォールバック（実物検証で確定。IconLayer が globe 全滅した前例を踏まえた姿勢）。

const TMIN = -40, TMAX = 40;
// 寒色→暖色（青→シアン→緑→黄→橙→赤）。気温図風の連続グラデ。
const STOPS = [
  [0.0, [40, 90, 200]], [0.2, [42, 150, 255]], [0.4, [30, 220, 210]],
  [0.55, [110, 230, 120]], [0.7, [255, 230, 90]], [0.85, [255, 160, 60]], [1.0, [255, 70, 55]],
];

// stops（[[t,[r,g,b]],...]）上で t を線形補間（クランプ）。純粋・自己完結。
function lerpStops(stops, t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  let a = stops[0], b = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
  }
  const span = b[0] - a[0] || 1;
  const k = (x - a[0]) / span;
  return [0, 1, 2].map((j) => Math.round(a[1][j] + (b[1][j] - a[1][j]) * k));
}

// 摂氏温度 → [r,g,b]（-40..40 を 0..1 に正規化してクランプ）。
export function tempToColor(tempC) {
  return lerpStops(STOPS, (tempC - TMIN) / (TMAX - TMIN));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/airtemp.test.js`
Expected: PASS（3 pass）

- [ ] **Step 5: commit**

```bash
git add js/layers/airtemp.js tests/airtemp.test.js
git commit -m "feat(airtemp): tempToColor カラーマップ+node test"
```

---

## Task 5: airtemp.js — tempAt（グリッド最寄り値・ホバー用）

**Files:**
- Modify: `js/layers/airtemp.js`
- Test: `tests/airtemp.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`tests/airtemp.test.js` の末尾に追加:
```javascript
import { tempAt } from '../js/layers/airtemp.js';

const SNAP = {
  grid: { lat0: 0, lon0: 0, latStep: 10, lonStep: 10, nLat: 2, nLon: 2 },
  // row-major: (0,0)=10, (0,10)=20, (10,0)=null, (10,10)=40
  temps: [10, 20, null, 40],
};

test('tempAt: 最寄りグリッド値を返す', () => {
  assert.equal(tempAt(SNAP, 1, 1), 10);    // (0,0) に最寄り
  assert.equal(tempAt(SNAP, 1, 9), 20);    // (0,10) に最寄り
  assert.equal(tempAt(SNAP, 9, 9), 40);    // (10,10) に最寄り
});

test('tempAt: null セルは null', () => {
  assert.equal(tempAt(SNAP, 9, 1), null);  // (10,0)=null
});

test('tempAt: グリッド外は null', () => {
  assert.equal(tempAt(SNAP, 200, 200), null);
  assert.equal(tempAt(null, 0, 0), null);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/airtemp.test.js`
Expected: FAIL（tempAt 未定義）

- [ ] **Step 3: tempAt を実装**

`js/layers/airtemp.js` の `tempToColor` の後に追加:
```javascript
// 緯度経度に最も近いグリッドセルの温度を返す（ホバー用）。範囲外/欠損は null。
export function tempAt(snapshot, lat, lon) {
  if (!snapshot || !snapshot.grid || !snapshot.temps) return null;
  const { lat0, lon0, latStep, lonStep, nLat, nLon } = snapshot.grid;
  const i = Math.round((lat - lat0) / latStep);
  const j = Math.round((lon - lon0) / lonStep);
  if (i < 0 || i >= nLat || j < 0 || j >= nLon) return null;
  const v = snapshot.temps[i * nLon + j];
  return v == null ? null : v;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/airtemp.test.js`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add js/layers/airtemp.js tests/airtemp.test.js
git commit -m "feat(airtemp): tempAt グリッド最寄り値（ホバー用）"
```

---

## Task 6: airtemp.js — buildTempField（グリッド→補間RGBAピクセル）

**Files:**
- Modify: `js/layers/airtemp.js`
- Test: `tests/airtemp.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`tests/airtemp.test.js` の末尾に追加:
```javascript
import { buildTempField } from '../js/layers/airtemp.js';

const FULL = {
  grid: { lat0: -45, lon0: -90, latStep: 90, lonStep: 90, nLat: 2, nLon: 3 },
  temps: [-40, 0, 40, -40, 0, 40], // 全セル有効
};

test('buildTempField: w*h*4 の Uint8ClampedArray を返し、有効領域は alpha=255', () => {
  const w = 6, h = 4;
  const px = buildTempField(FULL, w, h);
  assert.ok(px instanceof Uint8ClampedArray);
  assert.equal(px.length, w * h * 4);
  // 中央付近のピクセルは不透明
  const mid = ((Math.floor(h / 2) * w) + Math.floor(w / 2)) * 4;
  assert.equal(px[mid + 3], 255);
});

test('buildTempField: 全 null セルは透明(alpha=0)', () => {
  const empty = { grid: FULL.grid, temps: [null, null, null, null, null, null] };
  const px = buildTempField(empty, 4, 2);
  for (let i = 0; i < px.length; i += 4) assert.equal(px[i + 3], 0);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/airtemp.test.js`
Expected: FAIL（buildTempField 未定義）

- [ ] **Step 3: buildTempField を実装**

`js/layers/airtemp.js` の `tempAt` の後に追加:
```javascript
function cell(temps, nLon, i, j) { return temps[i * nLon + j]; }

// (lat,lon) をグリッド上で双線形補間。周囲4セルに null があれば非null近傍へフォールバック、全 null は null。
function bilinear(grid, temps, lat, lon) {
  const { lat0, lon0, latStep, lonStep, nLat, nLon } = grid;
  let fi = Math.max(0, Math.min(nLat - 1, (lat - lat0) / latStep));
  let fj = Math.max(0, Math.min(nLon - 1, (lon - lon0) / lonStep));
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const i1 = Math.min(nLat - 1, i0 + 1), j1 = Math.min(nLon - 1, j0 + 1);
  const di = fi - i0, dj = fj - j0;
  const c00 = cell(temps, nLon, i0, j0), c01 = cell(temps, nLon, i0, j1);
  const c10 = cell(temps, nLon, i1, j0), c11 = cell(temps, nLon, i1, j1);
  if ([c00, c01, c10, c11].some((v) => v == null)) {
    const ok = [c00, c01, c10, c11].filter((v) => v != null);
    return ok.length ? ok[0] : null;
  }
  const top = c00 + (c01 - c00) * dj;
  const bot = c10 + (c11 - c10) * dj;
  return top + (bot - top) * di;
}

// グリッドを w×h ピクセルへ補間し、温度カラーの RGBA 配列を返す（BitmapLayer の ImageData 元）。
// 画像 row 0 = 北(lat=+90)。null セルは透明(alpha=0)。
export function buildTempField(snapshot, w, h) {
  const { grid, temps } = snapshot;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let py = 0; py < h; py++) {
    const lat = 90 - (py + 0.5) * (180 / h);
    for (let px = 0; px < w; px++) {
      const lon = -180 + (px + 0.5) * (360 / w);
      const t = bilinear(grid, temps, lat, lon);
      const idx = (py * w + px) * 4;
      if (t == null) { out[idx + 3] = 0; continue; }
      const [r, g, b] = tempToColor(t);
      out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = 255;
    }
  }
  return out;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/airtemp.test.js`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add js/layers/airtemp.js tests/airtemp.test.js
git commit -m "feat(airtemp): buildTempField 双線形補間→RGBAピクセル"
```

---

## Task 7: airtemp.js — airtempLayer（BitmapLayer 描画・レイヤー定義）

**Files:**
- Modify: `js/layers/airtemp.js`
- Test: `tests/airtemp.test.js`

- [ ] **Step 1: 失敗するテストを追記（レイヤーメタの検証）**

`tests/airtemp.test.js` の末尾に追加:
```javascript
import { airtempLayer } from '../js/layers/airtemp.js';

test('airtempLayer: id/label/marker/legend/feed のメタを持つ', () => {
  assert.equal(airtempLayer.id, 'airtemp');
  assert.equal(airtempLayer.label, '気温');
  assert.equal(airtempLayer.marker, 'gradient');
  assert.ok(Array.isArray(airtempLayer.legend) && airtempLayer.legend.length >= 2);
  assert.deepEqual(airtempLayer.toFeedItems(), []);   // フィードには出さない
  assert.equal(airtempLayer.tooltip(), null);         // tooltip は main.js が座標から生成
});

test('airtempLayer.toDeckLayer: grid 無しスナップショットは空配列', () => {
  assert.deepEqual(airtempLayer.toDeckLayer({}), []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/airtemp.test.js`
Expected: FAIL（airtempLayer 未定義）

- [ ] **Step 3: airtempLayer を実装**

`js/layers/airtemp.js` の末尾に追加（`deck` / `document` / `ImageData` はブラウザのみ。node テストは toDeckLayer を grid 無しで早期 return させるため安全）:
```javascript
const FIELD_W = 360, FIELD_H = 180;   // 5°グリッド(72x35)を1°相当へ補間
let _bmp = { ts: null, image: null };

// snapshot.ts ごとに温度カラーの canvas を一度だけ生成してキャッシュ（再描画時の負荷を抑える）。
function fieldImage(snapshot) {
  if (_bmp.ts === snapshot.updated && _bmp.image) return _bmp.image;
  const data = buildTempField(snapshot, FIELD_W, FIELD_H);
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(FIELD_W, FIELD_H)
    : Object.assign(document.createElement('canvas'), { width: FIELD_W, height: FIELD_H });
  canvas.getContext('2d').putImageData(new ImageData(data, FIELD_W, FIELD_H), 0, 0);
  _bmp = { ts: snapshot.updated, image: canvas };
  return canvas;
}

export const airtempLayer = {
  id: 'airtemp',
  label: '気温',
  marker: 'gradient',
  legend: [
    { color: 'rgb(42,150,255)', label: '寒い' },
    { color: 'rgb(110,230,120)', label: '0°C 付近' },
    { color: 'rgb(255,70,55)', label: '暑い' },
  ],
  toDeckLayer(snapshot, _ctx) {
    if (!snapshot || !snapshot.grid || !snapshot.temps) return [];
    return [new deck.BitmapLayer({
      id: 'airtemp',
      image: fieldImage(snapshot),
      bounds: [-180, -90, 180, 90],
      opacity: 0.45,
      pickable: true,
    })];
  },
  // ツールチップは BitmapLayer のピック object に座標が無いため、main.js が info.coordinate + tempAt で生成。
  tooltip() { return null; },
  toFeedItems() { return []; },
};
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/airtemp.test.js`
Expected: PASS

- [ ] **Step 5: commit**

```bash
git add js/layers/airtemp.js tests/airtemp.test.js
git commit -m "feat(airtemp): airtempLayer（BitmapLayer全球テクスチャ・既定opacity0.45）"
```

---

## Task 8: registry.js に airtemp を登録

**Files:**
- Modify: `js/layers/registry.js`
- Test: `tests/registry.test.js`（既存が緑のままであることの確認）

- [ ] **Step 1: registry を編集**

`js/layers/registry.js`:
1. import 追加（currents の下）:
```javascript
import { airtempLayer } from './airtemp.js';
```
2. layers 配列に追加（末尾）:
```javascript
export const layers = [quakesLayer, flightsLayer, conflictLayer, protestsLayer, tradeLayer, currentsLayer, airtempLayer];
```
3. DECK_TO_LAYER に追加（`currents: 'currents',` の後）:
```javascript
  currents: 'currents', airtemp: 'airtemp',
```
4. DESCRIPTIONS に追加（`currents:` の後）:
```javascript
  airtemp: '全球の気温（Open-Meteo・色=暖/寒の連続グラデ・半透明）',
```

- [ ] **Step 2: 既存テストが緑のままか確認**

Run: `node --test tests/registry.test.js tests/airtemp.test.js`
Expected: PASS（registry の純関数テストは layers 差し替えで動くため影響なし）

- [ ] **Step 3: commit**

```bash
git add js/layers/registry.js
git commit -m "feat(airtemp): registry登録（layers/DECK_TO_LAYER/DESCRIPTIONS）"
```

---

## Task 9: main.js 配線（ALL_IDS / POLL / 既定OFF / counts / tooltip）

**Files:**
- Modify: `js/main.js`

- [ ] **Step 1: import と定数を編集**

`js/main.js`:
1. airtemp の純関数 import を追加（registry import の下あたり）:
```javascript
import { tempAt } from './layers/airtemp.js';
```
2. `POLL_LAYERS` に airtemp を追加:
```javascript
const POLL_LAYERS = ['quakes', 'flights', 'conflict', 'protests', 'airtemp']; // スナップショットを持つ層
```
3. `ALL_IDS` に airtemp を追加:
```javascript
const ALL_IDS = ['quakes', 'flights', 'conflict', 'protests', 'trade', 'currents', 'airtemp'];
```
4. `loadEnabled` 呼び出しを既定OFF付きに:
```javascript
let ENABLED = loadEnabled(ALL_IDS, readStored(), ['airtemp']);
```

- [ ] **Step 2: counts フォールバックに temps を追加**

`rebuild` 内の counts 構築行を置き換え（grid+temps 型のレイヤーの件数を有効セル数にする）:
```javascript
  window.__orbis.counts = Object.fromEntries(
    Object.entries(snapshots).map(([k, v]) => [k,
      (v && (v.points?.length ?? v.features?.length
        ?? (Array.isArray(v.temps) ? v.temps.filter((t) => t != null).length : 0))) ?? 0])
  );
```

- [ ] **Step 3: tooltip closure に airtemp 特例を追加**

`boot` 内の `initMap('map', ...)` 第2引数（getTooltip）を置き換え:
```javascript
    (info) => {
      if (!info || !info.layer) return null;
      if (info.layer.id === 'airtemp') {
        const c = info.coordinate;
        if (!c) return null;
        const t = tempAt(snapshots.airtemp, c[1], c[0]);
        return t == null ? null : `気温 ${Math.round(t)}°C｜${c[1].toFixed(0)}, ${c[0].toFixed(0)}`;
      }
      return info.object ? tooltipFor(info.layer.id, info.object) : null;
    },
```

- [ ] **Step 4: 構文チェック（ローカルサーバで起動確認は Task 12 で実施）**

Run: `node --check js/main.js`
Expected: エラーなし（終了コード0）

- [ ] **Step 5: commit**

```bash
git add js/main.js
git commit -m "feat(airtemp): main配線（POLL/ALL_IDS/既定OFF/counts/座標ツールチップ）"
```

---

## Task 10: パネルの gradient スウォッチ（CSS）

**Files:**
- Modify: `css/orbis.css`

- [ ] **Step 1: .swatch-gradient を追加**

`css/orbis.css` の `.layer-row .swatch-line { ... }` の行の直後に追加:
```css
.layer-row .swatch-gradient { width: 16px; height: 8px; border-radius: 2px; box-shadow: 0 0 6px rgba(120,200,255,.5);
  background: linear-gradient(90deg, rgb(42,150,255), rgb(30,220,210), rgb(110,230,120), rgb(255,230,90), rgb(255,70,55)); }
```

- [ ] **Step 2: commit**

```bash
git add css/orbis.css
git commit -m "feat(airtemp): パネルの温度グラデ swatch-gradient"
```

---

## Task 11: Service Worker キャッシュ版を v14 へ

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: CACHE 版を上げる**

`sw.js` の1行を置き換え:
```javascript
const CACHE = 'orbis-v14';
```

- [ ] **Step 2: commit**

```bash
git add sw.js
git commit -m "chore(sw): cache v14（気温レイヤー）"
```

---

## Task 12: e2e smoke を更新（パネル7行・airtemp ON で描画）

**Files:**
- Modify: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: パネル行数を 6→7 に変更**

`tests/e2e/smoke.spec.js` の該当行を置き換え:
```javascript
  // 左パネルに7レイヤー行（地震/航空/紛争/抗議/貿易/海流/気温）
  await expect(page.locator('#panel .layer-row')).toHaveCount(7);
```

- [ ] **Step 2: airtemp の既定OFF→ON描画チェックを追加**

`smoke.spec.js` の最後（`// 海流(currents)が deck に描画されている` ブロックの後、末尾コメントの前）に追加:
```javascript
  // 気温(airtemp)は既定OFF。ON にすると BitmapLayer(or 格子) が deck に描画される。
  await expect(page.locator('.layer-row[data-id="airtemp"] .layer-toggle')).not.toBeChecked();
  await page.locator('.layer-row[data-id="airtemp"] .layer-toggle').check();
  await page.waitForTimeout(400);
  const hasAirtemp = await page.evaluate(() => {
    const o = window.__orbis.overlay;
    return ((o._props && o._props.layers) || []).some((l) => l.id === 'airtemp');
  });
  expect(hasAirtemp).toBe(true);
```

- [ ] **Step 3: e2e を実行**

Run: `npx playwright test tests/e2e/smoke.spec.js`
Expected: PASS（airtemp.json が Task 2 で生成・commit 済みのため描画される）

- [ ] **Step 4: commit**

```bash
git add tests/e2e/smoke.spec.js
git commit -m "test(airtemp): e2e パネル7行+airtemp ON描画チェック"
```

---

## Task 13: 全テスト＋実物検証（BitmapLayer の globe 確認・必要なら格子フォールバック）

**Files:**
- 検証のみ（破綻時のみ `js/layers/airtemp.js` を修正）

- [ ] **Step 1: 全ユニット＋pytest を実行**

Run: `node --test tests/*.test.js && .venv/bin/python -m pytest tests/ -q`
Expected: 全 PASS（既存 + airtemp 新規）

- [ ] **Step 2: ローカルサーバで実物確認**

Run: `python3 -m http.server 8765`（バックグラウンド）→ Playwright スクショ
- 確認: airtemp を ON にして globe 全体が温度色のグラデで半透明に染まる／他レイヤー（地震/航空）が上に見える／コンソールエラー0。
- 引き（zoom<1 の globe ビュー）と寄り（欧州など）でスクショ目視。

- [ ] **Step 3: globe で BitmapLayer が破綻していないか判定**

- **正常（テクスチャが球面に正しく貼れている）** → 何もせず Step 5 へ。
- **破綻（平面投影で歪む／表示されない／エラー）** → Step 4 のフォールバックを適用。

- [ ] **Step 4: （破綻時のみ）SolidPolygon 格子へフォールバック**

`js/layers/airtemp.js` の `toDeckLayer` を下記に差し替え、`fieldImage` は未使用になっても残置可（将来の再検証用）:
```javascript
  toDeckLayer(snapshot, _ctx) {
    if (!snapshot || !snapshot.grid || !snapshot.temps) return [];
    const { grid, temps } = snapshot;
    const { lat0, lon0, latStep, lonStep, nLat, nLon } = grid;
    const a = latStep / 2, b = lonStep / 2;
    const cells = [];
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const t = temps[i * nLon + j];
        if (t == null) continue;
        const la = lat0 + i * latStep, lo = lon0 + j * lonStep;
        cells.push({
          polygon: [[lo - b, la - a], [lo + b, la - a], [lo + b, la + a], [lo - b, la + a]],
          rgb: tempToColor(t),
        });
      }
    }
    return [new deck.SolidPolygonLayer({
      id: 'airtemp', data: cells, getPolygon: (d) => d.polygon,
      getFillColor: (d) => [d.rgb[0], d.rgb[1], d.rgb[2], 115], // ~0.45 相当
      stroked: false, filled: true, pickable: true,
    })];
  },
```
再度 Step 2 のスクショで滑らかさ・globe 整合を確認。確定後 commit:
```bash
git add js/layers/airtemp.js
git commit -m "fix(airtemp): globeでBitmap破綻のためSolidPolygon格子に切替（実物検証）"
```

- [ ] **Step 5: 実物確認結果を記録して完了**

確認した方式（BitmapLayer or 格子）・スクショ所見をメモ。次は finishing-a-development-branch でマージ判断。

---

## Self-Review

- **Spec coverage**: データ取得(T1,2)/グリッド5°(T1)/snapshot形式(T1)/cron(T2)/連続カラー面(T4,6,7)/BitmapLayer第一候補+格子フォールバック(T7,13)/配色-40〜40°C(T4)/opacity0.45(T7)/既定OFF(T3,9)/パネルトグル+gradientスウォッチ(T8,10)/凡例(T7 legend)/ホバー温度(T5,9)/テスト(各T)/sw v14(T11)/本番検証(T13) — 全項目にタスク対応あり。
- **Placeholder scan**: 各コード手順に実コードを記載。フォールバック(T13 S4)も完全コードで条件適用。プレースホルダなし。
- **Type consistency**: snapshot 形状 `{layer,updated,grid:{lat0,lon0,latStep,lonStep,nLat,nLon},count,temps[]}` が collector(T1) / buildTempField・tempAt(T5,6) / フォールバック(T13) で一致。`fieldImage` のキャッシュキーは `snapshot.updated`（snapshot に ts ではなく updated を採用）で統一。レイヤー id は描画/registry/e2e すべて `airtemp`。
