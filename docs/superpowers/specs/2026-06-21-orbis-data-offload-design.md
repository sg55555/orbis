# orbis データ配信の Vercel 切り離し 設計spec

**日付**: 2026-06-21
**対象**: orbis（世界リアルタイム監視ダッシュボード）
**種別**: インフラ/アーキテクチャ変更（データ配信経路）

## ゴール
cron のデータ更新 commit が Vercel のビルド枠を食い潰し日次上限（Hobby ~100/日）に当たる構造を根本から断つ。`data/snapshots/*.json` をフロントが GitHub から直接取得し、Vercel の "Ignored Build Step" で data 専用 commit のデプロイを止める。

## 背景（問題）
- orbis は静的サイトだが、**データを `data/snapshots/*.json` として git に commit し Vercel build から配信**している。
- cron（collect 30分毎・briefing/instability/forecast 各 cron・slow 3h）が回るたびに Vercel deploy が走り、合計が日次上限を超過（`[skip ci]` は GitHub Actions 用で Vercel は止めない）。
- 症状：commit の Vercel status が `failure`（`?upgradeToPro=build-rate-limit`）。本番が最後に成功した deploy の世代で固定され、最新データ・新機能（例：forecast.json）が本番に出ない。
- 知見：Obsidian `Knowledge/vercel-hobby-deploy-rate-limit-cron.md`。

## 確定した設計判断（AskUserQuestion）
1. **配信メカニズム＝`raw.githubusercontent.com`**（観点=実装簡潔性/即効性。jsDelivr+purge / Vercel Pro / 全面移行は不採用）。
2. **dev/本番の切替＝ホスト名判定＋`?data=` override**（local/e2e は相対パス、本番/preview は raw）。
3. **デプロイ抑制＝Vercel Ignored Build Step**（data/snapshots だけの commit は deploy skip。data は main 単一ソースのまま。データ専用ブランチ案は不採用）。
4. **鮮度＝raw は `?t=` を外し Fastly の ~300s エッジキャッシュに載せる**（≤5分遅延・cron 更新間隔に対し実用上無影響。エッジ配信で高速＋GitHub origin 負荷激減）。local は従来通り `?t=`＋`no-store`。

## スコープ
- **対象＝`data/snapshots/*.json` のみ**（cron 更新分。manifest.json 含む）。
- **対象外（相対のまま・Vercel 配信維持）**＝`data/static/*.geojson`（海流/貿易・コード変更時しか変わらない）、`config/*.json`（live_channels/live_cameras）。これらが変わる時は Vercel がビルドすべきタイミングなので Ignored Build Step も通過させる。

## 設計詳細

### 1. 新ユニット `js/lib/data-source.js`（判定の唯一箇所＝DRY）
純粋関数中心・単体テスト可能。
- `isRemoteData(loc = location)`: `loc.hostname` が `localhost` / `127.0.0.1` / `[::1]` / 空（file://）なら `false`、それ以外なら `true`。`loc.search` に `data=local` があれば強制 `false`、`data=github` があれば強制 `true`（override が host 判定に優先）。
- `snapshotUrl(name, loc = location)`: `isRemoteData(loc)` が true → `https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots/${name}.json`、false → `data/snapshots/${name}.json`。
- 定数 `RAW_BASE = 'https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots'`（owner/repo/branch をここに集約）。

### 2. `js/snapshot.js`
- `BASE` 直書きを廃し `snapshotUrl(name)`（data-source.js）経由に。
- fetch 方針を source 別に分岐：
  - remote（raw）：`fetch(url)`（`?t=` 無し・`cache` 既定）＝Fastly エッジキャッシュ活用。
  - local（相対）：`fetch(url + '?t=' + Date.now(), { cache: 'no-store' })`＝従来の即時鮮度。
  - 判定は `isRemoteData()` を再利用。
- `fetchManifest` も同方式（`manifest` を `snapshotUrl('manifest')` で解決）。
- エラー処理・`fetchSnapshots`/`startPolling` の堅牢性（失敗層スキップ）は不変。

### 3. `js/main.js`
- AI層3 fetch を resolver 経由に：
  - `fetch('data/snapshots/briefing.json')` → `fetch(snapshotUrl('briefing'))`
  - `fetch('data/snapshots/instability.json')` → `fetch(snapshotUrl('instability'))`
  - `fetch('data/snapshots/forecast.json')` → `fetch(snapshotUrl('forecast'))`
