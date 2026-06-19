# ORBIS 紛争セクション改善 — 設計書

- date: 2026-06-20
- status: 設計確定（実装計画はこの後 writing-plans で作成）
- 関連: Obsidian `Projects/orbis.md`（次UI候補「フィード可読性＝紛争一色の単調さ・絞り込み」）

## 背景・課題（データ根拠つき）

ORBIS の右イベントフィードと globe 上の紛争レイヤーには2つの弱点がある。

1. **フィードが「紛争一色」で単調**。`buildFeed` は全有効レイヤーの `toFeedItems` を**時刻降順→上位100件**で集約する。本番スナップショットは `conflict.json` が **count 2000**（上限張り付き）、protests 482、news 19、quakes 数百。24h 内に2000件出る紛争が時刻上位を埋め尽くし、「🔴 紛争 ◯◯（hostname）」の同色行が延々と並ぶ。フィルタも集約も無い。
2. **紛争レイヤーのインタラクションが貧弱**。flights/ships/news/quakes はクリック→日本語ポップアップ＋flyTo・形/色の分離を持つのに、紛争はクリック不可・tooltip 最小（国名＋hostname のみ）・`tone`/`mentions`/`root` 未活用・pick 点は半径4/alpha70 でほぼ不可視。

## 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| スコープ | **両方一体**＝紛争を「読める・絞れる・触れる」体験として総合改善 |
| フィード方式 | **国別集約＋レイヤーチップ**（紛争/抗議を国別に圧縮＋種類で絞り込み） |
| クリック詳細 | **二段階ドリルダウン**（フィード行→国サマリ／globe個別点→記事リンク付き詳細） |
| globe 刷新 | **ember 化＋深刻度を白熱度（明度）で＋上位国のホットスポット脈動**。強度は `?param` 実物比較で確定 |

## スコープ / 非スコープ

- **スコープ＝完全にクライアントサイド**。`conflict.json`/`protests.json` の各点は既に `place(FIPS)/mentions/tone/date/url/root` を持つため、**collector（Python）の変更は不要**。全ロジックを純粋関数化して node:test で検証する。
- **非スコープ（YAGNI）**:
  - collector / スナップショット形式の変更（集約はクライアントで行う）。
  - `tone`（感情トーン）の可視化＝ノイズが多く誤読を招くため出さない。
  - globe での**色相**による深刻度分け＝加算合成が色相を白方向に濁らせるため不採用。深刻度は**明度/白熱度**で表す。
  - 集約系 deck レイヤー（HeatmapLayer 等）＝globe 非対応（既知）。ScatterplotLayer ベースを維持。
  - 紛争サブタイプ用の追加チップ＝チップは4レイヤー（地震/紛争/抗議/ニュース）のまま。

## アーキテクチャ / ユニット分解

各ユニットは単一目的・明確なインターフェース・独立テスト可能。`main.js`/`registry.js` の信頼性系ロジック（drawAll キャッシュ・ポーリング・registry 自動導出）は**非破壊**で、配線の追加のみ行う。

### Unit 1 — 国別集約（純粋・新規 `js/lib/aggregate.js`）

```
aggregateByCountry(points, layerId) -> GroupRow[]
```
`points`（snapshot.points）を `place`(FIPS) でグループ化し、各国1行に圧縮する。GroupRow:

```
{
  id: `${layerId}-${place}`,   // 安定キー
  kind: 'group',
  layerId,                      // 'conflict' | 'protests'
  place,                        // FIPS コード
  country_ja,                   // fipsToJa(place)
  count,                        // その国のイベント数（フィードの「×N」＝件数）
  mentionsTotal,                // mentions 合計（globe 強度の補助）
  dominantRoot,                 // 最頻 root（同数は重大度 20>19>18 で決定）
  dominantRootJa,               // rootToJa(dominantRoot)
  topSources,                   // hostname 上位3（出現頻度順）
  time,                         // その国の最新イベント時刻（epoch ms, parseGdeltDate）
  lon, lat,                     // 代表点＝最多 mentions（同数は最新）のイベント座標＝flyTo 先
}
```
- 「×N」＝**件数（count）**。
- 空配列・`place` 空（未知国）は安全に扱う（空 place は素コード/「不明」にフォールバックして1グループにまとめる）。
- 純粋・deck/DOM 非依存。

### Unit 2 — サブタイプ日本語化（純粋・`js/lib/places.js` に追加）

```
rootToJa(root) -> '暴行' | '戦闘' | '大規模暴力' | '紛争'
severityRank(root) -> number  // 20>19>18>その他。dominantRoot の同数決着と globe 白熱度に使用
```
GDELT CAMEO root: 18=Assault(暴行) / 19=Fight(戦闘) / 20=Use unconventional mass violence(大規模暴力)。未知は「紛争」。

### Unit 3 — フィードのレイヤーチップ＋集約行（`js/ui/feed.js` 改修＋純粋状態）

