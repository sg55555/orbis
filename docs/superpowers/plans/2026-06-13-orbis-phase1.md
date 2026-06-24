# ORBIS Phase 1（基盤）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 動く地球儀（MapLibre globe + deck.gl）の上に USGS 地震データを1レイヤー表示し、収集(cron)→静的JSON→クライアント描画の全経路を疎通させる、デプロイ可能な最小ダッシュボードを作る。

**Architecture:** 収集は GitHub Actions の Python スクリプトが USGS を取得して `data/snapshots/quakes.json` と `manifest.json` を書き出す（news-digest/nexus と同パターン）。Vercel は静的ホスティングのみ（関数ゼロ）。ブラウザの Vanilla JS（ESモジュール）が snapshot を取得し、deck.gl の ScatterplotLayer で地震を描画。レイヤーは統一インターフェース（`{ id, fetch, toDeckLayer, legend }`）の最初の実装として作り、Phase 2 以降はこのI/Fに沿ってファイル追加するだけで拡張できる。

**Tech Stack:** Vanilla JS (ESM, no build step) / MapLibre GL JS (CDN, globe projection) / deck.gl (CDN, MapboxOverlay) / Python 3 (requests) / pytest / node:test / Playwright / GitHub Actions / Vercel 静的。

---

## ファイル構成（Phase 1 で作成するもの）

```
orbis/
├── index.html                 # SPA本体（CDN読み込み + #map + 凡例 + ローディング）
├── css/orbis.css              # Aurora テーマ（濃紺・ネオン・ガラス）基礎
├── js/
│   ├── main.js                # エントリ：マップ初期化→レイヤー登録→ポーリング
│   ├── map.js                 # MapLibre globe + deck.gl MapboxOverlay 初期化
│   ├── snapshot.js            # snapshot/manifest 取得・ポーリング・鮮度
│   ├── lib/geo.js             # 純粋関数（mag→半径/色、鮮度整形）★テスト対象
│   └── layers/
│       ├── registry.js        # レイヤー登録・統一I/F
│       └── quakes.js          # 地震レイヤー（buildScatterConfig=純粋部 ★テスト対象）
├── collectors/
│   ├── quakes.py              # USGS取得→snapshot書き出し（transform=純粋部 ★テスト対象）
│   └── lib/manifest.py        # manifest 読み書きヘルパ ★テスト対象
├── scripts/make_icons.py      # PWAアイコン生成（Pillow）
├── data/snapshots/
│   └── .gitkeep
├── tests/
│   ├── test_quakes.py         # pytest：USGS transform / snapshot
│   ├── test_manifest.py       # pytest：manifest マージ
│   ├── geo.test.js            # node:test：mag→半径/色・鮮度
│   ├── quakes.test.js         # node:test：buildScatterConfig
│   └── e2e/smoke.spec.js      # Playwright：globe + 地震点が描画される
├── manifest.webmanifest
├── sw.js
├── vercel.json
├── .vercelignore
├── package.json               # type:module / node:test / playwright / serve
├── playwright.config.js
├── requirements.txt           # requests
└── .github/workflows/collect.yml
```

**疎結合の原則:** 1ソース=1収集スクリプト=1スナップショットJSON=1フロントレイヤー。純粋変換部（transform / buildScatterConfig / geo）を副作用から分離してユニットテスト可能にする。レンダリングは Playwright で疎通確認。

**mistakes.md の反映:**
- 本番配信する `data/snapshots/*.json` と `manifest.json` は **git 追跡必須・`.gitignore` 禁止**。
- e2e は snapshot を**書き換えない**（読み取りのみ）。フィクスチャで本番配信データを上書きしない。
- Vercel 静的デプロイは `vercel.json` + `.vercelignore` を最初から用意（Python 誤検知対策）。コミット作者メールは GitHub 一致（設定済: 210495115+sg55555@users.noreply.github.com）。

---

### Task 1: プロジェクト雛形とツールチェーン

**Files:**
- Create: `package.json`, `requirements.txt`, `vercel.json`, `.vercelignore`, `playwright.config.js`, `data/snapshots/.gitkeep`

- [ ] **Step 1: `package.json` を作成**

```json
{
  "name": "orbis",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test:js": "node --test tests/",
    "test:e2e": "playwright test",
    "serve": "python3 -m http.server 8000"
  },
  "devDependencies": {
    "@playwright/test": "^1.48.0"
  }
}
```

- [ ] **Step 2: `requirements.txt` を作成**

```
requests>=2.31.0
Pillow>=10.0.0
```

