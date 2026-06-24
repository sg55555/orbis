# Phase2 国ドリルダウン本格版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Orbis のグローブ上で国（陸地）をクリックすると、その国の admin1（県/州）別にイベント（紛争/抗議/翻訳ニュース/地震）を集計・件数降順で表示し、最寄り都市名を添えたドリルダウン詳細パネル＋ウォッチリストを非重畳 split で開く。

**Architecture:** 純幾何/集計/HTML ビルダ（deck/DOM/fetch/map 非依存・node:test と pytest の主対象）を `js/lib/drilldown/` と `scripts/lib/ne_prep.py` に集約し、I/O 境界（fetch/map/DOM）は `js/lib/drilldown/country_index.js`・`country_data.js`・`js/ui/country_click.js`・`js/ui/drilldown.js` の薄い DI seam に閉じ込める。クリックは deck onClick の early-return で拾えないため `map.on('click')` 別系統で受け、deck pick とは時刻＋座標の二重判定で排他する。静的データ（country_bounds 50m 再生成・admin1/cities/manifest）はビルド時に Python で生成し相対 fetch で配信する。

**Tech Stack:** Vanilla JS (ESM・MapLibre globe + deck.gl)・node:test・Python 3.14（uv・標準ライブラリ json/math のみ）・pytest・Natural Earth 50m/10m GeoJSON（手調達）・Vercel 配信・Service Worker（orbis-v45）。

---

## Global Constraints

- spec確定事項1: 国コードの一次キーは FIPS 10-4（FIPS_JA 239キー・js/lib/places.js）であり ISO_A2 ではない。
- spec確定事項2: header は instability country をそのまま流用し新規 LLM 生成は行わない。
- spec確定事項3: EXTRA68（ポリゴン無し小国・領土）は admin1 を空 FeatureCollection で出力し 404 を出さない。
- spec確定事項4: 日本語名は NE name_ja → Wikidata(ja) → GeoNames(ja) → 英名 の4段フォールバックで決める。
- spec確定事項5: collector / orbis-data / データパイプライン本体は無改修（country_bounds はデータのみ再生成）。
- spec確定事項6: country_bounds.geojson は Natural Earth 50m から再生成し schema は `{code(FIPS), name}` を厳守する。
- spec確定事項7: ウォッチリストは instability join で score 降順に並べ permalink/share には載せない。
- spec確定事項8: MAX_POINTS（既定4000）超過時は admin1 割当をスキップし国集計のみのデグレード（必ず描画）。
- 実コード前提: deck onClick（main.js:322）は `if (!info||!info.object||!info.layer) return;` で空振りを捨てるため国クリックを拾えない＝`map.on('click')` 別系統で受ける。
- 実コード前提: snapshots（main.js:58）は module-local で window.__orbis に載らない＝getSnapshots クロージャ DI で渡す。
- 実コード前提: client FIPS 解決は boundary-country が line 層で FIPS 属性を持たないため client ray-casting（loadPolygons→locateFeature）を一次手段とする。
- 実コード前提: `#map` は `position:absolute; inset:0`（orbis.css:23）で grid セルに縮まないため drill-open 時に `#map` のみ `position:static; inset:auto` へ上書きする。
- 実コード前提: deck.gl globe では Icon/Text レイヤーが使えないため県ラベル等は MapLibre symbol 層で描く。
- 非重畳要件: square-blur-bleed 回避のため `#drilldown` には backdrop-filter / var(--glass-blur) / glass を一切使わず不透明純色 `#070b14` のみとする。
- SW: sw.js の `const CACHE = 'orbis-v45';`（orbis-v44 から版up）・bypass 条件（raw.githubusercontent.com / /data/snapshots/ / cartocdn）は維持。
- テスト基線: node:test の baseline 352 pass / fail 0 を維持し新規分のみ上積みする（既存契約は不変更）。
- 環境: Python は uv + `.venv`（3.14・geopandas 無し）で pytest は `PYTHONPATH=. uv run pytest ...` で実行する（conftest 無しのため必須）。
- 不変更: collector・orbis-data・permalink・share・mobile-nav.js（mobile-tabs 3ボタン）・layer registry は触らない。


## File Structure

### 新規（純粋・テスト主対象）
- `js/lib/drilldown/geo_poly.js` — 点内判定コア（pointInRings/loadPolygons/pointInFeature/locateFeature）。geo_country.py の同一移植。client FIPS 解決と admin1 割当の共通幾何コア。
- `js/lib/drilldown/nearest.js` — 最寄り都市探索（sqDistDeg/nearestCity・cosLat 補正二乗距離・maxDeg 閾値）。
- `js/lib/zoom_for_bbox.js` — bbox→flyTo zoom 逆算（zoomForBbox・degLenForZoom 整合・min/max clamp・アンチメリディアン保護）。
- `js/lib/drilldown/aggregate_admin1.js` — admin1 集計コア（collectCountryEvents/assignAdmin1/aggregateByAdmin1/attachNearestCity/buildDrilldown）。全合成＋MAX_POINTS デグレード。
- `js/lib/drilldown/drilldown_view.js` — 純 HTML ビルダ（drilldownHeaderHtml/regionRowHtml/eventLineHtml/degradedNoticeHtml）。escapeHtml 経由・instability ヘルパ流用。
- `js/lib/drilldown/watchlist.js` — ウォッチリスト純操作＋store DI（addCode/removeCode/hasCode/orderByInstability/makeWatchlistStore）。
- `scripts/lib/__init__.py` / `scripts/lib/ne_prep.py` / `scripts/lib/fips_of_iso.py` — NE→Orbis 静的データ生成の純粋関数群＋ISO_A2→FIPS 変換表（pytest 対象）。
- `tests/drilldown_geo_poly.test.js` / `tests/drilldown_nearest.test.js` / `tests/zoom_for_bbox.test.js` / `tests/drilldown_aggregate.test.js` / `tests/drilldown_view.test.js` / `tests/drilldown_watchlist.test.js` / `tests/test_ne_prep.py` — 上記の TDD テスト。

### 新規（I/O 境界・DI seam）
- `js/lib/drilldown/country_index.js` — country_bounds 一度 fetch→loadPolygons キャッシュ（loadCountryBounds）＋countryBbox 3段フォールバック＋fipsCenter（COUNTRIES 索引）。
- `js/lib/drilldown/country_data.js` — admin1/cities 遅延取得（loadCountryGeo・manifest 事前判定・AbortController+timeout・in-flight 共有・成功キャッシュ・degraded）。
- `js/ui/country_click.js` — 国クリック orchestrator（initCountryClick・resolveFipsAt/handleMapClick/openCountry/closeCountry・deck pick 排他・selection token レース破棄）。
- `js/ui/drilldown.js` — render 層（renderDrilldown/setDrilldownState/renderWatchlist）。純 HTML を DOM に差込み onSelect/onClose/onWatchToggle/onRemove を配線。
- `tests/drilldown_country_data.test.js` / `tests/drilldown_country_click.test.js` / `tests/drilldown_render.test.js` / `tests/drilldown_html.test.js` / `tests/drilldown_css.test.js` / `tests/drilldown_main_wiring.test.js` / `tests/drilldown_sw.test.js` — 境界/配線の TDD テスト。

### 新規（build スクリプト・生成物）
- `scripts/build_country_bounds.py` / `scripts/build_admin1.py` / `scripts/build_cities.py` / `scripts/build_drilldown_manifest.py` — NE から静的データ生成。
- 生成物: `data/static/admin1/<FIPS>.geojson.gz`（properties={a1code,name_en,name_ja,bbox}・EXTRA68 は空 FC）・`data/static/cities/<FIPS>.json`（[{name,name_ja,lon,lat,pop}]・人口降順 cap）・`data/static/admin1_bbox.json`・`data/static/drilldown_manifest.json`。

### 既存変更（4ファイル・最小差分）
- `js/main.js` — boot 内で initCountryClick 初期化＋`map.on('click', cc.handleMapClick)` 配線、deck onClick で deck pick 排他フラグ更新。drawAll/registry/selected/flyTo は不変。
- `index.html` — `#feed` の後・`#legend` の前に `<aside id="drilldown" class="drill-panel" hidden>`（.dd-head/.dd-state/.dd-body/.dd-watchlist）追加。mobile-tabs 不変。
- `css/orbis.css` — 末尾に非重畳 split（body.drill-open #map-wrap{display:grid} + #map position 上書き + #drilldown 不透明背景・backdrop-filter 不使用・PC 右列/モバイル下半分）追加。
- `sw.js` — `const CACHE='orbis-v45'`（版up・bypass 条件不変）。

### 再生成（コード不変・データのみ）
- `data/static/country_bounds.geojson` — NE 50m から再生成（schema {code,name} 厳守・既存 171 FIPS 集合保存 assert）。
- `js/lib/country_centroids.js` — country_bounds 再生成後に gen_country_centroids.py 再実行で更新（FIPS_JA 全キー過不足 assert）。

---

## 実装前に必読：クラスタ間整合の確定事項（consistency patches）

> 7クラスタを独立ドラフトしたため、クラスタ境界に下記のインターフェース不整合がある。各タスク実装時に**下記の正準解決を適用**すること（最終検証タスクでも再掲）。

1. C4×C5×C7 events の regionName/a1code 欠落: C4 buildDrilldown の返す model.events は attachNearestCity 後の `{layerId,lon,lat,title,raw,cityName}` で `a1code` も `regionName` も持たない。一方 C5 eventLineHtml は `ev={regionName,cityName,layerId,title}` を期待し regionName を読む。正準シグネチャ基準（assignAdmin1 が a1code、aggregateByAdmin1 が region.name_ja を持つ）で修正: buildDrilldown は events を attachNearestCity だけでなく assignAdmin1 も通した `withA1`（a1code 付き）を model.events として返し、各 event に a1code→region.name_ja を引いた `regionName` を付与する（a1NameMap で解決・null は『その他/不明』）。これにより C7 mkRowButton が `eventLineHtml(ev)` に渡す ev が regionName を持つ。
2. C4×C5 header の forecast 形不一致: C4 buildDrilldown は header に `forecastCards`（配列・forecastCards 引数をそのまま添付）を付ける。一方 C5 drilldownHeaderHtml の _forecastHtml は `header.forecast`（オブジェクト `{watch,label}`）を読む。正準は header に forecastCards を流用（spec確定事項2）なので C4→C5 の橋渡しを統一: buildDrilldown 内で forecastCards から注視度を要約した `forecast:{watch,label}` を header に併設するか、C5 _forecastHtml を forecastCards 配列（先頭カードの watch/title_ja）から読むよう修正する。どちらか一方の表現に正準化し両クラスタを揃える。
3. C3×C6 admin1 fetch パスの拡張子不一致: C3 build_admin1.py は `data/static/admin1/<FIPS>.geojson.gz`（gzip）を出力。一方 C6 country_data.js の ADMIN1_URL は `data/static/admin1/${fips}.geojson`（.gz 無し）を fetch する。正準（生成物が .gz）に合わせ country_data.js を `.geojson.gz` を fetch しクライアントで gunzip（DecompressionStream）するか、build 側を非圧縮 .geojson 出力に変える。SW/Vercel の gzip 透過配信に依存しない明示パスへ統一する。
4. C6×C7 deck pick 排他機構の二重定義: 正準 initCountryClick は `noteDeckPick(lngLat)` を持ち、C6 実装は内部 deckPick を noteDeckPick で更新し handleMapClick が読む。一方 C7-5 main.js 配線は `deps:{fetch, getDeckPick:()=>deckPicked}` を渡し deck onClick 内で `deckPicked={at,lng,lat}` を更新する別経路で、C6 は deps.getDeckPick を読まない。どちらかに正準化: (a) main.js が deck onClick 内で `cc.noteDeckPick(info.coordinate)` を呼ぶ（正準シグネチャの noteDeckPick を使う）か、(b) C6 handleMapClick が deps.getDeckPick を排他判定に使う。正準シグネチャに noteDeckPick がある以上 (a) に寄せ、C7-5 の main_wiring テスト（getDeckPick/deckPicked 文字列検証）を noteDeckPick 配線検証に置き換える。
5. C6×C7 boundsPolys 配線の欠落: C6 initCountryClick は `setBoundsPolys(polys)` で client FIPS 解決用の country_bounds polys を受け取る前提だが（resolveFipsAt は boundsPolys が空だと常に null）、C7-5 main.js 配線には loadCountryBounds 呼び出しと setBoundsPolys 注入が無い。修正: main.js boot で `loadCountryBounds(fetch).then(polys => cc.setBoundsPolys(polys))` を配線し、handleMapClick が陸地で FIPS を解決できるようにする。setBoundsPolys は initCountryClick の戻りに含まれる（正準シグネチャには未記載だが C6 が export 済）ため C7 で利用する。
6. C6 loadCountryGeo の引数差: 正準シグネチャは `loadCountryGeo(fips, {signal, timeoutMs=8000, manifest}={})` だが C6 実装は `fetchFn` を追加（`{signal, timeoutMs, manifest, fetchFn}`）。テスト DI のための additive 拡張で後方互換だが、正準シグネチャに fetchFn を明記し本番呼び出し（country_click）が manifest と（必要なら）fetch を渡す前提を統一する。同様に C6 country_data の ADMIN1_URL/CITIES_URL が manifest の citiesBytes を見ずに常に cities を fetch する点は manifest.citiesBytes==null 時の挙動を degraded 側と整合させる。
7. C5×C7 renderWatchlist の countries 形と join 欠落: 正準 renderWatchlist は `countries=[{code, score,...}]`（lon/lat 付き）を期待し座標で onSelect を配線する。一方 watchlist.js（C5）は FIPS コード配列（string[]）しか保持せず、orderByInstability も string[] を返す。C7 にコード配列→`{code,name_ja,score,lon,lat}` への join（instability.countries と fipsCenter/COUNTRIES）が未配線。修正: render 前にウォッチリストのコード配列を instability country＋fipsCenter で国オブジェクト配列に join してから renderWatchlist に渡す配線を C7（main.js または ui/drilldown 呼び出し側）に追加する。

---

## クラスタ C1 — 純幾何コア (js/lib/drilldown/geo_poly.js)

### Task C1.1: pointInRings (even-odd ray-casting・geo_country.py 同一移植)

`collectors/lib/geo_country.py:30-42` の `_point_in_rings` を JS へ同一式で移植する。全リングを横断する even-odd 判定で、穴(interior ring)と MultiPolygon を正しく扱う。判定式は `((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)` を一字一句保つ（`(yi > y) !== (yj > y)` の短絡で `yj === yi` の 0除算を回避する Python と同じ挙動）。

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/geo_poly.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_geo_poly.test.js`

**Interfaces:**
- Consumes: (なし)
- Produces: `pointInRings(x, y, rings) -> boolean`  // rings=[[ [lon,lat],... ], ...]・even-odd 全リング横断・穴/MultiPolygon対応

- [ ] **Step 1: 失敗テストを書く**

`tests/drilldown_geo_poly.test.js` を新規作成し、以下の完全なテストコードを書く。共有フィクスチャ（単純四角・穴あき・MultiPolygon・境界点）は Python 版と同一結果になるよう座標を固定する。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointInRings } from '../js/lib/drilldown/geo_poly.js';

// 共有フィクスチャ: 単純な正方形 (0,0)-(10,10)。GeoJSON 規約どおり始点=終点で閉じる。
const SQUARE = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
];

// 穴あき: 外周 (0,0)-(10,10) の中に内周 (3,3)-(7,7) の穴。
const SQUARE_WITH_HOLE = [
  [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
  [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
];

// MultiPolygon を一つの rings 配列に flatten した形 (loadPolygons の出力形)。
// 左の四角 (0,0)-(4,4) と 右の四角 (6,0)-(10,4)。
const MULTI = [
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]],
];

test('pointInRings: 単純な正方形の内部は true', () => {
  assert.equal(pointInRings(5, 5, SQUARE), true);
});

test('pointInRings: 単純な正方形の外部は false', () => {
  assert.equal(pointInRings(15, 5, SQUARE), false);
  assert.equal(pointInRings(-1, 5, SQUARE), false);
  assert.equal(pointInRings(5, 20, SQUARE), false);
});

test('pointInRings: 穴の内部は false（even-odd で穴を抜く）', () => {
  assert.equal(pointInRings(5, 5, SQUARE_WITH_HOLE), false);
});

test('pointInRings: 穴の外・外周の内は true', () => {
  assert.equal(pointInRings(1, 1, SQUARE_WITH_HOLE), true);
  assert.equal(pointInRings(9, 9, SQUARE_WITH_HOLE), true);
});

test('pointInRings: MultiPolygon は左右どちらの四角内も true', () => {
  assert.equal(pointInRings(2, 2, MULTI), true);
  assert.equal(pointInRings(8, 2, MULTI), true);
});

test('pointInRings: MultiPolygon の隙間(4-6)は false', () => {
  assert.equal(pointInRings(5, 2, MULTI), false);
});

test('pointInRings: 上辺の境界(y=yi=yj)は even-odd の半開き挙動で false', () => {
  // y=10 (上辺) では (yi>y)!=(yj>y) が成立せず内部判定されない＝Python と同一
  assert.equal(pointInRings(5, 10, SQUARE), false);
});

test('pointInRings: 空 rings は false', () => {
  assert.equal(pointInRings(5, 5, []), false);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: FAIL（`Cannot find module '.../js/lib/drilldown/geo_poly.js'` または `pointInRings is not a function` でテストがエラー終了する）

- [ ] **Step 3: 最小実装を書く**

`js/lib/drilldown/geo_poly.js` を新規作成し、以下を書く。`pointInRings` は `geo_country.py:30-42` の式を同一移植する。

```js
// 国境/県境ポリゴンの点内判定（純 ray-casting）。collectors/lib/geo_country.py を JS 同一移植。
// deck/DOM/fetch/map 非依存・node:test の主対象。

// 全リング横断の even-odd（穴・MultiPolygon を正しく扱う）。
// collectors/lib/geo_country.py:30-42 の _point_in_rings と同一式。
export function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
      j = i;
    }
  }
  return inside;
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: PASS（8 tests pass）

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/geo_poly.js tests/drilldown_geo_poly.test.js && git commit -m "geo_poly: pointInRings を geo_country.py から同一移植"
```

---

### Task C1.2: loadPolygons (GeoJSON 正規化・load_polygons 相当)

`collectors/lib/geo_country.py:4-27` の `load_polygons` を JS へ移植しつつ、正準シグネチャに合わせ `name_ja` と `codeKey` オプションを追加する。Polygon は各リングを `[lon,lat]` 配列として rings に、MultiPolygon は全 poly の全 ring を一つの rings 配列へ flatten する（Python `geo_country.py:17-20` と同一）。bbox は全 rings の全点から `[min(xs), min(ys), max(xs), max(ys)]`（=`[w,s,e,n]`）。code が無い feature は Python 同様スキップ。rings が空の feature もスキップ。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/geo_poly.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_geo_poly.test.js`

**Interfaces:**
- Consumes: (なし)
- Produces: `loadPolygons(geojson, {codeKey='code'}={}) -> [{code, name, name_ja, bbox:[w,s,e,n], rings}]`

- [ ] **Step 1: 失敗テストを追加する**

`tests/drilldown_geo_poly.test.js` の末尾に以下のテストを追記する。

```js
import { loadPolygons } from '../js/lib/drilldown/geo_poly.js';

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: 'US', name: 'United States', name_ja: 'アメリカ合衆国' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    },
    {
      type: 'Feature',
      properties: { code: 'JP', name: 'Japan' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
          [[[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]]],
        ],
      },
    },
  ],
};

test('loadPolygons: Polygon を {code,name,name_ja,bbox,rings} に正規化', () => {
  const polys = loadPolygons(GEOJSON);
  const us = polys.find((p) => p.code === 'US');
  assert.equal(us.name, 'United States');
  assert.equal(us.name_ja, 'アメリカ合衆国');
  assert.deepEqual(us.bbox, [0, 0, 10, 10]);
  assert.equal(us.rings.length, 1);
  assert.deepEqual(us.rings[0][0], [0, 0]);
});

test('loadPolygons: MultiPolygon は全リングを一つの rings に flatten', () => {
  const polys = loadPolygons(GEOJSON);
  const jp = polys.find((p) => p.code === 'JP');
  assert.equal(jp.rings.length, 2);
  // bbox は全 ring の全点から
  assert.deepEqual(jp.bbox, [0, 0, 10, 4]);
});

test('loadPolygons: name_ja 欠落時は null', () => {
  const polys = loadPolygons(GEOJSON);
  const jp = polys.find((p) => p.code === 'JP');
  assert.equal(jp.name_ja, null);
});

test('loadPolygons: codeKey で別キーから code を引ける', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { a1code: 'CA', name: 'California' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    }],
  };
  const polys = loadPolygons(gj, { codeKey: 'a1code' });
  assert.equal(polys.length, 1);
  assert.equal(polys[0].code, 'CA');
});

test('loadPolygons: code 無し / rings 無しの feature はスキップ', () => {
  const gj = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { name: 'no code' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      { type: 'Feature', properties: { code: 'XX' }, geometry: { type: 'Point', coordinates: [0, 0] } },
    ],
  };
  assert.deepEqual(loadPolygons(gj), []);
});

test('loadPolygons: features 無し / null は空配列', () => {
  assert.deepEqual(loadPolygons({}), []);
  assert.deepEqual(loadPolygons({ features: null }), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: FAIL（`loadPolygons is not a function` または import エラーで新規6テストが失敗する）

- [ ] **Step 3: 最小実装を追加する**

`js/lib/drilldown/geo_poly.js` の `pointInRings` 関数の直後（ファイル末尾）に以下を追記する。

```js

// GeoJSON FeatureCollection を点内判定用に正規化する。
// collectors/lib/geo_country.py:4-27 の load_polygons 相当（name_ja/codeKey を追加）。
// 戻り値: [{code, name, name_ja, bbox:[w,s,e,n], rings}]
export function loadPolygons(geojson, { codeKey = 'code' } = {}) {
  const polys = [];
  const features = (geojson && geojson.features) || [];
  for (const f of features) {
    const props = (f && f.properties) || {};
    const code = props[codeKey];
    if (!code) continue;
    const geom = (f && f.geometry) || {};
    const gtype = geom.type;
    const coords = geom.coordinates || [];
    const rings = [];
    if (gtype === 'Polygon') {
      for (const ring of coords) {
        rings.push(ring.map((pt) => [pt[0], pt[1]]));
      }
    } else if (gtype === 'MultiPolygon') {
      for (const poly of coords) {
        for (const ring of poly) {
          rings.push(ring.map((pt) => [pt[0], pt[1]]));
        }
      }
    }
    if (rings.length === 0) continue;
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const ring of rings) {
      for (const pt of ring) {
        if (pt[0] < w) w = pt[0];
        if (pt[0] > e) e = pt[0];
        if (pt[1] < s) s = pt[1];
        if (pt[1] > n) n = pt[1];
      }
    }
    polys.push({
      code,
      name: props.name == null ? null : props.name,
      name_ja: props.name_ja == null ? null : props.name_ja,
      bbox: [w, s, e, n],
      rings,
    });
  }
  return polys;
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: PASS（14 tests pass）

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/geo_poly.js tests/drilldown_geo_poly.test.js && git commit -m "geo_poly: loadPolygons で GeoJSON を正規化(name_ja/codeKey対応)"
```

---

### Task C1.3: pointInFeature (bbox 早期棄却→pointInRings)

`collectors/lib/geo_country.py:52-57` の per-poly bbox prefilter ＋ `_point_in_rings` 呼び出しを一点判定関数として切り出す。bbox `[w,s,e,n]` の外なら即 false、内なら pointInRings に委譲する（`geo_country.py:54` の早期 continue と同一の境界条件）。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/geo_poly.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_geo_poly.test.js`

**Interfaces:**
- Consumes: `pointInRings(x, y, rings) -> boolean`（同一モジュール内）
- Produces: `pointInFeature(lon, lat, poly) -> boolean`  // bbox早期棄却→pointInRings・poly={code,name,name_ja,bbox,rings}

- [ ] **Step 1: 失敗テストを追加する**

`tests/drilldown_geo_poly.test.js` の末尾に以下を追記する。

```js
import { pointInFeature } from '../js/lib/drilldown/geo_poly.js';

const POLY_US = {
  code: 'US', name: 'United States', name_ja: 'アメリカ合衆国',
  bbox: [0, 0, 10, 10],
  rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
};

test('pointInFeature: bbox 内かつポリゴン内は true', () => {
  assert.equal(pointInFeature(5, 5, POLY_US), true);
});

test('pointInFeature: bbox 外は pointInRings を呼ばず即 false', () => {
  assert.equal(pointInFeature(20, 5, POLY_US), false);
  assert.equal(pointInFeature(5, -5, POLY_US), false);
  assert.equal(pointInFeature(-1, 5, POLY_US), false);
  assert.equal(pointInFeature(5, 11, POLY_US), false);
});

test('pointInFeature: bbox 端(w,s,e,n)は棄却されない', () => {
  // 左下角 (0,0) は bbox 内（< / > の境界）→ pointInRings に委譲
  // 角は even-odd の半開き挙動依存だが bbox 棄却はされないことを確認
  const polyBig = {
    code: 'X', bbox: [0, 0, 10, 10],
    rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
  };
  // bbox 内の確実な内部点
  assert.equal(pointInFeature(0.001, 0.001, polyBig), true);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: FAIL（`pointInFeature is not a function` または import エラーで新規3テストが失敗する）

- [ ] **Step 3: 最小実装を追加する**

`js/lib/drilldown/geo_poly.js` の末尾（`loadPolygons` の後）に以下を追記する。bbox 境界条件は `geo_country.py:54` の `x < b[0] || x > b[2] || y < b[1] || y > b[3]` と同一。

```js

