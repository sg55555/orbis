# ORBIS フィード均等化（ラウンドロビン）設計書

- date: 2026-06-20
- status: 設計確定（実装計画はこの後 writing-plans で作成）
- 関連: Obsidian `Projects/orbis-uiux-improvements.md` P0-2、`Projects/orbis.md`（紛争セクション 2026-06-20）

## 背景・課題

紛争セクション改善（国別集約）後も、本番実機精査でフィードが**依然ほぼ全行が紛争国行**だと判明。原因＝紛争は国数が多く（50+国）全て同一収集時刻のため、`buildFeed` の**時刻降順 top100 で上位を占有**し、地震/抗議/ニュースが沈む。さらに紛争国行が**件数順でない**（アメリカ581件 と ベリーズ1件 が無秩序に混在）。フィードは常時表示の主要 UI ゆえ可読性は P0。

## 決定事項（ユーザー確認済み）

| 論点 | 決定 |
|---|---|
| 均等化方式 | **ラウンドロビン巡回**（各層を整列し1件ずつ交互配置・開いた瞬間から多様） |
| 層内整列 | 紛争/抗議＝**件数(count)降順**、地震/ニュース＝時刻降順 |
| 件数表示 | `×N` でなく**単位つき「N件」**（例 `581件`＝その国の24h報道件数）＋件数バーで大小を視覚化 |

## スコープ / 非スコープ

- **スコープ＝完全にクライアントサイド**（既存フィード基盤に追加）。collector(Python)・registry 不変、`main.js` の信頼性系（drawAll キャッシュ・ポーリング）非破壊。
- **非スコープ（YAGNI）**: 重要度スコアの層間正規化（採用せず＝ラウンドロビンで代替）／既定チップ状態の変更（現状の全表示を維持＝ラウンドロビンで既定多様化されるため不要）／時刻表記の改修（別項）。

## アーキテクチャ / ユニット分解

### Unit 1 — ラウンドロビン均等化（純粋・`js/lib/feed.js` に新規 `buildFeedBalanced`）

```
buildFeedBalanced(layers, snapshots, visible, cap = 100) -> item[]
```
- `visible`: 表示対象 layerId の Set（有効∩チップ非表示でない＝呼び出し側が算出）。
- 各 `layers` のうち `visible` に含まれ `toFeedItems` を持つ層について items を取得し、**層内整列**：
  - 紛争/抗議（`kind:'group'`）→ `count` 降順（同数は time 降順）。
  - その他（quakes/news 個別）→ `time` 降順。
- **ラウンドロビン**：層を一定順（`layers` の登場順＝registry 順で決定的）に並べ、各層の先頭から1件ずつ順に取り出す。尽きた層はスキップして次周へ。`cap` 件で打ち切り。
- 純粋・deck/DOM 非依存。空・layer 無し安全。

### Unit 2 — 件数の単位表示＋件数バー（`js/ui/feed.js` renderFeed）

- 集約行（`kind:'group'`）のバッジを **`{count}件`**（例 `581件`）に変更（旧 `×{count}`）。
- バッジに**件数バー**を添える：幅 ∝ 正規化値。正規化は**フィード内の最大 count を基準に log スケール**（`Math.log1p(count)/Math.log1p(maxCount)`）。大ホットスポットが一目で分かる。控えめ（行高を増やさない・バッジ下や背後の細い線）。
- 個別行（quakes/news）はバッジ無し（従来どおり）。
- 純粋ヘルパ `countBarPct(count, maxCount) -> number(0..100)` を切り出し node:test。

### Unit 3 — 配線（`js/main.js` refreshFeed）

- 現状：`allItems = buildFeed(feedLayers(), snapshots, ENABLED)` → `chipIds = feedChipIds(..., allItems)` → `items = applyChips(allItems, feedHidden)` → renderFeed。
- 変更：可視層集合 `visible = new Set(feedChipIds(feedLayers(), ENABLED, allItems).filter(id => !feedHidden.has(id)))` を作り、表示用は **`buildFeedBalanced(feedLayers(), snapshots, visible)`** に置換。チップ導出（どの層が項目を持つか）は従来どおり `buildFeed` の全項目から（`applyChips` は不要に）。
- renderFeed に `maxCount`（バー正規化用）を渡す（items から算出）。

### Unit 4 — CSS ＋ SW

- `css/orbis.css`: `.feed-count` を「件」表示＋件数バー（細い下線 or 背後グラデ・レイヤー色）。
- `sw.js`: `main.js`/`ui/feed.js`/`css` 変更のため CACHE 版を上げる（現行 → 次版・実装時に確認）。

## データフロー

```
各層 toFeedItems ─層内整列(紛争=件数降順/他=時刻降順)─┐
                                                    ▼
                            buildFeedBalanced(可視層, cap=100, ラウンドロビン)
                                                    ▼
                          renderFeed(items, maxCount) → 「N件」＋件数バー
                          （先頭から地震/紛争/抗議/ニュースが混在）
```

## エラー処理・エッジケース

- 可視層が1つ（チップで紛争のみ）→ その層を件数降順で全件（＝紛争の件数ランキング）。
- 項目ゼロ → 「イベントなし」（既存）。
- `count`/`time` 欠損 → 0 扱いで整列末尾。maxCount=0 のときバー幅0（除算ガード）。
- チップ非表示の層はラウンドロビン対象から除外（`visible` に含めない）。

## テスト計画

- **node:test（純粋）**:
  - `buildFeedBalanced`: ラウンドロビン巡回順・層内整列（紛争=count降順/他=time降順）・層が尽きたらスキップ・cap・`visible` フィルタ・空安全。
  - `countBarPct`: 正規化（0..100）・maxCount=0 ガード・log 単調増加。
- **Playwright e2e**（既存 conflict.spec を拡張 or 新規）:
  - フィード先頭付近に**複数レイヤーが混在**（先頭8行が全部 紛争でない＝種類が2つ以上）。
  - チップで紛争のみ表示→紛争行が**件数降順**（先頭の count ≥ 次）。
  - バッジが「N件」表記。
- 既存 conflict.spec / smoke 緑維持（`workers:1`）。

## 触るファイル

- 改修: `js/lib/feed.js`（`buildFeedBalanced` 追加）、`js/ui/feed.js`（renderFeed の「N件」＋件数バー、`countBarPct`）、`js/main.js`（refreshFeed 配線）、`css/orbis.css`（件数バー）、`sw.js`（版上げ）
- テスト: `tests/feed.test.js` 追加・`tests/e2e/conflict.spec.js` 拡張
- **不変**: collector、registry、drawAll キャッシュ骨格、`buildFeed`（チップ導出に残用）

## 実装方針

worktree（`worktree-uiux-audit`）で brainstorm→spec→plan→subagent駆動→ main 統合（fetch&merge&push）→ 本番検証。`?`param での見え方確認は不要（構造変更・色判断は別項）。
