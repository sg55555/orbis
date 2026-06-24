# ORBIS 常設「凡例＋使い方」オーバーレイ — 設計書（spec）

- 日付: 2026-06-21
- スレッド: デザイン監修（リッチ化）／ worktree: `worktree-legend-help`
- 関連: `docs/superpowers/specs/2026-06-21-orbis-section-structure-design.md`（直前ゾーン③）、Obsidian `Projects/orbis-design-supervision.md`（所有アンカー）、`Projects/orbis-uiux-improvements.md`（P2-1 起点）

## 1. 目的・背景

初見ユーザーが globe 上の記号（赤＝紛争、白い三角＝航空機…）の意味を理解できない。これが UIUX backlog の **P2-1「凡例・ヘルプ追加」**。各レイヤーは既に `legend:[{color,label}]`（多段）・`marker`・`swatchColor`・`descFor(id)` を **保持済みだが、どこにも表示されていない**。本機能はこの既存データを**地表（UI）に出す**ことが本質で、新しいデータ生成は不要。あわせて主要操作（クリックで flyTo、下スクロールでメディア、機体クリックで進路…）の「使い方」も常設する。

## 2. 確定要件（ブレストで合意済み）

1. **形式**: 常設の凡例（常に存在・既定は折りたたみ）。
2. **深さ**: リッチ全段（各層の凡例を全段表示。地震=4段／海流・水温・気温=暖↔寒グラデ／ニュース=カテゴリ色／航空・船=方向記号）。
3. **配置**: globe 隅のオーバーレイ。折りたたみ時は小トグル、展開でスクロール可能なリッチ凡例。モバイルは既存ボトムシート/タブ機構へ。
4. **ヘルプ範囲**: 凡例＋使い方セクション。
5. **構造**: タブ式（展開時に上部チップで『凡例』⇄『使い方』を切替）。

## 3. 設計言語（厳守）

3ゾーン（mp-a / ui-a+font-on / sec-on）と統一する：
- orbis＝宇宙的/天体的。主アクセント＝地球の縁の大気ハロ（線/光）。**反射的にサイバーパンク HUD を足さない**。
- リッチさは「塊」でなく**線の密度・精緻さ・光の連動**で。サーフェスは `.side-panel` グラス＋大気ハロ言語（`::before` のオーロラ上線）に馴染ませる。
- 採用判断は localhost `?param` 実物比較＋オーナー実機。**GPU 依存（blur/glow/フォント）は必ず実機確認**（headless と乖離）。

## 4. アーキテクチャ（疎結合・各1責務）

| 単位 | 種別 | 責務 | 依存 |
|---|---|---|---|
| `js/lib/legend-data.js` | 新規・純粋関数 | `buildLegendModel(layers)` → カテゴリ別に凡例モデルを構造化して返す。**テストの主対象**。DOM/deck 非依存。 | `categories.js` の `groupLayers`、`registry` の `descFor` |
| `js/ui/legend.js` | 新規・描画/配線 | `renderLegend(rootEl)` → registry を読み model を生成し描画。タブ切替・折りたたみを配線。自己初期化（DOM 準備後）。 | `legend-data.js`、`registry`（layers, descFor） |
| `index.html` | 既存・追記 | `#map-wrap` 内に空コンテナ `<aside id="legend" class="side-panel legend-panel">` ＋ 末尾に `<script type="module" src="js/ui/legend.js">`。 | — |
| `css/orbis.css` | 既存・**末尾追記** | 「凡例(legend-)」ブロック。 | 既存トークン・既存クラス |
| `js/lib/immerse.js` | 既存・追記 | `immerseLegend(search)` → `?legend=on\|off`（既定 on）。`immerseClasses` に `legend-` を追加（**main.js 非編集**）。 | — |

設計の核：既存の **`groupLayers`（categories.js）と `descFor`（registry.js）と各 layer の `legend[]` を読むだけ**。新たな分類・新たな色定義は作らない（パネルと群分け・色が一致）。

## 5. データモデル（`buildLegendModel`）

```
buildLegendModel(layers) -> [
  {
    id, label,            // カテゴリ（出来事/移動/環境/その他）
    layers: [
      {
        id, label,        // レイヤー（地震/紛争/…）
        marker,           // dot|ring|triangle|diamond|line|gradient（無ければ 'dot'）
        swatchColor,      // 代表色（無ければ legend[0].color、無ければ var(--cyan)）
        desc,             // descFor(id)
        tiers: [ {color, label}, ... ]   // = layer.legend（無ければ []）
      }, ...
    ]
  }, ...
]
```

