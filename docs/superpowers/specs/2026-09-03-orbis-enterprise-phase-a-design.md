# Orbis 企業品質化 Phase A（安全＋止血）設計メモ

日付: 2026-09-03 ／ 対象: Orbis（Vanilla JS ESM・no build・Vercel 静的・PWA・公開/認証なし/読み取り専用）／ ブランチ: `worktree-enterprise-a`（worktree `enterprise-a`）
上位の決定: 監査 2026-08-29（所見 100 件・Obsidian `Decisions/2026-08-29-orbis-enterprise-quality-audit.md`・Artifact a6c6b91f）。本人決定＝段取り A1→A5 承認／AI 3 層は停止表示のまま（無料）／orbis-data は月次 squash（B0）／商用化は仮定（Vercel Pro・Open-Meteo 有料は着手しない）。
本セッションの本人選択（2026-09-03 AskUserQuestion）: band＝Fable×max で設計・実装前に high へ降格／範囲＝B0＋A1〜A5 を今セッション・単独直列／B0 初回 squash は私が実行／世代保持は見送り／vercel.json＝builds グロブ＋routes（型どおり）／style＝厳格 `style-src 'self'`＋`data-style` 局所適用／運営者表示＝GitHub ハンドル sg55555＋連絡先 GitHub Issues／robots＝検索許可・AI 学習クローラ Disallow／設計全体を承認。
型: task-dashboard Phase A（`~/apps/task-dashboard/docs/superpowers/specs/2026-08-29-task-dashboard-phase-a-security-design.md`・`tests/test_vercel_routing_sim.py`・`test_static_guards.py`・`test_sw.py`・`vendor.sha256`・`e2e-csp.mjs`）と kakeibo の `vercel.json`。Orbis 固有の差分は §3 に明記。

## 1. 目的
- 全応答にセキュリティヘッダー 6 種（CSP・XCTO・XFO・Referrer・Permissions・COOP）。CSP は `script-src 'self' 'wasm-unsafe-eval'; style-src 'self'` で閉じ、外部ライブラリ（MapLibre・deck.gl・フォント）を自前配信＋sha256 固定にして **外部スクリプト/スタイル依存ゼロ**にする。
- 配信物を builds の allowlist で明示し、未知パスは catch-all 404、収集専用の設定ファイル・README・vercel.json を公開面から外す。
- 表示の正直さ＝停止中の AI 3 層と news に「最終更新／更新停止中」を出し、『毎時更新』の虚偽文言を撤去。AI 生成物に免責。
- 公開の体裁＝LICENSE・about/terms/privacy/attribution・帰属表示（CC BY-SA・OFL・ODbL 等）。
- SW とデータ経路の小止血＝同一オリジンだけキャッシュ・失敗応答を固定化しない・GDELT の HTTPS＋MD5。
- 以後の退行を止める静的ガード・ルーティング検証・e2e（CSP 違反 0）・受入一括 `tools/closure.sh` を据える＝Phase B（信頼）の土台。
- B0＝orbis-data（2026-09-03 時点 968MB／8,552 commits）の履歴を月次で畳む workflow＋初回 squash。