- これらは remote 時 `?t=` 無し・`.then(r => r.ok ? r.json() : null).catch(() => null)` の graceful は不変。
- `config/live_channels.json` / `config/live_cameras.json` は**変更しない**（対象外）。

### 4. `sw.js`
- `CACHE` を `orbis-v40` → `orbis-v41`（main.js 変更の慣例）。
- fetch ハンドラの `/data/snapshots/` バイパス条件は**不変**（raw URL の pathname `/sg55555/orbis/main/data/snapshots/...` も `/data/snapshots/` を含むため合致＝cross-origin はブラウザ既定取得でキャッシュせず＝従来挙動）。

### 5. `vercel.json`
- `/data/snapshots/(.*)` の Cache-Control header を削除（raw 配信に移行後は dead。Vercel はもう要求されない）。他（cleanUrls 等）は不変。

### 6. Vercel Ignored Build Step（手動・ダッシュボード1回）
Settings → Git → Ignored Build Step に設定：
```
git diff --quiet HEAD^ HEAD -- ':(exclude)data/snapshots'
```
- exit 0（data/snapshots だけ変更）→ deploy skip／exit 非0（他も変更 or HEAD^ 不在）→ build。
- フォールバック安全：shallow clone で HEAD^ が無い場合は非0＝build（過剰デプロイ側に倒れる＝壊さない）。
- コードは spec/plan が提供、設定操作は太田さんが実施。

## データ契約（raw URL）
- 形式：`https://raw.githubusercontent.com/sg55555/orbis/main/data/snapshots/<name>.json`
- ref＝`main`（常に最新追従）。CORS：raw は `Access-Control-Allow-Origin: *`。Content-Type は text/plain だが `response.json()` でパース可。
- 前提：リポジトリ Public（orbis は Public 化済み）。

## ロールアウト順
1. コード実装（data-source.js + snapshot.js + main.js + sw.js v41 + vercel.json）→ commit。**非data commit ＝ Vercel deploy 1回**。現在レート制限中なら、適用済みの forecast 2h 抑制で窓が数時間内に回復してから（急ぐなら collector 一時 Disable で即開け）。これが**最後の窓争い**。
2. 本番検証：各ポーリング層が raw から取得・`forecast.json` 本番 200・コンソールエラー無し。
3. Vercel Ignored Build Step を設定（以後 data commit はデプロイ skip）。
4. 検証：data-only の cron commit 後に Vercel status が skip（deploy が作られない）こと、本番データが raw 経由で更新されること。

## テスト戦略
- **単体（node:test）** `tests/data-source.test.js`：
  - localhost / 127.0.0.1 / file(空 hostname) → 相対 URL。
  - 本番 host（例 `orbis-beta.vercel.app`）→ raw URL。
  - `?data=local`（本番 host でも相対）／`?data=github`（localhost でも raw）の override。
- **回帰（e2e）**：localhost 実行のため `isRemoteData()=false` → 相対 URL → 既存 route mock `**/data/snapshots/*.json` がそのまま合致（briefing/instability/forecast/各層の spec 緑を維持）。
- **手動（本番）**：raw 取得を実機/curl で確認・`forecast.json` 200・各層描画・コンソールエラー 0。

## スコープ外（将来）
- jsDelivr+purge への移行、Vercel Pro、全面ホスティング移行。
- 他アプリ（news-digest / nexus / kakeibo / hortus / task-dashboard）への同パターン横展開（同じ cron×Vercel 構造を持つ）。本 spec は orbis のみ。

## リスクと緩和
- **GitHub raw 可用性/障害**：GitHub は既存のハード依存（コード・cron もそこ）。新規リスクは小。raw 障害時は各層 fetch が graceful 失敗（既存の失敗層スキップ）でダッシュボードは他層で稼働継続。
- **raw soft rate-limit**：エッジキャッシュ採用（?t= 除去）で origin 負荷を最小化。個人/少人数では十分。
- **HEAD^ 不在**：Ignored Build Step は build 側にフォールバック（安全）。
- **5分鮮度遅延**：cron が 30分〜2時間更新なので体感差なし。即時性が要る将来用途が出たら ?t= 復活 or jsDelivr 検討。