- [ ] **Step 3: `vercel.json` を作成（静的SPA・関数なし）**

```json
{
  "version": 2,
  "cleanUrls": true,
  "headers": [
    {
      "source": "/data/snapshots/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=60" }]
    }
  ],
  "rewrites": [{ "source": "/((?!data/|js/|css/|icons/).*)", "destination": "/index.html" }]
}
```

- [ ] **Step 4: `.vercelignore` を作成（Python誤検知・不要物除外）**

```
collectors/
scripts/
tests/
.github/
requirements.txt
playwright.config.js
package.json
docs/
node_modules/
.superpowers/
```

- [ ] **Step 5: `playwright.config.js` を作成**

```javascript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  use: { baseURL: 'http://localhost:8000', headless: true },
  webServer: {
    command: 'python3 -m http.server 8000',
    url: 'http://localhost:8000',
    reuseExistingServer: true,
    timeout: 30000,
  },
});
```

- [ ] **Step 6: `data/snapshots/.gitkeep` を作成（空ファイル）**

- [ ] **Step 7: 依存をインストール**

Run: `cd ~/apps/orbis && pip install -r requirements.txt && npm install && npx playwright install chromium`
Expected: 成功（requests/Pillow/Playwright が入る）

- [ ] **Step 8: Commit**

```bash
git add package.json requirements.txt vercel.json .vercelignore playwright.config.js data/snapshots/.gitkeep
git commit -m "chore: scaffold orbis phase 1 toolchain"
```

---

### Task 2: USGS 地震データ変換（Python・純粋関数 TDD）

**Files:**
- Create: `collectors/quakes.py`
- Test: `tests/test_quakes.py`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_quakes.py`:
```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.quakes import transform, build_snapshot

SAMPLE = {
    "features": [
        {
            "id": "us1000",
            "geometry": {"coordinates": [139.7, 35.6, 30.0]},
            "properties": {"mag": 5.2, "place": "near Tokyo", "time": 1700000000000,
                           "url": "https://example.com/us1000"},
        },
        # mag が None → 除外
        {"id": "x", "geometry": {"coordinates": [0, 0, 0]}, "properties": {"mag": None}},
        # 座標不足 → 除外
        {"id": "y", "geometry": {"coordinates": [1]}, "properties": {"mag": 3.0}},
    ]
}

def test_transform_filters_invalid_and_maps_fields():
    pts = transform(SAMPLE)
    assert len(pts) == 1
    p = pts[0]
    assert p["id"] == "us1000"
    assert p["lon"] == 139.7 and p["lat"] == 35.6 and p["depth"] == 30.0
    assert p["mag"] == 5.2 and p["place"] == "near Tokyo"
    assert p["time"] == 1700000000000
    assert p["url"] == "https://example.com/us1000"

def test_build_snapshot_shape():
    pts = transform(SAMPLE)
    snap = build_snapshot(pts, "2026-06-13T12:00:00Z")
    assert snap["layer"] == "quakes"
    assert snap["updated"] == "2026-06-13T12:00:00Z"
    assert snap["count"] == 1
    assert snap["points"] == pts
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/apps/orbis && python -m pytest tests/test_quakes.py -v`
Expected: FAIL（`ModuleNotFoundError: collectors.quakes` または ImportError）

- [ ] **Step 3: 最小実装を書く**

`collectors/quakes.py`:
```python
"""USGS 地震フィードを取得して data/snapshots/quakes.json に書き出す。"""
import json
import os
from datetime import datetime, timezone

USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"


def transform(geojson):
    """USGS GeoJSON を ORBIS の軽量 points 配列に変換する（純粋関数）。"""
    points = []
    for f in (geojson.get("features") or []):
        geom = f.get("geometry") or {}
        coords = geom.get("coordinates") or []
        props = f.get("properties") or {}
        if len(coords) < 2:
            continue
        if props.get("mag") is None:
            continue
        points.append({
            "id": f.get("id"),
            "lon": coords[0],
            "lat": coords[1],
            "depth": coords[2] if len(coords) > 2 else None,
            "mag": props.get("mag"),
            "place": props.get("place"),
            "time": props.get("time"),
            "url": props.get("url"),
        })
    return points


def build_snapshot(points, updated_iso):
    """配信用スナップショット dict を組み立てる（純粋関数）。"""
    return {
        "layer": "quakes",
        "updated": updated_iso,
        "count": len(points),
        "points": points,
    }
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/apps/orbis && python -m pytest tests/test_quakes.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**

