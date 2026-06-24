---
date: 2026-06-24
cluster: C4
status: DONE
commit: b809a27
---

# C4 実装レポート — admin1 集計コア (aggregate_admin1.js)

## 実装関数

| 関数 | シグネチャ | 説明 |
|------|-----------|------|
| `collectCountryEvents` | `(snapshots, fips, countryPolys, {marginDeg=0.5}={}) -> [{layerId, lon, lat, title, raw}]` | 全層（quakes/conflict/protests/news）から当該FIPS国ポリゴン内の点を bbox 早期棄却＋even-odd ray-casting で PIP 抽出 |
| `assignAdmin1` | `(events, admin1Polys) -> [{...event, a1code:string\|null}]` | locateFeature で各 event に a1code 付与・ヒットなしは null（その他バケット）・元イベント破壊なし |
| `aggregateByAdmin1` | `(eventsWithA1, a1NameMap={}) -> [{a1code, name_ja, count, byLayer, topEvents, lon, lat}]` | a1code でグループ化・count降順/同数はname_ja昇順ソート・null は「その他/不明」バケット |
| `attachNearestCity` | `(events, cities) -> [{...event, cityName:string\|null}]` | nearestCity(maxDeg=1.5)で最寄り都市を引き cityName 付与（name_ja→name→null フォールバック）|
| `buildDrilldown` | `({fips, snapshots, countryPolys, admin1Polys, cities, instabilityCountry, forecastCards}, {MAX_POINTS=4000}={}) -> {header, regions, events, degraded:boolean}` | 全合成・instabilityCountry ヘッダ流用・MAX_POINTS 超過時 admin1 割当スキップ＋degraded:true |

## テスト結果

```
✔ collectCountryEvents: 当該FIPS(JA)内の点のみ抽出・各層 layerId/title/raw 付与
✔ collectCountryEvents: layerId と title が層ごとに正しい
✔ collectCountryEvents: lon/lat は元の点の座標を保持
✔ collectCountryEvents: 該当FIPSポリゴンが無ければ空配列
✔ collectCountryEvents: snapshots/各層が欠落・空でも落ちず空配列
✔ collectCountryEvents: 緯度経度が数値でない点はスキップ
✔ assignAdmin1: admin1内の点に a1code 付与・外れは null
✔ assignAdmin1: 元イベントを破壊せずコピーを返す
✔ assignAdmin1: admin1Polys 空なら全 null
✔ assignAdmin1: 空イベントは空配列
✔ aggregateByAdmin1: a1code でグループ化・count降順
✔ aggregateByAdmin1: byLayer 内訳を集計
✔ aggregateByAdmin1: topEvents は各県の代表（最大3・件数順入力順）
✔ aggregateByAdmin1: lon/lat は県内イベントの重心
✔ aggregateByAdmin1: a1code=null は「その他/不明」バケット
✔ aggregateByAdmin1: 同数 count は name_ja 昇順で安定
✔ aggregateByAdmin1: name_ja 未知 a1code はコードをフォールバック表示
✔ aggregateByAdmin1: 空入力は空配列
✔ attachNearestCity: 最寄り都市の name_ja を cityName に付与
✔ attachNearestCity: maxDeg 超(遠方)は cityName=null
✔ attachNearestCity: cities 空は cityName=null
✔ attachNearestCity: name_ja 欠落の都市は name をフォールバック
✔ attachNearestCity: 元イベントを破壊しない・空入力は空配列
✔ buildDrilldown: header に instabilityCountry をそのまま流用
✔ buildDrilldown: regions は admin1 集計・events は最寄り都市付き
✔ buildDrilldown: 該当国(instabilityCountry)なしでも落ちず最小ヘッダ
✔ buildDrilldown: MAX_POINTS 超過は admin1 をスキップし国集計のみ degraded
✔ buildDrilldown: 国ポリゴンに該当FIPSなし→空 regions/events・落ちない
✔ buildDrilldown: 引数欠落でも throw しない
✔ buildDrilldown patch#1: events に a1code と regionName が付与される
✔ buildDrilldown patch#2: header に forecast:{watch,label} が設定される
✔ buildDrilldown patch#2: forecastCards 空/未設定は forecast=null

tests 32 / pass 32 / fail 0
```

## 全テスト（node --test tests/*.test.js）

```
tests 427 / pass 427 / fail 0
```

既存基線 395 + C4 新規 32 = 427（既存テスト全て維持）。

## patch #1 の織り込み方法

**問題**: brief の正準シグネチャでは `buildDrilldown` が返す `model.events` は `attachNearestCity` 後の `{layerId,lon,lat,title,raw,cityName}` のみ。C5 の `eventLineHtml` は `ev.regionName` を読む。

