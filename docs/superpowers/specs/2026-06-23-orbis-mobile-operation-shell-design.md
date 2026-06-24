# Orbis モバイル操作UIシェルのリッチ化（一体の観測コンソール）— 設計

- 日付: 2026-06-23
- スレッド: デザイン監修（リッチ化）／所有ノート: Obsidian `Projects/orbis-design-supervision.md`
- 対象: モバイル（≤768px）の操作UIシェル = 下端タブバー（#mobile-tabs）＋ボトムシート（#panel / #feed / #legend）＋ディマー幕（#sheet-scrim）
- 強度の中心: **宇宙的トーンで上品**（大気ハロの線/光を主役・発光は抑制的・globe と調和）
- アプローチ: **案1 = 一体の「観測コンソール」**（タブバー＋シートを共通の光言語で統一）

## 背景・問題

モバイルは globe を全画面の主役にし、LAYERS/FEED/LEGEND をボトムシート化する構造（既存・良好）。
本番を iPhone 393px で実測した結果:

- globe 初期ビューは大気ハロ＋深宇宙背景で**良好**。
- 一方、操作UIシェルは**機能的だが地味**:
  - 下端タブの**アイコンが「≡」3つとも同一**（layers/feed/legend の区別がつかない・記号として無意味）。
  - タブバー・シートに、デスクトップで確立したリッチ化（左アクセント/glowドット/オーロラ下線見出し/グラス縁）が**小画面で目立たず「素のリスト感」**。
  - シートのハンドル・上縁・ディマーが素っ気なく、「観測パネルが立ち上がる」体験になっていない。

デスクトップのリッチ化クラス（mp-a/ui-a/font-on/sec-on/feed-on）は**常時付与**されモバイルでも効いているが、モバイル固有のメディアクエリは**レイアウト調整（ボトムシート化・padding縮小・1カラム化）が中心**で、モバイル専用の「演出・質感の作り込み」が無い。本設計はそこを埋める。

## 設計言語（厳守）

- orbis = 宇宙的/天体的。主アクセント = **地球の縁の大気ハロ（線/光）**。サイバーパンクHUDを反射的に足さない。
- リッチさは「塊」でなく**線の密度・精緻さ・光の連動**。
- **「面」装飾は使わない**（radial-gradient の面はグラスUIの blur 越しに四角く滲む = 星雲面廃止 06ee971 / space不採用 f3f8d97 と同根）。点（dot/line）と既存サーフェスの縁/glow で表現する。
- globe 主役を邪魔しない**抑制的**な発光（脈動は無し or 極微）。
- 採用は **localhost `?param` 実物比較 ＋ オーナー実機**。GPU依存（blur/glow/フォント）は headless と乖離するため実機が最終判断。

## アーキテクチャ・非破壊性

既存の `?param` ダイヤル規約（mp/ui/font/sec/legend/feed/space と同型）に乗せる。

- `js/lib/immerse.js`:
  - `immerseMobileUi(search)` を追加。**`?mui=a|b|off`**（大小無視）。既定 `a`。
    - `a` = 上品（採用候補）／`b` = もう一段攻めた発光・密度（比較用）／`off` = before（base のまま・アイコンは「≡」に戻す）。
  - `immerseClasses(search)` に `out.push('mui-' + immerseMobileUi(search))` を1行追加 → body に `mui-a|mui-b|mui-off` を常時付与。
  - **main.js は immerseClasses 適用済で非編集**。
- `css/orbis.css`:
  - **末尾**に新ブロック「モバイル操作シェル（mui-）」を追記。すべて `@media (max-width: 768px)` 内、`body.mui-a` / `body.mui-b` スコープ。
  - **既存の `@media(max-width:768px)` レイアウトquery（ボトムシート機構・padding・1カラム）は不変**。本ブロックは上乗せのみ。
  - css 末尾は複数スレッドが追記し衝突しがち → マージ時は必ず両ブロック保持（既知の運用知見）。
- `index.html`:
  - `#mobile-tabs` の各 `.mobile-tab` に**線画SVG（inline）**を追加。`off` 比較のため既存テキストラベル（「レイヤー」等）は残し、先頭の「≡」記号を SVG に置換。CSS で `body.mui-off` のときは SVG を隠し「≡」フォールバック（before）。
- **mobile-nav.js / feed.js / legend.js は非編集**（DOM配線・データは不変。見た目のみ CSS＋アイコンmarkup）。

## コンポーネント設計

### A. 下端タブバー（#mobile-tabs / .mobile-tab）

1. **アイコン刷新**（線画SVG・stroke ベース＝「線」言語）:
   - layers = 重なった板（3枚スタックの線画）。
   - feed = 信号ライン（横軸＋振れる折れ線、or 点を伴うタイムライン）。
   - legend = 記号キー（小さな ● / △ を鍵状に並べた線画、or 鍵アイコン）。
   - stroke 色は基調シアン（`--cyan`）。既定（非アクティブ）は控えめ opacity、アクティブで stroke 発光。
   - `body.mui-off` では SVG 非表示 → 既存「≡」テキスト（before）。