```bash
git add collectors/quakes.py tests/test_quakes.py
git commit -m "feat: USGS earthquake transform (pure)"
```

---

### Task 3: manifest ヘルパと収集CLI（Python TDD）

**Files:**
- Create: `collectors/lib/manifest.py`, `collectors/lib/__init__.py`（空）
- Modify: `collectors/quakes.py`（`fetch` と `main` を追加）
- Test: `tests/test_manifest.py`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_manifest.py`:
```python
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.lib.manifest import update_manifest

def test_update_manifest_creates_and_merges(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "quakes", "2026-06-13T12:00:00Z", 5)
    update_manifest(str(path), "ships", "2026-06-13T12:01:00Z", 99)
    data = json.loads(path.read_text())
    assert data["layers"]["quakes"] == {"updated": "2026-06-13T12:00:00Z", "count": 5}
    assert data["layers"]["ships"]["count"] == 99

def test_update_manifest_overwrites_same_layer(tmp_path):
    path = tmp_path / "manifest.json"
    update_manifest(str(path), "quakes", "t1", 1)
    update_manifest(str(path), "quakes", "t2", 7)
    data = json.loads(path.read_text())
    assert data["layers"]["quakes"] == {"updated": "t2", "count": 7}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/apps/orbis && python -m pytest tests/test_manifest.py -v`
Expected: FAIL（`ModuleNotFoundError: collectors.lib.manifest`）

- [ ] **Step 3: 最小実装を書く**

`collectors/lib/__init__.py`: 空ファイルを作成。

`collectors/lib/manifest.py`:
```python
"""配信スナップショットの鮮度を集約する manifest.json の読み書き。"""
import json
import os


def update_manifest(path, layer, updated_iso, count):
    """manifest.json を読み（無ければ作り）、指定レイヤーのエントリを更新して書き戻す。"""
    data = {"layers": {}}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    data.setdefault("layers", {})[layer] = {"updated": updated_iso, "count": count}
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/apps/orbis && python -m pytest tests/test_manifest.py -v`
Expected: PASS（2 件）

- [ ] **Step 5: `quakes.py` に取得・書き出しの実行部を追加**

`collectors/quakes.py` の末尾に追記:
```python
import requests
from collectors.lib.manifest import update_manifest

SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")