## 2. 現状（2026-09-03 棚卸し・数値は実測）
| 対象 | 実測 |
|---|---|
| index.html（186 行） | `<script>` 7 本＝unpkg 2（maplibre-gl 5.24.0 / deck.gl 9.3.4 全部入り・head 内・defer なし）＋ module 5（main/mobile-nav/immerse-bar/scroll-reveal/legend）／**インライン script 0・`<style>` 0・`on*=` 0**／`style="display:none"` 2（`#alerts` 94 行・`#cams-one-tabs` 133 行）／`<link>`: maplibre-gl.css（unpkg）・Google Fonts css2（Orbitron 600/800・Saira 400/500/600/700）・preconnect fonts 2 本／meta 3（charset/viewport/theme-color・robots なし）／`#news-frame` iframe（src は JS が設定） |
| JS（69 ファイル・約 7,100 行・ESM） | innerHTML 代入 35（drilldown.js 10・cams-pane.js 6 …）＋ `insertAdjacentHTML` 1（legend.js:53）／テンプレート内 `style="…"` **21 箇所・7 ファイル**（selection.js 43/61/154/170/174/194/197/212・feed.js 15/20/21/47・forecast.js 51/59/63・instability.js 61/64・legend.js 17/22・panel.js 59・drilldown_view.js 82）／`.style.cssText` 4（immerse-bar.js・`?compare=1` 専用）／`el.style.x=`・`setProperty` 約 16（CSSOM＝CSP 対象外）／`eval`・`new Function`・`javascript:`・`setAttribute('style'`＝**0** |
| 外部オリジン（トップページ発） | unpkg.com（script/style）・fonts.googleapis.com・fonts.gstatic.com・tiles.openfreemap.org（タイル/グリフ/スプライト＝fetch）・raw.githubusercontent.com（データ＝fetch）。**RED 計測（§4-1）で観測した外部オリジンはこの 5 つのみ**。YouTube 一式は iframe 内部（トップの CSP 対象外）。i.ytimg.com はカメラのサムネ img。localhost:8900 は AI 字幕 WebSocket（本番 https なら wss） |
| RED 計測（厳格 CSP を載せた配信で実測・PC＋モバイル） | 違反 1,979 件＝**style-src-attr 1,977（すべて自前 innerHTML テンプレートの `style="`・feed/forecast/legend/instability/panel＋index.html 静的 2）＋ script-src `wasm-eval` 2（deck.gl 内部の WebAssembly）**。maplibre 由来 0・connect/img/font/worker/frame 違反 0・pageerror 0・4xx/5xx 0 |
| deck.gl の使用 | `ScatterplotLayer / LineLayer / SolidPolygonLayer / PathLayer / BitmapLayer`（@deck.gl/layers）・`MapboxOverlay`（@deck.gl/mapbox・map.js:44・interleaved:false）・**`TripsLayer`（@deck.gl/geo-layers・main.js:176・貿易フロー＝`trade` 層・既定プリセット『概観』には含まれず『交通』で ON）**。globe は MapLibre 側（style.js:19 `projection: globe`・map.js:40 `setProjection`）。分割 UMD 実測（2026-09-03）: core 191KB＋layers 43KB＋mapbox 4KB＝**238KB gzip**（全部入り 460KB）。geo-layers は単体ロードで `Class extends value undefined`＝**mesh-layers（74KB）→geo-layers（163KB）の順に読めば TripsLayer が構築できる** |
| フォント | Google css2 は **可変フォント**を返す（Orbitron latin 1 ファイル・Saira latin 1 ファイル。latin-ext/vietnamese は別ファイル）。UI は日本語＝system-ui、Latin のワードマーク/見出しのみ Web フォント |
| sw.js（31 行） | CACHE `orbis-v51`・SHELL 5（`/index.html` を含む＝本番 308）・bypass＝raw / `/data/snapshots/` / cartocdn（死んだ参照）・それ以外は network-first で **`res.ok` を見ずに put**（クロスオリジンも） |
| vercel.json / 配信 | `{version:2, framework:null, cleanUrls:true}` のみ。builds/headers/routes なし。`.vercelignore` 10 行。**config/ の収集専用 5 ファイル（briefing_sources/instability/forecast/fips_countries/news_feeds）・README.md・vercel.json が公開配信**。ブラウザが読む config は `live_channels.json`・`live_cameras.json` の 2 つだけ（main.js:593-594） |
| 本番ヘッダー | HSTS のみ（CSP/XCTO/XFO/Referrer/Permissions なし）。/robots.txt 404・/about 等 404・LICENSE なし |
| collectors | `gdelt_events.py:11` が `http://`・lastupdate.txt の MD5 列（2 列目）を未検証。timeout は全 HTTP 呼び出しに指定済み |
| orbis-data | 968,459KB／8,552 commits（`gh api`）・branch 保護なし・rulesets なし・workflow なし。全 collect 系 workflow は `concurrency.group: collect`（freshness-monitor は read-only で別） |
| テスト基盤 | node:test（tests/*.test.js）・pytest 9（tests/test_*.py 29 本）・Playwright e2e 20 spec（`python3 -m http.server 8000`・workers 1）。CI でテストを回す workflow は無し。`/home/shugo/node_modules/playwright` が使える |

## 3. 方針

### 3.0 B0 orbis-data 月次 squash（先行・S）
- `.github/workflows/squash-data.yml`（orbis リポ側。orbis-data に workflow は置かない＝secret `ORBIS_DATA_TOKEN` が orbis にあるため）。
  - `on.schedule: '23 3 1 * *'`（毎月 1 日 03:23 UTC＝12:23 JST。外部 dispatch の :00/:15/:30/:45 と collect cron の :07/:37 を避ける）＋ `workflow_dispatch`（入力 `confirm`・required・**`squash` と一致した時だけ step を実行**する誤爆ガード）。
  - `concurrency: { group: collect, cancel-in-progress: false }`＝収集ジョブと直列化（force-push と通常 push の競合をゼロにする）。`permissions: { contents: read }`（orbis-data への push は PAT）。
  - steps: `actions/checkout@v6`（`repository: sg55555/orbis-data`・`path: data-repo`・`token: ${{ secrets.ORBIS_DATA_TOKEN }}`・`fetch-depth: 1`・`persist-credentials: true`）→ シェル:
    `before=$(git rev-parse HEAD)`・`tree=$(git rev-parse HEAD^{tree})` → `git checkout -q --orphan squash` → `git add -A` → `git commit -q -m "data: monthly squash YYYY-MM-DD (was <before>) [skip ci]"`（user.name `orbis-bot`・email は collect.yml と同じ noreply）→ **`[ "$(git rev-parse HEAD^{tree})" = "$tree" ]` を assert（不一致なら `::error::` で exit 1・push しない）** → `git push --force origin HEAD:main` → `$GITHUB_STEP_SUMMARY` に before/after。
- 初回＝**workflow の dispatch で行う**（2026-09-03 変更：手元からの `git push --force` は auto モードの分類器がブロックしたため。本人の再確認は取得済み＝不可逆・8,552 commits が消える）。手順＝Task 1 完了後にブランチ `worktree-enterprise-a` を origin へ通常 push → `gh workflow run squash-data.yml --ref worktree-enterprise-a -f confirm=squash` → `gh run watch` → commits 数と raw の manifest.json 不変を確認。workflow は最新 main を checkout してから tree 一致 assert → force-push を concurrency group `collect` の中で行うので、収集 push との競合や古い tree の push が構造的に起きない。main 統合後にも 1 回 dispatch して main の ref からの動作を確認（1〜数 commit を再 squash しても無害）。
- 既知の性質: GitHub の表示サイズは到達不能オブジェクトの GC まで減らない（raw 配信は影響なし）。collect 系は毎 run 新規 checkout なので新 root に自然追従（`git pull --rebase` は同一祖先）。orbis-data の `README.md` はそのまま tree に残る。
- テスト: `tests/test_workflow_squash.py`＝YAML を読み、cron が `23 3 1 * *`・concurrency group が `collect`・`confirm == 'squash'` の if があること・`--force` push の前に tree assert 行があること・`fetch-depth: 1`。

### 3.1 A1 配信の外殻＝`vercel.json`（builds グロブ＋routes・legacy）
`cleanUrls` は routes と併用不可なので削除し、routes で再現する（`/about`→`about.html`・`/index.html`→308 `/`・`/about.html`→308 `/about`）。

```json
{
  "version": 2,
  "framework": null,
  "builds": [
    { "src": "index.html", "use": "@vercel/static" },
    { "src": "404.html", "use": "@vercel/static" },
    { "src": "about.html", "use": "@vercel/static" },
    { "src": "terms.html", "use": "@vercel/static" },
    { "src": "privacy.html", "use": "@vercel/static" },
    { "src": "attribution.html", "use": "@vercel/static" },
    { "src": "sw.js", "use": "@vercel/static" },
    { "src": "manifest.webmanifest", "use": "@vercel/static" },
    { "src": "robots.txt", "use": "@vercel/static" },
    { "src": "favicon.svg", "use": "@vercel/static" },
    { "src": "favicon-32.png", "use": "@vercel/static" },
    { "src": "icons/**", "use": "@vercel/static" },
    { "src": "js/**", "use": "@vercel/static" },
    { "src": "css/**", "use": "@vercel/static" },
    { "src": "vendor/**", "use": "@vercel/static" },
    { "src": "data/static/**", "use": "@vercel/static" },
    { "src": "config/live_channels.json", "use": "@vercel/static" },
    { "src": "config/live_cameras.json", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/(.*)", "continue": true, "headers": { "Content-Security-Policy": "…§3.1 の値…", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "…§3.1 の値…", "Cross-Origin-Opener-Policy": "same-origin" } },
    { "src": "/vendor/(.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=31536000, immutable" } },
    { "src": "/(icons/.*|favicon\\.svg|favicon-32\\.png)", "continue": true, "headers": { "Cache-Control": "public, max-age=86400" } },
    { "src": "/data/static/(.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" } },
    { "src": "/(|index\\.html|about|terms|privacy|attribution|sw\\.js|manifest\\.webmanifest|robots\\.txt|js/.*|css/.*|config/.*)", "continue": true, "headers": { "Cache-Control": "public, max-age=0, must-revalidate" } },
    { "src": "/index\\.html", "status": 308, "headers": { "Location": "/" } },
    { "src": "/(about|terms|privacy|attribution)\\.html", "status": 308, "headers": { "Location": "/$1" } },
    { "src": "/(about|terms|privacy|attribution)", "dest": "/$1.html" },
    { "src": "/", "dest": "/index.html" },
    { "src": "/404\\.html", "status": 404, "dest": "/404.html" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "status": 404, "dest": "/404.html" }
  ]
}
```

- **CSP（最終形＝A2 完了後の値。A1 と A2 は同じ merge で出荷する）**
  `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests`
  - 型との差: `'wasm-unsafe-eval'`（deck.gl 内部の WASM・RED 実測）／`worker-src blob:`（MapLibre のワーカーは blob URL）／`connect-src` に raw・tiles・AI 字幕の wss／`frame-src` に youtube-nocookie／`img-src https:`（YouTube サムネ・データ由来の画像）／`media-src 'self'`／**noindex を付けない**（公開サイト）／`Cross-Origin-Resource-Policy`・`X-Robots-Tag` は出荷しない（型 R12-④と同じ理由）。
  - `report-uri` は作らない（関数なし）。nonce/hash は静的配信で運用できない（§8）。
- **Permissions-Policy**: `accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), usb=(), xr-spatial-tracking=(), display-capture=(self)`。**`fullscreen`・`autoplay`・`picture-in-picture`・`encrypted-media` は書かない**（既定のまま＝iframe の `allow`/`allowfullscreen` 委譲が生きる。書くと YouTube 埋め込みが黙って劣化する）。`display-capture=(self)` は AI 字幕の `getDisplayMedia`。
- **Cache-Control 4 段**: `vendor/**`＝1 年 immutable（ファイル名に版）／`icons/`・favicon＝1 日／`data/static/**`＝1 時間＋SWR 1 日（URL 版付けなしで更新が 1h 以内に届く・11MB の再検証を止める）／`index.html`・4 ページ・sw.js・manifest・robots・js・css・config＝`max-age=0, must-revalidate`（no build でハッシュ名が無い）。
- **robots.txt**: `User-agent: *` / `Allow: /` ＋ `GPTBot`・`ClaudeBot`・`anthropic-ai`・`CCBot`・`Google-Extended`・`Applebot-Extended`・`Bytespider`・`PerplexityBot` を `Disallow: /`。Sitemap は書かない。
- **404.html**: 見出し・「ORBIS へ戻る」リンク・`css/pages.css`（§3.4）。`handle: filesystem` の前に `/404\.html → status 404` の route を置く（直アクセスも 404 で返す・本文は同じ）。
- **`.vercelignore`** 追記: `.claude/` `.claire/` `.venv/` `.pytest_cache/` `data/snapshots/` `tools/` `*.md` `.closure-ok`（builds allowlist で本来不要だが CLI デプロイ事故の二重化）。
- `.gz` 資産（`data/static/admin1/*.geojson.gz`・profiles の `.json.gz`）は @vercel/static でも従来どおり生バイト配信（クライアントが `DecompressionStream` で展開）。受入で `curl -sI` の `content-encoding` が無いことと drilldown の e2e で確認。
- テスト（構造・静的）: `tests/vercel_routes.py`（builds グロブ展開＋routes 評価器＝型 `test_vercel_routing_sim.py` の評価器を関数化し、e2e ハーネス §4-4 と共有）／`tests/test_vercel_routing_sim.py`＝`/`→index.html＋全ヘッダー・`/nope`→404＋404.html・`/about`→about.html 200・`/about.html`→308 `/about`・`/index.html`→308 `/`・`/config/news_feeds.json`→404・`/README.md`→404・`/vercel.json`→404・`/robots.txt` 200・`/vendor/x.js` の Cache-Control immutable・`/data/static/x.json` の SWR・`/js/main.js` の must-revalidate・ヘッダー route が先頭で `continue` かつ `dest` 無し／`tests/test_security_headers.py`＝必須ヘッダー 6 種の完全一致・CSP ディレクティブ集合の完全一致（`script-src == {'self', 'wasm-unsafe-eval'}` 等）・Permissions-Policy に `fullscreen`/`autoplay` が**含まれない**・builds の期待集合（回帰ガード）・`cleanUrls` キーが無い。

### 3.2 A2 サプライチェーン＝`/vendor` 自前配信＋sha256 固定
- 配置（ファイル名に版を含める＝immutable の前提）:
  `vendor/maplibre-gl-5.24.0.js`・`vendor/maplibre-gl-5.24.0.css`・`vendor/deck.gl-core-9.3.4.min.js`・`vendor/deck.gl-layers-9.3.4.min.js`・`vendor/deck.gl-mapbox-9.3.4.min.js`（以上 head で `<script defer>`／`<link>`）・`vendor/deck.gl-mesh-layers-9.3.4.min.js`・`vendor/deck.gl-geo-layers-9.3.4.min.js`（遅延・この順）・`vendor/fonts/orbitron-latin.woff2`・`vendor/fonts/saira-latin.woff2`・`vendor/fonts/fonts.css`（`@font-face`×2・`font-weight: 600 800` / `400 700` の範囲指定・`font-display: swap`・`unicode-range` は Google の latin と同値）・`vendor/fonts/OFL-Orbitron.txt`・`vendor/fonts/OFL-Saira.txt`・`vendor/LICENSE-maplibre-gl.txt`（BSD-3）・`vendor/LICENSE-deck.gl.txt`（MIT）・`vendor/README.md`（上流 URL・取得日・再取得手順）。
- 取得は `scripts/fetch_vendor.py`（unpkg の同一 URL と Google css2 API（Chrome UA・latin ブロックの woff2）から取得・**CDN と同一バイト**・`tests/vendor.sha256` を生成）。手で編集しない。
- index.html: unpkg 2 本＋Google Fonts 3 行を撤去し、`<link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin>`・`<link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin>`・`vendor/maplibre-gl-5.24.0.css`・`vendor/fonts/fonts.css`・`<script defer>`×3（core→layers→mapbox の順・module script は仕様上 defer 相当で文書順に後で実行されるため `deck`/`maplibregl` は main.js 実行時に必ず存在する）。
- **TripsLayer の遅延ロード**: `js/lib/vendor-loader.js` に `ensureTripsLayer(doc = document)`＝`globalThis.deck?.TripsLayer` があれば resolved／無ければ mesh-layers→geo-layers の順に `<script>` を 1 回だけ注入（Promise をモジュール内でキャッシュ・失敗時は reject して再試行可）。main.js の貿易フロー builder（176 行付近）は `deck.TripsLayer` が未定義なら `ensureTripsLayer().then(() => rebuild(overlay))` を起動して `null` を返す（ロード完了で再描画）。初期状態で `trade` が ON（permalink/保存/『交通』プリセット）でも同じ経路で自然に解決。
- テスト: `tests/test_vendor_integrity.py`＝`tests/vendor.sha256` の全ファイル一致・vendor 一覧が過不足なし・HTML/CSS/JS（vendor 除く）に `unpkg.com`・`googleapis.com`・`gstatic.com` の文字列が無い・index.html の外部 `<script src>`/`<link href>` が 0／`tests/vendor_loader.test.js`（node:test・fake document で「2 本を順に注入」「二重呼び出しで 1 回」「既にある時は注入しない」）／e2e（§4-4）で『交通』ON→`deck.TripsLayer` が定義され pageerror 0。
- e2e 用フック: main.js は `location.search` に `e2e=1` がある時だけ `window.__orbis = { map }` を公開（§4-4 の能力アサート用・通常導線では未定義）。
- 実機確認（headless の画素は信用しない）: globe 投影・加算合成（quakes/conflict の発光）・貿易フローの軌跡アニメ・カメラのペイン。

### 3.3 A3 表示の正直さ
- `js/ui/ai-meta.js`（純関数・DOM 非依存）:
  - `freshnessChip({ updated, now, staleMs = 24*3600e3 })` → `{ text, stale, rel }`。`text`＝stale でなければ「最終更新 3時間前」、stale なら「更新停止中 · 最終 11日前」。`rel` は `js/ui/sources.js` の `relTime` を再利用。`updated` 不正なら `{ text: '更新時刻 不明', stale: true }`。
  - `freshnessChipHtml(...)` → `<span class="fresh-chip[ is-stale]" title="ISO">text</span>`（値は `escapeHtml`）。
  - `aiDisclaimerHtml({ model, generatedAt })` → 「AI 生成（claude-haiku-4-5・2026-08-23 08:16 UTC）・要約/推定であり誤りを含むことがあります」。
  - `isPlaceholderNarrative(s)` → 実データの定型『与えたデータには不安定性を示す具体的な事象が記載されていない』（2026-09-03 本番 5/25 件）と、`記載されていない|データ(が|は|には)?不足|具体的な事象` を含む文で true。
- 差し込み: index.html:142・150 の『／毎時更新』を撤去し `<span class="brief-fresh" id="brief-fresh"></span>`／`#ins-fresh`、FORECASTS 見出し（161）に `#fc-fresh`。briefing.js / instability.js / forecast.js の描画で `snap.updated`／`generated_at` からチップと免責（各リストの末尾に `<p class="ai-disclaimer">`）を出す。`#freshness` ピル（main.js `updateFreshness`）の items に AI 3 層＋news を追加（`freshnessSummary` はそのまま・AI/news の staleMs は 24h＝`FRESH_AI_MS` 定数）。ALERTS（alerts.js `alertChipHtml`）に `<span class="alert-when">` で元 snapshot の相対時刻。instability.js `rowHtml` は `isPlaceholderNarrative` なら `<p class="ins-narr ins-narr--none">AI 分析文なし（入力データ不足）</p>`（score・level は改変しない）。ニュース要約（selection.js `newsPopupHtml`・feed.js の行）に `<span class="ai-tag">見出しからのAI要約</span>`。
- テスト: `tests/ai-meta.test.js`（閾値の前後・不正値・定型文 3 例＋非該当 2 例・HTML エスケープ）／既存 `tests/freshness.test.js`・`alerts.test.js`・`instability.test.js`・`briefing.test.js` に差し込みの回帰を追加／e2e で `#brief-fresh` が非空かつ `is-stale`（本番データは 8/23 で停止中）。

### 3.4 A4 公開の体裁
- 静的ページ `about.html`・`terms.html`・`privacy.html`・`attribution.html`・`404.html`＝共通 `css/pages.css`（`css/orbis.css` のトークン `:root` を `@import` せず必要な変数だけ複製しない＝**orbis.css を `<link>` で共有**し、ページ用の余白/文章スタイルだけ `pages.css`）。設計言語は監修ノートどおり（宇宙的・大気ハロ・**サイバーパンク HUD を足さない**）。各ページ＝ワードマーク＋戻るリンク＋本文＋共通フッター。noindex は付けない。
  - about: 何のサイトか（無料 OSINT の集約・公開・読み取り専用）／運営者 **sg55555（個人・非商用）**／連絡先 **GitHub Issues（sg55555/orbis）**／更新の仕組み（GitHub Actions・AI 3 層は停止中）。
  - terms: 免責（正確性・完全性の非保証／AI 生成物は要約・推定で誤りうる／安全・投資・避難等の判断に使わない）・禁止事項（過負荷・自動大量取得・改変再配布はライセンスに従う）・準拠法＝日本法・変更の告知方法。
  - privacy: アカウント・Cookie・解析ツールなし／localStorage に保存する項目（実装時に `js/lib/state.js`・`watchlist.js`・`presets` 等を grep して列挙）／外部送信先＝GitHub（raw.githubusercontent.com・データ）・OpenFreeMap（タイル）・YouTube（`youtube-nocookie.com`・動画再生時のみ・YouTube のプライバシーポリシーへリンク）・AI 字幕＝タブ音声を **端末内の localhost:8900 へのみ**送る／サーバー側ログ（Vercel の標準アクセスログ）。
  - attribution: 層ごとの出典・ライセンス・帰属（USGS＝パブリックドメイン／NASA FIRMS／GDELT＝利用規約／OpenSky＝利用規約／AISstream／Open-Meteo＝CC BY 4.0／OpenFreeMap・OpenMapTiles・© OpenStreetMap contributors＝ODbL／Wikipedia（ja）＝**CC BY-SA 4.0・AI により要約/再構成した旨と本プロフィール文の CC BY-SA 4.0 提供**／Wikidata＝CC0／ニュース見出し＝各媒体／Orbitron・Saira＝OFL／MapLibre＝BSD-3／deck.gl＝MIT）。`js/ui/sources.js` の `SOURCE_MAP` と一致させる（テストで突合）。
- index.html 末尾（`#sources` の後）に `<footer class="site-foot">`＝about / terms / privacy / attribution へのリンク＋「© 2026 sg55555 · 非商用・個人運営」。
- `LICENSE`（MIT・Copyright (c) 2026 sg55555）＋ README にライセンス節（コード＝MIT／データは各上流の条件＝attribution 参照）。
- orbis-data: `LICENSE`（同 MIT・「JSON の構造と manifest に適用。各データの権利は上流に帰属し DATA-SOURCES.md の条件に従う」）＋ `DATA-SOURCES.md`（層→上流→条件の表・attribution と同内容）。私が手元の shallow clone から**通常 push**（B0 の後・`git pull --rebase` で collect と競合したら再試行）。
- YouTube: `js/ui/media.js` の base を `https://www.youtube-nocookie.com/embed/…` に、`video_id`/`channel_id` を `encodeURIComponent`。`#news-frame`（index.html:117）と cams-pane の動的 iframe に `referrerpolicy="strict-origin-when-cross-origin"`。サムネ `i.ytimg.com` はそのまま（`img-src https:`）。既存 `tests/e2e/media.spec.js`・`media.test.js` の期待 URL を更新。
- AI 字幕: index.html:109 のトグル脇に `<small class="lc-note">タブの音声をこの端末の変換サーバー（localhost:8900）へ送ります。外部には送信しません。</small>`。
- プロフィール出典フッタ（profile_view.js:314-315）: 「出典: Wikipedia (ja) 記事名 ↗（CC BY-SA 4.0・AI により要約/再構成）」＋ライセンスリンク。
- 外部リンク 4 箇所（selection.js 174-175・197-198／sources.js:75／profile_view.js:315）を `rel="noopener noreferrer"`。
- テスト: `tests/test_pages.py`＝4 ページ＋404 が存在し builds に載る・各ページに `<script>` が無い（純静的）・`style=`/`on*=` 無し・共通フッターのリンク 4 本・attribution の出典名集合 ⊇ `SOURCE_MAP` の名前集合・index.html に `youtube.com/embed` が残っていない（`youtube-nocookie` のみ）・`rel="noopener"` だけの外部リンクが 0。

### 3.5 A5 SW・経路・style 厳格化・小止血
- **sw.js v52**（`const CACHE = 'orbis-v52'`）: `SHELL = ['/', '/css/orbis.css', '/js/main.js', '/js/lib/presets.js']`（`/index.html` を外す＝308）。fetch＝`if (url.origin !== self.location.origin) return;`（タイル・raw・YouTube は素通し＝HTTP キャッシュ任せ）→ `if (url.pathname.startsWith('/data/snapshots/')) return;`（ローカル開発時の生データ）→ network-first・**`res.ok && res.type === 'basic'` の時だけ put**・失敗時 `caches.match`。cartocdn 条件は削除。install は `addAll(SHELL)` のまま（SHELL ⊆ 配信物をテストで固定）。
- **style 厳格化（`data-style` 局所適用）**: `js/lib/data-style.js` に `applyDataStyles(root)`＝`root` 自身と配下の `[data-style]` に `el.style.cssText = value` を代入して属性を除去（CSSOM＝CSP 対象外・型の方式 Y と同じ意味論＝`style.display=''` リセット型の要素が壊れない）。21 箇所の `style="${…}"` を `data-style="${…}"` に機械置換（値不変）。呼び出し＝各 innerHTML/insertAdjacentHTML の直後（feed.js 9/49・forecast.js 36・instability.js 86・legend.js 53・panel.js 12・drilldown_view の描画点）／maplibre Popup は main.js の 7 箇所の `setHTML(...).addTo(map)` の直後に `applyDataStyles(selPopup.getElement())`（`showPopup(html)` の小ヘルパに集約）／deck の `getTooltip` が HTML に `style=` を含む場合は `.deck-tooltip` 要素 1 個への `MutationObserver(childList)` で適用（実装時に main.js の getTooltip を確認・含まなければ不要）／index.html の静的 2 件は `data-style="display:none"` に替え、起動時 `applyDataStyles(document)`＋ちらつき防止の CSS `#alerts[data-style],#cams-one-tabs[data-style]{display:none}`（属性除去後は inline style が引き継ぐ）。immerse-bar.js の `cssText` はそのまま（CSSOM）。
- **静的ガード** `tests/test_static_guards.py`: HTML 6 枚（index＋5）＝インライン `<script>` 本文なし・`<style>` なし・`on*=` なし・`style=` なし（`data-style=` は可）／自前 JS（`js/**`・vendor 除く）＝テンプレート内 `style="`・`on[a-z]+="`・`javascript:`・`setAttribute('style'` が無い・`data-style="` を含むファイルは `applyDataStyles` を import（または main.js の Popup ヘルパ経由であることを許可リストで明示）／`js/**` に `unpkg`/`googleapis` 無し／`.superpowers/`・`.claude/`・`.claire/` に追跡ファイルが無い（`git ls-files`）。
- **GDELT** `collectors/gdelt_events.py`: `LASTUPDATE_URL` を `https://`・`lastupdate.txt` から取り出した export URL も `http://`→`https://` に昇格・2 列目の MD5 を `hashlib.md5(zip_bytes).hexdigest()` と照合し不一致は `ValueError`（既存の `mark_error` 経路で可視化）。`tests/test_gdelt.py` に固定 3 列行の fixture で一致/不一致/列不足の 3 ケース。
- **escape/scheme**: instability.js:48/51 の `delta`/`deltaPct` を `Number(...) || 0` で数値化（`fmtSignedPct` にも `Number`）／profile_view.js:315 を `/^https?:\/\//i.test(url) ? url : '#'`＋`escapeHtml`。node:test で `<img onerror>` 文字列を入れても出力に `<img` が現れない。
- **.superpowers**: 追跡 2 ファイル（`.superpowers/sdd/cluster-C4-report.md`・`cluster-C7-report.md`）を `git rm --cached`（履歴は残す・内容は無害）。
- **受入一括** `tools/closure.sh`（型と同じ）: `node --test tests/*.test.js` → `python3 -m pytest -q` → `node tests/e2e-csp.mjs` → 全部通ったら `.closure-ok` に `git rev-parse HEAD`（gitignore）。ログ末尾 `== closure OK`。既存の `npm run test:e2e`（20 spec・data/snapshots 依存）は closure に**含めない**（worktree に生データが無い・Phase B で fixture 化）。

## 4. 検証（TDD・RED を先に）
1. **RED 計測**（2026-09-03 実施済み・scratchpad `csp-red.md`）: 厳格 CSP＋既知オリジン許可で違反 1,979 件（style-src-attr 1,977＝自前テンプレート／wasm-eval 2＝deck.gl）。外部ライブラリの style 違反 0・connect/img/font/worker/frame 違反 0。範囲が §2 の棚卸しと一致することを確認済み。
2. **構造・静的（pytest）**: `test_vercel_routing_sim.py`・`test_security_headers.py`・`test_static_guards.py`・`test_vendor_integrity.py`・`test_sw.py`（CACHE v52・SHELL ⊆ builds 展開集合・ソースに `url.origin !== self.location.origin` と `res.ok && res.type === 'basic'` が存在・`cartocdn`/`/index.html` が無い）・`test_pages.py`・`test_workflow_squash.py`・`test_gdelt.py`。
3. **単体（node:test）**: `ai-meta.test.js`・`data-style.test.js`（属性除去・root 自身・入れ子・`display:none` の意味論）・`vendor_loader.test.js`・escape 回帰・既存 `drilldown_sw.test.js` の更新。
4. **e2e** `tests/e2e-csp.mjs`（Playwright・`/home/shugo/node_modules/playwright`・Chromium 1 本・`--use-gl=swiftshader --enable-unsafe-swiftshader`）＋ハーネス `tests/harness/serve.py`（`tests/vercel_routes.py` の評価器で **builds/routes を実際に評価**して配信＝ヘッダー・308・catch-all 404 を再現・`.css`→`text/css`・`.js/.mjs`→`text/javascript`・`.webmanifest`→`application/manifest+json`・`.gz`→`application/gzip`）。`http://127.0.0.1:<port>/?data=github`（本番 raw の公開データ・読み取りのみ）で:
   - CSP 違反 0・pageerror 0（PC 1280×900／モバイル 390×844・レイヤートグル・プリセット『交通』・凡例・検索『東京』・メディア導線・ブリーフィング/不安定性/予測・共有・（PC）ドリルダウン 1 国）
   - `typeof deck.MapboxOverlay === 'function'`・`.maplibregl-canvas` の存在・`window.__orbis?.map?.getProjection?.().type === 'globe'`（**能力をアサート**＝main.js が `?e2e=1` の時だけ `window.__orbis = { map }` を公開）・『交通』ON 後に `typeof deck.TripsLayer === 'function'`・`.fresh-chip.is-stale` が 3 つ以上・data-style の正の確認（feed 行の `--chip` が computed で非空・`#alerts` の computed display が none）
   - ルーティング: `/nope`→404＋404.html 本文・`/about`→200・`/about.html`→308→`/about`・`/index.html`→308→`/`・`/config/news_feeds.json`→404・`/README.md`→404・`/vendor/deck.gl-core-9.3.4.min.js`→200＋immutable・`/data/static/admin1_bbox.json`→200＋SWR・`/robots.txt`→200
   - negative control: `document.head.appendChild(<style>)` と `el.setAttribute('style', …)` で `securitypolicyviolation` が**起きる**こと（ハーネスが本当に enforce している証拠）。`CSP_OVERRIDE` 環境変数で `'unsafe-inline'` を足すと RED になることを 1 回実確認。
5. **受入一括** `tools/closure.sh` ALL PASS（ログ末尾 `== closure OK`）。

## 5. 受入（Definition of Done）
- 本番 `curl -sI` で `/`・`/about`・`/nope`・`/vendor/maplibre-gl-5.24.0.js`・`/data/static/admin1_bbox.json`・`/data/static/admin1/JA.geojson.gz`（`content-encoding` 無し）・`/config/news_feeds.json`（404）・`/sw.js`（本文に `orbis-v52`）に §3.1 のヘッダーが完全一致で乗り、Cache-Control が 4 段どおり、`/index.html`・`/about.html` が 308。
- 本人実機（PC＋iPhone PWA）: globe・加算合成・『交通』の貿易フロー・カメラ（youtube-nocookie）・ドリルダウン・検索・共有が従来どおり動き、DevTools に CSP 違反 0。AI 3 層と news に「更新停止中 · 最終 N日前」と免責が出る。
- orbis-data: 初回 squash 後に `gh api` の commits が 1・raw 配信の manifest.json が直前と同一内容。統合後 `squash-data.yml` の手動 dispatch が success。
- `LICENSE`・4 ページ・robots・404 が本番で見える。Obsidian `Projects/orbis-enterprise-quality.md` と MEMORY.md に起点を記録・Artifact の所見に「済」（`_adjudication.json` に status→`gen_board.py`→同 URL に再公開）。

## 6. デプロイとロールバック
closure ALL PASS → main へ merge → push（GitHub 連携・手動 `--prod` は打たない・push ゲート＝sw CACHE 版 up／builds 追記／closure 実行）→ 本番 curl（Hobby の日次上限は collector 分離で解消済みだが、反映は `sw.js` の版で突合してから「反映」と言う）→ 本人実機 → `gh workflow run squash-data.yml -f confirm=squash` → 記憶整理。
ロールバック＝`vercel.json` の CSP に `'unsafe-inline'` を足す 1 行（data-style 化済みコードは有無に依存しない）／Vercel instant rollback で `6a92cb1` のデプロイへ／SW は v53 に上げて戻す。B0 は不可逆（履歴を戻す手段は無い＝実行前の再確認で担保）。

## 7. 非スコープ（Phase B／C／課金別枠へ）
CI ゲート・PR で closure を回す workflow（B1）／ntfy 通知・鮮度アラーム（B2）／収集の堅牢化・5 状態（B3/B4）／入口文書（B5）／cam-hit の当たり判定縮小・自動再生の手動化（LEGAL-08 ②③）／`data/static` の URL 版付け／main.js 分割・転送量・a11y・デザイン体系（C）／AI 3 層の再開・profiles 再生成（課金別枠）／時間軸（過去再生）と世代保持（S2 候補）。

## 8. 却下した案
- **現代形式（headers＋cleanUrls＋.vercelignore 否定 allowlist）**: ルーティングを静的に検証できず、カスタム 404 の挙動が Vercel 実装依存。型（builds＋routes）で 3 アプリの一貫性と push ゲート互換を取る（本人選択）。
- **`style-src-attr 'unsafe-inline'`**: コード変更ゼロだがスキャナー減点。21 箇所の機械置換で閉じられる（本人選択）。
- **geo-layers を常時ロード**: 起動時 +237KB gzip。『交通』プリセットでしか使わないので遅延ロード。**geo-layers 単体の遅延**は mesh-layers 未ロードで `Class extends undefined` になる（2026-09-03 実測）ため mesh→geo の 2 本。
- **フォントを可変 TTF から自前変換**: 依存（fonttools/brotli）が増え、Google が配る OFL の woff2 と同一物で足りる。
- **nonce/hash CSP・Report-Only**: 静的配信では nonce を発行できず、レポート受け口も作れない。e2e で違反 0 を先に確認して enforce。
- **SHELL を個別 add＋catch**: 失敗が黙って通る。SHELL ⊆ 配信物をテストで固定し `addAll` のまま。
- **B0 の N 世代保持**: collectors 改修（M）で Phase A の範囲外。時間軸機能の設計時に判断（S2 候補に記録）。
- **`Cross-Origin-Resource-Policy`・`X-Robots-Tag: noindex`**: 前者は脅威モデル外、後者は公開サイトの目的に反する。

## 9. 所見 ID の対応（監査 2026-08-29）
| 束 | 所見 |
|---|---|
| B0 | DATA-03 |
| A1 | SECURITY-01/03/04/05/06/14・COST-04・DATA-17・OPS-13・LEGAL-20・クリティック gap（404） |
| A2 | SECURITY-02・PERF-03・PERF-05・LEGAL-09・PERF-06 |
| A3 | DATA-02（UX-01/04・LEGAL-03 吸収）・UX-02・LEGAL-07 |
| A4 | LEGAL-01/02/06/08①/18・SECURITY-15・COST-19 |
| A5 | SECURITY-07（COST-01/SECURITY-08 吸収）・SECURITY-09/10/11/18・DATA-12 |