// bbox 早期棄却→pointInRings。collectors/lib/geo_country.py:52-57 の per-poly 判定相当。
// poly = {code, name, name_ja, bbox:[w,s,e,n], rings}
export function pointInFeature(lon, lat, poly) {
  const b = poly.bbox;
  if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
  return pointInRings(lon, lat, poly.rings);
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: PASS（17 tests pass）

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/geo_poly.js tests/drilldown_geo_poly.test.js && git commit -m "geo_poly: pointInFeature で bbox 早期棄却→pointInRings"
```

---

### Task C1.4: locateFeature (最初にヒットした poly を返す・海洋点 null)

`collectors/lib/geo_country.py:45-58` の `point_country` 相当だが、code 文字列でなく **poly オブジェクト**を返す（正準シグネチャ）。polys を順に走査し最初に `pointInFeature` が true の poly を返す。どれにもヒットしなければ `null`（海洋/極域）。これが client FIPS 解決と admin1 割当の共通コアになる。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/geo_poly.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_geo_poly.test.js`

**Interfaces:**
- Consumes: `pointInFeature(lon, lat, poly) -> boolean`（同一モジュール内）
- Produces: `locateFeature(lon, lat, polys) -> poly|null`  // 最初にヒットしたpoly・全ミスは null

- [ ] **Step 1: 失敗テストを追加する**

`tests/drilldown_geo_poly.test.js` の末尾に以下を追記する。

```js
import { locateFeature } from '../js/lib/drilldown/geo_poly.js';

const POLYS = [
  { code: 'A', bbox: [0, 0, 4, 4], rings: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] },
  { code: 'B', bbox: [6, 0, 10, 4], rings: [[[6, 0], [10, 0], [10, 4], [6, 4], [6, 0]]] },
];

test('locateFeature: ヒットした poly オブジェクトを返す', () => {
  const hit = locateFeature(2, 2, POLYS);
  assert.equal(hit.code, 'A');
  const hit2 = locateFeature(8, 2, POLYS);
  assert.equal(hit2.code, 'B');
});

test('locateFeature: 重なり時は配列で最初にヒットした poly', () => {
  const overlap = [
    { code: 'FIRST', bbox: [0, 0, 10, 10], rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    { code: 'SECOND', bbox: [0, 0, 10, 10], rings: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  ];
  assert.equal(locateFeature(5, 5, overlap).code, 'FIRST');
});

test('locateFeature: どこにもヒットしなければ null（海洋/極域）', () => {
  assert.equal(locateFeature(5, 2, POLYS), null); // 隙間
  assert.equal(locateFeature(100, 100, POLYS), null); // 完全に外
});

test('locateFeature: 空 polys は null', () => {
  assert.equal(locateFeature(5, 5, []), null);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: FAIL（`locateFeature is not a function` または import エラーで新規4テストが失敗する）

- [ ] **Step 3: 最小実装を追加する**

`js/lib/drilldown/geo_poly.js` の末尾（`pointInFeature` の後）に以下を追記する。`point_country` が code を返すのに対しこちらは poly を返す（呼び出し側が code/name_ja/bbox を使うため）。

```js

// polys を順に走査し最初にヒットした poly を返す。全ミスは null（海洋/極域）。
// collectors/lib/geo_country.py:45-58 の point_country 相当（code でなく poly を返す）。
export function locateFeature(lon, lat, polys) {
  for (const p of polys) {
    if (pointInFeature(lon, lat, p)) return p;
  }
  return null;
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_geo_poly.test.js
```

Expected: PASS（21 tests pass）

- [ ] **Step 5: 全テスト基線(352 pass)が壊れていないか確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/*.test.js 2>&1 | tail -15
```

Expected: PASS（既存 352 pass ＋ 本クラスタ 21 = 373 pass・fail 0。新規ファイルのみ追加で既存契約は不変更）

- [ ] **Step 5b: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/geo_poly.js tests/drilldown_geo_poly.test.js && git commit -m "geo_poly: locateFeature で最初にヒットした poly を返す(海洋null)"
```

---

## クラスタ C2 — 独立純関数 (js/lib/drilldown/nearest.js / js/lib/zoom_for_bbox.js)

### Task C2-1: nearest.js — sqDistDeg と nearestCity（最寄り都市・cosLat補正二乗距離）

最寄り都市探索の純関数。`sqDistDeg` は equirectangular（cosLat補正）の二乗距離（sqrt不要・比較専用）。`nearestCity` は線形最近傍で、`maxDeg`（度）を超える最近傍は null、cities が 0 件も null。同距離タイブレークは配列の先頭（先勝ち）で安定。依存なしの独立純関数。

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/nearest.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_nearest.test.js`

**Interfaces:**
- Consumes: （なし・独立純関数）
- Produces:
  - `sqDistDeg(aLon, aLat, bLon, bLat) -> number` — equirectangular cosLat補正の二乗距離（sqrt不要）。`dLon = (aLon-bLon)*cos(meanLatRad)`, `dLat = aLat-bLat`, 戻り値 `dLon*dLon + dLat*dLat`。
  - `nearestCity(lon, lat, cities, {maxDeg=1.5}={}) -> city|null` — `city={name,name_ja,lon,lat,pop}`。最近傍 city を返す。0件/最近傍が maxDeg 超は null。同距離は先頭優先（安定）。

- [ ] **Step 1: 失敗テストを書く（完全なテストコード）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_nearest.test.js` を新規作成し、以下を全文記述する。

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqDistDeg, nearestCity } from '../js/lib/drilldown/nearest.js';

test('sqDistDeg: 同一点は 0', () => {
  assert.equal(sqDistDeg(10, 20, 10, 20), 0);
});

test('sqDistDeg: 純緯度差は cos 補正を受けず差の二乗', () => {
  // 経度差なし→ dLon=0, dLat=2 → 4
  assert.ok(Math.abs(sqDistDeg(0, 0, 0, 2) - 4) < 1e-9);
});

test('sqDistDeg: 高緯度では同じ経度差でも cosLat 補正で距離が縮む', () => {
  // 経度差 2 度。赤道(lat0)と高緯度(lat60)で比較すると高緯度の方が小さい。
  const atEquator = sqDistDeg(0, 0, 2, 0);
  const atHigh = sqDistDeg(0, 60, 2, 60);
  assert.ok(atHigh < atEquator, 'cosLat 補正で高緯度の経度差は縮む');
  // lat=0 は cos(0)=1 → dLon=2 → 4
  assert.ok(Math.abs(atEquator - 4) < 1e-9);
});

test('sqDistDeg: 引数順に対して対称', () => {
  const ab = sqDistDeg(10, 30, 12, 33);
  const ba = sqDistDeg(12, 33, 10, 30);
  assert.ok(Math.abs(ab - ba) < 1e-9);
});

test('nearestCity: 最も近い都市を返す', () => {
  const cities = [
    { name: 'Far', name_ja: '遠', lon: 5, lat: 5, pop: 100 },
    { name: 'Near', name_ja: '近', lon: 0.1, lat: 0.1, pop: 200 },
    { name: 'Mid', name_ja: '中', lon: 1, lat: 1, pop: 300 },
  ];
  const c = nearestCity(0, 0, cities);
  assert.equal(c.name, 'Near');
});

test('nearestCity: cities 0 件は null', () => {
  assert.equal(nearestCity(0, 0, []), null);
});

test('nearestCity: cities が undefined/null は null', () => {
  assert.equal(nearestCity(0, 0, undefined), null);
  assert.equal(nearestCity(0, 0, null), null);
});

test('nearestCity: 最近傍が maxDeg を超えると null', () => {
  const cities = [{ name: 'Far', name_ja: '遠', lon: 10, lat: 10, pop: 1 }];
  // 既定 maxDeg=1.5。距離は約 14度 ≫ 1.5 → null
  assert.equal(nearestCity(0, 0, cities), null);
});

test('nearestCity: maxDeg を広げれば遠い都市も返る', () => {
  const cities = [{ name: 'Far', name_ja: '遠', lon: 10, lat: 10, pop: 1 }];
  const c = nearestCity(0, 0, cities, { maxDeg: 20 });
  assert.equal(c.name, 'Far');
});

test('nearestCity: maxDeg 境界ちょうど（半径内）は採用される', () => {
  // 純緯度差 1.5 度ちょうど。dLat=1.5 → 距離=1.5 ≤ maxDeg=1.5 → 採用
  const cities = [{ name: 'Edge', name_ja: '境', lon: 0, lat: 1.5, pop: 1 }];
  const c = nearestCity(0, 0, cities, { maxDeg: 1.5 });
  assert.equal(c.name, 'Edge');
});

test('nearestCity: 同距離は配列先頭を優先（安定タイブレーク）', () => {
  const cities = [
    { name: 'First', name_ja: '一', lon: 1, lat: 0, pop: 1 },
    { name: 'Second', name_ja: '二', lon: -1, lat: 0, pop: 1 },
  ];
  // (0,0) から両者とも経度差 1（同距離）→ 先頭 First
  const c = nearestCity(0, 0, cities);
  assert.equal(c.name, 'First');
});

test('nearestCity: cosLat 補正で高緯度の経度差が縮み判定が変わる', () => {
  // lat=80 付近。A は経度差大だが高緯度で縮む、B は緯度差。
  const cities = [
    { name: 'EastFar', name_ja: '東', lon: 6, lat: 80, pop: 1 },   // 経度差6, cos(80)≈0.173 → 実効 ~1.04
    { name: 'NorthMid', name_ja: '北', lon: 0, lat: 81.5, pop: 1 }, // 緯度差1.5
  ];
  const c = nearestCity(0, 80, cities, { maxDeg: 5 });
  // EastFar の実効距離 ~1.04 < NorthMid 1.5 → EastFar
  assert.equal(c.name, 'EastFar');
});
```

- [ ] **Step 2: 失敗を確認する（モジュール未作成）**

```bash
node --test tests/drilldown_nearest.test.js
```

Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: FAIL — `js/lib/drilldown/nearest.js` が存在しないため `ERR_MODULE_NOT_FOUND`（Cannot find module ... nearest.js）で全テストが失敗する。

- [ ] **Step 3: 最小実装を書く（完全な実装コード）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/nearest.js` を新規作成し、以下を全文記述する。

```javascript
// 最寄り都市探索の純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。
// 距離は equirectangular（cosLat 補正）の二乗距離で比較する（sqrt 不要・順位は二乗でも保存される）。

// 2 点間の equirectangular 二乗距離（度^2）。経度差は両点の平均緯度の cos で補正し、
// 高緯度での経度方向の度詰まりを反映する。順位比較専用（sqrt しない）。
export function sqDistDeg(aLon, aLat, bLon, bLat) {
  const meanLatRad = (((aLat + bLat) / 2) * Math.PI) / 180;
  const dLon = (aLon - bLon) * Math.cos(meanLatRad);
  const dLat = aLat - bLat;
  return dLon * dLon + dLat * dLat;
}

// (lon,lat) に最も近い city を線形探索で返す。city={name,name_ja,lon,lat,pop}。
// cities が空/未指定なら null。最近傍が maxDeg（度）を超える場合も null（「都市名なし」）。
// 同距離は配列の先頭を優先（安定タイブレーク）。
export function nearestCity(lon, lat, cities, { maxDeg = 1.5 } = {}) {
  if (!Array.isArray(cities) || cities.length === 0) return null;
  const maxSq = maxDeg * maxDeg;
  let best = null;
  let bestSq = Infinity;
  for (const c of cities) {
    const d = sqDistDeg(lon, lat, c.lon, c.lat);
    if (d < bestSq) {
      bestSq = d;
      best = c;
    }
  }
  if (best === null || bestSq > maxSq) return null;
  return best;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --test tests/drilldown_nearest.test.js
```

Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: PASS — 12 tests pass（`# pass 12` / `# fail 0`）。

注意: `境界ちょうど` テストは `maxSq = 1.5*1.5 = 2.25`, 距離 `1.5^2 = 2.25` で `bestSq > maxSq` は false（等しいので採用）。`maxDeg 超で null` テストは距離 `sqDistDeg(0,0,10,10)`＝cos(5°)≈0.9962 補正後でも約 199 ≫ 2.25 で null になることを確認。

- [ ] **Step 5: コミットする**

```bash
git add js/lib/drilldown/nearest.js tests/drilldown_nearest.test.js
git commit -m "drilldown: 最寄り都市探索 nearest.js（sqDistDeg/nearestCity・cosLat補正二乗距離・maxDeg閾値・安定タイブレーク）"
```

---

### Task C2-2: zoom_for_bbox.js — zoomForBbox（bbox から flyTo zoom 逆算・clamp・アンチメリディアン保護）

bbox の lon/lat span のうち**大きい方**から、`degLenForZoom`（`js/lib/geo.js`）整合の式で zoom を逆算する純関数。`mpp = 156543.03 / 2^zoom`・1度≈111320m を参照ビューポート（512px）で解いて zoom を求め、`[minZoom, maxZoom]` に clamp する。span が大きいほど zoom は小さい（単調減少）。極小 span は maxZoom、巨大 span は minZoom にクランプ。アンチメリディアンで w>e（折返し）の bbox では `360 - lonSpan` を採り過剰ズームアウトしない。bbox 不正（非配列/非数）は安全側で minZoom を返す。依存なしの独立純関数。

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/zoom_for_bbox.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/zoom_for_bbox.test.js`

**Interfaces:**
- Consumes: （なし・式は `js/lib/geo.js` の `degLenForZoom` と同じ定数 `156543.03` / `111320` を流用するが import はしない）
- Produces:
  - `zoomForBbox(bbox, {minZoom=2.5, maxZoom=6, pad=1.15}={}) -> number` — `bbox=[w,s,e,n]`。lon span は `e>=w` のとき `e-w`、`w>e`（アンチメリディアン折返し）のとき `(e+360)-w`。lat span は `n-s`。両 span の度→m 換算（lon は中央緯度の cosLat 補正）で大きい方を採用し、参照 512px に収まる zoom を逆算→clamp。

- [ ] **Step 1: 失敗テストを書く（完全なテストコード）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/zoom_for_bbox.test.js` を新規作成し、以下を全文記述する。

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoomForBbox } from '../js/lib/zoom_for_bbox.js';

test('zoomForBbox: 戻り値は [minZoom, maxZoom] 内', () => {
  const z = zoomForBbox([0, 0, 10, 10]);
  assert.ok(z >= 2.5 && z <= 6, `z=${z} は既定 clamp 範囲内`);
});

test('zoomForBbox: span が大きいほど zoom は小さい（単調減少）', () => {
  const small = zoomForBbox([0, 0, 2, 2]);
  const mid = zoomForBbox([0, 0, 8, 8]);
  const big = zoomForBbox([0, 0, 30, 30]);
  assert.ok(small >= mid, `small(${small}) >= mid(${mid})`);
  assert.ok(mid >= big, `mid(${mid}) >= big(${big})`);
});

test('zoomForBbox: 極小国は maxZoom にクランプ', () => {
  // 0.05 度四方の極小 bbox → 上限 6 に張り付く
  const z = zoomForBbox([0, 0, 0.05, 0.05]);
  assert.equal(z, 6);
});

test('zoomForBbox: 巨大国（ロシア級 span）は minZoom にクランプ', () => {
  // 経度 150 度 span の巨大 bbox → 下限 2.5 に張り付く
  const z = zoomForBbox([20, 40, 170, 75]);
  assert.equal(z, 2.5);
});

test('zoomForBbox: lat span が lon span より大きい国は lat 主導', () => {
  // 縦長 bbox（lat span 40 > lon span 5）。lat 主導で広く引く。
  const tall = zoomForBbox([0, 0, 5, 40]);
  // 同じ最大 span を持つ横長 bbox と概ね同等の zoom
  const wide = zoomForBbox([0, 0, 40, 5]);
  // どちらも minZoom 近辺。差は cosLat 補正分のみ。tall/wide とも下限近く。
  assert.ok(tall <= 4 && wide <= 4, `tall=${tall} wide=${wide} 共に広め`);
});

test('zoomForBbox: アンチメリディアン折返し(w>e)は実 span を 360-差で取り過剰ズームアウトしない', () => {
  // フィジー級: w=177, e=-178（折返し）。実 span = (-178+360)-177 = 5 度。
  const wrapped = zoomForBbox([177, -18, -178, -16]);
  // もし w>e を素直に e-w=-355 や |−355| として扱うと巨大 span 誤認 → minZoom。
  // 実 span 5 度（lat span 2 度）相当として小さめ span → 高め zoom になるはず。
  const equiv = zoomForBbox([0, -18, 5, -16]);
  assert.ok(Math.abs(wrapped - equiv) < 1e-6, `wrapped=${wrapped} は実 span 等価 equiv=${equiv} と一致`);
  assert.ok(wrapped > 2.5, '過剰ズームアウト(minZoom 張り付き)しない');
});

test('zoomForBbox: pad を大きくすると zoom は同じか小さくなる（余白増）', () => {
  const tight = zoomForBbox([0, 0, 10, 10], { pad: 1.0 });
  const loose = zoomForBbox([0, 0, 10, 10], { pad: 1.6 });
  assert.ok(loose <= tight, `pad 大の loose(${loose}) <= tight(${tight})`);
});

test('zoomForBbox: minZoom/maxZoom を上書きできる', () => {
  const z = zoomForBbox([0, 0, 0.01, 0.01], { maxZoom: 9 });
  assert.equal(z, 9);
  const z2 = zoomForBbox([0, 40, 179, 75], { minZoom: 1 });
  assert.equal(z2, 1);
});

test('zoomForBbox: 不正 bbox（非配列・要素数不足・NaN）は安全側で minZoom', () => {
  assert.equal(zoomForBbox(null), 2.5);
  assert.equal(zoomForBbox([0, 0, 10]), 2.5);
  assert.equal(zoomForBbox([0, 0, NaN, 10]), 2.5);
  assert.equal(zoomForBbox('x'), 2.5);
});

test('zoomForBbox: degLenForZoom 整合（同 span は決定的に同値）', () => {
  const a = zoomForBbox([0, 0, 12, 9]);
  const b = zoomForBbox([0, 0, 12, 9]);
  assert.equal(a, b);
  assert.ok(Number.isFinite(a));
});
```

- [ ] **Step 2: 失敗を確認する（モジュール未作成）**

```bash
node --test tests/zoom_for_bbox.test.js
```

Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: FAIL — `js/lib/zoom_for_bbox.js` が存在しないため `ERR_MODULE_NOT_FOUND`（Cannot find module ... zoom_for_bbox.js）で全テストが失敗する。

- [ ] **Step 3: 最小実装を書く（完全な実装コード）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/zoom_for_bbox.js` を新規作成し、以下を全文記述する。

```javascript
// bbox から flyTo に渡す zoom を逆算する純粋ヘルパ（ブラウザ・Node 双方で import 可能な ESM）。
// js/lib/geo.js の degLenForZoom（mpp = 156543.03 / 2^zoom・1度 ≈ 111320m）と同じ定数で整合する。
// 参照ビューポート(REF_PX)に bbox の最大 span を pad 込みで収める zoom を解き、[minZoom,maxZoom] に clamp する。

const M_PER_DEG = 111320;      // 1 度 ≈ 111320m（geo.js degLenForZoom と同一）
const EQ_MPP_Z0 = 156543.03;   // 赤道 metersPerPixel at zoom 0（geo.js degLenForZoom と同一）
const REF_PX = 512;            // 参照ビューポート（タイル基準の標準幅）。span をこの画素数に収める。

// bbox=[w,s,e,n]。lon/lat span の大きい方（メートル換算）を参照ビューポートに pad 込みで収める zoom を返す。
// w>e はアンチメリディアン折返しとみなし lon span を (e+360)-w で算出（過剰ズームアウト回避）。
// bbox 不正は安全側で minZoom を返す。span が極小→maxZoom、巨大→minZoom にクランプ。
export function zoomForBbox(bbox, { minZoom = 2.5, maxZoom = 6, pad = 1.15 } = {}) {
  if (!Array.isArray(bbox) || bbox.length < 4) return minZoom;
  const [w, s, e, n] = bbox;
  if (![w, s, e, n].every(Number.isFinite)) return minZoom;

  // lon span（度）。e>=w は通常、w>e は日付変更線跨ぎの折返し。
  const lonSpanDeg = e >= w ? e - w : (e + 360) - w;
  const latSpanDeg = Math.abs(n - s);

  // メートル換算。lon は中央緯度の cosLat 補正（高緯度の度詰まり）。
  const midLatRad = (((s + n) / 2) * Math.PI) / 180;
  const cosLat = Math.max(Math.cos(midLatRad), 0.01);
  const lonSpanM = Math.abs(lonSpanDeg) * M_PER_DEG * cosLat;
  const latSpanM = latSpanDeg * M_PER_DEG;
  const spanM = Math.max(lonSpanM, latSpanM);

  // span が 0（点）なら maxZoom に張り付ける（極小国扱い）。
  if (!(spanM > 0)) return maxZoom;

  // spanM * pad <= REF_PX * (EQ_MPP_Z0 / 2^zoom) を解く:
  //   2^zoom = REF_PX * EQ_MPP_Z0 / (spanM * pad)
  //   zoom   = log2( REF_PX * EQ_MPP_Z0 / (spanM * pad) )
  const z = Math.log2((REF_PX * EQ_MPP_Z0) / (spanM * pad));
  return Math.max(minZoom, Math.min(maxZoom, z));
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
node --test tests/zoom_for_bbox.test.js
```

Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: PASS — 10 tests pass（`# pass 10` / `# fail 0`）。

検算（実装が満たすこと）:
- `[0,0,0.05,0.05]`: spanM = 0.05*111320 ≈ 5566m, `z = log2(512*156543.03/(5566*1.15)) = log2(80,310,... /6401) ≈ log2(12546) ≈ 13.6` → maxZoom=6 にクランプ。
- `[20,40,170,75]`: lonSpanDeg=150, cosLat≈cos(57.5°)=0.537 → lonSpanM≈150*111320*0.537≈8.97e6m。`z=log2(512*156543/(8.97e6*1.15))=log2(8.03e7/1.03e7)≈log2(7.78)≈2.96`。lat span 35 度=3.9e6m < lon。max span≈8.97e6 → z≈2.96 ... これは minZoom=2.5 より上。テスト期待は 2.5。

  → 検算が示すとおり `[20,40,170,75]` は z≈2.96 で minZoom に届かない。**テスト bbox を minZoom 到達まで広げる必要がある**。Step 1 の該当テストを次に修正する（Step 4 内で確定値に合わせる）。

- [ ] **Step 4b: クランプ到達テストの bbox を実装の決定値に合わせる**

巨大国テストと minZoom 上書きテストが確実に下限へ張り付くよう、Step 1 のテスト 2 箇所を編集する。`tests/zoom_for_bbox.test.js` の該当 `assert` を以下に置換する。

置換前（巨大国）:
```javascript
  // 経度 150 度 span の巨大 bbox → 下限 2.5 に張り付く
  const z = zoomForBbox([20, 40, 170, 75]);
  assert.equal(z, 2.5);
```
置換後:
```javascript
  // 経度 320 度 span 級の極端 bbox（赤道付近で cosLat 補正最小）→ 下限 2.5 に張り付く
  const z = zoomForBbox([-160, -5, 160, 5]);
  assert.equal(z, 2.5);
```
検算: lonSpanDeg=320, midLat=0→cosLat=1, lonSpanM=320*111320=3.56e7m。`z=log2(512*156543/(3.56e7*1.15))=log2(8.03e7/4.1e7)=log2(1.96)≈0.97` → clamp 2.5。確実に下限。

置換前（minZoom 上書き）:
```javascript
  const z2 = zoomForBbox([0, 40, 179, 75], { minZoom: 1 });
  assert.equal(z2, 1);
```
置換後:
```javascript
  const z2 = zoomForBbox([-160, -5, 160, 5], { minZoom: 1 });
  assert.equal(z2, 1);
```
検算: 上と同じ z≈0.97 → clamp 1。

編集後に再実行する。

```bash
node --test tests/zoom_for_bbox.test.js
```
Expected: PASS — 10 tests pass（`# pass 10` / `# fail 0`）。

さらに単調減少テストの検算（実装が満たすこと）:
- `[0,0,2,2]`: spanM=2*111320=222640m, `z=log2(512*156543/(222640*1.15))=log2(8.03e7/256036)=log2(313.5)≈8.29` → clamp 6。
- `[0,0,8,8]`: cos(4°)=0.9976, lonSpanM=8*111320*0.9976≈888k、latSpanM=8*111320=890560、span≈890560, `z=log2(8.03e7/(890560*1.15))=log2(8.03e7/1.02e6)=log2(78.4)≈6.29` → clamp 6。`small(6)>=mid(6)` 成立。
- `[0,0,30,30]`: latSpanM=30*111320=3.34e6, `z=log2(8.03e7/(3.34e6*1.15))=log2(8.03e7/3.84e6)=log2(20.9)≈4.39` → mid(6)>=big(4.39) 成立。
全て単調性を満たす。

- [ ] **Step 5: コミットする**

```bash
git add js/lib/zoom_for_bbox.js tests/zoom_for_bbox.test.js
git commit -m "drilldown: bbox→flyTo zoom 逆算 zoomForBbox（degLenForZoom整合・min/max clamp・アンチメリディアン保護）"
```

---

### Task C2-3: クラスタ全体の緑確認（C2 完了ゲート）

C2 の 2 ファイル＋テストが既存 baseline を壊さず緑であることを確認する。新規追加分のみ実行→全体 sweep。

**Files:**
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_nearest.test.js`, `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/zoom_for_bbox.test.js`

**Interfaces:**
- Consumes: C2-1 `nearestCity`/`sqDistDeg`, C2-2 `zoomForBbox`
- Produces: （検証のみ・新規シグネチャなし）

- [ ] **Step 1: C2 の 2 テストをまとめて実行**

```bash
node --test tests/drilldown_nearest.test.js tests/zoom_for_bbox.test.js
```
Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: PASS — 合計 22 tests pass（nearest 12 + zoom 10・`# fail 0`）。

- [ ] **Step 2: 既存 baseline を含む全 JS テストで回帰がないことを確認**

```bash
node --test tests/*.test.js
```
Working directory は `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown`。
Expected: PASS — baseline 352 pass ＋ C2 追加 22 = 374 pass（`# fail 0`）。既存テストは無改修のまま緑を維持する（C2 は新規ファイルのみ追加で既存 import 契約に非侵襲）。

- [ ] **Step 3: （コミット不要）**

検証のみのため新規コミットは作らない。C2-1/C2-2 のコミットで完了。

---

## クラスタ C3 — build時データ準備 (scripts/lib/ne_prep.py / build_*.py / country_bounds 50m再生成)

## クラスタ C3: build時データ準備（Python）

担当範囲は「ビルド時に静的データを生成する Python レイヤー」。`scripts/lib/ne_prep.py`（標準ライブラリのみの純粋関数群・pytest 対象）と、それを使う I/O スクリプト（`build_country_bounds.py` / `build_admin1.py` / `build_cities.py` / `build_drilldown_manifest.py`）からなる。collector / orbis-data / データパイプラインは無改修（確定事項5）。

前提（実コード検証済）:
- pytest は repo 直下に `collectors` / `scripts` パッケージがあり、`tests/conftest.py` が無いため **`PYTHONPATH=.` を付けないと `ModuleNotFoundError: No module named 'scripts'`** になる（`uv run pytest tests/test_geo_country.py` は失敗、`PYTHONPATH=. uv run pytest ...` は成功を実測）。本クラスタの pytest コマンドは全て `PYTHONPATH=. uv run pytest ...` とする。
- `data/static/country_bounds.geojson` は 171 features・properties=`{code(FIPS), name}` のみ・geom は Polygon 143 / MultiPolygon 28（実測）。`code` は既に FIPS（CH=中国/SF=南アフリカ/AS=豪州/AU=オーストリア/SZ=スイス が name と整合することを実測）。
- Python は 3.14.4（uv 環境・`.venv`）。geopandas は無い（`requirements.txt` は requests/Pillow/websocket-client/anthropic のみ）。よって ne_prep は **`json` / `math` のみ**に依存する。

---

### Task C3.1: scripts/lib をパッケージ化し FIPS_OF_ISO 変換表を作る

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/__init__.py`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/fips_of_iso.py`

**Interfaces:**
- Produces: `scripts/lib/fips_of_iso.py::FIPS_OF_ISO: dict[str, str]`（ISO_A2 → FIPS 10-4）
- Consumes: なし

このタスクは定数表のみで純粋関数を持たないが、後続の `resolve_fips` テストが import するため先に置く。テストは Task C3.2 で `resolve_fips` 経由で間接検証する（表単体テストは作らない＝重複回避）。

**Step 1 — `scripts/lib/__init__.py` を作る（空パッケージマーカー）**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/__init__.py`:

```python
```

（空ファイル。`scripts` 自体は `__init__.py` を持たないが pytest は rootdir からの import を解決できる。確実性のため `scripts/__init__.py` も無ければ Step 2 で作る。）

**Step 2 — `scripts/__init__.py` の有無を確認し無ければ作る**

```bash
ls /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/__init__.py 2>/dev/null || printf '' > /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/__init__.py
```

Expected: 既存スクリプト（gen_country_centroids.py）は `scripts.foo` 形式 import をしていないが、`from scripts.lib.ne_prep import ...` を成立させるため `scripts/__init__.py` と `scripts/lib/__init__.py` の双方を空で用意する。

**Step 3 — FIPS_OF_ISO 表を作る**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/fips_of_iso.py`:

```python
"""ISO 3166-1 alpha-2 → FIPS 10-4 国コード変換表（手キュレート）。

Natural Earth admin1/populated_places は ISO_A2 / ADM0_A3 を持つが、
Orbis の一次キーは FIPS（js/lib/places.js FIPS_JA・239キー）。両系統は
別物で取り違えやすい（ISO CH=スイス↔FIPS CH=中国 / ISO ZA=南アフリカ↔FIPS SF /
ISO AU=豪州↔FIPS AS / ISO AT=オーストリア↔FIPS AU）。resolve_fips が
country_bounds の name 突合と二重チェックして取り違えを検出する。

ここに無い ISO は resolve_fips が name 突合のみで解決を試み、それも外れたら
None（build ログに出して手キュレートへ）。
"""

# ISO_A2 -> FIPS。FIPS_JA（239キー）でカバーされる主要国を網羅する。
# 値は js/lib/places.js FIPS_JA のキーと一致しなければならない。
FIPS_OF_ISO = {
    "AD": "AN", "AE": "AE", "AF": "AF", "AG": "AC", "AI": "AV", "AL": "AL",
    "AM": "AM", "AO": "AO", "AQ": "AY", "AR": "AR", "AS": "AQ", "AT": "AU",
    "AU": "AS", "AW": "AA", "AX": "FI", "AZ": "AJ", "BA": "BK", "BB": "BB",
    "BD": "BG", "BE": "BE", "BF": "UV", "BG": "BU", "BH": "BA", "BI": "BY",
    "BJ": "BN", "BL": "TB", "BM": "BD", "BN": "BX", "BO": "BL", "BQ": "NL",
    "BR": "BR", "BS": "BF", "BT": "BT", "BV": "BV", "BW": "BC", "BY": "BO",
    "BZ": "BH", "CA": "CA", "CC": "CK", "CD": "CG", "CF": "CT", "CG": "CF",
    "CH": "SZ", "CI": "IV", "CK": "CW", "CL": "CI", "CM": "CM", "CN": "CH",
    "CO": "CO", "CR": "CS", "CU": "CU", "CV": "CV", "CW": "UC", "CX": "KT",
    "CY": "CY", "CZ": "EZ", "DE": "GM", "DJ": "DJ", "DK": "DA", "DM": "DO",
    "DO": "DR", "DZ": "AG", "EC": "EC", "EE": "EN", "EG": "EG", "EH": "WI",
    "ER": "ER", "ES": "SP", "ET": "ET", "FI": "FI", "FJ": "FJ", "FK": "FK",
    "FM": "FM", "FO": "FO", "FR": "FR", "GA": "GB", "GB": "UK", "GD": "GJ",
    "GE": "GG", "GF": "FG", "GG": "GK", "GH": "GH", "GI": "GI", "GL": "GL",
    "GM": "GA", "GN": "GV", "GP": "GP", "GQ": "EK", "GR": "GR", "GS": "SX",
    "GT": "GT", "GU": "GQ", "GW": "PU", "GY": "GY", "HK": "HK", "HN": "HO",
    "HR": "HR", "HT": "HA", "HU": "HU", "ID": "ID", "IE": "EI", "IL": "IS",
    "IM": "IM", "IN": "IN", "IO": "IO", "IQ": "IZ", "IR": "IR", "IS": "IC",
    "IT": "IT", "JE": "JE", "JM": "JM", "JO": "JO", "JP": "JA", "KE": "KE",
    "KG": "KG", "KH": "CB", "KI": "KR", "KM": "CN", "KN": "SC", "KP": "KN",
    "KR": "KS", "KW": "KU", "KY": "CJ", "KZ": "KZ", "LA": "LA", "LB": "LE",
    "LC": "ST", "LI": "LS", "LK": "CE", "LR": "LI", "LS": "LT", "LT": "LH",
    "LU": "LU", "LV": "LG", "LY": "LY", "MA": "MO", "MC": "MN", "MD": "MD",
    "ME": "MJ", "MF": "RN", "MG": "MA", "MH": "RM", "MK": "MK", "ML": "ML",
    "MM": "BM", "MN": "MG", "MO": "MC", "MP": "CQ", "MQ": "MB", "MR": "MR",
    "MS": "MH", "MT": "MT", "MU": "MP", "MV": "MV", "MW": "MI", "MX": "MX",
    "MY": "MY", "MZ": "MZ", "NA": "WA", "NC": "NC", "NE": "NG", "NF": "NF",
    "NG": "NI", "NI": "NU", "NL": "NL", "NO": "NO", "NP": "NP", "NR": "NR",
    "NU": "NE", "NZ": "NZ", "OM": "MU", "PA": "PM", "PE": "PE", "PF": "FP",
    "PG": "PP", "PH": "RP", "PK": "PK", "PL": "PL", "PM": "SB", "PN": "PC",
    "PR": "RQ", "PS": "WE", "PT": "PO", "PW": "PS", "PY": "PA", "QA": "QA",
    "RE": "RE", "RO": "RO", "RS": "RI", "RU": "RS", "RW": "RW", "SA": "SA",
    "SB": "BP", "SC": "SE", "SD": "SU", "SE": "SW", "SG": "SN", "SH": "SH",
    "SI": "SI", "SJ": "SV", "SK": "LO", "SL": "SL", "SM": "SM", "SN": "SG",
    "SO": "SO", "SR": "NS", "SS": "OD", "ST": "TP", "SV": "ES", "SX": "NN",
    "SY": "SY", "SZ": "WZ", "TC": "TK", "TD": "CD", "TF": "FS", "TG": "TO",
    "TH": "TH", "TJ": "TI", "TK": "TL", "TL": "TT", "TM": "TX", "TN": "TS",
    "TO": "TN", "TR": "TU", "TT": "TD", "TV": "TV", "TW": "TW", "TZ": "TZ",
    "UA": "UP", "UG": "UG", "US": "US", "UY": "UY", "UZ": "UZ", "VA": "VT",
    "VC": "VC", "VE": "VE", "VG": "VI", "VI": "VQ", "VN": "VM", "VU": "NH",
    "WF": "WF", "WS": "WS", "YE": "YM", "ZA": "SF", "ZM": "ZA", "ZW": "ZI",
}
```

**Step 4 — import が通ることを確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run python -c "from scripts.lib.fips_of_iso import FIPS_OF_ISO; print(len(FIPS_OF_ISO), FIPS_OF_ISO['CN'], FIPS_OF_ISO['ZA'], FIPS_OF_ISO['AU'])"
```

Expected: PASS — 標準出力に `200 CH SF AS`（件数は約200・CN→CH/ZA→SF/AU→AS の取り違え対象が正しい FIPS を返す）。`ModuleNotFoundError` が出ないこと。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/__init__.py scripts/lib/__init__.py scripts/lib/fips_of_iso.py && git commit -m "scripts/lib をパッケージ化し ISO_A2→FIPS 変換表を追加"
```

---

### Task C3.2: ne_prep.resolve_fips を TDD で実装（ISO 変換＋name 突合の二重チェック）

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`

**Interfaces:**
- Produces: `scripts/lib/ne_prep.py::resolve_fips(ne_props: dict, bounds_name_index: dict) -> str|None`
- Consumes: `scripts/lib/fips_of_iso.py::FIPS_OF_ISO`

仕様（spec §3 国コード正規化）: `ne_props` は NE feature の properties（`ISO_A2`/`ADM0_A3`/`admin`/`ADMIN`/`name` 等）。`bounds_name_index` は `{country_bounds の英名: FIPS}` の dict（呼び側が `{f["properties"]["name"]: f["properties"]["code"]}` で作る）。二重チェックの規則:
1. `ISO_A2` から `FIPS_OF_ISO` で候補 `iso_fips` を引く。
2. `ne_props` の国名（`admin`/`ADMIN`/`geonunit`/`name` の順で最初に取れた値）を `bounds_name_index` で引いて候補 `name_fips` を得る。
3. 両方取れて一致 → その FIPS。両方取れて不一致 → **name 突合を優先**（country_bounds が Orbis 一次キーの権威・spec の罠検出方針＝CH 等の取り違えを name で正す）。
4. 片方のみ取れた → その値。両方 None → None。
5. ISO_A2 が `-99` / 空 / 非文字列なら ISO 候補は無し扱い。

**Step 1 — 失敗テストを書く（resolve_fips 部分のみ・完全コード）**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`:

```python
# tests/test_ne_prep.py — scripts/lib/ne_prep.py（純粋関数）の網羅テスト。
# 実行: PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q
import json
import math

from scripts.lib.ne_prep import (
    resolve_fips,
    pick_name_ja,
    split_by_country,
    largest_polygon_bbox,
    simplify_ring,
    nearest_city_cap,
)

# country_bounds の実態に合わせた最小 name→FIPS インデックス。
BOUNDS_NAME_INDEX = {
    "China": "CH",
    "South Africa": "SF",
    "Australia": "AS",
    "Austria": "AU",
    "Switzerland": "SZ",
    "Japan": "JA",
    "United States of America": "US",
}


def test_resolve_fips_iso_and_name_agree():
    # ISO_A2=CN→FIPS CH、name=China→FIPS CH。一致。
    props = {"ISO_A2": "CN", "admin": "China"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "CH"


def test_resolve_fips_name_wins_over_iso_trap():
    # スイスの NE feature が ISO_A2='CH' を持つ。FIPS_OF_ISO['CH']=SZ なので
    # ISO 候補は SZ、name=Switzerland も SZ。取り違えなし。
    props = {"ISO_A2": "CH", "admin": "Switzerland"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "SZ"


def test_resolve_fips_iso_missing_uses_name():
    # ISO 欠落（-99）でも name 突合で解決する（係争地・小国で頻出）。
    props = {"ISO_A2": "-99", "admin": "South Africa"}
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "SF"


def test_resolve_fips_conflict_prefers_name():
    # 万一 ISO と name が食い違ったら name（country_bounds 権威）を採る。
    props = {"ISO_A2": "AU", "admin": "Australia"}  # ISO AU→FIPS AS、name Australia→AS
    assert resolve_fips(props, BOUNDS_NAME_INDEX) == "AS"
    # 食い違いケース: ISO が AT（→AU=オーストリア）だが name が Australia。
    props2 = {"ISO_A2": "AT", "admin": "Australia"}
    assert resolve_fips(props2, BOUNDS_NAME_INDEX) == "AS"


def test_resolve_fips_unknown_returns_none():
    assert resolve_fips({"ISO_A2": "ZZ", "admin": "Nowhere"}, BOUNDS_NAME_INDEX) is None
    assert resolve_fips({}, BOUNDS_NAME_INDEX) is None
    assert resolve_fips({"ISO_A2": None, "admin": None}, BOUNDS_NAME_INDEX) is None
```

**Step 2 — 失敗を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q
```

Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.lib.ne_prep'`（または collection error）。`scripts/lib/ne_prep.py` 未作成のため。

**Step 3 — resolve_fips を最小実装（ne_prep.py を新規作成・このタスク分のみ記述）**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`:

```python
"""Natural Earth → Orbis 静的データ生成の純粋関数群。

標準ライブラリ（json/math）のみに依存する。geojson は dict で受け、I/O は
呼び側（build_*.py）に置く。pytest（tests/test_ne_prep.py）の主対象。
"""
import math

from scripts.lib.fips_of_iso import FIPS_OF_ISO

# NE が国名を入れる代表プロパティ（admin / ADMIN は admin1/places で揺れる）。
_NAME_KEYS = ("admin", "ADMIN", "geonunit", "GEONUNIT", "name", "NAME")


def _ne_country_name(props):
    for k in _NAME_KEYS:
        v = props.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def resolve_fips(ne_props, bounds_name_index):
    """NE feature properties → FIPS。ISO_A2→FIPS と country_bounds name 突合の
    二重チェックで取り違え（ISO CH=スイス↔FIPS CH=中国 等）を検出する。

    規則:
      1. ISO_A2 から FIPS_OF_ISO で iso_fips を引く（-99/空/非文字列は無し）。
      2. 国名（admin/ADMIN/geonunit/name の順）を bounds_name_index で name_fips に。
      3. 両方あり一致→その値。両方あり不一致→name_fips を優先（country_bounds が権威）。
      4. 片方のみ→その値。両方 None→None。
    """
    iso = ne_props.get("ISO_A2")
    iso_fips = None
    if isinstance(iso, str):
        iso = iso.strip().upper()
        if iso and iso != "-99":
            iso_fips = FIPS_OF_ISO.get(iso)

    name = _ne_country_name(ne_props)
    name_fips = bounds_name_index.get(name) if name else None

    if iso_fips and name_fips:
        return name_fips if name_fips != iso_fips else iso_fips
    return name_fips or iso_fips
```

（`pick_name_ja` / `split_by_country` / `largest_polygon_bbox` / `simplify_ring` / `nearest_city_cap` は後続タスクで追加するが、Step 1 のテストは全関数を import するため **これらを未定義のままにすると import エラーになる**。Step 3 ではまず resolve_fips のみ検証したいので、import エラー回避のため残り 5 関数を `def f(...): raise NotImplementedError` のスタブで先に置く。次のタスクで本実装に差し替える。）

ne_prep.py の末尾に以下のスタブを追記:

```python
def pick_name_ja(props, wikidata_idx, geonames_idx):
    raise NotImplementedError


def split_by_country(features, key_fn):
    raise NotImplementedError


def largest_polygon_bbox(geometry):
    raise NotImplementedError


def simplify_ring(ring, eps):
    raise NotImplementedError


def nearest_city_cap(places, maxN):
    raise NotImplementedError
```

**Step 4 — resolve_fips テストの成功を確認（残テストは後続で追加するため -k で限定）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k resolve_fips
```

Expected: PASS — `5 passed`（resolve_fips 系 5 テストが全て緑）。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/lib/ne_prep.py tests/test_ne_prep.py && git commit -m "ne_prep.resolve_fips（ISO変換＋name突合の二重チェック）を実装"
```

---

### Task C3.3: ne_prep.pick_name_ja を TDD で実装（name:ja 4段フォールバック）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`

**Interfaces:**
- Produces: `scripts/lib/ne_prep.py::pick_name_ja(props: dict, wikidata_idx: dict, geonames_idx: dict) -> str`
- Consumes: なし（純粋・ネット非依存。ネット取得は build スクリプト側でキャッシュ済 idx を渡す）

仕様（spec §3 / 要件4・確定事項4）: 4 段優先で日本語名を返す。
1. NE 属性 `name_ja`（あれば一次）。
2. `wikidata_idx[props["wikidataid"]]`（Wikidata labels(ja)・build 時取得をキャッシュした dict）。
3. `geonames_idx[geonames_key]`（GeoNames alternateNames(ja)。key は `props["ne_id"]` か `props["geonameid"]`）。
4. 真の欠落のみ英名（`name_en` → `name` → `NAME` → `admin`）。

**Step 1 — 失敗テストを追記（pick_name_ja の完全コード）**

Edit `tests/test_ne_prep.py`、末尾に追記:

```python
def test_pick_name_ja_prefers_ne_name_ja():
    props = {"name_ja": "東京都", "wikidataid": "Q1490", "name_en": "Tokyo"}
    assert pick_name_ja(props, {"Q1490": "ウィキ東京"}, {}) == "東京都"


def test_pick_name_ja_falls_to_wikidata():
    props = {"wikidataid": "Q1490", "name_en": "Tokyo"}
    assert pick_name_ja(props, {"Q1490": "東京都"}, {}) == "東京都"


def test_pick_name_ja_falls_to_geonames():
    props = {"ne_id": "1001", "name_en": "Osaka"}
    assert pick_name_ja(props, {}, {"1001": "大阪府"}) == "大阪府"


def test_pick_name_ja_falls_to_english():
    props = {"name_en": "Atlantis"}
    assert pick_name_ja(props, {}, {}) == "Atlantis"
    # name_en も無ければ name / NAME / admin の順。
    assert pick_name_ja({"NAME": "Foo"}, {}, {}) == "Foo"
    # 全欠落は空文字。
    assert pick_name_ja({}, {}, {}) == ""


def test_pick_name_ja_blank_values_skip_to_next():
    # 空白だけの name_ja はスキップして次段へ。
    props = {"name_ja": "  ", "wikidataid": "Q1", "name_en": "X"}
    assert pick_name_ja(props, {"Q1": "ジャパン"}, {}) == "ジャパン"
```

**Step 2 — 失敗を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k pick_name_ja
```

Expected: FAIL — `NotImplementedError`（pick_name_ja がスタブのため・5 テスト失敗）。

**Step 3 — pick_name_ja を本実装に差し替え**

Edit `scripts/lib/ne_prep.py`、スタブ:

```python
def pick_name_ja(props, wikidata_idx, geonames_idx):
    raise NotImplementedError
```

を以下に置換:

```python
def _first_nonblank(*vals):
    for v in vals:
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def pick_name_ja(props, wikidata_idx, geonames_idx):
    """日本語名を 4 段フォールバックで決める（要件4・確定事項4）。
    (1) NE name_ja → (2) Wikidata labels(ja) → (3) GeoNames alternateNames(ja)
    → (4) 真の欠落のみ英名（name_en/name/NAME/admin）。全欠落は空文字。"""
    # (1) NE 属性
    ja = _first_nonblank(props.get("name_ja"), props.get("NAME_JA"))
    if ja:
        return ja
    # (2) Wikidata
    wid = props.get("wikidataid") or props.get("wikidataId") or props.get("WIKIDATAID")
    if isinstance(wid, str) and wid.strip():
        v = wikidata_idx.get(wid.strip())
        if isinstance(v, str) and v.strip():
            return v.strip()
    # (3) GeoNames
    for key in ("ne_id", "geonameid", "GEONAMEID", "geonameId"):
        gid = props.get(key)
        if gid is not None:
            v = geonames_idx.get(str(gid))
            if isinstance(v, str) and v.strip():
                return v.strip()
    # (4) 英名フォールバック
    return _first_nonblank(
        props.get("name_en"), props.get("NAME_EN"),
        props.get("name"), props.get("NAME"), props.get("admin"),
    ) or ""
```

**Step 4 — 成功を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k "pick_name_ja or resolve_fips"
```

Expected: PASS — `10 passed`（resolve_fips 5 ＋ pick_name_ja 5）。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/lib/ne_prep.py tests/test_ne_prep.py && git commit -m "ne_prep.pick_name_ja（name:ja 4段フォールバック）を実装"
```

---

### Task C3.4: ne_prep.split_by_country と nearest_city_cap を TDD で実装

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`

**Interfaces:**
- Produces: `scripts/lib/ne_prep.py::split_by_country(features: list, key_fn) -> dict[str, list]`
- Produces: `scripts/lib/ne_prep.py::nearest_city_cap(places: list, maxN: int) -> list`
- Consumes: なし

仕様: `split_by_country` は features を `key_fn(feature)` の戻り値（FIPS or None）でグループ化した dict を返す（`None` キーのものは捨てる＝未解決国は出力しない）。順序は安定（最初に現れた key 順）。`nearest_city_cap` は `pop` 降順に並べ先頭 `maxN` 件を返す（`pop` 欠落/非数は 0 扱い・同数は入力順安定）。

**Step 1 — 失敗テストを追記**

Edit `tests/test_ne_prep.py`、末尾に追記:

```python
def test_split_by_country_groups_and_drops_none():
    feats = [
        {"id": 1, "fips": "JA"},
        {"id": 2, "fips": "US"},
        {"id": 3, "fips": "JA"},
        {"id": 4, "fips": None},  # 未解決は捨てる
    ]
    out = split_by_country(feats, lambda f: f["fips"])
    assert set(out.keys()) == {"JA", "US"}
    assert [f["id"] for f in out["JA"]] == [1, 3]
    assert [f["id"] for f in out["US"]] == [2]


def test_nearest_city_cap_sorts_by_pop_desc_and_caps():
    places = [
        {"name": "A", "pop": 100},
        {"name": "B", "pop": 5000},
        {"name": "C", "pop": 300},
        {"name": "D"},            # pop 欠落→0
        {"name": "E", "pop": 5000},  # B と同数→入力順で B,E
    ]
    out = nearest_city_cap(places, 3)
    assert [p["name"] for p in out] == ["B", "E", "C"]


def test_nearest_city_cap_handles_empty_and_small():
    assert nearest_city_cap([], 400) == []
    one = [{"name": "X", "pop": 1}]
    assert nearest_city_cap(one, 400) == one
```

**Step 2 — 失敗を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k "split_by_country or nearest_city_cap"
```

Expected: FAIL — `NotImplementedError`（両関数スタブのため・3 テスト失敗）。

**Step 3 — 両関数を本実装に差し替え**

Edit `scripts/lib/ne_prep.py`、スタブ:

```python
def split_by_country(features, key_fn):
    raise NotImplementedError
```

を以下に置換:

```python
def split_by_country(features, key_fn):
    """features を key_fn(feature)→FIPS でグループ化。None キーは捨てる。
    順序は最初に現れた key の安定順。"""
    groups = {}
    for f in features:
        code = key_fn(f)
        if not code:
            continue
        groups.setdefault(code, []).append(f)
    return groups
```

同じく `scripts/lib/ne_prep.py` のスタブ:

```python
def nearest_city_cap(places, maxN):
    raise NotImplementedError
```

を以下に置換:

```python
def _pop_of(place):
    v = place.get("pop")
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def nearest_city_cap(places, maxN):
    """pop 降順に並べ先頭 maxN 件。pop 欠落/非数は 0、同数は入力順安定。"""
    ordered = sorted(places, key=_pop_of, reverse=True)
    return ordered[:maxN] if maxN is not None and maxN >= 0 else ordered
```

**Step 4 — 成功を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k "split_by_country or nearest_city_cap"
```

Expected: PASS — `3 passed`。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/lib/ne_prep.py tests/test_ne_prep.py && git commit -m "ne_prep.split_by_country と nearest_city_cap を実装"
```

---

### Task C3.5: ne_prep.largest_polygon_bbox を TDD で実装（MultiPolygon 最大面積・lonSpan>180 回避）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`

**Interfaces:**
- Produces: `scripts/lib/ne_prep.py::largest_polygon_bbox(geometry: dict) -> list[float]`（`[w,s,e,n]`）
- Consumes: なし

仕様（spec §3 bbox / §8 アンチメリディアン）: GeoJSON geometry（Polygon / MultiPolygon）から **最大面積ポリゴンの outer ring の bbox** を返す。面積は `gen_country_centroids.py:25` と同型の bbox 面積近似 `(max_x-min_x)*(max_y-min_y)`。これにより米/加/フィジー/インドネシアの太平洋跨ぎ（lonSpan>180 の偽 bbox）を回避し、最大本土ポリゴンの矩形だけを使う。Polygon は単一ポリゴン扱い。空 geometry は `None`。

**Step 1 — 失敗テストを追記**

Edit `tests/test_ne_prep.py`、末尾に追記:

```python
def test_largest_polygon_bbox_polygon():
    geom = {
        "type": "Polygon",
        "coordinates": [[[0, 0], [10, 0], [10, 20], [0, 20], [0, 0]]],
    }
    assert largest_polygon_bbox(geom) == [0, 0, 10, 20]


def test_largest_polygon_bbox_picks_largest_part():
    # 小さな飛び地（経度 170..179）＋大きな本土（経度 0..30）。
    # 最大面積は本土→bbox は本土側のみ＝lonSpan 30（太平洋跨ぎ回避）。
    geom = {
        "type": "MultiPolygon",
        "coordinates": [
            [[[170, -5], [179, -5], [179, 5], [170, 5], [170, -5]]],   # 小・幅9
            [[[0, 0], [30, 0], [30, 40], [0, 40], [0, 0]]],            # 大・幅30高40
        ],
    }
    assert largest_polygon_bbox(geom) == [0, 0, 30, 40]


def test_largest_polygon_bbox_empty_geometry_none():
    assert largest_polygon_bbox({}) is None
    assert largest_polygon_bbox({"type": "Polygon", "coordinates": []}) is None
    assert largest_polygon_bbox(None) is None
```

**Step 2 — 失敗を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k largest_polygon_bbox
```

Expected: FAIL — `NotImplementedError`（3 テスト失敗）。

**Step 3 — largest_polygon_bbox を本実装に差し替え**

Edit `scripts/lib/ne_prep.py`、スタブ:

```python
def largest_polygon_bbox(geometry):
    raise NotImplementedError
```

を以下に置換:

```python
def _ring_bbox(ring):
    xs = [c[0] for c in ring]
    ys = [c[1] for c in ring]
    return [min(xs), min(ys), max(xs), max(ys)]


def largest_polygon_bbox(geometry):
    """Polygon / MultiPolygon から最大面積ポリゴン（outer ring）の bbox [w,s,e,n]。
    面積は bbox 近似（gen_country_centroids.py 同型）。MultiPolygon で本土を選ぶ
    ことで太平洋跨ぎ（lonSpan>180 の偽 bbox）を回避する。空は None。"""
    if not geometry:
        return None
    gtype = geometry.get("type")
    coords = geometry.get("coordinates") or []
    if gtype == "Polygon":
        polys = [coords]
    elif gtype == "MultiPolygon":
        polys = coords
    else:
        return None
    best, best_area = None, -1.0
    for poly in polys:
        if not poly or not poly[0]:
            continue
        bbox = _ring_bbox(poly[0])  # outer ring
        area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])
        if area > best_area:
            best_area = area
            best = bbox
    return best