def fetch(url=USGS_URL, timeout=30):
    """USGS から GeoJSON を取得する。"""
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def main():
    out_dir = os.path.abspath(SNAPSHOT_DIR)
    os.makedirs(out_dir, exist_ok=True)
    snap_path = os.path.join(out_dir, "quakes.json")
    manifest_path = os.path.join(out_dir, "..", "..", "data", "snapshots", "manifest.json")
    manifest_path = os.path.abspath(os.path.join(out_dir, "manifest.json"))
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        points = transform(fetch())
    except Exception as e:  # 失敗時は前回スナップショットを温存（堅牢性）
        print(f"[quakes] fetch/transform failed: {e}; keeping previous snapshot")
        return 1
    snap = build_snapshot(points, now_iso)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=2)
    update_manifest(manifest_path, "quakes", now_iso, len(points))
    print(f"[quakes] wrote {len(points)} points -> {snap_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: 実データで1回走らせ、初期スナップショットを生成（e2eが読む本番配信データ）**

Run: `cd ~/apps/orbis && python -m collectors.quakes`
Expected: `[quakes] wrote N points -> .../data/snapshots/quakes.json`（N>0）。`data/snapshots/quakes.json` と `manifest.json` が生成される。

- [ ] **Step 7: Commit（生成された本番スナップショットも追跡する）**

```bash
git add collectors/lib/__init__.py collectors/lib/manifest.py collectors/quakes.py \
        tests/test_manifest.py data/snapshots/quakes.json data/snapshots/manifest.json
git commit -m "feat: quake collector writes snapshot + manifest"
```

---

### Task 4: フロント純粋ヘルパ geo.js（node:test TDD）

**Files:**
- Create: `js/lib/geo.js`
- Test: `tests/geo.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/geo.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { magnitudeToRadius, magnitudeToColor, formatFreshness } from '../js/lib/geo.js';

test('magnitudeToRadius is floored at 3 and grows with magnitude', () => {
  assert.equal(magnitudeToRadius(0), 3);
  assert.equal(magnitudeToRadius(1), 3);
  assert.equal(magnitudeToRadius(5), 18); // round(5^1.8)=18
});

test('magnitudeToColor maps to aurora palette bands', () => {
  assert.deepEqual(magnitudeToColor(1), [57, 208, 255]);   // < 2 cyan
  assert.deepEqual(magnitudeToColor(3), [94, 255, 166]);   // 2-4 green
  assert.deepEqual(magnitudeToColor(5), [255, 176, 40]);   // 4-6 amber
  assert.deepEqual(magnitudeToColor(7), [255, 60, 80]);    // >=6 red
  assert.deepEqual(magnitudeToColor(6), [255, 60, 80]);    // 境界6は赤
});

test('formatFreshness renders Japanese relative time', () => {
  const now = Date.parse('2026-06-13T12:00:00Z');
  assert.equal(formatFreshness('2026-06-13T11:59:30Z', now), 'たった今');
  assert.equal(formatFreshness('2026-06-13T11:57:00Z', now), '3分前');
  assert.equal(formatFreshness('2026-06-13T10:00:00Z', now), '2時間前');
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/apps/orbis && node --test tests/geo.test.js`
Expected: FAIL（`Cannot find module '../js/lib/geo.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/lib/geo.js`:
```javascript
// 地図描画用の純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。

export function magnitudeToRadius(mag) {
  const m = Number(mag) || 0;
  return Math.round(Math.max(3, Math.pow(m, 1.8)));
}

export function magnitudeToColor(mag) {
  const m = Number(mag) || 0;
  if (m < 2) return [57, 208, 255];    // cyan
  if (m < 4) return [94, 255, 166];    // green
  if (m < 6) return [255, 176, 40];    // amber
  return [255, 60, 80];                // red
}

export function formatFreshness(updatedIso, now = Date.now()) {
  const diffSec = Math.max(0, Math.floor((now - Date.parse(updatedIso)) / 1000));
  if (diffSec < 60) return 'たった今';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}分前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}時間前`;
  return `${Math.floor(diffSec / 86400)}日前`;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/apps/orbis && node --test tests/geo.test.js`
Expected: PASS（3 件）

- [ ] **Step 5: Commit**

```bash
git add js/lib/geo.js tests/geo.test.js
git commit -m "feat: geo helpers (radius/color/freshness)"
```

---

### Task 5: 地震レイヤーモジュールとレジストリ（node:test TDD）

**Files:**
- Create: `js/layers/quakes.js`, `js/layers/registry.js`
- Test: `tests/quakes.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/quakes.test.js`:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScatterConfig } from '../js/layers/quakes.js';

const SNAP = {
  layer: 'quakes', updated: '2026-06-13T12:00:00Z', count: 1,
  points: [{ id: 'a', lon: 139.7, lat: 35.6, depth: 30, mag: 5, place: 'Tokyo', time: 1, url: 'u' }],
};

test('buildScatterConfig produces deck-compatible props from a snapshot', () => {
  const cfg = buildScatterConfig(SNAP);
  assert.equal(cfg.id, 'quakes');
  assert.deepEqual(cfg.data, SNAP.points);
  assert.equal(cfg.radiusUnits, 'pixels');
  // アクセサが座標・半径・色を返す
  const p = SNAP.points[0];
  assert.deepEqual(cfg.getPosition(p), [139.7, 35.6]);
  assert.equal(cfg.getRadius(p), 18);             // round(5^1.8)
  assert.deepEqual(cfg.getFillColor(p), [255, 176, 40, 200]); // amber + alpha
});

test('buildScatterConfig tolerates empty snapshot', () => {
  const cfg = buildScatterConfig({ points: [] });
  assert.deepEqual(cfg.data, []);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/apps/orbis && node --test tests/quakes.test.js`
Expected: FAIL（`Cannot find module '../js/layers/quakes.js'`）

- [ ] **Step 3: 最小実装を書く**

`js/layers/quakes.js`:
```javascript
// 地震レイヤー。統一インターフェース { id, label, fetch, toDeckLayer, legend } を実装。
// 純粋部 buildScatterConfig を分離してテスト可能にする。deck は描画時にグローバル参照。
import { magnitudeToRadius, magnitudeToColor } from '../lib/geo.js';

export function buildScatterConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'quakes',
    data,
    radiusUnits: 'pixels',
    pickable: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => magnitudeToRadius(p.mag),
    getFillColor: (p) => [...magnitudeToColor(p.mag), 200],
  };
}

export const quakesLayer = {
  id: 'quakes',
  label: '地震',
  legend: [
    { color: 'rgb(57,208,255)', label: 'M<2' },
    { color: 'rgb(94,255,166)', label: 'M2–4' },
    { color: 'rgb(255,176,40)', label: 'M4–6' },
    { color: 'rgb(255,60,80)', label: 'M6+' },
  ],
  async fetch(getSnapshot) {
    return getSnapshot('quakes');
  },
  toDeckLayer(snapshot) {
    // deck は index.html の CDN によりグローバル提供される
    return new deck.ScatterplotLayer(buildScatterConfig(snapshot));
  },
};
```

`js/layers/registry.js`:
```javascript
// レイヤーの登録と一括描画。Phase 2 以降はここに import を足すだけで拡張できる。
import { quakesLayer } from './quakes.js';

export const layers = [quakesLayer];

export function getLayer(id) {
  return layers.find((l) => l.id === id);
}

// 有効レイヤーの deck レイヤー配列を組み立てる。
// enabled: Set<string>、snapshots: Record<id, snapshot>
export function buildDeckLayers(enabled, snapshots) {
  return layers
    .filter((l) => enabled.has(l.id) && snapshots[l.id])
    .map((l) => l.toDeckLayer(snapshots[l.id]));
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/apps/orbis && node --test tests/quakes.test.js`
Expected: PASS（2 件）

- [ ] **Step 5: Commit**

```bash
git add js/layers/quakes.js js/layers/registry.js tests/quakes.test.js
git commit -m "feat: quakes layer module + registry (unified interface)"
```

---

### Task 6: snapshot 取得・ポーリング

**Files:**
- Create: `js/snapshot.js`

- [ ] **Step 1: 実装を書く（薄いI/O層・ユニットテストは geo/quakes 側で担保、疎通は Task 9 の e2e）**

`js/snapshot.js`:
```javascript
// data/snapshots/*.json と manifest.json を取得・ポーリングする薄いI/O層。
const BASE = 'data/snapshots';

export async function fetchSnapshot(layerId) {
  const res = await fetch(`${BASE}/${layerId}.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot ${layerId} ${res.status}`);
  return res.json();
}

export async function fetchManifest() {
  const res = await fetch(`${BASE}/manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return { layers: {} };
  return res.json();
}

