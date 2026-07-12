# FIRMS 山火事レイヤー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans。Steps use checkbox (`- [ ]`).

**Goal:** NASA FIRMS の全球活火点を、既存 quakes 同型の点レイヤーとして globe に追加する。

**Architecture:** collector `collectors/firms.py` が VIIRS active fire CSV を取得→絞込→`data/snapshots/firms.json`。frontend `js/layers/firms.js` が統一IFで塗り暖色点を描画＋最寄り国ラベルで tooltip/feed/flyTo。registry/sources/collect-slow.yml に配線。

**Tech Stack:** Python(requests, csv, pytest) / Vanilla JS(deck.gl ScatterplotLayer, node:test)。

## Global Constraints
- 実 LLM/Anthropic API を使わない（NASA FIRMS のみ・無課金）。
- collector は `FIRMS_MAP_KEY` 未設定なら skip（他 collector 同型）。テストは fixture のみ・実 HTTP 無し。
- CSV は**ヘッダ行で列名パース**（列順ハードコード禁止）。
- 定数：`SOURCE="VIIRS_NOAA20_NRT"`, `DAY_RANGE=1`, `FRP_MIN=10.0`, `CAP=1500`。
- 面禁則（globe 上に不透明面を置かない）は点描画ゆえ非該当。js/css 変更につき `sw.js` CACHE 版 bump。
- 作業ツリー place-profile-geo。**FIRMS ファイルのみ明示 git add**（US 保留 untracked を混ぜない）。

---

### Task 1: Collector `collectors/firms.py`（CSV取得→絞込→snapshot）

**Files:**
- Create: `collectors/firms.py`
- Test: `tests/test_firms.py`
- 参照: `collectors/quakes.py`（同型）, `collectors/lib/manifest.py`（`update_manifest(path, layer, updated_iso, count)`）

**Interfaces (Produces):**
- `parse_csv(text: str) -> list[dict]` … ヘッダ行→dict列（列順非依存・空/欠損行スキップ）
- `transform(rows: list[dict]) -> list[dict]` … confidence∈{n,nominal,h,high} かつ frp>=FRP_MIN を残し、frp 降順で先頭 CAP 件。point={id,lon,lat,frp,confidence,bright,acq_date,acq_time,daynight,satellite}。id=`f"{lat}_{lon}_{acq_date}_{acq_time}"`。confidence は n→nominal/h→high 正規化。
- `build_snapshot(points, updated_iso) -> dict` … {layer:"firms",updated,count,points}
- `fetch(map_key, source=SOURCE, day_range=DAY_RANGE, timeout=30) -> str` … Area API GET→CSV text
- `main()` … FIRMS_MAP_KEY 無→skip / 有→fetch→parse_csv→transform→build_snapshot→write firms.json＋update_manifest

- [ ] **Step 1: 失敗テストを書く** `tests/test_firms.py`

```python
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from collectors.firms import parse_csv, transform, build_snapshot, FRP_MIN

CSV = (
    "latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n"
    "-24.0,133.1,330.1,2026-07-12,0312,N20,h,42.5,D\n"   # high・FRP大→残る
    "10.0,20.0,300.0,2026-07-12,0100,N20,n,15.0,N\n"      # nominal・FRP>=10→残る
    "5.0,5.0,295.0,2026-07-12,0200,N20,l,50.0,D\n"        # low→除外
    "6.0,6.0,295.0,2026-07-12,0200,N20,n,3.0,D\n"          # FRP<10→除外
)

def test_parse_csv_by_header_order_independent():
    rows = parse_csv("frp,latitude,longitude,confidence,acq_date,acq_time\n42.5,-24.0,133.1,h,2026-07-12,0312\n")
    assert rows[0]["latitude"] == "-24.0" and rows[0]["frp"] == "42.5"

def test_transform_filters_confidence_and_frp_and_sorts_desc():
    pts = transform(parse_csv(CSV))
    assert len(pts) == 2                      # low と FRP<10 を除外
    assert pts[0]["frp"] == 42.5 and pts[1]["frp"] == 15.0  # FRP 降順
    assert pts[0]["confidence"] == "high" and pts[1]["confidence"] == "nominal"
    assert pts[0]["id"] == "-24.0_133.1_2026-07-12_0312"
    assert pts[0]["lon"] == 133.1 and pts[0]["lat"] == -24.0

def test_transform_caps_top_n_by_frp(monkeypatch):
    import collectors.firms as f
    monkeypatch.setattr(f, "CAP", 1)
    pts = f.transform(f.parse_csv(CSV))
    assert len(pts) == 1 and pts[0]["frp"] == 42.5

def test_build_snapshot_shape():
    snap = build_snapshot([{"id":"a"}], "2026-07-12T00:00:00Z")
    assert snap["layer"] == "firms" and snap["count"] == 1 and snap["updated"].endswith("Z")
```

