# ORBIS 海流レイヤー（Ocean Currents）設計

**日付**: 2026-06-14
**目的**: 世界の主要海流を「流れる発光トレイル」で可視化する新レイヤーを追加する。暖流/寒流を水温色（暖色/寒色）で分け、地球儀上で動きのある映える層にする。

## 方針決定（ユーザー合意）
- データは **主要海流の静的キュレート GeoJSON**（無認証・即実装・globe安全）。OSCAR等の実データ化はリスク/工数大のため将来フェーズに送る（海流は準定常なので静的でも意味がある）。
- **暖流/寒流を水温の色分け**で表現（暖色 vs 寒色）。
- 描画は **貿易ルートで実証済みの TripsLayer 発光トレイル方式**を再利用する。

## データ: `data/static/ocean_currents.geojson`
- `FeatureCollection`。各 feature は `LineString`、座標は **実際の流れの向き順**に並べる（TripsLayer のトレイルが正しい向きに流れるため必須）。
- properties: `name`（日本語名）, `name_en`（英名）, `type`（`"warm"` | `"cold"`）。
- 収録（約20本）:
  - 暖流(warm): 黒潮 Kuroshio / 対馬海流 Tsushima / メキシコ湾流 Gulf Stream / 北大西洋海流 North Atlantic Drift / ブラジル海流 Brazil / アガラス海流 Agulhas / 東オーストラリア海流 East Australian / モザンビーク海流 Mozambique / 北赤道海流 North Equatorial / 南赤道海流 South Equatorial / 赤道反流 Equatorial Counter
  - 寒流(cold): 親潮 Oyashio / カリフォルニア海流 California / フンボルト海流 Humboldt(Peru) / ベンゲラ海流 Benguela / カナリア海流 Canary / ラブラドル海流 Labrador / 西オーストラリア海流 West Australian / 南極周極流 Antarctic Circumpolar
- 各経路は globe で形が分かる程度の頂点数（6〜16点）。海岸/大洋の概形に沿わせる。緯度経度は概略でよいが、向き（北上/南下/東流）は正しく。

## レイヤー: `js/layers/currents.js`（統一I/F）
- `WARM_RGB = [255, 140, 60]`, `COLD_RGB = [70, 150, 255]`。
- `buildCurrentConfigs(geojson)`（純粋）→ `{ pathConfig }`:
  - `pathConfig`: id `currents`, data=全LineString feature, `pickable:true`, `getPath:(f)=>f.geometry.coordinates`,
    `getColor:(f)=> f.properties.type==='warm' ? [...WARM_RGB,70] : [...COLD_RGB,70]`（淡いベース）,
    `widthUnits:'pixels'`, `getWidth:1.4`, `widthMinPixels:1`, `jointRounded:true`。
- `currentsLayer`:
  - `id:'currents'`, `label:'海流'`, `marker:'line'`, `swatchColor` は代表色（グラデ表示のため CSS 側で暖→寒、JS は `'rgb(120,170,200)'`）,
  - `legend: [{color:'rgb(255,140,60)',label:'暖流'},{color:'rgb(70,150,255)',label:'寒流'}]`,
  - `async fetch()` → `fetch('data/static/ocean_currents.geojson').then(r=>r.json())`,
  - `toDeckLayer(geojson)` → `[ new deck.PathLayer(buildCurrentConfigs(geojson).pathConfig) ]`（ベースのみ。流れるトレイルは main.js が motion で重ねる）,
  - `tooltip(o)` → `o&&o.properties` なら `海流 ${name}（${type==='warm'?'暖流':'寒流'}）｜${name_en}`,
  - `toFeedItems()` → `[]`（海流はイベントではない）。

