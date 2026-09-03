"""vendor/ の固定バイト検証（設計 §3.2 / A2）。外部 CDN 依存ゼロを静的に守る。

取得は scripts/fetch_vendor.py だけが行う。ここは「取得結果が固定値と一致するか」
「自前ソースが CDN を参照していないか」を pytest から見張る。
型＝~/apps/task-dashboard/tests/{vendor.sha256,test_static_guards.py::test_vendor_sha256_pinned}。
"""
import hashlib
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
PIN = ROOT / "tests" / "vendor.sha256"

# README は人が書く説明＝取得物ではないので固定しない（更新のたびに赤くしない）。
PIN_EXCLUDE = {"vendor/README.md"}

# 骨格 Global Constraints の固定ファイル名（回帰ガード＝増減したらここも直す）。
EXPECTED = [
    "vendor/LICENSE-deck.gl.txt",
    "vendor/LICENSE-maplibre-gl.txt",
    "vendor/deck.gl-core-9.3.4.min.js",
    "vendor/deck.gl-geo-layers-9.3.4.min.js",
    "vendor/deck.gl-layers-9.3.4.min.js",
    "vendor/deck.gl-mapbox-9.3.4.min.js",
    "vendor/deck.gl-mesh-layers-9.3.4.min.js",
    "vendor/fonts/OFL-Orbitron.txt",
    "vendor/fonts/OFL-Saira.txt",
    "vendor/fonts/fonts.css",
    "vendor/fonts/orbitron-latin.woff2",
    "vendor/fonts/saira-latin.woff2",
    "vendor/maplibre-gl-5.24.0.css",
    "vendor/maplibre-gl-5.24.0.js",
]

# head で同期に読む 4 本（この順序でないと deck の UMD が壊れる）。
HEAD_SCRIPTS = [
    "vendor/maplibre-gl-5.24.0.js",
    "vendor/deck.gl-core-9.3.4.min.js",
    "vendor/deck.gl-layers-9.3.4.min.js",
    "vendor/deck.gl-mapbox-9.3.4.min.js",
]

CDN_MARKERS = ("unpkg.com", "googleapis.com", "gstatic.com")
PRECONNECT_ALLOW = {"https://tiles.openfreemap.org", "https://raw.githubusercontent.com"}

PIN_LINE = re.compile(r"^([0-9a-f]{64})  (\S.*)$")


def _pinned() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in PIN.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        m = PIN_LINE.match(line)
        assert m, f"tests/vendor.sha256 の行が sha256sum 形式でない: {line!r}"
        out[m.group(2)] = m.group(1)
    return out


def _on_disk() -> set[str]:
    return {
        p.relative_to(ROOT).as_posix()
        for p in VENDOR.rglob("*")
        if p.is_file() and p.relative_to(ROOT).as_posix() not in PIN_EXCLUDE
    }


def _own_sources() -> list[pathlib.Path]:
    return [ROOT / "index.html"] + sorted(ROOT.glob("css/**/*.css")) + sorted(ROOT.glob("js/**/*.js"))


def test_pin_file_is_sha256sum_format():
    assert PIN.exists(), "tests/vendor.sha256 が無い（python3 scripts/fetch_vendor.py で生成）"
    assert _pinned(), "tests/vendor.sha256 が空"


def test_pinned_set_equals_expected():
    assert sorted(_pinned()) == EXPECTED, "vendor の一覧が期待と違う（増減したら EXPECTED も直す）"


@pytest.mark.parametrize("rel", EXPECTED)
def test_vendor_bytes_match_pin(rel):
    path = ROOT / rel
    assert path.exists(), f"{rel} が無い（python3 scripts/fetch_vendor.py）"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == _pinned()[rel], f"{rel} が固定値と違う（差し替えたら fetch_vendor.py で再生成）"


def test_no_unpinned_files_in_vendor():
    assert _on_disk() == set(_pinned()), "vendor/ に固定されていないファイルがある（または固定済みが消えた）"


