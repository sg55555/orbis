# ORBIS Phase 3.5（デザイン磨き：浮かぶ地球・ネオン地図・分かりやすさ）設計書

- **日付**: 2026-06-14
- **前提**: Phase 1/2/3 本番稼働済み（https://orbis-beta.vercel.app/）。Phase 3 で操作性（パネル/フィード/ツールチップ/モーション）を入れたが、見た目と分かりやすさにユーザーフィードバックが出た。
- **動機（ユーザーフィードバック 2026-06-14）**:
  1. 引いても「丸い地球が宇宙に浮かぶ」感が出ていない。
  2. フィードクリックの flyTo がどこへ向かったか分からない。
  3. ツールチップ各値が何を指すか分からない（ガイドが欲しい）。
  4. 紛争は○点より「赤く塗る」面表現が良い。
  5. 球体はネオン調なのに、地図が乗ると黒グレーで気になる。
  6. プロでない監視者にも分かりやすく＆かっこよく。国名は日本語表記。海洋・陸地も分かりやすい色使い。
- **確定方針（ユーザー承認 2026-06-14）**: ベースマップ＝**無料ベクター(OpenFreeMap)＋ネオン濃紺カスタムスタイル**（キー不要・月0円・環境変数なしの現方針維持）。紛争＝**赤ヒートマップ**で地帯を塗る。6点を**一括の Phase 3.5 デザイン磨き**として実装。
- **ステータス**: 設計合意済 → writing-plans。

## 1. スコープ（6点）

### A. 浮かぶ地球の修正（#1, #5 の土台）
- 現 `map.js` の不透明背景レイヤー `{ id:'bg', background-color:'#05080f' }` が画面全体を塗り、globe の外側（宇宙＝星空 canvas）を隠している。**背景レイヤーを廃止/透明化**し、globe 投影の球体が背面の星空に浮いて見えるようにする。
- MapLibre globe の大気（atmosphere/限のグロー）は既定で出る。`center [0,20] / zoom 1.2 / minZoom 0` は維持（引けば球体全体）。

### B. ネオン濃紺ベクターベースマップ（#5, #6, 国名日本語）
- ベース＝OpenFreeMap ベクター（キー不要）。
  - 源: `sources.openmaptiles = { type:'vector', url:'https://tiles.openfreemap.org/planet' }`、`glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'`、`sprite:'https://tiles.openfreemap.org/sprites/ofm_f384/ofm'`。
- 独自スタイル（Deep Navy + Aurora 調）:
  - 背景: なし（透明）＝球体浮遊。
  - 海洋 `water`（fill）: 深い紺〜ティール（例 `#0a1b33`、限で `#10243f`）。陸地が引き立つ濃さ。
  - 陸地 `landcover`/`landuse`/`park`: ごく低輝度（例 `#0e1726`〜`#12203a`）。主張しすぎない。
  - 行政界 `boundary`（line, admin_level<=4）: シアン系グロー（`#39d0ff` 低 opacity + line-blur で淡発光）。
  - ラベル `place`（symbol）: 国名・主要都市を **日本語**（`text-field: ["coalesce", ["get","name:ja"], ["get","name"]]`）。ネオン halo（text-color 明るいシアン/白、text-halo-color 濃紺、halo-width）。
  - 日本語グリフは `Map` の `localIdeographFontFamily:'sans-serif'` でローカル描画（CJK グリフ大量DL回避）。ラテンは OpenFreeMap の `Noto Sans Regular` 等フォントスタックを使用。
  - ラベルはズーム段階で出し分け（国名=低ズーム、都市=中ズーム）。情報過多にしない。
- スタイル定義は `js/style.js`（新）に分離（map.js を肥大化させない）。
- 既存の deck レイヤー描画・パネル・フィード・モーション・e2e の構造に影響を与えないこと（ベースマップ差し替えのみ）。

### C. 紛争/抗議を「面」で塗る（#4）
- 紛争＝`HeatmapLayer`（赤グラデ、`getWeight` = mentions）。抗議＝`HeatmapLayer`（緑グラデ、同様）。地帯がにじむ面表現に。
- HeatmapLayer は picking 不可のため、**ホバー情報を保つため**に薄い小さな `ScatterplotLayer`（`pickable:true`、半径小・低 alpha）を重ねる（tooltip と feed の一貫性維持）。
- `toDeckLayer(snapshot)` は配列 `[HeatmapLayer, pickableScatter]` を返す（registry が flat 化）。tooltip は従来どおり点 object で発火。
- 凡例スウォッチ色は従来色（紛争=赤、抗議=緑）を維持。