## main.js への統合（trade と同形）
- `ALL_IDS` に `'currents'` を追加。
- 静的ロード: `map.on('load')` の trade ロードと同じブロックで `snapshots.currents = await currentsLayer.fetch()`。
- `currentsFlowLayer()`（`tradeFlowLayer()` を踏襲）:
  - `currentsTrips` をキャッシュ（`snapshots.currents.features.map(f=>({ path:f.geometry.coordinates, timestamps:normalizedTimestamps(f.geometry.coordinates), warm:f.properties.type==='warm' }))`）。
  - `new deck.TripsLayer({ id:'currents-flow', data:currentsTrips, getPath:d=>d.path, getTimestamps:d=>d.timestamps, getColor:d=> d.warm?[255,170,90]:[120,190,255], widthUnits:'pixels', getWidth:2, widthMinPixels:1.5, trailLength:0.4, currentTime:motionT, fadeTrail:true, jointRounded:true })`。
- `drawAll()` の trade と同じ位置に `if (ENABLED.has('currents')) { const cf = currentsFlowLayer(); if (cf) extra.push(cf); }`。

## registry.js
- `currentsLayer` を import し `layers` 配列に追加（trade の近く）。
- `DECK_TO_LAYER` に `'currents': 'currents'`, `'currents-flow': 'currents'` を追加（tooltip 解決用）。

## パネル / CSS
- 新スウォッチ `marker:'line'` → `.swatch-line`: 短い横棒に暖→寒のグラデ発光（`background:linear-gradient(90deg,rgb(255,140,60),rgb(70,150,255))`, 高さ3px, box-shadow グロー）。
- 既存 `descFor`（registry）に海流の説明を1行追加（例「世界の主要な暖流・寒流。色＝水温（暖/寒）」）。

## テスト
- `tests/currents.test.js`（node:test）:
  - `buildCurrentConfigs`: warm/cold で getColor が暖色/寒色を返す、pathConfig.id==='currents'、data 件数。
  - `tooltip`: 暖流/寒流の日本語表記＋英名。
  - `toFeedItems` が `[]`。
  - データ整合: geojson を読み、全 feature が LineString かつ type∈{warm,cold} かつ name/name_en を持つ。
- e2e（任意）: currents トグルONで `currents`/`currents-flow` レイヤーが overlay に載る。

## 受け入れ基準
- パネルに「海流」行（line スウォッチ・暖→寒グラデ）。トグルON/OFF・localStorage 永続化。
- globe 上に暖流=暖色・寒流=寒色のトレイルが流れの向きに流れる。ベースの淡い経路も常時見える。
- ホバーで `海流 黒潮（暖流）｜Kuroshio`。
- node テスト緑・本番 Playwright で実描画（暖色/寒色の画素）・エラー0。sw v12。

## 更新（2026-06-14）: 二値→連続水温化
ユーザー要望: 暖/寒の二値ではなく、**経路に沿った連続的な水温を色の濃度（グラデーション）**で表す（合流域＝中間色、極寒＝濃い深色、暖かい寄り＝淡い等）。

- **データ拡張**: 各 feature の `properties.temps`（座標と同数の配列、各頂点の相対水温 0=極寒〜1=高温）をキュレート付与。`type`(warm/cold) は凡例/補助に残すが色は temps が主。
- **連続描画**: deck.gl の PathLayer/TripsLayer は色が経路単位のため、各海流を**頂点間で細分化したセグメント**に展開し `deck.LineLayer` で塗る。各セグメント色 = カラーマップ(セグメント中点の温度)。隣接セグメントで滑らかに遷移し、合流/強弱が濃度で出る。細分化は1セグメントを数分割して段差を消す。
- **カラーマップ（`?cmap=` で実物比較）**: `sst`(青→シアン→緑→黄→橙→赤・既定) / `twin`(寒=青の濃淡/暖=橙の濃淡) / `aqua`(寒=ティール/シアン・暖=アンバー, ネオン調)。`colorForTemp(t, cmap)` 純粋関数＋停止点補間 `lerpStops`。採用後に既定を確定し他は調整用に残す。
- **役割分担**: 色（水温）=ベースの LineLayer 帯が担当、動き=TripsLayer の明るい光トレイルが流れの向きに走る（トレイル色はセグメント平均温度を白寄りに明るくした発光）。
- **キャッシュ**: セグメント展開は cmap 毎に一度だけ計算し同一参照を返す（drawAll は rAF 毎に呼ばれるため再計算回避）。
- **tooltip 更新**: `海流 ${name}｜${name_en}｜水温 ${tempWord(temp)}`（temp<0.34 冷たい / <0.67 中間 / else 暖かい）。セグメント datum に name/name_en/temp を持たせ pickable。
- **テスト追加**: `colorForTemp` の両端と中間、`lerpStops` 補間、geojson 整合（temps 長さ=座標数・全 0..1）。

