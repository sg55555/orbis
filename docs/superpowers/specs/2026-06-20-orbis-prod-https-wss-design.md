# Orbis 本番https 字幕（wss）設計

> live-captions を本番 https Orbis で使えるようにする。`ws://localhost` は https ページから mixed-content で禁止 → `wss://localhost` 化。WebSocket の TLS エラーはブラウザがクリック回避できないため、**信頼されたローカル CA（mkcert）の証明書が必須**。

- date: 2026-06-20
- status: 設計確定（実装は worktree `worktree-prod-https-wss`）
- related: `2026-06-19-orbis-live-captions-design.md`, Obsidian `Projects/live-translate.md` / `Projects/orbis-ai-intelligence.md`

## 採用アプローチ
**A. mkcert（ローカル CA）＋ wss**。
- B（公開リレー/トンネルで TLS 終端）＝$0/プライバシー/ローカルファースト方針に反するため不採用。
- C（localhost:8000 http のまま）＝「本番 https で使う」要件を満たさない（検証用には有効）。

## WSL2 ＋ Windows ブラウザ特有の肝
- サーバは WSL2(Linux)、ブラウザは Windows Chrome。**CA は Windows の信頼ストアに入れる必要**がある（WSL の Linux ストアに入れても Windows Chrome は信頼しない）。
- `wss://localhost:8900` は WSL2 の localhost 転送で WSL サーバへ届く（ネットワーク OK・信頼のみ Windows 側の課題）。
- 採用＝**Windows で mkcert**：`mkcert -install`(Windows CA ストア登録) → `mkcert localhost 127.0.0.1 ::1` 生成 → WSL サーバが証明書ファイルを参照。

## 変更
### Orbis クライアント（`js/ui/live-captions.js`）
`lcWsUrl(search, protocol)` を protocol 考慮に変更：
- 明示 `?lc=ws` / `?lc=wss` が最優先（デバッグ/上書き用）。
- 無ければ **ページが https → wss、http → ws** を自動選択。
- 効果：本番(https)で自動 wss・localhost(http)で自動 ws（手動 `?lc=wss` 不要）。
- 呼び出し元 `lcWsUrl(location.search)` は protocol を既定で `location.protocol` から読むため不変。

### live-translate（コード変更なし）
`ssl_kwargs(cfg)` 実装済。`~/.config/live-translate/env` に `LT_TLS_CERT`/`LT_TLS_KEY`（Windows mkcert 生成物のパス。WSL から見える `/mnt/c/...` か `~/.config/live-translate/` へコピー）を設定 → systemd サービスが wss 起動。

### ドキュメント
live-translate README に Windows mkcert 手順（WSL2 特有の注意込み）。

## テスト
`tests/live-captions.test.js`：`lcWsUrl` の protocol 分岐（http→ws / https→wss / 明示上書き）。getDisplayMedia と実 wss 接続は headless 不可ゆえ手動受入。

## 受入（DoD）
- `lcWsUrl` テスト緑（protocol 分岐）＋既存 js/e2e 緑。
- オーナー実機：Windows mkcert → env に cert 設定 → `systemctl --user restart live-translate` → 本番 https Orbis で「AI字幕(日本語)」ON → 自動 wss 接続で日本語字幕。

## ユーザー手順（実機・Windows、一度きり）
1. Windows に mkcert 導入（`scoop install mkcert` / `choco install mkcert` / GitHub releases の exe）。
2. PowerShell：`mkcert -install`（Windows CA ストア登録）→ `mkcert localhost 127.0.0.1 ::1`（`localhost.pem`/`localhost-key.pem` 生成）。
3. 証明書を WSL から参照可能に（`/mnt/c/...` パス、または `~/.config/live-translate/` にコピー）。
4. `~/.config/live-translate/env` に追記：`LT_TLS_CERT=<pem パス>` / `LT_TLS_KEY=<key パス>`。
5. `systemctl --user restart live-translate`（wss で起動）。
6. 本番 https Orbis で「AI字幕(日本語)」ON（自動 wss）。出なければ DevTools で wss 接続エラー（証明書未信頼=mkcert -install 漏れ）を確認。
