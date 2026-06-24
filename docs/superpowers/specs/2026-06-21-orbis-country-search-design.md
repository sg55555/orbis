# ORBIS 国検索（場所/国へ飛ぶ）設計

- date: 2026-06-21
- project: orbis
- thread: UI/UX backlog P2「検索」
- status: 設計承認済（実装前）
- related: docs/superpowers/specs/2026-06-21-orbis-share-permalink-design.md, docs/superpowers/specs/2026-06-21-orbis-legend-help-design.md

## 目的

世界リアルタイム監視ダッシュボードで「行き先」を**国名で指定して飛べる**ようにする。日本語名（例「ウクライナ」）または英語名（例「Ukraine」「ukr」）を入力 → 候補から選択 → その国の中心へ `map.flyTo`。既存の選択と同じ着地強調（リティクル＋ポップアップ）を再利用する。

## スコープ（承認済）

- **対象＝全 FIPS_JA 国（FS 補完後 約239件・国/主権領土レベルで網羅）**。座標源は2系統：
  - **171 国＝`data/static/country_bounds.geojson`（geometry 由来 centroid）**（`code`=FIPS／`name`=英語名）。
  - **欠落68 国＝手キュレート `EXTRA_CENTROIDS`**。110m 低解像度ジオメトリが落とす小国・領土（イスラエル/ノルウェー/シンガポール/バーレーン/マルタ/モルディブ＋アンドラ/サンマリノ/トンガ等の島嶼マイクロ国家）。オーナー承認＝**網羅優先で全件手当て**。
- **UI＝globe 上部中央の常設検索ボックス**（左上はレイヤーパネルが占有のため中央へ）。オートコンプリート候補（日本語名＋英語名）→選択で flyTo。
- **YAGNI 除外**：地域（US 州等 REGION_JA）／ライブイベント検索／外部ジオコーディング API／過去再生。いずれも将来拡張余地ありだが本スコープ外。

## アーキテクチャ（既存 3層分離規約＝permalink / legend と同型）

```
オフライン生成 → js/lib/country_centroids.js  (純データ: [{code,en,lng,lat}] 171件)
                         │ import
純粋部         → js/lib/gazetteer.js          (FIPS_JA と join → COUNTRIES / searchCountries)
                         │ import
UI部           → js/ui/search.js              (上部中央ボックス・候補・キーボード・自己初期化)
                         │ onSelect(country)
配線           → js/main.js                   (selected 状態セット→flyTo→着地リティクル再利用)
トグル         → js/lib/immerse.js            (?search=on|off → body.search-*)
スタイル       → css/orbis.css 末尾 #search   (グラス＋ネオン・ui-a 言語・reduced-motion)
マウント点     → index.html                   (#search 要素を 1つ追加)
```

globe 描画（`js/map.js` のレイヤー/projection）は**非編集**＝並行 globe 系セッションと非干渉。`main.js` は配線の最小追加のみ。

## 1. データ生成（オフライン・1回・commit）

`scripts/gen_country_centroids.py`（新規）が2系統を合流し `js/lib/country_centroids.js` を生成：

**(a) geometry 由来（171件）**：`data/static/country_bounds.geojson` の各 feature について
- ジオメトリ（Polygon / MultiPolygon）の**全外環の中で bbox 面積が最大の環**を選ぶ。
- その環の **bbox 中心** `[(minLon+maxLon)/2, (minLat+maxLat)/2]` を centroid とする。

**(b) 手キュレート EXTRA（68件）**：`scripts/extra_centroids.py`（または同スクリプト内 dict）に FIPS_JA にあって country_bounds に無い68コードの代表中心座標（首都/島中心）を定義。小国・領土ゆえ単一代表点で zoom 4 の用途に十分（誤差は実用上無視可）。

- 出力 `js/lib/country_centroids.js`：`export const COUNTRY_CENTROIDS = [{code, en, lng, lat}, ...]`（**239件**・lng/lat は小数4桁丸め・code 昇順）。`en` は country_bounds の name、EXTRA は英語通称を併記。
- **生成時の整合チェック（スクリプト内 assert）**：出力239コードが「FIPS_JA の全キー（FS 補完後）」と過不足なく一致すること。欠落/余剰があればスクリプトが落ちる＝手キュレート漏れを生成時に検出。

**最大ポリゴン bbox 中心方式の根拠**（実データ検証済）：全頂点平均は飛び地（米=Alaska/Hawaii・仏=海外領土）に引かれて海上へ落ちる（US→太平洋）。最大ポリゴン bbox 中心は本土に着地（US→カンザス -95.8,37.2／仏→仏中央／日本→本州 135.7,36.2／英→54.3,-2.2／中→104.4,36.9）。

