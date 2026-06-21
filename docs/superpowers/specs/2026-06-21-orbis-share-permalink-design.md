# 共有パーマリンク 設計

**日付:** 2026-06-21
**対象:** orbis（UI/UX バックログ P2「共有/パーマリンク」）
**位置づけ:** P2 残機能の1つ。現在のビュー（中心/ズーム）＋ON レイヤー集合を URL 化し、共有ボタンでコピー。リンクを開くとその状態を復元する。

## ゴール
監視ダッシュボードで「いま見ているこの視点・このレイヤー構成」を URL で共有・復元できるようにする。受け手がリンクを開くと、地図の中心・ズームと表示レイヤーが送り手と一致する。

## スコープ（確定）
- **含める**：地図の中心(lng/lat)・ズーム、ON レイヤー集合。
- **含めない（YAGNI）**：デザインダイヤル(?ui/mp 等)・開いているメディアタブ・選択中イベント。
- **共有 UX**：共有ボタン押下で現状 URL をクリップボードにコピー＋トースト通知（常時アドレスバー反映・ハッシュ形式は不採用）。

## アーキテクチャ
既存の疎結合パターン（純粋部を lib に分離・main.js が配線・immerse.js は `?param` を読む）に倣う。

### 1. `js/lib/permalink.js`（新規・純粋関数＝テスト可能）
- `parsePermalink(search)` → `{ center: [lng,lat]|null, zoom: number|null, layers: string[]|null }`
  - `?ll=<lat>,<lng>` → center `[lng,lat]`（MapLibre 順）。lat∈[-90,90] / lng∈[-180,180] 外・非数値は無効 → center=null。
  - `?z=<number>` → zoom。0..22 外・非数値は null。
  - `?layers=<id,id,...>` → id 配列（空要素除去）。`layers` キー自体が無ければ null（＝既定を使う）。`?layers=`（空値）は空配列 `[]`＝全 OFF。
  - immerse.js と同様に正規表現で読み、未指定/不正は null フォールバック（silent 切り捨てでなく既定挙動）。
- `buildPermalink(baseUrl, { center, zoom, layers })` → URL 文字列。
  - `?ll=<lat:4桁>,<lng:4桁>&z=<zoom:2桁>&layers=<id,...>`。座標 `toFixed(4)`（~11m）・ズーム `toFixed(2)`・layers は `join(',')`。
  - center/zoom/layers が未指定のキーは省略（堅牢）。`baseUrl` は `origin + pathname`。

### 2. `js/main.js`（最小改修）
- 起動時に `const pl = parsePermalink(location.search)`。
  - **レイヤー**：`pl.layers` が非 null なら `ENABLED = new Set(ALL_IDS.filter(id => pl.layers.includes(id)))`、null なら現状 `loadEnabled(...)`。
  - **ビュー**：`pl.center` / `pl.zoom` があれば `initMap` の初期 center/zoom に渡す（フラッシュ無しで初期化）。`initMap` に `center` 引数を追加（既定 `[0,20]`・後方互換）。
  - **localStorage 不変**：permalink 由来の ENABLED は `writeStored` しない（一過性＝受け手の保存設定を壊さない）。以後のユーザートグルは従来どおり保存。
- 共有ボタンのハンドラ：`buildPermalink(location.origin + location.pathname, { center:[map.getCenter().lng, map.getCenter().lat], zoom: map.getZoom(), layers:[...ENABLED] })` → `navigator.clipboard.writeText(url)` 成功でトースト「リンクをコピーしました」。clipboard 不可（非セキュア/古い環境）なら URL をトースト表示してフォールバック。

### 3. 共有ボタン UI（index.html ＋ css/orbis.css ＋ 小 JS）
- 右下「凡例 / LEGEND」近傍に「🔗 共有 / SHARE」ボタンを新設（既存の glass＋ネオン言語 ui-a に統一）。
- トースト：小さな一過性要素（フェードイン → 数秒で自動消滅）。既存トースト機構があれば再利用、無ければ最小実装（`#share-toast`）。

## データフロー
- 読込：URL → `parsePermalink` → {center,zoom,layers} → `initMap(center,zoom)` ＋ ENABLED 上書き → 描画。
- 共有：ボタン → `buildPermalink` → clipboard → トースト。

## 既定・決定
- URL 形式＝クエリ（既存 `?param` 規約に整合）。共有 URL は origin+pathname＋ll/z/layers のみ（他の `?param` は引き継がない＝スコープ外の意図的除外）。
- 座標精度 4 桁（~11m）・ズーム 2 桁。
- スナップショット schema/コレクタ/API 不変。SW network-first ゆえ版上げ不要。新規依存なし。
- main.js は起動時のビュー/レイヤー適用と共有ボタン配線のみ最小追加（既存の `location.search` 読みと同型）。

## テスト（TDD）
`tests/permalink.test.js`（node:test）：
1. `parsePermalink`：正常（ll/z/layers）→ 正しいオブジェクト（center は [lng,lat] 順）。
2. 欠落 → 各 null。
3. 範囲外 lat/lng/zoom・非数値 → null。
4. `layers` の空要素除去・`?layers=` 空値 → `[]`・キー無し → null。
5. `buildPermalink`：丸め（4桁/2桁）・join・未指定キー省略。
6. **round-trip**：build → parse で（丸め誤差内で）一致。

（クリップボードコピーは headless で不安定なため e2e は URL 復元のみ軽く確認＝`?ll&z&layers` 付きで開くと map 中心/ズーム/ON レイヤーが一致するか。）

## 残る論点（既知・許容）
- 共有 URL は他の `?param` を引き継がない（デザインダイヤルはスコープ外）。将来必要なら拡張。
- ライブ・アドレスバー反映は将来候補（今回はボタンコピーのみ）。

## 統合・デプロイ
- 専用 worktree `share-permalink`（origin/main 基準）。
- origin/main マージ → `HEAD:main` ff push（ローカル main 不変・[[git-shared-main-tree-integration-collision]]）。
- Vercel Hobby のデプロイ日次上限に注意（[[vercel-hobby-deploy-rate-limit-cron]]）＝反映は本番 curl＋実描画で確認。
