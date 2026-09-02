# Phase A Implementation Plan — part4（Task 10）

骨格 `2026-09-03-orbis-enterprise-phase-a.md` の契約に従う（ヘッダー・Global Constraints・File Structure・Interfaces・Task 一覧はそちらが正本。本分冊は Task 10 の手順本文のみ）。

> **前提**：Task 10 の依存は 3〜9。着手時点で `vercel.json`＋`tests/vercel_routes.py`（T3）・`vendor/**`＋`?e2e=1` フック（T4）・`js/lib/vendor-loader.js` の TripsLayer 遅延ロード（T5）・`data-style` 化（T6）・`.fresh-chip.is-stale`（T7）・youtube-nocookie（T8）・sw v52（T9）が全て緑になっている。
>
> **Task 6 に依頼済みの追加フック（part4 の e2e が消費する）**：**Task 6 Step 11-b（e2e 用の適用数公開）**で `js/main.js` の boot 先頭にある `applyDataStyles(document)` の**戻り値**（＝index.html の静的 `data-style` 2 件に適用した数）を、`?e2e=1` のときだけ `window.__orbis.e2e.appliedStatic` に載せる。`window.__orbis` は加算式（`window.__orbis.e2e = { ...(window.__orbis.e2e || {}), appliedStatic: n }`）。これが無いと本分冊 Step 8（e2e 実行）の `PC: applyDataStyles(document) が index.html の静的 data-style 2 件に適用された` が赤になる（レビュー F-2）。
>
> **調査で確定した事実（2026-09-03 実測・本分冊のコードはこれに依存する）**
> - `/home/shugo/node_modules/playwright/index.mjs` は実在し `import { chromium }` が通る（`node -e` 相当で確認済み・Playwright 1.60.0）。`createRequire` フォールバックは保険として残す。
> - Playwright の `apiRequestContext.get(url, { maxRedirects: 0 })` は **3xx を追わずそのまま返す**（`coreBundle.js` で `maxRedirects === 0 → -1` に置換され `options.maxRedirects >= 0` が偽になるため）。`Location` は `headers()` から読める。
> - `js/map.js:45` の deck `getTooltip` は **文字列だけ**を返す（`main.js:344-358`）。HTML も `style=` も含まないので、spec §3.5 が保留していた「`.deck-tooltip` への MutationObserver」は**不要**。
> - `js/ui/alerts.js:78` が `rootEl.style.display = items.length ? '' : 'none'` で `#alerts` を上書きする＝「`#alerts` の computed display が none」は本番データ次第で偽になる。`#alerts` は「件数と表示の整合」で見る（下 Step 7 で書く e2e 本体の該当ブロックにコメントあり）。
> - `js/ui/cams-pane.js:103` の `renderOneTabs()` は `mode !== 1` のとき `oneEl.style.display = 'none'` を**自分で書く**（既定 mode=4 で必ず走る）。したがって **`#cams-one-tabs` の computed display は data-style の証拠にならない**（`applyDataStyles(document)` が動かなくても緑になるトートロジー・レビュー F-2）。index.html の静的 2 件の証拠は `window.__orbis.e2e.appliedStatic === 2` で取り、テンプレート側の証拠は `[data-style]` が 0 個であることで取る。`#cams-one-tabs` のアサートは「cams-pane の描画結果」として残す（意味づけを変えた）。
> - `js/main.js:636/648/651…` の AI 3 層は fetch 失敗時にセクションごと `style.display = 'none'` にする＝`.fresh-chip.is-stale` は **raw が取れることに依存**する。外部要因で `closure.sh` が赤くならないよう、e2e は「取れなかったら `warn` に落とす」経路を持つ（レビュー F-4・Phase B の fixture 化までの暫定）。
> - `--chip` は `js/ui/feed.js:47` の `#feed-chips .feed-chip[data-chip]`、`--rowcat` は同 22 行の `#feed-rows .feed-row` にある（spec §4-4 の「feed 行の `--chip`」を実物のセレクタに割り当てた）。
> - push ゲート（`~/.claude/hooks/guards.py`）の builds チェックは `hooklib.EXCLUDE_DIRS = ("api/", "scripts/", "tools/", "tests/", ".github/")` を除外する＝本タスクが足す `tests/**`・`tools/**` は builds 追記を要求されない。一方 `tools/closure.sh` が**存在するようになった時点で** `check_closure` が有効化され、以後 `git push` は `.closure-ok` == HEAD を要求する。

---

### Task 10: e2e ハーネス `tests/harness/serve.py`＋`tests/e2e-csp.mjs`（違反 0・能力アサート・ルーティング・negative control）＋`tools/closure.sh`＋`.gitignore`＋README 開発/受入節

**Files:**
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tests/harness/serve.py`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tests/harness/smoke.sh`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tests/test_harness_server.py`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tests/e2e-csp.mjs`
- Create: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/tools/closure.sh`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/.gitignore`
- Modify: `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a/README.md`
- Test: `tests/test_harness_server.py`（pytest）／`tests/e2e-csp.mjs`（それ自体が受入テスト）／`tools/closure.sh`（受入一括）

**Interfaces:**

*Consumes*
- `tests/vercel_routes.py`（T3）
  - `load_config(root: Path) -> dict`
  - `expand_builds(cfg: dict, root: Path) -> set[str]`
  - `evaluate(cfg: dict, path: str, served: set[str]) -> RouteResult`（`@dataclass RouteResult: status: int; dest: str | None; headers: dict[str, str]; matched: list[int]`）
- `vercel.json`（T3・routes のヘッダー・Cache-Control 4 段・308・catch-all 404）
- `404.html` `about.html` `robots.txt` `css/pages.css`（T2）
- `vendor/deck.gl-core-9.3.4.min.js` ほか `vendor/**`（T4）／`js/main.js` の `?e2e=1` → `window.__orbis = { map }`（T4）
- `js/lib/vendor-loader.js` の `ensureTripsLayer()` 経由で `globalThis.deck.TripsLayer` が生える（T5）
- `js/lib/data-style.js` の `applyDataStyles(root)` が `[data-style]` を消費する（T6）／`?e2e=1` のとき `window.__orbis.e2e.appliedStatic`＝`applyDataStyles(document)` の戻り値（T6 Step 11-b）
- `js/ui/ai-meta.js` の `freshnessChipHtml()` が出す `<span class="fresh-chip is-stale">`（T7）
- `js/ui/media.js` の `https://www.youtube-nocookie.com/embed/...`（T8）
- Playwright `/home/shugo/node_modules/playwright/index.mjs`（`chromium`）／Chromium 引数 `--use-gl=swiftshader --enable-unsafe-swiftshader`

*Produces*
- `tests/harness/serve.py`
  - CLI: `python3 tests/harness/serve.py --port <int> [--csp-override "<csp>"] [--root <path>]`（既定 `--port 8790`・`--root` はリポジトリルート）
  - `MIME: dict[str, str]` / `DEFAULT_MIME: str`
  - `class Handler(BaseHTTPRequestHandler)`（`do_GET` / `do_HEAD`）
  - `class HarnessServer(ThreadingHTTPServer)`（属性 `root: Path` / `cfg: dict` / `served: set[str]` / `csp_override: str | None`）
  - `make_server(root: Path = ROOT, port: int = 8790, csp_override: str | None = None) -> HarnessServer`（`serve_forever` は呼ばない）
  - `main(argv: list[str] | None = None) -> int`
- `tests/harness/smoke.sh`（`bash tests/harness/smoke.sh [port]`＝ハーネスを background で起動して `/` と `/index.html` を `curl -sI` し、必ず `kill $PID` で落とす目視確認用。非対話 bash では job control が無効で `%1` が使えないので `$!` を使う。変数入りの複雑なコマンドを Bash ツールに直接渡さないための逃げ道も兼ねる）
- `tests/e2e-csp.mjs`（ESM・実行 `NOULIMIT=1 node tests/e2e-csp.mjs`・cwd＝リポジトリルート・env `E2E_PORT`（既定 8790）／`E2E_ROOT`（既定 cwd）／`CSP_OVERRIDE`）。全チェック緑で `ALL OK (N checks)` を出し exit 0、1 つでも落ちたら `=== M FAIL / N checks` を出し exit 1。
- `tools/closure.sh`（`bash tools/closure.sh`。成功で `.closure-ok`＋`== closure OK`、失敗で `== closure FAILED (<段階>)`＋`.closure-ok` 削除＋exit 1）

---

- [ ] **Step 1: 失敗するテストを書く（ハーネスの配信契約）**

`tests/test_harness_server.py` を新規作成（全文）:

