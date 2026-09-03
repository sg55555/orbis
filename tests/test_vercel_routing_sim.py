"""vercel.json の builds+routes を実際に評価して配信の形を固定する（設計 §3.1）。

前半＝評価器（tests/vercel_routes.py）そのものの単体テスト（合成 config）。
後半＝実 vercel.json に対する検証（本番で返るはずの status / dest / ヘッダー）。

評価器を tests/vercel_routes.py に切り出してあるのは、Task 10 の e2e ハーネス
（tests/harness/serve.py）が **同じ 1 つの評価器**で配信するため。テストは自前実装で
緑・ハーネスは別実装で配信、という嘘を作らない。

仕様の根拠＝Vercel Build Output API の routes（vercel.json の routes と同一仕様）:
  https://vercel.com/docs/build-output-api/configuration#routes
  > continue: "A boolean to change matching behavior. If true, routing will continue
  >            even when the src is matched."
この一文により、先頭のヘッダー route（src="/(.*)", continue:true）は **最終的な dest の
種類に関係なく全リクエストにマッチし、headers を積んだまま後続の評価へ進む**。
つまり 404 応答にもセキュリティヘッダーが乗る（下の test_unknown_path... がそれを固定する）。
"""
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from vercel_routes import RouteResult, evaluate, expand_builds, load_config  # noqa: E402

SECURITY_HEADERS = [
    "Content-Security-Policy",
    "X-Content-Type-Options",
    "X-Frame-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Cross-Origin-Opener-Policy",
]
IMMUTABLE = "public, max-age=31536000, immutable"
ICON_CACHE = "public, max-age=86400"
DATA_CACHE = "public, max-age=3600, stale-while-revalidate=86400"
DOC_CACHE = "public, max-age=0, must-revalidate"

# ── 合成 config（評価器そのものの単体テスト用） ────────────────────
SYNTH = {
    "builds": [{"src": "index.html", "use": "@vercel/static"}],
    "routes": [
        {"src": "/(.*)", "continue": True, "headers": {"X-A": "1"}},
        {"src": "/dup/(.*)", "continue": True, "headers": {"X-A": "2", "X-B": "b"}},
        {"src": "/old/(.*)", "status": 308, "headers": {"Location": "/new/$1"}},
        {"src": "/page", "dest": "/page.html"},
        {"src": "/wild/(.*)", "dest": "/deep/$1.html"},
        {"src": "/ghost", "dest": "/ghost.html"},
        {"handle": "filesystem"},
        {"src": "/(.*)", "status": 404, "dest": "/404.html"},
    ],
}
SYNTH_SERVED = {"/index.html", "/page.html", "/404.html", "/real.txt", "/deep/x.html"}

FS_ONLY = {"routes": [{"handle": "filesystem"}, {"src": "/(.*)", "status": 404, "dest": "/404.html"}]}
NO_TERMINAL = {"routes": [{"src": "/(.*)", "continue": True, "headers": {"X-A": "1"}}]}


def test_evaluator_uses_fullmatch_not_prefix():
    # re.match だと "/pagex" が "/page" にマッチして /page.html を返してしまう。
    res = evaluate(SYNTH, "/pagex", SYNTH_SERVED)
    assert res.status == 404 and res.dest == "/404.html", f"部分一致している: {res}"


def test_continue_routes_accumulate_headers_and_later_wins():
    res = evaluate(SYNTH, "/dup/x", SYNTH_SERVED)
    assert res.headers["X-A"] == "2", "後の continue route が同名ヘッダーを上書きしていない"
    assert res.headers["X-B"] == "b", "後の continue route のヘッダーが積まれていない"


def test_status_route_expands_dollar_one_in_location():
    res = evaluate(SYNTH, "/old/a/b", SYNTH_SERVED)
    assert res.status == 308
    assert res.headers["Location"] == "/new/a/b", f"$1 が展開されていない: {res.headers}"