2. **アクティブタブの発光**: 現状 border-cyan＋box-shadow に加え、**オーロラ下線グロー**（sec-h と同じ光言語＝下辺のグラデ＋淡いグロー）＋アイコン stroke の drop-shadow 発光。
3. **バー上端の極細オーロラハイライトライン**: globe と操作系を分ける1pxの線（グラデ＋淡グロー）。グラス質感（rim/blur）の精緻化。
4. `mui-b` は発光半径・stroke 強度を一段強める（比較用）。

### B. ボトムシート（#panel / #feed / #legend の .side-panel）

1. **ハンドル**（現状: `::after` の `--glass-rim` バー）→ **大気ハロ発光**（シアンの淡い glow を持つバー・抑制的）。
2. **見出し**（`.panel-head h4` 等の「LAYERS / FEED / 凡例」）→ **sec-h のオーロラ下線**（border-bottom グラデ＋淡グロー）＋ `body.font-on` 連動で Saira。既存 sec-h 言語（CSS 629-642 / 851 付近）に揃える。
3. **せり上がり上縁**: シート上辺に光のハイライトライン（"観測パネルが立ち上がる"演出）。transform せり上げ（既存 .28s）に光が乗る程度の控えめさ。
4. **リスト**（レイヤー行 / フィード行 / 凡例行）: タッチサイズ（行高・タップ余白）と行間をモバイル最適化。左アクセント/glowドット（ui-a 由来）の発光をモバイルで視認できる強度に微調整。**密度は崩さない**（情報量維持）。

### C. ディマー幕（#sheet-scrim）

- 現状 `rgba(3,6,12,.5)` ＋ `blur(2px)`。シート展開時に globe を奥へ沈めるため、**暗度と blur を上品に強化**（例 alpha .55〜.6 / blur 3〜4px 程度・最終値は実機比較で）。
- **vignette 等の面グラデは入れない**。`#sheet-scrim`（z-index:6）はシート `.side-panel`（z-index:8・grass=backdrop-filter:blur）の**背後**にあり、面を置くとシートのグラス越しに四角く滲むリスク（star/space 面廃止と同根）。単色暗幕の濃度＋blur のみで「沈み込み」を表現する。

## `?param` バリアント設計

| 値 | 意味 |
|----|------|
| `?mui=a` | 上品（採用候補・既定）。抑制的な大気ハロ発光。 |
| `?mui=b` | もう一段攻めた発光・密度（比較用）。 |
| `?mui=off` | before（base のまま・アイコンは「≡」）。 |

最終採用は localhost で `?mui=a|b|off` を iPhone 幅で切替＋**オーナー実機**比較で確定。

## テスト

- `tests/immerse.test.js`（node:test）に `immerseMobileUi` の値解釈（a/b/off・未指定既定 a・大小無視）と `immerseClasses` が `mui-*` を含むことを検証（mp/ui/feed と同型）。
- e2e（Playwright・モバイル viewport）: `body.mui-a` クラス付与、タブに SVG アイコンが存在、シート見出しにオーロラ下線クラス、`?mui=off` で SVG 非表示（≡フォールバック）。**data 非依存**（クラス/要素の存在・属性のみ）で安定。

## 検証手順

1. `python -m http.server` で `?mui=a|b|off` をモバイル幅（DevTools / 実機）で切替比較。
2. Playwright（iPhone 393px）でスクショ（initial / layers / feed / legend）を撮り回帰確認。
3. **オーナー実機**（GPU依存の blur/glow）で a/b/off を比較し採用値確定。

## コード touchpoints（他セッションが触る時は保持を）

- `js/lib/immerse.js`: `immerseMobileUi`（`?mui=a|b|off`・既定a）＋ `immerseClasses` に `mui-` を1行 push。
- `css/orbis.css` **末尾**: 「モバイル操作シェル（mui-）」ブロック（`@media(max-width:768px)` 内 `body.mui-a/b`）。既存レイアウトquery は不変。
- `index.html`: `#mobile-tabs` 各タブに inline SVG アイコン追加（off は ≡ フォールバック）。
- 非編集: `js/main.js` / `js/ui/mobile-nav.js` / `js/ui/feed.js` / `js/ui/legend.js`。

## 非ゴール（YAGNI）

- globe 初期ビューの演出強化（地名密度・大気ハロ・星）— 現状良好なので対象外。
- 縦スクロールのセクション群（ブリーフィング/不安定性/FORECASTS）のモバイル最適化 — 別領域・今回対象外。
- タイポ/カラーのモバイル体系化（トークン整理）— 別領域・今回対象外。
- デスクトップ（>768px）の挙動変更 — `@media(max-width:768px)` 限定ゆえ不変。
- 脈動・グリッチ・スキャンライン等のサイバーパンクHUD — 設計言語に反するので入れない。
