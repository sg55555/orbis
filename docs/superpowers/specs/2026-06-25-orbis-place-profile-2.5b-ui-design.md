# Orbis 地域プロフィール 2.5b UI 設計（ブラウザ実物比較で確定）

> 2026-06-25 brainstorming 確定。親 spec `2026-06-24-orbis-place-profile-drilldown-design.md`（Phase2.5 全体）
> の Section 6（UI）を、太田さんとブラウザ実物比較して**具体レイアウトと実装アーキテクチャ**に落とす。
> 2.5a（ダミー生成パイプライン）完了済・本 doc は **2.5b（UI 描画＋配線）** の設計。
> 承認済みモック：`docs/superpowers/mockups/place-profile-2.5b/`（mockup-c.html ＋ approved-c-*.png）。

## 1. 確定したレイアウト（案C：中央フロートページ）

3 案（A 右パネル380px / B 右パネル520px / C 中央フロート）をダミーデータ＋orbis 実配色で実機比較し、
**案C を採用**（太田さん決定）。「個別ページ風（フロートページでもよい）」要望への忠実度・没入感を優先。

- **シェル**：globe を暗幕スクリム（`--bg-scrim-b` 相当）で薄暗く落とし、中央に**フロートページ**
  （幅 `min(920px, 95vw)`・最大高 `92vh`・内部スクロール・角丸16px・縁にオーロラ細線/外側 glow＝線/光/縁）。
  閉じる手段＝×ボタン＋スクリムクリック＋Esc。★（ウォッチリスト toggle）はページ右上角。
- **設計言語整合**：面ガラスの多用を避け、近不透明地（`rgba(7,11,20,0.97)`）＋オーロラ縁＋glow。
  並行のデザイン監修スレ（secfit=on＝HUD 見出し・線/光/縁・面禁則）と馴染ませる。
  **統合時に最新 main の設計言語（`.sec-h` 等のトークン）へ寄せる**。

## 2. 全部入りヒーロー（確定構成）

太田さん要望「都市名の右の余白に区域の形状イラスト（画像とは別に）」を反映。ヒーロー＝3 視覚要素：

```
┌ メディアスタック ────────┐   ┌ 識別カラム ─────────────────────────┐
│ 画像スロット             │   │ [ADMIN1 県]  ← 種別 HUD バッジ        │
│ （将来 Wikipedia サムネ）│   │ 東京都  Tōkyō      ╱⌒ 形状シルエット │
│   └ ミニグローブ（右下） │   │                    （実ポリゴン由来）│
│      ＝位置（球＋発光ドット）│   │ ┌人口┬面積┐                        │
└──────────────────────────┘   │ │13.96M│2,194km²│ ← データ HUD(2×2) │
                                │ └位置┴特別区┘                       │
                                └─────────────────────────────────────┘
```

- **画像スロット**：将来の Wikipedia サムネ用の枠（今はプレースホルダ＋極淡ハッチ）。
- **ミニグローブ**：その地域の**位置**（球＋graticule＋発光ドット）。画像スロット右下にコーナーインセット。
  実装では flyTo 中心 / 地域重心からドット座標を出す。
- **形状シルエット**：その地域の**形**（輪郭）。地域名の右の余白に配置（シアン線＋glow・極淡 fill）。
  → §4 で生成方法を定義。
- **種別バッジ**：`国 / 県 / 都市`（COUNTRY/ADMIN1/CITY）＋日本語。HUD ピル。
- **データ HUD**：`facts`（人口/面積/位置/標高ほか取得できた範囲）をモノスペース風 2×2 グリッド。欠落は出さない。

## 3. 本文・フッタ（spec Section 6 を踏襲）

- **セクション**：`概要/気候/特産・名物/主要産業/交通・地理/観光名所` を縦に。各見出し＝Saira＋左寄せオーロラ下線＋
  SVG アイコン（stroke 流儀）。`sections[]` の順序・有無に追従（空は描かない）。
- **近隣の最近の動向**：`<details>` で**既定折りたたみ・下部・小さく**（サマリ＝件数バッジ）。
  中身は Phase2 集計（国/県＝admin1 集計、都市＝近接）を model 経由で受け取り描画（profile_view は集計しない）。
- **出典**：Wikipedia(ja) リンク ＋ QID。`source` から。
- **パンくず**：`日本 › 東京都 › 新宿区`。各段クリックでその階層のプロフィールへ。最上位は国名のみ。
- **degraded**：`degraded:true`（QID 無し/本文皆無）は警告バナー＋facts＋出典のみ（セクションは空）。
- **モバイル**：中央カードでなく**全幅ボトムシート**（下端から せり上がり・角丸上端・ドラッグハンドル）。
  Phase2 の bottom-sheet 機構を流用。内容（profile_view 出力）は同一。

## 4. 形状シルエットの生成（クライアント・既存データ流用＝スキーマ非変更）

profile JSON にはシェイプを持たせず、**クライアントが既に読み込み済のポリゴンから実行時に生成**する。

- 国＝`country_bounds` の当該 feature（`boundsPolys`・locateFeature の hit）。
- 県＝`loadCountryGeo` が取得する admin1 GeoJSON の当該 feature（PIP で特定した a1code）。
- 都市＝点データのみ＝**ポリゴン無し → シルエット省略**（ミニグローブのドットのみ）。

