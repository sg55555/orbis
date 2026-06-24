# Orbis 機能ロードマップ ＆ Phase 0 設計（2026-06-23）

オーナー依頼：「Orbis 全体を見て追加機能を提案・実装」。本人優先＝① 日本語AI字幕の速度（品質維持）改善、② globe 国ドリルダウン（都市別詳細マッピング・是非含む）、③ 日本で市は出るが県が出ない違和感の解消。＋ Claude 推奨機能を並行検討。

5並行エージェントの read-only サーベイ（workflow weya1szbj）で全体を実証マッピング済み。

## 確定したビルド順（ユーザー承認 2026-06-23）

| Phase | 内容 | 状態 |
|-------|------|------|
| **0** | 県/admin1ラベル(A) ＋ 出典/鮮度パネル(E) ＋ 異常スパイク・アラート帯(D) | 本ドキュメントで設計・実装 |
| 1 | AI字幕 interim/refine（live-translate サーバ＋orbis client・**いきなり本命まで**） | 未着手 |
| 2 | globe 国ドリルダウン（**本格版＝独立国詳細＋都市別データ**・option2）＋ ウォッチリスト(F) | 未着手 |
| 3 | 山火事/FIRMS レイヤー(G)（要・無料 MAP_KEY） | 未着手（MAP_KEY 取得待ち） |

### サブPJ分解の備忘（失わないため）
- **B 字幕**：主因＝`live-translate/live_translate/vad.py` の `max_seconds=3.0`（最大3秒ためてから翻訳）＋ interim字幕なし（`CaptionEvent.final` は protocol にあるがclient未使用）。方針＝interim/refine（暫定→確定差し替え）＋ストリーミング翻訳＋ASR/翻訳パイプライン化＋VAD短縮＋文脈付与＋言語ピン。翻訳は鍵ありで Haiku、品質は文脈付与＋必要なら Sonnet opt-in。
- **C ドリルダウン**：現状「国クリック選択」無し（検索→重心 flyTo のみ）。`country_bounds.geojson`=国レベルのみ。ベースマップ(OpenFreeMap)は高ズームで県境/都市を既に描画。本格版＝国クリック→`fitBounds`枠取り→Natural Earth(public domain) admin1＋populated places 読込→既存FIPS紐付けデータ＋都市別集計→国詳細ビュー。推定6-9日。ユーザー意図＝「ドリルダウン後にこの地域にはこういうものがある、という詳細マッピング」。
- **F ウォッチリスト**：検索＋FIPS＋localStorage。C の回遊導線。
- **G FIRMS**：`quakes.py` 同型の点レイヤー収集。既存の遅いcron枠を再利用（Vercel Hobby rate-limit対策）。

---

## Phase 0 設計（実装対象）

共通方針：純ヘルパは TDD（node:test）。`onSelect→map.flyTo(zoom4-5,1500ms)` の全パネル共通契約に乗せる。globe 上に不透明面を置かない（square-blur-bleed 制約）。index/main/css 変更につき `sw.js` の CACHE 版を up（v42→v43）。

### A. 県/admin1 ラベル — `js/style.js`
`buildBaseStyle()` の `place-country` と `place-city` の間に `place-state` symbol 層を追加。
- `source-layer:'place'`, `filter:['in',['get','class'],['literal',['state','province']]]`（OMTは州/省でclassが分かれるため両方）
- `text-field:['coalesce',['get','name:ja'],['get','name']]`（県名は name:ja で日本語化）
- `minzoom` でズーム帯を設け `text-opacity` で淡くフェードイン、サイズ/色は country>state>city の階層が読める中間調、halo は既存準拠
- `tests/style.test.js` に state層アサート追加
- 新データ/新ライセンス/ビルド不要・完全可逆

### D. 異常スパイク・アラート帯 — 新規 `js/ui/alerts.js`
既存の計算済みデータ再利用（新規収集ゼロ）。
- 入力：instability の急上昇国（`topMovers` と同基準＝`trend.normal.deltaPct`/`trend.dod.delta`）＋ forecast の `attention_score` 高×`trend:'up'`
- 純ヘルパ `selectAlerts(instability, forecast, opts)`：閾値ゲートでノイズ抑制し重大度順に統合・重複排除 → `{kind:'instability'|'forecast', label, detail, severity, lon, lat}` 配列（上限N件）
- 純ヘルパ `alertChipHtml(alert)`：チップHTML（escape必須）
- 描画 `renderAlerts(rootEl, alerts, {onSelect})`：横スクロール可能なチップ列、クリック→onSelect(flyTo)。0件なら帯ごと非表示
- 配置：**globe直下・全幅バンド**（最初の下フォールドセクション・`#media`の上）。`sec-head`＋`scroll-reveal` 準拠
- テスト：`selectAlerts` の閾値/順序/重複排除、`alertChipHtml` のescape

### E. 出典・鮮度パネル — 新規 `js/ui/sources.js`
- 入力：各snapshotの `updated`（既存）＋ `window.__orbis.counts`（既存）＋ 層→出典の静的マップ（USGS/OpenSky/GDELT/AISStream/Open-Meteo/AI合成…）＋ `descFor()`
- 純ヘルパ `buildSourceRows(layers, snapshots, counts, sourceMap, now)` → `{id,label,updated,rel,count,source,url,stale}`（相対時刻整形）
- 純ヘルパ `sourceRowHtml(row)`：行HTML（escape必須・URLは http/https のみ）
- 描画 `renderSources(rootEl, rows)`：層別「名称／最終更新／件数／出典リンク」の表
- 配置：ページ最下部（`#forecasts`の下）の全幅フッターセクション「🛰 データソース & 鮮度」。既存 `#freshness` ピルは at-a-glance として残置
- テスト：`buildSourceRows` の相対時刻/stale判定、`sourceRowHtml` のescape＋URLサニタイズ

### 検証
- `npm run test:js` 全グリーン（基線322 pass）
- 県ラベルの実描画は GPU/フォント依存で headless 不可 → オーナーの実機サニティに委ねる（mistakes: GPU依存は実機確認）
- 統合＝worktree→main merge→push（push は確認の上・本番は push 契機でデプロイ）