## 更新（2026-06-14）: 連続波 → 「区切れた面の順送り（チェイス）」
ユーザー指摘: 引き（ズームアウト）で流れの向きが依然わかりにくい。連続 sine 波の明滅は方向が読みにくい。→ **滑走路誘導灯のように、海流を離散セル（面）に分けて1つずつ順番に点灯→消灯させ、頭から尾へ光のパケットが進む**方式に転換する。方向性が一目で読めることを最優先。

### 確定した方向性（ユーザー合意）
- 流れの表現 = **区切れた面が順送り（チェイス）**。
- ベースの扱い = **淡い水温面（SST）を常時表示し、その上を明るいチェイスが走る**（色＝水温の連続情報を保持しつつ、明るさで向きを出す）。
- 微粒子は**一本化のため削除**（下記 main.js）。

### 描画の仕組み（`currents.js` の明るさ計算を波→チェイスに置換）
- 土台は既存 `buildCurrentField`（経路を密サンプルし各点に `phase`(経路上0..1)・水温色・温度を付与、純粋・テスト済）をそのまま使う。変えるのは「点ごとの明るさの決め方」だけ。
- **新・純粋関数 `chaseFactor(phase, motionT, opts)`** が `waveFactor` を置換:
  - `opts = { cells, tail, speed, base, peak, step }`（既定は定数 `CHASE_CELLS`/`CHASE_TAIL`/`CHASE_SPEED`/`WAVE_BASE`/`WAVE_PEAK`/`CHASE_STEP`）。
  - 各点を `cell = floor(phase * cells)`、セル中心 `center = (cell + 0.5) / cells` に量子化。
  - 動く点灯ヘッド `head = (motionT * speed) mod 1`。ヘッドとセル中心の**巡回距離** `d = cyclicDist(center, head)`（0..0.5、ラップ考慮）。
  - 明るさ = `base + peak * falloff(d, tail)`。`falloff` は `d=0` で 1、`tail` 幅で 0 へ鋭く減衰（点灯セル＝最大、直後数セルが短い尾、他は base＝消灯でも面は淡く見える）。
  - `step` ダイヤル: `'hard'`=セル単位でハード点滅（最も明快）/ `'glide'`=セル中心間をクロスフェード（上質）。`hard` は `falloff` をセル幅でステップ量子化、`glide` は連続。
- `toDeckLayer` の `getFillColor` は `FIELD_ALPHA * chaseFactor(d.phase, mt, opts)` で alpha を駆動（現行の `waveFactor` 呼び出しを差し替え）。加算ブロブ・`updateTriggers:{getFillColor:mt}` はそのまま。
- 既存 `waveFactor` は `?flow=wave` 比較用に残す（`toDeckLayer` が `ctx.flow` で分岐）。

### ブラウザ実物比較の調整ダイヤル（look.js / CHRONOGRAPH 流）
- `?flow=chase|wave`（既定 chase。旧 sine 波と並べて比較）。
- `?step=hard|glide`（ステップ感）。`?cells=`・`?tail=`・`?speed=`・`?peak=`・`?base=` でセル数/尾/速度/明るさを微調整可能（`currents.js` が `location.search` ではなく `main.js` から `ctx` 経由で受ける。main.js が URL を読み ctx に載せる）。
- `python -m http.server` で実物比較 → 既定値を確定し、他パラメータは調整用に残す。