// 指定レイヤー群を取得して { id: snapshot } を返す。失敗レイヤーはスキップ（堅牢性）。
export async function fetchSnapshots(layerIds) {
  const out = {};
  await Promise.all(layerIds.map(async (id) => {
    try { out[id] = await fetchSnapshot(id); }
    catch (e) { console.warn('snapshot failed', id, e); }
  }));
  return out;
}

// intervalMs ごとに cb(snapshots) を呼ぶ。戻り値は停止関数。
export function startPolling(layerIds, intervalMs, cb) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    cb(await fetchSnapshots(layerIds));
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}
```

- [ ] **Step 2: 構文確認（Node で import できることを確認）**

Run: `cd ~/apps/orbis && node -e "import('./js/snapshot.js').then(()=>console.log('ok'))"`
Expected: `ok`（`fetch` はNode18+のグローバルなので import 自体は成功）

- [ ] **Step 3: Commit**

```bash
git add js/snapshot.js
git commit -m "feat: snapshot fetch + polling layer"
```

---

### Task 7: マップ初期化（MapLibre globe + deck.gl overlay）

**Files:**
- Create: `js/map.js`

- [ ] **Step 1: 実装を書く**

`js/map.js`:
```javascript
// MapLibre GL（globe投影）を初期化し、deck.gl の MapboxOverlay を載せる。
// maplibregl と deck は index.html の CDN によりグローバル提供される。

const DARK_STYLE = {
  version: 8,
  // 無料・キー不要の OSS ダークラスタタイル（CARTO dark_all）
  sources: {
    carto: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap, © CARTO',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#05080f' } },
    { id: 'carto', type: 'raster', source: 'carto', paint: { 'raster-opacity': 0.85 } },
  ],
};

export function initMap(container) {
  const map = new maplibregl.Map({
    container,
    style: DARK_STYLE,
    center: [0, 20],
    zoom: 1.4,
    attributionControl: true,
  });
  // 地球儀投影（遠景）。ズームインで平面に近づく。
  map.on('style.load', () => {
    if (map.setProjection) map.setProjection({ type: 'globe' });
  });

  const overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  return { map, overlay };
}