**248KB の実行時 fetch 回避**：geojson を実行時に読まず、生成済み軽量モジュール（~5KB）を import する。geojson はビルド入力としてのみ使用（再生成は手動・スナップショット非依存）。

**既知の許容誤差**：
- 凹型国（例 Norway）で bbox 中心がやや隣国寄りになり得るが、zoom 4 の「飛んで眺める」用途では実用上問題ない。著しくズレる国が出たら `scripts` 内の `CENTROID_OVERRIDES`（code→[lng,lat] の少数手当て）で上書きしてから生成する。
- 反子午線（ロシア極東・フィジー等）：最大ポリゴンが主大陸（180 をまたがない）になるため大半緩和。生成後にロシア（FIPS `RS`）・フィジー（`FJ`）の実 centroid を検証し、海上なら override で手当て。

## 2. 純粋部 `js/lib/gazetteer.js`（deck/DOM 非依存）

```js
import { COUNTRY_CENTROIDS } from './country_centroids.js';
import { FIPS_JA } from './places.js';

// COUNTRY_CENTROIDS を FIPS_JA と join。ja は FIPS_JA 単一ソース（重複保持しない）。
export const COUNTRIES = COUNTRY_CENTROIDS.map((c) => ({
  code: c.code, ja: FIPS_JA[c.code] || c.en, en: c.en, lng: c.lng, lat: c.lat,
}));

// query を日本語名・英語名に部分一致。前方一致を上位、次に部分一致。最大 limit 件。
// 空/空白のみ/無マッチ → []。大小無視。英数のみ正規化（trim + toLowerCase）。
export function searchCountries(query, limit = 8) { ... }
```

**マッチング仕様**：
- `q = query.trim().toLowerCase()`。`q === '' → []`。
- 各国の照合対象＝`ja`（そのまま）と `en.toLowerCase()`。日本語は `ja.includes(qRaw)`（trim のみ・小文字化は ASCII 影響なし）、英語は `en.toLowerCase().includes(q)`。
- ランク：いずれかが**前方一致**（`startsWith`）するものを上位群、部分一致のみを下位群。各群内は元の code 昇順（安定）。
- 先頭 `limit` 件を返す。返す要素は `COUNTRIES` の要素そのまま（`{code,ja,en,lng,lat}`）。

## 3. UI部 `js/ui/search.js`（自己初期化・share.js / legend.js と同型）

`export function initSearch(onSelect, opts)` を提供し、ファイル末尾で（DOM があれば）自己初期化。

- **DOM**：`#search`（上部中央コンテナ）内に入力 `#search-input`（placeholder「国を検索」）＋候補リスト `#search-results`（既定非表示）＋クリアボタン。
- **入力**：`input` イベントで `searchCountries(value)` → 候補を `日本語名（English）` で最大8件描画。空入力で候補非表示。
- **キーボード**：
  - `/`（入力外で・修飾なし・他の入力にフォーカスが無い時）→ `#search-input` に focus（`preventDefault`）。
  - `↑/↓`：候補のハイライト移動（`aria-activedescendant`）。
  - `Enter`：ハイライト中（無ければ先頭）の候補を確定。
  - `Esc`：候補を閉じ、入力をクリア/blur。
- **選択**：候補クリック or Enter → `onSelect(country)` を呼び、候補を閉じる（入力値は選択国名に）。
- **モバイル**：同じ上部中央バー（パネルは下端シートのため上部は空く）。タッチで候補タップ選択。
- **a11y**：`role=combobox`/`listbox`/`option`、`aria-expanded`/`aria-activedescendant`。

`onSelect` 未配線でも UI は安全（no-op）。`opts` で要素 ID を差し替え可（テスト用）。

## 4. 配線 `js/main.js`（最小改修）

`initShare(...)` の隣に追加（`map`/`overlay`/`selPopup`/`drawAll`/`selected` は同スコープ内）：

```js
import { initSearch } from './ui/search.js';

initSearch((country) => {
  selectedFlight = null; selectedShip = null;
  selected = { lon: country.lng, lat: country.lat, title: country.ja, layerId: 'search', at: performance.now() };
  if (window.__orbis) window.__orbis.selected = selected;
  map.flyTo({ center: [country.lng, country.lat], zoom: 4, duration: 1500, essential: true });
  if (selPopup) selPopup.setLngLat([country.lng, country.lat])
    .setHTML(`<div class="sel-title">${country.ja}</div>`).addTo(map);
  drawAll(overlay);
});
```

