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
