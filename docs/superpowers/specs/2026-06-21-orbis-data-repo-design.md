# orbis 公開データ専用 repo（orbis-data）設計spec

**日付**: 2026-06-21
**対象**: orbis（世界リアルタイム監視ダッシュボード）
**種別**: インフラ/アーキテクチャ変更（データ配信を別 public repo へ分離）

## ゴール
cron のデータ更新 commit が Vercel のビルド枠を食い日次上限（Hobby 約100/日）に当たる構造を断つ。cron 更新分の snapshot を public な orbis-data repo に移し、main にはコードだけを残す。Vercel は main だけを監視するため main は「コード変更時だけデプロイ＝稀」になり rate-limit が構造的に解決する。フロントは public な orbis-data を raw.githubusercontent.com から直読みする。

## 背景
- 直前の試み（raw 直配信＋Ignored Build Step）は orbis が PRIVATE のため raw が匿名 404 で頓挫し、REMOTE_ENABLED=false（js/lib/data-source.js）で相対(Vercel)にフォールバックして本番復旧済み（main 92fd69f）。resolver コードは導入済みだが raw は無効＝rate-limit は未解決。
- 本 spec は private を維持したまま根本解決する案 B。公開されるのは公開ソース由来の集計データのみでコード(main)は private のまま。
- 知見: Obsidian Knowledge/vercel-hobby-deploy-rate-limit-cron.md。

## 確定した設計判断
1. B＝公開データ専用 repo orbis-data（A=repo Public 化 / C=断念 は不採用）。
2. collector 連携＝orbis-data を ./data/snapshots に checkout（collector Python は無改変。差分/履歴依存もそのまま）。
3. data は main から完全に出す（git rm ＋ .gitignore）→ main はコード commit のみ → Vercel Ignored Build Step は不要。
4. orbis-data はルート直下にファイル配置（quakes.json 等が repo ルート）。RAW_BASE は https://raw.githubusercontent.com/sg55555/orbis-data/main 。
5. SW バイパスに raw.githubusercontent.com ホストを追加（新 raw パスは /data/snapshots/ を含まないため）。CACHE は orbis-v41 から orbis-v42。
6. ローカル開発は ?data=github で公開 orbis-data を参照（clone 不要）。e2e は localhost→相対のまま route mock 一致で不変。
7. クロス repo push＝fine-grained PAT（orbis-data に Contents write）を main の secret ORBIS_DATA_TOKEN に登録して使用。

