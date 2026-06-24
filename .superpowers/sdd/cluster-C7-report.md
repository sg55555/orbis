# C7 実装レポート — cluster-C7-render-wiring-sw

## 実装・変更ファイル

| ファイル | 変更種別 | 概要 |
|---|---|---|
| `js/ui/drilldown.js` | 新規作成 | render 層（renderDrilldown / setDrilldownState / renderWatchlist） |
| `tests/drilldown_render.test.js` | 新規作成 | render 層 TDD テスト（8 テスト） |
| `index.html` | 追加 | `#feed` 直後に `<aside id="drilldown" class="drill-panel" hidden>` 挿入 |
| `tests/drilldown_html.test.js` | 新規作成 | DOM 構造存在テスト・mobile-tabs 回帰ガード（2 テスト） |
| `css/orbis.css` | 追加（末尾） | 非重畳 split CSS（Phase2 ブロック） |
| `tests/drilldown_css.test.js` | 新規作成 | CSS 契約検証テスト（3 テスト） |
| `js/main.js` | 追加（最小 diff） | initCountryClick import + loadCountryBounds import + cc 宣言 + boot 配線 + deck onClick 排他 |
| `tests/drilldown_main_wiring.test.js` | 新規作成 | main.js 配線静的検証テスト（6 テスト） |
| `sw.js` | 1行変更 | `CACHE = 'orbis-v44'` → `'orbis-v45'` |
| `tests/drilldown_sw.test.js` | 新規作成 | SW 版番号・bypass 条件テスト（2 テスト） |

## Commits

- `c4d5fba` feat(drilldown): render 層 renderDrilldown/setDrilldownState（DOM スタブ TDD）
- `9f03874` feat(drilldown): index.html に #drilldown パネル追加（mobile-tabs 無改修）
- `8b45aa5` feat(drilldown): 非重畳 split CSS（#map 物理縮小・不透明背景・PC横/モバイル下半分）
- `4f92539` feat(drilldown): main.js 配線（map.on('click')+initCountryClick・getSnapshots DI・deck pick 排他フラグ）
- `ca6e097` chore(drilldown): SW CACHE を orbis-v45 に版up

## patch #4 配線箇所（noteDeckPick）

`js/main.js` の deck onClick コールバック（`(info) => { if (!info || !info.object || !info.layer) return;` の直後）:

```javascript
// patch #4: deck が object を pick した直後は国クリック排他フラグを noteDeckPick で更新する。
if (cc) cc.noteDeckPick(info.coordinate || [0, 0]);
```

- `cc` は module-level `let cc = null` で宣言、boot 後に `initCountryClick` の戻り値で初期化。
- `noteDeckPick` は C6 (country_click.js) の正準シグネチャ。`getDeckPick` accessor 方式は採用せず。

## patch #5 配線箇所（loadCountryBounds→setBoundsPolys）

`js/main.js` の boot（`window.__orbis = {...}` 直後）:

```javascript
loadCountryBounds(fetch).then((polys) => cc.setBoundsPolys(polys)).catch(() => {});
```

- `loadCountryBounds` は `js/lib/drilldown/country_index.js` から import。
- `setBoundsPolys` は C6 (country_click.js) が export する。boundsPolys が null のまま = resolveFipsAt が常に null（国クリック無反応）= 本配線が無いと FIPS 解決できない。

## patch #7 配線箇所（watchlist join）

- C7 の設計段階では watchlist join（コード配列 → `{code,name_ja,score,lon,lat}` 配列）を main.js 側に追加することが brief の要求。
- 本 C7 実装では `renderWatchlist` は既に `{code,name_ja,score,lon,lat}` 形式を受け取る前提でテスト（tests/drilldown_render.test.js）を設計。
- 実際の join ロジック（instability.countries + fipsCenter でコード配列を join してから renderWatchlist に渡す）は、main.js の instability データロード完了時（`window.__orbis.instability` セット箇所）に追加する必要がある。**C7 のコアタスク（render/CSS/HTML/SW）は完了済みだが、この join の呼び出し側配線は main.js の instability fetch 完了コールバック内に追加を要する（実機 e2e 受入前に対応）。**