純関数 `regionShapePath(geometry) -> { d, viewBox } | null`（`js/lib/drilldown/region_shape.js`）：
GeoJSON Polygon/MultiPolygon → 外環のうち最大面積を選択 → bbox 正規化（長辺=100・短辺は比率・**Y 反転**）→
点が多ければ間引き（~80点）→ SVG パス文字列。空/不正は null。node テスト対象。
（モック検証で JP-13 実ポリゴン → `viewBox 0 0 100 40.2` の妥当なパスが出ることを確認済。）

## 5. 実装アーキテクチャ（Phase2 機構を最大流用）

`#drilldown` 要素と `country_click.js` コントローラを**流用**し、右ドック→中央フロートへ**再スタイル**する
（新規パネルは作らない）。JS 変更は最小、主に CSS＋スクリム/Esc＋プロフィール描画差し替え。

### 新規
- `js/lib/drilldown/profile_view.js`（純関数）：`profileHtml(model)`＝schema＋付帯（breadcrumb/shapePath/events）→ HTML。
  全出力 escapeHtml。`region_shape.js`／`facts` 整形ヘルパもここ or 併置。
- `js/lib/drilldown/region_shape.js`（純関数）：§4。
- `js/lib/drilldown/profile_data.js`（DI seam・country_data.js と同型）：`loadProfile(level, id, {manifest, fetchFn})`
  → `data/static/profiles/{country/<FIPS>.json | admin1/<a1>.json.gz | city/<qid>.json.gz}`。gz は DecompressionStream gunzip。
  manifest（`profiles_manifest.json`）事前判定で 404 回避。in-flight 共有＋成功キャッシュ。
- `js/lib/drilldown/resolve_place.js`（純関数）：`(lon,lat, {countryFeature, admin1Polys, cities, manifest}) ->`
  `{ chain:[{level,id,name_ja}], target }`。**最も具体の、かつ manifest にプロフィールが在る階層**を target に。
  都市が近接で profile 在り→city、無ければ admin1（PIP）、無ければ country。breadcrumb=chain。

### 改修
- `js/ui/drilldown.js`：`renderDrilldown` のプロフィール分岐（`.dd-body` に profile_view 出力）。
  パンくずクリック→ onNavigate(level,id)。close に Esc/スクリム配線（render 側 or main）。
- `js/ui/country_click.js`：openCountry を「クリック→resolve_place→loadProfile→model 組立→render→flyTo」に拡張。
  既存の token レース破棄・deck pick 排他・flyTo（bboxCenter）はそのまま。
  navigate（breadcrumb/再クリック）で同経路を別 level で再実行。★/watchlist 維持。
- `css/orbis.css`：`#drilldown` を中央フロート＋スクリムに再スタイル＋`.pf-*`（承認モック shared.css を移植）。
  既存の右ドック grid（`body.drill-open #map-wrap`）は撤去 or フロート用に置換。モバイルはボトムシート。
- `index.html`：`#drilldown` に scrim 兄弟要素（or `::backdrop` 相当）。`.dd-body` は流用。

### モデル（caller が組み立て、profile_view は純粋に描画）
```
model = {
  profile,                       // 取得した JSON（schema 5節）
  breadcrumb: [{level,id,name_ja}],
  shapePath: {d, viewBox} | null,
  miniDot:   {lon, lat} | null,  // ミニグローブの発光ドット
  events:    [...],              // Phase2 集計済（折りたたみ用）
}
```

## 6. テスト戦略（2.5b）

- **node（純関数）**：`profile_view`＝全セクション/一部欠落/degraded/XSS エスケープ/パンくず/イベント折りたたみ。
  `region_shape`＝Polygon/MultiPolygon→最大環選択・正規化・Y 反転・間引き・空→null。`resolve_place`＝
  最具体かつ manifest 在りの target 選択・フォールバック（city無→admin1→country）。`profile_data`＝
  gz gunzip・manifest gating・in-flight 共有（country_data の fake パターン流用）。
- **実機（Playwright/手動）**：日本ダミーで 国/県/都市クリック→フロートページ描画／形状シルエット（県）/
  ミニグローブ／パンくず遷移／イベント折りたたみ／flyTo 寄り／Esc・スクリム閉じ／モバイル全幅シート。

## 7. スコープ・非対象（2.5b）

- 対象＝**日本ダミーで体裁が見える**ところまで（UI 描画＋配線＋形状/ミニグローブ＋ナビ＋モバイル）。
- 非対象＝実 LLM 生成（2.5c・将来）／全地域生成／画像スロットの実画像（将来サムネ）／
  共有ルート(#/place/…)（permalink 統合は別）。
- 都市シルエットは点データのため省略（フォールバック）。将来 city ポリゴン源があれば追加。

## 8. 統合時の注意（並行 main）

- main は別スレッド並行更新中 → **統合前に `git fetch`**、最新から。
- `css/orbis.css`・`index.html` は共有大ファイル → **デザイン監修スレの secfit/HUD 変更と衝突確認**（領域は
  #drilldown 末尾 vs secfit 中盤で分離気味だが要確認）。設計言語トークンは最新 main に合わせる。
- 統合＝main で merge → push（Vercel）。実機サニティ（GPU/globe 依存のクリック→flyTo）は太田さん。

## 9. 受け入れ（太田さん実機・2.5b）
日本ダミーで：国/県/都市クリック→中央フロートのプロフィールがページ風に出る／ヒーローが全部入り（画像枠＋
ミニグローブ＋種別＋名前＋実形状シルエット＋データHUD）／6セクションが事実欄付きで読める／イベントが下部に
小さく折りたたまれる／パンくず遷移／flyTo が寄る／Esc・スクリムで閉じる／モバイル全幅シート。OK なら 2.5c。