- **チップ状態（純粋）**: 表示中レイヤー集合 `visible:Set`。
  - `feedChipIds(feedLayers, enabled)` → チップに出す layerId 配列（フィード対象かつ globe 有効なレイヤー＝地震/紛争/抗議/ニュース）。
  - `toggleChip(visible, id)` / `allActive(visible, ids)` / `applyChips(items, visible)`（`items.filter(it => visible.has(it.layerId))`）。
  - 永続: `localStorage` キー `orbis.feedFilter`（既存 `state.js` の readStored/保存流儀に合わせる）。既定＝全表示。
- **描画**: `index.html` の `#feed` に `feed-hint` の下へチップ行 `#feed-chips` を追加。チップは `[全]` ＋ 各レイヤー色ドット＋ラベル（地震/紛争/抗議/ニュース）。クリックでフィード内表示をトグル（**フィードのビュー絞り込みのみ**・globe トグル＝ENABLED とは独立）。`[全]` で全表示に復帰。アクティブ/非アクティブを CSS で明示。
- **集約行レンダ**: `renderFeed` は GroupRow を「色ドット＋『紛争 ウクライナ』＋ `×148` バッジ＋相対時刻」で描画。個別行（quakes/news）は従来どおり。イベント委譲は現行のまま（再生成に強い）。
- フィルタはレンダ直前に `applyChips` を適用。

### Unit 4 — 二段階クリック詳細（純粋 HTML・`js/lib/selection.js` 追加）

紛争・抗議で共用するレイヤー対応の汎用 popup（label/色は layerId から決定。「紛争」「抗議」を出し分ける）。

```
gdeltEventPopupHtml(event, layerId)   // globe 個別点用（記事リンク付き）
gdeltCountryPopupHtml(group)          // フィード行＝国サマリ用（group.layerId で出し分け）
```
- `gdeltEventPopupHtml(event, layerId)`: 「● {label}{紛争なら（{rootToJa}）}｜{country_ja}｜報道 {mentions}件｜出典 {hostname} ↗（記事）｜📍 この地点へ移動」。label＝紛争/抗議。サブタイプ括弧は**紛争のみ**（抗議は root 14 単一なので付けない）。**記事リンクは http(s) のみ許可**（`newsPopupHtml` と同じ XSS ガード）。`.sel-popup` クラスを流用。
- `gdeltCountryPopupHtml(group)`: 「● {label} {country_ja}｜24h {count}件{紛争なら・最多は{dominantRootJa}}｜主な出典 {a, b, c}｜📍 この地点へ移動」。記事リンクは持たない（個別点側で掘る）。「最多は…」節は**紛争のみ**。
- 色は既存 `LAYER_RGB`（紛争＝赤[255,60,80]／抗議＝緑[94,255,166]）。null/欠損安全。

### Unit 5 — globe 刷新（純粋 config ビルダ＋`main.js`/`conflict.js`/`protests.js` 配線）

base を **ember 化**し、**深刻度を白熱度（明度）で**表し、**上位国にホットスポット脈動**を足す。すべて ScatterplotLayer（globe 安全）。

- **ember base**（`conflict.js`/`protests.js` の `buildBlobConfig` を2層化）:
  - **halo**: 広く柔らかい加算ブロブ（半径 `blobRadius(mentions)`、低 alpha）。＝従来のヒート面。
  - **core**: 小さく明るい加算コア。色＝重大度（severityRank）＋mentions に応じて**白熱**（暴行＝深い赤[~200,40,50]、大規模暴力＝白熱[~255,220,200] へ補間）。加算合成で密集ほど明るく集積。
  - 既存 `ADDITIVE_BLEND`/`blobRadius`（`geo.js`）を流用。
- **hotspot 脈動**（純粋ビルダ・新規 `buildHotspotConfigs(groups, motionT, {reduced, topN, rgb})` を `aggregate.js` に・GroupRow を消費）:
  - `aggregateByCountry` の上位 `topN`（既定6）を **count 降順**で選び、代表点に脈打つリング/グロー（`quakeRippleLayer` 同様の motionT 位相）。色＝レイヤー色（紛争赤/抗議緑）。`reduced-motion` で省略。
  - `main.js` の `drawAll` の `extra` 層に、ENABLED の conflict/protests について追加（地震波紋・出現パルスと同じ並び）。
- **pick 層**は維持（`buildPickConfig`・`pickable:true`）。クリック判定は overlay の `pickingRadius`（現行）に委ねる。
- **比較足場**: `?cfx=A|B|C`（conflict fx プリセット）で ember 白熱度・脈動強度・topN をまとめて切替（既定 B）。`?look`/`?cmap`/`?sstmap` と同じ流儀。最終既定はユーザーが `python -m http.server` で**本番データ量の実画素**を比較して確定（headless 不可・スクショ目視＝mistakes.md）。

### Unit 6 — `main.js` 配線（クリック分岐・フィード onPick 分岐）

