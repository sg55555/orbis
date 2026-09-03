"""vercel.json のセキュリティヘッダーと builds allowlist の契約（設計 §3.1）。

legacy builds+routes では top-level の headers / cleanUrls / redirects / rewrites が
routes と排他になる。よって routes 先頭の continue:true エントリで全パスにヘッダーを付け、
clean URL は routes の 308 + dest で再現する（cleanUrls キーは書かない）。

本ファイルは「値そのもの」の契約（verbatim）を持つ。ルーティングの挙動は
tests/test_vercel_routing_sim.py が評価器で見る（役割分担）。
"""
import json
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

CSP = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
    "form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; "
    "img-src 'self' data: blob: https:; font-src 'self'; "
    "connect-src 'self' https://raw.githubusercontent.com https://tiles.openfreemap.org wss://localhost:8900; "
    "frame-src https://www.youtube-nocookie.com; worker-src 'self' blob:; child-src 'self' blob:; "
    "manifest-src 'self'; media-src 'self'; upgrade-insecure-requests"
)
PERMISSIONS = (
    "accelerometer=(), browsing-topics=(), camera=(), geolocation=(), gyroscope=(), "
    "magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), "
    "screen-wake-lock=(), usb=(), xr-spatial-tracking=(), display-capture=(self)"
)
EXPECTED_HEADER_KEYS = {
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
}
EXPECTED_DIRECTIVES = {
    "default-src": {"'self'"},
    "base-uri": {"'self'"},
    "object-src": {"'none'"},
    "frame-ancestors": {"'none'"},
    "form-action": {"'self'"},
    "script-src": {"'self'", "'wasm-unsafe-eval'"},
    "style-src": {"'self'"},
    "img-src": {"'self'", "data:", "blob:", "https:"},
    "font-src": {"'self'"},
    "connect-src": {"'self'", "https://raw.githubusercontent.com",
                    "https://tiles.openfreemap.org", "wss://localhost:8900"},
    "frame-src": {"https://www.youtube-nocookie.com"},
    "worker-src": {"'self'", "blob:"},
    "child-src": {"'self'", "blob:"},
    "manifest-src": {"'self'"},
    "media-src": {"'self'"},
    "upgrade-insecure-requests": set(),
}
EXPECTED_BUILDS = {
    "index.html", "404.html", "about.html", "terms.html", "privacy.html", "attribution.html",
    "sw.js", "manifest.webmanifest", "robots.txt", "LICENSE", "favicon.svg", "favicon-32.png",
    "icons/**", "js/**", "css/**", "vendor/**", "data/static/**",
    "config/live_channels.json", "config/live_cameras.json",
}
CACHE_TIERS = [
    ("/vendor/(.*)", "public, max-age=31536000, immutable"),
    (r"/(icons/.*|favicon\.svg|favicon-32\.png)", "public, max-age=86400"),
    ("/data/static/(.*)", "public, max-age=3600, stale-while-revalidate=86400"),
    (r"/(|index\.html|about|terms|privacy|attribution|sw\.js|manifest\.webmanifest|robots\.txt|LICENSE|js/.*|css/.*|config/.*)",
     "public, max-age=0, must-revalidate"),
]
# .vercelignore は builds allowlist の二重化（CLI から手動デプロイした事故で丸ごと上がる経路を塞ぐ）。
# 消えても本番が壊れないので誰も気づかない＝ここで集合として固定する。
VERCELIGNORE_REQUIRED = {
    "collectors/", "scripts/", "tests/", ".github/", "requirements.txt",
    "playwright.config.js", "package.json", "docs/", "node_modules/", ".superpowers/",
    ".claude/", ".claire/", ".venv/", ".pytest_cache/", "data/snapshots/", "tools/",
    "*.md", ".closure-ok",
}


@pytest.fixture(scope="module")
def cfg():
    return json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))


