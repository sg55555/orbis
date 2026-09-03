"""厳格 CSP（style-src 'self'）の静的ガード（設計 §3.5 / A5）。

自前の HTML/JS に インライン <script> 本文・<style>・style=・on*=・javascript: を残さない。
動的スタイルは data-style="…" ＋ js/lib/data-style.js の applyDataStyles(root)（CSSOM）だけ。
型＝~/apps/task-dashboard/tests/test_static_guards.py。
"""
import pathlib
import re
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

# index.html＋Task 2 の静的ページ 5 枚。
PAGES = ["index.html", "404.html", "about.html", "terms.html", "privacy.html", "attribution.html"]
# 自前 JS（vendor/ は js/ の外なので自動的に対象外）。
OWN_JS = sorted(p.relative_to(ROOT).as_posix() for p in ROOT.glob("js/**/*.js"))

# on* 属性（on で始まる普通の単語 only/once/one/online/onto は除外）＝型と同じ正規表現。
ON_ATTR = re.compile(r"""\bon(?!ly\b|ce\b|e\b|line\b|to\b)[a-z]+\s*=\s*["'`]""", re.I)
# style= 属性。直前に単語文字/ハイフンが無いこと＝data-style= は当たらない。
STYLE_ATTR = re.compile(r"""(?<![\w-])style\s*=\s*["'`]""")
# javascript: スキーム。JS 側は「属性文脈」だけを禁じる（selection.js:167 の
# 「不正フィードの javascript: 等を無効化」という安全側のコメントを殺さないため）。
JS_SCHEME_ATTR = re.compile(r"""(?:href|src|action|formaction)\s*=\s*(?:["'`]\s*)?javascript:""", re.I)
DATA_STYLE = re.compile(r'data-style="([^"]*)"')
# applyDataStyles を data-style.js から import しているか（相対深さは問わない）。
IMPORT_APPLY = re.compile(r"""import\s*\{[^}]*\bapplyDataStyles\b[^}]*\}\s*from\s*['"][^'"]*data-style\.js['"]""")

PRECONNECT_ALLOW = {"https://tiles.openfreemap.org", "https://raw.githubusercontent.com"}
CDN_MARKERS = ("unpkg", "googleapis", "gstatic")

# data-style を出すが innerHTML を触らない純 HTML ビルダ。適用は呼び出し側が受け持つ。
PURE_TEMPLATE_ALLOW = {
    "js/lib/selection.js": "main.js の showPopup が applyDataStyles(selPopup.getElement()) で適用",
    "js/lib/drilldown/drilldown_view.js": "js/ui/drilldown.js が innerHTML 直後に applyDataStyles で適用",
}

# applyDataStyles を呼ぶ描画点（件数まで固定＝呼び忘れ／消し忘れの回帰ガード）。
APPLY_SITES = {
    "js/ui/feed.js": 2,         # renderFeed / renderChips
    "js/ui/forecast.js": 1,     # カード innerHTML
    "js/ui/instability.js": 1,  # 行 innerHTML
    "js/ui/legend.js": 1,       # insertAdjacentHTML
    "js/ui/panel.js": 1,        # レイヤー行 innerHTML
    "js/ui/drilldown.js": 3,    # mkRowButton / ヘッダ / ウォッチリスト行
    "js/main.js": 2,            # showPopup / boot 先頭の applyDataStyles(document)
}
# 件数だけだと「片方を消してもう片方を 2 回呼ぶ」で緑のまま擦り抜けるので、呼び出しの逐語も個別に固定する（F-7）。
APPLY_LITERALS = {
    "js/main.js": ["applyDataStyles(document);", "applyDataStyles(selPopup.getElement());"],
}


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


@pytest.mark.parametrize("page", PAGES)
def test_page_scripts_are_external_and_empty(page):
    html = read(page)
    for m in re.finditer(r"<script\b([^>]*)>(.*?)</script>", html, re.S | re.I):
        attrs, body = m.group(1), m.group(2)
        src_m = re.search(r'\bsrc="([^"]+)"', attrs)
        assert src_m, f"{page}: src 無しの <script>: {m.group(0)[:80]}"
        assert body.strip() == "", f"{page}: <script> に本文が残っている"
        src = src_m.group(1)
        assert not re.match(r"https?:|//", src), f"{page}: 外部 script {src}"
        assert (ROOT / src.lstrip("/")).exists(), f"{page}: {src} がディスクに無い"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_no_inline_style_or_handlers(page):
    html = read(page)
    assert "<style" not in html.lower(), f"{page}: <style> が残っている"
    assert not STYLE_ATTR.search(html), f"{page}: style= が残っている（data-style= にする）"
    assert not ON_ATTR.search(html), f"{page}: on*= が残っている"
    assert "javascript:" not in html.lower(), f"{page}: javascript: スキームがある"


