# ORBIS P1-2 レイヤーパネルのカテゴリ分類 — 設計

- date: 2026-06-21
- project: orbis
- thread: UI/UX 精査バックログ（[[orbis-uiux-improvements]] P1-2）
- worktree: `panel-categories`（origin/main 基点 = 3f143bb）

## 背景・課題

レイヤーパネル（`#panel-rows`）は10層が**無分類の縦リスト**で、各層に**フル文の説明が常時インライン表示**（`.layer-desc`）されている。結果、縦に長くスキャンしづらい。バックログ P1-2 の改善案＝(a) カテゴリ分け (b) 説明をホバー/折りたたみに (c) プリセット導線と統合。

## ゴール

1. 10層を**3カテゴリ**にグループ化し、各群に見出しを付ける。
2. 説明文を**既定非表示**にし、各行の **ⓘ** で desktop=ホバー / mobile=タップ表示にする（縦長解消・スキャン性向上）。
3. 既存のプリセット chip 行（`#panel-presets`）は**そのまま上部に維持**（プリセット＝場面切替の横断ショートカット／カテゴリ＝全層の分類ブラウズ、と役割分離）。

非ゴール（YAGNI）：群ごとの折りたたみ、説明開閉の永続化、`index.html` の構造変更、カテゴリ別「全ON/OFF」トグル、フィード（`#feed`）側の変更。

## カテゴリ体系（確定）

| カテゴリ | label | layerIds |
|---|---|---|
| events | 出来事 | quakes, conflict, protests, news |
| mobility | 移動 | flights, ships, trade |
| environment | 環境 | sst, currents, airtemp |

- 群順＝出来事 → 移動 → 環境。群内順＝上表の順。
- 10層をちょうど網羅（4+3+3）。`trade` は「移動」に含める（既存プリセット「交通」=航空/船舶/貿易 と分類軸が一致・単独カテゴリを作らない）。

## アーキテクチャ

### 1. データ層 `js/lib/categories.js`（新規・純粋・deck/DOM 非依存）

`presets.js` / registry の `DESCRIPTIONS` と同じ「純データ＋純関数」流儀。

```js
export const CATEGORIES = [
  { id: 'events',      label: '出来事', layerIds: ['quakes', 'conflict', 'protests', 'news'] },
  { id: 'mobility',    label: '移動',   layerIds: ['flights', 'ships', 'trade'] },
  { id: 'environment', label: '環境',   layerIds: ['sst', 'currents', 'airtemp'] },
];

// レイヤー配列をカテゴリ順にグループ化して返す（純粋）。
// 返り値: [{ id, label, layers: [layerObj, ...] }, ...]
// CATEGORIES に未収載の layer は末尾の「その他」群にまとめる（将来レイヤー追加時の取りこぼし防止）。
// 空の群（該当 layer が0件）は返さない。
export function groupLayers(layers, categories = CATEGORIES) { ... }
```

- `groupLayers` は与えられた `layers`（registry の layer オブジェクト配列）を `categories` の順に走査し、各カテゴリの `layerIds` に一致する layer を集めて `{id,label,layers}` を作る。
- どのカテゴリにも属さない layer があれば末尾に `{ id:'other', label:'その他', layers:[...] }` を付ける（安全側フォールバック・`fipsToJa` の未知コード扱いと同思想）。
- 該当 layer が1件も無いカテゴリはスキップ（空見出しを出さない）。

### 2. パネル描画 `js/ui/panel.js`（改修）

`renderPanel` を「フラット map」から「`groupLayers` で群化して描画」に変更。

- 各群を `<div class="layer-cat">` で囲み、先頭に `<div class="layer-cat-head">出来事</div>`、続けて従来の `.layer-item` 行を並べる。
- 各 `.layer-row`（`<label>`）に **ⓘ ボタン** `<button type="button" class="layer-info" aria-label="説明" aria-expanded="false">` を追加（説明がある層のみ）。
- `.layer-desc` は従来どおり `.layer-item` 内に出すが **既定 `display:none`**。
- `updateCounts` / `syncChecks` のロジックは不変（`.layer-count` / `.layer-row` セレクタは群化後も全行に一致するため）。
- `renderPresets` / `wireCollapse` は不変。

### 3. 説明の ⓘ 挙動

