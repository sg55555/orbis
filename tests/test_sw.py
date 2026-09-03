"""Service Worker の版・SHELL・取得方針（設計 §3.5・骨格 Interfaces）。

型＝~/apps/task-dashboard/tests/test_sw.py。Orbis 固有の差分は
  ・SHELL から '/index.html' を外す（vercel.json routes が 308 → '/'。addAll は redirect で失敗する）
  ・配信 allowlist は builds なので tests/vercel_routes.py の expand_builds と突合する
  ・死んだ cartocdn バイパスを消す
"""
import os
import pathlib
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vercel_routes import expand_builds, load_config  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]
SW = (ROOT / "sw.js").read_text(encoding="utf-8")


def _shell():
    m = re.search(r"const SHELL = \[(.*?)\];", SW, re.S)
    assert m, "sw.js: const SHELL = [...] が見つからない"
    return re.findall(r"'([^']+)'", m.group(1))


def _fetch_handler():
    m = re.search(r"self\.addEventListener\('fetch'.*?\n\}\);", SW, re.S)
    assert m, "sw.js: fetch ハンドラが見つからない"
    return m.group(0)


def test_cache_version_is_v52():
    assert re.search(r"const CACHE = 'orbis-v52';", SW), "sw.js を触ったら CACHE を +1 する"


def test_shell_is_the_four_expected_paths():
    assert _shell() == ["/", "/css/orbis.css", "/js/main.js", "/js/lib/presets.js"]


def test_shell_does_not_contain_index_html():
    # '/index.html' は routes で 308 → '/'。addAll は redirect 応答で失敗し install ごと落ちる。
    assert "/index.html" not in _shell()


def test_shell_paths_are_all_served():
    """存在しない資産を addAll すると SW ごと install に失敗する（builds allowlist と突合）。"""
    served = expand_builds(load_config(ROOT), ROOT)
    for p in _shell():
        target = "/index.html" if p == "/" else p
        assert target in served, f"{p} が builds の配信 allowlist に無い"


def test_cross_origin_requests_bypass_the_service_worker():
    """別オリジンを中継すると SW 応答に載る CSP（connect-src 'self' …）で判定されてしまう。

    素通しならブラウザがページ側の img-src/connect-src で判定する。
    """
    body = _fetch_handler()
    assert "url.origin !== self.location.origin" in body, \
        "sw.js: 別オリジンを素通しにする early return が無い"
    assert body.index("url.origin !== self.location.origin") < body.index("e.respondWith("), \
        "sw.js: 素通しの判定は最初の e.respondWith( より前に置く"


def test_only_successful_basic_responses_are_cached():
    """404/500 や opaque 応答を put すると壊れた応答がキャッシュに固定化する。"""
    assert "res.ok && res.type === 'basic'" in _fetch_handler()


def test_dead_cartocdn_bypass_is_gone():
    assert "cartocdn" not in SW, "cartocdn は既に参照していない（死んだ条件）"


def test_snapshots_are_always_network():
    assert "/data/snapshots/" in _fetch_handler()
