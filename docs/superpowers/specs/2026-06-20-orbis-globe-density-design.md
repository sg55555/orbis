# ORBIS P0-1: globe密度抑制（ズーム連動密度 ＋ レイヤープリセット）— 設計

- date: 2026-06-20
- project: orbis
- topic: globe-density (UI/UX backlog P0-1)
- worktree/branch: `worktree-globe-density`（origin/main 991e0fb 派生）
- related: `docs/superpowers/specs/2026-06-20-orbis-feed-balance-design.md`（直前のP0-2）, Obsidian `Projects/orbis-uiux-improvements.md`

## 背景・問題

引き（globe, zoom≈2.7）の地球儀でアフリカ/中東/欧州が**紛争の赤ブロブ**に覆われ、地球と他レイヤーが埋もれる。初期から重い層（航空4003＋紛争2000＋抗議506…）が同時ONで情報過多。寄る（zoom4-5）と ember コアが綺麗に出るので、**問題は主に引き時の密度**。

### 真因（実コード確認済み）
- `js/layers/conflict.js` / `protests.js` は **`ScatterplotLayer` を加算合成（`ADDITIVE_BLEND`）** で重ねて「面」を表現する（`HeatmapLayer` が globe 非対応のための代替）。
- ブロブ半径は `blobRadius(mentions)`＝12〜52px の**固定ピクセル**。
- 引きでは対象地域が画面上で小さく、多数のブロブが重なり、加算で alpha が積算され**赤が飽和**する。寄ると点が離れて飽和が解ける。

### 既存の土台（再利用できる）
- 描画コンテキスト `ctx = { zoom, cmap, motionT, cfx }` が **既に** 各レイヤーの `toDeckLayer(snapshot, ctx)` に渡っている（`js/main.js` `buildBaseLayers`）。
- `map.on('zoom', () => { markBaseDirty(); drawAll(overlay); })` が **既に** ズームで再描画する（`js/main.js`）。
- 国別集約 `aggregateByCountry`（`js/lib/aggregate.js`）と脈動ホットスポット `buildHotspotConfigs` が **既存**（フィード均等化・脈動リングで稼働中）。
- 状態管理 `js/lib/state.js`（`loadEnabled/toggleEnabled/readStored/writeStored`）。
- 左パネル `js/ui/panel.js`（`renderPanel`）。`#panel` = `.panel-head` ＋ `#panel-rows`。
- モバイルのボトムシート `js/ui/mobile-nav.js` は **`#panel` をそのまま露出**する（DOM クラス操作のみ・アプリ状態非依存）。

## ゴール

1. 引き globe で紛争/抗議の赤洪水を鎮め、地球と他レイヤーが埋もれないようにする（寄ると現状の綺麗な ember に復帰）。
2. 初期表示と切替を「概観/紛争/気象/交通」のプリセットで整理し、情報過多を断つ。

## 非ゴール（YAGNI）

- 完全な LOD クロスフェード（個別⇄国別の連続切替）。→ ズーム連動でブロブを淡くしつつ国別ホットスポットリングを引きで主役に残すことで効能の大半を低コストで得る。必要なら次フェーズ。
- 航空(4003)のズーム連動密度。→ 概観プリセットで航空が OFF になるため今回は対象外。必要なら後日。
- プリセットの自動学習・カスタムプリセット保存。

---

## 設計

疎結合な 2 機能。互いに独立して実装・テストできる。

### 機能A：ズーム連動密度（赤洪水の根本対策）

**A-1. 新規純関数 `densityScale(zoom)` を `js/lib/geo.js` に追加**

```js
// 引き(globe)で加算ブロブが飽和→赤洪水になるのを抑える減衰係数(0..1)。
// 低ズーム=強く減衰(min)、高ズーム=1.0(現状維持)。線形ランプ。
export function densityScale(zoom, { z0 = 2.5, z1 = 5, min = 0.22 } = {}) {
  const z = Number(zoom);
  if (!Number.isFinite(z)) return 1;            // zoom 不明時は減衰しない（安全側）
  const t = (z - z0) / (z1 - z0);
  return Math.max(min, Math.min(1, t));
}
```

- 仕様：`zoom <= z0` で `min`、`zoom >= z1` で `1`、その間は線形。`z1 > z0` を前提（定数で保証）。`zoom` が非数なら `1`（減衰なし＝安全側）。

**A-2. `conflict.js` / `protests.js` の config ビルダを zoom 連動に**

- `buildBlobConfig(snapshot, zoom)` / `buildCoreConfig(snapshot, emberScale, zoom)` が `zoom` を受け取り、`const s = densityScale(zoom, DENS)` を用いて:
  - ブロブ `getFillColor` の alpha：`Math.round(42 * s)`（引き≈9、寄り42）
  - ブロブ `getRadius`：`blobRadius(m) * (0.55 + 0.45 * s)`（引きで半径も縮め重なりを減らす）
  - emberコア：`emberFill(...)` の戻り alpha に `s` を乗算、`getRadius` も同様に `(0.55 + 0.45*s)` を乗算