```python
"""tests/harness/serve.py の配信契約を実プロセスで測る。

評価器そのもの（builds 展開・routes 評価）は tests/test_vercel_routing_sim.py が見る。
ここは「評価結果が HTTP 応答として正しく出るか」＝status・Location・積まれたヘッダー・
本文・MIME だけを、別スレッドで起動した実サーバに http.client で当てて確認する。
e2e（tests/e2e-csp.mjs）はこのハーネスの上で走るので、ここがずれると e2e の
「CSP 違反 0」も「308/404」も意味を失う。
"""

import http.client
import importlib.util
import pathlib
import threading

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
_SERVE_PY = ROOT / "tests" / "harness" / "serve.py"

# tests/harness/ はパッケージにしない（pytest の収集対象でもない）ので、パスから直接読む。
# モジュール名を一意にして、他の "serve" と衝突しないようにする。
_spec = importlib.util.spec_from_file_location("orbis_harness_serve", _SERVE_PY)
serve = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(serve)


def _start(**kwargs):
    # port=0＝OS に空きポートを選ばせる（並行セッション・e2e の 8790 と衝突しない）。
    srv = serve.make_server(root=ROOT, port=0, **kwargs)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    return srv, thread


def _stop(srv, thread):
    srv.shutdown()
    srv.server_close()
    thread.join(timeout=5)


@pytest.fixture(scope="module")
def harness():
    srv, thread = _start()
    try:
        yield srv
    finally:
        _stop(srv, thread)


def _get(srv, path):
    conn = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    try:
        conn.request("GET", path)
        res = conn.getresponse()
        body = res.read()
        return res.status, {k.lower(): v for k, v in res.getheaders()}, body
    finally:
        conn.close()


def test_binds_loopback_only(harness):
    # host を省くと全インターフェースに bind し、WSL2 の localhostForwarding 経由で
    # Windows ホスト・LAN・Tailscale から作業ツリーが読める。127.0.0.1 に固定する。
    assert harness.server_address[0] == "127.0.0.1"


def test_root_serves_index_with_security_headers(harness):
    status, headers, body = _get(harness, "/")
    assert status == 200
    assert body == (ROOT / "index.html").read_bytes()
    assert headers["content-type"].startswith("text/html")
    csp = headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "style-src 'self'" in csp
    assert "'wasm-unsafe-eval'" in csp
    assert headers["x-content-type-options"] == "nosniff"
    assert headers["x-frame-options"] == "DENY"
    assert headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert headers["cross-origin-opener-policy"] == "same-origin"
    assert "display-capture=(self)" in headers["permissions-policy"]
    assert headers["cache-control"] == "public, max-age=0, must-revalidate"


def test_unknown_path_is_404_with_404_html(harness):
    status, headers, body = _get(harness, "/nope")
    assert status == 404
    assert body == (ROOT / "404.html").read_bytes()
    assert headers["content-type"].startswith("text/html")
    assert "default-src 'self'" in headers["content-security-policy"]


def test_clean_url_about(harness):
    status, headers, body = _get(harness, "/about")
    assert status == 200
    assert body == (ROOT / "about.html").read_bytes()
    assert headers["content-type"].startswith("text/html")


def test_index_html_is_308_to_root(harness):
    status, headers, _ = _get(harness, "/index.html")
    assert status == 308
    assert headers["location"] == "/"


def test_about_html_is_308_to_clean_url(harness):
    status, headers, _ = _get(harness, "/about.html")
    assert status == 308
    assert headers["location"] == "/about"


def test_collector_config_is_not_served(harness):
    # config/ のうちブラウザが読むのは live_channels / live_cameras の 2 つだけ。
    # 収集専用の 5 ファイルは builds の allowlist に載せない＝catch-all 404。
    status, _, body = _get(harness, "/config/news_feeds.json")
    assert status == 404
    assert body == (ROOT / "404.html").read_bytes()


def test_browser_config_is_served(harness):
    status, headers, body = _get(harness, "/config/live_channels.json")
    assert status == 200
    assert headers["content-type"] == "application/json"
    assert body == (ROOT / "config/live_channels.json").read_bytes()


def test_readme_is_not_served(harness):
    status, _, _ = _get(harness, "/README.md")
    assert status == 404


def test_vendor_is_immutable(harness):
    status, headers, body = _get(harness, "/vendor/deck.gl-core-9.3.4.min.js")
    assert status == 200
    assert headers["cache-control"] == "public, max-age=31536000, immutable"
    assert headers["content-type"] == "text/javascript"
    assert body == (ROOT / "vendor/deck.gl-core-9.3.4.min.js").read_bytes()


def test_static_data_is_stale_while_revalidate(harness):
    status, headers, body = _get(harness, "/data/static/admin1_bbox.json")
    assert status == 200
    assert headers["cache-control"] == "public, max-age=3600, stale-while-revalidate=86400"
    assert headers["content-type"] == "application/json"
    assert body == (ROOT / "data/static/admin1_bbox.json").read_bytes()


def test_gz_is_raw_bytes_without_content_encoding(harness):
    # .gz はクライアントが DecompressionStream で展開する＝生バイト配信。
    # Content-Encoding を付けるとブラウザが二重展開して壊れる。
    status, headers, body = _get(harness, "/data/static/admin1/JA.geojson.gz")
    assert status == 200
    assert headers["content-type"] == "application/gzip"
    assert "content-encoding" not in headers
    assert body[:2] == b"\x1f\x8b"


def test_robots_txt_is_served(harness):
    status, headers, body = _get(harness, "/robots.txt")
    assert status == 200
    assert headers["content-type"].startswith("text/plain")
    assert b"Disallow" in body


def test_csp_override_replaces_only_the_csp_header():
    srv, thread = _start(csp_override="default-src 'self' 'unsafe-inline'")
    try:
        status, headers, _ = _get(srv, "/")
        assert status == 200
        assert headers["content-security-policy"] == "default-src 'self' 'unsafe-inline'"
        assert headers["x-frame-options"] == "DENY"                       # 他ヘッダーは触らない
        assert headers["cache-control"] == "public, max-age=0, must-revalidate"
    finally:
        _stop(srv, thread)
```

- [ ] **Step 2: 失敗を確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest tests/test_harness_server.py -q
```
Expected: 収集時に `FileNotFoundError: [Errno 2] No such file or directory: '.../tests/harness/serve.py'`（`_spec.loader.exec_module(serve)` が読む先が無い）。出力に `ERROR tests/test_harness_server.py` と `1 error` が出て非 0 終了。

- [ ] **Step 3: 最小実装（ハーネス本体）**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && mkdir -p tests/harness
```

(a) `tests/harness/serve.py` を新規作成（全文）:

