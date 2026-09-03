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