- [ ] **Step 2: 失敗確認** `PYTHONPATH=. .venv/bin/python -m pytest tests/test_firms.py -q` → FAIL(ImportError)

- [ ] **Step 3: 実装** `collectors/firms.py`（quakes.py 同型）

```python
"""NASA FIRMS active fire を取得して data/snapshots/firms.json に書き出す。"""
import csv, io, os
from datetime import datetime, timezone
import requests
from collectors.lib.manifest import update_manifest

SOURCE = "VIIRS_NOAA20_NRT"
DAY_RANGE = 1
FRP_MIN = 10.0
CAP = 1500
API = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
_CONF = {"h": "high", "n": "nominal", "l": "low", "high": "high", "nominal": "nominal", "low": "low"}

def parse_csv(text):
    return list(csv.DictReader(io.StringIO(text)))

def _num(v):
    try: return float(v)
    except (TypeError, ValueError): return None

def transform(rows):
    out = []
    for r in rows:
        conf = _CONF.get((r.get("confidence") or "").strip().lower())
        frp = _num(r.get("frp")); lat = _num(r.get("latitude")); lon = _num(r.get("longitude"))
        if conf not in ("nominal", "high") or frp is None or frp < FRP_MIN or lat is None or lon is None:
            continue
        acq_date = (r.get("acq_date") or "").strip(); acq_time = (r.get("acq_time") or "").strip()
        out.append({"id": f"{lat}_{lon}_{acq_date}_{acq_time}", "lon": lon, "lat": lat,
                    "frp": frp, "confidence": conf, "bright": _num(r.get("bright_ti4")),
                    "acq_date": acq_date, "acq_time": acq_time,
                    "daynight": (r.get("daynight") or "").strip(), "satellite": (r.get("satellite") or "").strip()})
    out.sort(key=lambda p: p["frp"], reverse=True)
    if len(out) > CAP:
        print(f"[firms] cap: {len(out)} → {CAP} 件（FRP 上位）")
        out = out[:CAP]
    return out

def build_snapshot(points, updated_iso):
    return {"layer": "firms", "updated": updated_iso, "count": len(points), "points": points}

def fetch(map_key, source=SOURCE, day_range=DAY_RANGE, timeout=30):
    url = f"{API}/{map_key}/{source}/world/{day_range}"
    resp = requests.get(url, timeout=timeout); resp.raise_for_status()
    return resp.text

SNAPSHOT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "snapshots")

def main():
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        print("[firms] FIRMS_MAP_KEY not set; skip"); return
    out_dir = os.path.abspath(SNAPSHOT_DIR); os.makedirs(out_dir, exist_ok=True)
    points = transform(parse_csv(fetch(key)))
    updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    import json
    with open(os.path.join(out_dir, "firms.json"), "w", encoding="utf-8") as fp:
        json.dump(build_snapshot(points, updated), fp, ensure_ascii=False)
    update_manifest(os.path.join(out_dir, "manifest.json"), "firms", updated, len(points))
    print(f"[firms] wrote {len(points)} points")

if __name__ == "__main__":
    main()
```

- [ ] **Step 4: パス確認** 同 pytest → PASS
- [ ] **Step 5: skip テスト追加＋commit**

```python
def test_main_skips_without_key(monkeypatch, capsys):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    import collectors.firms as f; f.main()
    assert "skip" in capsys.readouterr().out
```
`git add collectors/firms.py tests/test_firms.py && git commit -m "feat(firms): collector(VIIRS CSV→絞込→snapshot)"`

---

### Task 2: Frontend 純ヘルパ `js/layers/firms.js`（frpToRadius/frpToColor/nearestCountry/acqToMs/buildFireConfig）

**Files:**
- Create: `js/layers/firms.js`
- Test: `tests/firms.test.js`
- 参照: `js/layers/quakes.js`（buildRingConfig 同型）, `js/lib/country_centroids.js`（`COUNTRY_CENTROIDS`=`{code,en,lng,lat}`）, `js/lib/places.js`（`FIPS_JA`=code→name_ja）

**Interfaces (Produces):**
- `frpToRadius(frp) -> number`（√FRP・clamp 3..24px）
- `frpToColor(frp) -> [r,g,b]`（<20 黄 / <100 橙 / else 赤）
- `nearestCountry(lon, lat) -> string`（最寄り centroid の `FIPS_JA[code]`・無ければ en）
- `acqToMs(acq_date, acq_time) -> number`（"2026-07-12","0312"→epoch ms・UTC）
- `buildFireConfig(snapshot) -> object`（ScatterplotLayer 設定・filled・getFillColor/getRadius）

