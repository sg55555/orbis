# ORBIS Phase 3（操作性・分かりやすさ・動き）設計書

- **日付**: 2026-06-14
- **前提**: 全体設計 `2026-06-13-orbis-design.md`。Phase 1（地震）＋Phase 2（航空/紛争/抗議/貿易ルート、計5レイヤー）本番稼働済み（https://orbis-beta.vercel.app/）。
- **動機（ユーザーフィードバック 2026-06-14）**: 「①引くと丸い地球を外から見たい ②何が何を示すか分かりづらい ③動的な感じが弱い」。本フェーズで①②③を整える。
- **ステータス**: 設計合意待ち → writing-plans。

## 1. スコープ（4本柱）

### A. 地球を外から見るズームアウト
- MapLibre globe の `minZoom` を緩め（0 付近）、引くと**球体全体が宇宙に浮かぶ**ビューに。初期 zoom も少し引き（約1.2）。
- 背景に**軽量な星空**（`#map` 背後の CSS/canvas 星点）。task-dashboard の宇宙背景の知見を踏襲（点は一度生成し再乱数しない・モバイルは軽量化）。Aurora/Deep Navy と調和。
- 既存レイヤー描画・e2e に影響を与えないこと。

### B. 左レイヤートグルパネル
- Phase 2 の静的凡例を**インタラクティブなトグルパネル**に置換。各レイヤー＝チェックトグル＋凡例スウォッチ＋ライブ件数。
- トグルで `ENABLED` を更新→deck 再構築。**localStorage に永続化**（次回復元）。
- パネルは**折りたたみ可**（地図全画面化）。
- 純粋部: `loadEnabled(allIds, stored)` / `toggleEnabled(set,id)` をテスト可能に分離。

### C. ホバー/クリック詳細（picking ツールチップ）
- deck.gl は各レイヤー `pickable:true` 済み。overlay の `getTooltip` で、ホバー要素の**レイヤー別フォーマット**を表示。
  - 航空: 便名＋高度＋速度。 地震: `M{mag} {place}`。 紛争/抗議: `{place}（出典ドメイン）`。 貿易要衝: チョークポイント名。 航路: 航路名。
- 各レイヤーに任意の純粋関数 `tooltip(object)` を持たせ、deck レイヤーID→フォーマッタを引くレジストリ関数 `tooltipFor(deckLayerId, object)` を用意（テスト可能）。

### D. 右イベントフィード＋動的モーション
- **イベントフィード**: discrete time イベントを持つレイヤー（地震/紛争/抗議）が任意の `toFeedItems(snapshot)` を実装 → `{time,title,layerId,lon,lat}`。enabled 分を集約→time降順→上位約100件を右パネルに表示。クリックで `map.flyTo({center:[lon,lat],zoom:5})`。折りたたみ可。
  - 純粋部: `buildFeed(layers, snapshots, enabled)` をテスト（集約＋降順＋cap）。
- **動的モーション**（軽量・rAFループを main に1本）:
  - 貿易ルート: 航路ポリライン上を進む**フロー粒子**（ScatterplotLayer、t∈[0,1] を rAF で進め、線分補間で座標算出）。流れ方向を可視化。
  - 新規イベント: スナップショット更新で**新たに出現した id** を検出し、出現時に**パルスリング**（半径拡大＋フェード ~1.5s）。
  - 純粋部: 線分補間 `pointAlongPath(coords, t)`、新規id検出 `diffNewIds(prevIds, curr)` をテスト。
- モーションは描画負荷・モバイルに配慮（粒子数を抑制、`prefers-reduced-motion` 尊重）。

## 2. 実装順序（高価値＝分かりやすさを先に）
A 地球ズームアウト → B トグルパネル → C ツールチップ → D フィード → D 動的モーション（最後）。各段階で単独に意味がある。

## 3. ファイル方針
- `js/map.js`: minZoom/初期視点調整。
- `js/lib/starfield.js`（新）: 軽量星空（一度生成、低速 or 静止）。`index.html`/`css` に背景レイヤ。
- `js/ui/panel.js`（新）: 左トグルパネル描画＋localStorage（純粋部 `loadEnabled`/`toggleEnabled` は `js/lib/state.js` 等に分離）。
- `js/ui/feed.js`（新）: 右フィード描画＋flyTo。純粋集約は分離。
- `js/layers/*.js`: 各レイヤーに `tooltip(object)` と（地震/紛争/抗議は）`toFeedItems(snapshot)` を追加。
- `js/layers/registry.js`: `tooltipFor`、フィード対象列挙。
- `js/lib/geo.js` or `motion.js`: `pointAlongPath`、`diffNewIds`。
- `js/main.js`: パネル/フィード結線、getTooltip、rAFモーションループ、ENABLED 永続化。
- `css/orbis.css`: パネル/フィード/星空のスタイル。
- `index.html`: 左パネル・右パネル・星空コンテナの要素。

## 4. テスト（TDD）
- node:test: `loadEnabled`/`toggleEnabled`、`tooltipFor`（各レイヤーフォーマット）、`buildFeed`（集約/降順/cap）、`pointAlongPath`、`diffNewIds`。
- Playwright: トグルでレイヤーのON/OFFが効く（凡例件数や deck レイヤー数）、フィードに item が出てクリックで地図移動（center 変化）、ズームアウトで球体が見える（canvas存在＋低zoom可）。アサーションは弱めない。

## 5. 完了基準
引くと丸い地球が宇宙に浮いて見え、左パネルでレイヤーを絞れ（永続化）、マーカーにホバーで内容が分かり、右フィードで最新イベントを追えてクリックで飛べる。貿易ルートに流れ、新規イベントにパルス。全テスト緑→本番デプロイで確認。

## 6. 非目標（YAGNI / 後続）
- 船・航空機の snapshot 間移動補間、地震の本格波紋（Phase 5）。
- 船舶レイヤー（Phase 2b）、拡張層（P4）、下部ニュース混在グリッド（全体設計のP3ニュースは別途）。
- 完全なモバイル最適化（P5。本フェーズはパネルのオフキャンバス簡易対応まで）。
