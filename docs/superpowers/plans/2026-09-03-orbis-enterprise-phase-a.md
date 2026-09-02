# Orbis 企業品質化 Phase A（安全＋止血）Implementation Plan — 骨格（契約）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> 本ファイルは **骨格＝全タスク共通の契約**（ヘッダー・制約・ファイル構成・インターフェース・タスク一覧）。各タスクの手順本文は分冊 `2026-09-03-orbis-enterprise-phase-a-part{1,2,3,4}.md` にある。実装者は **骨格＋自分のタスクの分冊** を読む。

**Goal:** Orbis（公開・認証なし・読み取り専用の OSINT ダッシュボード）を「公開できるサービス」水準へ＝ヘッダー/CSP・自前配信・正直な鮮度表示・公開ページ・SW 止血・orbis-data 月次 squash を、退行ゼロ（静的ガード・ルーティング検証・e2e 違反 0）で据える。

**Architecture:** vercel.json を legacy `builds`（配信 allowlist）＋`routes`（continue ヘッダー・Cache-Control・308・catch-all 404）に書き換え、routes 評価器（`tests/vercel_routes.py`）を pytest と e2e ハーネスで共有する。外部ライブラリは `/vendor` に固定バイトで置き sha256 テストで守る。厳格 CSP（`style-src 'self'`）は自前テンプレートの `style=` を `data-style` に替え innerHTML 直後に CSSOM で適用して満たす。表示の正直さは純関数モジュール `js/ui/ai-meta.js` に集約する。

**Tech Stack:** Vanilla JS ESM（no build・Node 24 の `node:test`）／Python 3（pytest 9・collectors）／Playwright（`/home/shugo/node_modules/playwright`・Chromium headless）／Vercel 静的（legacy builds+routes）／GitHub Actions（squash workflow）／MapLibre GL 5.24.0・deck.gl 9.3.4（unpkg UMD を自前配信）。

**Spec:** `docs/superpowers/specs/2026-09-03-orbis-enterprise-phase-a-design.md`（§ 番号は本計画から参照）。監査所見の根拠＝Obsidian `Projects/_attachments/orbis-audit-2026-08-29/_merged.json`。型＝`~/apps/task-dashboard/tests/{test_vercel_routing_sim.py,test_security_headers.py,test_static_guards.py,test_sw.py,e2e-csp.mjs,test_harness_server.py,vendor.sha256}` と `~/apps/task-dashboard/tools/closure.sh`。