```

**Step 4 — 成功を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k largest_polygon_bbox
```

Expected: PASS — `3 passed`。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/lib/ne_prep.py tests/test_ne_prep.py && git commit -m "ne_prep.largest_polygon_bbox（MultiPolygon最大面積・太平洋跨ぎ回避）を実装"
```

---

### Task C3.6: ne_prep.simplify_ring を TDD で実装（Douglas-Peucker 風間引き）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/test_ne_prep.py`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/lib/ne_prep.py`

**Interfaces:**
- Produces: `scripts/lib/ne_prep.py::simplify_ring(ring: list, eps: float) -> list`
- Consumes: なし

仕様（spec §3 頂点間引き / §8 解像度 nest 安全網）: 閉リング（先頭=末尾）を Douglas-Peucker で eps（度）以下の偏差点を間引く。端点（先頭・末尾）は保持。3 点以下のリングはそのまま返す。eps<=0 は無間引き（入力のコピー）。閉じている入力は閉じたまま返す（先頭=末尾を維持）。spec の「過度に間引かない（隙間を増やさない）」方針に従い eps≈0.01 度を build 側で使う。

**Step 1 — 失敗テストを追記**

Edit `tests/test_ne_prep.py`、末尾に追記:

```python
def test_simplify_ring_removes_collinear_midpoints():
    # 直線上の中間点は eps で消える（端点 A,E は残る）。閉リング。
    ring = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 0]]
    out = simplify_ring(ring, 0.01)
    # 直線 (0,0)->(3,0) 上の (1,0),(2,0) は除去され (3,3) は角として残る。
    assert out[0] == [0, 0]
    assert out[-1] == [0, 0]
    assert [3, 3] in out
    assert [1, 0] not in out and [2, 0] not in out


def test_simplify_ring_keeps_significant_vertex():
    # 偏差が eps より大きい点は残す。
    ring = [[0, 0], [1, 1], [2, 0], [0, 0]]
    out = simplify_ring(ring, 0.01)
    assert [1, 1] in out


def test_simplify_ring_short_ring_unchanged():
    ring = [[0, 0], [1, 1], [0, 0]]
    assert simplify_ring(ring, 0.5) == ring
    # eps<=0 は無間引き（コピー）。
    full = [[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 0]]
    out = simplify_ring(full, 0)
    assert out == full and out is not full
```

**Step 2 — 失敗を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q -k simplify_ring
```

Expected: FAIL — `NotImplementedError`（3 テスト失敗）。

**Step 3 — simplify_ring を本実装に差し替え**

Edit `scripts/lib/ne_prep.py`、スタブ:

```python
def simplify_ring(ring, eps):
    raise NotImplementedError
```

を以下に置換:

```python
def _perp_dist(p, a, b):
    """点 p から線分 a-b への垂直距離（度・平面近似）。"""
    ax, ay = a[0], a[1]
    bx, by = b[0], b[1]
    px, py = p[0], p[1]
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    if seg2 == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / seg2
    t = max(0.0, min(1.0, t))
    cx, cy = ax + t * dx, ay + t * dy
    return math.hypot(px - cx, py - cy)


def _dp(points, eps):
    if len(points) <= 2:
        return points[:]
    a, b = points[0], points[-1]
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        d = _perp_dist(points[i], a, b)
        if d > dmax:
            idx, dmax = i, d
    if dmax > eps:
        left = _dp(points[: idx + 1], eps)
        right = _dp(points[idx:], eps)
        return left[:-1] + right
    return [a, b]


def simplify_ring(ring, eps):
    """閉リングを Douglas-Peucker 風に間引く。端点保持・3点以下/eps<=0 は無間引き。
    spec の隙間抑制方針により eps≈0.01 度を build 側で使う。"""
    if eps is None or eps <= 0 or len(ring) <= 3:
        return ring[:]
    closed = len(ring) >= 2 and ring[0] == ring[-1]
    pts = ring[:-1] if closed else ring[:]
    if len(pts) <= 2:
        return ring[:]
    out = _dp(pts, eps)
    if closed:
        out = out + [out[0]]
    return out
```

**Step 4 — 成功を確認（ここで ne_prep 全テストが揃うので全体実行）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py -q
```

Expected: PASS — `24 passed`（resolve_fips 5 ＋ pick_name_ja 5 ＋ split_by_country 1 ＋ nearest_city_cap 2 ＋ largest_polygon_bbox 3 ＋ simplify_ring 3 ＝ 計 19。`assert` 件数差は test 関数数で判断＝**全 17 テスト関数 pass**・1 fail も 0 であること）。

**Step 5 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add scripts/lib/ne_prep.py tests/test_ne_prep.py && git commit -m "ne_prep.simplify_ring（Douglas-Peucker風間引き）を実装し純粋部を完成"
```

---

### Task C3.7: build_country_bounds.py（NE 50m から country_bounds.geojson 再生成・確定事項6）

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/build_country_bounds.py`
- Modify (生成物): `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/data/static/country_bounds.geojson`
- Modify (生成物): `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/country_centroids.js`（gen_country_centroids 再実行で更新）

**Interfaces:**
- Consumes: `scripts/lib/ne_prep.py::resolve_fips, simplify_ring` / `scripts/lib/fips_of_iso.py::FIPS_OF_ISO` / `js/lib/places.js::FIPS_JA` / 既存 `data/static/country_bounds.geojson`（name 突合インデックスの権威）
- Produces: `data/static/country_bounds.geojson`（50m・schema `{code(FIPS), name}` 厳守・全 FIPS_JA 保存 assert）

これは I/O スクリプトのため pytest ではなく **実行コマンドと Expected（FIPS assert 緑・サイズ・カバレッジ実測）** で検証する。入力 NE 50m GeoJSON（`ne_50m_admin_0_countries.geojson`）は repo に無いので **ローカルで手調達**し `scripts/.cache/ne/ne_50m_admin_0_countries.geojson` に置く（コミット対象外＝生成物の country_bounds.geojson のみコミット・gen_country_centroids と同じ運用）。`scripts/.cache/` は `.gitignore` に追加する。

設計の要点（spec §確定事項6 / §5 build_country_bounds）:
- スキーマは現状 `{code(FIPS), name}` を厳守（name は **既存 country_bounds の英名を保つ** ＝ resolve_fips で FIPS を決め、その FIPS の既存 name を引いて再利用。consumer の name 突合互換のため）。
- `resolve_fips` の name 突合インデックスは **再生成前の既存 country_bounds**（権威）から作る。
- `simplify_ring(eps=0.01)` で過度間引きを避ける。
- **FIPS_JA 全キー保存 assert**（gen_country_centroids.py:83-87 同型）。EXTRA68（ポリゴン無し小国）は country_bounds には元々無いので、assert 対象は「既存 country_bounds に存在した FIPS が再生成後も全て残ること」＝既存 171 コード集合の保存を assert（FIPS_JA 全体ではなく既存集合との一致＝EXTRA68 を誤って必須化しない）。
- 再生成後 `gen_country_centroids.py` を再実行し centroid/EXTRA を更新。

**Step 1 — `.gitignore` に `scripts/.cache/` を追加**

Edit `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/.gitignore`、`node_modules/` 行の後に追記:

```
scripts/.cache/
```

**Step 2 — build_country_bounds.py を作成**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/build_country_bounds.py`:

```python
#!/usr/bin/env python3
"""NE 50m admin0 から data/static/country_bounds.geojson を再生成する（確定事項6）。

- スキーマ {code(FIPS), name} を厳守（name は既存 country_bounds の英名を保持）。
- resolve_fips（ne_prep）で ISO→FIPS＋既存 name 突合の二重チェック。
- simplify_ring(eps=0.01) で過度間引きを避ける（隙間抑制）。
- 既存 country_bounds の FIPS 集合が再生成後も全て残ることを assert（build 失敗化）。

入力 NE 50m GeoJSON は scripts/.cache/ne/ne_50m_admin_0_countries.geojson に
ローカルで手調達して置く（gen_country_centroids と同じ運用・生成物のみコミット）。
実行: PYTHONPATH=. uv run python scripts/build_country_bounds.py
"""
import json
import os
import re

from scripts.lib.ne_prep import resolve_fips, simplify_ring

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE_50M = os.path.join(ROOT, "scripts/.cache/ne/ne_50m_admin_0_countries.geojson")
OUT = os.path.join(ROOT, "data/static/country_bounds.geojson")
EPS = 0.01


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def load_existing_bounds():
    gj = json.load(open(OUT, encoding="utf-8"))
    name_index = {f["properties"]["name"]: f["properties"]["code"] for f in gj["features"]}
    fips_to_name = {f["properties"]["code"]: f["properties"]["name"] for f in gj["features"]}
    existing_codes = set(fips_to_name)
    return name_index, fips_to_name, existing_codes


def simplify_geometry(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(r, EPS) for r in coords]}
    if gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[simplify_ring(r, EPS) for r in poly] for poly in coords]}
    return geom


def main():
    fips_ja = load_fips_ja()
    name_index, fips_to_name, existing_codes = load_existing_bounds()
    ne = json.load(open(NE_50M, encoding="utf-8"))

    out_features, seen, unresolved = [], {}, []
    for f in ne.get("features", []):
        props = f.get("properties") or {}
        code = resolve_fips(props, name_index)
        if not code:
            unresolved.append(props.get("ADMIN") or props.get("admin") or props.get("name"))
            continue
        if code in seen:
            continue  # 同一 FIPS の重複は最初だけ（NE の分割表現対策）
        seen[code] = True
        name = fips_to_name.get(code) or props.get("ADMIN") or props.get("admin") or code
        out_features.append({
            "type": "Feature",
            "properties": {"code": code, "name": name},
            "geometry": simplify_geometry(f.get("geometry") or {}),
        })

    out_codes = {f["properties"]["code"] for f in out_features}
    missing = sorted(existing_codes - out_codes)
    assert not missing, f"既存 country_bounds の FIPS が再生成で欠落: {missing} / 未解決NE: {unresolved}"
    # 参考表示（FIPS_JA との差は EXTRA68 を含むので assert しない）。
    print(f"resolved {len(out_features)} features / "
          f"FIPS_JA 未カバー（EXTRA含む）= {len(set(fips_ja) - out_codes)}")
    if unresolved:
        print(f"WARN 未解決 {len(unresolved)} 件: {unresolved[:10]}")

    fc = {"type": "FeatureCollection", "features": out_features}
    json.dump(fc, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    main()
```

**Step 3 — 入力 NE 50m を配置（手調達・前提確認）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && mkdir -p scripts/.cache/ne && ls -la scripts/.cache/ne/ne_50m_admin_0_countries.geojson 2>/dev/null || echo "NE 50m GeoJSON を scripts/.cache/ne/ne_50m_admin_0_countries.geojson に配置してください（Natural Earth 1:50m Cultural admin_0_countries を GeoJSON 化）"
```

Expected: NE 50m GeoJSON が配置済みであること（無ければ手調達して再実行）。

**Step 4 — 再生成を実行し FIPS 保存 assert・サイズを実測**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run python scripts/build_country_bounds.py
```

Expected: PASS — assert が通り（既存 FIPS 欠落ゼロ）、`wrote .../country_bounds.geojson (NNNNNN bytes)` を出力。bytes は推定 1-2MB 帯（50m 化・spec §0）。`AssertionError: 既存 country_bounds の FIPS が再生成で欠落` が出ないこと。

**Step 5 — 回帰確認（geo_country.py データ変更後も既知点が正しい FIPS に解決）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_geo_country.py -q && PYTHONPATH=. uv run python scripts/gen_country_centroids.py
```

Expected: PASS — `test_geo_country.py` が `2 passed`（東京=JA/パリ=FR/カイロ=EG/アンカレッジ=US・太平洋=None が 50m データでも維持）、続いて `gen_country_centroids.py` が `wrote NNN centroids`（FIPS_JA 過不足 assert 緑＝centroid/EXTRA 更新成功）。

**Step 6 — commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add .gitignore scripts/build_country_bounds.py data/static/country_bounds.geojson js/lib/country_centroids.js && git commit -m "country_bounds.geojson を NE 50m から再生成（確定事項6・FIPS全保存assert・centroid更新）"
```

---

### Task C3.8: build_admin1.py（NE admin1 を国別 split＋name:ja＋gzip 出力）

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/build_admin1.py`
- Create (生成物): `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/data/static/admin1/<FIPS>.geojson.gz`（複数）
- Create (生成物): `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/data/static/admin1_bbox.json`

**Interfaces:**
- Consumes: `scripts/lib/ne_prep.py::resolve_fips, pick_name_ja, split_by_country, largest_polygon_bbox, simplify_ring` / 既存 `data/static/country_bounds.geojson`（name 突合インデックス）/ name:ja キャッシュ（`scripts/.cache/name_ja_wikidata.json` / `scripts/.cache/name_ja_geonames.json`）
- Produces: `data/static/admin1/<FIPS>.geojson.gz`（properties=`{a1code,name_en,name_ja,bbox}`）/ `data/static/admin1_bbox.json`（`{fips:{countryBbox:[w,s,e,n], admin1:{a1code:[w,s,e,n]}}}`）

I/O スクリプト＝pytest 対象外。入力 NE 10m admin1 は `scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson`（手調達）。name:ja キャッシュは無ければ空 dict（英名フォールバック）で動く。EXTRA68 国は admin1 が無いので **空 FeatureCollection を出力**（spec §3・404 回避）。

**Step 1 — build_admin1.py を作成**

Write `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/scripts/build_admin1.py`:

```python
#!/usr/bin/env python3
"""NE 10m admin1 を国別 split＋name:ja 付与＋頂点間引き＋gzip 出力。

出力:
  data/static/admin1/<FIPS>.geojson.gz  properties={a1code,name_en,name_ja,bbox}
  data/static/admin1_bbox.json          {fips:{countryBbox, admin1:{a1code:bbox}}}
EXTRA68（admin1 無し）国は空 FeatureCollection を明示出力（404 回避）。

入力 NE 10m admin1 は scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson に
手調達。name:ja キャッシュ（scripts/.cache/name_ja_*.json）は無ければ空 dict。
実行: PYTHONPATH=. uv run python scripts/build_admin1.py
"""
import gzip
import json
import os
import re