```python
#!/usr/bin/env python3
"""e2e 受入用の配信ハーネス（Python 標準ライブラリのみ）。

vercel.json の builds/routes を tests/vercel_routes.py の評価器でそのまま評価して応答する
＝本番 Vercel と同じヘッダー・Cache-Control・308・catch-all 404 を手元で再現する。
評価器そのものの単体は tests/test_vercel_routing_sim.py が見る。ここが持つのは
「評価結果を HTTP に写す層」だけで、実挙動は tests/test_harness_server.py と
tests/e2e-csp.mjs が実測する。

  $ python3 tests/harness/serve.py --port 8790
  $ python3 tests/harness/serve.py --port 8790 --csp-override "default-src 'self' 'unsafe-inline'"

127.0.0.1 だけに bind する（host を省くと全インターフェースに bind し、WSL2 の
localhostForwarding 経由で Windows ホストや LAN/Tailscale から作業ツリーが読める）。
配信対象は builds の展開集合に限られるので、ドットファイル・tests/・collectors/ には
そもそも到達しない（未知パスは全部 404.html）。
"""

from __future__ import annotations

import argparse
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

_TESTS_DIR = Path(__file__).resolve().parents[1]   # <repo>/tests
ROOT = _TESTS_DIR.parent                           # <repo>
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from vercel_routes import evaluate, expand_builds, load_config  # noqa: E402

# 骨格 Interfaces の MIME（Vercel の実配信に合わせる）。.gz は生バイト配信で
# Content-Encoding を付けない（クライアントが DecompressionStream で展開する）。
# 骨格が挙げていない .txt/.svg/.png/.ico/.webp は builds に載る実資産（robots.txt・
# favicon.svg・favicon-32.png・icons/**）のために補う。
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".webmanifest": "application/manifest+json",
    ".json": "application/json",
    ".geojson": "application/json",
    ".gz": "application/gzip",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/vnd.microsoft.icon",
    ".webp": "image/webp",
}
DEFAULT_MIME = "application/octet-stream"
VERBOSE = bool(os.environ.get("ORBIS_HARNESS_VERBOSE"))


class Handler(BaseHTTPRequestHandler):
    server_version = "OrbisHarness/1"
    protocol_version = "HTTP/1.1"   # Content-Length を必ず出すので keep-alive で良い

    def do_GET(self):    # noqa: N802
        self._respond(with_body=True)

    def do_HEAD(self):   # noqa: N802
        self._respond(with_body=False)

    def log_message(self, fmt, *args):
        # 既定は無音（e2e が数百リクエスト投げる）。ORBIS_HARNESS_VERBOSE=1 で stderr へ。
        if VERBOSE:
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _resolve(self, dest):
        """dest（"/js/main.js" 形式）をルート配下の実ファイルに解決する。外に出たら None。"""
        root = self.server.root
        candidate = (root / dest.lstrip("/")).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            return None
        return candidate if candidate.is_file() else None

    def _respond(self, with_body):
        srv = self.server
        try:
            path = unquote(urlsplit(self.path).path) or "/"
        except (UnicodeDecodeError, ValueError):
            path = "/"

        res = evaluate(srv.cfg, path, srv.served)

        headers = dict(res.headers or {})
        if srv.csp_override is not None:
            headers["Content-Security-Policy"] = srv.csp_override

        status = int(res.status or 200)
        payload = b""
        ctype = None

        if res.dest:
            target = self._resolve(res.dest)
            if target is None:
                # builds に載っているのに実ファイルが無い＝ツリー側の不整合。黙って 404 にせず
                # 500 で目立たせる（e2e が「自オリジンの 4xx/5xx 0」で必ず拾う）。
                status, ctype = 500, "text/plain; charset=utf-8"
                payload = ("harness: dest %s が実ファイルに解決できない" % res.dest).encode("utf-8")
            else:
                ctype = MIME.get(target.suffix.lower(), DEFAULT_MIME)
                payload = target.read_bytes()
        elif status == 404:
            fallback = srv.root / "404.html"
            if fallback.is_file():
                ctype = MIME[".html"]
                payload = fallback.read_bytes()
        elif status == 200:
            status, ctype = 500, "text/plain; charset=utf-8"
            payload = "harness: 200 なのに dest が無い（evaluate() の契約違反）".encode("utf-8")

        self.send_response(status)
        if ctype:
            self.send_header("Content-Type", ctype)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if with_body and payload:
            self.wfile.write(payload)


class HarnessServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def make_server(root=ROOT, port=8790, csp_override=None):
    """ハーネスサーバを作る（serve_forever は呼ばない＝テストから別スレッドで回せる）。"""
    root = Path(root).resolve()
    cfg = load_config(root)
    srv = HarnessServer(("127.0.0.1", port), Handler)
    srv.root = root
    srv.cfg = cfg
    srv.served = expand_builds(cfg, root)
    srv.csp_override = csp_override
    return srv


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Orbis e2e 配信ハーネス（vercel.json の builds/routes を評価して返す）")
    ap.add_argument("--port", type=int, default=8790,
                    help="待受ポート（既定 8790・0 で空きポート）")
    ap.add_argument("--csp-override", default=None,
                    help="Content-Security-Policy ヘッダーだけ差し替える（negative control の RED 用）")
    ap.add_argument("--root", default=str(ROOT),
                    help="配信するツリー（既定＝リポジトリルート）")
    args = ap.parse_args(argv)

    srv = make_server(root=Path(args.root), port=args.port, csp_override=args.csp_override)
    host, port = srv.server_address[0], srv.server_address[1]
    print("orbis harness: http://%s:%d/ root=%s served=%d"
          % (host, port, srv.root, len(srv.served)), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

(b) `tests/harness/smoke.sh` を新規作成（全文）— ハーネスの CLI 契約を目視するためだけの薄いスクリプト。
非対話 bash では job control が無効で `%1`（`kill %1`）が「no such job」になるので `$!` で PID を掴む。
変数入りの複雑なコマンドを Bash ツールへ直接渡さずに済む（worktree ガード対策）という副次効果もある:

```bash
#!/usr/bin/env bash
# tests/harness/serve.py の CLI 契約を 1 発で目視する（受入には含めない・closure.sh からも呼ばない）。
#   使い方: bash tests/harness/smoke.sh [port]   （既定 8790）
# 非対話 bash は job control が無効なので %1 ではなく $! で PID を掴み、trap で必ず落とす。
set -u
cd "$(dirname "$0")/../.."

PORT="${1:-8790}"
BASE="http://127.0.0.1:${PORT}"

python3 tests/harness/serve.py --port "$PORT" &
PID=$!
trap 'kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null' EXIT

# 起動待ち（foreground の sleep はツール側でブロックされうるので curl の再試行で待つ）
curl -s --retry 30 --retry-delay 1 --retry-all-errors -o /dev/null "$BASE/" || {
  echo "smoke: ハーネスが起動しなかった"; exit 1; }

echo "--- GET / ---"
curl -sI "$BASE/"
echo "--- GET /index.html ---"
curl -sI "$BASE/index.html"
echo "smoke: done"
```

- [ ] **Step 4: 通ることを確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest tests/test_harness_server.py -q
```
Expected: PASS（`14 passed`＝`tests/test_harness_server.py` に定義したテスト 14 本）。

Run（既存 pytest 全体が赤くなっていないこと）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && python3 -m pytest -q
```
Expected: PASS（`failed` が 0・`error` が 0）。

Run（ハーネスの CLI 契約を 1 発だけ目視。`%1` は非対話 bash では使えないので `$!` を使うスクリプトに落としてある）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && bash tests/harness/smoke.sh
```
Expected: `--- GET / ---` の下に `HTTP/1.1 200 OK`＋`Content-Security-Policy:`＋`Cache-Control: public, max-age=0, must-revalidate`、`--- GET /index.html ---` の下に `HTTP/1.1 308 Permanent Redirect`＋`Location: /`、最後に `smoke: done`。プロセスは残らない（`pgrep -f 'harness/serve.py'` が空）。

- [ ] **Step 5: コミット**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add tests/harness/serve.py tests/harness/smoke.sh tests/test_harness_server.py
```

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git commit -m "$(cat <<'EOF'
test(e2e): vercel.json の builds/routes を評価する配信ハーネスを追加

tests/harness/serve.py が tests/vercel_routes.py の evaluate() の結果をそのまま
HTTP に写す（status・Location・積まれたヘッダー・dest のファイル本文）。MIME は
Vercel の実配信に合わせ、.gz は Content-Encoding を付けずに生バイトで返す。
127.0.0.1 だけに bind し、配信対象は builds の展開集合に限る。--csp-override は
negative control の RED 用に CSP ヘッダーだけ差し替える。

tests/test_harness_server.py は実プロセスを別スレッドで起動し http.client で
/・/nope・/about・/index.html・/about.html・/config/*・/README.md・/vendor/*・
/data/static/*・/data/static/admin1/JA.geojson.gz・/robots.txt の status と
ヘッダーと本文を実測する（ポートは 0＝空きポートで並行実行と衝突しない）。
tests/harness/smoke.sh は CLI 契約の目視用（$! で起動・必ず kill する）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
)"
```

---

- [ ] **Step 6: 失敗を確認（e2e 本体が無いこと）**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && NOULIMIT=1 node tests/e2e-csp.mjs; echo "exit=$?"
```
Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../tests/e2e-csp.mjs'` と `exit=1`。

- [ ] **Step 7: e2e 本体を書く**

`tests/e2e-csp.mjs` を新規作成（全文）:

```js
#!/usr/bin/env node
// tests/e2e-csp.mjs — 本番と同じヘッダー/ルーティング下で Orbis を実ブラウザに載せる受入 e2e。
//
//   1) tests/harness/serve.py を spawn（vercel.json の builds/routes を tests/vercel_routes.py で
//      評価して配信＝CSP・Cache-Control・308・catch-all 404 まで本番と同じ）
//   2) PC 1280×900 とモバイル 390×844 で ?data=github&e2e=1 を開き spec §4-4 の操作を通す
//      → CSP 違反 0・pageerror 0・自オリジンの console.error 0・自オリジンの 4xx/5xx 0
//   3) 能力アサート（deck.MapboxOverlay・maplibregl canvas・globe 投影・TripsLayer の遅延ロード）
//   4) 表示の正直さ（#brief-fresh / #ins-fresh / #fc-fresh が非空かつ is-stale）と data-style の正の確認
//   5) ルーティング（404・clean URL・308・配信外 404・Cache-Control 4 段）
//   6) negative control＝<style> 注入と setAttribute('style') で違反が「増える」こと
//      （増えないなら CSP が enforce されていない＝1〜5 の緑に意味が無い）
//
// 実行（cwd＝リポジトリルート）:
//   NOULIMIT=1 node tests/e2e-csp.mjs
//   ※ 行頭の NOULIMIT=1 は必須。Bash hook の `ulimit -v` の下では Chromium が起動できない。
//
// RED（negative control が本当に効いているかの確認・落ちるのが正しい）:
//   CSP_OVERRIDE="… style-src 'self' 'unsafe-inline' …" NOULIMIT=1 node tests/e2e-csp.mjs
//
// 環境変数: E2E_PORT（既定 8790）／E2E_ROOT（既定 cwd）／CSP_OVERRIDE（ハーネスへ素通し）
//
// 注意: `waitUntil: 'networkidle'` は使わない。ニュースの YouTube ライブ配信が流れ続けて
// 永遠に idle にならないため、domcontentloaded ＋ 明示的な waitForFunction で待つ。

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const PW_ESM = '/home/shugo/node_modules/playwright/index.mjs';
const PW_CJS = '/home/shugo/node_modules/playwright/index.js';
const { chromium } = existsSync(PW_ESM)
  ? await import(PW_ESM)
  : createRequire(import.meta.url)(PW_CJS);

const ROOT = resolve(process.env.E2E_ROOT || process.cwd());
const PORT = Number(process.env.E2E_PORT || 8790);
const BASE = `http://127.0.0.1:${PORT}`;
// ?data=github＝本番データ（raw.githubusercontent.com/sg55555/orbis-data・読み取りのみ）。
// ?e2e=1＝main.js が window.__orbis = { map } を公開する（能力アサート用のフック）。
const APP = `${BASE}/?data=github&e2e=1`;
const CSP_OVERRIDE = process.env.CSP_OVERRIDE || '';