### D. flyTo 着地マーカー（#2）
- フィード項目クリックで `selected = item` を保持し、その座標に**ネオンのハイライト**（持続リング＋中心ドット＋任意で小ラベル）を deck レイヤー `selected-marker` として描画。`map.flyTo` 後も残り、次のクリックで移動。
- 純粋部不要（描画のみ）。reduced-motion でもリングは静的表示（パルスはしない）。

### E. ガイド付きツールチップ＋レイヤー説明（#3）
- ツールチップを**ラベル付き**に（各値が何かを明示）:
  - 航空: `便名 {callsign}｜高度 {alt}｜速度 {velocity}`
  - 地震: `地震 M{mag}｜{place}`
  - 紛争: `紛争｜{place}｜出典 {domain}`
  - 抗議: `抗議｜{place}｜出典 {domain}`
  - 貿易要衝: `要衝 {name}`／航路: `航路 {name}`
- 左パネルの各レイヤー行に**1行の説明**（そのレイヤーが何を示すか）を添える（例: 航空＝「飛行中の航空機（OpenSky）」、地震＝「直近の地震（USGS・規模で大きさ）」、紛争＝「紛争関連報道の集中（GDELT・24h）」等）。常時 or ホバー(title)で表示。情報の意味が一目で分かるように。

### F. 仕上げ・整合
- 海陸・ラベル・ヒート・マーカーの色が Deep Navy + Aurora で調和し、プロでなくても「どこで何が起きているか」が一目で分かること。

## 2. 実装順序
A 浮かぶ地球（背景透明化・即効） → B ネオンベクター地図（土台・最大の見栄え） → C 紛争/抗議ヒート → D flyTo マーカー → E ガイド/ラベル → F 微調整。各段階で単独に意味がある。

## 3. ファイル方針
- `js/style.js`（新）: ネオン濃紺ベクタースタイル生成 `buildBaseStyle()`（OpenFreeMap 源＋海陸ラベル色）。純粋に style オブジェクトを返す（テスト可能）。
- `js/map.js`: `DARK_STYLE` を `buildBaseStyle()` に差し替え、`localIdeographFontFamily` 設定、不透明背景の廃止。globe/overlay/getTooltip は維持。
- `js/layers/conflict.js` / `protests.js`: `toDeckLayer` を `[HeatmapLayer, pickableScatter]` に。純粋部 `buildHeatConfig`/`buildPickConfig` を分離（テスト）。
- `js/layers/*.js`: tooltip をラベル付き文面に更新。
- `js/main.js`: `selected` 状態＋ `selectedMarkerLayer()` を drawAll に重畳。フィードクリックで selected 更新→flyTo→再描画。
- `js/ui/panel.js`: 各行にレイヤー説明（registry の `layer.desc`）を表示。
- `js/layers/registry.js`: 各レイヤーに `desc`（1行説明）を追加。
- `css/orbis.css`: パネル説明文・ツールチップ体裁の微調整。

## 4. テスト（TDD）
- node:test: `buildBaseStyle()`（OpenFreeMap 源/glyphs を含み、背景が不透明#05080f でない＝透明 or 無し／water・place レイヤーを含む／place の text-field が name:ja 優先）。`buildHeatConfig`/`buildPickConfig`（conflict/protests: data 反映・weight=mentions・pickable 点は小半径）。更新後の各 `tooltip()` 文面（ラベル付き）。
- Playwright: 既存の smoke を維持しつつ、ベースマップ差し替えで globe/パネル/フィード/zoom が壊れないこと。可能なら「低ズームで canvas 描画継続」「フィードクリックで selected-marker 出現（deck レイヤー id 存在）」を弱めず確認。
- 既存 45 + 新規が緑、pytest 11 緑、e2e 緑を維持。

## 5. 完了基準
引くと**ネオン濃紺の地球が星空に浮かび**、海と陸が色で分かれ**国名が日本語**で読め、紛争/抗議は**赤/緑の面**でにじみ、マーカーにホバーすると**ラベル付きの意味が分かる**情報が出て、フィードをクリックすると**飛んだ先にハイライト**が出る。全テスト緑→本番デプロイで確認。

## 6. 非目標（YAGNI / 後続）
- 完全な多言語切替 UI、地形3D・建物3D、詳細POI、道路網表示（情報過多回避。本フェーズは国名/主要都市/海陸/行政界まで）。
- snapshot 間移動補間・地震の本格波紋（P5）。船舶（Phase 2b）・拡張層（P4）・下部ニュース混在グリッド（別途）。
- OpenFreeMap セルフホスト（公共インスタンスで足りる。高負荷時に P5 で検討）。