from scripts.lib.ne_prep import (
    resolve_fips, pick_name_ja, split_by_country, largest_polygon_bbox, simplify_ring,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NE_ADMIN1 = os.path.join(ROOT, "scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson")
OUT_DIR = os.path.join(ROOT, "data/static/admin1")
BBOX_OUT = os.path.join(ROOT, "data/static/admin1_bbox.json")
EPS = 0.01


def load_fips_ja():
    src = open(os.path.join(ROOT, "js/lib/places.js"), encoding="utf-8").read()
    body = re.search(r"export const FIPS_JA = \{(.*?)\};", src, re.S).group(1)
    return dict(re.findall(r"([A-Z]{2}):\s*'([^']+)'", body))


def load_name_index():
    gj = json.load(open(os.path.join(ROOT, "data/static/country_bounds.geojson"), encoding="utf-8"))
    return {f["properties"]["name"]: f["properties"]["code"] for f in gj["features"]}


def load_cache(name):
    p = os.path.join(ROOT, "scripts/.cache", name)
    try:
        return json.load(open(p, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def simplify_geometry(geom):
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return {"type": "Polygon", "coordinates": [simplify_ring(r, EPS) for r in coords]}
    if gtype == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[simplify_ring(r, EPS) for r in poly] for poly in coords]}
    return geom


def a1code_of(props):
    for k in ("iso_3166_2", "code_hasc", "adm1_code", "fips"):
        v = props.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def main():
    fips_ja = load_fips_ja()
    name_index = load_name_index()
    wiki = load_cache("name_ja_wikidata.json")
    geo = load_cache("name_ja_geonames.json")
    ne = json.load(open(NE_ADMIN1, encoding="utf-8"))

    groups = split_by_country(ne.get("features", []), lambda f: resolve_fips(f.get("properties") or {}, name_index))
    os.makedirs(OUT_DIR, exist_ok=True)
    bbox_index = {}

    for fips, feats in groups.items():
        out_feats, a1_bboxes = [], {}
        all_x, all_y = [], []
        for f in feats:
            props = f.get("properties") or {}
            geom = simplify_geometry(f.get("geometry") or {})
            bbox = largest_polygon_bbox(geom)
            if bbox is None:
                continue
            a1 = a1code_of(props) or f"{fips}-{len(out_feats)}"
            name_en = props.get("name") or props.get("NAME") or a1
            name_ja = pick_name_ja(props, wiki, geo)
            out_feats.append({
                "type": "Feature",
                "properties": {"a1code": a1, "name_en": name_en, "name_ja": name_ja, "bbox": bbox},
                "geometry": geom,
            })
            a1_bboxes[a1] = bbox
            all_x += [bbox[0], bbox[2]]
            all_y += [bbox[1], bbox[3]]
        fc = {"type": "FeatureCollection", "features": out_feats}
        path = os.path.join(OUT_DIR, f"{fips}.geojson.gz")
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))
        if all_x:
            bbox_index[fips] = {"countryBbox": [min(all_x), min(all_y), max(all_x), max(all_y)],
                                "admin1": a1_bboxes}

    # EXTRA68（admin1 無し国）は空 FC を出力（404 回避）。
    for fips in fips_ja:
        path = os.path.join(OUT_DIR, f"{fips}.geojson.gz")
        if not os.path.exists(path):
            with gzip.open(path, "wt", encoding="utf-8") as fh:
                json.dump({"type": "FeatureCollection", "features": []}, fh, ensure_ascii=False)

    json.dump(bbox_index, open(BBOX_OUT, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"wrote {len(groups)} country admin1 files + {len(fips_ja)-len(groups)} empty / bbox_index {len(bbox_index)}")


if __name__ == "__main__":
    main()
```

**Step 2 — 入力 NE admin1 の配置を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && ls -la scripts/.cache/ne/ne_10m_admin_1_states_provinces.geojson 2>/dev/null || echo "NE 10m admin1 GeoJSON を scripts/.cache/ne/ に配置してください"
```

Expected: NE 10m admin1 GeoJSON が配置済み。

**Step 3 — 実行し代表国でサイズと FIPS カバレッジを実測**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run python scripts/build_admin1.py && echo "=== 代表国サイズ ===" && ls -la data/static/admin1/US.geojson.gz data/static/admin1/JA.geojson.gz data/static/admin1/UP.geojson.gz && echo "=== EXTRA68 空FC確認（AAは空）===" && python3 -c "import gzip,json; print('AA features=', len(json.load(gzip.open('data/static/admin1/AA.geojson.gz','rt'))['features']))" && echo "=== 総数 ===" && ls data/static/admin1/*.geojson.gz | wc -l

---

## クラスタ C4 — admin1集計コア (js/lib/drilldown/aggregate_admin1.js)

### Task C4-1: collectCountryEvents — 全層から当該FIPSポリゴン内の点を抽出（純粋・PIP）

スナップショット各層（quakes/conflict/protests=`snapshot.points`、news=`snapshot.items`）から、当該 FIPS の国ポリゴン内に落ちる点だけを bbox 早期棄却＋even-odd ray-casting で抽出する純関数を実装する。`countryPolys` は `loadPolygons` 正規化済の配列で、その中から `code===fips` のポリゴンを選び、`pointInFeature(lon,lat,poly)` で厳密判定する（news の隣国混入を弾く・quakes は place 文字列に依存せず lon/lat で判定）。各イベントは `{layerId, lon, lat, title, raw}` に正規化する。

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js`

**Interfaces:**
- Consumes: `pointInFeature(lon, lat, poly) -> boolean`（`js/lib/drilldown/geo_poly.js`）／`loadPolygons` 正規化形 `{code, name, name_ja, bbox, rings}`
- Produces: `collectCountryEvents(snapshots, fips, countryPolys, {marginDeg=0.5}={}) -> [{layerId, lon, lat, title, raw}]`

入力点の実フィールド（実コード検証済）:
- quakes: `snapshots.quakes.points`、点 `{id, time, mag, place, lon, lat}`、title は `M{mag} {place}`
- conflict: `snapshots.conflict.points`、点 `{lon, lat, mentions, root, place, url, date, id}`、title は `place`
- protests: `snapshots.protests.points`、点 `{lon, lat, mentions, root, place, url, date, id}`、title は `place`
- news: `snapshots.news.items`、点 `{id, time, lon, lat, title_ja, category, place, url}`、title は `title_ja`

- [ ] **Step 1: 失敗テストを書く（collectCountryEvents）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js` を新規作成し、以下を記述する。

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCountryEvents,
  assignAdmin1,
  aggregateByAdmin1,
  attachNearestCity,
  buildDrilldown,
} from '../js/lib/drilldown/aggregate_admin1.js';

// loadPolygons 正規化形を手書きで用意（geo_poly.js に依存せず固定フィクスチャ）。
// JP: 経度 130..142 / 緯度 30..46 の単純な四角（時計回りでも反時計回りでも even-odd は不変）。
const JP_RING = [
  [130, 30], [142, 30], [142, 46], [130, 46], [130, 30],
];
const countryPolys = [
  { code: 'JA', name: 'Japan', name_ja: '日本', bbox: [130, 30, 142, 46], rings: [JP_RING] },
  // 隣国 KS（韓国相当の別四角・経度 125..130）— news の隣国混入テスト用。
  { code: 'KS', name: 'South Korea', name_ja: '韓国', bbox: [124, 33, 129.99, 39], rings: [[[124, 33], [129.99, 33], [129.99, 39], [124, 39], [124, 33]]] },
];

const snapshots = {
  quakes: { points: [
    { id: 'q1', time: 1, mag: 5.2, place: 'near Tokyo', lon: 139.7, lat: 35.7 },
    { id: 'q2', time: 2, mag: 4.0, place: 'somewhere', lon: 0, lat: 0 }, // 国外
  ] },
  conflict: { points: [
    { id: 'c1', lon: 135.5, lat: 34.7, mentions: 12, root: '18', place: 'JA', url: 'https://x.jp/a', date: '20260620120000' },
  ] },
  protests: { points: [
    { id: 'p1', lon: 139.0, lat: 35.0, mentions: 4, root: '14', place: 'JA', url: 'https://y.jp/b', date: '20260620120000' },
  ] },
  news: { items: [
    { id: 'n1', time: 3, lon: 139.7, lat: 35.6, title_ja: '東京で会議', category: 'politics', place: 'JA', url: 'https://z.jp/c' },
    { id: 'n2', time: 4, lon: 127.0, lat: 37.5, title_ja: 'ソウルの報道', category: 'politics', place: 'JA', url: 'https://z.kr/d' }, // 座標は韓国内=JP厳密判定で除外
  ] },
};

test('collectCountryEvents: 当該FIPS(JA)内の点のみ抽出・各層 layerId/title/raw 付与', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const ids = events.map((e) => e.raw.id).sort();
  // q1(国内) c1 p1 n1(国内) のみ。q2(国外0,0)・n2(韓国座標) は除外。
  assert.deepEqual(ids, ['c1', 'n1', 'p1', 'q1']);
});

test('collectCountryEvents: layerId と title が層ごとに正しい', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const byId = Object.fromEntries(events.map((e) => [e.raw.id, e]));
  assert.equal(byId.q1.layerId, 'quakes');
  assert.equal(byId.q1.title, 'M5.2 near Tokyo');
  assert.equal(byId.c1.layerId, 'conflict');
  assert.equal(byId.c1.title, 'JA');
  assert.equal(byId.p1.layerId, 'protests');
  assert.equal(byId.p1.title, 'JA');
  assert.equal(byId.n1.layerId, 'news');
  assert.equal(byId.n1.title, '東京で会議');
});

test('collectCountryEvents: lon/lat は元の点の座標を保持', () => {
  const events = collectCountryEvents(snapshots, 'JA', countryPolys);
  const q1 = events.find((e) => e.raw.id === 'q1');
  assert.equal(q1.lon, 139.7);
  assert.equal(q1.lat, 35.7);
});

test('collectCountryEvents: 該当FIPSポリゴンが無ければ空配列', () => {
  assert.deepEqual(collectCountryEvents(snapshots, 'ZZ', countryPolys), []);
});

test('collectCountryEvents: snapshots/各層が欠落・空でも落ちず空配列', () => {
  assert.deepEqual(collectCountryEvents(null, 'JA', countryPolys), []);
  assert.deepEqual(collectCountryEvents({}, 'JA', countryPolys), []);
  assert.deepEqual(collectCountryEvents({ quakes: {}, news: {} }, 'JA', countryPolys), []);
});

test('collectCountryEvents: 緯度経度が数値でない点はスキップ', () => {
  const bad = { quakes: { points: [{ id: 'b', mag: 3, place: 'x', lon: null, lat: undefined }] } };
  assert.deepEqual(collectCountryEvents(bad, 'JA', countryPolys), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: FAIL（`Cannot find module '../js/lib/drilldown/aggregate_admin1.js'` または `collectCountryEvents is not a function`。aggregate_admin1.js 未作成のため import 解決に失敗する）

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js` を新規作成し、以下を記述する。

```javascript
// 国ドリルダウンの admin1 集計コア（純粋・deck/DOM/fetch/map 非依存）。
// 全層の点群を当該FIPS国ポリゴンで PIP 抽出→admin1 割当→件数集計し、
// drilldown_view が描画する model を返す。aggregate.js の Map グループ化と
// 代表点選定イディオムを流用する（直接再利用ではなく admin1 粒度で再実装）。
import { pointInFeature, locateFeature } from './geo_poly.js';
import { nearestCity } from './nearest.js';

// 有限数値か。
function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// 各層を {snapshotKey, listKey, layerId, titleOf} で記述。
// quakes/conflict/protests は snapshot.points、news は snapshot.items。
const LAYERS = [
  { snapshotKey: 'quakes', listKey: 'points', layerId: 'quakes', titleOf: (p) => `M${p.mag} ${p.place == null ? '' : p.place}` },
  { snapshotKey: 'conflict', listKey: 'points', layerId: 'conflict', titleOf: (p) => (p.place == null ? '' : String(p.place)) },
  { snapshotKey: 'protests', listKey: 'points', layerId: 'protests', titleOf: (p) => (p.place == null ? '' : String(p.place)) },
  { snapshotKey: 'news', listKey: 'items', layerId: 'news', titleOf: (p) => (p.title_ja == null ? '' : String(p.title_ja)) },
];

export function collectCountryEvents(snapshots, fips, countryPolys, { marginDeg = 0.5 } = {}) {
  const out = [];
  if (!snapshots || typeof snapshots !== 'object') return out;
  const polys = Array.isArray(countryPolys) ? countryPolys : [];
  const country = polys.find((p) => p && p.code === fips);
  if (!country) return out;
  for (const spec of LAYERS) {
    const snap = snapshots[spec.snapshotKey];
    const list = (snap && Array.isArray(snap[spec.listKey])) ? snap[spec.listKey] : [];
    for (const p of list) {
      const lon = Number(p.lon);
      const lat = Number(p.lat);
      if (!isNum(lon) || !isNum(lat)) continue;
      if (!pointInFeature(lon, lat, country)) continue;
      out.push({ layerId: spec.layerId, lon, lat, title: spec.titleOf(p), raw: p });
    }
  }
  return out;
}
```

注: `marginDeg` は API 契約として受けるが本関数では国ポリゴン厳密判定（pointInFeature が bbox 早期棄却を内包）に用いるためマージン拡張は行わない（隣国混入を弾く要件を優先）。`locateFeature`/`nearestCity` は後続 Step で使用するため import 済。

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: PASS（collectCountryEvents の6テストが緑。`assignAdmin1`/`aggregateByAdmin1`/`attachNearestCity`/`buildDrilldown` はまだ未実装だが、この Step ではそれらのテストはまだ追記していないため当該6件が pass）

- [ ] **Step 5: commit する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/aggregate_admin1.js tests/drilldown_aggregate.test.js
```

commit メッセージ: `feat(drilldown): collectCountryEvents で全層から当該FIPS国内の点をPIP抽出`

---

### Task C4-2: assignAdmin1 — 各イベントに a1code 付与（国外/未割当→null=その他バケット）

`collectCountryEvents` の出力に対し、`admin1Polys`（`loadPolygons` 正規化形・`code` が a1code）に `locateFeature(lon,lat)` を当てて各イベントに `a1code` を付ける。ヒットしなければ `a1code: null`（後段で「その他/不明」県バケットに集約＝点を捨てない安全網）。元イベントは破壊せず spread でコピーする。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js`

**Interfaces:**
- Consumes: `locateFeature(lon, lat, polys) -> poly|null`（`js/lib/drilldown/geo_poly.js`）
- Produces: `assignAdmin1(events, admin1Polys) -> [{...event, a1code:string|null}]`

- [ ] **Step 1: 失敗テストを書く（assignAdmin1）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js` の末尾に追記する。

```javascript
// admin1 フィクスチャ: JP-13(東京周辺・経度138..141/緯度34..37) と JP-27(関西・経度134..137/緯度33..36)。
const admin1Polys = [
  { code: 'JP-13', name: 'Tokyo', name_ja: '東京都', bbox: [138, 34, 141, 37], rings: [[[138, 34], [141, 34], [141, 37], [138, 37], [138, 34]]] },
  { code: 'JP-27', name: 'Osaka', name_ja: '大阪府', bbox: [134, 33, 137, 36], rings: [[[134, 33], [137, 33], [137, 36], [134, 36], [134, 33]]] },
];

test('assignAdmin1: admin1内の点に a1code 付与・外れは null', () => {
  const events = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }, // JP-13内
    { layerId: 'conflict', lon: 135.5, lat: 34.7, title: 'B', raw: { id: 'e2' } }, // JP-27内
    { layerId: 'quakes', lon: 142.5, lat: 40.0, title: 'C', raw: { id: 'e3' } }, // どちらの admin1 にも入らない
  ];
  const out = assignAdmin1(events, admin1Polys);
  assert.equal(out[0].a1code, 'JP-13');
  assert.equal(out[1].a1code, 'JP-27');
  assert.equal(out[2].a1code, null);
});

test('assignAdmin1: 元イベントを破壊せずコピーを返す', () => {
  const events = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }];
  const out = assignAdmin1(events, admin1Polys);
  assert.notEqual(out[0], events[0]);
  assert.equal(events[0].a1code, undefined);
  assert.equal(out[0].layerId, 'news');
});

test('assignAdmin1: admin1Polys 空なら全 null', () => {
  const events = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: 'e1' } }];
  const out = assignAdmin1(events, []);
  assert.equal(out[0].a1code, null);
});

test('assignAdmin1: 空イベントは空配列', () => {
  assert.deepEqual(assignAdmin1([], admin1Polys), []);
  assert.deepEqual(assignAdmin1(null, admin1Polys), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: FAIL（`assignAdmin1` が `[{...event, a1code}]` を返さず undefined を参照する／関数本体未実装のため assignAdmin1 の4テストが失敗。`TypeError` もしくは assertion failure）

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js` の `collectCountryEvents` 関数の直後に追記する。

```javascript
export function assignAdmin1(events, admin1Polys) {
  const evs = Array.isArray(events) ? events : [];
  const polys = Array.isArray(admin1Polys) ? admin1Polys : [];
  return evs.map((e) => {
    const hit = locateFeature(e.lon, e.lat, polys);
    return { ...e, a1code: hit ? hit.code : null };
  });
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: PASS（collectCountryEvents 6 ＋ assignAdmin1 4 = 計10テストが緑）

- [ ] **Step 5: commit する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/aggregate_admin1.js tests/drilldown_aggregate.test.js
```

commit メッセージ: `feat(drilldown): assignAdmin1 でイベントに a1code 付与・未割当は null(その他)`

---

### Task C4-3: aggregateByAdmin1 — 県別グループ化・count降順・byLayer内訳・topEvents代表

`assignAdmin1` 済イベントを a1code でグループ化し（`null`→`'__OTHER__'` キーで「その他/不明」バケット）、各県の `{a1code, name_ja, count, byLayer, topEvents, lon, lat}` を返す。`aggregateByCountry`（`js/lib/aggregate.js`）の Map グループ化と代表点・重心算出イディオムを流用する。並びは count 降順、同数は name_ja の昇順（localeCompare）で安定ソート。`name_ja` は同一 a1code の最初のイベントの `raw` から引けないため、admin1 の name_ja は呼び出し側（buildDrilldown）が a1code→name_ja マップで解決して付与する設計とし、本関数は a1code をキーとした集計に専念。a1code から name_ja を引くため第2引数 `a1NameMap`（`{a1code: name_ja}`）を受ける。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js`

**Interfaces:**
- Consumes: なし（純集計）
- Produces: `aggregateByAdmin1(eventsWithA1, a1NameMap={}) -> [{a1code, name_ja, count, byLayer:{layerId:n}, topEvents:[...], lon, lat}]`

注: 正準シグネチャは `aggregateByAdmin1(eventsWithA1)` だが、name_ja 解決のため任意第2引数 `a1NameMap`（既定 `{}`）を後置追加する（既定値ありで1引数呼び出しも互換）。

- [ ] **Step 1: 失敗テストを書く（aggregateByAdmin1）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js` の末尾に追記する。

```javascript
const a1NameMap = { 'JP-13': '東京都', 'JP-27': '大阪府' };

test('aggregateByAdmin1: a1code でグループ化・count降順', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'protests', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
    { layerId: 'quakes', lon: 135.5, lat: 34.7, title: 'D', raw: { id: '4' }, a1code: 'JP-27' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].a1code, 'JP-13'); // 3件で先頭
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].name_ja, '東京都');
  assert.equal(rows[1].a1code, 'JP-27');
  assert.equal(rows[1].count, 1);
});

test('aggregateByAdmin1: byLayer 内訳を集計', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'news', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.deepEqual(rows[0].byLayer, { news: 2, conflict: 1 });
});

test('aggregateByAdmin1: topEvents は各県の代表（最大3・件数順入力順）', () => {
  const evs = [
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'conflict', lon: 139.8, lat: 35.7, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
    { layerId: 'protests', lon: 139.9, lat: 35.5, title: 'C', raw: { id: '3' }, a1code: 'JP-13' },
    { layerId: 'quakes', lon: 139.6, lat: 35.4, title: 'D', raw: { id: '4' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].topEvents.length, 3);
  assert.equal(rows[0].topEvents[0].title, 'A');
});

test('aggregateByAdmin1: lon/lat は県内イベントの重心', () => {
  const evs = [
    { layerId: 'news', lon: 139.0, lat: 35.0, title: 'A', raw: { id: '1' }, a1code: 'JP-13' },
    { layerId: 'news', lon: 141.0, lat: 37.0, title: 'B', raw: { id: '2' }, a1code: 'JP-13' },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].lon, 140.0);
  assert.equal(rows[0].lat, 36.0);
});

test('aggregateByAdmin1: a1code=null は「その他/不明」バケット', () => {
  const evs = [
    { layerId: 'news', lon: 145, lat: 40, title: 'X', raw: { id: '9' }, a1code: null },
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].a1code, null);
  assert.equal(rows[0].name_ja, 'その他/不明');
  assert.equal(rows[0].count, 1);
});

test('aggregateByAdmin1: 同数 count は name_ja 昇順で安定', () => {
  const evs = [
    { layerId: 'news', lon: 135.5, lat: 34.7, title: 'B', raw: { id: '1' }, a1code: 'JP-27' }, // 大阪府
    { layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '2' }, a1code: 'JP-13' }, // 東京都
  ];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  // 同数1件ずつ→ name_ja 昇順（「大阪府」<「東京都」）
  assert.equal(rows[0].name_ja, '大阪府');
  assert.equal(rows[1].name_ja, '東京都');
});

test('aggregateByAdmin1: name_ja 未知 a1code はコードをフォールバック表示', () => {
  const evs = [{ layerId: 'news', lon: 139.7, lat: 35.6, title: 'A', raw: { id: '1' }, a1code: 'JP-99' }];
  const rows = aggregateByAdmin1(evs, a1NameMap);
  assert.equal(rows[0].name_ja, 'JP-99');
});

test('aggregateByAdmin1: 空入力は空配列', () => {
  assert.deepEqual(aggregateByAdmin1([], a1NameMap), []);
  assert.deepEqual(aggregateByAdmin1(null), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: FAIL（`aggregateByAdmin1 is not a function` で aggregateByAdmin1 の8テストが失敗）

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js` の `assignAdmin1` 関数の直後に追記する。

```javascript
const OTHER_KEY = '__OTHER__';
const OTHER_NAME = 'その他/不明';

export function aggregateByAdmin1(eventsWithA1, a1NameMap = {}) {
  const evs = Array.isArray(eventsWithA1) ? eventsWithA1 : [];
  const nameMap = (a1NameMap && typeof a1NameMap === 'object') ? a1NameMap : {};
  // a1code（null は OTHER_KEY）でグループ化（aggregate.js の Map グループ化イディオム流用）。
  const byA1 = new Map();
  for (const e of evs) {
    const key = (e.a1code == null) ? OTHER_KEY : String(e.a1code);
    if (!byA1.has(key)) byA1.set(key, []);
    byA1.get(key).push(e);
  }
  const rows = [];
  for (const [key, group] of byA1) {
    const a1code = (key === OTHER_KEY) ? null : key;
    // name_ja: その他バケット→固定、既知→マップ、未知→コードフォールバック。
    let name_ja;
    if (a1code == null) name_ja = OTHER_NAME;
    else name_ja = nameMap[a1code] || a1code;
    // byLayer 内訳。
    const byLayer = {};
    for (const e of group) byLayer[e.layerId] = (byLayer[e.layerId] || 0) + 1;
    // 重心（県内イベントの単純平均）。
    let sx = 0;
    let sy = 0;
    for (const e of group) { sx += e.lon; sy += e.lat; }
    const lon = sx / group.length;
    const lat = sy / group.length;
    // topEvents: 入力順の先頭3を代表として保持（aggregate.js の代表点選定を簡素化流用）。
    const topEvents = group.slice(0, 3);
    rows.push({ a1code, name_ja, count: group.length, byLayer, topEvents, lon, lat });
  }
  // count 降順・同数は name_ja 昇順で安定ソート。その他バケットも name_ja で同列に扱う。
  rows.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return String(a.name_ja).localeCompare(String(b.name_ja), 'ja');
  });
  return rows;
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: PASS（collectCountryEvents 6 ＋ assignAdmin1 4 ＋ aggregateByAdmin1 8 = 計18テストが緑）

- [ ] **Step 5: commit する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/aggregate_admin1.js tests/drilldown_aggregate.test.js
```

commit メッセージ: `feat(drilldown): aggregateByAdmin1 で県別count降順集計・byLayer内訳・その他バケット`

---

### Task C4-4: attachNearestCity — 各イベントに最寄り都市名を付与

`collectCountryEvents`／`assignAdmin1` 段のイベント配列に対し、`nearestCity(lon, lat, cities, {maxDeg=1.5})` で最寄り都市を引き、`cityName`（都市の `name_ja`・無ければ `name`・閾値超/0件は `null`）を付ける。元イベントは破壊せず spread コピー。「カリフォルニア州 — ロサンゼルスで抗議」形式の都市名は drilldown_view（C5）が `cityName` から組む。本関数は cityName 解決のみ担う。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js`

**Interfaces:**
- Consumes: `nearestCity(lon, lat, cities, {maxDeg=1.5}={}) -> city|null  // city={name,name_ja,lon,lat,pop}`（`js/lib/drilldown/nearest.js`）
- Produces: `attachNearestCity(events, cities) -> [{...event, cityName:string|null}]`

- [ ] **Step 1: 失敗テストを書く（attachNearestCity）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js` の末尾に追記する。

```javascript
const cities = [
  { name: 'Tokyo', name_ja: '東京', lon: 139.69, lat: 35.69, pop: 9000000 },
  { name: 'Osaka', name_ja: '大阪', lon: 135.50, lat: 34.69, pop: 2700000 },
];

test('attachNearestCity: 最寄り都市の name_ja を cityName に付与', () => {
  const evs = [
    { layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } },
    { layerId: 'conflict', lon: 135.49, lat: 34.70, title: 'B', raw: { id: '2' } },
  ];
  const out = attachNearestCity(evs, cities);
  assert.equal(out[0].cityName, '東京');
  assert.equal(out[1].cityName, '大阪');
});

test('attachNearestCity: maxDeg 超(遠方)は cityName=null', () => {
  const evs = [{ layerId: 'news', lon: 100.0, lat: 10.0, title: 'X', raw: { id: '9' } }];
  const out = attachNearestCity(evs, cities);
  assert.equal(out[0].cityName, null);
});

test('attachNearestCity: cities 空は cityName=null', () => {
  const evs = [{ layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, []);
  assert.equal(out[0].cityName, null);
});

test('attachNearestCity: name_ja 欠落の都市は name をフォールバック', () => {
  const c2 = [{ name: 'Kyoto', lon: 135.77, lat: 35.01, pop: 1400000 }];
  const evs = [{ layerId: 'news', lon: 135.77, lat: 35.01, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, c2);
  assert.equal(out[0].cityName, 'Kyoto');
});

test('attachNearestCity: 元イベントを破壊しない・空入力は空配列', () => {
  const evs = [{ layerId: 'news', lon: 139.70, lat: 35.70, title: 'A', raw: { id: '1' } }];
  const out = attachNearestCity(evs, cities);
  assert.notEqual(out[0], evs[0]);
  assert.equal(evs[0].cityName, undefined);
  assert.deepEqual(attachNearestCity([], cities), []);
  assert.deepEqual(attachNearestCity(null, cities), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: FAIL（`attachNearestCity is not a function` で attachNearestCity の5テストが失敗）

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js` の `aggregateByAdmin1` 関数の直後に追記する。

```javascript
export function attachNearestCity(events, cities) {
  const evs = Array.isArray(events) ? events : [];
  const list = Array.isArray(cities) ? cities : [];
  return evs.map((e) => {
    const city = nearestCity(e.lon, e.lat, list);
    const cityName = city ? (city.name_ja || city.name || null) : null;
    return { ...e, cityName };
  });
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: PASS（計23テストが緑）

- [ ] **Step 5: commit する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/aggregate_admin1.js tests/drilldown_aggregate.test.js
```

commit メッセージ: `feat(drilldown): attachNearestCity で各イベントに最寄り都市名(cityName)を付与`

---

### Task C4-5: buildDrilldown — 全合成・instabilityヘッダ流用・MAX_POINTSデグレード・該当国なしでも落ちない

C4 の最終合成。`{fips, snapshots, countryPolys, admin1Polys, cities, instabilityCountry, forecastCards}` を受け、`collectCountryEvents`→`attachNearestCity`→`assignAdmin1`→`aggregateByAdmin1` を順に通し、`{header, regions, events, degraded}` を返す純関数。`header` は `instabilityCountry` をそのまま流用（新規 LLM 生成なし・該当国が無ければ最小ヘッダ `{code:fips, name_ja:null, score:0, trend:null, counts:null, narrative_ja:null}`）。`forecastCards` は header にそのまま添える。総イベント数が `MAX_POINTS`（既定4000）を超えたら admin1 割当をスキップし `regions:[]`・`degraded:true`（国集計のみ＝必ず描画）。`a1NameMap` は `admin1Polys` から `{code: name_ja||name}` を組んで `aggregateByAdmin1` に渡す。

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js`

**Interfaces:**
- Consumes: 上記 C4-1〜C4-4 の内部関数
- Produces: `buildDrilldown({fips, snapshots, countryPolys, admin1Polys, cities, instabilityCountry, forecastCards}, {MAX_POINTS=4000}={}) -> {header, regions, events, degraded:boolean}`

header 形（instability country shape・実コード `js/ui/instability.js:50-62` 検証済）: `{code, name_ja, score, trend, counts:{conflict,protests,news,quakes}, narrative_ja}` ＋ `forecastCards`。

- [ ] **Step 1: 失敗テストを書く（buildDrilldown）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_aggregate.test.js` の末尾に追記する。

```javascript
const instabilityCountry = {
  code: 'JA', name_ja: '日本', score: 42,
  trend: { isNew: false, normal: { dir: 'up', deltaPct: 5 }, dod: { dir: 'up', delta: 2 } },
  counts: { conflict: 1, protests: 1, news: 1, quakes: 1 },
  narrative_ja: '緊張がやや上昇。',
};

test('buildDrilldown: header に instabilityCountry をそのまま流用', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry, forecastCards: [{ title_ja: '注視' }],
  });
  assert.equal(model.header.code, 'JA');
  assert.equal(model.header.name_ja, '日本');
  assert.equal(model.header.score, 42);
  assert.equal(model.header.narrative_ja, '緊張がやや上昇。');
  assert.deepEqual(model.header.forecastCards, [{ title_ja: '注視' }]);
  assert.equal(model.degraded, false);
});

test('buildDrilldown: regions は admin1 集計・events は最寄り都市付き', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry,
  });
  // JP-13(news n1)・JP-27(conflict c1)・p1(JP-13範囲外=その他想定)。少なくとも regions が件数を持つ。
  assert.ok(Array.isArray(model.regions));
  assert.ok(model.regions.length >= 1);
  // events は cityName を持つ（最寄り都市付与済）。
  assert.ok(model.events.every((e) => 'cityName' in e));
  assert.ok(model.events.length >= 1);
});

test('buildDrilldown: 該当国(instabilityCountry)なしでも落ちず最小ヘッダ', () => {
  const model = buildDrilldown({
    fips: 'JA', snapshots, countryPolys, admin1Polys, cities,
    instabilityCountry: null,
  });
  assert.equal(model.header.code, 'JA');
  assert.equal(model.header.name_ja, null);
  assert.equal(model.header.score, 0);
  assert.equal(model.header.trend, null);
  assert.equal(model.header.counts, null);
  assert.ok(Array.isArray(model.regions));
});

test('buildDrilldown: MAX_POINTS 超過は admin1 をスキップし国集計のみ degraded', () => {
  const many = [];
  for (let i = 0; i < 10; i += 1) {
    many.push({ id: `m${i}`, time: i, mag: 3, place: 'x', lon: 139.7, lat: 35.6 });
  }
  const bigSnap = { quakes: { points: many } };
  const model = buildDrilldown(
    { fips: 'JA', snapshots: bigSnap, countryPolys, admin1Polys, cities, instabilityCountry },
    { MAX_POINTS: 5 },
  );
  assert.equal(model.degraded, true);
  assert.deepEqual(model.regions, []);
  // events は国内全点を保持（国集計は生きる）。
  assert.equal(model.events.length, 10);
});

test('buildDrilldown: 国ポリゴンに該当FIPSなし→空 regions/events・落ちない', () => {
  const model = buildDrilldown({
    fips: 'ZZ', snapshots, countryPolys, admin1Polys, cities, instabilityCountry: null,
  });
  assert.deepEqual(model.regions, []);
  assert.deepEqual(model.events, []);
  assert.equal(model.degraded, false);
  assert.equal(model.header.code, 'ZZ');
});

test('buildDrilldown: 引数欠落でも throw しない', () => {
  const model = buildDrilldown({ fips: 'JA' });
  assert.equal(model.header.code, 'JA');
  assert.deepEqual(model.regions, []);
  assert.deepEqual(model.events, []);
  assert.equal(model.degraded, false);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: FAIL（`buildDrilldown is not a function` で buildDrilldown の6テストが失敗）

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/lib/drilldown/aggregate_admin1.js` の `attachNearestCity` 関数の直後に追記する。

```javascript
// instabilityCountry が無い時の最小ヘッダ（drilldown_view が安全に描ける形）。
function emptyHeader(fips) {
  return { code: fips, name_ja: null, score: 0, trend: null, counts: null, narrative_ja: null };
}

export function buildDrilldown(
  { fips, snapshots, countryPolys, admin1Polys, cities, instabilityCountry, forecastCards } = {},
  { MAX_POINTS = 4000 } = {},
) {
  // header は instabilityCountry をそのまま流用（新規 LLM 生成なし）。無ければ最小ヘッダ。
  const base = (instabilityCountry && typeof instabilityCountry === 'object')
    ? { ...instabilityCountry }
    : emptyHeader(fips);
  if (base.code == null) base.code = fips;
  const header = { ...base, forecastCards: Array.isArray(forecastCards) ? forecastCards : [] };

  // 国内イベント抽出＋最寄り都市付与（events は常に返す＝国集計は生きる）。
  const collected = collectCountryEvents(snapshots, fips, countryPolys);
  const events = attachNearestCity(collected, cities);

  // MAX_POINTS 超過→ admin1 割当をスキップし国集計のみのデグレード。
  if (events.length > MAX_POINTS) {
    return { header, regions: [], events, degraded: true };
  }

  // admin1 割当→ 県別集計。a1NameMap は admin1Polys から {code: name_ja||name}。
  const polys = Array.isArray(admin1Polys) ? admin1Polys : [];
  const a1NameMap = {};
  for (const p of polys) {
    if (p && p.code != null) a1NameMap[p.code] = p.name_ja || p.name || p.code;
  }
  const withA1 = assignAdmin1(events, polys);
  const regions = aggregateByAdmin1(withA1, a1NameMap);

  return { header, regions, events, degraded: false };
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_aggregate.test.js
```

Expected: PASS（計29テストが緑＝collectCountryEvents 6 ＋ assignAdmin1 4 ＋ aggregateByAdmin1 8 ＋ attachNearestCity 5 ＋ buildDrilldown 6）

- [ ] **Step 5: 既存テスト基線が壊れていないことを確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/*.test.js 2>&1 | tail -15
```

Expected: PASS（既存 352 ＋ C4 新規 29 が緑。aggregate_admin1.js は geo_poly.js/nearest.js への新規 import を持つため、C1/C2 が未統合の場合はこのフルランで該当ファイルのみ import 解決に失敗しうる。その場合 `node --test tests/drilldown_aggregate.test.js` 単体の PASS と、C1/C2 統合後のフルラン緑を最終確認とする）

- [ ] **Step 5b: commit する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/lib/drilldown/aggregate_admin1.js tests/drilldown_aggregate.test.js
```

commit メッセージ: `feat(drilldown): buildDrilldown で全合成・instabilityヘッダ流用・MAX_POINTSデグレード`

---

## クラスタ C5 — 純HTMLビルダ＋watchlist (js/lib/drilldown/drilldown_view.js / watchlist.js)

## Cluster C5: 純HTMLビルダ＋watchlist純ロジック

このクラスタは DOM/fetch/map に一切依存しない純粋関数のみを実装する。`js/lib/drilldown/drilldown_view.js`（HTML 文字列ビルダ）と `js/lib/drilldown/watchlist.js`（ウォッチリスト純操作＋store DI ラッパ）を新規作成する。全 HTML 出力は `js/lib/selection.js` の `escapeHtml` を経由して XSS を無効化する。ヘッダは `js/ui/instability.js` の `rowHtml`/`levelOf`/`scoreColor`/`trendArrow` を import 流用し、forecast 注視度を付記する。

依存される側の正準契約（C4 `aggregate_admin1.js` の出力＝このクラスタの入力）:
- `header` = instabilityCountry をそのまま流用したオブジェクト＋forecast 注視度: `{rank, name_ja, code, score, counts:{conflict,protests,news,quakes}, trend, narrative_ja, forecast?:{watch:string, label?:string}}`（instability に該当国が無い場合 `score`/`counts`/`trend`/`narrative_ja` は欠落しうる＝防御的に扱う）。
- `region`（`aggregateByAdmin1` の各要素）= `{a1code:string|null, name_ja:string, count:number, byLayer:{conflict?:n, protests?:n, news?:n, quakes?:n}, topEvents:[{title, cityName?}...], lon:number, lat:number}`。`a1code===null` は「その他/不明」バケット。
- `ev`（`attachNearestCity` 後の個別イベント）= `{layerId:string, lon:number, lat:number, title:string, a1code:string|null, cityName:string|null, raw?:any}`。`region.name_ja` は呼び出し側（render）が付与せず、`eventLineHtml` は ev 自体が持つ `name_ja`（県名）と `cityName`（都市名）で「県名 — 都市名でイベント」を組む。本クラスタの `eventLineHtml(ev)` は `ev={regionName:string, cityName:string|null, layerId:string, title:string}` を受ける（render 層が region をまたいで regionName を流し込む契約）。

レイヤー絵文字の正準対応（instability `rowHtml` の `⚔📢📰🌐` 並びに厳密一致）: `conflict=⚔`, `protests=📢`, `news=📰`, `quakes=🌐`。

---

### Task C5.1: drilldown_view.js — degradedNoticeHtml（最小の独立純関数から着手）

**Files:**
- Create: `js/lib/drilldown/drilldown_view.js`
- Test: `tests/drilldown_view.test.js`

**Interfaces:**
- Consumes: `escapeHtml(s) -> string`（`js/lib/selection.js`）
- Produces: `degradedNoticeHtml(kind) -> string  // kind in {'extra','ocean','missing','fetcherror'}`

- [ ] **Step 1: 失敗テストを書く**

`tests/drilldown_view.test.js` を新規作成する（このファイルは後続 Task で追記していく。最初の版は degradedNoticeHtml のみ）。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { degradedNoticeHtml } from '../js/lib/drilldown/drilldown_view.js';

test('degradedNoticeHtml: 4種すべてが固有の説明文を返す', () => {
  const extra = degradedNoticeHtml('extra');
  const ocean = degradedNoticeHtml('ocean');
  const missing = degradedNoticeHtml('missing');
  const fetcherror = degradedNoticeHtml('fetcherror');
  // 各文言は固有（取り違え防止）
  assert.match(extra, /県別集計/);
  assert.match(ocean, /国を特定/);
  assert.match(missing, /データがありません|未整備/);
  assert.match(fetcherror, /再試行|取得に失敗/);
  // 4種すべて互いに異なる
  const set = new Set([extra, ocean, missing, fetcherror]);
  assert.equal(set.size, 4);
});

test('degradedNoticeHtml: 既知の class でラップされ DOM 非依存の文字列', () => {
  const html = degradedNoticeHtml('extra');
  assert.match(html, /class="dd-degraded"/);
  assert.equal(typeof html, 'string');
});

test('degradedNoticeHtml: 未知 kind は汎用フォールバック文（落ちない）', () => {
  const html = degradedNoticeHtml('unknown-kind-xyz');
  assert.equal(typeof html, 'string');
  assert.match(html, /class="dd-degraded"/);
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: FAIL（`Cannot find module '../js/lib/drilldown/drilldown_view.js'` — モジュール未作成のため import 解決に失敗する）

- [ ] **Step 3: 最小実装を書く**

`js/lib/drilldown/drilldown_view.js` を新規作成する。

```js
// 国ドリルダウンの純 HTML ビルダ。DOM/fetch/map 非依存・全出力は escapeHtml 経由。
// ヘッダは instability の純ヘルパ（levelOf/scoreColor/trendArrow/rowHtml）を流用する。
import { escapeHtml } from '../selection.js';
import { levelOf, scoreColor, trendArrow, rowHtml } from '../../ui/instability.js';

// degraded バナーの説明文。kind=理由種別。未知 kind は汎用文にフォールバック。
const DEGRADED_TEXT = {
  extra: '小国・領土のため県別集計はありません。',
  ocean: '海洋上のため国を特定できませんでした。',
  missing: 'この国の県・都市データは未整備です。',
  fetcherror: 'データの取得に失敗しました。再試行してください。',
};
export function degradedNoticeHtml(kind) {
  const text = DEGRADED_TEXT[kind] || 'この国の詳細は表示できません。';
  return `<div class="dd-degraded">${escapeHtml(text)}</div>`;
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: PASS（degradedNoticeHtml の3テストが緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/drilldown_view.js tests/drilldown_view.test.js
git commit -m "drilldown_view: degradedNoticeHtml 4種の説明文ビルダ"
```

---

### Task C5.2: drilldown_view.js — eventLineHtml（「県名 — 都市名でイベント」整形）

**Files:**
- Modify: `js/lib/drilldown/drilldown_view.js`
- Test: `tests/drilldown_view.test.js`

**Interfaces:**
- Consumes: `escapeHtml(s) -> string`（`js/lib/selection.js`）
- Produces: `eventLineHtml(ev) -> string  // ev={regionName:string, cityName:string|null, layerId:string, title:string}`

- [ ] **Step 1: 失敗テストを追記する**

`tests/drilldown_view.test.js` の末尾に追記する。

```js
import { eventLineHtml } from '../js/lib/drilldown/drilldown_view.js';

test('eventLineHtml: 都市名ありは「県名 — 都市名でイベント」形式', () => {
  const html = eventLineHtml({
    regionName: 'カリフォルニア州', cityName: 'ロサンゼルス',
    layerId: 'protests', title: '抗議',
  });
  assert.match(html, /カリフォルニア州/);
  assert.match(html, /ロサンゼルス/);
  assert.match(html, /で抗議/);
});

test('eventLineHtml: 都市名なしは都市部分を省きフォールバック', () => {
  const html = eventLineHtml({
    regionName: 'カリフォルニア州', cityName: null,
    layerId: 'protests', title: '抗議',
  });
  assert.match(html, /カリフォルニア州/);
  assert.doesNotMatch(html, /—\s*でイベント/); // 空都市の壊れた整形が出ない
  assert.match(html, /抗議/);
});

test('eventLineHtml: レイヤー絵文字が instability 並びに一致', () => {
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'conflict', title: 't' }), /⚔/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'protests', title: 't' }), /📢/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'news', title: 't' }), /📰/);
  assert.match(eventLineHtml({ regionName: 'X', cityName: 'C', layerId: 'quakes', title: 't' }), /🌐/);
});

test('eventLineHtml: XSS エスケープ（regionName/cityName/title）', () => {
  const html = eventLineHtml({
    regionName: '<script>a</script>', cityName: '"><img src=x>',
    layerId: 'news', title: '<b>x</b>',
  });
  assert.doesNotMatch(html, /<script>a<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('eventLineHtml: ev 欠落でも落ちない', () => {
  assert.equal(typeof eventLineHtml(null), 'string');
  assert.equal(typeof eventLineHtml({}), 'string');
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: FAIL（`eventLineHtml` が未 export ＝ `eventLineHtml is not a function` で eventLineHtml 系テストが失敗。degradedNoticeHtml 系は引き続き PASS）

- [ ] **Step 3: 最小実装を追記する**

`js/lib/drilldown/drilldown_view.js` の `degradedNoticeHtml` の前（import 群の直後）にレイヤー絵文字テーブルを追加し、ファイル末尾に `eventLineHtml` を追加する。

まず import 群の直後に以下を追加する。

```js
// レイヤー絵文字（instability rowHtml の ⚔📢📰🌐 並びに厳密一致）。
const LAYER_EMOJI = { conflict: '⚔', protests: '📢', news: '📰', quakes: '🌐' };
```

次にファイル末尾に以下を追加する。

```js
// 個別イベント行。ev={regionName, cityName, layerId, title}。
// 都市名あり→「県名 — 都市名でタイトル」、なし→「県名 — タイトル」。
export function eventLineHtml(ev) {
  const o = ev || {};
  const emoji = LAYER_EMOJI[o.layerId] || '・';
  const region = escapeHtml(o.regionName || '');
  const title = escapeHtml(o.title || '');
  const where = o.cityName
    ? `${escapeHtml(o.cityName)}で${title}`
    : title;
  return `<div class="dd-event"><span class="dd-ev-emoji">${emoji}</span>`
    + `<span class="dd-ev-text">${region} — ${where}</span></div>`;
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: PASS（degradedNoticeHtml＋eventLineHtml 全テストが緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/drilldown_view.js tests/drilldown_view.test.js
git commit -m "drilldown_view: eventLineHtml 県名・都市名・絵文字整形"
```

---

### Task C5.3: drilldown_view.js — regionRowHtml（県名＋件数＋内訳＋代表イベント）

**Files:**
- Modify: `js/lib/drilldown/drilldown_view.js`
- Test: `tests/drilldown_view.test.js`

**Interfaces:**
- Consumes: `escapeHtml(s) -> string`（`js/lib/selection.js`）
- Produces: `regionRowHtml(region) -> string  // region={a1code:string|null, name_ja:string, count:number, byLayer:{conflict?,protests?,news?,quakes?}, topEvents:[{title, cityName?}...], lon, lat}`

- [ ] **Step 1: 失敗テストを追記する**

`tests/drilldown_view.test.js` の末尾に追記する。

```js
import { regionRowHtml } from '../js/lib/drilldown/drilldown_view.js';

test('regionRowHtml: 県名・件数・内訳絵文字を含む', () => {
  const html = regionRowHtml({
    a1code: 'US-CA', name_ja: 'カリフォルニア州', count: 7,
    byLayer: { conflict: 1, protests: 4, news: 2, quakes: 0 },
    topEvents: [{ title: '抗議', cityName: 'ロサンゼルス' }],
    lon: -119, lat: 37,
  });
  assert.match(html, /カリフォルニア州/);
  assert.match(html, /7/);            // 件数
  assert.match(html, /⚔1/);           // conflict 内訳
  assert.match(html, /📢4/);          // protests 内訳
  assert.match(html, /📰2/);          // news 内訳
  assert.match(html, /🌐0/);          // quakes 内訳（0 も明示）
  assert.match(html, /ロサンゼルス/);  // 代表イベント
});

test('regionRowHtml: その他/不明バケット（a1code=null）も県名で描画', () => {
  const html = regionRowHtml({
    a1code: null, name_ja: 'その他/不明', count: 3,
    byLayer: { news: 3 }, topEvents: [], lon: 0, lat: 0,
  });
  assert.match(html, /その他\/不明/);
  assert.match(html, /3/);
  assert.match(html, /📰3/);
  // byLayer に無いレイヤーは 0 表示
  assert.match(html, /⚔0/);
});

test('regionRowHtml: 代表イベント無しでも落ちない', () => {
  const html = regionRowHtml({
    a1code: 'X', name_ja: '某州', count: 0, byLayer: {}, topEvents: [], lon: 1, lat: 1,
  });
  assert.equal(typeof html, 'string');
  assert.match(html, /某州/);
  assert.match(html, /⚔0/);
});

test('regionRowHtml: XSS エスケープ（name_ja・代表イベント title）', () => {
  const html = regionRowHtml({
    a1code: 'X', name_ja: '<script>a</script>', count: 1,
    byLayer: { news: 1 }, topEvents: [{ title: '"><img src=x>', cityName: '<b>c</b>' }],
    lon: 0, lat: 0,
  });
  assert.doesNotMatch(html, /<script>a<\/script>/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.doesNotMatch(html, /<b>c<\/b>/);
  assert.match(html, /&lt;script&gt;/);
});

test('regionRowHtml: region 欠落でも落ちない', () => {
  assert.equal(typeof regionRowHtml(null), 'string');
  assert.equal(typeof regionRowHtml({}), 'string');
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: FAIL（`regionRowHtml` 未 export ＝ `regionRowHtml is not a function`。既存 degraded/eventLine テストは PASS）

- [ ] **Step 3: 最小実装を追記する**

`js/lib/drilldown/drilldown_view.js` の末尾に追加する。`eventLineHtml` の内部整形を再利用せず、代表イベントは region 文脈で1行だけ簡潔に描く（県名は行頭に既出のため代表行では都市＋タイトルのみ）。

```js
// byLayer 内訳を「⚔n 📢n 📰n 🌐n」の固定並びで描く（欠落は 0）。
function _byLayerHtml(byLayer) {
  const b = byLayer || {};
  return `<span class="dd-rg-counts">`
    + `⚔${escapeHtml(b.conflict || 0)} 📢${escapeHtml(b.protests || 0)} `
    + `📰${escapeHtml(b.news || 0)} 🌐${escapeHtml(b.quakes || 0)}</span>`;
}

// 県/州ランキングの1行。region={name_ja, count, byLayer, topEvents, ...}。
// 代表イベントは topEvents[0] を「都市でタイトル」形式（都市なしはタイトルのみ）で1件添える。
export function regionRowHtml(region) {
  const r = region || {};
  const name = escapeHtml(r.name_ja || (r.a1code || ''));
  const count = escapeHtml(r.count || 0);
  const top = (Array.isArray(r.topEvents) && r.topEvents[0]) ? r.topEvents[0] : null;
  let rep = '';
  if (top) {
    const t = escapeHtml(top.title || '');
    rep = top.cityName
      ? `<span class="dd-rg-rep">${escapeHtml(top.cityName)}で${t}</span>`
      : `<span class="dd-rg-rep">${t}</span>`;
  }
  return `<div class="dd-region">`
    + `<span class="dd-rg-name">${name}</span>`
    + `<span class="dd-rg-total">${count}件</span>`
    + _byLayerHtml(r.byLayer)
    + rep
    + `</div>`;
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: PASS（degraded/eventLine/regionRow 全テストが緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/drilldown_view.js tests/drilldown_view.test.js
git commit -m "drilldown_view: regionRowHtml 県名・件数・内訳・代表"
```

---

### Task C5.4: drilldown_view.js — drilldownHeaderHtml（instability ヘルパ流用＋forecast 注視度）

**Files:**
- Modify: `js/lib/drilldown/drilldown_view.js`
- Test: `tests/drilldown_view.test.js`

**Interfaces:**
- Consumes: `escapeHtml(s)`（selection.js）/ `levelOf(score)`,`scoreColor(score)`,`trendArrow(dir)`,`rowHtml(country)`（instability.js）
- Produces: `drilldownHeaderHtml(header) -> string  // header={rank, name_ja, code, score, counts, trend, narrative_ja, forecast?:{watch,label?}}`

- [ ] **Step 1: 失敗テストを追記する**

`tests/drilldown_view.test.js` の末尾に追記する。

```js
import { drilldownHeaderHtml } from '../js/lib/drilldown/drilldown_view.js';

test('drilldownHeaderHtml: instability rowHtml 流用で国名/スコア/内訳を含む', () => {
  const html = drilldownHeaderHtml({
    rank: 3, name_ja: 'ウクライナ', code: 'UP', score: 87,
    counts: { conflict: 10, protests: 1, news: 5, quakes: 0 },
    trend: { dod: { delta: 4, dir: 'up' }, normal: { deltaPct: 12, dir: 'up' }, isNew: false },
    narrative_ja: '紛争が継続',
  });
  assert.match(html, /ウクライナ/);
  assert.match(html, /87/);
  assert.match(html, /⚔10/);          // rowHtml 由来の内訳
  assert.match(html, /紛争が継続/);     // narrative
});

test('drilldownHeaderHtml: forecast 注視度がある時は注視度を付記', () => {
  const html = drilldownHeaderHtml({
    name_ja: 'ウクライナ', code: 'UP', score: 50,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 },
    trend: { isNew: true },
    forecast: { watch: '高', label: '24h 内に情勢悪化の可能性' },
  });
  assert.match(html, /注視度/);
  assert.match(html, /高/);
  assert.match(html, /24h 内に情勢悪化の可能性/);
});

test('drilldownHeaderHtml: forecast 無しは注視度セクションを省く', () => {
  const html = drilldownHeaderHtml({
    name_ja: '某国', code: 'XX', score: 0,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
  });
  assert.doesNotMatch(html, /注視度/);
});

test('drilldownHeaderHtml: instability に無い国（score/counts 欠落）でも落ちない', () => {
  const html = drilldownHeaderHtml({ name_ja: 'ナウル', code: 'NR' });
  assert.equal(typeof html, 'string');
  assert.match(html, /ナウル/);
});

test('drilldownHeaderHtml: forecast の XSS エスケープ', () => {
  const html = drilldownHeaderHtml({
    name_ja: '某国', code: 'XX', score: 1,
    counts: { conflict: 0, protests: 0, news: 0, quakes: 0 }, trend: { isNew: true },
    forecast: { watch: '<b>高</b>', label: '"><img src=x>' },
  });
  assert.doesNotMatch(html, /<b>高<\/b>/);
  assert.doesNotMatch(html, /<img src=x>/);
});

test('drilldownHeaderHtml: header 欠落でも落ちない', () => {
  assert.equal(typeof drilldownHeaderHtml(null), 'string');
  assert.equal(typeof drilldownHeaderHtml({}), 'string');
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: FAIL（`drilldownHeaderHtml` 未 export ＝ `drilldownHeaderHtml is not a function`。既存テストは PASS）

- [ ] **Step 3: 最小実装を追記する**

`js/lib/drilldown/drilldown_view.js` の末尾に追加する。本体は instability の `rowHtml` をそのまま流用し（国名/スコアバー/level 色/trend バッジ/内訳/narrative を一括描画）、その後に forecast 注視度セクションを付記する。`levelOf`/`scoreColor`/`trendArrow` は将来の拡張・import 整合のため明示利用する（注視度ラベルの色付けに scoreColor を流用）。

```js
// forecast 注視度セクション（forecastCards 由来）。watch=注視度ラベル, label=補足文。
function _forecastHtml(forecast) {
  if (!forecast || !forecast.watch) return '';
  const watch = escapeHtml(forecast.watch);
  const label = forecast.label ? `<span class="dd-fc-label">${escapeHtml(forecast.label)}</span>` : '';
  return `<div class="dd-forecast"><span class="dd-fc-tag">注視度 ${watch}</span>${label}</div>`;
}

// ドリルダウン・ヘッダ。header=instability の国オブジェクト流用＋forecast 注視度。
// 本体は instability rowHtml を流用（スコアバー/level 色/trend/内訳/narrative を再現）。
export function drilldownHeaderHtml(header) {
  const h = header || {};
  // score 由来の level 色を data 属性に添える（render 側の枠色付けフック・import 整合）。
  const lvl = levelOf(h.score || 0);
  const col = scoreColor(h.score || 0);
  const arrow = h.trend ? trendArrow((h.trend.normal && h.trend.normal.dir) || (h.trend.dod && h.trend.dod.dir)) : '';
  const body = rowHtml(h);
  return `<div class="dd-header" data-lvl="${escapeHtml(lvl)}" data-arrow="${escapeHtml(arrow)}" style="--dd-lvl:${col}">`
    + body
    + _forecastHtml(h.forecast)
    + `</div>`;
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_view.test.js
```

Expected: PASS（drilldown_view.js の全テスト＝degraded/eventLine/regionRow/header が緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/drilldown_view.js tests/drilldown_view.test.js
git commit -m "drilldown_view: drilldownHeaderHtml instability流用+forecast注視度"
```

---

### Task C5.5: watchlist.js — addCode / removeCode / hasCode（重複排除・順序保持・上限30）

**Files:**
- Create: `js/lib/drilldown/watchlist.js`
- Test: `tests/drilldown_watchlist.test.js`

**Interfaces:**
- Consumes: なし（純配列操作）
- Produces: `addCode(list, code) -> string[]` / `removeCode(list, code) -> string[]` / `hasCode(list, code) -> boolean`

- [ ] **Step 1: 失敗テストを書く**

`tests/drilldown_watchlist.test.js` を新規作成する。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCode, removeCode, hasCode } from '../js/lib/drilldown/watchlist.js';

test('addCode: 末尾追加・順序保持・新配列を返し元を破壊しない', () => {
  const base = ['UP', 'RS'];
  const next = addCode(base, 'JA');
  assert.deepEqual(next, ['UP', 'RS', 'JA']);
  assert.deepEqual(base, ['UP', 'RS']); // 元は不変
});

test('addCode: 重複は追加しない（既存順を保持）', () => {
  assert.deepEqual(addCode(['UP', 'RS'], 'UP'), ['UP', 'RS']);
});

test('addCode: 上限30。30件で先頭を落として末尾追加（FIFO）', () => {
  const full = Array.from({ length: 30 }, (_, i) => 'C' + i); // C0..C29
  const next = addCode(full, 'NEW');
  assert.equal(next.length, 30);
  assert.equal(next[0], 'C1');          // 先頭 C0 が落ちる
  assert.equal(next[29], 'NEW');        // 末尾に NEW
});

test('addCode: 空/不正 code は無視（元と同等の配列）', () => {
  assert.deepEqual(addCode(['UP'], ''), ['UP']);
  assert.deepEqual(addCode(['UP'], null), ['UP']);
});

test('addCode: list が非配列なら code 1件の新配列', () => {
  assert.deepEqual(addCode(null, 'UP'), ['UP']);
  assert.deepEqual(addCode(undefined, 'UP'), ['UP']);
});

test('removeCode: 指定 code を除いた新配列・順序保持', () => {
  const base = ['UP', 'RS', 'JA'];
  assert.deepEqual(removeCode(base, 'RS'), ['UP', 'JA']);
  assert.deepEqual(base, ['UP', 'RS', 'JA']); // 元は不変
});

test('removeCode: 無い code は元と同等', () => {
  assert.deepEqual(removeCode(['UP'], 'ZZ'), ['UP']);
});

test('removeCode: list が非配列なら空配列', () => {
  assert.deepEqual(removeCode(null, 'UP'), []);
});

test('hasCode: 含むなら true / 含まないなら false', () => {
  assert.equal(hasCode(['UP', 'RS'], 'RS'), true);
  assert.equal(hasCode(['UP', 'RS'], 'JA'), false);
  assert.equal(hasCode(null, 'UP'), false);
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: FAIL（`Cannot find module '../js/lib/drilldown/watchlist.js'` — モジュール未作成のため import に失敗する）

- [ ] **Step 3: 最小実装を書く**

`js/lib/drilldown/watchlist.js` を新規作成する。

```js
// ウォッチリストの純操作（FIPS 配列）＋localStorage 薄ラッパ（state.js 同型）。
// permalink/share には載せない（共有 URL に混入させない）。
const MAX = 30;

// code を末尾追加した新配列。重複は無視・上限 30 超過時は先頭を落とす（FIFO）。
export function addCode(list, code) {
  const arr = Array.isArray(list) ? list.slice() : [];
  const c = typeof code === 'string' ? code.trim() : '';
  if (!c) return arr;
  if (arr.includes(c)) return arr;
  arr.push(c);
  while (arr.length > MAX) arr.shift();
  return arr;
}

// code を除いた新配列（順序保持）。
export function removeCode(list, code) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter((x) => x !== code);
}

// code を含むか。
export function hasCode(list, code) {
  return Array.isArray(list) && list.includes(code);
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: PASS（addCode/removeCode/hasCode の全テストが緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/watchlist.js tests/drilldown_watchlist.test.js
git commit -m "watchlist: addCode/removeCode/hasCode 純操作（上限30・重複排除）"
```

---

### Task C5.6: watchlist.js — orderByInstability（instability join で score 降順）

**Files:**
- Modify: `js/lib/drilldown/watchlist.js`
- Test: `tests/drilldown_watchlist.test.js`

**Interfaces:**
- Consumes: なし（countries は呼び出し側から DI＝`window.__orbis.instability.countries` 形）
- Produces: `orderByInstability(list, countries) -> string[]  // countries=[{code, score, ...}]・score 降順・圏外は末尾`

- [ ] **Step 1: 失敗テストを追記する**

`tests/drilldown_watchlist.test.js` の末尾に追記する。

```js
import { orderByInstability } from '../js/lib/drilldown/watchlist.js';

test('orderByInstability: instability score の降順に並べ替える', () => {
  const list = ['JA', 'UP', 'RS'];
  const countries = [
    { code: 'UP', score: 90 },
    { code: 'RS', score: 70 },
    { code: 'JA', score: 5 },
  ];
  assert.deepEqual(orderByInstability(list, countries), ['UP', 'RS', 'JA']);
});

test('orderByInstability: instability に無い国（圏外）は score 0 扱いで末尾', () => {
  const list = ['JA', 'UP', 'XX'];
  const countries = [{ code: 'UP', score: 90 }, { code: 'JA', score: 50 }];
  // UP(90) > JA(50) > XX(0)
  assert.deepEqual(orderByInstability(list, countries), ['UP', 'JA', 'XX']);
});

test('orderByInstability: 同 score は元の list 順を保つ（安定）', () => {
  const list = ['A', 'B', 'C'];
  const countries = [{ code: 'A', score: 10 }, { code: 'B', score: 10 }, { code: 'C', score: 10 }];
  assert.deepEqual(orderByInstability(list, countries), ['A', 'B', 'C']);
});

test('orderByInstability: countries 欠落でも落ちない（list をそのまま返す）', () => {
  assert.deepEqual(orderByInstability(['A', 'B'], null), ['A', 'B']);
  assert.deepEqual(orderByInstability(['A', 'B'], []), ['A', 'B']);
});

test('orderByInstability: list が非配列なら空配列', () => {
  assert.deepEqual(orderByInstability(null, [{ code: 'A', score: 1 }]), []);
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: FAIL（`orderByInstability` 未 export ＝ `orderByInstability is not a function`。既存 addCode 系は PASS）

- [ ] **Step 3: 最小実装を追記する**

`js/lib/drilldown/watchlist.js` の末尾に追加する。`Array.prototype.sort` は V8 で安定ソートのため、同 score は元の index 比較を補助キーにして安定性を明示担保する。

```js
// list（FIPS 配列）を instability countries の score 降順に並べ替える。
// 圏外（countries に無い）は score 0 扱いで末尾・同 score は元の list 順を保つ。
export function orderByInstability(list, countries) {
  if (!Array.isArray(list)) return [];
  const scoreOf = new Map();
  (Array.isArray(countries) ? countries : []).forEach((c) => {
    if (c && typeof c.code === 'string') scoreOf.set(c.code, c.score || 0);
  });
  return list
    .map((code, i) => ({ code, i, s: scoreOf.get(code) || 0 }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.code);
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: PASS（addCode/removeCode/hasCode/orderByInstability の全テストが緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/watchlist.js tests/drilldown_watchlist.test.js
git commit -m "watchlist: orderByInstability instability join で score 降順"
```

---

### Task C5.7: watchlist.js — makeWatchlistStore（storage DI・破損 JSON→[]・round-trip）

**Files:**
- Modify: `js/lib/drilldown/watchlist.js`
- Test: `tests/drilldown_watchlist.test.js`

**Interfaces:**
- Consumes: なし（storage は DI＝`{getItem,setItem}` を持つ任意オブジェクト）
- Produces: `makeWatchlistStore({storage, key='orbis.watchlist'}) -> {load()->string[], save(codes)->void}`

- [ ] **Step 1: 失敗テストを追記する**

`tests/drilldown_watchlist.test.js` の末尾に追記する。fake storage を DI し state.js の readStored/writeStored 同型の round-trip と破損 JSON フォールバックを検証する。

```js
import { makeWatchlistStore } from '../js/lib/drilldown/watchlist.js';

function fakeStorage(init) {
  const m = new Map(init ? Object.entries(init) : []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, v); },
    _dump: () => m,
  };
}

test('makeWatchlistStore: save→load の round-trip（配列を保持）', () => {
  const storage = fakeStorage();
  const store = makeWatchlistStore({ storage });
  store.save(['UP', 'RS']);
  assert.deepEqual(store.load(), ['UP', 'RS']);
});

test('makeWatchlistStore: 既定キー orbis.watchlist に書く', () => {
  const storage = fakeStorage();
  const store = makeWatchlistStore({ storage });
  store.save(['JA']);
  assert.equal(storage.getItem('orbis.watchlist'), JSON.stringify(['JA']));
});

test('makeWatchlistStore: key 上書き可能', () => {
  const storage = fakeStorage();
  const store = makeWatchlistStore({ storage, key: 'k.custom' });
  store.save(['JA']);
  assert.equal(storage.getItem('k.custom'), JSON.stringify(['JA']));
});

test('makeWatchlistStore: 未保存時 load は []', () => {
  const store = makeWatchlistStore({ storage: fakeStorage() });
  assert.deepEqual(store.load(), []);
});

test('makeWatchlistStore: 破損 JSON は [] にフォールバック', () => {
  const store = makeWatchlistStore({ storage: fakeStorage({ 'orbis.watchlist': '{not json' }) });
  assert.deepEqual(store.load(), []);
});

test('makeWatchlistStore: 配列でない JSON（オブジェクト）も [] にフォールバック', () => {
  const store = makeWatchlistStore({ storage: fakeStorage({ 'orbis.watchlist': '{"a":1}' }) });
  assert.deepEqual(store.load(), []);
});

test('makeWatchlistStore: storage 無し（null）でも load=[]・save は no-op で落ちない', () => {
  const store = makeWatchlistStore({ storage: null });
  assert.deepEqual(store.load(), []);
  assert.doesNotThrow(() => store.save(['UP']));
});

test('makeWatchlistStore: setItem が throw しても save は握りつぶす', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
  };
  const store = makeWatchlistStore({ storage });
  assert.doesNotThrow(() => store.save(['UP']));
});
```

- [ ] **Step 2: 失敗を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: FAIL（`makeWatchlistStore` 未 export ＝ `makeWatchlistStore is not a function`。既存テストは PASS）

- [ ] **Step 3: 最小実装を追記する**

`js/lib/drilldown/watchlist.js` の末尾に追加する。state.js の readStored/writeStored の try/catch イディオムに揃え、破損・非配列・storage 欠落をすべて [] / no-op に倒す。

```js
// localStorage 薄ラッパ（state.js readStored/writeStored 同型）。storage を DI。
// load: 破損 JSON / 非配列 / storage 欠落 → []。save: 失敗は握りつぶす。
export function makeWatchlistStore({ storage, key = 'orbis.watchlist' } = {}) {
  return {
    load() {
      if (!storage) return [];
      try {
        const v = JSON.parse(storage.getItem(key));
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },
    save(codes) {
      if (!storage) return;
      try {
        storage.setItem(key, JSON.stringify(Array.isArray(codes) ? codes : []));
      } catch {
        /* noop */
      }
    },
  };
}
```

- [ ] **Step 4: 成功を確認する**

```
node --test tests/drilldown_watchlist.test.js
```

Expected: PASS（watchlist.js の全テスト＝addCode/removeCode/hasCode/orderByInstability/makeWatchlistStore が緑）

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/watchlist.js tests/drilldown_watchlist.test.js
git commit -m "watchlist: makeWatchlistStore storage DI・破損JSON→[]"
```