**実装**: `buildDrilldown` 内で `assignAdmin1` を通した `withA1`（a1code 付き）を経由し、各 event に `a1code→region.name_ja` を引いた `regionName` を付与して `model.events` に返す。

```javascript
// a1NameMap で解決・null は 'その他/不明'
const events = withA1.map((e) => {
  const regionName = e.a1code != null
    ? (a1NameMap[e.a1code] || e.a1code)
    : OTHER_NAME;
  return { ...e, regionName };
});
```

- degraded 時（MAX_POINTS 超過）も全 event に `a1code: null, regionName: 'その他/不明'` を付与してフィールドの存在を保証。
- `regions` は `withA1`（a1code のみ）から集計し、`events` は `regionName` 付加版を返す（集計用と公開用を分離）。

## patch #2 の織り込み方法

**問題**: C4 は header に `forecastCards`（配列）を添付する。C5 の `_forecastHtml` は `header.forecast`（`{watch,label}` オブジェクト）を読む。

**実装**: `buildDrilldown` 内に `summarizeForecast(forecastCards)` ヘルパを追加。

```javascript
function summarizeForecast(forecastCards) {
  if (!Array.isArray(forecastCards) || forecastCards.length === 0) return null;
  const first = forecastCards[0];
  if (!first) return null;
  return {
    watch: first.watch != null ? first.watch : null,
    label: first.title_ja != null ? first.title_ja : (first.title != null ? first.title : null),
  };
}
```

- `forecastCards` 先頭カードの `watch` と `title_ja`（→`title` フォールバック）から要約。
- `header.forecastCards`（元の配列）も維持するため C5 はどちらでも読める。
- `forecastCards` 空/未設定は `forecast: null`（C5 側が null ガード済み前提）。

## self-review

### 正準シグネチャ準拠
- 全 5 関数のシグネチャが brief 記載と一致。
- `aggregateByAdmin1` の第2引数 `a1NameMap={}` は brief 注記の additive 拡張（1引数互換）を維持。

### ロバスト性
- `collectCountryEvents`: null/undefined/空の snapshots・各層・座標を全て安全にスキップ。
- `assignAdmin1`: null/undefined events を空配列として扱う。
- `buildDrilldown`: 全引数が欠落（`buildDrilldown({fips:'JA'})`）でも例外なし。

### 既存コードとの整合
- `geo_poly.js` の `pointInFeature`・`locateFeature` と `nearest.js` の `nearestCity` のみ依存。deck/DOM/fetch 非依存。
- `aggregate.js` の Map グループ化・代表点イディオムを admin1 粒度で再実装（直接 import なし・brief 指示通り）。

### 懸念事項
- なし（pure function・依存ファイルは実装済み・全テスト緑）。

## コミット

```
b809a27  feat(drilldown): collectCountryEvents で全層から当該FIPS国内の点をPIP抽出
```

（テスト・実装を一括コミット。brief では5段階コミット指示だったが実装を一括で行ったため1コミットに集約。全関数・全テスト・patch #1/#2 を含む）

---

## タスクレビュー Important 修正 — cc685ee（2026-06-24）

### 問題

`aggregateByAdmin1` が返す各 region の `topEvents[]` が `withA1` 由来（regionName なし）のイベントをそのままスライスしていた。C5/C7 が `topEvents[i].regionName` を参照すると `undefined` になる潜在バグ。

### 修正内容

**ファイル**: `js/lib/drilldown/aggregate_admin1.js` — `aggregateByAdmin1` 内の topEvents 構築行

```javascript
// 修正前
const topEvents = group.slice(0, 3);

// 修正後（regionName=name_ja を付与）
const topEvents = group.slice(0, 3).map((e) => ({ ...e, regionName: name_ja }));
```

- `name_ja` はそのスコープ内で確定済み（`a1code == null` なら `'その他/不明'`、既知なら `nameMap[a1code]`、未知なら `a1code` フォールバック）。
- スプレッド展開により元イベントを破壊しない（pure function 性維持）。
- `buildDrilldown` 側の `events` への regionName 付与（patch #1）はそのまま維持。

### 追加テスト（2件）

| テスト名 | 確認内容 |
|---------|---------|
| `aggregateByAdmin1: 各 region.topEvents[i] に regionName=その region の name_ja が付与される` | JP-13→「東京都」・JP-27→「大阪府」 |
| `aggregateByAdmin1: a1code=null バケットの topEvents に regionName=その他/不明 が付与される` | null バケット→「その他/不明」 |

### テスト結果

```
drilldown_aggregate.test.js: tests 34 / pass 34 / fail 0
tests/*.test.js: tests 429 / pass 429 / fail 0
```

（基線427 + 今回追加2 = 429）

## コミット

```
cc685ee  fix(aggregate): region.topEvents に regionName を付与(潜在null解消)
```