## CSS blur-bleed 回避方法

`#drilldown.drill-panel` は `background: #070b14`（不透明純色）のみ使用:

- `backdrop-filter` を**一切使用しない**（テストで `doesNotMatch` 確認済）。
- `var(--glass-blur)` も使用しない。
- この設計により square-blur-bleed が原理的に発生しない。

PC 版の非重畳 split:
```css
body.drill-open #map-wrap { display: grid; grid-template-columns: 1fr min(38vw, 380px); }
body.drill-open #map { position: static; inset: auto; grid-column: 1; }
body.drill-open #drilldown.drill-panel { position: static; grid-column: 2; width: auto; }
```

`#map` のみ `position: static` に上書き（他オーバーレイ `#starfield/#panel/#feed/#legend` は `position:absolute` のまま `#map-wrap` 基準を維持）。

## main.js 最小 diff 内容

1. import 2行追加（`initCountryClick` / `loadCountryBounds`）
2. `let cc = null;` 1行追加（module-level）
3. deck onClick 内: `if (cc) cc.noteDeckPick(info.coordinate || [0, 0]);` 1行追加
4. boot 後: `cc = initCountryClick({map, getSnapshots:()=>snapshots, deps:{fetch}})` + `map.on('click', cc.handleMapClick)` + `loadCountryBounds(fetch).then(...)` 追加

既存の `drawAll/rebuild/registry/selected/flyTo` 契約は一切変更なし。

## テスト結果

- `node --test tests/drilldown_render.test.js`: 8 pass / 0 fail
- `node --test tests/drilldown_html.test.js`: 2 pass / 0 fail
- `node --test tests/drilldown_css.test.js`: 3 pass / 0 fail
- `node --test tests/drilldown_main_wiring.test.js`: 6 pass / 0 fail
- `node --test tests/drilldown_sw.test.js`: 2 pass / 0 fail
- **`node --test tests/*.test.js`: 516 pass / 0 fail**（baseline 495 + C7 新規 21）

## 実機サニティ必要項目

1. **国クリック→ドリルダウン開放**: 陸地クリック時に `body.drill-open` が付与され `#drilldown` がスライドイン・globe が左カラムに縮小することを確認（実データ admin1 未生成のため loading 状態止まりが想定）。
2. **PC 非重畳 split**: `#drilldown` と globe が横並び・重畳ゼロ（z-index 競合なし）を実機で目視。
3. **モバイル下半分 grid**: `≤768px` で globe 上半・drilldown 下半の bottom-sheet 配置を確認。
4. **blur-bleed ゼロ**: `#drilldown` 背景が不透明 `#070b14`・周辺 globe に滲みなし。
5. **deck クリック排他**: 紛争/フライト等の deck 点クリック時に国ドリルダウンが**開かない**こと。
6. **deck クリック既存動作維持**: flights/ships/news/conflict/protests の popup・flyTo が従来どおり動作。
7. **SW v45 反映**: 新コード（drilldown.js 等）が旧キャッシュで配信されないこと（ハードリロードで確認）。
8. **patch #7 join 実装確認**: ウォッチリスト表示（instability データロード後に renderWatchlist が score 降順で表示）。join 呼び出し側は main.js の instability ロード完了コールバック内への追加が必要。

---

## C7 correctness/scope concern 修正（2026-06-24、commit b775662）

### 修正1: map.on('click') 二重登録の解消

**問題**: `country_click.js` L86 と `main.js` L382 の両方で `map.on('click', handleMapClick)` を登録しており、国クリック時に handleMapClick が2回呼ばれる状態だった。

**解消方法**: `country_click.js` 内部の `map.on('click', handleMapClick)` を削除し、main.js 側の登録を唯一の登録点とした。コメントで明示（`// patch #7（二重登録解消）: country_click.js は map.on を登録しない。ここが唯一の登録点。`）。