## Global Constraints
- 作業場所＝worktree `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a`（ブランチ `worktree-enterprise-a`）。**main チェックアウト `/home/shugo/apps/orbis` には触らない**。Bash の worktree ガードは「変数を含むループ等の複雑なコマンド」を拒否する→複雑な処理はスクリプトファイルに書いて `python3 file.py` / `node file.js` で実行する。
- 実行コマンド：`node --test tests/*.test.js`／`python3 -m pytest -q`（pytest 9.0.3・venv なし・システム python3）／e2e は `NOULIMIT=1 node tests/e2e-csp.mjs`（**Playwright/Chromium は行頭 `NOULIMIT=1`**＝hook の `ulimit -v` で Chromium が落ちるため）。既存の `npm run test:e2e`（20 spec）は `data/snapshots` が worktree に無いので **回さない**。
- 新しい実行時依存を足さない（npm/pip 追加なし）。Python は標準ライブラリ＋既存 `requirements.txt` の範囲。
- バージョン固定（verbatim）：`maplibre-gl@5.24.0`（`https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js`・`.css`）、`@deck.gl/{core,layers,mapbox,mesh-layers,geo-layers}@9.3.4`（`https://unpkg.com/@deck.gl/<pkg>@9.3.4/dist.min.js`）。ファイル名＝`vendor/maplibre-gl-5.24.0.js`・`vendor/maplibre-gl-5.24.0.css`・`vendor/deck.gl-core-9.3.4.min.js`・`vendor/deck.gl-layers-9.3.4.min.js`・`vendor/deck.gl-mapbox-9.3.4.min.js`・`vendor/deck.gl-mesh-layers-9.3.4.min.js`・`vendor/deck.gl-geo-layers-9.3.4.min.js`・`vendor/fonts/orbitron-latin.woff2`・`vendor/fonts/saira-latin.woff2`・`vendor/fonts/fonts.css`。
- SW：`const CACHE = 'orbis-v52';`（v51→v52・以後 sw.js を触るたびに +1）。`SHELL = ['/', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js']`。
- CSP（verbatim・1 行）：`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests`
- Permissions-Policy（verbatim）：`accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=(), display-capture=(self)`（`fullscreen`・`autoplay`・`picture-in-picture`・`encrypted-media` は **書かない**）。
- 他ヘッダー（verbatim）：`X-Content-Type-Options: nosniff`／`X-Frame-Options: DENY`／`Referrer-Policy: strict-origin-when-cross-origin`／`Cross-Origin-Opener-Policy: same-origin`。noindex・`X-Robots-Tag`・`Cross-Origin-Resource-Policy` は付けない。
- Cache-Control 4 段（verbatim）：`/vendor/(.*)`→`public, max-age=31536000, immutable`／`/(icons/.*|favicon\.svg|favicon-32\.png)`→`public, max-age=86400`／`/data/static/(.*)`→`public, max-age=3600, stale-while-revalidate=86400`／`/(|index\.html|about|terms|privacy|attribution|sw\.js|manifest\.webmanifest|robots\.txt|js/.*|css/.*|config/.*)`→`public, max-age=0, must-revalidate`。
- 自前の HTML/JS に `style="`（テンプレート含む）・`on*=`・インライン `<script>` 本文・`<style>`・`setAttribute('style'`・`javascript:` を **残さない/書かない**。動的スタイルは `data-style="…"`＋`applyDataStyles(root)`（CSSOM）。`el.style.x = …`／`setProperty`／`cssText` の直接代入は可。
- 文言（verbatim）：運営者＝`sg55555`（個人・非商用）／連絡先＝GitHub Issues `https://github.com/sg55555/orbis/issues`／LICENSE＝MIT `Copyright (c) 2026 sg55555`／robots の Disallow 対象＝`GPTBot, ClaudeBot, anthropic-ai, CCBot, Google-Extended, Applebot-Extended, Bytespider, PerplexityBot`／鮮度チップ＝`最終更新 {rel}`・stale＝`更新停止中 · 最終 {rel}`・不正＝`更新時刻 不明`／定型置換＝`AI 分析文なし（入力データ不足）`／ニュース＝`見出しからのAI要約`／免責＝`AI 生成（{model}・{generatedAt UTC}）・要約/推定であり誤りを含むことがあります`／AI 字幕注記＝`タブの音声をこの端末の変換サーバー（localhost:8900）へ送ります。外部には送信しません。`
- ネットワークは読み取りのみ（raw.githubusercontent.com・unpkg・fonts.googleapis/gstatic）。**orbis-data への書き込み（force-push・通常 push）は Task 1 と Task 8 の「本人確認後に親セッションが実行」ステップだけ**＝サブエージェントは実行しない。
- コミットは各タスク末尾で（メッセージは日本語の Conventional Commits・末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR`）。`git push` は Task 11 のみ。
- 各タスクは TDD（失敗するテストを先に書き→赤を確認→最小実装→緑→コミット）。既存テストが赤になる変更（media の URL・sw の cartocdn 等）は同じタスクで期待値を更新する。

---

## File Structure（作成／変更／削除）

**作成**
- `.github/workflows/squash-data.yml` — orbis-data 月次 squash（Task 1）
- `tests/test_workflow_squash.py` — squash workflow の構造テスト（Task 1）
- `css/pages.css` — 静的ページ共通（Task 2）
- `404.html` `about.html` `terms.html` `privacy.html` `attribution.html` — 静的ページ（Task 2）
- `LICENSE` `robots.txt` — （Task 2）
- `tests/test_pages.py` — ページ構造・文言・帰属の突合（Task 2）
- `tests/vercel_routes.py` — builds 展開＋routes 評価器（Task 3・共有モジュール）
- `tests/test_vercel_routing_sim.py` `tests/test_security_headers.py` — （Task 3）
- `scripts/fetch_vendor.py` — vendor 取得＋sha256 生成（Task 4）
- `vendor/**`（上記固定名＋`OFL-Orbitron.txt` `OFL-Saira.txt` `LICENSE-maplibre-gl.txt` `LICENSE-deck.gl.txt` `README.md`）・`tests/vendor.sha256`・`tests/test_vendor_integrity.py` — （Task 4）
- `js/lib/vendor-loader.js` `tests/vendor_loader.test.js` — TripsLayer 遅延ロード（Task 5）
- `js/lib/data-style.js` `tests/data-style.test.js` `tests/test_static_guards.py` — style 厳格化（Task 6）
- `js/ui/ai-meta.js` `tests/ai-meta.test.js` — 鮮度チップ・免責・定型判定（Task 7）
- `tests/test_sw.py` `tests/test_tracked_files.py` — （Task 9）
- `tests/harness/serve.py` `tests/e2e-csp.mjs` `tools/closure.sh` — （Task 10）

**変更**
- `index.html` — フッター（T2）／head の vendor 化・preconnect・defer（T4）／`data-style` 静的 2 件（T6）／『毎時更新』撤去＋チップ置き場（T7）／AI 字幕注記・`#news-frame` の `referrerpolicy`（T8）
- `vercel.json` `.vercelignore` — （T3）
- `README.md` — ライセンス節（T2）・開発/受入節（T10）
- `js/main.js` — `?e2e=1` フック（T4）／TripsLayer ガード（T5）／`showPopup` ヘルパ＋`applyDataStyles`（T6）／`updateFreshness` に AI+news（T7）
- `js/ui/feed.js` `js/ui/forecast.js` `js/ui/instability.js` `js/ui/legend.js` `js/ui/panel.js` `js/lib/drilldown/drilldown_view.js` `js/lib/selection.js` — `style=`→`data-style=`（T6）／instability の Number 強制・定型置換（T7/T9）／selection の news ラベル・`rel`（T7/T8）
- `js/ui/briefing.js` `js/ui/forecast.js` `js/ui/instability.js` `js/ui/alerts.js` — チップ・免責・相対時刻（T7）
- `js/ui/media.js` `js/ui/cams-pane.js` `js/ui/news-pane.js` `js/lib/drilldown/profile_view.js` `js/ui/sources.js` — nocookie・referrerpolicy・CC BY-SA フッタ・`rel`・スキーム検証（T8/T9）
- `css/orbis.css` — `.fresh-chip`/`.ai-disclaimer`/`.ai-tag`/`.alert-when`/`.ins-narr--none`/`.lc-note`/`.site-foot`・ちらつき防止（T2/T6/T7）
- `sw.js` — v52・同一オリジン・`res.ok`（T9）
- `collectors/gdelt_events.py` `tests/test_gdelt.py` — https＋MD5（T9）
- `tests/drilldown_sw.test.js` `tests/media.test.js` `tests/e2e/media.spec.js`（存在すれば） — 期待値更新（T8/T9）
- `.gitignore` — `.closure-ok`（T10）

**削除（追跡のみ）**
- `.superpowers/sdd/cluster-C4-report.md` `.superpowers/sdd/cluster-C7-report.md` — `git rm --cached`（T9）

## Interfaces（タスク間の契約・名前と型は変えない）
- `tests/vercel_routes.py`
  - `load_config(root: Path) -> dict`（vercel.json）
  - `expand_builds(cfg: dict, root: Path) -> set[str]`：builds の `src` グロブを実ファイルに展開し `"/js/main.js"` 形式の配信パス集合を返す（`**` は `Path.glob` 相当・ディレクトリは除く）
  - `evaluate(cfg: dict, path: str, served: set[str]) -> RouteResult`（`@dataclass RouteResult: status: int; dest: str | None; headers: dict[str, str]; matched: list[int]`）。規則＝routes を順に評価・`src` は `re.fullmatch`・`continue: true` はヘッダーを積んで次へ・`status` 付きは確定（`headers.Location` は `$1` 展開）・`dest` 付きは確定（`$1` 展開・dest が served に無ければ 404）・`{"handle": "filesystem"}` は `path` が served にあれば 200 で確定（`/` は `/index.html`）・末尾まで確定しなければ 404。
- `tests/harness/serve.py`：`python3 tests/harness/serve.py --port <int> [--csp-override "<csp>"]`。worktree ルートを配信し、各リクエストで `evaluate()` の結果（status・dest・headers）をそのまま返す。MIME＝`.js/.mjs`→`text/javascript`・`.css`→`text/css`・`.webmanifest`→`application/manifest+json`・`.json/.geojson`→`application/json`・`.gz`→`application/gzip`（`Content-Encoding` は付けない）・`.woff2`→`font/woff2`・`.html`→`text/html; charset=utf-8`。`--csp-override` は CSP ヘッダーだけ差し替える（negative control 用）。
- `js/lib/data-style.js`：`export function applyDataStyles(root)`。`root` が Element で `data-style` を持てば自身にも適用。`root.querySelectorAll('[data-style]')` の各要素に `el.style.cssText = el.getAttribute('data-style')` → `el.removeAttribute('data-style')`。戻り値＝適用した要素数（number）。`root` が null/undefined なら 0。
- `js/lib/vendor-loader.js`：`export const LAZY_VENDOR = ['vendor/deck.gl-mesh-layers-9.3.4.min.js', 'vendor/deck.gl-geo-layers-9.3.4.min.js']`／`export function ensureTripsLayer({ doc = document, root = globalThis } = {}) -> Promise<void>`（`root.deck?.TripsLayer` が関数なら即 resolve。無ければ LAZY_VENDOR を **順に**（前の `onload` 後に次を注入）`doc.createElement('script')` で `doc.head` に追加。Promise はモジュール内で 1 つだけ保持・reject 時は破棄して再試行可）／`export function _resetVendorLoaderForTests()`。
- `js/ui/ai-meta.js`：`export const FRESH_AI_MS = 24 * 3600 * 1000`／`export function freshnessChip({ updated, now = Date.now(), staleMs = FRESH_AI_MS }) -> { text: string, stale: boolean, rel: string }`／`export function freshnessChipHtml(opts) -> string`（`<span class="fresh-chip is-stale" title="<ISO>">…</span>`・`is-stale` は stale 時のみ・`title` と本文は escapeHtml）／`export function aiDisclaimerHtml({ model, generatedAt }) -> string`（`<p class="ai-disclaimer">AI 生成（{model}・{YYYY-MM-DD HH:mm UTC}）・要約/推定であり誤りを含むことがあります</p>`・`model` 無しなら `AI 生成（{時刻}）…`）／`export function isPlaceholderNarrative(s) -> boolean`。`relTime` は `js/ui/sources.js` から import。
- `js/main.js`：`function showPopup(lngLat, html)`＝`selPopup.setLngLat(lngLat).setHTML(html).addTo(map); applyDataStyles(selPopup.getElement());`（7 箇所＝159/369/377/387/397/502/574 行の `selPopup.setLngLat(...).setHTML(...).addTo(map)` を置換）。`window.__orbis`（`{ map, overlay, counts }`）は既存の状態バスで約 30 箇所が無条件参照するので **従来どおり常に置く**。`new URLSearchParams(location.search).get('e2e') === '1'` の時だけ `window.__orbis.e2e = { map, overlay }` を追加（e2e の能力アサートは `window.__orbis.map.getProjection().type === 'globe'` で通る）。
- `sw.js`：fetch ハンドラのソースに文字列 `url.origin !== self.location.origin` と `res.ok && res.type === 'basic'` を **その表記で**含める（test_sw.py が grep する）。
- `collectors/gdelt_events.py`：`LASTUPDATE_URL = "https://data.gdeltproject.org/gdeltv2/lastupdate.txt"`／新関数 `parse_lastupdate_line(line: str) -> tuple[int, str, str]`（size, md5, https URL・列不足は `ValueError`）／`verify_md5(data: bytes, expected: str) -> None`（不一致は `ValueError("gdelt md5 mismatch")`）。`fetch_latest_rows()` は両方を使う。
- `tools/closure.sh`：`node --test tests/*.test.js` → `python3 -m pytest -q` → `NOULIMIT=1 node tests/e2e-csp.mjs` → 全部 0 なら `git rev-parse HEAD > .closure-ok` と `== closure OK` を出力。どれかが失敗したら `== closure FAILED (<段階>)` を出し `.closure-ok` を削除して exit 1。

## Task 一覧（分冊と実行順）
| # | タスク | 分冊 | 依存 |
|---|---|---|---|
| 1 | B0 squash workflow＋構造テスト（＋初回 squash は Task 1 完了後にブランチを origin へ push → `gh workflow run squash-data.yml --ref worktree-enterprise-a -f confirm=squash` で親セッションが実行。手元からの force-push は auto モードの分類器がブロックするため使わない・2026-09-03 本人決定） | part1 | なし |
| 2 | A4 静的ページ 5 枚＋`css/pages.css`＋LICENSE＋robots＋README ライセンス節＋index.html フッター＋`test_pages.py` | part1 | なし |
| 3 | A1 `tests/vercel_routes.py`＋routing sim＋security headers テスト＋`vercel.json`＋`.vercelignore` | part1 | 2（ページが builds に載る） |
| 4 | A2 `scripts/fetch_vendor.py`＋`vendor/**`＋`vendor.sha256`＋integrity テスト＋index.html head 差し替え＋`?e2e=1` フック | part2 | 3 |
| 5 | A2 `js/lib/vendor-loader.js`＋テスト＋main.js の TripsLayer ガード | part2 | 4 |
| 6 | A5 `js/lib/data-style.js`＋テスト＋21 箇所置換（selection 8／feed 4／forecast 3／instability 2／legend 2／panel 1／drilldown_view 1）＋`showPopup`（7 箇所）＋index.html 静的 2 件＋ちらつき防止 CSS＋`test_static_guards.py` | part2 | 4 |
| 7 | A3 `js/ui/ai-meta.js`＋テスト＋差し込み（briefing/instability/forecast/alerts/#freshness/news ラベル/定型置換）＋index.html 文言＋CSS | part3 | 6 |
| 8 | A4 動的分＝youtube-nocookie＋`referrerpolicy`＋AI 字幕注記＋プロフィール CC BY-SA フッタ＋`rel="noopener noreferrer"`＋既存テスト更新（＋orbis-data の LICENSE/DATA-SOURCES.md は親セッションが push） | part3 | 2 |
| 9 | A5 sw.js v52＋`test_sw.py`＋`drilldown_sw.test.js`＋GDELT https/MD5＋instability Number＋profile href 検証＋`.superpowers` 追跡解除＋`test_tracked_files.py` | part3 | 3 |
| 10 | e2e ハーネス `tests/harness/serve.py`＋`tests/e2e-csp.mjs`（違反 0・能力アサート・ルーティング・negative control）＋`tools/closure.sh`＋`.gitignore`＋README 開発/受入節 | part4 | 3〜9 |
| 11 | 統合＝closure ALL PASS → main へ merge → push → 本番 curl → 本人実機 → squash workflow dispatch → ノート/MEMORY/Artifact 更新（親セッションが実行） | 骨格 §Task 11 | 10 |

---

### Task 11: 統合・デプロイ・本番確認・記憶整理（親セッションが実行）

**Files:** なし（git 操作と外部確認のみ）

- [ ] **Step 1: 受入一括を HEAD で実行** — `bash tools/closure.sh` → ログ末尾 `== closure OK`。`.closure-ok` の中身が `git rev-parse HEAD` と一致。
- [ ] **Step 2: main へ統合** — `ExitWorktree`（keep）→ `/home/shugo/apps/orbis` で `git merge --ff-only worktree-enterprise-a`（ff できなければ `git merge --no-ff`）。push ゲート（sw CACHE 版・builds・closure）を通して `git push origin main`（理由と安全根拠を日本語で併記）。
- [ ] **Step 3: 本番 curl（反映確認）** — `curl -sI https://orbis-beta.vercel.app/sw.js` の本文に `orbis-v52`（`curl -s … | grep -c "orbis-v52"`）が出るまで待つ（GitHub 連携デプロイ）。その後 `/`・`/about`・`/nope`・`/index.html`・`/about.html`・`/vendor/maplibre-gl-5.24.0.js`・`/data/static/admin1_bbox.json`・`/data/static/admin1/JA.geojson.gz`・`/config/news_feeds.json`・`/README.md`・`/robots.txt` を `curl -sI` し、spec §5 の期待（ヘッダー 6 種完全一致・Cache-Control 4 段・308/404・`.gz` に `content-encoding` 無し）を突合して表にする。
- [ ] **Step 4: 本人実機（AskUserQuestion で依頼）** — PC＋iPhone PWA で globe・加算合成・『交通』貿易フロー・カメラ・ドリルダウン・検索・共有・AI 3 層の「更新停止中」チップ・DevTools の CSP 違反 0。NG があれば systematic-debugging。
- [ ] **Step 5: squash workflow の main からの再確認** — Task 1 末尾でブランチから dispatch 済み（初回 squash）。統合後に `gh workflow run squash-data.yml -R sg55555/orbis -f confirm=squash`（main の ref）を 1 回打ち `gh run watch <id> --exit-status` で success（1〜数 commit を再 squash しても無害）→ `gh api -i "repos/sg55555/orbis-data/commits?per_page=1"` の Link で commits が 1〜数件。
- [ ] **Step 6: 記憶整理** — Obsidian `Projects/orbis-enterprise-quality.md`（状態ログ・次の起点＝Phase B）と `Projects/orbis.md`・MEMORY.md 索引行・`Ledger/predictions.md` P-0066 の結果欄・Artifact 所見の「済」（`_adjudication.json` に status→`gen_board.py`→同 URL 再公開）・Knowledge に「deck.gl 分割 UMD は mesh→geo の順」「Vercel routes と cleanUrls は排他」の 2 件。区切りハンドオフ（起点＋合図文言＋`/usage` リマインド）。

## Self-Review（骨格レベル・2026-09-03）
- spec §3.0〜§3.5・§4・§5 の各項目に対応するタスク：§3.0→T1／§3.1→T3（＋T2 のページ・robots・404）／§3.2→T4・T5／§3.3→T7／§3.4→T2・T8／§3.5→T6・T9・T10／§4-4 e2e→T10／§5 受入→T11。ギャップなし。
- 分冊の各タスクは本骨格の Interfaces の名前・型を使う（レビューで突合）。