// deck レイヤー配列を差し替える。
export function setDeckLayers(overlay, deckLayers) {
  overlay.setProps({ layers: deckLayers });
}
```

- [ ] **Step 2: 構文確認**

Run: `cd ~/apps/orbis && node -e "import('./js/map.js').then(()=>console.log('ok'))"`
Expected: `ok`（グローバル参照は関数内なので import 時にエラーにならない）

- [ ] **Step 3: Commit**

```bash
git add js/map.js
git commit -m "feat: MapLibre globe + deck.gl overlay init"
```

---

### Task 8: index.html・CSS・エントリ（main.js）

**Files:**
- Create: `index.html`, `css/orbis.css`, `js/main.js`

- [ ] **Step 1: `css/orbis.css` を作成（Aurora テーマ基礎）**

```css
:root {
  --bg: #05080f; --panel: rgba(14, 22, 38, 0.72); --line: #1c2c48;
  --cyan: #39d0ff; --text: #cfe0f5; --muted: #5b7fb0;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font-family: system-ui, "Segoe UI", sans-serif; overflow: hidden; }
#app { display: flex; flex-direction: column; height: 100vh; }
#map-wrap { position: relative; flex: 1; min-height: 0; }
#map { position: absolute; inset: 0; }
#legend { position: absolute; left: 12px; bottom: 12px; z-index: 5;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; backdrop-filter: blur(8px); font-size: 12px; }
#legend h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); }
#legend .row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
#legend .dot { width: 10px; height: 10px; border-radius: 50%;
  box-shadow: 0 0 8px currentColor; }
#freshness { position: absolute; right: 12px; top: 12px; z-index: 5;
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: 6px 10px; font-size: 11px; color: var(--muted); backdrop-filter: blur(8px); }
#loading { position: absolute; inset: 0; z-index: 20; display: flex;
  align-items: center; justify-content: center; background: var(--bg);
  color: var(--cyan); letter-spacing: .2em; transition: opacity .5s; }
#loading.hidden { opacity: 0; pointer-events: none; }
```

- [ ] **Step 2: `index.html` を作成**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>ORBIS — 世界リアルタイム監視</title>
  <meta name="theme-color" content="#05080f" />
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" />
  <link rel="stylesheet" href="css/orbis.css" />
  <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/deck.gl@9.0.27/dist.min.js"></script>
</head>
<body>
  <div id="app">
    <div id="map-wrap">
      <div id="map"></div>
      <div id="freshness">—</div>
      <div id="legend"><h4>地震 / Earthquakes</h4><div id="legend-rows"></div></div>
      <div id="loading">ORBIS 起動中…</div>
    </div>
  </div>
  <script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 3: `js/main.js` を作成（疎通の中核：e2e 用に `window.__orbis` を公開）**

```javascript
import { initMap, setDeckLayers } from './map.js';
import { layers, buildDeckLayers } from './layers/registry.js';
import { startPolling, fetchManifest } from './snapshot.js';
import { formatFreshness } from './lib/geo.js';

const POLL_MS = 60000;

function renderLegend() {
  const rows = document.getElementById('legend-rows');
  const quakes = layers.find((l) => l.id === 'quakes');
  rows.innerHTML = quakes.legend.map(
    (e) => `<div class="row"><span class="dot" style="color:${e.color};background:${e.color}"></span>${e.label}</div>`
  ).join('');
}

async function updateFreshness() {
  try {
    const m = await fetchManifest();
    const q = m.layers && m.layers.quakes;
    document.getElementById('freshness').textContent =
      q ? `地震データ：${formatFreshness(q.updated)}（${q.count}件）` : 'データ取得中…';
  } catch { /* noop */ }
}

function boot() {
  const { map, overlay } = initMap('map');
  const enabled = new Set(['quakes']);
  renderLegend();

  // e2e/デバッグ用フック
  window.__orbis = { map, overlay, lastCount: 0 };

  map.on('load', () => {
    document.getElementById('loading').classList.add('hidden');
  });

  startPolling(['quakes'], POLL_MS, (snapshots) => {
    const deckLayers = buildDeckLayers(enabled, snapshots);
    setDeckLayers(overlay, deckLayers);
    window.__orbis.lastCount =
      snapshots.quakes && snapshots.quakes.points ? snapshots.quakes.points.length : 0;
    updateFreshness();
  });
}

boot();
```

- [ ] **Step 4: ローカルで目視確認**

Run: `cd ~/apps/orbis && python3 -m http.server 8000` を起動し、ブラウザで `http://localhost:8000` を開く（別ターミナル可）。
Expected: 濃紺の地球儀が表示され、地震点（色付きの円）が乗る。右上に「地震データ：N分前（M件）」、左下に凡例。確認後サーバ停止。

- [ ] **Step 5: Commit**

```bash
git add index.html css/orbis.css js/main.js
git commit -m "feat: ORBIS shell (globe + quake layer + legend + freshness)"
```

---