---

### Task C5.8: クラスタ回帰確認（全 node:test 緑・baseline 352 維持＋上積み）

**Files:**
- Test: `tests/drilldown_view.test.js` / `tests/drilldown_watchlist.test.js`（既存全テストとの同時実行）

**Interfaces:**
- Consumes: なし
- Produces: なし（検証のみ）

- [ ] **Step 1: クラスタ単体の最終確認**

```
node --test tests/drilldown_view.test.js tests/drilldown_watchlist.test.js
```

Expected: PASS（C5 で追加した drilldown_view 系＋watchlist 系の全テストが緑・fail 0）

- [ ] **Step 2: 全体回帰（baseline 352 を割らない・C5 分が上積み）**

```
node --test tests/*.test.js
```

Expected: PASS（既存 352 を含む全テストが緑・C5 追加分だけ pass 件数が増える・fail 0。selection.js / instability.js / places.js を import するが既存 export を読むだけで改変しないため既存テストは不変）

- [ ] **Step 3: import 解決の健全性チェック（相対パス誤りの早期検出）**

```
node --input-type=module -e "import('./js/lib/drilldown/drilldown_view.js').then(()=>console.log('view OK')); import('./js/lib/drilldown/watchlist.js').then(()=>console.log('watchlist OK'));"
```