## スコープ
- 対象＝data/snapshots/*.json（cron 更新分・manifest・*_history 含む）の配信元移設。
- 対象外（main・相対のまま Vercel 配信）＝data/static/*.geojson（海流/貿易）、config/*.json（live_channels/live_cameras）。コード変更時のみ変わる＝Vercel がビルドすべき。

## 設計詳細

### 1. orbis-data リポジトリ（新規 public・手動作成）
- ルート直下に snapshot 群：quakes.json flights.json conflict.json protests.json news.json ships.json briefing.json instability.json forecast.json manifest.json、履歴 instability_history.json forecast_history.json、その他現 data/snapshots/ 直下の全 json。
- README に「orbis 用の自動生成データ。手動編集しない」程度を記載。secrets は置かない。

### 2. collector ワークフロー（collect.yml / collect-slow.yml / collect-briefing.yml / collect-instability.yml / collect-forecast.yml）
各 workflow を次の構造に変更（最小 diff）：
1. actions/checkout@v6（main＝コード）を . に。
2. actions/checkout@v6 で orbis-data を path: data/snapshots に、repository: sg55555/orbis-data、token: ORBIS_DATA_TOKEN、persist-credentials: true。
3. 既存の collector 実行ステップ（無改変。python -m collectors.xxx）。
4. Commit ステップを data/snapshots 内で実行して orbis-data へ push（cd data/snapshots → git add -A → 変更あれば commit "data: refresh [skip ci]" → git pull --rebase origin main → git push）。
- concurrency: group collect（既存）維持＝orbis-data への push を直列化。
- main の checkout は data/snapshots を gitignore 済み＝orbis-data checkout と衝突しない。

### 3. クロス repo push 認証（手動セットアップ）
- オーナーが実施：(a) public repo orbis-data 作成、(b) fine-grained PAT 発行（Repository=orbis-data、Permissions=Contents: Read and write）、(c) main repo の Settings→Secrets→Actions に ORBIS_DATA_TOKEN 登録。
- 手順書は plan/実装時に提供。

### 4. main 側の変更
- git rm -r --cached data/snapshots（追跡解除）＋ファイル削除、.gitignore に data/snapshots/ 追加。
- data/static/・config/ は不変。

### 5. フロント（既存 resolver 再利用）
- js/lib/data-source.js: REMOTE_ENABLED=true、RAW_BASE を orbis-data ルートに。hostPrefersRemote/isRemoteData/snapshotBaseUrl/snapshotUrl のロジックは不変（snapshotUrl(name) → RAW_BASE/name.json）。
- js/snapshot.js・js/main.js は data-offload で resolver 経由化済み＝無改変。
- sw.js: fetch バイパス条件に url.hostname === 'raw.githubusercontent.com' を追加（クロスオリジンデータをブラウザ既定取得＝非キャッシュ）。CACHE='orbis-v42'。

### 6. データ契約（raw URL）
- https://raw.githubusercontent.com/sg55555/orbis-data/main/<name>.json（ルート直下・ref=main）。
- CORS: raw は Access-Control-Allow-Origin: *、Content-Type text/plain（response.json() 可）。public repo ゆえ匿名取得可。
- 鮮度: Fastly 約300s エッジ（cron 更新は 30分〜2時間間隔＝実用上無影響）。

### 7. ローカル/e2e
- ローカル開発: ?data=github で公開 orbis-data を読む（isRemoteData(localhost,?data=github)= REMOTE_ENABLED && override github = true）。
- e2e: localhost＋override 無し → hostPrefersRemote=false → 相対 → 既存 route mock **/data/snapshots/*.json 一致で不変。

## ロールアウト順（統合セッション＋手動）
1. （手動）orbis-data 作成＋現 data/snapshots/ 全 json を seed（初期データ）。PAT 発行＋ORBIS_DATA_TOKEN 登録。
2. collector 5本を本設計に更新（worktree で）。
3. main: data/snapshots を git rm＋gitignore。
4. フロント: REMOTE_ENABLED=true＋RAW_BASE＋SW v42。
5. main 統合・push → Vercel デプロイ1回 → フロントが orbis-data raw 取得を検証。
6. collector を手動 dispatch（gh workflow run）→ orbis-data へ push 成功＋フロント更新を検証。
7. 以後 main はコード commit のみ＝Vercel デプロイ稀＝rate-limit 解決。

## テスト戦略
- 単体（node:test）: data-source.test.js を REMOTE_ENABLED=true に追従（isRemoteData 本番 true/local false/override、snapshotUrl が orbis-data raw を返す、RAW_BASE=orbis-data）。snapshot.test.js remote=raw・local=相対 を復活。
- e2e: localhost→相対で既存 spec 緑（briefing/instability/forecast/各層）。
- 手動: 本番で orbis-data raw 取得（DevTools/curl）、collector dispatch→orbis-data 更新→フロント反映。

## スコープ外
- A（repo Public 化）・C（Vercel 継続）。
- 他アプリへの横展開（同 cron×Vercel 構造）。本 spec は orbis のみ。

## リスクと緩和
- PAT 失効/権限不足 → collector の push が失敗（データ更新停止）。fine-grained PAT の有効期限管理・最小権限（orbis-data Contents のみ）。失敗しても本番は最後の orbis-data 状態を配信し続ける（フロントは止まらない）。
- orbis-data checkout と main の data/snapshots 衝突 → main で gitignore＋追跡解除済みなら衝突しない（実装時に確認）。
- SW 旧版残留 → v42 へ bump＋network-first で更新反映。
- ローカル開発のデータ欠如 → ?data=github で公開データ参照（手順を docs に明記）。
- 公開データの機微 → 地震/紛争/ニュース等の公開ソース集計のみ。個人情報・secrets 無し。