- [ ] **Step 1: 失敗テスト** `tests/firms.test.js`

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frpToRadius, frpToColor, nearestCountry, acqToMs, buildFireConfig } from '../js/layers/firms.js';

test('frpToRadius: √FRP を 3..24px にクランプ', () => {
  assert.equal(frpToRadius(0), 3);
  assert.ok(frpToRadius(100) > frpToRadius(25));
  assert.equal(frpToRadius(1e6), 24);
});
test('frpToColor: 弱=黄 / 中=橙 / 強=赤', () => {
  assert.deepEqual(frpToColor(10), [255, 214, 64]);
  assert.deepEqual(frpToColor(50), [255, 140, 32]);
  assert.deepEqual(frpToColor(500), [255, 64, 32]);
});
test('nearestCountry: 座標→最寄り国の日本語名', () => {
  assert.equal(nearestCountry(133.4, -24.9), 'オーストラリア'); // AS centroid 近傍
});
test('acqToMs: FIRMS の date/time を epoch ms(UTC) に', () => {
  assert.equal(acqToMs('2026-07-12', '0312'), Date.UTC(2026, 6, 12, 3, 12));
});
test('buildFireConfig: filled・暖色・半径∝FRP', () => {
  const cfg = buildFireConfig({ points: [{ lon: 1, lat: 2, frp: 50 }] });
  assert.equal(cfg.id, 'firms'); assert.equal(cfg.filled, true); assert.equal(cfg.stroked, false);
  assert.deepEqual(cfg.getPosition(cfg.data[0]), [1, 2]);
  assert.deepEqual(cfg.getFillColor(cfg.data[0]).slice(0, 3), [255, 140, 32]);
  assert.ok(cfg.getRadius(cfg.data[0]) > 3);
});
test('buildFireConfig: 空 snapshot は data=[]', () => {
  assert.deepEqual(buildFireConfig(null).data, []);
});
```

- [ ] **Step 2: 失敗確認** `npm run test:js`（該当ファイル）→ FAIL
- [ ] **Step 3: 実装**（純ヘルパ部のみ・layer オブジェクトは Task 3）

```javascript
import { COUNTRY_CENTROIDS } from '../lib/country_centroids.js';
import { FIPS_JA } from '../lib/places.js';

export function frpToRadius(frp) {
  const f = Number(frp) || 0;
  return Math.round(Math.min(24, Math.max(3, Math.sqrt(f) * 2)));
}
export function frpToColor(frp) {
  const f = Number(frp) || 0;
  if (f < 20) return [255, 214, 64];   // 黄
  if (f < 100) return [255, 140, 32];  // 橙
  return [255, 64, 32];                // 赤
}
export function nearestCountry(lon, lat) {
  let best = null, bd = Infinity;
  for (const c of COUNTRY_CENTROIDS) {
    const dx = c.lng - lon, dy = c.lat - lat, d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = c; }
  }
  return best ? (FIPS_JA[best.code] || best.en) : '';
}
export function acqToMs(acqDate, acqTime) {
  const [y, m, d] = String(acqDate).split('-').map(Number);
  const t = String(acqTime).padStart(4, '0');
  return Date.UTC(y, (m || 1) - 1, d || 1, Number(t.slice(0, 2)), Number(t.slice(2)));
}
export function buildFireConfig(snapshot) {
  const data = (snapshot && snapshot.points) ? snapshot.points : [];
  return {
    id: 'firms', data, radiusUnits: 'pixels', pickable: true,
    stroked: false, filled: true,
    getPosition: (p) => [p.lon, p.lat],
    getRadius: (p) => frpToRadius(p.frp),
    getFillColor: (p) => [...frpToColor(p.frp), 210],
  };
}
```

- [ ] **Step 4: パス確認** → PASS
- [ ] **Step 5: commit** `git add js/layers/firms.js tests/firms.test.js && git commit -m "feat(firms): 純ヘルパ(frp色/半径・最寄り国・buildFireConfig)"`

---

### Task 3: `firmsLayer` オブジェクト＋registry/sources 配線

**Files:**
- Modify: `js/layers/firms.js`（layer オブジェクト追記）
- Modify: `js/layers/registry.js`（import・layers 配列・DECK_TO_LAYER・DESCRIPTIONS）
- Modify: `js/ui/sources.js`（firms 出典）
- Test: `tests/firms.test.js`（layer IF）

**Interfaces (Consumes):** Task2 の buildFireConfig/nearestCountry/acqToMs/frpToColor。
**Interfaces (Produces):** `firmsLayer = {id,label,marker,swatchColor,legend,fetch,toDeckLayer,tooltip,toFeedItems}`。

- [ ] **Step 1: 失敗テスト追記**

```javascript
import { firmsLayer } from '../js/layers/firms.js';
import { getLayer, tooltipFor, feedLayers } from '../js/layers/registry.js';