Expected: `view OK` と `watchlist OK` が出力される（`js/lib/selection.js`・`js/ui/instability.js` への相対 import が解決でき、ロード時例外が無いことを確認）

- [ ] **Step 4: commit（検証ログのみ・コード変更なしの場合はスキップ）**

このステップはコード差分が無ければ commit 不要。Step 1-3 がすべて Expected どおりなら C5 完了。差分が生じた場合のみ:

```
git add js/lib/drilldown/drilldown_view.js js/lib/drilldown/watchlist.js tests/drilldown_view.test.js tests/drilldown_watchlist.test.js
git commit -m "drilldown C5: 純HTMLビルダ+watchlist 回帰確認"
```

---

## クラスタ C6 — I/O境界 DI seam (country_index.js / country_data.js / ui/country_click.js)

## クラスタ C6 — I/O境界（DI seam）

このクラスタは「外界（fetch / map / DOM）に触れる薄い境界層」を実装する。純粋計算（C1 geo_poly / C2 zoom_for_bbox / C4 aggregate_admin1）と render（C7 ui/drilldown）は別クラスタで実装済みの前提で、それらを**正準シグネチャどおりに import して配線するだけ**にする。テストは fetch / map / storage を fake 注入して I/O を完全に隔離する（実ネットワーク・実 DOM 不要）。

依存の実コード確認済み事実（憶測排除）:
- `js/lib/gazetteer.js` は `export const COUNTRIES = [{code, ja, en, lng, lat}, ...]`（239件・code 昇順）。`country_centroids.js` は `COUNTRY_CENTROIDS` のみ export し `EXTRA` は無い。よって `fipsCenter` は **`COUNTRIES` を `{lng,lat}` で索引**する（COUNTRIES が COUNTRY_CENTROIDS＋FIPS_JA を join 済の単一ソース）。
- `data/static/country_bounds.geojson` は `{type, properties:{code, name}, geometry}` の 171 features。`data/static`・`config` は `data-source.js` の対象外で**常に相対 fetch**（snapshot.js の raw GitHub 経路には載らない）。よって `loadCountryBounds` / `loadCountryGeo` は素の相対パス文字列を fetch する。
- `snapshots` は `window.__orbis` に載らない（main.js:58 の module-local）。よって country_click は **`getSnapshots()` クロージャ**から snapshot を読む（DI）。
- deck onClick（main.js:321）は `if (!info || !info.object || !info.layer) return;` で空振りを捨てるため国クリックを拾えない。国クリックは `map.on('click')`（MapLibre 生イベント）で受け、deck が pick した場合は `noteDeckPick(lngLat)` で記録した「時刻＋座標」を `handleMapClick` が二重判定して抑制する。
- `selected` の形は `{lon, lat, title, layerId, at}`（main.js:343 等）で `at: performance.now()`。openCountry はこの形に合流する（着地リティクル `buildReticleConfigs` 流用のため）。

テスト規約: `import { test } from 'node:test';` ＋ `import assert from 'node:assert/strict';`。実行は `node --test tests/<name>.test.js`。

---

### Task C6-1: country_index.js — fipsCenter（COUNTRIES 索引）

**Files:**
- Create: `js/lib/drilldown/country_index.js`
- Test: `tests/drilldown_country_data.test.js`（このクラスタの index/data 共用テストファイル。Task C6-1〜C6-5 はこの1ファイルに追記していく）

**Interfaces:**
- Produces: `fipsCenter(fips) -> [lon, lat]`
- Consumes: `COUNTRIES -> [{code, ja, en, lng, lat}]`（`js/lib/gazetteer.js`）

- [ ] **Step 1: 失敗テストを書く**

`tests/drilldown_country_data.test.js` を新規作成し、以下を全文で書く。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fipsCenter } from '../js/lib/drilldown/country_index.js';

test('fipsCenter: 既知FIPS は COUNTRIES の [lng,lat] を返す', () => {
  // JA(日本)=135.6614,36.2041 / US=-95.8259,37.2345（country_centroids.js 実値）
  assert.deepEqual(fipsCenter('JA'), [135.6614, 36.2041]);
  assert.deepEqual(fipsCenter('US'), [-95.8259, 37.2345]);
});

test('fipsCenter: 未知FIPS は null', () => {
  assert.equal(fipsCenter('ZZ'), null);
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: FAIL（`Cannot find module '../js/lib/drilldown/country_index.js'` で読み込み失敗）。

- [ ] **Step 3: 最小実装**

`js/lib/drilldown/country_index.js` を新規作成し、以下を全文で書く。

```js
// 国ドリルダウンの I/O 索引層（DI seam）。
// - country_bounds.geojson を一度だけ fetch→loadPolygons でキャッシュ（client FIPS 解決の一次ソース）。
// - countryBbox: admin1_bbox.json 由来の国 bbox。未登録 FIPS(EXTRA68) は manifest.extra の矩形 / fipsCenter±固定マージン。
// - fipsCenter: gazetteer.COUNTRIES を FIPS→[lng,lat] に索引（COUNTRY_CENTROIDS＋FIPS_JA join 済の単一ソース）。
import { loadPolygons } from './geo_poly.js';
import { COUNTRIES } from '../gazetteer.js';

const CENTER_BY_FIPS = new Map(COUNTRIES.map((c) => [c.code, [c.lng, c.lat]]));

export function fipsCenter(fips) {
  return CENTER_BY_FIPS.get(fips) || null;
}
```

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（fipsCenter の2テストが緑）。

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/country_index.js tests/drilldown_country_data.test.js
git commit -m "drilldown: add fipsCenter (COUNTRIES index) in country_index"
```

---

### Task C6-2: country_index.js — countryBbox（bboxIndex/extra/centroid フォールバック3段）

**Files:**
- Modify: `js/lib/drilldown/country_index.js`
- Test: `tests/drilldown_country_data.test.js`（追記）

**Interfaces:**
- Produces: `countryBbox(fips, bboxIndex) -> [w,s,e,n]`
  - `bboxIndex` は admin1_bbox.json をパースした `{ country: {<fips>: [w,s,e,n]}, extra?: {<fips>: {lon,lat,margin}} }` 相当のオブジェクト。実体は manifest と bbox の合成だが、本関数は引数で受けた索引だけを読む（純粋・I/O 非依存）。
- Consumes: `fipsCenter(fips) -> [lon,lat]`（同ファイル）

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_data.test.js` の末尾に以下を追記する。

```js
import { countryBbox } from '../js/lib/drilldown/country_index.js';

const BBOX_INDEX = {
  country: { JA: [122.93, 24.04, 153.99, 45.52] },
  extra: { IS: { lon: 34.95, lat: 31.45, margin: 1.5 } },
};

test('countryBbox: country 索引にあればその bbox', () => {
  assert.deepEqual(countryBbox('JA', BBOX_INDEX), [122.93, 24.04, 153.99, 45.52]);
});

test('countryBbox: extra(EXTRA68) は lon/lat±margin の矩形', () => {
  assert.deepEqual(countryBbox('IS', BBOX_INDEX), [34.95 - 1.5, 31.45 - 1.5, 34.95 + 1.5, 31.45 + 1.5]);
});

test('countryBbox: どちらにも無いが fipsCenter があれば ±2度', () => {
  // US は country/extra 索引に無い → fipsCenter(US)=[-95.8259,37.2345] の ±2度
  assert.deepEqual(countryBbox('US', BBOX_INDEX), [-95.8259 - 2, 37.2345 - 2, -95.8259 + 2, 37.2345 + 2]);
});

test('countryBbox: 索引も centroid も無ければ世界全体 bbox', () => {
  assert.deepEqual(countryBbox('ZZ', {}), [-180, -85, 180, 85]);
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: FAIL（`countryBbox` が未 export で `TypeError` / import 失敗）。

- [ ] **Step 3: 最小実装**

`js/lib/drilldown/country_index.js` の `fipsCenter` 定義の後（ファイル末尾）に以下を追記する。

```js
// EXTRA68 等ポリゴン無し国の矩形フォールバックに使う既定マージン（fipsCenter 由来時）。
const CENTER_MARGIN_DEG = 2;

export function countryBbox(fips, bboxIndex) {
  const idx = bboxIndex || {};
  const country = idx.country || {};
  if (Array.isArray(country[fips])) return country[fips].slice();
  const extra = idx.extra || {};
  const e = extra[fips];
  if (e && Number.isFinite(e.lon) && Number.isFinite(e.lat)) {
    const m = Number.isFinite(e.margin) ? e.margin : CENTER_MARGIN_DEG;
    return [e.lon - m, e.lat - m, e.lon + m, e.lat + m];
  }
  const c = fipsCenter(fips);
  if (c) return [c[0] - CENTER_MARGIN_DEG, c[1] - CENTER_MARGIN_DEG, c[0] + CENTER_MARGIN_DEG, c[1] + CENTER_MARGIN_DEG];
  return [-180, -85, 180, 85];
}
```

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（countryBbox の4テスト＋既存 fipsCenter テストが緑）。

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/country_index.js tests/drilldown_country_data.test.js
git commit -m "drilldown: add countryBbox 3-tier fallback (index/extra/centroid)"
```

---

### Task C6-3: country_index.js — loadCountryBounds（一度fetch→loadPolygons→キャッシュ・fetchFn DI）

**Files:**
- Modify: `js/lib/drilldown/country_index.js`
- Test: `tests/drilldown_country_data.test.js`（追記）

**Interfaces:**
- Produces: `loadCountryBounds(fetchFn) -> Promise<polys>`（`polys` は `loadPolygons` の戻り `[{code,name,name_ja,bbox,rings}]`）。`fetchFn` は DI（既定 `globalThis.fetch`）。`data/static/country_bounds.geojson` を一度だけ fetch しモジュール内変数にキャッシュ。2回目以降は同 Promise を返す。
- Consumes: `loadPolygons(geojson, {codeKey})`（`js/lib/drilldown/geo_poly.js`）

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_data.test.js` の末尾に以下を追記する。

```js
import { loadCountryBounds, __resetCountryIndexCache } from '../js/lib/drilldown/country_index.js';

const BOUNDS_FC = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: 'JA', name: 'Japan' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    },
  ],
};

function fakeFetch(payload) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    return { ok: true, json: async () => payload };
  };
  fn.callCount = () => calls;
  return fn;
}

test('loadCountryBounds: fetch→loadPolygons し code/rings を持つ polys を返す', async () => {
  __resetCountryIndexCache();
  const ff = fakeFetch(BOUNDS_FC);
  const polys = await loadCountryBounds(ff);
  assert.equal(polys.length, 1);
  assert.equal(polys[0].code, 'JA');
  assert.ok(Array.isArray(polys[0].rings));
  assert.ok(Array.isArray(polys[0].bbox) && polys[0].bbox.length === 4);
});

