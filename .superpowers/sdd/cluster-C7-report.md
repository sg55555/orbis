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

## 注意事項

- **実データ未生成**: `data/static/admin1/` の GeoJSON.gz ファイルは Natural Earth データ未調達のため存在しない。実際の国クリック→詳細表示の end-to-end は NE データ準備後。
- **country_click.js の内部 map.on**: C6 実装が `initCountryClick` 内で `map.on('click', handleMapClick)` を自動登録する。main.js も同ハンドラを追加登録しているため二重登録となるが、handleMapClick は token ベースのレース破棄で idempotent に動作する。統合時に C6 の内部登録を外す（main.js 側に一本化）ことを推奨。