### Task 9: Playwright スモークテスト（疎通の自動検証）

**Files:**
- Create: `tests/e2e/smoke.spec.js`

- [ ] **Step 1: 失敗するテストを書く**

`tests/e2e/smoke.spec.js`:
```javascript
import { test, expect } from '@playwright/test';

test('globe boots, loading clears, and quake layer renders points', async ({ page }) => {
  await page.goto('/');

  // ローディングが消える（map load 完了）
  await expect(page.locator('#loading')).toHaveClass(/hidden/, { timeout: 15000 });

  // canvas（MapLibre）が存在
  await expect(page.locator('#map canvas')).toBeVisible();

  // 凡例が4バンド描画されている
  await expect(page.locator('#legend-rows .row')).toHaveCount(4);

  // ポーリングで地震点が読み込まれる（committed snapshot を読む・件数>0）
  await expect.poll(
    async () => page.evaluate(() => window.__orbis && window.__orbis.lastCount),
    { timeout: 15000 }
  ).toBeGreaterThan(0);

  // 鮮度表示が更新されている
  await expect(page.locator('#freshness')).toContainText('地震データ');
});
```

- [ ] **Step 2: テストを実行して通ることを確認**

Run: `cd ~/apps/orbis && npx playwright test`
Expected: PASS（1 件）。失敗する場合は CDN 読み込み/`window.__orbis` 公開/`data/snapshots/quakes.json` の存在を確認。

> 注（mistakes.md）: このe2eは `data/snapshots/quakes.json` を**読むだけ**で書き換えない。本番配信データを上書きしない設計。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/smoke.spec.js
git commit -m "test: e2e smoke for globe + quake rendering"
```

---

### Task 10: PWA（manifest / sw.js / アイコン）

**Files:**
- Create: `manifest.webmanifest`, `sw.js`, `scripts/make_icons.py`, `icons/*`
- Modify: `js/main.js`（SW登録を追加）

- [ ] **Step 1: アイコン生成スクリプトを作成**

`scripts/make_icons.py`:
```python
"""ORBIS の PWA アイコンを生成（濃紺地に光るオーブ）。"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def make(size):
    img = Image.new("RGB", (size, size), "#05080f")
    d = ImageDraw.Draw(img)
    cx = cy = size // 2
    r = int(size * 0.34)
    # グロー
    for i in range(6, 0, -1):
        rr = r + i * size // 60
        alpha = 18 - i * 2
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(57, 208, 255))
    # オーブ本体
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#0a1c38", outline=(57, 208, 255), width=max(2, size // 80))
    # 経線
    d.ellipse([cx - r // 2, cy - r, cx + r // 2, cy + r], outline=(57, 208, 255), width=max(1, size // 160))
    img.save(os.path.join(OUT, f"icon-{size}.png"))


if __name__ == "__main__":
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    for s in (192, 512):
        make(s)
    # apple-touch-icon
    Image.open(os.path.join(OUT, "icon-192.png")).save(os.path.join(OUT, "apple-touch-icon.png"))
    print("icons written")
```

- [ ] **Step 2: アイコンを生成**

Run: `cd ~/apps/orbis && python scripts/make_icons.py`
Expected: `icons written`。`icons/icon-192.png`, `icon-512.png`, `apple-touch-icon.png` が生成される。

- [ ] **Step 3: `manifest.webmanifest` を作成**

```json
{
  "name": "ORBIS — 世界リアルタイム監視",
  "short_name": "ORBIS",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#05080f",
  "theme_color": "#05080f",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 4: `sw.js` を作成（CACHE版を明示。更新時は必ず上げる）**

```javascript
// ORBIS Service Worker — シェルをキャッシュ。データJSONは常にネットワーク優先。
const CACHE = 'orbis-v1';
const SHELL = ['/', '/index.html', '/css/orbis.css', '/js/main.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // データ・タイルは常にネットワーク（鮮度優先）
  if (url.pathname.includes('/data/snapshots/') || url.hostname.includes('cartocdn')) return;
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
```

- [ ] **Step 5: `index.html` の `<head>` にアイコンを追加**

`index.html` の `<link rel="manifest" ...>` の直後に追記:
```html
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png" />
```

- [ ] **Step 6: `js/main.js` の末尾（`boot();` の前）に SW 登録を追加**

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
```

- [ ] **Step 7: e2e を再実行して回帰がないことを確認**

Run: `cd ~/apps/orbis && npx playwright test`
Expected: PASS（1 件・SW登録後も疎通維持）

- [ ] **Step 8: Commit**

```bash
git add manifest.webmanifest sw.js scripts/make_icons.py icons/ index.html js/main.js
git commit -m "feat: PWA manifest, service worker, icons"
```

---

### Task 11: GitHub Actions 収集ワークフロー

**Files:**
- Create: `.github/workflows/collect.yml`

- [ ] **Step 1: ワークフローを作成**

`.github/workflows/collect.yml`:
```yaml
name: collect
on:
  schedule:
    - cron: '*/10 * * * *'   # 10分毎（GitHub cron の実用下限を考慮）
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
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt
      - name: Collect quakes
        run: python -m collectors.quakes
      - name: Commit snapshots
        run: |
          git config user.name "orbis-bot"
          git config user.email "210495115+sg55555@users.noreply.github.com"
          git add data/snapshots/quakes.json data/snapshots/manifest.json
          if git diff --cached --quiet; then
            echo "no changes"
          else
            git commit -m "data: refresh snapshots [skip ci]"
            git push
          fi