- **クリック/タップ**：`.layer-info` の click で `.layer-item` の `.desc-open` をトグル（`aria-expanded` も更新）。タッチ環境でも確実に開閉できる。
- **desktop ホバー**：`@media (hover:hover)` 下で `.layer-item:hover .layer-desc`（または `.layer-info:hover ~ .layer-desc`）を表示。タッチ端末では hover ルールを当てない（hover 残留を防止）。
- **チェックボックス誤作動の回避**：ⓘ は `<label>` 内にあるため、click ハンドラで `e.preventDefault(); e.stopPropagation();` を行い、ラベル既定動作（チェックボックスのトグル）と既存 change ハンドラへの伝播を止める。

### 4. CSS `css/orbis.css`（追記）

- `.layer-cat`：群間の余白。
- `.layer-cat-head`：小サイズ・字間広め・muted＋淡いシアン差し色（ゾーン①の見出し言語＝`body.ui-a/.ui-b` のパネル見出しと整合）。
- `.layer-info`：控えめな ⓘ（行末・小・hover で発光）。`@media (hover:hover)` 用の reveal ルール。
- `.layer-desc`：既定 `display:none`、`.layer-item.desc-open .layer-desc` と hover ルールで表示。既存の `margin/indent/font` は流用。
- モバイル（bottom sheet）でもタップ ⓘ で開閉できることを確認。

### 5. Service Worker

`sw.js` は network-first（v36+ で fetch 成功→put / 失敗→cache）。`panel.js` / `css/orbis.css` はシェルだが network-first により次回ロードで反映されるため**版上げは原則不要**。plan で `sw.js` の現行戦略を確認し、precache 整合上 bump が要る場合のみ v40 へ。

## データフロー

`registry.layers`（layer オブジェクト配列）→ `groupLayers()` → 群配列 → `renderPanel` が群見出し＋行を DOM 生成 → ユーザーのトグルは従来どおり `toggleEnabled`/`writeStored`/`onChange`。ⓘ は表示のみで状態（ENABLED）には影響しない。

## テスト（TDD）

### 単体（`node --test`）

- **`tests/categories.test.js`（新規）**
  - `groupLayers` が CATEGORIES の順に群を返し、各 layer が正しい群に1回だけ入る。
  - 未収載 layer（合成 layer オブジェクト）は末尾「その他」群に入る。
  - 該当0件のカテゴリは返さない（空見出しを出さない）。
  - **整合性テスト**：registry の全 layer id がちょうど1カテゴリに属す（過去の ALL_IDS 手同期ミスの教訓＝ドリフト防止）。`CATEGORIES` の全 layerId が registry に実在することも検証。
- 既存 `presets.test.js` / `registry.test.js` は不変で緑維持。

### e2e（Playwright・`tests/e2e/`）

- パネルに**カテゴリ見出し3つ**（出来事/移動/環境）が描画される。
- 各層行が**正しい群**の下にある（例：地震が「出来事」群内）。
- **ⓘ クリックで `.desc-open` がトグル**し説明が表示/非表示になる（チェックボックスの状態は変わらない＝誤作動なし）。
- 既存 smoke / presets / mobile-nav e2e が緑維持（群化でセレクタが壊れていない）。
- 注：色味・GPU 依存の見えは headless 不可 → localhost 実物確認＋オーナー確認（[[mistakes]]）。

## リスク・確認事項

- **ⓘ の click が `<label>` のチェックボックスを誤トグル**：`preventDefault/stopPropagation` で防止（e2e で「ⓘ クリック後もチェック状態不変」を assert）。
- **群化で `updateCounts`/`syncChecks` が壊れる**：セレクタはグローバルクエリのため不変だが、e2e の件数表示で回帰確認。
- **モバイル hover 残留**：`@media (hover:hover)` でガード。
- **既存ユーザーの ENABLED 永続値**：本変更は表示構造のみで `orbis.enabled.v1` のスキーマ・既定に触れない（後方互換）。

## 進め方

worktree `panel-categories`（作成済）→ 本 spec commit → writing-plans で実装計画 → TDD 実装（純データ→panel→css→e2e）→ `node --test` 緑 → localhost `python -m http.server` で実物確認（見出し/ⓘ/モバイル）→ main 統合（fetch→origin/main 基準 merge→push）→ 本番 curl/Playwright 検証 → 記憶整理（MEMORY＋Obsidian）。
