"""公開の体裁（A4・静的分）＝静的ページ 5 枚・LICENSE・robots.txt・共通フッターの構造テスト（設計 §3.4）。

方針:
- テスト専用の依存を足さない（標準ライブラリ＋pytest だけ）。HTML パーサも使わず
  **配信されるバイト列そのもの**を正規表現で見る。DOM に直すと「`<script>` があるか」
  「`style=` が混じっていないか」という CSP 上の関心がパーサに吸われて消えるため。
- 「ページに何が書いてあるか」は実装（sources.js の SOURCE_MAP・state.js の保存キー）を
  正としてページ側を追従させる。文章を後から足したり層を増やしたりした時、ページが
  黙って嘘になるのを防ぐ。

この時点で **意図的に赤いテスト（xfail strict）が 3 件**ある（時系列の整合）:
- test_pages_are_declared_in_vercel_builds … Task 3 が vercel.json を書いたら緑。Task 3 Step 10 が xfail を外す。
- test_no_youtube_com_embed_in_served_code … Task 8（part3）が youtube-nocookie 化したら緑。Task 8 が xfail を外す。
- test_external_links_are_noopener_noreferrer … Task 8（part3）が rel を直したら緑。Task 8 が xfail を外す。
strict=True なので「まだ直っていないのに緑」も「直したのに xfail のまま」も検出される。
"""
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

PAGES = ["404.html", "about.html", "terms.html", "privacy.html", "attribution.html"]
FOOTED = PAGES + ["index.html"]          # 共通フッターを持つ全 HTML
FOOT_LINKS = ["/about", "/terms", "/privacy", "/attribution"]
COPYRIGHT = "© 2026 sg55555 · 非商用・個人運営"
AI_CRAWLERS = ["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot",
               "Google-Extended", "Applebot-Extended", "Bytespider", "PerplexityBot"]

STYLE_ATTR = re.compile(r"(?<![\w-])style\s*=")
ON_ATTR = re.compile(r"(?<![\w-])on[a-z]+\s*=")


def read(rel):
    p = ROOT / rel
    assert p.is_file(), f"{rel} が無い"
    return p.read_text(encoding="utf-8")


def source_map_names():
    """js/ui/sources.js の SOURCE_MAP から出典表示名の集合を取り出す（実装が正）。"""
    js = read("js/ui/sources.js")
    m = re.search(r"export const SOURCE_MAP\s*=\s*\{(.*?)\n\};", js, re.S)
    assert m, "SOURCE_MAP ブロックが見つからない（sources.js の形が変わった）"
    names = {n for n in re.findall(r"source:\s*'([^']*)'", m.group(1)) if n}
    assert names, "SOURCE_MAP から出典名が 1 つも取れない"
    return names


def storage_keys():
    """js/** で実際に localStorage に書かれているキー名の集合（実装が正）。"""
    keys = set()
    for p in sorted((ROOT / "js").rglob("*.js")):
        keys |= set(re.findall(r"""['"](orbis\.[A-Za-z0-9_.]+)['"]""", p.read_text(encoding="utf-8")))
    assert keys, "js/** から orbis.* の保存キーが 1 つも取れない"
    return keys


# ── ページの存在と純静的性 ─────────────────────────────────────
@pytest.mark.parametrize("page", PAGES)
def test_page_exists(page):
    assert (ROOT / page).is_file(), f"{page} が無い"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_no_script(page):
    # 純静的＝JS を 1 行も持たない。CSP の script-src 'self' 以前に、そもそも実行するものが無い。
    assert "<script" not in read(page), f"{page} に <script> がある（純静的でない）"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_no_inline_style_or_handler(page):
    html = read(page)
    assert not STYLE_ATTR.search(html), f"{page} に style= がある（style-src 'self' で落ちる）"
    assert not ON_ATTR.search(html), f"{page} に on*= のイベント属性がある"
    assert "<style" not in html, f"{page} に <style> がある"
    assert "javascript:" not in html, f"{page} に javascript: がある"


@pytest.mark.parametrize("page", PAGES)
def test_page_links_shared_and_page_stylesheets(page):
    html = read(page)
    assert '<link rel="stylesheet" href="/css/orbis.css" />' in html, \
        f"{page} が css/orbis.css を読んでいない（トークンが効かない）"
    assert '<link rel="stylesheet" href="/css/pages.css" />' in html, \
        f"{page} が css/pages.css を読んでいない"