@pytest.mark.parametrize("page", PAGES)
def test_page_external_links_are_preconnect_only(page):
    html = read(page)
    for m in re.finditer(r"<link\b([^>]*)>", html, re.I):
        attrs = m.group(1)
        href_m = re.search(r'\bhref="([^"]+)"', attrs)
        if not href_m or not re.match(r"https?:|//", href_m.group(1)):
            continue
        rel_m = re.search(r'\brel="([^"]+)"', attrs)
        rel = rel_m.group(1).lower() if rel_m else ""
        assert rel in ("preconnect", "dns-prefetch"), f"{page}: 外部 <link rel={rel!r}> {href_m.group(1)}"
        assert href_m.group(1) in PRECONNECT_ALLOW, f"{page}: 想定外の preconnect 先 {href_m.group(1)}"


@pytest.mark.parametrize("page", PAGES)
def test_page_data_style_values_are_literal(page):
    for value in DATA_STYLE.findall(read(page)):
        assert "${" not in value and "<" not in value, f"{page}: data-style に埋め込みがある（{value}）"


def test_index_static_data_styles_are_pinned():
    """index.html の静的 data-style は #alerts / #cams-one-tabs の 2 件だけ（設計 §3.5）。"""
    assert DATA_STYLE.findall(read("index.html")) == ["display:none", "display:none"]


@pytest.mark.parametrize("js", OWN_JS)
def test_own_js_has_no_inline_patterns(js):
    src = read(js)
    assert not STYLE_ATTR.search(src), f"{js}: style= をテンプレートに持つ（data-style= にする）"
    assert not ON_ATTR.search(src), f"{js}: on*= をテンプレートに持つ"
    assert not JS_SCHEME_ATTR.search(src), f"{js}: 属性に javascript: スキームがある"
    assert "setAttribute('style'" not in src and 'setAttribute("style"' not in src, \
        f"{js}: setAttribute('style') は使わない（el.style / data-style にする）"
    assert "<style" not in src.lower(), f"{js}: <style> を生成している"


@pytest.mark.parametrize("js", OWN_JS)
def test_own_js_has_no_cdn_reference(js):
    src = read(js)
    for marker in CDN_MARKERS:
        assert marker not in src, f"{js}: {marker} を参照している（vendor/ に置く）"


@pytest.mark.parametrize("js", OWN_JS)
def test_data_style_producers_apply_or_are_allowlisted(js):
    src = read(js)
    if not DATA_STYLE.search(src):
        return
    if js in PURE_TEMPLATE_ALLOW:
        assert "applyDataStyles" not in src, \
            f"{js}: 純ビルダの許可リストなのに自前で適用している（PURE_TEMPLATE_ALLOW から外す）"
        return
    assert IMPORT_APPLY.search(src), \
        f"{js}: data-style= を出すなら applyDataStyles を import して innerHTML 直後に呼ぶ"


@pytest.mark.parametrize("js,count", sorted(APPLY_SITES.items()))
def test_apply_sites_are_pinned(js, count):
    src = read(js)
    assert IMPORT_APPLY.search(src), f"{js}: applyDataStyles を import していない"
    assert src.count("applyDataStyles(") == count, \
        f"{js}: applyDataStyles の呼び出しが {src.count('applyDataStyles(')} 箇所（期待 {count}）"
    for literal in APPLY_LITERALS.get(js, []):
        assert src.count(literal) == 1, \
            f"{js}: `{literal}` がちょうど 1 回でない（件数固定だけでは擦り抜ける・F-7）"


def test_main_js_popup_goes_through_helper():
    """maplibre Popup は showPopup() に集約し、素の setHTML(...).addTo(map) を残さない。"""
    src = read("js/main.js")
    assert "function showPopup(lngLat, html)" in src
    assert "applyDataStyles(selPopup.getElement());" in src
    assert "setHTML(" not in src.replace(
        "selPopup.setLngLat(lngLat).setHTML(html).addTo(map);", ""
    ), "showPopup を通さない setHTML が残っている"
    assert src.count("showPopup(") == 8, "showPopup の定義 1＋呼び出し 7 箇所"


def test_main_js_publishes_applied_static_for_e2e():
    """?e2e=1 のときだけ「起動時に当てた静的 data-style の件数」を公開する（e2e の正の確認用）。"""
    src = read("js/main.js")
    assert "const appliedStatic = applyDataStyles(document);" in src
    assert "window.__orbis.e2e = { map, overlay, appliedStatic };" in src


def test_flicker_guard_css_exists():
    """applyDataStyles が走るまでの 1 フレームを CSS で塞ぐ（設計 §3.5）。"""
    css = read("css/orbis.css")
    assert re.search(
        r"#alerts\[data-style\]\s*,\s*#cams-one-tabs\[data-style\]\s*\{[^}]*display:\s*none",
        css,
    ), "ちらつき防止の #alerts[data-style],#cams-one-tabs[data-style]{display:none} が無い"


def test_no_tracked_agent_workdirs():
    out = subprocess.run(
        ["git", "ls-files", ".superpowers", ".claude", ".claire"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert out == "", f"追跡されている作業ディレクトリのファイル:\n{out}"