- グループ化は `groupLayers(layers)` を呼ぶ（出来事/移動/環境＋取りこぼし「その他」）。
  - **精緻化メモ**: ブレスト時の口頭呼称は「イベント/移動体/環境/インフラ」だったが、コード確認で **既存 `categories.js` の分類（出来事/移動/環境）を再利用**する方が**パネルと群分け・呼称が一致**し優れるため、これを採用（貿易は独立「インフラ」でなく「移動」配下）。凡例とパネルが同一カテゴリで揃う。
- 各レイヤーの `tiers` は `layer.legend`（quakes=4／currents=3／trade=2／news=動的N／flights・conflict・protests・ships=1 等）。
- `marker` / `swatchColor` の既定は panel.js `rowHtml` と同じフォールバック規則に揃える（`swatchColor || legend[0].color || var(--cyan)`、`marker || 'dot'`）。
- 純粋関数。layers 空 → `[]`。`legend` 欠落層 → `tiers: []`（安全）。

## 6. 描画（`renderLegend`）と DOM

`#legend`（`.side-panel.legend-panel`）の内部構造（legend.js が生成）：

```
<aside id="legend" class="side-panel legend-panel">     ← 隅配置・z-index 6・既定 collapsed
  <div class="panel-head">
    <h4>凡例 / Legend</h4>
    <button class="collapse-btn" aria-label="凡例折りたたみ">…</button>   ← 既存 .collapse-btn 流用
  </div>
  <div class="legend-tabs">                              ← .preset-chip 言語のタブ
    <button class="legend-tab active" data-tab="legend">凡例</button>
    <button class="legend-tab" data-tab="help">使い方</button>
  </div>
  <div class="legend-body" data-tab="legend"> … カテゴリ群 × レイヤー × tiers … </div>
  <div class="legend-body" data-tab="help" hidden> … 使い方リスト … </div>
</aside>
```

- **凡例タブ**: カテゴリ見出しは **パネルと同じ `.layer-cat-head` を流用**（同一グループ→同一見出し様式で一貫）＋各レイヤー名（代表 swatch 付）＋その下に tier 行（`.swatch.swatch-${marker}` を `style="color:${tier.color}"` で着色＋ tier.label）。swatch は panel.js と同じクラスを流用（形が正確）。
- **使い方タブ**（静的・直書き）:
  - 🖱 フィード/イベントをクリック → その地点へ移動（flyTo）
  - 🛩 航空機・船をクリック → 推定進路を表示
  - ⏬ 下にスクロール → ライブメディア（ニュース/カメラ）
  - 🎛 左パネル → レイヤー ON/OFF・プリセット切替
  - 🌐 ドラッグ・ホイール → 地球を回転/ズーム
- **タブ切替**: `.legend-tab` クリックで `.active` 付替＋対応 `.legend-body` の `hidden` 切替（DOM 操作のみ・状態は持たない）。
- **折りたたみ**: `panel.js` の `wireCollapse` と同思想で `#legend.collapsed` をトグル。**既定 collapsed**（小トグル表示）。
- **自己初期化**: `mobile-nav.js`/`scroll-reveal.js` と同様、module 末尾で `if (typeof document !== 'undefined' && document.getElementById('legend')) renderLegend(...)`。純粋関数 import は node:test で安全。

## 7. 配置（CSS）

- 既存占有: 左上 `#panel` / 右上 `#feed`,`#freshness`。**空いている右下 or 左下**に `#legend` を `position:absolute`・`z-index:6`。
- 折りたたみ時は小さなトグル（チップ大）。展開時は最大高を `max-height` で制限し `overflow:auto`（リッチ凡例をスクロール）。
- 最終位置（右下/左下）は localhost `?legend` 実物比較＋オーナー実機で確定（spec では「右下を第一候補」とし実装時に確認）。

## 8. immerse トグル

```
// ?legend=on|off（大小無視）。globe 隅の常設凡例＋使い方オーバーレイ。既定 on。
export function immerseLegend(search) {
  const m = /[?&]legend=(on|off)/i.exec(readSearch(search));
  return m ? m[1].toLowerCase() : 'on';
}
```
`immerseClasses` 末尾に `out.push('legend-' + immerseLegend(search))` を追加。CSS は `body.legend-off #legend { display:none }`（既定 on＝表示）。main.js は `immerseClasses` 適用済のため**非編集**。

## 9. モバイル