@pytest.mark.parametrize("page", PAGES)
def test_page_has_lang_and_title(page):
    html = read(page)
    assert '<html lang="ja">' in html, f"{page} に lang=ja が無い"
    m = re.search(r"<title>(.*?)</title>", html)
    assert m and m.group(1).strip(), f"{page} に <title> が無い"
    assert "ORBIS" in m.group(1), f"{page} の <title> に ORBIS が無い: {m.group(1)}"


# ── 共通フッター ───────────────────────────────────────────
@pytest.mark.parametrize("page", FOOTED)
def test_page_has_footer_with_four_links(page):
    html = read(page)
    assert '<footer class="site-foot">' in html, f"{page} に共通フッターが無い"
    for href in FOOT_LINKS:
        assert f'href="{href}"' in html, f"{page} のフッターに {href} へのリンクが無い"


@pytest.mark.parametrize("page", FOOTED)
def test_page_has_copyright_line(page):
    assert COPYRIGHT in read(page), f"{page} に著作権表示「{COPYRIGHT}」が無い"


def test_404_page_offers_a_way_back():
    html = read("404.html")
    assert "ORBIS へ戻る" in html, "404.html に「ORBIS へ戻る」導線が無い"
    assert 'href="/"' in html, "404.html にトップへのリンクが無い"
    assert "404" in html and "見つかりません" in html, "404.html に 404 の見出しが無い"


# ── attribution が実装（SOURCE_MAP）を漏れなく覆う ─────────────────
def test_attribution_covers_every_source_map_name():
    html = read("attribution.html")
    missing = sorted(n for n in source_map_names() if n not in html)
    assert missing == [], f"attribution.html に出典名が無い: {missing}"


def test_attribution_lists_third_party_licenses():
    html = read("attribution.html")
    for needle in (
        "CC BY-SA 4.0",            # Wikipedia（ja）＋本サイトのプロフィール本文
        "AI により要約/再構成",     # 再構成の明示（CC BY-SA の改変告知）
        "CC0",                     # Wikidata
        "ODbL",                    # OpenStreetMap / OpenMapTiles / OpenFreeMap
        "OpenFreeMap",
        "OpenMapTiles",
        "OpenStreetMap contributors",
        "CC BY 4.0",               # Open-Meteo
        "SIL Open Font License",   # Orbitron / Saira
        "Orbitron",
        "Saira",
        "MapLibre",
        "BSD 3-Clause",            # MapLibre GL JS
        "deck.gl",
        "MIT",                     # deck.gl と ORBIS 自身のコード
    ):
        assert needle in html, f"attribution.html に「{needle}」が無い"


# ── about / terms / privacy の必須項目 ───────────────────────────
def test_about_states_operator_and_contact():
    html = read("about.html")
    assert "sg55555" in html, "about に運営者名が無い"
    assert "個人" in html and "非商用" in html, "about に個人・非商用の明示が無い"
    assert "https://github.com/sg55555/orbis/issues" in html, "about に連絡先（GitHub Issues）が無い"
    assert "GitHub Actions" in html, "about に更新の仕組みの説明が無い"


def test_terms_has_disclaimer_and_governing_law():
    html = read("terms.html")
    for needle in ("免責", "保証", "AI", "推定", "投資", "避難", "禁止", "日本法"):
        assert needle in html, f"terms に「{needle}」の記載が無い"


def test_privacy_lists_every_actual_storage_key():
    html = read("privacy.html")
    missing = sorted(k for k in storage_keys() if k not in html)
    assert missing == [], f"privacy.html に localStorage の実キーが無い: {missing}"


def test_privacy_lists_external_destinations():
    html = read("privacy.html")
    for needle in (
        "raw.githubusercontent.com",   # データ取得
        "tiles.openfreemap.org",       # 地図タイル
        "youtube-nocookie.com",        # 埋め込み再生（Task 8 でコード側も一致する）
        "i.ytimg.com",                 # カメラのサムネイル
        "localhost:8900",              # AI 字幕（端末内のみ）
        "Vercel",                      # サーバー側アクセスログ
        "Cookie",                      # 使っていないことの明示
    ):
        assert needle in html, f"privacy.html に外部送信先「{needle}」の記載が無い"
    assert "外部には送信しません" in html, "privacy.html に AI 字幕がローカル完結である明示が無い"