- **globe クリック**: `initMap` 第3引数のクリックハンドラに `conflict`/`protests` 分岐を追加（既存 flights/ships/news と同経路）。`info.object`（イベント）→ `selected = {lon,lat,title,layerId,at}` ＋ `selPopup.setHTML(gdeltEventPopupHtml(info.object, info.layer.id))` ＋ `flyTo` ＋ リティクル（`drawAll`）。**popup 'close' に状態解除を載せない**（既存方針・反復クリック回帰防止＝mistakes.md）。
- **フィード onPick**: `refreshFeed` の onPick で `it.kind === 'group'` なら `gdeltCountryPopupHtml(it)`、それ以外は従来 `selectionPopupHtml(it)`。flyTo 先は GroupRow の代表 `lon/lat`。
- `conflict.js`/`protests.js` の `toFeedItems` を **`aggregateByCountry` 経由の GroupRow を返す**よう変更（quakes/news は不変）。

### Unit 7 — CSS ＋ Service Worker

- `css/orbis.css`: `.feed-chips`/`.feed-chip`（アクティブ/非アクティブ・レイヤー色）、`.feed-count`（`×N` バッジ）、集約行の体裁。popup は既存 `.sel-popup` 流用。**モバイル（ボトムシート）でチップが折返す**こと（`@media<=768px`）を確認。
- `sw.js`: `index.html`/`main.js`/`css` を変更するため **CACHE を `orbis-v34` → `orbis-v35`** に上げる（PWA 更新反映・mistakes.md）。

## データフロー

```
conflict.json (2000 pts) ──aggregateByCountry──> GroupRow[] ──┐
protests.json (482 pts) ──aggregateByCountry──> GroupRow[] ──┤
quakes/news ── toFeedItems(個別) ─────────────────────────────┤
                                                              ▼
                                       buildFeed(time降順 top100)
                                                              ▼
                                  applyChips(visible) ─> renderFeed
                                                              │ onPick(group)→国サマリpopup+flyTo
                                                              │ onPick(個別)→従来popup+flyTo
globe: ember(halo+core) + hotspot脈動(上位国) + pick点 ── click → gdeltEventPopupHtml(記事) + flyTo
```

## エラー処理・エッジケース

- 空スナップショット / `points` 無し → 集約は空配列、フィードは「イベントなし」（既存）。
- 未知 FIPS / `place` 空 → `fipsToJa` フォールバック（素コード）、空は1グループに集約。
- `url` 欠損 / 不正スキーム → 記事リンクは `#`（http(s) のみ許可）。
- `mentions`/`root` 欠損 → mentions=0、root 未知は「紛争」・severity 最低。
- `prefers-reduced-motion` → hotspot 脈動・出現パルスを描かない（既存方針）。
- 加算合成の白熱が密集域で飽和し過ぎないこと＝`?cfx` で調整し**本番データ量の実画素**で確認。

## テスト計画

- **node:test（純粋）**:
  - `aggregateByCountry`: グループ化・count・mentionsTotal・dominantRoot（同数は重大度）・topSources 上位3・最新 time・代表点（最多 mentions）・空/未知 place。
  - `rootToJa`/`severityRank`: 18/19/20/未知。
  - `conflictPopupHtml`/`conflictCountryPopupHtml`: サブタイプ表示・出典・**記事リンク XSS ガード**（javascript: 無効化）・null 安全。
  - チップ状態: `toggleChip`/`allActive`/`applyChips`/`feedChipIds`・localStorage 永続。
  - `buildHotspotConfigs`: 上位 topN 選択・reduced で空・色。
- **Playwright e2e**（`workers:1` 維持＝flake 対策）:
  - フィードに国別集約行（`×N`）が出る。
  - チップで「紛争」を非表示→紛争行が消え地震/ニュースは残る／「全」で復帰。
  - globe 紛争点を**反復クリック**（2回目以降も）→記事リンク付き popup＋flyTo（mistakes.md の反復検証）。
  - フィード国別行クリック→国サマリ popup＋flyTo。
- **既存テスト緑維持**（現状 node:test 180 / Playwright 5 を下回らない）。
- **視覚検証**: 本番相当データ量で ember/白熱/脈動の実画素をスクショ目視（headless の見え方を結論根拠にしない）。`?cfx` で実物比較しユーザーが既定確定。

## 触るファイル

- 新規: `js/lib/aggregate.js`、対応テスト `tests/aggregate.test.js`
- 改修: `js/layers/conflict.js`・`js/layers/protests.js`（toFeedItems→集約、buildBlobConfig→ember）、`js/lib/places.js`（rootToJa/severityRank）、`js/lib/selection.js`（2 popup）、`js/ui/feed.js`（チップ＋集約行）、`js/main.js`（クリック分岐・onPick 分岐・hotspot 層）、`index.html`（チップ DOM）、`css/orbis.css`（チップ/バッジ）、`sw.js`（v34→v35）
- テスト: `tests/*.test.js` 追加・`tests/e2e/*.spec.js` 追加/更新
- **不変**: collector（Python）一式、registry の自動導出、drawAll キャッシュ機構の骨格

## 実装方針

運用の型＝spec→plan（writing-plans, TDD ユニット分解）→ subagent 駆動実装→ main 直 push→ Vercel 自動デプロイ→ curl/実機確認→ 記憶整理。globe 強度の最終既定は実物比較で確定。