- `toDeckLayer(snapshot, ctx)` は既に `ctx` を受けているので `ctx.zoom` を各ビルダに渡すだけ。`ctx.zoom` 欠落時は `densityScale` が `1` を返す（現状維持）。
- **`buildPickConfig`（pickable 点）と `buildHotspotConfigs`（国別ホットスポットリング）は減衰しない**。引き時は「国別ホットスポットが主役・生ブロブは淡く」となり LOD 風の俯瞰になる。クリック判定（pickable）も全ズームで不変＝インタラクション回帰なし。

**A-3. チューニング**

- `DENS`（z0/z1/min）は `js/main.js` で `?dens=` クエリから上書き可能にし、`ctx` に載せてビルダへ渡す（`cfx`/`cmap` と同じ方式）。例：`?dens=2,6,0.15`。
- 既定値（z0=2.5, z1=5, min=0.22）は **localhost で実物比較 → オーナー確認** で最終確定（GPU 依存の見えは headless と乖離・mistakes.md / [[orbis-desktop-immersion]]）。コードの既定はこの設計値のまま出す。

**A-4. 再描画**：`map.on('zoom')` が既に `markBaseDirty()+drawAll()` を呼ぶので**配線追加ゼロ**で反映。conflict/protests は `animated` ではないが、`markBaseDirty()` でキャッシュ無効化されるため zoom 変化時に再構築される。

### 機能B：レイヤープリセット

**B-1. 新規純データ＋純関数 `js/lib/presets.js`**

```js
export const PRESETS = [
  { id: 'overview', label: '概観', layers: ['quakes', 'news', 'conflict', 'protests', 'currents'] },
  { id: 'conflict', label: '紛争', layers: ['conflict', 'protests', 'news'] },
  { id: 'weather',  label: '気象', layers: ['sst', 'currents', 'airtemp'] },
  { id: 'traffic',  label: '交通', layers: ['flights', 'ships', 'trade'] },
];
export const DEFAULT_PRESET = 'overview';

export function presetById(id) { return PRESETS.find((p) => p.id === id) || null; }

// 現在の ENABLED 集合がどのプリセットと完全一致するか。一致なし=null(カスタム)。
export function activePresetId(enabledSet) {
  for (const p of PRESETS) {
    if (p.layers.length === enabledSet.size && p.layers.every((id) => enabledSet.has(id))) return p.id;
  }
  return null;
}

// プリセット適用後の ENABLED 集合（純粋・排他）。
export function applyPreset(id) {
  const p = presetById(id);
  return new Set(p ? p.layers : []);
}
```

- **整合性**：PRESETS に出てくる全レイヤー ID は registry（`allLayerIds()`）に実在すること。単体テストで担保する。

**B-2. 既定初期表示 — `state.js` を後方互換で拡張**

- `loadEnabled(allIds, stored, defaultOff = [], defaultOn = null)` に第4引数 `defaultOn` を追加：
  ```js
  export function loadEnabled(allIds, stored, defaultOff = [], defaultOn = null) {
    if (!Array.isArray(stored)) {
      if (Array.isArray(defaultOn)) return new Set(allIds.filter((id) => defaultOn.includes(id)));
      return new Set(allIds.filter((id) => !defaultOff.includes(id)));
    }
    return new Set(allIds.filter((id) => stored.includes(id)));
  }
  ```
- 既存の 3 引数呼び出しは挙動不変（後方互換）。`state.test.js` 既存ケースはそのまま緑。
- `main.js`：`loadEnabled(ALL_IDS, readStored(), [], presetById(DEFAULT_PRESET).layers)` のように**概観プリセットの層配列**を `defaultOn` に渡す（`defaultOn` は `.includes` で判定するので Set でなく配列）。保存があれば従来通り尊重。

**B-3. UI — `js/ui/panel.js` に `renderPresets()` 追加**

- `index.html`：`#panel` 内、`.panel-head` と `#panel-rows` の間に `<div id="panel-presets" class="preset-chips"></div>` を追加。
- `renderPresets(root, getEnabled, onApply)`：
  - PRESETS を chip ボタン列で描画（`.preset-chip`・`.feed-chip` のスタイルを流用して統一）。
  - クリック → `onApply(applyPreset(id))`（= その層だけ ON・他 OFF の**排他**集合）。
  - `activePresetId(getEnabled())` でアクティブ chip を `.active` 強調。一致なし（カスタム）時は**どの chip も `.active` にせず、chip 行末に淡色の小さな「カスタム」ラベルを表示**する。
- `main.js` 配線：`renderPresets(#panel-presets, () => ENABLED, (next) => { ENABLED = next; writeStored(next); rebuild(overlay); panel.syncChecks(); presetsApi.refresh(); })`。
  - 既存の個別トグル（`renderPanel` の change ハンドラ）でも、トグル後に `presetsApi.refresh()` を呼んでアクティブ表示を更新（カスタム化の反映）。