### main.js の整理（YAGNI: 微粒子削除・一本化）
- `currentsFlowLayer()`（`currents-flow` ScatterplotLayer 微粒子・`CURRENT_PARTICLES`）と `drawAll()` 内の `if (ENABLED.has('currents')) { ... extra.push(cf) }` を**削除**。チェイスは `toDeckLayer`（ベースレイヤー）側で完結するため別レイヤー不要。
- `buildDeckLayers(..., { zoom, cmap, motionT })` の ctx に `flow`/`step`/`cells`/`tail`/`speed`/`peak`/`base` を追加（URL から読む）。`registry.js` の `DECK_TO_LAYER` の `'currents-flow'` エントリは削除（レイヤー消滅のため）。
- 不要になった import（`pointAlongPath`, `tempAtT` が他で未使用なら）を整理。`colorForTemp` は `currents.js` 内で使うため export 維持。

### テスト
- `currents.test.js` に `chaseFactor` テスト追加:
  - ヘッド位置のセル中心で最大（≈ base+peak）。
  - 尾（ヘッド直後）が中間値、遠方セルが base。
  - 巡回: head が 0 付近、center が 1 付近のセルでもラップして近接判定される。
  - `step:'hard'` は同一セル内で値が一定（量子化）、`glide` は連続変化。
  - `cells`/`tail` を変えると点灯範囲が変わる。
- 既存 `buildCurrentField`/`colorForTemp`/`lerpStops`/`tempAtT` テストは維持。
- 本番 Playwright: globe・**ズームアウト**・本番相当データ量でスクショ目視（離散セルが流れ方向へ順送りに点灯＝向きが画素で読めるか）。sw 版 +1。

### 受け入れ基準（更新）
- 引きで各海流の流れの**向きが一目で読める**（離散セルが頭→尾へ順送り点灯）。
- 淡い水温面(SST)は常時見え、色＝水温の情報が残る。
- `?flow=wave` で旧波と比較可能。`?step=hard|glide` 等で実物比較し既定確定。
- node テスト緑・本番で実描画＋エラー0・sw 版更新。

## 最終判断（2026-06-14・実物比較の結果）: チェイス棄却 → 波を採用
ユーザーがローカル実物比較（`?flow=chase|wave`・`step`/`cells`/…）した結果、**旧来の「面＋sine 波（waveFactor）」が最良**と判断。チェイス（離散セルの順送り）は採用しない。
- 当初の「波が動いていない（流れが読めない）」懸念は、実機検証で**波は正常にアニメーション動作**していることを確認（海流のみ表示・太平洋・引きで datum0 の alpha が 23→38→56→64→58→41 と振動・Playwright・エラー0）。perceived 問題であり実害なし。
- **撤去内容**: `chaseFactor`/`cyclicDist`/`CHASE_*` 定数、`toDeckLayer` の chase/wave 分岐、main.js の `FLOW`/`CHASE` URL パラメータと ctx 伝搬、対応テスト。`toDeckLayer` は波のみのシンプル実装に戻す。
- **維持**: 連続水温(SST)の面（ScatterplotLayer 加算ブロブ）＋ `waveFactor` の流れ＝最終形。微粒子(`currents-flow`)は不要と確認できたため戻さない（一本化のまま）。sw v13・registry の `currents-flow` 削除・データ/CSS swatch-line/e2e も維持。
- **学び**: 「動いていないように見える」報告は、まず**実機で動作の有無を計測**してから設計変更を判断する（思い込みで作り直さない）。新方式を入れる前に、現行が本当に壊れているかをスクショ/数値で確認する。

## 非対象（将来）
- OSCAR等の実データ化（u/v ベクトル場・パーティクル移流）。
- 海流の季節変動・強度の定量表示。
- 近接時専用の微細パーティクル・ディテール層（一本化で削除。必要なら別フェーズ）。
- 離散セルの順送り（チェイス）表現（今回比較で棄却。再検討する場合は本 spec の経緯を参照）。