test('loadCountryBounds: 2回目は再 fetch せずキャッシュを返す', async () => {
  __resetCountryIndexCache();
  const ff = fakeFetch(BOUNDS_FC);
  const a = await loadCountryBounds(ff);
  const b = await loadCountryBounds(ff);
  assert.equal(a, b, '同一参照（キャッシュ）');
  assert.equal(ff.callCount(), 1, 'fetch は一度だけ');
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: FAIL（`loadCountryBounds` / `__resetCountryIndexCache` 未 export で import 失敗）。

- [ ] **Step 3: 最小実装**

`js/lib/drilldown/country_index.js` の import 行直後（`const CENTER_BY_FIPS` の前）に定数とキャッシュ変数を追加する。まず import 行を以下に置き換える。

```js
import { loadPolygons, locateFeature } from './geo_poly.js';
import { COUNTRIES } from '../gazetteer.js';
```

次にファイル末尾に以下を追記する。

```js
// country_bounds.geojson の正規化済 polys を一度だけ作りキャッシュ（client FIPS 解決の一次ソース）。
const COUNTRY_BOUNDS_URL = 'data/static/country_bounds.geojson';
let _boundsPromise = null;

export function loadCountryBounds(fetchFn) {
  if (_boundsPromise) return _boundsPromise;
  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  _boundsPromise = (async () => {
    const res = await f(COUNTRY_BOUNDS_URL);
    if (!res || !res.ok) throw new Error(`country_bounds ${res ? res.status : 'no-response'}`);
    const geojson = await res.json();
    return loadPolygons(geojson, { codeKey: 'code' });
  })();
  return _boundsPromise;
}

// テスト用: モジュール内キャッシュを破棄（本番コードからは呼ばない）。
export function __resetCountryIndexCache() {
  _boundsPromise = null;
}
```

注: `locateFeature` の import は Task C6-9（country_click の resolveFipsAt）で使うため先に追加しておく（このタスクでは未使用だが eslint は no-unused でも落ちない構成）。

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（loadCountryBounds の2テスト＋既存テストが緑）。

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/country_index.js tests/drilldown_country_data.test.js
git commit -m "drilldown: add loadCountryBounds with fetchFn DI and module cache"
```

---

### Task C6-4: country_data.js — loadCountryGeo の manifest 事前判定（extra/欠落→degraded 空配列）

**Files:**
- Create: `js/lib/drilldown/country_data.js`
- Test: `tests/drilldown_country_data.test.js`（追記）

**Interfaces:**
- Produces: `loadCountryGeo(fips, {signal, timeoutMs=8000, manifest, fetchFn}={}) -> Promise<{admin1, cities, degraded:boolean}>`
  - `manifest` は drilldown_manifest.json 相当 `{<fips>: {admin1Bytes, citiesBytes, countryBbox}, extra: {<fips>: {lon,lat,margin}}}`。当該 FIPS が manifest に admin1 エントリを持たない（= EXTRA68 / 未生成）なら **fetch せず** `{admin1:{features:[]}, cities:[], degraded:true}`。
- Consumes: なし（純 I/O 境界。fetch は DI）

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_data.test.js` の末尾に以下を追記する。

```js
import { loadCountryGeo, __resetCountryDataCache } from '../js/lib/drilldown/country_data.js';

const MANIFEST = {
  JA: { admin1Bytes: 12345, citiesBytes: 2222, countryBbox: [122, 24, 154, 46] },
  extra: { IS: { lon: 34.95, lat: 31.45, margin: 1.5 } },
};

test('loadCountryGeo: manifest に admin1 が無い(extra)なら fetch せず degraded 空', async () => {
  __resetCountryDataCache();
  let fetched = false;
  const fetchFn = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  const r = await loadCountryGeo('IS', { manifest: MANIFEST, fetchFn });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.admin1, { type: 'FeatureCollection', features: [] });
  assert.deepEqual(r.cities, []);
  assert.equal(fetched, false, 'fetch を呼ばない');
});

test('loadCountryGeo: manifest に存在しない FIPS も fetch せず degraded 空', async () => {
  __resetCountryDataCache();
  let fetched = false;
  const fetchFn = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  const r = await loadCountryGeo('ZZ', { manifest: MANIFEST, fetchFn });
  assert.equal(r.degraded, true);
  assert.equal(fetched, false);
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: FAIL（`../js/lib/drilldown/country_data.js` が無く import 失敗）。

- [ ] **Step 3: 最小実装**

`js/lib/drilldown/country_data.js` を新規作成し、以下を全文で書く。

```js
// 国ドリルダウンの遅延データ取得層（DI seam）。
// manifest 事前判定 → 相対 fetch（data/static は data-source.js 非対象＝常に相対 Vercel 配信）
// → AbortController + timeout → 失敗/欠落は degraded:true で空配列。
// 同一 FIPS の in-flight Promise 共有 ＋ 成功 Map キャッシュ。
const ADMIN1_URL = (fips) => `data/static/admin1/${fips}.geojson`;
const CITIES_URL = (fips) => `data/static/cities/${fips}.json`;

const EMPTY_FC = () => ({ type: 'FeatureCollection', features: [] });
const _inflight = new Map(); // fips -> Promise
const _cache = new Map();    // fips -> {admin1, cities, degraded}

function _hasAdmin1(manifest, fips) {
  if (!manifest) return false;
  const m = manifest[fips];
  return !!(m && m.admin1Bytes != null);
}

export function loadCountryGeo(fips, { signal, timeoutMs = 8000, manifest, fetchFn } = {}) {
  if (_cache.has(fips)) return Promise.resolve(_cache.get(fips));
  if (_inflight.has(fips)) return _inflight.get(fips);

  // manifest 事前判定: admin1 エントリが無い(EXTRA68/未生成) → fetch せず degraded 空。
  if (!_hasAdmin1(manifest, fips)) {
    const degraded = { admin1: EMPTY_FC(), cities: [], degraded: true };
    return Promise.resolve(degraded);
  }

  const f = fetchFn || (typeof fetch !== 'undefined' ? fetch : null);
  const p = (async () => {
    try {
      const result = await _fetchGeo(fips, f, signal, timeoutMs);
      _cache.set(fips, result);
      return result;
    } finally {
      _inflight.delete(fips);
    }
  })();
  _inflight.set(fips, p);
  return p;
}

async function _fetchGeo(fips, f, signal, timeoutMs) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const [admin1Res, citiesRes] = await Promise.all([
      f(ADMIN1_URL(fips), { signal: ctl.signal }),
      f(CITIES_URL(fips), { signal: ctl.signal }),
    ]);
    if (!admin1Res || !admin1Res.ok) throw new Error('admin1 fetch failed');
    const admin1 = await admin1Res.json();
    let cities = [];
    if (citiesRes && citiesRes.ok) {
      const c = await citiesRes.json();
      if (Array.isArray(c)) cities = c;
    }
    return { admin1, cities, degraded: false };
  } catch {
    return { admin1: EMPTY_FC(), cities: [], degraded: true };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

// テスト用: in-flight/成功キャッシュを破棄（本番コードからは呼ばない）。
export function __resetCountryDataCache() {
  _inflight.clear();
  _cache.clear();
}
```

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（manifest 事前判定の2テスト＋既存テストが緑）。

- [ ] **Step 5: commit**

```
git add js/lib/drilldown/country_data.js tests/drilldown_country_data.test.js
git commit -m "drilldown: add loadCountryGeo manifest gate (extra/missing -> degraded)"
```

---

### Task C6-5: country_data.js — 成功 fetch / 失敗(degraded) / abort(timeout) / in-flight 共有 / 成功キャッシュ

**Files:**
- Modify: なし（実装は C6-4 で完了済み。本タスクは振る舞いをテストで固定する）
- Test: `tests/drilldown_country_data.test.js`（追記）

**Interfaces:**
- Produces: 変更なし（`loadCountryGeo` の契約をテストで固定）
- Consumes: なし

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_data.test.js` の末尾に以下を追記する。

```js
const MANIFEST_JA = { JA: { admin1Bytes: 10, citiesBytes: 10, countryBbox: [122, 24, 154, 46] } };
const ADMIN1_JA = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a1code: 'JA-13', name_ja: '東京都' }, geometry: { type: 'Polygon', coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] } }] };
const CITIES_JA = [{ name: 'Tokyo', name_ja: '東京', lon: 139.69, lat: 35.69, pop: 37000000 }];

function urlRouter(map) {
  let count = 0;
  const fn = async (url) => {
    count += 1;
    for (const [needle, payload] of map) {
      if (url.includes(needle)) {
        if (payload === 'fail') return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.callCount = () => count;
  return fn;
}

test('loadCountryGeo: 成功 fetch で admin1/cities を返し degraded=false', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', ADMIN1_JA], ['cities/JA', CITIES_JA]]);
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.equal(r.degraded, false);
  assert.equal(r.admin1.features.length, 1);
  assert.deepEqual(r.cities, CITIES_JA);
});

test('loadCountryGeo: admin1 が 404 なら degraded:true 空配列', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', 'fail'], ['cities/JA', CITIES_JA]]);
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.admin1, { type: 'FeatureCollection', features: [] });
  assert.deepEqual(r.cities, []);
});

test('loadCountryGeo: timeout(abort) で degraded:true', async () => {
  __resetCountryDataCache();
  // fetch が AbortSignal で reject する fake（timeoutMs=0 で即 abort）。
  const fetchFn = (url, opts) => new Promise((_resolve, reject) => {
    const s = opts && opts.signal;
    if (s) s.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  });
  const r = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn, timeoutMs: 0 });
  assert.equal(r.degraded, true);
  assert.deepEqual(r.cities, []);
});

test('loadCountryGeo: in-flight 共有（連打で fetch 一度）＋成功キャッシュ', async () => {
  __resetCountryDataCache();
  const fetchFn = urlRouter([['admin1/JA', ADMIN1_JA], ['cities/JA', CITIES_JA]]);
  const [a, b] = await Promise.all([
    loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn }),
    loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn }),
  ]);
  assert.deepEqual(a, b);
  assert.equal(fetchFn.callCount(), 2, 'admin1+cities の2回のみ（in-flight 共有で重複なし）');
  // キャッシュ済 → 追加 fetch なし
  const c = await loadCountryGeo('JA', { manifest: MANIFEST_JA, fetchFn });
  assert.deepEqual(c, a);
  assert.equal(fetchFn.callCount(), 2, 'キャッシュヒットで追加 fetch なし');
});
```

- [ ] **Step 2: 失敗を実行で確認**

実装は C6-4 で済んでいるが、in-flight 共有・キャッシュの境界が崩れていれば落ちる。まず全テストを流す。

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（C6-4 の実装が正しければ全件緑）。もし FAIL する場合は `loadCountryGeo` の in-flight/キャッシュ実装の不備なので C6-4 の実装を該当テストが緑になるまで修正する（このタスク内で完結させる）。

- [ ] **Step 3: 最小実装**

C6-4 の実装で全テスト緑なら追加実装は不要。FAIL があった場合のみ `js/lib/drilldown/country_data.js` を最小修正する（例: in-flight 削除タイミングを `finally` に保つ／`_cache.set` を成功時のみにする）。本タスクの目標状態は「上記4テストが緑」。

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_data.test.js
```

Expected: PASS（country_data の全テスト＋country_index の全テストが緑）。

- [ ] **Step 5: commit**

```
git add tests/drilldown_country_data.test.js js/lib/drilldown/country_data.js
git commit -m "drilldown: lock loadCountryGeo success/degraded/abort/in-flight behaviors"
```

---

### Task C6-6: country_click.js — initCountryClick スケルトン＋resolveFipsAt（海洋null・国内FIPS）

**Files:**
- Create: `js/ui/country_click.js`
- Test: `tests/drilldown_country_click.test.js`（新規。Task C6-6〜C6-10 はこの1ファイルに追記）

**Interfaces:**
- Produces: `initCountryClick({map, getSnapshots, deps}) -> {resolveFipsAt(lon,lat,boundsPolys)->fips|null, handleMapClick(e), openCountry(fips,anchorLngLat)->Promise<void>, closeCountry()->void, noteDeckPick(lngLat)->void}`
  - `resolveFipsAt(lon, lat, boundsPolys)`: `locateFeature(lon,lat,boundsPolys)` がヒットすれば `poly.code`、miss（海洋/極域）は `null`。
- Consumes: `locateFeature(lon, lat, polys) -> poly|null`（`js/lib/drilldown/geo_poly.js`）

- [ ] **Step 1: 失敗テストを書く**

`tests/drilldown_country_click.test.js` を新規作成し、以下を全文で書く。

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initCountryClick } from '../js/ui/country_click.js';

// loadPolygons 形の最小 polys（geo_poly の loadPolygons 出力 = {code,name,name_ja,bbox,rings}）。
// 0..2 の正方形を JA とする。
const POLYS = [
  { code: 'JA', name: 'Japan', name_ja: '日本', bbox: [0, 0, 2, 2], rings: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
];

function fakeMap() {
  return {
    handlers: {},
    on(ev, fn) { this.handlers[ev] = fn; },
    resize() { this.resized = (this.resized || 0) + 1; },
    flyTo(opts) { this.flewTo = opts; },
  };
}

function baseDeps(over = {}) {
  return {
    fetchFn: async () => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [] }) }),
    loadCountryGeo: async () => ({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }),
    buildDrilldown: () => ({ header: {}, regions: [], events: [], degraded: true }),
    renderDrilldown: () => {},
    setDrilldownState: () => {},
    zoomForBbox: () => 4,
    countryBbox: () => [0, 0, 2, 2],
    rootEl: { classList: { add() {}, remove() {} } },
    bodyEl: { classList: { add() {}, remove() {} } },
    manifest: { JA: { admin1Bytes: 1, citiesBytes: 1, countryBbox: [0, 0, 2, 2] } },
    onSelectEvent: () => {},
    ...over,
  };
}

test('resolveFipsAt: 国内点は FIPS を返す', () => {
  const api = initCountryClick({ map: fakeMap(), getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(api.resolveFipsAt(1, 1, POLYS), 'JA');
});

test('resolveFipsAt: 海洋/極域(miss)は null', () => {
  const api = initCountryClick({ map: fakeMap(), getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(api.resolveFipsAt(50, 50, POLYS), null);
});

test('initCountryClick: map.on("click") を登録する', () => {
  const map = fakeMap();
  initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps() });
  assert.equal(typeof map.handlers.click, 'function');
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: FAIL（`../js/ui/country_click.js` が無く import 失敗）。

- [ ] **Step 3: 最小実装**

`js/ui/country_click.js` を新規作成し、以下を全文で書く。

```js
// 国クリックのオーケストレータ（DI seam）。MapLibre 生の map.on('click') を受け、
// deck pick 排他 → client ray-casting で FIPS 解決 → country_data 遅延取得 → buildDrilldown → renderDrilldown → flyTo。
// map / fetch / 集計 / render は全て deps 注入し、テスト時 fake 可能にする。
import { locateFeature } from '../lib/drilldown/geo_poly.js';

// deck pick と map.on('click') の二重発火を抑える二重判定のしきい値。
const DECK_PICK_WINDOW_MS = 350;
const DECK_PICK_NEAR_DEG = 0.5;

export function initCountryClick({ map, getSnapshots, deps }) {
  let boundsPolys = null;          // loadCountryBounds 済 polys（openCountry 前に注入される）
  let deckPick = null;             // {lng, lat, at}
  let token = 0;                   // selection レース破棄トークン

  function noteDeckPick(lngLat) {
    deckPick = { lng: lngLat.lng != null ? lngLat.lng : lngLat[0], lat: lngLat.lat != null ? lngLat.lat : lngLat[1], at: nowMs() };
  }

  function resolveFipsAt(lon, lat, polys) {
    const hit = locateFeature(lon, lat, polys || boundsPolys || []);
    return hit ? hit.code : null;
  }

  function _deckJustPicked(lng, lat) {
    if (!deckPick) return false;
    if (nowMs() - deckPick.at > DECK_PICK_WINDOW_MS) return false;
    return Math.abs(deckPick.lng - lng) <= DECK_PICK_NEAR_DEG && Math.abs(deckPick.lat - lat) <= DECK_PICK_NEAR_DEG;
  }

  async function handleMapClick(e) {
    const lng = e && e.lngLat ? e.lngLat.lng : null;
    const lat = e && e.lngLat ? e.lngLat.lat : null;
    if (lng == null || lat == null) return;
    if (_deckJustPicked(lng, lat)) return;         // deck が同フレームで pick 済 → 抑制
    const fips = resolveFipsAt(lng, lat, boundsPolys || []);
    if (!fips) {                                    // 海洋/極域 → パネル開かずトースト
      if (deps.onOceanMiss) deps.onOceanMiss();
      return;
    }
    await openCountry(fips, [lng, lat]);
  }

  async function openCountry(fips, anchorLngLat) {
    const myToken = ++token;
    if (deps.bodyEl) deps.bodyEl.classList.add('drill-open');
    if (map && map.resize) map.resize();
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, 'loading');
    const geo = await deps.loadCountryGeo(fips, { manifest: deps.manifest, fetchFn: deps.fetchFn });
    if (myToken !== token) return;                  // レース破棄（別国クリックが後勝ち）
    const model = deps.buildDrilldown({
      fips,
      snapshots: getSnapshots(),
      countryPolys: boundsPolys || [],
      admin1Polys: deps.loadPolygonsFn ? deps.loadPolygonsFn(geo.admin1) : (geo.admin1Polys || []),
      cities: geo.cities,
      instabilityCountry: deps.getInstabilityCountry ? deps.getInstabilityCountry(fips) : null,
      forecastCards: deps.getForecastCards ? deps.getForecastCards(fips) : [],
    });
    if (myToken !== token) return;
    if (deps.renderDrilldown) {
      deps.renderDrilldown(deps.rootEl, model, {
        onSelect: (ev) => { if (deps.onSelectEvent) deps.onSelectEvent(ev); },
        onClose: () => closeCountry(),
        onWatchToggle: (code) => { if (deps.onWatchToggle) deps.onWatchToggle(code); },
      });
    }
    if (deps.setDrilldownState) deps.setDrilldownState(deps.rootEl, geo.degraded ? 'error' : 'ready');
    const bbox = deps.countryBbox(fips, deps.bboxIndex);
    const center = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
    if (map && map.flyTo) {
      map.flyTo({ center, zoom: deps.zoomForBbox(bbox), duration: 1500, essential: true });
    }
  }

  function closeCountry() {
    token += 1;                                     // 進行中 open を無効化
    if (deps.bodyEl) deps.bodyEl.classList.remove('drill-open');
    if (map && map.resize) map.resize();
  }

  function setBoundsPolys(polys) { boundsPolys = polys; }

  if (map && map.on) map.on('click', handleMapClick);

  return { resolveFipsAt, handleMapClick, openCountry, closeCountry, noteDeckPick, setBoundsPolys };
}

function nowMs() {
  return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}
```

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（resolveFipsAt 2件＋map.on 登録 1件が緑）。

- [ ] **Step 5: commit**

```
git add js/ui/country_click.js tests/drilldown_country_click.test.js
git commit -m "drilldown: add initCountryClick skeleton + resolveFipsAt (ocean->null)"
```

---

### Task C6-7: country_click.js — handleMapClick の deck pick 排他（時刻＋座標の二重判定）

**Files:**
- Modify: なし（実装は C6-6 完了済み。本タスクは排他の境界をテストで固定）
- Test: `tests/drilldown_country_click.test.js`（追記）

**Interfaces:**
- Produces: 変更なし（`noteDeckPick` / `handleMapClick` の排他契約を固定）
- Consumes: なし

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_click.test.js` の末尾に以下を追記する。

```js
test('handleMapClick: deck pick 直後＆近接座標なら openCountry を抑制', async () => {
  const map = fakeMap();
  let opened = 0;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({ loadCountryGeo: async () => { opened += 1; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; } }),
  });
  api.setBoundsPolys(POLYS);
  api.noteDeckPick({ lng: 1, lat: 1 });            // deck が (1,1) を pick
  await api.handleMapClick({ lngLat: { lng: 1.05, lat: 1.05 } }); // 近接 → 抑制
  assert.equal(opened, 0, 'loadCountryGeo を呼ばない（抑制）');
});

test('handleMapClick: deck pick から離れた座標なら抑制せず開く', async () => {
  const map = fakeMap();
  let openedFips = null;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({ loadCountryGeo: async (fips) => { openedFips = fips; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; } }),
  });
  api.setBoundsPolys(POLYS);
  api.noteDeckPick({ lng: 1, lat: 1 });
  await api.handleMapClick({ lngLat: { lng: 1.6, lat: 1.6 } }); // 0.5度超え → 抑制しない・国内 → JA
  assert.equal(openedFips, 'JA');
});

test('handleMapClick: 海洋クリックは onOceanMiss を呼びパネルを開かない', async () => {
  const map = fakeMap();
  let missed = 0;
  let opened = 0;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({
      onOceanMiss: () => { missed += 1; },
      loadCountryGeo: async () => { opened += 1; return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }; },
    }),
  });
  api.setBoundsPolys(POLYS);
  await api.handleMapClick({ lngLat: { lng: 50, lat: 50 } }); // 海洋
  assert.equal(missed, 1);
  assert.equal(opened, 0);
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（C6-6 の実装が正しければ緑）。FAIL する場合は `_deckJustPicked` のしきい値判定 or `handleMapClick` の分岐を該当テストが緑になるまで修正する（このタスク内で完結）。

- [ ] **Step 3: 最小実装**

C6-6 の実装で全テスト緑なら追加実装は不要。FAIL があった場合のみ `js/ui/country_click.js` の `_deckJustPicked` / `handleMapClick` を最小修正する。目標状態は「上記3テストが緑」。

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（排他3テスト＋C6-6 の3テストが緑）。

- [ ] **Step 5: commit**

```
git add tests/drilldown_country_click.test.js js/ui/country_click.js
git commit -m "drilldown: lock deck-pick exclusion (time+coord) in handleMapClick"
```

---

### Task C6-8: country_click.js — openCountry のフロー（drill-open→resize→loadCountryGeo→buildDrilldown→renderDrilldown→flyTo）

**Files:**
- Modify: なし（実装は C6-6 完了済み。本タスクは openCountry の配線をテストで固定）
- Test: `tests/drilldown_country_click.test.js`（追記）

**Interfaces:**
- Produces: 変更なし（`openCountry` の副作用順序と引数受け渡しを固定）
- Consumes: `buildDrilldown(...)`・`zoomForBbox(bbox)`・`countryBbox(fips, bboxIndex)`・`renderDrilldown(...)`・`setDrilldownState(...)`（全て deps 注入）

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_click.test.js` の末尾に以下を追記する。

```js
test('openCountry: drill-open 付与→resize→loadCountryGeo→buildDrilldown→renderDrilldown→flyTo', async () => {
  const map = fakeMap();
  const order = [];
  const bodyEl = { classList: { add: (c) => order.push(`body+${c}`), remove: () => {} } };
  const api = initCountryClick({
    map,
    getSnapshots: () => ({ quakes: { features: [] } }),
    deps: baseDeps({
      bodyEl,
      loadCountryGeo: async (fips, opts) => { order.push(`load:${fips}`); assert.equal(opts.manifest.JA.admin1Bytes, 1); return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false }; },
      buildDrilldown: (arg) => { order.push('build'); assert.equal(arg.fips, 'JA'); assert.deepEqual(arg.snapshots, { quakes: { features: [] } }); return { header: { name_ja: '日本' }, regions: [], events: [], degraded: false }; },
      renderDrilldown: (rootEl, model) => { order.push('render'); assert.equal(model.header.name_ja, '日本'); },
      setDrilldownState: (rootEl, state) => order.push(`state:${state}`),
      countryBbox: () => [120, 20, 150, 46],
      zoomForBbox: (bbox) => { assert.deepEqual(bbox, [120, 20, 150, 46]); return 4.2; },
    }),
  });
  api.setBoundsPolys(POLYS);
  await api.openCountry('JA', [135, 36]);
  assert.deepEqual(order, ['body+drill-open', 'state:loading', 'load:JA', 'build', 'render', 'state:ready']);
  // flyTo は bbox 中心へ・zoom は zoomForBbox の返り値
  assert.deepEqual(map.flewTo.center, [(120 + 150) / 2, (20 + 46) / 2]);
  assert.equal(map.flewTo.zoom, 4.2);
  assert.equal(map.flewTo.essential, true);
  assert.ok(map.resized >= 1, 'map.resize が呼ばれた');
});

test('openCountry: degraded geo は state を error にする', async () => {
  const map = fakeMap();
  let lastState = null;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({
      loadCountryGeo: async () => ({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: true }),
      setDrilldownState: (rootEl, state) => { lastState = state; },
    }),
  });
  api.setBoundsPolys(POLYS);
  await api.openCountry('JA', [135, 36]);
  assert.equal(lastState, 'error');
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（C6-6 の openCountry 実装が正しければ緑）。FAIL する場合は副作用順序を該当テストが緑になるまで `openCountry` 内で調整する。

- [ ] **Step 3: 最小実装**

C6-6 の実装で全テスト緑なら追加実装は不要。FAIL があった場合のみ `js/ui/country_click.js` の `openCountry` の呼び出し順を上記テスト期待値（`body+drill-open` → `state:loading` → `load` → `build` → `render` → `state:ready`）に合わせて最小修正する。目標状態は「上記2テストが緑」。

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（openCountry 2テスト＋既存テストが緑）。

- [ ] **Step 5: commit**

```
git add tests/drilldown_country_click.test.js js/ui/country_click.js
git commit -m "drilldown: lock openCountry flow order and flyTo bbox/zoom"
```

---

### Task C6-9: country_click.js — selection token レース破棄＋closeCountry

**Files:**
- Modify: なし（実装は C6-6 完了済み。本タスクはレース破棄と closeCountry をテストで固定）
- Test: `tests/drilldown_country_click.test.js`（追記）

**Interfaces:**
- Produces: 変更なし（`openCountry` のトークン破棄・`closeCountry` の drill-open 解除を固定）
- Consumes: なし

- [ ] **Step 1: 失敗テストを追記**

`tests/drilldown_country_click.test.js` の末尾に以下を追記する。

```js
test('openCountry: fetch 中に別国 open が来たら先行 open の render を破棄', async () => {
  const map = fakeMap();
  const rendered = [];
  let resolveFirst;
  const api = initCountryClick({
    map,
    getSnapshots: () => ({}),
    deps: baseDeps({
      loadCountryGeo: async (fips) => {
        if (fips === 'JA') return new Promise((res) => { resolveFirst = () => res({ admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false }); });
        return { admin1: { type: 'FeatureCollection', features: [] }, cities: [], degraded: false };
      },
      buildDrilldown: ({ fips }) => ({ header: { fips }, regions: [], events: [], degraded: false }),
      renderDrilldown: (rootEl, model) => rendered.push(model.header.fips),
    }),
  });
  api.setBoundsPolys(POLYS);
  const p1 = api.openCountry('JA', [135, 36]);   // 先行（保留中）
  const p2 = api.openCountry('US', [-95, 37]);   // 後勝ち（即解決）
  await p2;
  resolveFirst();                                 // 先行が後から解決
  await p1;
  assert.deepEqual(rendered, ['US'], '後勝ちの US のみ render・先行 JA は token 不一致で破棄');
});

test('closeCountry: drill-open を解除し resize する', () => {
  const map = fakeMap();
  let removed = null;
  const bodyEl = { classList: { add: () => {}, remove: (c) => { removed = c; } } };
  const api = initCountryClick({ map, getSnapshots: () => ({}), deps: baseDeps({ bodyEl }) });
  api.closeCountry();
  assert.equal(removed, 'drill-open');
  assert.ok(map.resized >= 1);
});
```

- [ ] **Step 2: 失敗を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（C6-6 の token / closeCountry 実装が正しければ緑）。FAIL する場合は `openCountry` の `myToken !== token` ガードと `closeCountry` の `token += 1` を該当テストが緑になるまで修正する。

- [ ] **Step 3: 最小実装**

C6-6 の実装で全テスト緑なら追加実装は不要。FAIL があった場合のみ `js/ui/country_click.js` の token 管理を修正する。目標状態は「上記2テストが緑」。

- [ ] **Step 4: 成功を実行で確認**

```
node --test tests/drilldown_country_click.test.js
```

Expected: PASS（レース破棄＋closeCountry の2テスト＋既存テストが緑）。

- [ ] **Step 5: commit**

```
git add tests/drilldown_country_click.test.js js/ui/country_click.js
git commit -m "drilldown: lock selection-token race discard and closeCountry"
```

---

### Task C6-10: クラスタ C6 全体回帰（country_data＋country_click 両テストと既存 baseline 緑確認）

**Files:**
- Modify: なし
- Test: `tests/drilldown_country_data.test.js`・`tests/drilldown_country_click.test.js`

**Interfaces:**
- Produces: なし（回帰ゲート）
- Consumes: なし

- [ ] **Step 1: C6 の2テストファイルだけを通す**

```
node --test tests/drilldown_country_data.test.js tests/drilldown_country_click.test.js
```

Expected: PASS（country_index/country_data/country_click の全テストが緑・0 fail）。

- [ ] **Step 2: 既存 baseline を壊していないか全テストで確認**

```
node --test tests/*.test.js
```

Expected: PASS（baseline 352 pass ＋ 本クラスタ追加分が緑・既存テストの fail 0）。注: C1/C2/C4/C7 のクラスタが未マージのまま単独で本クラスタだけ流す場合、`geo_poly.js`/`zoom_for_bbox.js`/`aggregate_admin1.js`/`ui/drilldown.js` の実体が無いと country_index.js / country_click.js の import が解決できず FAIL する。その場合は依存クラスタのマージ後に再実行する（assembler が依存順 order=6 で配置）。

- [ ] **Step 3: 実装コードに未解決の依存 import が無いか確認**

```
node --input-type=module -e "import('./js/lib/drilldown/country_index.js').then(()=>console.log('country_index OK')).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: PASS（`country_index OK` を出力。依存 `geo_poly.js`/`gazetteer.js` が解決できれば成功。未解決なら依存クラスタ未マージ）。

- [ ] **Step 4: 同様に country_click の import を確認**

```
node --input-type=module -e "import('./js/ui/country_click.js').then(()=>console.log('country_click OK')).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: PASS（`country_click OK`。依存 `geo_poly.js` が解決できれば成功）。

- [ ] **Step 5: commit（回帰確認の証跡。コード変更が無ければ空コミットはしない）**

このタスクはコード変更を伴わない回帰ゲートのため、Step 1〜4 が全て PASS したら追加コミットは作らない。もし Step 2〜4 で発覚した不備を修正した場合のみ、修正ファイルを以下でコミットする。

```
git add js/lib/drilldown/country_index.js js/lib/drilldown/country_data.js js/ui/country_click.js
git commit -m "drilldown: fix C6 I/O boundary regressions surfaced by full test run"
```

---

## クラスタ C7 — render＋配線＋SW (ui/drilldown.js / main.js / index.html / orbis.css / sw.js)

## クラスタ C7: render（ui/drilldown.js）＋配線（index.html / main.js）＋CSS 非重畳 split ＋ SW v45

このクラスタは Phase2 国ドリルダウンの「描画＋配線」層を担う。純 HTML ビルダ（`drilldown_view.js`）・集計（`aggregate_admin1.js`）・オーケストレータ（`ui/country_click.js`）は別クラスタが提供する前提で、本クラスタは (1) それらの純 HTML を DOM に差し込み onSelect/onClose/onWatchToggle を配線する render 層（`js/ui/drilldown.js`・node:test 対象）と、(2) index.html / main.js / css / sw.js への最小差分配線を作る。

**配線の事実（実コード検証済・憶測排除）**:
- `js/main.js:58` の `const snapshots = {}` は module-local。`window.__orbis`（`js/main.js:366`）には載らない。→ `getSnapshots:()=>snapshots` の DI クロージャで `initCountryClick` に渡す。
- `js/main.js:321-322` の deck onClick は冒頭 `if (!info || !info.object || !info.layer) return;`。国クリック（空振り）はここで拾えない。→ `map.on('click', ...)` 別系統で受け、deck が pick した直後は排他フラグで抑制する。本クラスタは deck onClick 内で `deckPicked` フラグ（時刻＋座標）を更新し、`deps.getDeckPick` で `country_click` に読ませる。
- `css/orbis.css:22-23`: `#map-wrap{position:relative;height:100vh}` / `#map{position:absolute;inset:0;z-index:1}`。absolute inset:0 は grid セルで縮まない。→ `body.drill-open` 時に `#map` のみ `position:static;inset:auto` へ上書きして grid セルに収める。他オーバーレイ（#starfield/#freshness/#panel/#feed/#legend）は `position:absolute` のまま `#map-wrap` 基準を維持＝連鎖崩れしない。
- backdrop-filter / glass は `#drilldown` で一切使わない（不透明 `#070b14`）＝square-blur-bleed が原理的に発生しない。
- render 層のテストは repo 既存の DOM スタブ idiom（`tests/live-captions.test.js:27` の `makeDoc()`）を踏襲し、jsdom 等の新規依存を入れない。HTML ビルダ自体は別クラスタの `tests/drilldown_view.test.js` が検証するので、本クラスタのテストは「配線」（state クラス遷移・行ボタン生成数・onSelect/onClose/onWatchToggle/onRemove の発火・座標なし行 disabled）に集中する。

---

### Task C7-1: renderDrilldown + setDrilldownState（render 層・DOM スタブ TDD）

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/ui/drilldown.js`
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_render.test.js`

**Interfaces:**
- Produces: `renderDrilldown(rootEl, model, {onSelect, onClose, onWatchToggle}) -> void` / `setDrilldownState(rootEl, state) -> void`（state in `'loading'|'error'|'ready'`）
- Consumes（同クラスタ Task C7-3 で index.html に置く DOM 構造）: rootEl は `<aside id="drilldown">` で、子に `.dd-head`（内 `.dd-title` / `.dd-watch` ボタン / `.dd-close` ボタン）・`.dd-state`・`.dd-body`・`.dd-watchlist`（内 `.dd-wl-list`）を持つ。
- Consumes（別クラスタ提供・本タスクのテストでは DI で差し替え）: `drilldownHeaderHtml(header)->string` / `regionRowHtml(region)->string` / `eventLineHtml(ev)->string` / `degradedNoticeHtml(kind)->string`。本 render 層はこれらを **import して使う**（`js/lib/drilldown/drilldown_view.js`）。テストでは実装をモック注入できないため、render 層は HTML ビルダを `import` した薄い差込に留め、テストは「ビルダ出力がそのまま innerHTML に入る」ことではなく「行ボタンの個数・配線・disabled・state クラス」を検証する（ビルダの中身検証は別クラスタの責務）。

> 注意: render 層は `drilldown_view.js` を直接 import するため、本タスクのテストを単独で緑にするには `drilldown_view.js` が既に存在している必要がある（依存順 C5 → C7）。assembler は本クラスタを C5（drilldown_view）の後に並べる。テスト内では `drilldown_view` の実関数を呼ぶが、出力 HTML の中身は問わず（`typeof === 'string'` で差し込まれる事実のみ）行ボタン生成・配線を検証する。

- [ ] **Step 1: 失敗テストを書く（DOM スタブ＋配線検証）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_render.test.js` を新規作成:

```javascript
// tests/drilldown_render.test.js
// render 層（js/ui/drilldown.js）の配線検証。HTML ビルダの中身は別テスト（drilldown_view）が担保するので、
// ここは state クラス遷移・行ボタン生成数・onSelect/onClose/onWatchToggle/onRemove 発火・座標なし行 disabled に集中。
// repo 既存の DOM スタブ idiom（tests/live-captions.test.js の makeDoc）を踏襲し新規依存を入れない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDrilldown, setDrilldownState, renderWatchlist } from '../js/ui/drilldown.js';

// --- 最小 DOM シム（render 層が触るサーフェスのみ） ---
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _className: '',
    _innerHTML: '',
    textContent: '',
    hidden: false,
    disabled: false,
    type: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    _classes: new Set(),
    _listeners: {},
    get className() { return this._className; },
    set className(v) {
      this._className = String(v);
      this._classes = new Set(this._className.split(/\s+/).filter(Boolean));
    },
    classList: {
      add: (...cs) => { cs.forEach((c) => el._classes.add(c)); el._className = [...el._classes].join(' '); },
      remove: (...cs) => { cs.forEach((c) => el._classes.delete(c)); el._className = [...el._classes].join(' '); },
      contains: (c) => el._classes.has(c),
      toggle: (c, on) => { const want = on === undefined ? !el._classes.has(c) : !!on; if (want) el._classes.add(c); else el._classes.delete(c); el._className = [...el._classes].join(' '); return want; },
    },
    get innerHTML() { return el._innerHTML; },
    set innerHTML(v) { el._innerHTML = String(v); el.children = []; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = el; el.children.push(child); return child;
    },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) { el.children.splice(i, 1); child.parentNode = null; }
      return child;
    },
    addEventListener(type, fn) { (el._listeners[type] ||= []).push(fn); },
    // テスト用: 登録済みの click ハンドラを発火
    click() { (el._listeners.click || []).forEach((fn) => fn({ type: 'click' })); },
    // class / id による子孫検索（render 層が使う最小機能のみ）
    querySelector(sel) { return el._find((c) => el._matches(c, sel)) || null; },
    querySelectorAll(sel) { const out = []; el._walk((c) => { if (el._matches(c, sel)) out.push(c); }); return out; },
    _matches(node, sel) {
      if (sel.startsWith('.')) return node._classes.has(sel.slice(1));
      if (sel.startsWith('#')) return node.id === sel.slice(1);
      return node.tagName === sel.toUpperCase();
    },
    _walk(visit) { for (const c of el.children) { visit(c); if (c._walk) c._walk(visit); } },
    _find(pred) { for (const c of el.children) { if (pred(c)) return c; if (c._find) { const r = c._find(pred); if (r) return r; } } return null; },
  };
  return el;
}

// #drilldown 相当の root を組み立てる（index.html の DOM 構造を模す）。
function makeRoot() {
  const root = makeEl('aside'); root.id = 'drilldown';
  const head = makeEl('div'); head.className = 'dd-head';
  const title = makeEl('h4'); title.className = 'dd-title';
  const watch = makeEl('button'); watch.className = 'dd-watch'; watch.type = 'button';
  const close = makeEl('button'); close.className = 'dd-close'; close.type = 'button';
  head.appendChild(title); head.appendChild(watch); head.appendChild(close);
  const state = makeEl('div'); state.className = 'dd-state';
  const body = makeEl('div'); body.className = 'dd-body';
  const wl = makeEl('div'); wl.className = 'dd-watchlist';
  const wlList = makeEl('div'); wlList.className = 'dd-wl-list';
  wl.appendChild(wlList);
  root.appendChild(head); root.appendChild(state); root.appendChild(body); root.appendChild(wl);
  return root;
}

// patch: render 層は document.createElement を使うので global を差し替える
function withDoc(fn) {
  const prev = globalThis.document;
  globalThis.document = { createElement: (t) => makeEl(t) };
  try { return fn(); } finally { globalThis.document = prev; }
}

function sampleModel() {
  return {
    header: { code: 'US', name_ja: 'アメリカ合衆国', score: 60 },
    regions: [
      { a1code: 'US-CA', name_ja: 'カリフォルニア州', count: 3, byLayer: { conflict: 1, protests: 2 }, topEvents: [], lon: -119, lat: 37 },
      { a1code: null, name_ja: 'その他/不明', count: 1, byLayer: { news: 1 }, topEvents: [], lon: null, lat: null },
    ],
    events: [
      { layerId: 'protests', lon: -118, lat: 34, title: '抗議', raw: {}, a1code: 'US-CA', cityName: 'ロサンゼルス' },
      { layerId: 'news', lon: null, lat: null, title: '報道', raw: {}, a1code: null, cityName: null },
    ],
    degraded: false,
  };
}

test('renderDrilldown: header 差込・region/event 行ボタン生成・onClose/onWatchToggle 配線', () => {
  withDoc(() => {
    const root = makeRoot();
    let closed = 0; let toggled = 0; const selected = [];
    renderDrilldown(root, sampleModel(), {
      onSelect: (s) => selected.push(s),
      onClose: () => { closed += 1; },
      onWatchToggle: (code) => { toggled += 1; assert.equal(code, 'US'); },
    });
    // ヘッダ HTML が差し込まれている（中身は drilldown_view が担保＝非空のみ確認）
    assert.ok(root.querySelector('.dd-title').innerHTML.length > 0, 'header HTML 差込');
    // region 2件 + event 2件 = 4 ボタンが .dd-body 配下に生成
    const body = root.querySelector('.dd-body');
    assert.equal(body.children.length, 4, 'region2 + event2 の行ボタン');
    // 閉じる
    root.querySelector('.dd-close').click();
    assert.equal(closed, 1, 'onClose 発火');
    // ★ watch トグル（header.code を渡す）
    root.querySelector('.dd-watch').click();
    assert.equal(toggled, 1, 'onWatchToggle 発火');
  });
});

test('renderDrilldown: 座標ありの行は onSelect 発火・座標なしは disabled（instability mkRow 同型）', () => {
  withDoc(() => {
    const root = makeRoot();
    const selected = [];
    renderDrilldown(root, sampleModel(), { onSelect: (s) => selected.push(s), onClose() {}, onWatchToggle() {} });
    const btns = root.querySelector('.dd-body').children;
    // region[0]=座標あり, region[1]=座標なし(disabled), event[0]=座標あり, event[1]=座標なし(disabled)
    assert.equal(btns[0].disabled, false);
    assert.equal(btns[1].disabled, true, 'lon/lat null の region は disabled');
    assert.equal(btns[2].disabled, false);
    assert.equal(btns[3].disabled, true, 'lon/lat null の event は disabled');
    btns[0].click(); // region 行
    btns[2].click(); // event 行
    assert.equal(selected.length, 2, '座標あり行のみ onSelect 発火');
    assert.equal(selected[0].lon, -119); assert.equal(selected[0].lat, 37);
    assert.equal(selected[0].title, 'カリフォルニア州', 'region は name_ja を title に');
    assert.equal(selected[1].layerId, 'protests');
    assert.equal(selected[1].lon, -118);
    btns[1].click(); btns[3].click(); // disabled は発火しない（listener 未登録）
    assert.equal(selected.length, 2, 'disabled 行は onSelect しない');
  });
});

test('renderDrilldown: degraded=true で degraded バナーを差し込む', () => {
  withDoc(() => {
    const root = makeRoot();
    const m = sampleModel(); m.degraded = true; m.degradedKind = 'fetcherror';
    renderDrilldown(root, m, { onSelect() {}, onClose() {}, onWatchToggle() {} });
    const body = root.querySelector('.dd-body');
    // degraded バナー要素（.dd-degraded）が body 先頭に入る
    assert.ok(body.querySelector('.dd-degraded'), 'degraded バナー差込');
  });
});

test('setDrilldownState: loading/error/ready で .dd-state へクラス排他適用＋hidden 制御', () => {
  withDoc(() => {
    const root = makeRoot();
    setDrilldownState(root, 'loading');
    assert.ok(root.classList.contains('dd-loading'));
    assert.equal(root.classList.contains('dd-error'), false);
    assert.equal(root.classList.contains('dd-ready'), false);
    setDrilldownState(root, 'error');
    assert.ok(root.classList.contains('dd-error'));
    assert.equal(root.classList.contains('dd-loading'), false, 'state は排他');
    setDrilldownState(root, 'ready');
    assert.ok(root.classList.contains('dd-ready'));
    assert.equal(root.classList.contains('dd-error'), false);
  });
});

test('renderDrilldown / setDrilldownState: rootEl が null でも throw しない', () => {
  withDoc(() => {
    assert.doesNotThrow(() => renderDrilldown(null, sampleModel(), {}));
    assert.doesNotThrow(() => setDrilldownState(null, 'loading'));
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_render.test.js
```

Expected: FAIL — `Cannot find module '../js/ui/drilldown.js'`（モジュール未作成）または `renderDrilldown is not a function`。

- [ ] **Step 3: 最小実装を書く**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/ui/drilldown.js` を新規作成:

```javascript
// 国ドリルダウン render 層。drilldown_view.js（純 HTML）を DOM に差し込み、
// region/event 行に onSelect を配線する。map/fetch は呼ばずコールバックで外部委譲（instability mkRow 同型）。
import { drilldownHeaderHtml, regionRowHtml, eventLineHtml, degradedNoticeHtml } from '../lib/drilldown/drilldown_view.js';

const STATE_CLASSES = { loading: 'dd-loading', error: 'dd-error', ready: 'dd-ready' };

// rootEl=#drilldown。state in {'loading','error','ready'}。.dd-state クラスを排他適用。
export function setDrilldownState(rootEl, state) {
  if (!rootEl) return;
  for (const cls of Object.values(STATE_CLASSES)) rootEl.classList.remove(cls);
  const next = STATE_CLASSES[state];
  if (next) rootEl.classList.add(next);
}

// 行ボタンを作る（instability の mkRow と同型: 座標ありは onSelect、なしは disabled）。
function mkRowButton(html, payload, onSelect) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'dd-rowbtn';
  el.innerHTML = html;
  if (payload && typeof payload.lon === 'number' && typeof payload.lat === 'number'
      && (payload.lon || payload.lat) && onSelect) {
    el.addEventListener('click', () => onSelect(payload));
  } else {
    el.disabled = true;
  }
  return el;
}

// rootEl=#drilldown。model={header, regions, events, degraded, degradedKind?}。
// onSelect({lon,lat,title,layerId}) は座標あり行クリック / onClose() / onWatchToggle(code)。
export function renderDrilldown(rootEl, model, { onSelect, onClose, onWatchToggle } = {}) {
  if (!rootEl || !model) return;
  const titleEl = rootEl.querySelector('.dd-title');
  const body = rootEl.querySelector('.dd-body');
  const closeBtn = rootEl.querySelector('.dd-close');
  const watchBtn = rootEl.querySelector('.dd-watch');
  const header = model.header || {};

  if (titleEl) titleEl.innerHTML = drilldownHeaderHtml(header);
  if (closeBtn && onClose) { closeBtn.innerHTML = '×'; closeBtn.addEventListener('click', () => onClose()); }
  if (watchBtn && onWatchToggle) { watchBtn.innerHTML = '★'; watchBtn.addEventListener('click', () => onWatchToggle(header.code)); }

  if (body) {
    body.innerHTML = '';
    if (model.degraded) {
      const banner = document.createElement('div');
      banner.className = 'dd-degraded';
      banner.innerHTML = degradedNoticeHtml(model.degradedKind || 'missing');
      body.appendChild(banner);
    }
    for (const region of (model.regions || [])) {
      // region 行は name_ja を title に乗せ flyTo の見出しにする
      body.appendChild(mkRowButton(
        regionRowHtml(region),
        { lon: region.lon, lat: region.lat, title: region.name_ja, layerId: 'country' },
        onSelect));
    }
    for (const ev of (model.events || [])) {
      body.appendChild(mkRowButton(
        eventLineHtml(ev),
        { lon: ev.lon, lat: ev.lat, title: ev.title, layerId: ev.layerId },
        onSelect));
    }
  }
}

// rootEl=#drilldown。countries=orderByInstability 済の [{code,name_ja,score,lon,lat}]。
// instability rowHtml を流用（座標あり=onSelect / ★=onRemove）。.dd-wl-list に描画。
export function renderWatchlist(rootEl, countries, { onSelect, onRemove } = {}) {
  if (!rootEl) return;
  const list = rootEl.querySelector('.dd-wl-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of (countries || [])) {
    const row = document.createElement('div');
    row.className = 'dd-wl-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-wl-name';
    btn.innerHTML = rowHtml(c);
    if (typeof c.lon === 'number' && typeof c.lat === 'number' && (c.lon || c.lat) && onSelect) {
      btn.addEventListener('click', () => onSelect(c));
    } else {
      btn.disabled = true;
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dd-wl-remove';
    rm.innerHTML = '★';
    if (onRemove) rm.addEventListener('click', () => onRemove(c.code));
    row.appendChild(btn);
    row.appendChild(rm);
    list.appendChild(row);
  }
}
```

> 注: `renderWatchlist` は instability の `rowHtml` を流用する（spec §7）。そのため import を追加する。

`js/ui/drilldown.js` 冒頭の import に instability の `rowHtml` を追加（Step 3 の先頭 import 行の直後）:

```javascript
import { rowHtml } from './instability.js';
```

（最終的な import ブロックは次の2行）:

```javascript
import { drilldownHeaderHtml, regionRowHtml, eventLineHtml, degradedNoticeHtml } from '../lib/drilldown/drilldown_view.js';
import { rowHtml } from './instability.js';
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_render.test.js
```

Expected: PASS — 全テスト緑（renderDrilldown 配線・disabled・degraded バナー・setDrilldownState 排他・null 安全・renderWatchlist は次タスクで追加検証）。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/ui/drilldown.js tests/drilldown_render.test.js && git commit -m "feat(drilldown): render 層 renderDrilldown/setDrilldownState（DOM スタブ TDD）"
```

---

### Task C7-2: renderWatchlist（ウォッチリスト描画・同テストに追加）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/ui/drilldown.js`（Task C7-1 で `renderWatchlist` は実装済 — 本タスクはテスト追加で配線を確定）
- Test: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_render.test.js`（append）

**Interfaces:**
- Produces: `renderWatchlist(rootEl, countries, {onSelect, onRemove}) -> void`
- Consumes: `js/ui/instability.js: rowHtml(country)->string`（流用）

- [ ] **Step 1: 失敗テストを追加する**

`tests/drilldown_render.test.js` の末尾に追記:

```javascript
test('renderWatchlist: 各国行を .dd-wl-list に生成・onSelect/onRemove 配線', () => {
  withDoc(() => {
    const root = makeRoot();
    const selected = []; const removed = [];
    const countries = [
      { code: 'US', name_ja: 'アメリカ合衆国', score: 60, lon: -98, lat: 39 },
      { code: 'UA', name_ja: 'ウクライナ', score: 90, lon: 31, lat: 49 },
    ];
    renderWatchlist(root, countries, { onSelect: (c) => selected.push(c), onRemove: (code) => removed.push(code) });
    const list = root.querySelector('.dd-wl-list');
    assert.equal(list.children.length, 2, '2国分の行');
    // 各行は name ボタン + remove ボタン
    const row0 = list.children[0];
    assert.ok(row0.querySelector('.dd-wl-name'));
    assert.ok(row0.querySelector('.dd-wl-remove'));
    // name クリック→onSelect / ★クリック→onRemove(code)
    row0.querySelector('.dd-wl-name').click();
    assert.equal(selected.length, 1); assert.equal(selected[0].code, 'US');
    row0.querySelector('.dd-wl-remove').click();
    assert.deepEqual(removed, ['US']);
  });
});

test('renderWatchlist: 座標なし国は name ボタン disabled（消えずに表示は残す）', () => {
  withDoc(() => {
    const root = makeRoot();
    renderWatchlist(root, [{ code: 'XX', name_ja: '某国', score: 0, lon: null, lat: null }],
      { onSelect() {}, onRemove() {} });
    const list = root.querySelector('.dd-wl-list');
    assert.equal(list.children.length, 1, '座標なしでも行は表示（消えない）');
    assert.equal(list.children[0].querySelector('.dd-wl-name').disabled, true);
  });
});

test('renderWatchlist: 空配列でリストをクリア', () => {
  withDoc(() => {
    const root = makeRoot();
    renderWatchlist(root, [{ code: 'US', name_ja: 'アメリカ合衆国', score: 60, lon: -98, lat: 39 }], { onSelect() {}, onRemove() {} });
    renderWatchlist(root, [], { onSelect() {}, onRemove() {} });
    assert.equal(root.querySelector('.dd-wl-list').children.length, 0);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_render.test.js
```

Expected: PASS が期待されるが、もし `renderWatchlist` の配線（`.dd-wl-name`/`.dd-wl-remove` クラス・disabled 判定）にズレがあれば FAIL する。FAIL した場合は Step 3 で `js/ui/drilldown.js` の `renderWatchlist` をテスト期待に合わせて修正。Task C7-1 の実装どおりなら追加分も即 PASS（その場合は Step 3 をスキップし Step 4 へ）。

> 本タスクは「テストファースト確定」用。C7-1 で `renderWatchlist` を先に書いているため、本テストは仕様の固定（regression guard）に相当する。FAIL→修正のループが発生しない設計だが、TDD 規約上テスト追加→実行を独立タスクとして明示する。

- [ ] **Step 3: （FAIL 時のみ）`renderWatchlist` を修正**

万一 Step 2 が FAIL した場合、`js/ui/drilldown.js` の `renderWatchlist` を以下の確定実装に一致させる（C7-1 と同一）:

```javascript
export function renderWatchlist(rootEl, countries, { onSelect, onRemove } = {}) {
  if (!rootEl) return;
  const list = rootEl.querySelector('.dd-wl-list');
  if (!list) return;
  list.innerHTML = '';
  for (const c of (countries || [])) {
    const row = document.createElement('div');
    row.className = 'dd-wl-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dd-wl-name';
    btn.innerHTML = rowHtml(c);
    if (typeof c.lon === 'number' && typeof c.lat === 'number' && (c.lon || c.lat) && onSelect) {
      btn.addEventListener('click', () => onSelect(c));
    } else {
      btn.disabled = true;
    }
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'dd-wl-remove';
    rm.innerHTML = '★';
    if (onRemove) rm.addEventListener('click', () => onRemove(c.code));
    row.appendChild(btn);
    row.appendChild(rm);
    list.appendChild(row);
  }
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_render.test.js
```

Expected: PASS — renderWatchlist の3テストを含む全テスト緑。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/ui/drilldown.js tests/drilldown_render.test.js && git commit -m "test(drilldown): renderWatchlist 配線テスト（座標なし行 disabled・空配列クリア）"
```

---

### Task C7-3: index.html に #drilldown パネルを追加（配線・最小差分）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/index.html`

**Interfaces:**
- Produces: `<aside id="drilldown" class="drill-panel" hidden>`（`#map-wrap` 内・`#feed` の後）。子: `.dd-head`（`.dd-title` / `.dd-watch` ボタン / `.dd-close` ボタン）・`.dd-state`・`.dd-body`・`.dd-watchlist`（`.dd-wl-list`）。
- Consumes: なし（DOM 構造のみ）。mobile-tabs（`index.html:49-53`）は触らない（mobile-nav.js 無改修・回帰回避）。

- [ ] **Step 1: 失敗テストを書く（DOM 構造の存在を grep で検証する node:test）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_html.test.js` を新規作成:

```javascript
// tests/drilldown_html.test.js
// index.html に #drilldown パネル（render 層が querySelector する DOM 構造）が存在することを検証。
// mobile-tabs を触っていない（3ボタン hardcode 維持）ことも回帰ガード。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

test('index.html: #drilldown aside と必須 child クラスが存在', () => {
  assert.match(html, /<aside id="drilldown"[^>]*class="drill-panel"[^>]*hidden/);
  assert.match(html, /class="dd-head"/);
  assert.match(html, /class="dd-title"/);
  assert.match(html, /class="dd-watch"/);
  assert.match(html, /class="dd-close"/);
  assert.match(html, /class="dd-state"/);
  assert.match(html, /class="dd-body"/);
  assert.match(html, /class="dd-watchlist"/);
  assert.match(html, /class="dd-wl-list"/);
});

test('index.html: mobile-tabs は3ボタンのまま（mobile-nav.js 無改修の前提を守る）', () => {
  const tabs = (html.match(/class="mobile-tab"/g) || []).length;
  assert.equal(tabs, 3, 'mobile-tab は layers/feed/legend の3つから増えていない');
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_html.test.js
```

Expected: FAIL — `#drilldown` 不在で1本目の `assert.match` が `AssertionError`（mobile-tabs テストは PASS する）。

- [ ] **Step 3: 最小実装（index.html へ #drilldown を追加）**

`index.html` の `#feed` ブロック終了（`</div>` of `id="feed"`・43行目 `</div>` の直後）に挿入する。`#feed` ブロックは以下:

```html
      <div id="feed" class="side-panel feed-panel">
        <div class="panel-head"><h4>イベント / Feed</h4>
          <button id="feed-toggle" class="collapse-btn" aria-label="フィード折りたたみ">›</button></div>
        <div class="feed-hint">クリックでその地点へ移動 📍</div>
        <div id="feed-chips" class="feed-chips"></div>
        <div id="feed-rows"></div>
      </div>
```

この `</div>`（#feed 閉じ）の直後・`<aside id="legend"`（44行目）の前に次を挿入:

```html
      <aside id="drilldown" class="drill-panel" hidden aria-label="国の詳細ドリルダウン">
        <div class="dd-head">
          <h4 class="dd-title"></h4>
          <button class="dd-watch" type="button" aria-label="ウォッチリストに追加/削除">★</button>
          <button class="dd-close" type="button" aria-label="国詳細を閉じる">×</button>
        </div>
        <div class="dd-state" aria-live="polite">
          <span class="dd-loading-msg">読み込み中…</span>
          <span class="dd-error-msg">読み込みに失敗しました。<button class="dd-retry" type="button">再試行</button></span>
        </div>
        <div class="dd-body"></div>
        <div class="dd-watchlist">
          <h4 class="dd-wl-h">★ ウォッチリスト</h4>
          <div class="dd-wl-list"></div>
        </div>
      </aside>
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_html.test.js && node --test tests/*.test.js 2>&1 | grep -iE "tests [0-9]|pass [0-9]|fail [0-9]"
```

Expected: PASS — drilldown_html.test.js 緑＋全体 `tests 357 / pass 357 / fail 0`（baseline 352 + drilldown_render 約8 + drilldown_html 2、※ render/html テスト本数は実測で確認。fail 0 が必須）。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add index.html tests/drilldown_html.test.js && git commit -m "feat(drilldown): index.html に #drilldown パネル追加（mobile-tabs 無改修）"
```

---

### Task C7-4: css/orbis.css に非重畳 split を追加（#map 物理縮小・不透明背景・PC横/モバイル下半分）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/css/orbis.css`

**Interfaces:**
- Produces（CSS セレクタ契約）: `body.drill-open #map-wrap { display: grid }`（PC は `grid-template-columns: 1fr min(38vw,380px)`・モバイルは `grid-template-rows: 1fr 52vh`）・`body.drill-open #map { position: static; inset: auto }`（grid セルに収め物理縮小）・`#drilldown.drill-panel { background: #070b14; backdrop-filter なし; z-index: 6 }`。
- Consumes: 既存 `#map-wrap`（`css/orbis.css:22`）・`#map`（`:23`）・`@media (max-width: 768px)`（`:313`）。`#starfield`/`#freshness`/`#panel`/`#feed`/`#legend` は `position:absolute` のまま維持（grid セルに収めるのは `#map` のみ＝連鎖崩れ回避）。

- [ ] **Step 1: 失敗テストを書く（CSS 契約の存在を grep で検証する node:test）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_css.test.js` を新規作成:

```javascript
// tests/drilldown_css.test.js
// 非重畳 split の CSS 契約を検証（実 paint は実機サニティ／ここは契約存在の回帰ガード）。
// blur-bleed 回避の絶対要件: #drilldown に backdrop-filter / glass を一切使わない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '..', 'css', 'orbis.css'), 'utf8');

test('css: body.drill-open で #map-wrap を grid 化し #map を物理縮小（position 上書き）', () => {
  assert.match(css, /body\.drill-open\s+#map-wrap\s*\{[^}]*display:\s*grid/);
  // #map のみ position 上書き（他オーバーレイは触らない）
  assert.match(css, /body\.drill-open\s+#map\s*\{[^}]*position:\s*static/);
});

test('css: #drilldown は不透明純色背景・backdrop-filter / glass-blur を使わない（blur-bleed 回避）', () => {
  // #drilldown / .drill-panel の宣言ブロックを抽出
  const m = css.match(/#drilldown(?:\.drill-panel)?\s*\{[^}]*\}/g) || [];
  assert.ok(m.length > 0, '#drilldown ルールが存在');
  const joined = m.join('\n');
  assert.match(joined, /background:\s*#070b14/);
  assert.doesNotMatch(joined, /backdrop-filter/);
  assert.doesNotMatch(joined, /var\(--glass-blur\)/);
});

test('css: モバイルで下半分 grid 行（globe 上・詳細下）', () => {
  assert.match(css, /body\.drill-open\s+#map-wrap\s*\{[^}]*grid-template-rows/);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_css.test.js
```

Expected: FAIL — `body.drill-open` ルール不在で1本目 `assert.match` が `AssertionError`。

- [ ] **Step 3: 最小実装（CSS を追記）**

`css/orbis.css` の末尾（ファイル最終行の後）に以下を追記する。`#map` の position 上書きは「`#map` のみ」に限定し、`#starfield`/`#freshness`/`#panel`/`#feed`/`#legend` は `position:absolute` のまま `#map-wrap` 基準を維持する（連鎖崩れ回避）:

```css
/* ===== Phase2 国ドリルダウン: 非重畳 split パネル（blur-bleed を構造的に回避） ===== */
/* #drilldown は不透明純色（#070b14）。backdrop-filter / glass を一切使わない＝square-blur-bleed が原理的に発生しない。 */
#drilldown.drill-panel {
  position: absolute; right: 0; top: 0; bottom: 0; width: min(38vw, 380px); z-index: 6;
  background: #070b14; border-left: 1px solid var(--line);
  overflow-y: auto; overflow-x: hidden;
  padding: 14px 14px calc(20px + env(safe-area-inset-bottom));
  font-size: 12px; color: var(--text);
  transform: translateX(102%); transition: transform .3s ease;
}
/* drill-open でせり出す（PC は右からスライドイン） */
body.drill-open #drilldown.drill-panel { transform: translateX(0); }
#drilldown[hidden] { display: none; }