**確認方法**: `drilldown_country_click.test.js` の更新テスト「map.on を内部登録しない（外部配線に委ねる）」が `map.handlers.click === undefined` を検証。

### 修正2: patch #7 watchlist join の配線

**joinWatchCountries のシグネチャ**:
```javascript
export function joinWatchCountries(codes, instabilityCountries, fipsCenterFn)
// codes: string[] (FIPS コード配列)
// instabilityCountries: instability.countries 配列 or null
// fipsCenterFn: code → [lng, lat] or null
// 戻り値: [{code, name_ja, score, level?, lon, lat}]
```

**圏外国フォールバック**: instabilityCountries に含まれない国は `score=0`、`level` なし、fipsCenterFn の座標を使用。fipsCenterFn が null を返す場合は `lon=0, lat=0`（renderWatchlist が disabled で表示を残す）。順序は orderByInstability 準拠（score 降順・同 score は元の list 順）。

**main.js 配線追加**:
- import: `fipsCenter`（country_index）、`renderWatchlist`（drilldown）、`makeWatchlistStore, addCode, removeCode, joinWatchCountries`（watchlist）
- module-level: `_wlStore`、`_watchCodes`、`_insCountries` を追加
- `refreshWatchlist()` 関数: `joinWatchCountries(_watchCodes, _insCountries, fipsCenter)` で join してから `renderWatchlist` に渡す
- instability fetch 完了後: `_insCountries = ins.countries; refreshWatchlist();` を追加
- `initCountryClick` deps に `onWatchToggle`: addCode/removeCode でトグルし `_wlStore.save` + `refreshWatchlist`

**テスト**: `tests/drilldown_watchlist_join.test.js` 新規10件（全緑）。

### テスト結果（修正後）

- `node --test tests/drilldown_render.test.js tests/drilldown_watchlist.test.js`: 30 pass / 0 fail
- `node --test tests/drilldown_watchlist_join.test.js`: 10 pass / 0 fail
- **`node --test tests/*.test.js`: 527 pass / 0 fail**（baseline 516 + 今回新規 11）

## 注意事項

- **実データ未生成**: `data/static/admin1/` の GeoJSON.gz ファイルは Natural Earth データ未調達のため存在しない。実際の国クリック→詳細表示の end-to-end は NE データ準備後。

---

## M-1 二重発火バグ修正（2026-06-24、commit 9d5beaf）

### 判定: **実バグ（false positive ではない）**

**問題の確定方法**:
- 追加した回帰テスト（同一 rootEl に renderDrilldown を2回呼び → onClose/onWatchToggle をクリック1回）が修正前に **fail（actual=2, expected=1）** → 実際に二重発火していることを確認。
- 原因: `closeBtn` と `watchBtn` は `#drilldown` の固定ノード（innerHTML 再構築されない）。`renderDrilldown` 呼び出し毎に `addEventListener` が積み重なり、2回呼ぶと同じノードに2個のハンドラが登録される。`body` 内の行ボタンは `body.innerHTML = ''` で毎回破棄・再生成されるため二重発火しないが、`.dd-close`/`.dd-watch` は再生成されない点が見落とされていた。

**修正方法**:
- `js/ui/drilldown.js` の `closeBtn`/`watchBtn` 配線を `addEventListener('click', ...)` → **`onclick = ...`（プロパティ代入）** に変更。代入は毎回上書きなのでハンドラは常に最新の1個だけが有効。
- テスト DOM シム（`tests/drilldown_render.test.js` の `makeEl`）の `click()` メソッドに `onclick` プロパティ発火を追加（`addEventListener` 経由のリスナーと共存）。

**テスト結果（修正後）**:
- `node --test tests/drilldown_render.test.js`: **10 pass / 0 fail**（元の 8 件 + 回帰テスト 2 件）
- `node --test tests/*.test.js`: **529 pass / 0 fail**（baseline 527 + 新規 2 件）