// 良性の console.error。Permissions-Policy 既定（compute-pressure 等）と headless の
// ソフトウェア GPU 由来で、CSP とは無関係（2026-09-03 の RED 計測で実測・scratchpad/csp-red.md §3）。
const BENIGN_CONSOLE = [
  /Permissions policy violation/i,
  /WebGL|WebGPU|SwiftShader|GL Driver|No available adapters|Automatic fallback to software/i,
];

// 期待本文の比較元（ルーティングの 404/clean URL を「文言」でなく「同一ファイル」で見る）
const FILES = {
  '404.html': readFileSync(join(ROOT, '404.html'), 'utf8'),
  'about.html': readFileSync(join(ROOT, 'about.html'), 'utf8'),
};

let checks = 0;
let failures = 0;
function assert(cond, msg) {
  checks++;
  if (cond) console.log('ok  :', msg);
  else { failures++; console.error('FAIL:', msg); }
}
const warn = (msg) => console.warn('warn:', msg);

// ── ハーネス起動 ──────────────────────────────────────────────────
const harnessArgs = ['tests/harness/serve.py', '--port', String(PORT)];
if (CSP_OVERRIDE) harnessArgs.push('--csp-override', CSP_OVERRIDE);
const server = spawn('python3', harnessArgs, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
server.stdout.on('data', (b) => serverLog.push(String(b)));
server.stderr.on('data', (b) => serverLog.push(String(b)));
server.on('error', (e) => serverLog.push(`spawn error: ${String(e && e.message)}\n`));

async function waitForHarness(ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${BASE}/`, { redirect: 'manual' });
      await r.arrayBuffer();                       // undici の接続を確実に解放する
      if (r.status === 200) return;
    } catch { /* 起動待ち */ }
    if (Date.now() - t0 > ms) {
      throw new Error(`ハーネスが ${ms}ms で起動しなかった:\n${serverLog.join('')}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

// ── ページ生成（違反・例外・4xx コレクタ付き）──────────────────────
async function newPage(viewport) {
  const ctx = await browser.newContext({
    serviceWorkers: 'block',     // SW が応答を差し替えると CSP の観測が濁る
    timezoneId: 'Asia/Tokyo',
    locale: 'ja-JP',
    viewport,
  });
  ctx.setDefaultTimeout(8000);
  const page = await ctx.newPage();
  const bag = { errs: [], consoleErrs: [], bad: [] };
  page.on('pageerror', (e) =>
    bag.errs.push(String((e && e.stack) || (e && e.message) || e).slice(0, 400)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    bag.consoleErrs.push({ text: m.text().slice(0, 300), url: loc.url || '' });
  });
  page.on('response', (r) => {
    if (r.url().startsWith(BASE) && r.status() >= 400) bag.bad.push(`${r.status()} ${r.url()}`);
  });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  // addInitScript は全フレームで走るが window はフレームごとに別。page.evaluate は
  // メインフレームで動くので、ここに集まるのはトップ文書の違反だけ（YouTube iframe の
  // 内部 CSP 違反は混ざらない）。
  await page.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspv.push({
        d: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI,
        src: String(e.sourceFile || '').replace(/^https?:\/\/[^/]+/, ''),
        line: e.lineNumber || 0,
        sample: String(e.sample || '').slice(0, 80),
      });
    });
  });
  return { ctx, page, bag };
}

const cspv = (page) => page.evaluate(() => (window.__cspv || []).slice());