```

- [ ] **Step 2: ローカルで収集コマンドが動くことを再確認（ワークフローと同一コマンド）**

Run: `cd ~/apps/orbis && python -m collectors.quakes`
Expected: `[quakes] wrote N points ...`（snapshot 更新）

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/collect.yml data/snapshots/quakes.json data/snapshots/manifest.json
git commit -m "ci: scheduled snapshot collection workflow"
```

---

### Task 12: 全テスト緑＋README 兼デプロイ手順

**Files:**
- Create: `README.md`

- [ ] **Step 1: 全テストを実行して緑を確認**

Run: `cd ~/apps/orbis && python -m pytest -q && node --test tests/ && npx playwright test`
Expected: pytest PASS / node:test PASS / Playwright PASS（すべて緑）

- [ ] **Step 2: `README.md` を作成**

```markdown
# ORBIS — 世界リアルタイム監視ダッシュボード

無料OSINTで世界を近リアルタイム監視するダッシュボード。Phase 1（基盤）: 地球儀 + 地震(USGS)。

## 開発
- フロント: Vanilla JS (ESM, no build)。`python3 -m http.server 8000` → http://localhost:8000
- 収集: `python -m collectors.quakes`（USGS → data/snapshots/quakes.json + manifest.json）

## テスト
- Python: `python -m pytest -q`
- JS: `node --test tests/`
- E2E: `npx playwright test`

## デプロイ（Vercel 静的）
1. GitHub に push（リポジトリ sg55555/orbis）
2. Vercel でインポート（Framework: Other / 静的）。`vercel.json` と `.vercelignore` 同梱済み。
3. GitHub Actions の `collect` が10分毎に snapshot を更新・push。

## アーキテクチャ / 設計
`docs/superpowers/specs/2026-06-13-orbis-design.md` と `docs/superpowers/plans/2026-06-13-orbis-phase1.md` 参照。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README + dev/deploy instructions"
```

- [ ] **Step 4: Phase 1 完了の確認**

Phase 1 完了基準: 地球儀が描画され、USGS 地震が乗り、収集→JSON→描画が疎通し、全テストが緑で、Vercel にデプロイ可能な状態。Phase 2（コアレイヤー：航空・船舶・紛争・抗議・貿易ルート + 左右パネル）は別 spec/plan で着手する。

---

## Self-Review（計画 vs spec）

**スペック網羅:** Phase 1 のスコープ（リポ/Vercel/PWA骨組み・MapLibre globe・deck.gl土台・レイヤー統一I/F・地震1層疎通）を Task 1–12 がすべてカバー。Phase 2–5 のレイヤー（航空/船舶/紛争 等）は意図的に範囲外（後続 plan）。

**プレースホルダ:** "TBD"/"後で"/"適切に処理" は無し。各コード手順に完全なコードを記載。

**型/名称整合:** snapshot スキーマ `{layer, updated, count, points[]}` は Python(build_snapshot)・JS(buildScatterConfig/main)で一致。`buildDeckLayers(enabled, snapshots)`・`setDeckLayers(overlay, layers)`・`startPolling(ids, ms, cb)`・`formatFreshness(iso, now)`・`magnitudeToRadius/Color` の呼び出し名は全タスクで統一。`window.__orbis.lastCount` は main.js が設定し e2e が参照。

**既知の運用前提:** MapLibre globe 投影は v4.7 系の `setProjection({type:'globe'})` を使用（未対応環境ではフラット表示にフォールバックするが疎通・テストには影響しない）。deck.gl は CDN UMD グローバル `deck` を使用。