- デスクトップ隅オーバーレイはモバイルで邪魔になりうるため、**既存 `#mobile-tabs` / `#sheet-scrim` 機構に載せる**。
- 方針: `mobile-nav.js` の `nextSheet`（相互排他）と `data-sheet` 機構を拡張し、3つ目のタブ「凡例」を追加（`data-sheet="legend"`、`aria-controls="legend"`）。`current()` の許容値に `'legend'` を追加、`setSheet` の参照先 id 解決に `legend` を加える。
- CSS: モバイル幅では `#legend` を他パネルと同じボトムシート様式（既存 `.side-panel` のモバイル sheet スタイル）に従わせ、`body[data-sheet="legend"] #legend` で表示。
- 注意: `mobile-nav.js` は共有ファイル（複数スレッドが触りうる）。最小差分（許容値とラベル追加のみ）に留め、統合時はマージ衝突に注意。
- 詳細レイアウトは実装時に既存モバイル sheet の CSS を読んで適合（spec では機構の再利用方針のみ確定）。

## 10. 堅牢性・エラー処理

- データは registry 静的（fetch なし）→ 通信エラーなし。
- `layers` 空 → 空描画（クラッシュしない）。`legend` 欠落層 → tier 0 行で安全。
- JS 失敗時もコンテンツ消失を避ける（ゾーン③ `reveal-ready` ガードと同思想）。`#legend` は HTML に空コンテナを置き、legend.js が enhance。enhance 前は CSS で最小限（折りたたみトグルの体）に見せ、肥大化や生 markup 露出を避ける。

## 11. テスト

- **ユニット（node:test）** `tests/legend-data.test.js`:
  - `buildLegendModel(layers)` がカテゴリ順（出来事→移動→環境）で返る。
  - 各レイヤーの `tiers` 段数が `layer.legend.length` と一致（quakes=4, trade=2, currents=3, news=動的>0）。
  - `marker`/`swatchColor`/`desc` のフォールバックが panel.js と一致。
  - layers 空 → `[]`。legend 欠落 → `tiers:[]`。
  - registry 全層がいずれかのカテゴリ（または「その他」）に出る（取りこぼしゼロ）。
- **e2e（Playwright・隔離ポート）** `e2e/legend.spec.*`:
  - `#legend` が存在し**既定 collapsed**。
  - トグルで展開 → タブ2つ（凡例/使い方）。
  - 凡例タブに全 10 レイヤーの代表 swatch が出る／quakes に 4 tier 行が出る。
  - 使い方タブに操作リストが出る。
  - タブ切替で body の表示が入れ替わる。
  - `?legend=off` で `#legend` 非表示。
  - **隔離ポート必須**（バッチ実行の 8000 reuse 汚染回避＝mistakes.md）。
- **GPU 依存**（glow/blur/swatch 形）はオーナー実機（headless 非対応）。

## 12. SW / デプロイ

- `index.html`/`css` は SW network-first で反映＝**sw 版上げ不要**見込み（過去ゾーン同様、実装時に SW 戦略を確認して最終判断）。
- 新規 `js/lib/legend-data.js`・`js/ui/legend.js` も SHELL 外でネット優先取得。
- push は **Vercel Hobby デプロイ上限**を見て判断（cron と競合・[[vercel-hobby-deploy-rate-limit-cron]]）。

## 13. 共有ファイル・並行運用の注意

- `index.html`（script 追加・`#legend` markup）、`css/orbis.css`（**末尾**追記）、`js/lib/immerse.js`（関数追加）、`js/ui/mobile-nav.js`（許容値追加）は**複数スレッドが触る共有ファイル**。
- 統合は CLAUDE.md「origin/main 基準・他セッション未 push を温存し ff push」厳守。css 末尾衝突は**両ブロック保持**で解決（過去 preset-chip 衝突の前例）。

## 14. スコープ外（YAGNI）

- 凡例からのレイヤー ON/OFF 操作（パネルの役割。凡例は「読む」専用）。
- 凡例内容の i18n／英語切替（既存同様 日本語主・英語併記の範囲）。
- 凡例位置のユーザー設定永続化（折りたたみ状態のみ既定 collapsed・必要なら最小の localStorage）。
- globe 本体・boot の改変（他スレッド領分＝globe-density / design-loading）。

## 15. 完了の定義

- ユニット全緑・e2e（隔離ポート）全緑。
- localhost で `?legend=on/off`・タブ切替・全段表示・折りたたみを実物確認。
- main 統合→push→本番 curl/Playwright 確認。
- Obsidian `Projects/orbis-design-supervision.md`＋自動メモリ `project_orbis.md`＋`Projects/orbis-uiux-improvements.md`（P2-1 完了）を更新。