def _header_route(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    return routes[0]


def _directives(csp):
    out = {}
    for part in csp.split(";"):
        toks = part.split()
        if toks:
            out[toks[0]] = set(toks[1:])
    return out


# ── ヘッダー route の形と値 ────────────────────────────────────
def test_header_route_is_first_and_continues(cfg):
    r = _header_route(cfg)
    assert r["src"] == "/(.*)"
    assert r.get("continue") is True
    assert "headers" in r and "dest" not in r and "status" not in r


def test_header_set_is_exactly_six(cfg):
    got = set(_header_route(cfg)["headers"])
    assert got == EXPECTED_HEADER_KEYS, f"ヘッダーの集合が違う: 余分={got - EXPECTED_HEADER_KEYS} 不足={EXPECTED_HEADER_KEYS - got}"


def test_required_headers_are_verbatim(cfg):
    h = _header_route(cfg)["headers"]
    assert h["Content-Security-Policy"] == CSP
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert h["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert h["Cross-Origin-Opener-Policy"] == "same-origin"
    assert h["Permissions-Policy"] == PERMISSIONS


def test_headers_we_deliberately_do_not_send(cfg):
    # 公開サイトなので noindex は付けない。CORP は脅威モデル外。HSTS は Vercel が付ける。
    h = _header_route(cfg)["headers"]
    for k in ("X-Robots-Tag", "Cross-Origin-Resource-Policy", "Strict-Transport-Security",
              "Cross-Origin-Embedder-Policy", "Access-Control-Allow-Origin"):
        assert k not in h, f"{k} は出荷しない方針（設計 §3.1）"


# ── CSP ─────────────────────────────────────────────────
def test_csp_directive_names_match_exactly(cfg):
    got = set(_directives(_header_route(cfg)["headers"]["Content-Security-Policy"]))
    want = set(EXPECTED_DIRECTIVES)
    assert got == want, f"CSP のディレクティブ集合が違う: 余分={got - want} 不足={want - got}"


@pytest.mark.parametrize("name,tokens", sorted(EXPECTED_DIRECTIVES.items()))
def test_csp_directive_values(cfg, name, tokens):
    d = _directives(_header_route(cfg)["headers"]["Content-Security-Policy"])
    assert d[name] == tokens, f"{name} の値が違う: {d[name]}"


def test_csp_has_no_unsafe_escape_hatches(cfg):
    csp = _header_route(cfg)["headers"]["Content-Security-Policy"]
    for tok in ("'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "*"):
        assert tok not in csp, f"CSP に {tok} が入っている"


# ── Permissions-Policy（書かないものを固定する） ────────────────────
@pytest.mark.parametrize("feature", ["fullscreen", "autoplay", "picture-in-picture", "encrypted-media"])
def test_permissions_policy_omits_iframe_delegated_features(cfg, feature):
    # これらを書くと既定が上書きされ、YouTube 埋め込みの allow / allowfullscreen 委譲が
    # 黙って劣化する（全画面が効かない・自動再生が止まる）。既定のまま触らない。
    pp = _header_route(cfg)["headers"]["Permissions-Policy"]
    assert feature not in pp, f"Permissions-Policy に {feature} を書いてはいけない"


def test_permissions_policy_allows_display_capture_for_self(cfg):
    # AI 字幕の getDisplayMedia（タブ音声のキャプチャ）に必要。
    assert "display-capture=(self)" in _header_route(cfg)["headers"]["Permissions-Policy"]


# ── builds allowlist ────────────────────────────────────
def test_builds_expected_set(cfg):
    got = {b["src"] for b in cfg.get("builds", [])}
    assert got == EXPECTED_BUILDS, f"builds の集合が違う: 余分={got - EXPECTED_BUILDS} 不足={EXPECTED_BUILDS - got}"


def test_all_builds_are_static(cfg):
    uses = {b["use"] for b in cfg.get("builds", [])}
    assert uses == {"@vercel/static"}, f"静的以外の builder がある: {uses}"


@pytest.mark.parametrize("name", [
    "config/briefing_sources.json", "config/instability.json", "config/forecast.json",
    "config/fips_countries.json", "config/news_feeds.json",
    "README.md", "vercel.json", "requirements.txt", "package.json", "playwright.config.js",
])
def test_collector_only_and_repo_files_are_not_built(cfg, name):
    built = {b["src"] for b in cfg.get("builds", [])}
    assert name not in built, f"{name} が builds に載っている（公開面に出る）"


# ── routes の構造 ───────────────────────────────────────
def test_top_level_exclusive_keys_absent(cfg):
    for k in ("headers", "redirects", "rewrites", "cleanUrls", "trailingSlash", "functions"):
        assert k not in cfg, f"top-level {k} は builds/routes と排他（cleanUrls は routes で再現する）"


@pytest.mark.parametrize("src,value", CACHE_TIERS)
def test_cache_control_routes_are_continue_only(cfg, src, value):
    hits = [r for r in cfg.get("routes", []) if r.get("src") == src]
    assert len(hits) == 1, f"Cache-Control route {src} が 1 件でない: {len(hits)}"
    r = hits[0]
    assert r.get("continue") is True, f"{src} が continue でない（ここで確定してしまう）"
    assert r["headers"] == {"Cache-Control": value}, f"{src} の値が違う: {r['headers']}"
    assert "dest" not in r and "status" not in r


def test_catch_all_is_last_and_is_404(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    assert routes[-1] == {"src": "/(.*)", "status": 404, "dest": "/404.html",
                          "headers": {"Cache-Control": "no-store"}}, \
        f"末尾が catch-all 404 でない: {routes[-1]}"


@pytest.mark.parametrize("src", [r"/404\.html", "/(.*)"])
def test_terminal_404_routes_are_no_store(cfg, src):
    # tier route（continue:true）は 404 にも Cache-Control を積む。終端で no-store に
    # 上書きしないと /vendor/<消えたファイル> の 404 が 1 年 immutable で焼き付く。
    hits = [r for r in cfg.get("routes", []) if r.get("src") == src and r.get("status") == 404]
    assert len(hits) == 1, f"404 route {src} が 1 件でない: {len(hits)}"
    assert hits[0].get("headers") == {"Cache-Control": "no-store"}, \
        f"{src} の 404 が no-store でない: {hits[0].get('headers')}"


def test_filesystem_handle_is_second_to_last(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    assert routes[-2] == {"handle": "filesystem"}, \
        f"filesystem 境界が catch-all の直前に無い: {routes[-2]}"


def test_direct_404_route_precedes_filesystem(cfg):
    routes = cfg.get("routes", [])
    srcs = [r.get("src") for r in routes]
    assert r"/404\.html" in srcs, "/404.html を 404 で返す route が無い（ソフト 404 になる）"
    assert srcs.index(r"/404\.html") < len(routes) - 2, "/404.html の route が filesystem より後ろにある"


def test_version_and_framework(cfg):
    assert cfg["version"] == 2
    assert cfg["framework"] is None


# ── .vercelignore（builds allowlist の二重化） ──────────────────
def test_vercelignore_covers_required_paths():
    lines = {ln.strip() for ln in (ROOT / ".vercelignore").read_text(encoding="utf-8").splitlines()
             if ln.strip() and not ln.strip().startswith("#")}
    missing = sorted(VERCELIGNORE_REQUIRED - lines)
    assert missing == [], f".vercelignore から消えている行: {missing}"


def test_license_is_served_but_readme_is_not(cfg):
    # spec §5 の DoD は「LICENSE が本番で見える」。LICENSE は builds に載せ、README.md は載せない
    # （*.md は .vercelignore でも落ちる）。LICENSE に拡張子は無いので *.md には当たらない。
    built = {b["src"] for b in cfg.get("builds", [])}
    assert "LICENSE" in built, "LICENSE が builds に無い（本番 /LICENSE が catch-all 404 になる）"
    assert "README.md" not in built