function summarize(v) {
  const m = new Map();
  for (const x of v) {
    const k = `${x.d} <- ${x.blocked} @${x.src}:${x.line}${x.sample ? ` 例:${x.sample}` : ''}`;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`);
}

async function assertClean(page, bag, label) {
  const v = await cspv(page);
  if (v.length) {
    console.error(`  ${label} の CSP 違反 ${v.length} 件（多い順・上位 12）:`);
    for (const line of summarize(v).slice(0, 12)) console.error('   - ' + line);
  }
  assert(v.length === 0, `${label}: CSP 違反 0（実測 ${v.length}）`);

  if (bag.errs.length) {
    console.error(`  ${label} の pageerror:`);
    for (const e of bag.errs) console.error('   - ' + e);
  }
  assert(bag.errs.length === 0, `${label}: pageerror 0（実測 ${bag.errs.length}）`);

  // 自オリジン由来だけを見る（YouTube iframe 内のログは対象外）。既知の良性は除く。
  const own = bag.consoleErrs
    .filter((c) => c.url.startsWith(BASE))
    .filter((c) => !BENIGN_CONSOLE.some((re) => re.test(c.text)));
  if (own.length) {
    console.error(`  ${label} の console.error（自オリジン）:`);
    for (const c of own) console.error(`   - ${c.text} @${c.url}`);
  }
  assert(own.length === 0, `${label}: 自オリジンの console.error 0（実測 ${own.length}）`);

  if (bag.bad.length) {
    console.error(`  ${label} の 4xx/5xx（自オリジン）:`);
    for (const b of bag.bad) console.error('   - ' + b);
  }
  assert(bag.bad.length === 0, `${label}: 自オリジンの 4xx/5xx 0（実測 ${bag.bad.length}）`);
}

// ── 操作ヘルパ（無い要素は warn してスキップ＝実装差分ではなく退行だけを落とす）──
async function tap(page, selector, label, { nth = 0, timeout = 4000, settle = 900 } = {}) {
  const all = page.locator(selector);
  if ((await all.count()) <= nth) { warn(`${label}: ${selector} が見つからない（スキップ）`); return false; }
  try {
    const loc = all.nth(nth);
    await loc.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
    await loc.click({ timeout });
    await page.waitForTimeout(settle);
    return true;
  } catch (e) {
    warn(`${label}: クリックできなかった（${String((e && e.message) || e).split('\n')[0].slice(0, 140)}）`);
    return false;
  }
}

async function bootApp(page, label) {
  await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => !!(window.__orbis && window.__orbis.map), null, { timeout: 30000 });
  await page.waitForSelector('.maplibregl-canvas', { timeout: 30000 });
  // ?data=github の実データ到着（フィード行が出れば snapshot が届いている）
  await page.waitForFunction(
    () => document.querySelectorAll('#feed-rows .feed-row').length > 0, null, { timeout: 45000 },
  ).catch(() => warn(`${label}: フィード行が 45s で出なかった（raw の遅延）`));
  await page.waitForTimeout(3000);   // AI 3 層・メディアの初期描画が落ち着くまで
}

async function search(page, label) {
  const input = page.locator('#search-input');
  if ((await input.count()) === 0) { warn(`${label}: #search-input が無い（スキップ）`); return false; }
  try {
    await input.click({ timeout: 4000 });
    await input.fill('東京');
    await page.waitForSelector('#search-results .search-opt', { timeout: 5000 });
    await page.locator('#search-results .search-opt').first().click({ timeout: 4000 });
    await page.waitForTimeout(2000);     // flyTo（1.5s）の完了待ち
    return true;
  } catch (e) {
    warn(`${label}: 検索『東京』が通らなかった（${String((e && e.message) || e).split('\n')[0].slice(0, 140)}）`);
    return false;
  }
}

// ドリルダウンは map.on('click', cc.handleMapClick) 経由でしか開かない（main.js:527）。
// 検索『東京』で日本の中心へ飛んだ直後に地図の中央をクリックする。
async function drilldown(page, label) {
  const box = await page.locator('#map').boundingBox();
  if (!box) { warn(`${label}: #map が測れない（ドリルダウンをスキップ）`); return false; }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  try {
    await page.waitForSelector('#drilldown:not([hidden])', { timeout: 8000 });
    await page.waitForTimeout(2500);      // admin1 の展開・プロフィール描画待ち
    await page.keyboard.press('Escape');  // 以降の操作を邪魔しないよう閉じる
    await page.waitForTimeout(500);
    return true;
  } catch {
    warn(`${label}: 地図クリックでドリルダウンが開かなかった（陸に当たらなかった可能性・スキップ）`);
    return false;
  }
}

// ── ルーティング（page.request＝ブラウザのネットワークスタックで実測）──────
async function checkRouting(page) {
  const get = async (path, readBody = true) => {
    const r = await page.request.get(BASE + path, { maxRedirects: 0, failOnStatusCode: false });
    return { status: r.status(), headers: r.headers(), text: readBody ? await r.text() : '' };
  };

  let r = await get('/nope');
  assert(r.status === 404, `routing: /nope → 404（実測 ${r.status}）`);
  assert(r.text === FILES['404.html'], 'routing: /nope の本文が 404.html と同一');
  assert((r.headers['content-security-policy'] || '').includes("style-src 'self'"),
    'routing: /nope にも CSP が乗る');

  r = await get('/about');
  assert(r.status === 200, `routing: /about → 200（実測 ${r.status}）`);
  assert(r.text === FILES['about.html'], 'routing: /about の本文が about.html と同一');
  assert((r.headers['content-type'] || '').startsWith('text/html'),
    `routing: /about は text/html（実測 ${r.headers['content-type']}）`);

  r = await get('/about.html', false);
  assert(r.status === 308 && r.headers['location'] === '/about',
    `routing: /about.html → 308 /about（実測 ${r.status} ${r.headers['location']}）`);

  r = await get('/index.html', false);
  assert(r.status === 308 && r.headers['location'] === '/',
    `routing: /index.html → 308 /（実測 ${r.status} ${r.headers['location']}）`);

  r = await get('/config/news_feeds.json', false);
  assert(r.status === 404, `routing: /config/news_feeds.json は配信しない（実測 ${r.status}）`);

  r = await get('/README.md', false);
  assert(r.status === 404, `routing: /README.md は配信しない（実測 ${r.status}）`);

  r = await get('/vendor/deck.gl-core-9.3.4.min.js', false);
  assert(r.status === 200, `routing: /vendor/deck.gl-core-9.3.4.min.js → 200（実測 ${r.status}）`);
  assert(r.headers['cache-control'] === 'public, max-age=31536000, immutable',
    `routing: vendor は immutable（実測 ${r.headers['cache-control']}）`);

  r = await get('/data/static/admin1_bbox.json', false);
  assert(r.status === 200, `routing: /data/static/admin1_bbox.json → 200（実測 ${r.status}）`);
  assert(r.headers['cache-control'] === 'public, max-age=3600, stale-while-revalidate=86400',
    `routing: data/static は SWR（実測 ${r.headers['cache-control']}）`);

  r = await get('/robots.txt', false);
  assert(r.status === 200, `routing: /robots.txt → 200（実測 ${r.status}）`);
}

// ── メイン ────────────────────────────────────────────────────────
let browser = null;
try {
  await waitForHarness();

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });

  // ── PC 1280×900 ────────────────────────────────────────────────
  {
    const { ctx, page, bag } = await newPage({ width: 1280, height: 900 });
    await bootApp(page, 'PC');

    // 能力アサート（headless の画素は信用しないが「動いているか」は測れる）
    assert(await page.evaluate(() => typeof globalThis.deck?.MapboxOverlay === 'function'),
      'PC: deck.MapboxOverlay が関数（自前配信の deck.gl core+layers+mapbox がロードされた）');
    assert((await page.locator('.maplibregl-canvas').count()) >= 1,
      'PC: .maplibregl-canvas が存在（MapLibre が描画している）');
    const proj = await page.evaluate(() => {
      const m = window.__orbis && window.__orbis.map;
      if (!m) return { err: 'window.__orbis.map が無い（?e2e=1 のフック未実装）' };
      if (typeof m.getProjection !== 'function') return { err: 'map.getProjection が無い' };
      const p = m.getProjection() || {};
      return { type: p.type };
    });
    assert(proj.type === 'globe', `PC: globe 投影（実測 ${proj.err || proj.type}）`);

    // 操作: レイヤートグル・プリセット『交通』・凡例
    await tap(page, '.layer-row', 'PC: レイヤートグル[0]', { nth: 0 });
    await tap(page, '.layer-row', 'PC: レイヤートグル[1]', { nth: 1 });
    const traffic = await tap(page, '.preset-chip[data-preset="traffic"]', 'PC: プリセット『交通』', { settle: 1500 });
    assert(traffic, 'PC: プリセット『交通』をクリックできた');
    if (traffic) {
      // trade（TripsLayer）は @deck.gl/geo-layers。mesh-layers → geo-layers の順に
      // 遅延ロードされる（js/lib/vendor-loader.js）。
      let lazy = true;
      await page.waitForFunction(
        () => typeof globalThis.deck?.TripsLayer === 'function', null, { timeout: 20000 },
      ).catch(() => { lazy = false; });
      assert(lazy, 'PC: 『交通』ON で deck.TripsLayer が遅延ロードされる（mesh-layers → geo-layers）');
    }
    await tap(page, '.legend-collapse', 'PC: 凡例の開閉');
    await tap(page, '.legend-tab[data-tab="help"]', 'PC: 凡例「使い方」タブ');

    // 検索『東京』→候補 → ドリルダウン 1 国（PC のみ）
    await search(page, 'PC');
    await drilldown(page, 'PC');

    // メディア導線（youtube-nocookie の iframe が frame-src で通ることの実測を兼ねる）
    await tap(page, '#media-hint', 'PC: メディアへ移動');
    await tap(page, '.mode-btn[data-mode="1"]', 'PC: カメラ 1 画面');
    await tap(page, '.area-tab', 'PC: カメラのエリアタブ[0]');
    await tap(page, '.mode-btn[data-mode="4"]', 'PC: カメラ 4 画面へ戻す');
    await tap(page, '#news-tabs button', 'PC: ニュースのタブ[0]', { settle: 2000 });
    await tap(page, '#media-cc-toggle', 'PC: 字幕トグル');
    // #lc-toggle（AI 字幕）は getDisplayMedia を要求するので headless では操作しない。

    // ブリーフィング / 不安定性 / 予測 / 共有 / パネル
    await tap(page, '.brief-card:not(.no-loc)', 'PC: ブリーフィングカード');
    await tap(page, '.ins-row', 'PC: 不安定性ランキング行');
    await tap(page, '.fc-tab', 'PC: 予測タブ[0]');
    await tap(page, '.fc-cardbtn:not([disabled])', 'PC: 予測カード');
    await tap(page, '.fc-log summary', 'PC: 予測の過去ログ');
    await tap(page, '#share-btn', 'PC: 共有ボタン');
    await tap(page, '#panel-toggle', 'PC: レイヤーパネル折りたたみ');
    await tap(page, '#feed-toggle', 'PC: フィードパネル折りたたみ');

    // 表示の正直さ（AI 3 層は 2026-08-23 で停止＝各セクションに「更新停止中」チップが出る）
    // js/main.js:636/648/651… は raw の取得に失敗するとセクションごと display:none にするので、
    // 「セクションが生きている（＝AI データが取れている）のにチップが無い／stale でない」ときだけ赤にする。
    // 外部要因（orbis-data の一時障害・squash 直後）で closure.sh が赤くなるのを避ける暫定措置
    // （Phase B の fixture 化で恒久対応する）。
    await page.waitForFunction(
      () => document.querySelectorAll('.fresh-chip.is-stale').length >= 3, null, { timeout: 20000 },
    ).catch(() => {});
    for (const [sec, chip, name] of [
      ['#ai-brief', '#brief-fresh', 'ブリーフィング'],
      ['#instability', '#ins-fresh', '不安定性'],
      ['#forecasts', '#fc-fresh', '予測'],
    ]) {
      const st = await page.evaluate(([s, c]) => {
        const sectionEl = document.querySelector(s);
        if (!sectionEl) return { missing: 'section' };
        if (getComputedStyle(sectionEl).display === 'none') return { off: true };
        const chipEl = document.querySelector(c);
        if (!chipEl) return { missing: 'chip' };
        return { text: (chipEl.textContent || '').trim(), stale: !!chipEl.querySelector('.is-stale') || chipEl.classList.contains('is-stale') };
      }, [sec, chip]);
      if (st.off) { warn(`PC: ${name}（${sec}）が非表示＝raw の AI データが取れていない（鮮度チップの検証をスキップ）`); continue; }
      assert(!st.missing && !!st.text, `PC: ${chip} が非空（${name}・実測 ${st.missing || JSON.stringify(st.text)}）`);
      assert(!!st.stale, `PC: ${chip} が is-stale（${name}・AI 3 層は 2026-08-23 で停止・実測 ${st.stale}）`);
    }
    const staleN = await page.locator('.fresh-chip.is-stale').count();
    console.log(`info: PC の .fresh-chip.is-stale 総数 = ${staleN}`);

    // data-style の正の確認（属性が消費され、値が CSSOM に流れていること）
    assert((await page.locator('[data-style]').count()) === 0,
      'PC: [data-style] は全て CSSOM に流し込まれ属性が残っていない');
    // index.html の静的 2 件（#alerts・#cams-one-tabs）の証拠。computed display で測ると
    // alerts.js:78 と cams-pane.js:103 が自分で display を書くのでトートロジーになる（レビュー F-2）。
    // Task 6 Step 11-b が ?e2e=1 のときだけ公開する applyDataStyles(document) の戻り値を見る。
    const appliedStatic = await page.evaluate(
      () => (window.__orbis && window.__orbis.e2e || {}).appliedStatic);
    assert(appliedStatic === 2,
      `PC: applyDataStyles(document) が index.html の静的 data-style 2 件に適用された（実測 ${appliedStatic}）`);
    const chipVar = await page.evaluate(() => {
      const el = document.querySelector('#feed-chips .feed-chip[data-chip]');
      return el ? getComputedStyle(el).getPropertyValue('--chip').trim() : null;
    });
    assert(!!chipVar, `PC: フィードチップの --chip が computed で非空（実測 ${JSON.stringify(chipVar)}）`);
    const rowVar = await page.evaluate(() => {
      const el = document.querySelector('#feed-rows .feed-row');
      return el ? getComputedStyle(el).getPropertyValue('--rowcat').trim() : null;
    });
    assert(!!rowVar, `PC: フィード行の --rowcat が computed で非空（実測 ${JSON.stringify(rowVar)}）`);
    // 以下 2 つは data-style の証拠ではなく「描画ロジックの結果」の確認。
    // #cams-one-tabs は cams-pane.js:103 が mode!==1（既定 4）で display:none を書く。
    const camsDisp = await page.evaluate(() => {
      const el = document.getElementById('cams-one-tabs');
      return el ? getComputedStyle(el).display : null;
    });
    assert(camsDisp === 'none',
      `PC: #cams-one-tabs は 4 画面モードで display:none（cams-pane の描画結果・実測 ${camsDisp}）`);
    // #alerts は renderAlerts（js/ui/alerts.js:78）が件数で display を上書きするので、
    // 「none 固定」ではなく「件数と表示が整合しているか」を見る（0 件なら none・1 件以上なら非 none）。
    const alerts = await page.evaluate(() => {
      const el = document.getElementById('alerts');
      if (!el) return null;
      const list = el.querySelector('.alert-list');
      return { display: getComputedStyle(el).display, n: list ? list.children.length : 0 };
    });
    assert(alerts && (alerts.n === 0 ? alerts.display === 'none' : alerts.display !== 'none'),
      `PC: #alerts の表示がアラート件数と整合（件数 ${alerts && alerts.n} / display ${alerts && alerts.display}）`);

    // ここまでが「通常導線の観測」。assertClean を先に済ませてから、意図的に 404 を叩く
    // checkRouting に入る（page.request が page.on('response') を発火する実装/版でも
    // 「自オリジンの 4xx/5xx 0」が誤検知しないようにする・レビュー F-3）。
    await assertClean(page, bag, 'PC');
    await checkRouting(page);
    await ctx.close();
  }

  // ── モバイル 390×844 ───────────────────────────────────────────
  // 能力・ルーティングは PC で見たので、ここはモバイル専用テンプレート（シート）の
  // CSP 違反 0 と data-style の消費だけを見る。
  {
    const { ctx, page, bag } = await newPage({ width: 390, height: 844 });
    await bootApp(page, 'モバイル');
    await tap(page, '.mobile-tab[data-sheet="layers"]', 'モバイル: レイヤーシート');
    await tap(page, '.layer-row', 'モバイル: レイヤートグル[0]', { nth: 0 });
    await tap(page, '.preset-chip[data-preset="traffic"]', 'モバイル: プリセット『交通』', { settle: 1500 });
    await tap(page, '.mobile-tab[data-sheet="legend"]', 'モバイル: 凡例シート');
    await tap(page, '.legend-tab[data-tab="help"]', 'モバイル: 凡例「使い方」タブ');
    await tap(page, '.mobile-tab[data-sheet="feed"]', 'モバイル: フィードシート');
    await search(page, 'モバイル');
    await tap(page, '#media-hint', 'モバイル: メディアへ移動');
    await tap(page, '.mode-btn[data-mode="1"]', 'モバイル: カメラ 1 画面');
    await tap(page, '.mode-btn[data-mode="4"]', 'モバイル: カメラ 4 画面へ戻す');
    await tap(page, '#news-tabs button', 'モバイル: ニュースのタブ[0]', { settle: 2000 });
    await tap(page, '#media-cc-toggle', 'モバイル: 字幕トグル');
    await tap(page, '.brief-card:not(.no-loc)', 'モバイル: ブリーフィングカード');
    await tap(page, '.ins-row', 'モバイル: 不安定性ランキング行');
    await tap(page, '.fc-tab', 'モバイル: 予測タブ[0]');
    await tap(page, '.fc-cardbtn:not([disabled])', 'モバイル: 予測カード');
    await tap(page, '#share-btn', 'モバイル: 共有ボタン');

    assert((await page.locator('[data-style]').count()) === 0,
      'モバイル: [data-style] は全て CSSOM に流し込まれ属性が残っていない');
    await assertClean(page, bag, 'モバイル');
    await ctx.close();
  }

  // ── negative control（CSP が本当に enforce されている証拠）──────────
  // ここが緑（違反が増える）にならない限り、上の「違反 0」は「CSP が効いていないだけ」
  // と区別できない。CSP_OVERRIDE で 'unsafe-inline' を足すとこのブロックだけが落ちる。
  {
    const { ctx, page } = await newPage({ width: 1280, height: 900 });
    await page.goto(APP, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#app', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const before = (await cspv(page)).length;
    await page.evaluate(() => {
      const st = document.createElement('style');
      st.textContent = '#nc-probe{color:rgb(1,2,3) !important}';
      document.head.appendChild(st);
      const d = document.createElement('div');
      d.id = 'nc-probe';
      d.textContent = 'negative control';
      document.body.appendChild(d);
      d.setAttribute('style', 'color:rgb(4,5,6)');
    });
    await page.waitForTimeout(400);
    const delta = (await cspv(page)).slice(before);
    const dirs = delta.map((x) => String(x.d));
    assert(delta.length > 0, `negative control: 違反が増える（実測 +${delta.length}）`);
    assert(dirs.some((d) => d.startsWith('style-src-elem')),
      `negative control: <style> 注入で style-src-elem 違反（実測 ${dirs.join(',') || 'なし'}）`);
    assert(dirs.some((d) => d.startsWith('style-src-attr')),
      `negative control: setAttribute('style') で style-src-attr 違反（実測 ${dirs.join(',') || 'なし'}）`);
    const color = await page.evaluate(
      () => getComputedStyle(document.getElementById('nc-probe')).color);
    assert(color !== 'rgb(4, 5, 6)',
      `negative control: setAttribute('style') が適用されない（実測 ${color}）`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error('FATAL:', String((e && e.stack) || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((r) => {
    const t = setTimeout(() => { try { server.kill('SIGKILL'); } catch { /* 既に終了 */ } r(); }, 3000);
    server.once('exit', () => { clearTimeout(t); r(); });
  });
}

if (failures) {
  console.error(`\n=== ${failures} FAIL / ${checks} checks`);
  const log = serverLog.join('');
  if (log) console.error('--- harness log（末尾 2000 字）---\n' + log.slice(-2000));
  process.exit(1);
}
console.log(`\nALL OK (${checks} checks)`);
process.exit(0);
```

- [ ] **Step 8: 通ることを確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && NOULIMIT=1 node tests/e2e-csp.mjs; echo "exit=$?"
```
Expected: PASS。すべての行が `ok  :` で始まり、最終行が `ALL OK (N checks)`・`exit=0`。少なくとも次が緑であること（`warn:` は許容＝モバイル幅の要素重なりでクリックが届かなかった場合など）:
- `PC: CSP 違反 0（実測 0）` / `モバイル: CSP 違反 0（実測 0）`
- `PC: pageerror 0（実測 0）` / `モバイル: pageerror 0（実測 0）`
- `PC: 自オリジンの 4xx/5xx 0（実測 0）`
- `PC: deck.MapboxOverlay が関数…` / `PC: .maplibregl-canvas が存在…` / `PC: globe 投影（実測 globe）`
- `PC: 『交通』ON で deck.TripsLayer が遅延ロードされる…`
- `PC: #brief-fresh が非空…` / `PC: #brief-fresh が is-stale…`（`#ins-fresh`・`#fc-fresh` も同じ 2 行ずつ・計 6 行）
  - raw の AI データが取れないときは代わりに `warn: PC: ブリーフィング（#ai-brief）が非表示＝raw の AI データが取れていない…` が出て 2 行がスキップされる（外部要因で closure を止めない・レビュー F-4）
- `PC: applyDataStyles(document) が index.html の静的 data-style 2 件に適用された（実測 2）`
- `PC: [data-style] は全て CSSOM に流し込まれ属性が残っていない`
- `routing:` 12 行すべて（`PC: 自オリジンの 4xx/5xx 0` の**後**に出ること＝assertClean → checkRouting の順）
- `negative control:` 4 行すべて

赤が出たら **`superpowers:systematic-debugging` を使う**。よくある内訳:
- `style-src-attr` 違反が残る → T6 の `data-style` 置換漏れ（違反サマリの `@/js/ui/xxx.js:NN` が置換漏れ箇所）
- `script-src <- wasm-eval` → `vercel.json` の CSP に `'wasm-unsafe-eval'` が無い
- `frame-src <- https://www.youtube.com/...` → T8 の nocookie 化漏れ（`js/ui/media.js`）
- `font-src` / `style-src-elem <- https://fonts.googleapis.com` → T4 の Google Fonts 撤去漏れ（`index.html`）
- `PC: globe 投影（実測 undefined）` → T4 の `?e2e=1` フック未実装、または `map.on('style.load')` の前に評価している（`bootApp` の待機を伸ばす前に、まず `window.__orbis` の公開条件を確認する）
- `PC: applyDataStyles(document) が …（実測 undefined）` → **Task 6 Step 11-b（e2e 用の適用数公開）が未実装**（`window.__orbis.e2e.appliedStatic` が無い）。`実測 0` や `実測 1` なら index.html の静的 `data-style` が 2 件に足りない（T6 の置換漏れ）

- [ ] **Step 9: RED を実確認（negative control が本当に enforce を検知しているか）**

Run（この 1 行全体で 1 コマンド。落ちるのが正しい）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && CSP_OVERRIDE="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests" NOULIMIT=1 node tests/e2e-csp.mjs; echo "exit=$?"
```
Expected: **FAIL**。`negative control: 違反が増える（実測 +0）`・`negative control: <style> 注入で style-src-elem 違反（実測 なし）`・`negative control: setAttribute('style') で style-src-attr 違反（実測 なし）`・`negative control: setAttribute('style') が適用されない（実測 rgb(4, 5, 6)）` の 4 行が `FAIL:` で出て、末尾が `=== 4 FAIL / N checks`・`exit=1`。

補足（このコマンドで同時に確かめていること）:
- CSP に `upgrade-insecure-requests` が入っていても `http://127.0.0.1:8790` は upgrade されない（UIR はループバックをスキップする）。もし https へ化けるなら Step 8 の `PC: CSP 違反 0` 以前にページが一切開かず即座に落ちる＝観測できる。
- `'unsafe-inline'` を足しても PC/モバイルの本体アサートは緑のまま＝落ちるのは negative control だけ、という切り分けができている。

- [ ] **Step 10: コミット**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add tests/e2e-csp.mjs
```

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git commit -m "$(cat <<'EOF'
test(e2e): 実 CSP 下の受入 e2e（違反 0・能力・ルーティング・negative control）

tests/harness/serve.py を spawn し、PC 1280x900 とモバイル 390x844 で
?data=github&e2e=1 を開いて spec 4-4 の操作を通す。CSP 違反 0・pageerror 0・
自オリジンの console.error 0・自オリジンの 4xx/5xx 0 を測る。

能力アサート: deck.MapboxOverlay が関数・.maplibregl-canvas が存在・
map.getProjection().type === 'globe'・『交通』ON で deck.TripsLayer が遅延ロード。
表示の正直さ: #brief-fresh / #ins-fresh / #fc-fresh が非空かつ is-stale
（raw の AI データが取れないセクションは warn に落として closure を止めない）。
data-style: 属性が全て消費され、--chip / --rowcat が computed で非空、
index.html の静的 2 件は applyDataStyles(document) の戻り値（?e2e=1 で公開）で確認。
ルーティング: /nope 404・/about 200・/about.html と /index.html が 308・
config の収集専用と README.md が 404・vendor が immutable・data/static が SWR・
robots.txt が 200（意図的な 404 を叩くので assertClean の後に回す）。

negative control で <style> 注入と setAttribute('style') が違反を増やすことを
確認する（CSP_OVERRIDE に 'unsafe-inline' を足すとここだけが落ちる＝RED）。
networkidle は使わない（ニュースのライブ配信が流れ続けて idle にならない）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
)"
```

---

- [ ] **Step 11: 失敗を確認（受入一括が無いこと）**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && bash tools/closure.sh; echo "exit=$?"
```
Expected: `bash: tools/closure.sh: No such file or directory` と `exit=127`。

- [ ] **Step 12: 受入一括＋`.gitignore`＋README を書く**

(a) `tools/closure.sh` を新規作成（全文）:

```bash
#!/usr/bin/env bash
# Orbis 受入一括: node:test → pytest → e2e-csp。全部 0 なら .closure-ok に HEAD を書く。
#   使い方: bash tools/closure.sh
#
# 注意:
#  - ulimit -v を掛けた状態で起動しないこと（e2e が起動する Chromium が落ちる）。
#    ~/.claude/hooks/guards.py は Bash の `python`/`uv run` にだけ ulimit を前置するので、
#    `bash tools/closure.sh` として起動する分には掛からない。
#  - 既存の Playwright スイート（npx playwright test・tests/e2e/*.spec.js）は
#    data/snapshots のローカル生成が前提なので含めない（Phase B で fixture 化）。
#  - set -e は使わない。各段階の rc を見て「どの段階で落ちたか」を出すため。
set -u
cd "$(dirname "$0")/.."

fail() {
  echo "== closure FAILED ($1)"
  rm -f .closure-ok
  exit 1
}

echo "== node --test tests/*.test.js"
node --test tests/*.test.js || fail "node --test"

echo "== python3 -m pytest -q"
python3 -m pytest -q || fail "pytest"

echo "== NOULIMIT=1 node tests/e2e-csp.mjs"
NOULIMIT=1 node tests/e2e-csp.mjs || fail "e2e-csp"

# 受入が HEAD で通った印。push ゲート hook（~/.claude/hooks/guards.py の check_closure）が
# この中身と git rev-parse HEAD を照合する（.gitignore 済）。
git rev-parse HEAD > .closure-ok || fail "git rev-parse"
echo "== closure OK"
```

(b) `.gitignore` — 9 行目 `.vercel/` の**直後**に追記（`# データは public な orbis-data repo へ分離` コメントの前）:

```diff
 test-results/
 playwright-report/
 .vercel/
+
+# 受入一括 tools/closure.sh が HEAD で通った印（push ゲートが HEAD と照合する）。
+.closure-ok
```

(c) `README.md` — 既存の「## 開発」節と「## テスト」節を、次の 3 節で置き換える（「## デプロイ（Vercel 静的）」以降はそのまま）。**外側は 4 バッククォート**（中に ```bash フェンスが入れ子になっているため。README に書き込むのは内側の内容だけで、この 4 バッククォートは含めない）:

````markdown
## 開発
- フロント: Vanilla JS (ESM, no build)。`python3 -m http.server 8000` → http://localhost:8000
- **本番と同じヘッダー/ルーティングで見たいとき**は e2e ハーネスを使う（`vercel.json` の `builds`/`routes` を `tests/vercel_routes.py` で評価して配信＝CSP・Cache-Control・308・catch-all 404 まで再現する）:
  ```bash
  python3 tests/harness/serve.py --port 8790
  ```
  → http://127.0.0.1:8790 （`--csp-override "<csp>"` で CSP ヘッダーだけ差し替えられる）
- データ源の切替: `?data=github`＝本番データ（`raw.githubusercontent.com/sg55555/orbis-data`・読み取りのみ）／`?data=local`＝`data/snapshots/`（ローカル収集が必要）。無指定なら localhost は local・それ以外は github。
- e2e 用フック: `?e2e=1` を付けたときだけ `window.__orbis.e2e`（`applyDataStyles(document)` の適用数など）を公開する（受入 e2e が globe 投影や data-style の適用を確認するため。通常の導線では未定義）。
- 収集: `python3 -m collectors.quakes`（USGS → data/snapshots/quakes.json + manifest.json）
- 収集: `python3 -m collectors.flights`（OpenSky → data/snapshots/flights.json）
- 収集: `python3 -m collectors.gdelt_events`（GDELT → data/snapshots/conflict.json + protests.json）

## テスト
- JS 単体: `node --test tests/*.test.js`（または `npm run test:js`）
- Python: `python3 -m pytest -q`
- e2e（実ブラウザ・CSP 違反 0）: `NOULIMIT=1 node tests/e2e-csp.mjs`
  - **行頭の `NOULIMIT=1` は必須**（Bash hook の `ulimit -v` の下では Chromium が起動できない）
  - ハーネス（`tests/harness/serve.py`）とブラウザの起動・終了はスクリプトが面倒を見る。`E2E_PORT`（既定 8790）でポートを変えられる
- 旧 Playwright スイート `npx playwright test`（`tests/e2e/*.spec.js`・20 spec）は `data/snapshots/` のローカル生成が前提。受入には含めない（Phase B で fixture 化予定）

## 受入（push の条件）
```bash
bash tools/closure.sh
```
`node --test` → `pytest` → `e2e-csp` を順に回し、全部通ると `.closure-ok` に `git rev-parse HEAD` を書いて `== closure OK` を出す。どれかが落ちると `== closure FAILED (<段階>)` を出して `.closure-ok` を消し exit 1。push ゲートはこの `.closure-ok` が HEAD と一致することを見る。`ulimit -v` を掛けた状態では起動しないこと（Chromium が落ちる）。

CSP が本当に enforce されているかの確認（negative control の RED・**落ちるのが正しい**）:
```bash
CSP_OVERRIDE="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; manifest-src 'self'; media-src 'self'; upgrade-insecure-requests" NOULIMIT=1 node tests/e2e-csp.mjs
```
`negative control:` の 4 行が FAIL して exit 1 になるのが正しい（緑になったら enforce が効いていない）。
````

- [ ] **Step 13: 通ることを確認**

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && bash tools/closure.sh; echo "exit=$?"
```
Expected: PASS。出力に `== node --test tests/*.test.js` → `== python3 -m pytest -q` → `== NOULIMIT=1 node tests/e2e-csp.mjs` → `ALL OK (N checks)` → `== closure OK` が順に出て `exit=0`。

Run（`.closure-ok` の中身が HEAD と一致すること）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && diff <(cat .closure-ok) <(git rev-parse HEAD) && echo "closure-ok == HEAD"
```
Expected: `closure-ok == HEAD`（差分なし）。

Run（`.closure-ok` が追跡されていないこと）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git status --porcelain --untracked-files=all -- .closure-ok
```
Expected: 何も出力されない（`.gitignore` で無視されている）。

- [ ] **Step 14: FAILED 経路を確認（`.closure-ok` が本当に消えるか）**

Run（1 段目をわざと落とすプローブを置く）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && printf "import test from 'node:test';\ntest('closure probe: 必ず落ちる', () => { throw new Error('closure probe'); });\n" > tests/zz_closure_probe.test.js
```

Run:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && bash tools/closure.sh; echo "exit=$?"
```
Expected: 出力末尾が `== closure FAILED (node --test)`・`exit=1`。pytest と e2e は**走らない**（段階で止まる）。

Run（`.closure-ok` が消えていること）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && test ! -e .closure-ok && echo ".closure-ok は削除された"
```
Expected: `.closure-ok は削除された`。

Run（プローブを片付ける）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && rm -f tests/zz_closure_probe.test.js
```
`rm -f tests/zz_closure_probe.test.js` を実行します。理由：Step 14 で意図的に置いた「必ず落ちるテスト」を取り除き、受入を緑に戻すため。このファイルは直前の Step で自分が `printf` で生成した未追跡ファイルであり、`git` にも入っていないので消しても復元不能なものは失われません。

Run（緑に戻ったことと `.closure-ok` の再作成）:
```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && bash tools/closure.sh; echo "exit=$?"
```
Expected: `== closure OK`・`exit=0`。

- [ ] **Step 15: コミット**

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git add tools/closure.sh .gitignore README.md
```

```bash
cd /home/shugo/apps/orbis/.claude/worktrees/enterprise-a && git commit -m "$(cat <<'EOF'
chore(ci): 受入一括 tools/closure.sh と README の開発/テスト/受入 節

node --test → pytest → e2e-csp を順に回し、全部通ったら .closure-ok に HEAD を
書いて "== closure OK" を出す。どれかが落ちたら "== closure FAILED (<段階>)" を
出し .closure-ok を消して exit 1。push ゲート hook はこの .closure-ok が HEAD と
一致することを見る（tools/closure.sh の存在でゲートが有効になる）。

README に開発用ハーネスの起動方法（python3 tests/harness/serve.py --port 8790）、
?data=github / ?e2e=1 の意味、e2e の行頭 NOULIMIT=1 が必須である理由、
negative control の RED 手順を追記。.gitignore に .closure-ok。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
)"
```

---

## Self-Review（part4・2026-09-03）

- 骨格 Interfaces との突合
  - `tests/harness/serve.py`：CLI（`--port` / `--csp-override`）・worktree ルート配信・`evaluate()` の結果をそのまま返す・MIME 7 種すべて骨格どおり・`--csp-override` は CSP だけ差し替え・`if __name__ == '__main__'` あり。**追加分**は `--root`（既定＝リポジトリルート）と `make_server()`（pytest が別スレッドで回すための工場関数）と骨格が挙げていない拡張子 5 種（`.txt` `.svg` `.png` `.ico` `.webp`＝builds に載る robots.txt・favicon・icons のため）、および `tests/harness/smoke.sh`（CLI 契約の目視用・受入には含めない）。骨格の契約は狭めていない。
  - `tools/closure.sh`：3 段階の順序・`== closure OK`／`== closure FAILED (<段階>)`・`.closure-ok` の作成と削除・exit 1 まで骨格どおり。`set -u`（`-e` は使わない＝段階名を出すため）。
  - `tests/e2e-csp.mjs`：`?data=github` は spec §4-4 のとおり、`?e2e=1` は骨格の `window.__orbis` フックのとおり、Chromium 引数と `serviceWorkers: 'block'` と `NOULIMIT=1` も指定どおり。
- spec §4-4 の項目対応：違反 0／pageerror 0（PC＋モバイル・列挙された全操作）→ Step 8 の `assertClean`・`tap` 群／能力アサート 4 種 → PC ブロック／表示の正直さ → `#brief-fresh`・`#ins-fresh`・`#fc-fresh` の「非空かつ `is-stale`」（spec §3.3 の要求どおり id 指定・総数は `info:` で記録）／data-style の正の確認 → `[data-style]` 0 個＋`--chip`・`--rowcat`＋`window.__orbis.e2e.appliedStatic === 2`／ルーティング 9 種 → `checkRouting`（`/about.html` を足して 10 種）／negative control → 専用ブロック＋Step 9 の `CSP_OVERRIDE` 実確認。
- spec §4-4 から意図的に変えた 3 点（レビュー 2026-09-03 反映）:
  1. `#alerts` の computed display は `js/ui/alerts.js:78` が件数で上書きするため「none 固定」ではなく「件数と表示の整合」で見る。
  2. **`#cams-one-tabs` の computed display は data-style の証拠にしない**（`js/ui/cams-pane.js:103` が `mode !== 1` で自分で `display:none` を書く＝`applyDataStyles` が動かなくても緑になるトートロジー・レビュー F-2）。index.html の静的 2 件の証拠は `window.__orbis.e2e.appliedStatic === 2`（**Task 6 Step 11-b が公開**）、テンプレート側の証拠は `[data-style]` 0 個で取る。`#cams-one-tabs` のアサートは「cams-pane の描画結果」として残した。
  3. `.fresh-chip.is-stale` の判定は raw の AI 3 層が取れることに依存するので、セクションが `display:none`（＝取得失敗）なら `warn` に落として `closure.sh` を外部要因で止めない（レビュー F-4・Phase B の fixture 化までの暫定）。
- 実行順（レビュー F-3）：能力アサート → 操作 → 表示/データスタイルのアサート → `assertClean` → `checkRouting`。意図的に 404 を叩く `checkRouting` を `assertClean` の後に置くことで、`page.request` が `page.on('response')` を発火する実装/版でも「自オリジンの 4xx/5xx 0」が誤検知しない。
- 目視確認（レビュー E-2）：非対話 bash は job control が無効で `kill %1` が使えないため、`tests/harness/smoke.sh`（`$!` で PID を掴み `trap` で必ず落とす）に切り出した。
- spec §3.5 の保留事項の解決：deck の `getTooltip`（`js/main.js:344-358`）は文字列しか返さないので `.deck-tooltip` への `MutationObserver` は不要（T6 側の実装も不要）。
- 依存の前提が崩れたときに何が落ちるか：`vendor/deck.gl-core-9.3.4.min.js` が無ければ Step 4 の pytest が赤・`?e2e=1` フックが無ければ Step 8 の `globe 投影（実測 window.__orbis.map が無い…）` が赤・`data-style` 置換漏れは違反サマリの `@/js/ui/xxx.js:NN` に出る。どれも「黙って通る」経路が無い。
- 未定義参照なし：本分冊のコードが呼ぶ外部シンボルは `load_config` / `expand_builds` / `evaluate` / `RouteResult`（T3）・`chromium`（Playwright）・Node/Python の標準 API のみ。