- 既存の `selected` 状態＋`drawAll`→`buildReticleConfigs` で**着地リティクルを再利用**（news/conflict 選択と同じ見え）。`zoom:4` は既存 flyTo と統一。
- `layerId:'search'` は `buildReticleConfigs` のフォールバック色で描画（既知 layerId 限定の着色なら中立色になることを実装時に確認。必要なら中立色を明示）。
- ポップアップは国名のみの最小表示（`.sel-title` 既存スタイル流用）。

## 5. トグル `?search=on|off` `js/lib/immerse.js`

`immerseLegend` と同型で `immerseSearch(search)` を追加（既定 `'on'`）。`immerseClasses` に `out.push('search-' + immerseSearch(search));` を追加 → body に `search-on|off`。`css/orbis.css` で `body.search-off #search { display:none; }`。before/after 比較・実物確認用。

## 6. スタイル `css/orbis.css`（末尾に #search ブロック）

- `#search`：`position:absolute; top:12px; left:50%; transform:translateX(-50%); z-index:6;`（パネル left:12 / freshness right:12 と非干渉・z は panel(5) より上）。
- グラス＋ネオン（既存 `.side-panel`/`#share-btn`/`#legend` の `ui-a` 言語に合わせる：半透明背景＋`backdrop-filter:blur`＋ネオン縁＋上端オーロラ線）。
- 候補ドロップダウン：同グラス・ホバー/ハイライト発光。`@media (hover:hover)` でモバイル hover 残留防止。
- reduced-motion：`#search` のトランジションを抑制（既存の reduced ブロックに追記）。
- 共有 mid-file CSS は不変（末尾追記のみ）＝並行セッションの非隣接マージ容易。

## 7. マウント点 `index.html`

`<div id="map">` と同じ globe コンテナ内に `#search`（入力＋候補リスト）を1つ追加。`<script type="module" src="js/ui/search.js">` を既存スクリプト群（legend.js 等）の隣に追加。SW＝ネット優先のため版上げ不要（SHELL 変更も network-first で反映）。

## テスト（TDD）

**単体 `tests/gazetteer.test.js`**：
- `searchCountries('ウクラ')` → ウクライナ（code `UP`・centroid 31.08,48.81）を含む。
- `searchCountries('ukr')` / `'UKR'` → Ukraine（大小無視）。
- `searchCountries('イスラエル')` → イスラエル（code `IS`・**EXTRA 由来**）を含む＝手キュレート補完が機能。
- 前方一致が部分一致より上位（例 `'japan'` で Japan が先頭）。
- `limit` 既定8・指定2 で件数制限。
- `''`・`'   '`・無マッチ（`'zzzzz'`）→ `[]`。
- データ整合：`COUNTRIES.length === 239`（FS 補完後の FIPS_JA 全キーと一致）、全要素 `lng∈[-180,180]`/`lat∈[-90,90]` の有限数、`ja` が全件非空、**全 FIPS_JA コードが COUNTRIES に存在**（手キュレート漏れ検出）。

**e2e `tests/e2e/search.spec.js`**（専用ポート＋`reuseExistingServer:false` で `:8000` 汚染回避）：
- 検索入力に focus → 「日本」入力 → 候補に「日本（Japan）」表示 → クリック → `map.getCenter()` が日本 centroid 付近（lng≈135.7±2, lat≈36.2±2）へ移動。
- `?search=off` で `#search` が非表示。

## エッジ・整合

- **FS（仏領南方・南極地域）**：`FIPS_JA` 未収載の1件 → `places.js` に `FS: '仏領南方・南極地域'` を1件補完し 171/171 を日本語名に（FIPS 補完と同流儀）。
- 無マッチ時は候補リストに「該当なし」を表示（選択不可）。
- クリップボード等の外部 API 依存なし（座標は静的・決定論）。

## 非編集・非衝突・process

- **非編集**：`js/map.js`（globe 描画/projection/レイヤー）、共有 mid-file CSS、SW 版番号。
- **main.js**：`initSearch` の import と配線1ブロックのみ追加。
- **process**：本 worktree（`worktree-search-countries`・origin/main 基準）→ writing-plans で実装計画 →（規模相応に SDD or インライン TDD）→ `origin/main` マージ → `HEAD:main` ff push（ローカル main 不変・git-shared-main-tree-integration-collision 厳守）→ cron 周期デプロイで本番反映を curl/実機検証。
- **実機確認（オーナー）**：上部中央バーの見え・候補の可読性・flyTo 着地・モバイル操作感・`?search` before/after。GPU 依存の見えは headless 不可。