def test_readme_documents_upstream_and_refetch():
    readme = (VENDOR / "README.md").read_text(encoding="utf-8")
    assert "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js" in readme
    assert "https://unpkg.com/@deck.gl/core@9.3.4/dist.min.js" in readme
    assert "fonts.googleapis.com/css2" in readme
    assert "python3 scripts/fetch_vendor.py" in readme
    assert "--check" in readme
    assert re.search(r"取得日:\s*20\d\d-\d\d-\d\d", readme), "README に取得日が無い"


@pytest.mark.parametrize("marker", CDN_MARKERS)
def test_own_sources_have_no_cdn_reference(marker):
    hits = [p.relative_to(ROOT).as_posix() for p in _own_sources() if marker in p.read_text(encoding="utf-8")]
    assert hits == [], f"{marker} を参照しているファイル: {hits}（vendor/ に置く）"


def test_index_html_has_no_external_script():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for m in re.finditer(r'<script\b[^>]*\bsrc="([^"]+)"', html):
        assert not re.match(r"https?:|//", m.group(1)), f"外部 script が残っている: {m.group(1)}"


def test_index_html_external_links_are_preconnect_only():
    """外部 <link> は preconnect の 2 本だけ（spec §3.2「外部 <link href> が 0」の読み替え・A-5）。

    preconnect はサブリソースを 1 つも取得しない＝自前配信の趣旨（外部スクリプト/スタイル依存ゼロ）を
    壊さない。外部 <script src> が 0 であることは test_index_html_has_no_external_script が別に固定する。
    """
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    seen = set()
    for m in re.finditer(r"<link\b([^>]*)>", html, re.I):
        attrs = m.group(1)
        href_m = re.search(r'\bhref="([^"]+)"', attrs)
        if not href_m or not re.match(r"https?:|//", href_m.group(1)):
            continue
        rel_m = re.search(r'\brel="([^"]+)"', attrs)
        rel = rel_m.group(1).lower() if rel_m else ""
        assert rel in ("preconnect", "dns-prefetch"), f"外部 <link rel={rel!r}> {href_m.group(1)}"
        seen.add(href_m.group(1))
    assert seen == PRECONNECT_ALLOW, f"preconnect 先が期待と違う: {sorted(seen)}"


def test_index_html_loads_vendor_scripts_in_order():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    tags = re.findall(r"<script\b([^>]*)>", html)
    srcs, defers = [], []
    for attrs in tags:
        m = re.search(r'\bsrc="([^"]+)"', attrs)
        if not m:
            continue
        srcs.append(m.group(1))
        defers.append("defer" in attrs)
    assert srcs[: len(HEAD_SCRIPTS)] == HEAD_SCRIPTS, "vendor の読み込み順が違う（mapbox は core→layers の後）"
    assert all(defers[: len(HEAD_SCRIPTS)]), "vendor の <script> に defer が無い"
    assert srcs[len(HEAD_SCRIPTS):] == [
        "js/main.js", "js/ui/mobile-nav.js", "js/ui/immerse-bar.js",
        "js/ui/scroll-reveal.js", "js/ui/legend.js",
    ], "module script 5 本の並びが変わった"


def test_fonts_css_is_self_hosted():
    css = (VENDOR / "fonts" / "fonts.css").read_text(encoding="utf-8")
    assert css.count("@font-face") == 2, "@font-face は Orbitron / Saira の 2 つ"
    assert "src: url(./orbitron-latin.woff2) format('woff2');" in css
    assert "src: url(./saira-latin.woff2) format('woff2');" in css
    assert css.count("font-display: swap;") == 2
    assert "unicode-range:" in css
    body = css.split("*/", 1)[1] if "*/" in css else css   # 先頭コメント（上流 URL を書く）は除く
    assert "https://" not in body, "@font-face 側に外部 URL が残っている"


def test_vendor_is_in_vercel_builds():
    cfg = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))
    assert {"src": "vendor/**", "use": "@vercel/static"} in cfg["builds"], "vendor/** が builds に無い"


def test_main_js_has_e2e_hook():
    """e2e 能力アサート用フック（§3.2）。window.__orbis 自体は状態バスなので加算式で開く。"""
    src = (ROOT / "js" / "main.js").read_text(encoding="utf-8")
    assert "new URLSearchParams(location.search).get('e2e') === '1'" in src
    assert "window.__orbis.e2e = { map, overlay };" in src