def test_dest_route_expands_dollar_one():
    res = evaluate(SYNTH, "/wild/x", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/deep/x.html"


def test_dest_not_in_served_becomes_404():
    # route はあるがビルド出力に無い＝本番では 404。routes だけ見て 200 と信じない。
    res = evaluate(SYNTH, "/ghost", SYNTH_SERVED)
    assert res.status == 404 and res.dest is None


def test_filesystem_handle_serves_existing_file():
    res = evaluate(SYNTH, "/real.txt", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/real.txt"


def test_filesystem_handle_maps_root_to_index_html():
    res = evaluate(FS_ONLY, "/", SYNTH_SERVED)
    assert res.status == 200 and res.dest == "/index.html"


def test_no_terminal_match_falls_through_to_404():
    res = evaluate(NO_TERMINAL, "/anything", SYNTH_SERVED)
    assert res.status == 404 and res.dest is None
    assert res.headers["X-A"] == "1", "確定しなかった場合も積んだヘッダーは残る"


def test_matched_records_evaluated_route_indexes():
    res = evaluate(SYNTH, "/dup/x", SYNTH_SERVED)
    assert res.matched == [0, 1, 6, 7], f"評価した route の index が想定と違う: {res.matched}"


def test_headers_survive_a_404():
    res = evaluate(SYNTH, "/nope", SYNTH_SERVED)
    assert res.status == 404
    assert res.headers["X-A"] == "1", "404 応答にヘッダー route が効いていない"


def test_expand_builds_returns_files_not_directories():
    served = expand_builds({"builds": [{"src": "js/**", "use": "@vercel/static"}]}, ROOT)
    assert "/js/main.js" in served
    assert "/js/lib/state.js" in served, "** が再帰していない"
    assert "/js" not in served and "/js/lib" not in served, "ディレクトリが混ざっている"


def test_expand_builds_accepts_plain_filenames():
    served = expand_builds({"builds": [{"src": "index.html", "use": "@vercel/static"}]}, ROOT)
    assert served == {"/index.html"}


def test_expand_builds_tolerates_missing_glob():
    # vendor/** は Task 4 で作る。まだ無い資産で routing のテストを落とさない。
    served = expand_builds({"builds": [{"src": "no-such-dir/**", "use": "@vercel/static"}]}, ROOT)
    assert served == set()


# ── ここから実 vercel.json ──────────────────────────────────
@pytest.fixture(scope="module")
def cfg():
    return load_config(ROOT)


@pytest.fixture(scope="module")
def served(cfg):
    # vendor/** は Task 4 で作られる。ルーティングの意味論は「配信物であること」だけに
    # 依存するので、代表 1 ファイルを合成で足して Cache-Control 段まで確定挙動を見る。
    return expand_builds(cfg, ROOT) | {"/vendor/deck.gl-core-9.3.4.min.js"}


def test_header_route_is_first_and_continue_only(cfg):
    routes = cfg.get("routes", [])
    assert routes, "vercel.json に routes が無い"
    r = routes[0]
    assert r["src"] == "/(.*)", "先頭がヘッダー route でない"
    assert r.get("continue") is True, "先頭 route が continue でない（全パスに乗らない）"
    assert "dest" not in r and "status" not in r, "ヘッダー route が dest/status を持っている"
    for h in SECURITY_HEADERS:
        assert h in r["headers"], f"ヘッダー route に {h} が無い"


def test_root_serves_index_html_with_security_headers(cfg, served):
    res = evaluate(cfg, "/", served)
    assert res.status == 200 and res.dest == "/index.html"
    for h in SECURITY_HEADERS:
        assert h in res.headers, f"/ の応答に {h} が乗らない"
    assert res.headers["Content-Security-Policy"].startswith("default-src 'self'")
    assert res.headers["Cache-Control"] == DOC_CACHE


def test_unknown_path_is_404_with_the_404_page(cfg, served):
    res = evaluate(cfg, "/this-path-does-not-exist", served)
    assert res.status == 404 and res.dest == "/404.html", "catch-all が 404.html を返していない"
    for h in SECURITY_HEADERS:
        assert h in res.headers, f"404 応答に {h} が乗らない"


@pytest.mark.parametrize("name", ["about", "terms", "privacy", "attribution"])
def test_clean_url_serves_page(cfg, served, name):
    res = evaluate(cfg, f"/{name}", served)
    assert res.status == 200 and res.dest == f"/{name}.html", f"/{name} が解決しない: {res}"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("name", ["about", "terms", "privacy", "attribution"])
def test_html_suffix_redirects_to_clean_url(cfg, served, name):
    res = evaluate(cfg, f"/{name}.html", served)
    assert res.status == 308, f"/{name}.html が 308 でない: {res}"
    assert res.headers["Location"] == f"/{name}", f"Location が違う: {res.headers.get('Location')}"


def test_index_html_redirects_to_root(cfg, served):
    res = evaluate(cfg, "/index.html", served)
    assert res.status == 308 and res.headers["Location"] == "/"


def test_direct_404_html_returns_404_status(cfg, served):
    # 直アクセスでも 200 で「404 ページ」を配らない（ソフト 404 を作らない）。
    res = evaluate(cfg, "/404.html", served)
    assert res.status == 404 and res.dest == "/404.html"


@pytest.mark.parametrize("path", [
    "/vendor/deck.gl-core-9.9.9.min.js",   # tier 1（1 年 immutable）を通って 404 に落ちる
    "/data/static/nope.json",              # tier 3（3600 + SWR）
    "/icons/nope.png",                     # tier 2（86400）
    "/nope",                               # どの tier にも当たらない catch-all
    "/404.html",                           # 直アクセスの明示 404 route
])
def test_404_responses_are_never_cached(cfg, served, path):
    """404 に Cache-Control の tier が乗り残ると「1 年 immutable な 404」を配ってしまう。

    tier route は continue:true でヘッダーを積むだけなので、資産が消えた/名前を間違えた
    パスでも /vendor/(.*) に当たれば max-age=31536000, immutable が付く。終端の 404 route
    （明示 /404.html と catch-all）で no-store に上書きし、全 404 を再取得可能にする。
    """
    res = evaluate(cfg, path, served)
    assert res.status == 404, f"{path} が 404 で返らない: {res}"
    assert res.headers.get("Cache-Control") == "no-store", \
        f"{path} の 404 に tier の Cache-Control が残っている: {res.headers.get('Cache-Control')}"


@pytest.mark.parametrize("name", [
    "briefing_sources.json", "instability.json", "forecast.json",
    "fips_countries.json", "news_feeds.json",
])
def test_collector_only_config_is_not_served(cfg, served, name):
    # ブラウザが読むのは live_channels / live_cameras の 2 つだけ（main.js:593-594）。
    # 残りは収集専用＝公開面から外す。
    res = evaluate(cfg, f"/config/{name}", served)
    assert res.status == 404, f"/config/{name} が配信されている: {res}"


@pytest.mark.parametrize("name", ["live_channels.json", "live_cameras.json"])
def test_browser_config_is_served(cfg, served, name):
    res = evaluate(cfg, f"/config/{name}", served)
    assert res.status == 200 and res.dest == f"/config/{name}"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("path", [
    "/README.md", "/vercel.json", "/requirements.txt", "/package.json", "/playwright.config.js",
])
def test_repo_files_are_not_served(cfg, served, path):
    res = evaluate(cfg, path, served)
    assert res.status == 404 and res.dest == "/404.html", f"{path} が配信されている: {res}"


def test_robots_txt_is_served(cfg, served):
    res = evaluate(cfg, "/robots.txt", served)
    assert res.status == 200 and res.dest == "/robots.txt"
    assert res.headers["Cache-Control"] == DOC_CACHE


def test_license_is_served(cfg, served):
    # spec §5 の DoD が「LICENSE が本番で見える」と書いている。拡張子が無いので
    # builds に明示しないと catch-all 404 に落ちる（README.md と違って落としたくない）。
    res = evaluate(cfg, "/LICENSE", served)
    assert res.status == 200 and res.dest == "/LICENSE", f"/LICENSE が配信されない: {res}"
    assert res.headers["Cache-Control"] == DOC_CACHE


@pytest.mark.parametrize("path,expected", [
    ("/vendor/deck.gl-core-9.3.4.min.js", IMMUTABLE),
    ("/icons/icon-192.png", ICON_CACHE),
    ("/icons/apple-touch-icon.png", ICON_CACHE),
    ("/favicon.svg", ICON_CACHE),
    ("/favicon-32.png", ICON_CACHE),
    ("/data/static/admin1_bbox.json", DATA_CACHE),
    ("/data/static/admin1/JA.geojson.gz", DATA_CACHE),
    ("/", DOC_CACHE),
    ("/about", DOC_CACHE),
    ("/js/main.js", DOC_CACHE),
    ("/css/orbis.css", DOC_CACHE),
    ("/sw.js", DOC_CACHE),
    ("/manifest.webmanifest", DOC_CACHE),
    ("/robots.txt", DOC_CACHE),
    ("/LICENSE", DOC_CACHE),
])
def test_cache_control_tier(cfg, served, path, expected):
    res = evaluate(cfg, path, served)
    assert res.status == 200, f"{path} が 200 で返らない: {res}"
    assert res.headers.get("Cache-Control") == expected, \
        f"{path} の Cache-Control が想定と違う: {res.headers.get('Cache-Control')}"


@pytest.mark.parametrize("path", [
    "/js/main.js", "/js/lib/presets.js", "/css/orbis.css", "/css/pages.css",
    "/sw.js", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-512.png",
    "/data/static/drilldown_manifest.json",
])
def test_static_assets_resolve_before_catchall(cfg, served, path):
    # 「builds に載っている」だけでは 200 の証拠にならない（route を catch-all の後ろに
    # 書けば 404 になる）。評価器で実際に 200 まで解決することを固定する。
    res = evaluate(cfg, path, served)
    assert res.status == 200 and res.dest == path, f"{path} が catch-all に食われている: {res}"
    assert (ROOT / path.lstrip("/")).exists(), "route はあるがディスクに実ファイルが無い"


def test_every_build_glob_resolves_at_least_one_file(cfg):
    # builds に書いたが実体が無い src を放置しない（vendor/** は Task 4 まで例外）。
    missing = []
    for b in cfg.get("builds", []):
        if b["src"] == "vendor/**":
            continue
        if not expand_builds({"builds": [b]}, ROOT):
            missing.append(b["src"])
    assert missing == [], f"builds の src がディスクに何も持たない: {missing}"


def test_route_result_shape():
    res = evaluate(SYNTH, "/", SYNTH_SERVED)
    assert isinstance(res, RouteResult)
    assert isinstance(res.status, int) and isinstance(res.headers, dict) and isinstance(res.matched, list)