test('firmsLayer: 統一IF＋tooltip＋feed', () => {
  const snap = { points: [{ id: 'x', lon: 133.4, lat: -24.9, frp: 42.5, confidence: 'high', acq_date: '2026-07-12', acq_time: '0312' }] };
  assert.equal(firmsLayer.id, 'firms');
  const tip = firmsLayer.tooltip(snap.points[0]);
  assert.ok(tip.includes('山火事') && tip.includes('オーストラリア') && tip.includes('42.5'));
  const items = firmsLayer.toFeedItems(snap);
  assert.equal(items[0].layerId, 'firms'); assert.equal(items[0].lon, 133.4);
});
test('registry: firms が登録され tooltip/feed 経由で引ける', () => {
  assert.ok(getLayer('firms'));
  assert.ok(tooltipFor('firms', { frp: 10, lon: 0, lat: 0, confidence: 'nominal', acq_date: '2026-07-12', acq_time: '0100' }));
  assert.ok(feedLayers().some((l) => l.id === 'firms'));
});
```

- [ ] **Step 2: 失敗確認** → FAIL
- [ ] **Step 3: firms.js に layer 追記**

```javascript
const CONF_JA = { high: '高', nominal: '標準', low: '低' };
export const firmsLayer = {
  id: 'firms', label: '山火事', marker: 'dot', swatchColor: 'rgb(255,140,32)',
  legend: [
    { color: 'rgb(255,214,64)', label: 'FRP<20' },
    { color: 'rgb(255,140,32)', label: 'FRP20–100' },
    { color: 'rgb(255,64,32)', label: 'FRP100+' },
  ],
  async fetch(getSnapshot) { return getSnapshot('firms'); },
  toDeckLayer(snapshot) { return new deck.ScatterplotLayer(buildFireConfig(snapshot)); },
  tooltip(o) {
    if (!o) return null;
    return `山火事 ${nearestCountry(o.lon, o.lat)}付近｜FRP ${o.frp} 信頼度 ${CONF_JA[o.confidence] || o.confidence} ${o.acq_date}`;
  },
  toFeedItems(snapshot) {
    const pts = (snapshot && snapshot.points) ? snapshot.points : [];
    return pts.map((p) => ({
      id: p.id, time: acqToMs(p.acq_date, p.acq_time),
      title: `🔥 ${nearestCountry(p.lon, p.lat)}付近 FRP${p.frp}`, layerId: 'firms', lon: p.lon, lat: p.lat,
    }));
  },
};
```

- [ ] **Step 4: registry.js 配線**：`import { firmsLayer } from './firms.js';` ／ `layers` 配列末尾に `firmsLayer` 追加 ／ `DECK_TO_LAYER` に `firms: 'firms'` ／ `DESCRIPTIONS` に `firms: '活火点（NASA FIRMS・色/大きさ=火の強さFRP）'`。
- [ ] **Step 5: sources.js 配線**：`firms: { source: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov' },`
- [ ] **Step 6: パス確認** `npm run test:js` 全緑
- [ ] **Step 7: commit** `git add js/layers/firms.js js/layers/registry.js js/ui/sources.js tests/firms.test.js && git commit -m "feat(firms): layer統一IF＋registry/sources配線"`

---

### Task 4: cron 配線＋sw bump

**Files:**
- Modify: `.github/workflows/collect-slow.yml`（firms step）
- Modify: `sw.js`（CACHE 版 bump）

- [ ] **Step 1: collect-slow.yml に step 追加**（airtemp/sst の後）

```yaml
      - name: Collect FIRMS wildfires
        run: python -m collectors.firms || echo "firms skipped"
        env:
          FIRMS_MAP_KEY: ${{ secrets.FIRMS_MAP_KEY }}
```

- [ ] **Step 2: sw.js の CACHE バージョンを +1**（現行 grep で確認して bump）
- [ ] **Step 3: 全テスト緑確認** `pytest -q` ＋ `npm run test:js`
- [ ] **Step 4: commit** `git add .github/workflows/collect-slow.yml sw.js && git commit -m "chore(firms): slow cron step＋sw版bump"`

---

## Self-Review
- **Spec coverage**：collector(§Collector)=Task1／frontend layer+視覚(§Frontend)=Task2-3／配線(registry/sources/cron/sw)=Task3-4／最寄り国ラベル=Task2 nearestCountry／テスト(§テスト)=各Task。網羅。
- **Placeholder**：無し（全ステップ実コード）。
- **型整合**：point の frp/confidence/lon/lat/acq_* が collector→snapshot→buildFireConfig/tooltip/toFeedItems で一貫。nearestCountry は COUNTRY_CENTROIDS.code→FIPS_JA。
- 活性化（MAP_KEY 取得＋GitHub secret）は太田さん作業＝本計画外（コードは skip で安全）。