- **CSS**：`css/orbis.css` に `.preset-chips` / `.preset-chip` / `.preset-chip.active` を追加（`.feed-chips`/`.feed-chip` 準拠）。折りたたみ時は `#panel.collapsed #panel-presets { display:none }`。
- **モバイル**：シートが `#panel` を露出するため `#panel-presets` は**自動で出る**。`mobile-nav.js` は非編集。

**B-4. 疎結合**：プリセットは「ENABLED を特定集合にセットする」だけ。既存の `toggleEnabled`/個別トグル/`writeStored` 永続化はそのまま。registry/収集には触れない。

---

## データフロー

1. 初回ロード（保存なし）→ `loadEnabled(..., defaultOn=overview)` → ENABLED=概観 → `rebuild` → `drawAll`。
2. プリセット chip クリック → `applyPreset(id)` → `onApply` → ENABLED 更新＋`writeStored`＋`rebuild`＋chip/checkbox 同期。
3. ズーム変化 → `map.on('zoom')` → `markBaseDirty()+drawAll()` → conflict/protests の config が `densityScale(zoom)` で alpha/半径を再計算。

## エラー処理・エッジケース

- `ctx.zoom` 欠落/非数 → `densityScale` が `1`（減衰なし＝現状維持）。
- 不正な `?dens=` → パース失敗時は既定値にフォールバック。
- `applyPreset(未知id)` → 空 Set（防御的・通常起こらない）。
- ローカル/比較モードは SW 無効（既存 `main.js` のロジックのまま）。

## テスト

### 単体（`node --test tests/*.test.js`）
- `tests/geo2.test.js`（または `geo.test.js`）：`densityScale` — `zoom<=z0`→min、`>=z1`→1、中間の線形値、非数→1、`?dens` 相当の opts 上書き。
- `tests/presets.test.js`（新規）：`PRESETS` の全層 ID が `allLayerIds()` に実在／`activePresetId` の一致・カスタム(null) 判定／`applyPreset` の排他集合／`DEFAULT_PRESET==='overview'`。
- `tests/heat.test.js`（拡張）：`buildBlobConfig`/`buildCoreConfig` が低 zoom で alpha・半径を下げ、高 zoom で現状値に戻ることを config 値レベルで assert（`getFillColor`/`getRadius` を代表 point で評価）。
- `tests/state.test.js`（拡張）：`loadEnabled` の `defaultOn` 分岐（保存なし→defaultOn、保存あり→従来）。

### e2e（`playwright test`・既存 `workers:1` 直列）
- `tests/e2e/conflict.spec.js`（拡張 or 新規 `presets.spec.js`）：
  - プリセット「気象」chip クリック → 水温/海流/気温の checkbox だけ ON・他 OFF を assert。アクティブ chip ハイライト確認。
  - 低ズームで `window.__orbis` 経由 or 描画設定で conflict ブロブの密度が抑制されることを確認（画素飽和はスクショ目視＋設定値 assert）。
- headless の WebGL globe は ~29s かかるため `test.setTimeout(60000)` を踏襲（mistakes.md / 既存 smoke/media）。

### 手動・実機（オーナー）
- `?dens=` で z0/z1/min を localhost 実物比較 → 引き globe の赤の鎮まり具合を確認し既定を確定。
- 本番デプロイ後、引き/寄りの見えとプリセット切替（特にモバイルのシート内 chip）をサニティ。

## 配信

- `main.js`/`css/orbis.css`/`index.html`/新規 js を SHELL に追加 → `sw.js` の `CACHE` を **v37 → v38**。
- `index.html` と新規 js（`js/lib/presets.js`）を SW の SHELL リスト（precache）に追加すること（参照されるファイルが SHELL に無いと本番で取りこぼす）。
- registry/収集ワークフローは不変。

## 実装ファイル一覧（影響範囲）

| ファイル | 変更 |
|---|---|
| `js/lib/geo.js` | `densityScale` 追加（純関数） |
| `js/lib/presets.js` | 新規（PRESETS/applyPreset/activePresetId 等） |
| `js/lib/state.js` | `loadEnabled` に `defaultOn` 追加（後方互換） |
| `js/layers/conflict.js` | blob/core ビルダを zoom 連動に |
| `js/layers/protests.js` | 同上 |
| `js/ui/panel.js` | `renderPresets` 追加 |
| `js/main.js` | 既定=概観・`?dens` ctx・renderPresets 配線・chip/トグル同期 |
| `index.html` | `#panel-presets` 追加・SHELL に presets.js |
| `css/orbis.css` | `.preset-chips`/`.preset-chip` |
| `sw.js` | CACHE v37→v38・SHELL に presets.js |
| `tests/*` | 上記単体・e2e |

## 統合

worktree `worktree-globe-density` で実装 → テスト緑 → main ツリーへ `git fetch && git merge` → push → Vercel 自動デプロイ → curl/実機確認 → 記憶整理（Obsidian `Projects/orbis-uiux-improvements.md` 進捗ログ＋MEMORY.md）。