# ── LICENSE / robots / README ────────────────────────────────
def test_license_is_mit_for_sg55555():
    text = read("LICENSE")
    assert "MIT License" in text, "LICENSE が MIT でない"
    assert "Copyright (c) 2026 sg55555" in text, "LICENSE の著作権表示が違う"
    assert "WITHOUT WARRANTY OF ANY KIND" in text, "LICENSE 本文が欠けている"


def test_readme_has_license_section():
    text = read("README.md")
    assert re.search(r"^## ライセンス\s*$", text, re.M), "README にライセンス節が無い"
    assert "MIT" in text and "attribution" in text, "README のライセンス節が不完全"


def test_robots_allows_search_engines():
    text = read("robots.txt")
    assert re.search(r"^User-agent: \*\s*$", text, re.M), "robots.txt に User-agent: * が無い"
    assert re.search(r"^Allow: /\s*$", text, re.M), "robots.txt に Allow: / が無い（公開サイトなので検索は許可）"


@pytest.mark.parametrize("bot", AI_CRAWLERS)
def test_robots_blocks_ai_training_crawler(bot):
    text = read("robots.txt")
    m = re.search(rf"^User-agent: {re.escape(bot)}\s*\nDisallow: /\s*$", text, re.M)
    assert m, f"robots.txt が {bot} を Disallow していない"


def test_robots_has_no_sitemap_line():
    # sitemap は作らない（生成する仕組みが無いのに宣言すると 404 を配ることになる）。
    assert "Sitemap" not in read("robots.txt"), "robots.txt に Sitemap 行がある"


# ── CSS（共有トークンの再定義禁止・面禁則） ─────────────────────────
def test_pages_css_reuses_tokens_without_redefining_them():
    css = read("css/pages.css")
    for sel in ("body.page", ".page-wrap", ".page-top", ".page-h"):
        assert sel in css, f"css/pages.css に {sel} が無い"
    assert ":root" not in css, "css/pages.css が :root を再定義している（トークンは orbis.css の 1 箇所だけ）"
    assert "@import" not in css, "css/pages.css が @import している（<link> で共有する方針）"
    assert "radial-gradient" not in css, "css/pages.css が面（radial-gradient）を新設している（面禁則）"


def test_site_foot_style_lives_in_orbis_css():
    # index.html は orbis.css しか読まないので .site-foot は orbis.css 側に無いと素の <footer> になる。
    css = read("css/orbis.css")
    assert re.search(r"^\.site-foot\s*\{", css, re.M), "css/orbis.css に .site-foot 規則が無い"
    assert ".foot-links" in css and ".foot-copy" in css, "css/orbis.css にフッター子要素の規則が無い"


# ── 時系列の整合（後続タスクで緑になる） ───────────────────────────
def test_pages_are_declared_in_vercel_builds():
    cfg = json.loads(read("vercel.json"))
    built = {b["src"] for b in cfg.get("builds", [])}
    missing = sorted(p for p in PAGES + ["robots.txt"] if p not in built)
    assert missing == [], f"vercel.json の builds に無い＝配信されない: {missing}"


@pytest.mark.xfail(strict=True, reason="Task 8（part3）が youtube-nocookie 化したら緑（Task 8 でこの行を削除する）")
def test_no_youtube_com_embed_in_served_code():
    hits = []
    for p in [ROOT / "index.html"] + sorted((ROOT / "js").rglob("*.js")):
        if "youtube.com/embed" in p.read_text(encoding="utf-8"):
            hits.append(p.relative_to(ROOT).as_posix())
    assert hits == [], f"youtube.com/embed が残っている（youtube-nocookie.com にする）: {hits}"


@pytest.mark.xfail(strict=True, reason="Task 8（part3）が rel を noopener noreferrer にしたら緑（Task 8 でこの行を削除する）")
def test_external_links_are_noopener_noreferrer():
    hits = []
    for p in [ROOT / "index.html"] + sorted((ROOT / "js").rglob("*.js")):
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r'rel="([^"]*)"', src):
            rel = m.group(1).split()
            if "noopener" in rel and "noreferrer" not in rel:
                hits.append(f"{p.relative_to(ROOT).as_posix()}: rel=\"{m.group(1)}\"")
    assert hits == [], f"rel に noreferrer が無い外部リンク: {hits}"