/* drill-open 時に #map-wrap を grid 化し、#map のみ position 上書きで grid セルに収め物理縮小。
   他オーバーレイ（#starfield/#freshness/#panel/#feed/#legend）は position:absolute のまま参照枠を維持＝連鎖崩れしない。 */
body.drill-open #map-wrap { display: grid; grid-template-columns: 1fr min(38vw, 380px); }
body.drill-open #map { position: static; inset: auto; grid-column: 1; }
/* #drilldown を grid 第2列に収め非重畳に（PC） */
body.drill-open #drilldown.drill-panel { position: static; grid-column: 2; width: auto; }

/* ヘッダ: タイトル／★／× を横並び */
#drilldown .dd-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
  position: sticky; top: 0; background: #070b14; padding-bottom: 6px; z-index: 1; }
#drilldown .dd-title { flex: 1; margin: 0; font-size: 14px; color: var(--text); }
#drilldown .dd-watch, #drilldown .dd-close {
  background: none; border: 1px solid var(--line); color: var(--muted);
  border-radius: 6px; cursor: pointer; width: 26px; height: 26px; line-height: 1; }
#drilldown .dd-watch:hover, #drilldown .dd-close:hover { color: var(--cyan); border-color: var(--cyan); }

/* 状態表示（loading/error）: 既定は両メッセージ非表示。ready 時は dd-state 自体を隠す。 */
#drilldown .dd-state { font-size: 12px; color: var(--muted); margin-bottom: 8px; min-height: 0; }
#drilldown .dd-loading-msg, #drilldown .dd-error-msg { display: none; }
#drilldown.dd-loading .dd-loading-msg { display: inline; }
#drilldown.dd-error .dd-error-msg { display: inline; color: #ffce7a; }
#drilldown.dd-ready .dd-state { display: none; }
#drilldown .dd-retry { margin-left: 6px; background: none; border: 1px solid var(--cyan);
  color: var(--cyan); border-radius: 6px; cursor: pointer; padding: 2px 8px; font-size: 11px; }

/* 行ボタン（region/event）: instability rowbtn と同流儀の全幅クリック行 */
#drilldown .dd-rowbtn { display: block; width: 100%; text-align: left; background: none;
  border: 0; border-bottom: 1px solid rgba(28,44,72,.5); color: inherit; font: inherit;
  cursor: pointer; padding: 7px 4px; }
#drilldown .dd-rowbtn:hover:not(:disabled) { background: rgba(57,208,255,.08); }
#drilldown .dd-rowbtn:disabled { opacity: .55; cursor: default; }

/* degraded バナー */
#drilldown .dd-degraded { font-size: 11px; color: #ffce7a; background: rgba(255,176,40,.10);
  border: 1px solid rgba(255,176,40,.35); border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; }

/* ウォッチリスト */
#drilldown .dd-watchlist { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 10px; }
#drilldown .dd-wl-h { margin: 0 0 6px; font-size: 11px; letter-spacing: .08em;
  text-transform: uppercase; color: var(--muted); }
#drilldown .dd-wl-row { display: flex; align-items: center; gap: 6px; }
#drilldown .dd-wl-name { flex: 1; text-align: left; background: none; border: 0; color: inherit;
  font: inherit; cursor: pointer; padding: 5px 4px; }
#drilldown .dd-wl-name:hover:not(:disabled) { background: rgba(57,208,255,.08); }
#drilldown .dd-wl-name:disabled { opacity: .55; cursor: default; }
#drilldown .dd-wl-remove { background: none; border: 0; color: var(--cyan); cursor: pointer;
  width: 24px; height: 24px; line-height: 1; }

@media (prefers-reduced-motion: reduce) {
  #drilldown.drill-panel { transition: none; }
}

/* モバイル（≤768px）: 下半分 bottom-sheet（上 globe・下 詳細）。mobile-nav.js は触らず body.drill-open 専用駆動。 */
@media (max-width: 768px) {
  body.drill-open #map-wrap { grid-template-columns: none; grid-template-rows: 1fr 52vh; }
  body.drill-open #map { grid-column: auto; grid-row: 1; }
  #drilldown.drill-panel {
    right: 0; left: 0; top: auto; bottom: 0; width: auto;
    border-left: 0; border-top: 1px solid var(--line); border-radius: 16px 16px 0 0;
    padding-top: 18px; transform: translateY(102%);
  }
  body.drill-open #drilldown.drill-panel { transform: translateY(0); position: static; grid-row: 2; }
  /* ドラッグハンドル風 */
  #drilldown.drill-panel::before { content: ''; position: absolute; top: 7px; left: 50%;
    transform: translateX(-50%); width: 40px; height: 4px; border-radius: 2px; background: var(--line); }
}
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_css.test.js && node --test tests/*.test.js 2>&1 | grep -iE "tests [0-9]|pass [0-9]|fail [0-9]"
```

Expected: PASS — drilldown_css.test.js 緑（grid 化・position 上書き・不透明背景・backdrop-filter 不在・モバイル grid-template-rows）＋全体 `fail 0`。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add css/orbis.css tests/drilldown_css.test.js && git commit -m "feat(drilldown): 非重畳 split CSS（#map 物理縮小・不透明背景・PC横/モバイル下半分）"
```

---

### Task C7-5: js/main.js 配線（map.on('click') + initCountryClick + deck pick 排他フラグ）

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/js/main.js`

**Interfaces:**
- Consumes: `js/ui/country_click.js: initCountryClick({map, getSnapshots, deps}) -> {resolveFipsAt, handleMapClick(e), openCountry, closeCountry}`
- Produces: boot 内で `const cc = initCountryClick({ map, getSnapshots: () => snapshots, deps: { fetch, getDeckPick: () => deckPicked } })` + `map.on('click', cc.handleMapClick)` + deck onClick が object を拾った直後に `deckPicked = { at, lng, lat }` を更新。
- 不変: drawAll/rebuild/registry/selected/flyTo は触らない。snapshots（`js/main.js:58` module-local）は `getSnapshots` クロージャで渡す（`window.__orbis` 経由は不可＝spec §0 の事実）。

**配線方針（spec §5.2-5.3）**: deck onClick（`js/main.js:321-358`）が `info.object` を拾った時に排他フラグ `deckPicked`（時刻＋座標）を更新。`map.on('click')` 経由の `handleMapClick` は `deps.getDeckPick()` で同フレーム pick の有無を読み、近接座標＋時刻しきい値なら国解決を抑制する（抑制判定ロジック自体は country_click.js の責務＝本クラスタは生フラグを渡すのみ）。`deps:{fetch}` は spec の DI seam 例示で、排他フラグ accessor `getDeckPick` を同 deps に同梱するのが最小差分の正配線。

- [ ] **Step 1: 失敗テストを書く（main.js の配線文字列を検証する node:test）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_main_wiring.test.js` を新規作成:

```javascript
// tests/drilldown_main_wiring.test.js
// main.js が国クリックを別系統 map.on('click') で受け、initCountryClick に getSnapshots DI クロージャと
// fetch / deck pick 排他フラグ accessor を渡していることを静的検証（boot は DOM/deck 依存で実行不可ゆえソース検証）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'js', 'main.js'), 'utf8');

test('main.js: initCountryClick を import している', () => {
  assert.match(src, /import\s*\{\s*initCountryClick\s*\}\s*from\s*['"]\.\/ui\/country_click\.js['"]/);
});

test('main.js: getSnapshots は module-local snapshots を返す DI クロージャ（window.__orbis 経由でない）', () => {
  assert.match(src, /getSnapshots:\s*\(\)\s*=>\s*snapshots/);
});

test('main.js: deps に fetch と deck pick 排他フラグ accessor を渡す', () => {
  assert.match(src, /deps:\s*\{[^}]*fetch[^}]*getDeckPick:\s*\(\)\s*=>\s*deckPicked/);
});

test('main.js: map.on(\'click\', ...) で handleMapClick を別系統配線', () => {
  assert.match(src, /map\.on\(\s*['"]click['"]\s*,\s*[\w.]*handleMapClick\s*\)/);
});

test('main.js: deck onClick（info.object 分岐）で deckPicked 排他フラグを更新', () => {
  assert.match(src, /deckPicked\s*=\s*\{/);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_main_wiring.test.js
```

Expected: FAIL — import 文・getSnapshots クロージャ・deps・map.on('click')・deckPicked が未配線で全 `assert.match` が `AssertionError`。

- [ ] **Step 3: 最小実装（main.js を局所追記）**

(3-1) import を追加する。`js/main.js:29` の `import { aggregateByCountry, buildHotspotConfigs } from './lib/aggregate.js';` の直後（30 行目）に挿入:

```javascript
import { initCountryClick } from './ui/country_click.js';
```

(3-2) deck pick 排他フラグの module-local 宣言を追加する。`js/main.js:71` の `let selectedShip = null;` 行の直後に挿入:

```javascript
let deckPicked = null;     // 国クリック排他: deck が直近に pick した {at, lng, lat}（country_click が時刻＋座標で抑制判定）
```

(3-3) deck onClick が object を拾った時に排他フラグを更新する。`js/main.js:321-322` の onClick コールバック冒頭 `(info) => {` の次行 `if (!info || !info.object || !info.layer) return;`（322 行目）の **直後** に挿入:

```javascript
      const _c = info.coordinate; // [lng, lat]
      deckPicked = { at: (typeof performance !== 'undefined') ? performance.now() : Date.now(),
        lng: _c ? _c[0] : null, lat: _c ? _c[1] : null };
```

> early return（`if (!info || !info.object ...) return;`）を通過した時点で必ず deck pick 成立なので、この位置でフラグを更新すれば「object を拾った直後」を満たす。

(3-4) boot 内で initCountryClick を初期化し map.on('click') を配線する。`js/main.js:366` の `window.__orbis = { map, overlay, counts: {} };` の **直後** に挿入:

```javascript

  // 国ドリルダウン（別系統 map.on('click'）: deck onClick の early return より前で拾えないため独立配線。
  // snapshots は module-local（window.__orbis に載らない）ゆえ getSnapshots DI クロージャで渡す。
  // deck pick 排他フラグ accessor（getDeckPick）も deps で渡し、country_click が同フレーム pick を抑制判定する。
  const cc = initCountryClick({
    map,
    getSnapshots: () => snapshots,
    deps: { fetch, getDeckPick: () => deckPicked },
  });
  map.on('click', cc.handleMapClick);
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_main_wiring.test.js && node --test tests/*.test.js 2>&1 | grep -iE "tests [0-9]|pass [0-9]|fail [0-9]"
```

Expected: PASS — main_wiring 5テスト緑＋全体 `fail 0`（main.js の構文崩れがあれば import を持つ他テストが連鎖 FAIL するため、`fail 0` が main.js 整合の証拠）。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add js/main.js tests/drilldown_main_wiring.test.js && git commit -m "feat(drilldown): main.js 配線（map.on('click')+initCountryClick・getSnapshots DI・deck pick 排他フラグ）"
```

---

### Task C7-6: sw.js を v45 に版up

**Files:**
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/sw.js`

**Interfaces:**
- Produces: `sw.js: const CACHE = 'orbis-v45';`
- 不変: SHELL / bypass 条件（`raw.githubusercontent.com` / `/data/snapshots/` / `cartocdn`）はそのまま。`/data/static/` はネット優先 cache のまま（spec §10・trade/currents と同様運用可）。

- [ ] **Step 1: 失敗テストを書く（CACHE 版番号を検証する node:test）**

`/home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown/tests/drilldown_sw.test.js` を新規作成:

```javascript
// tests/drilldown_sw.test.js
// SW の CACHE 版番号が Phase2 で v45 に上がっていることを検証（新コード/CSS を確実に配信させる）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sw = readFileSync(join(__dirname, '..', 'sw.js'), 'utf8');

test('sw.js: CACHE は orbis-v45', () => {
  assert.match(sw, /const\s+CACHE\s*=\s*['"]orbis-v45['"]/);
});

test('sw.js: bypass 条件（snapshots/raw/cartocdn）は維持', () => {
  assert.match(sw, /raw\.githubusercontent\.com/);
  assert.match(sw, /\/data\/snapshots\//);
  assert.match(sw, /cartocdn/);
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_sw.test.js
```

Expected: FAIL — 現状 `const CACHE = 'orbis-v44';` のため1本目 `assert.match(sw, /orbis-v45/)` が `AssertionError`（bypass テストは PASS）。

- [ ] **Step 3: 最小実装（sw.js の版番号を更新）**

`sw.js:2` の行を差し替える:

変更前:
```javascript
const CACHE = 'orbis-v44';
```

変更後:
```javascript
const CACHE = 'orbis-v45';
```

- [ ] **Step 4: 成功を確認する**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/drilldown_sw.test.js && node --test tests/*.test.js 2>&1 | grep -iE "tests [0-9]|pass [0-9]|fail [0-9]"
```

Expected: PASS — drilldown_sw 2テスト緑＋全体 `fail 0`。

- [ ] **Step 5: commit**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && git add sw.js tests/drilldown_sw.test.js && git commit -m "chore(drilldown): SW CACHE を orbis-v45 に版up"
```

---

### Task C7-7: クラスタ全体の最終検証（baseline 維持＋全グリーン）

**Files:**
- なし（検証のみ）

**Interfaces:**
- Consumes: 本クラスタ全成果物＋依存クラスタ（drilldown_view / aggregate_admin1 / country_click）が main に揃っていること。

- [ ] **Step 1: 全 node:test を実行し fail 0 を確認**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/*.test.js 2>&1 | grep -iE "tests [0-9]|pass [0-9]|fail [0-9]"
```

Expected: PASS — `fail 0`。baseline 352 に本クラスタの新規テスト（drilldown_render / drilldown_html / drilldown_css / drilldown_main_wiring / drilldown_sw）が上積みされ、全体が緑。

- [ ] **Step 2: render 層が依存ビルダを正しく import できているか（依存クラスタ統合の煙テスト）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --input-type=module -e "import('./js/ui/drilldown.js').then(m => { if (typeof m.renderDrilldown !== 'function' || typeof m.setDrilldownState !== 'function' || typeof m.renderWatchlist !== 'function') { console.error('MISSING EXPORT'); process.exit(1); } console.log('drilldown.js exports OK'); }).catch(e => { console.error('IMPORT FAIL', e.message); process.exit(1); });"
```

Expected: PASS — `drilldown.js exports OK`（`drilldown_view.js` / `instability.js` の import が解決でき、3 export が関数である）。`IMPORT FAIL` が出た場合は依存クラスタ（drilldown_view）の未統合か import パス不整合。

- [ ] **Step 3: main.js が構文崩れなく全 import を解決できるかの煙テスト**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --check js/main.js && echo "main.js syntax OK"
```

Expected: PASS — `main.js syntax OK`（`node --check` は構文のみ検証。import 先の実行はしないが配線追記の構文崩れを検出）。

- [ ] **Step 4: コミット（検証のみなので no-op の場合はスキップ）**

検証のみで変更ファイルが無ければ commit しない。Step 1-3 で FAIL があれば該当タスクに戻って修正してから再検証する。

---

## クラスタ 最終検証と統合

### Task FINAL: 最終検証と統合

全クラスタ（C1〜C7）が main に揃った状態で、Phase2 国ドリルダウンの一貫性・回帰・実機受入を確認し main に統合して横断記憶を整理する。

**Files:**
- 検証のみ（コード変更は consistency_patches の適用と発覚した不整合の修正に限る）

**Interfaces:**
- Consumes: 全クラスタの成果物（geo_poly / nearest / zoom_for_bbox / aggregate_admin1 / drilldown_view / watchlist / country_index / country_data / country_click / ui/drilldown）と既存4ファイル変更・静的データ生成物
- Produces: なし（統合ゲート）

- [ ] **Step 1: consistency_patches を適用してから全 node:test を緑にする**

本プランの consistency_patches に列挙したクラスタ間不整合（events への regionName/a1code 付与・deck pick 排他の getDeckPick 統一・admin1 fetch パスの .gz・forecast/forecastCards 整合・watchlist countries join・loadCountryBounds/setBoundsPolys 配線）を先に適用する。

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --test tests/*.test.js 2>&1 | grep -E "# (tests|pass|fail)"
```

Expected: PASS — baseline 352 ＋ 本 Phase2 の全新規テストが緑・`# fail 0`。

- [ ] **Step 2: pytest（ne_prep 純粋部＋既存回帰）を緑にする**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && PYTHONPATH=. uv run pytest tests/test_ne_prep.py tests/test_geo_country.py tests/test_manifest.py -q
```

Expected: PASS — ne_prep 全テスト緑、test_geo_country.py（東京=JA/パリ=FR/カイロ=EG/アンカレッジ=US・太平洋=None）が 50m 再生成データでも維持、manifest 回帰緑。

- [ ] **Step 3: import 解決とビルド成果物の健全性を煙テスト**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && node --input-type=module -e "Promise.all([import('./js/ui/drilldown.js'),import('./js/ui/country_click.js'),import('./js/lib/drilldown/country_index.js'),import('./js/lib/drilldown/country_data.js')]).then(()=>console.log('all imports OK')).catch(e=>{console.error('FAIL',e.message);process.exit(1)})" && node --check js/main.js && echo "main.js syntax OK"
```

Expected: PASS — `all imports OK` と `main.js syntax OK`（依存クラスタが全て解決でき配線の構文崩れが無い）。

- [ ] **Step 4: playwright e2e（国クリック→パネル→flyTo→ウォッチリスト）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/phase2-drilldown && npx playwright test 2>&1 | tail -20
```

Expected: PASS — 既存 e2e に加え、陸地クリックでパネルが開き（非重畳 split で globe が縮む）、海洋クリックでパネルが開かない、ウォッチリスト追加/削除が動くシナリオが緑。落ちる場合は playwright-skill で実 DOM/描画を観察し原因を特定する。

- [ ] **Step 5: 太田さん実機サニティ → main 統合 → 横断記憶整理**

実機サニティ観点（AskUserQuestion で受入確認）: (a) 主要国（US/UA/RU/JP）クリックで県別件数が降順表示され最寄り都市名が出る、(b) EXTRA68 小国で degraded バナーが出て 404 にならない、(c) 非重畳 split で blur-bleed（四角い滲み）が無い、(d) モバイル下半分シートで globe が上に残る、(e) ウォッチリストが score 降順で並び permalink/share に混入しない。受入 OK 後、superpowers:finishing-a-development-branch に従い ExitWorktree（action=keep）で main に戻り `git fetch && git merge phase2-drilldown && git push`（Vercel 本番化）。merge 済みは ExitWorktree（action=remove）で片付ける。最後に横断記憶を整理する: Obsidian Projects/orbis-feature-roadmap.md に Phase2 完了（本番 commit/SW v45・実機受入手順・次=Phase3 FIRMS）を昇格記録し、MEMORY.md 索引の追加機能ロードマップ行を更新する。Obsidian 読み書きは明示報告する。
