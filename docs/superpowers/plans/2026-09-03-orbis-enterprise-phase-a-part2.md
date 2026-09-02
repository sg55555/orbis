# Phase A Implementation Plan — part2（Task 4〜6）

骨格 `2026-09-03-orbis-enterprise-phase-a.md` の契約に従う（ヘッダー・Global Constraints・File Structure・Interfaces・Task 番号/名前は骨格が正）。

> **実装者への注意（この分冊の 3 タスク共通）**
> - 作業場所＝worktree `/home/shugo/apps/orbis/.claude/worktrees/enterprise-a`。main チェックアウト `/home/shugo/apps/orbis` には触らない。
> - Bash の worktree ガードは「変数を含むループ等の複雑なコマンド」を拒否する → 複雑な処理はスクリプトファイルに書いて `python3 file.py` で実行する。
> - 実行コマンドはすべて **リポジトリ直下（worktree ルート）で 1 行 1 コマンド**。
> - 依存は増やさない（Python は標準ライブラリのみ・npm 追加なし）。
> - ベースライン（Task 4 着手前の実測・2026-09-03）＝`node --test tests/*.test.js` **643 pass / 0 fail**、`python3 -m pytest -q` **417 passed / 10 skipped**。各 Task の「緑」はこの数から**増えるだけ**で、既存が赤にならないこと。

## 骨格からの読み替え（3 点・実物に合わせた必須の差分）

1. **`window.__orbis` は「?e2e=1 の時だけ定義」にできない。** `js/main.js` の `window.__orbis` は e2e 用の窓ではなく **module 内の状態バス**で、`rebuild()`（143 行 `const map = window.__orbis.map;`）・`drawAll()`（303）・`refreshFeed()`（160）・`refreshSources()`（725-729）など **約 30 箇所が無条件に参照**する。ゲートすると起動時に落ちる。よって Task 4 のフックは **加算式**にする＝`window.__orbis = { map, overlay, counts: {} }` は従来どおり常に置き、`?e2e=1` の時だけ `window.__orbis.e2e = { map, overlay }` を**追加**する。骨格の e2e 能力アサート `window.__orbis?.map?.getProjection?.().type === 'globe'` はそのまま通る（part4 の e2e は `?e2e=1` で開き `window.__orbis.e2e.map` を使ってもよい）。
2. **`style="` の置換は 19 箇所ではなく 21 箇所。** 骨格・spec §2 の本文は「19 箇所」と書くが、同じ括弧内に列挙された行番号は 21 行あり、実測 grep（2026-09-03）も **21 箇所・7 ファイル**（selection.js 8／feed.js 4／forecast.js 3／instability.js 2／legend.js 2／panel.js 1／drilldown_view.js 1）。**列挙が正・数字が誤**なので 21 箇所すべてを Task 6 で置換する。
3. **`selPopup` の置換は 6 箇所ではなく 7 箇所。** 骨格は「6 箇所」と書くが列挙（158-159/369/377/387/397/501-502/574）も実測 grep も **7 箇所**（main.js 159・369・377・387・397・502・574）。7 箇所すべてを `showPopup(lngLat, html)` に置換する。

---

### Task 4: A2 `scripts/fetch_vendor.py`＋`vendor/**`＋`vendor.sha256`＋integrity テスト＋index.html head 差し替え＋`?e2e=1` フック

**Files:**
- Create: `tests/test_vendor_integrity.py`
- Create: `scripts/fetch_vendor.py`
- Create（スクリプトが生成・コミット対象）: `vendor/maplibre-gl-5.24.0.js`・`vendor/maplibre-gl-5.24.0.css`・`vendor/deck.gl-core-9.3.4.min.js`・`vendor/deck.gl-layers-9.3.4.min.js`・`vendor/deck.gl-mapbox-9.3.4.min.js`・`vendor/deck.gl-mesh-layers-9.3.4.min.js`・`vendor/deck.gl-geo-layers-9.3.4.min.js`・`vendor/LICENSE-maplibre-gl.txt`・`vendor/LICENSE-deck.gl.txt`・`vendor/fonts/orbitron-latin.woff2`・`vendor/fonts/saira-latin.woff2`・`vendor/fonts/fonts.css`・`vendor/fonts/OFL-Orbitron.txt`・`vendor/fonts/OFL-Saira.txt`・`tests/vendor.sha256`
- Create（手書き）: `vendor/README.md`
- Modify: `index.html`（12〜19 行＝head の unpkg 2 本＋Google Fonts 3 行を撤去し vendor 参照へ）／`js/main.js`（407 行の直後に `?e2e=1` フックを追加）
- Test: `tests/test_vendor_integrity.py`

**Interfaces:**
- Consumes: `vercel.json` の `builds`（Task 3 が `{ "src": "vendor/**", "use": "@vercel/static" }` を含む）／骨格 Global Constraints のバージョン固定とファイル名。
- Produces:
  - `scripts/fetch_vendor.py`：`python3 scripts/fetch_vendor.py`（取得＋`tests/vendor.sha256` 生成）／`python3 scripts/fetch_vendor.py --check`（取得せず突合・一致なら exit 0）
  - `tests/vendor.sha256`：`sha256sum` 互換 `<64桁 hex><SP><SP><リポジトリ直下からの相対パス>`（例 `…  vendor/maplibre-gl-5.24.0.js`）。`vendor/README.md` は**含めない**。
  - `index.html` head：`<script defer src="vendor/…">` 4 本（maplibre → deck core → layers → mapbox）＋`<link rel="stylesheet" href="vendor/maplibre-gl-5.24.0.css">`＋`<link rel="stylesheet" href="vendor/fonts/fonts.css">`＋preconnect 2 本
  - `js/main.js`：`window.__orbis.e2e = { map, overlay }`（`new URLSearchParams(location.search).get('e2e') === '1'` の時だけ）

---

- [ ] **Step 1: 失敗するテストを書く** — `tests/test_vendor_integrity.py` を新規作成（全文）

```python
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
```

- [ ] **Step 2: 失敗を確認**

Run（実行1・この 1 行で 1 コマンド）:
```
python3 -m pytest tests/test_vendor_integrity.py -q
```
Expected: 失敗。`vendor/` も `tests/vendor.sha256` も無いので大半が
`FileNotFoundError: [Errno 2] No such file or directory: '.../tests/vendor.sha256'`（`_pinned()` 経由）と
`FileNotFoundError: ... vendor/README.md` で error、
`test_own_sources_have_no_cdn_reference[unpkg.com]` は
`AssertionError: unpkg.com を参照しているファイル: ['index.html']` で fail、
`test_index_html_has_no_external_script` は
`AssertionError: 外部 script が残っている: https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js` で fail。
（`0 passed` ではなく `test_vendor_is_in_vercel_builds` だけは Task 3 の成果で緑になる。）

- [ ] **Step 3: `scripts/fetch_vendor.py` を書く（最小実装 1／取得器）** — 全文

```python
#!/usr/bin/env python3
"""vendor/ の外部ライブラリを上流から取得し tests/vendor.sha256 を生成する（設計 §3.2 / A2）。

  python3 scripts/fetch_vendor.py           取得して vendor/** と tests/vendor.sha256 を更新
  python3 scripts/fetch_vendor.py --check   取得せず tests/vendor.sha256 と実ファイルを突合

標準ライブラリ（urllib）のみ。vendor/ は手で編集しない＝差し替えは必ずこのスクリプトで行う。
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import pathlib
import re
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor"
PIN = ROOT / "tests" / "vendor.sha256"
PIN_EXCLUDE = {"vendor/README.md"}   # 人が書く説明。取得物ではないので固定しない。

MAPLIBRE_VERSION = "5.24.0"
DECK_VERSION = "9.3.4"
DECK_PACKAGES = ("core", "layers", "mapbox", "mesh-layers", "geo-layers")
TIMEOUT = 60

# UA 判定で配信物が変わる CDN があるため全リクエストで同じ Chrome UA を送る。
# 必須なのは Google css2（既定 UA だと可変 woff2 でなく ttf が返る）。
CHROME_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36")

# (URL, vendor/ からの相対保存パス)。ファイル名に版を含める＝Cache-Control immutable の前提。
BINARY_SOURCES: list[tuple[str, str]] = [
    (f"https://unpkg.com/maplibre-gl@{MAPLIBRE_VERSION}/dist/maplibre-gl.js",
     f"maplibre-gl-{MAPLIBRE_VERSION}.js"),
    (f"https://unpkg.com/maplibre-gl@{MAPLIBRE_VERSION}/dist/maplibre-gl.css",
     f"maplibre-gl-{MAPLIBRE_VERSION}.css"),
] + [
    (f"https://unpkg.com/@deck.gl/{pkg}@{DECK_VERSION}/dist.min.js",
     f"deck.gl-{pkg}-{DECK_VERSION}.min.js")
    for pkg in DECK_PACKAGES
]

# ライセンス本文。上流の配置は変わることがあるので候補を順に試し、最初に取れたものを保存する
# （OFL は google/fonts が落ちていたら SIL の定型本文を置く openfontlicense.org を使う）。
LICENSE_SOURCES: list[tuple[list[str], str]] = [
    ([f"https://raw.githubusercontent.com/maplibre/maplibre-gl-js/v{MAPLIBRE_VERSION}/LICENSE.txt",
      "https://raw.githubusercontent.com/maplibre/maplibre-gl-js/main/LICENSE.txt"],
     "LICENSE-maplibre-gl.txt"),
    ([f"https://raw.githubusercontent.com/visgl/deck.gl/v{DECK_VERSION}/LICENSE",
      "https://raw.githubusercontent.com/visgl/deck.gl/master/LICENSE"],
     "LICENSE-deck.gl.txt"),
    (["https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/OFL.txt",
      "https://openfontlicense.org/documents/OFL.txt"],
     "fonts/OFL-Orbitron.txt"),
    (["https://raw.githubusercontent.com/google/fonts/main/ofl/saira/OFL.txt",
      "https://openfontlicense.org/documents/OFL.txt"],
     "fonts/OFL-Saira.txt"),
]

GOOGLE_CSS2_URL = ("https://fonts.googleapis.com/css2"
                   "?family=Orbitron:wght@600;800&family=Saira:wght@400;500;600;700&display=swap")
# UI 本文（日本語）は system-ui。Web フォントは latin のワードマーク/見出しだけ＝latin サブセットのみ持つ。
FONT_FILES = {"Orbitron": "fonts/orbitron-latin.woff2", "Saira": "fonts/saira-latin.woff2"}
FONTS_CSS = "fonts/fonts.css"

FACE_RE = re.compile(r"/\*\s*(?P<subset>[a-z0-9\-]+)\s*\*/\s*@font-face\s*\{(?P<body>[^}]*)\}", re.I)
WOFF2_RE = re.compile(r"url\((https://[^)\s]+\.woff2)\)")


def decl(body: str, name: str) -> str | None:
    """@font-face ブロックの 1 宣言を取り出す（無ければ None）。"""
    m = re.search(rf"(?<![\w-]){name}\s*:\s*([^;]+);", body, re.I)
    return m.group(1).strip() if m else None


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": CHROME_UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as res:
        return res.read()


def fetch_first(urls: list[str]) -> tuple[str, bytes]:
    errors = []
    for url in urls:
        try:
            return url, fetch(url)
        except (urllib.error.URLError, OSError) as exc:
            errors.append(f"{url}: {exc}")
    raise SystemExit("取得できませんでした（候補を全部試しました）:\n  " + "\n  ".join(errors))


def write(rel: str, data: bytes) -> None:
    path = VENDOR / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"  saved vendor/{rel} ({len(data):,} bytes)")


def parse_latin_faces(css_text: str) -> dict[str, dict]:
    """css2 の応答から `/* latin */` の @font-face だけを family 別に集める。"""
    out: dict[str, dict] = {}
    for m in FACE_RE.finditer(css_text):
        if m.group("subset").lower() != "latin":
            continue
        body = m.group("body")
        family = (decl(body, "font-family") or "").strip().strip("'\"")
        url_m = WOFF2_RE.search(decl(body, "src") or "")
        if not family or not url_m:
            continue
        entry = out.setdefault(family, {"urls": [], "weights": [], "style": None, "range": None})
        entry["urls"].append(url_m.group(1))
        entry["weights"].append(decl(body, "font-weight") or "400")
        entry["style"] = entry["style"] or (decl(body, "font-style") or "normal")
        entry["range"] = entry["range"] or decl(body, "unicode-range")
    return out


def weight_spec(weights: list[str]) -> str:
    """css2 が返した font-weight をそのまま写す（可変フォントなら範囲 `600 800`）。"""
    nums = [int(n) for w in weights for n in re.findall(r"\d+", w)]
    if not nums:
        return "400"
    lo, hi = min(nums), max(nums)
    return str(lo) if lo == hi else f"{lo} {hi}"


def build_fonts(fetched_on: str) -> None:
    css_text = fetch(GOOGLE_CSS2_URL).decode("utf-8")
    faces = parse_latin_faces(css_text)
    missing = [f for f in FONT_FILES if f not in faces]
    if missing:
        raise SystemExit(f"css2 の応答に latin ブロックが無い: {missing}\n{GOOGLE_CSS2_URL}")
    blocks = []
    for family, rel in FONT_FILES.items():
        entry = faces[family]
        urls = sorted(set(entry["urls"]))
        if len(urls) != 1:
            raise SystemExit(f"{family}: latin の woff2 が {len(urls)} 個（可変フォント 1 個を想定）: {urls}")
        write(rel, fetch(urls[0]))
        blocks.append(
            "@font-face {\n"
            f"  font-family: '{family}';\n"
            f"  font-style: {entry['style'] or 'normal'};\n"
            f"  font-weight: {weight_spec(entry['weights'])};\n"
            "  font-display: swap;\n"
            f"  src: url(./{pathlib.PurePosixPath(rel).name}) format('woff2');\n"
            + (f"  unicode-range: {entry['range']};\n" if entry["range"] else "")
            + "}\n"
        )
    header = (
        "/* Orbis 自前配信フォント — scripts/fetch_vendor.py が生成（手で編集しない）。\n"
        f"   上流: {GOOGLE_CSS2_URL}\n"
        f"   取得日: {fetched_on} / latin サブセットのみ（日本語 UI は system-ui＝Web フォントを使わない）。\n"
        "   ライセンス: SIL Open Font License 1.1（OFL-Orbitron.txt / OFL-Saira.txt）。 */\n"
    )
    write(FONTS_CSS, (header + "\n" + "\n".join(blocks)).encode("utf-8"))


def pin_entries() -> list[tuple[str, str]]:
    out = []
    for path in sorted(VENDOR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(ROOT).as_posix()
        if rel in PIN_EXCLUDE:
            continue
        out.append((hashlib.sha256(path.read_bytes()).hexdigest(), rel))
    return out


def write_pin() -> None:
    entries = pin_entries()
    PIN.parent.mkdir(parents=True, exist_ok=True)
    PIN.write_text("".join(f"{digest}  {rel}\n" for digest, rel in entries), encoding="utf-8")
    print(f"  wrote tests/vendor.sha256 ({len(entries)} files)")


def check_pin() -> int:
    if not PIN.exists():
        print("NG: tests/vendor.sha256 がありません（先に引数なしで実行）")
        return 1
    pinned: dict[str, str] = {}
    for line in PIN.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, _, rel = line.partition("  ")
        pinned[rel.strip()] = digest.strip()
    actual = {rel: digest for digest, rel in pin_entries()}
    bad = []
    for rel, digest in sorted(pinned.items()):
        if rel not in actual:
            bad.append(f"欠落: {rel}")
        elif actual[rel] != digest:
            bad.append(f"不一致: {rel}\n    pin={digest}\n    now={actual[rel]}")
    for rel in sorted(set(actual) - set(pinned)):
        bad.append(f"未固定の余分なファイル: {rel}")
    if bad:
        print("NG: vendor が固定値と違います")
        for line in bad:
            print("  " + line)
        return 1
    print(f"OK: vendor {len(pinned)} ファイルが tests/vendor.sha256 と一致")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="vendor/ を上流から取得し sha256 を固定する")
    parser.add_argument("--check", action="store_true", help="取得せず固定値と突合するだけ")
    args = parser.parse_args()
    if args.check:
        return check_pin()
    today = datetime.date.today().isoformat()
    print(f"fetching vendor/ ({today}) …")
    for url, rel in BINARY_SOURCES:
        write(rel, fetch(url))
    for urls, rel in LICENSE_SOURCES:
        used, data = fetch_first(urls)
        write(rel, data)
        print(f"    (license from {used})")
    build_fonts(today)
    write_pin()
    print("done. `python3 scripts/fetch_vendor.py --check` で再検証できます。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 取得を実行し `vendor/README.md` を書く**

Run（実行1・この 1 行で 1 コマンド・ネットワークに出る＝読み取りのみ）:
```
python3 scripts/fetch_vendor.py
```
Expected: `saved vendor/…` が 14 行（js 2＋deck 5＋license 2＋OFL 2＋woff2 2＋fonts.css 1）、末尾に
`wrote tests/vendor.sha256 (14 files)` と `done.`。実測サイズの目安＝`maplibre-gl-5.24.0.js` 1,056,837 /
`maplibre-gl-5.24.0.css` 70,024 / core 664,201 / layers 162,467 / mapbox 10,518 / mesh-layers 278,594 /
geo-layers 558,169 バイト。

Run（実行2・この 1 行で 1 コマンド・取得せず突合するだけ）:
```
python3 scripts/fetch_vendor.py --check
```
Expected: `OK: vendor 14 ファイルが tests/vendor.sha256 と一致`

続けて `vendor/README.md` を新規作成（全文）:

````markdown
# vendor/ — 外部ライブラリの自前配信（手で触らない）

ここのファイルは **`scripts/fetch_vendor.py` が上流から取得したバイトそのもの**です。
手で編集しないでください（`tests/test_vendor_integrity.py` が `tests/vendor.sha256` と突合して落ちます）。
厳格 CSP（`script-src 'self'; style-src 'self'; font-src 'self'`）を満たすため、
外部 CDN への `<script>` / `<link>` は **1 本も置きません**。

取得日: 2026-09-03

## 中身と上流

| ファイル | 上流 | ライセンス |
|---|---|---|
| `maplibre-gl-5.24.0.js` | `https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js` | BSD-3-Clause（`LICENSE-maplibre-gl.txt`） |
| `maplibre-gl-5.24.0.css` | `https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css` | 同上 |
| `deck.gl-core-9.3.4.min.js` | `https://unpkg.com/@deck.gl/core@9.3.4/dist.min.js` | MIT（`LICENSE-deck.gl.txt`） |
| `deck.gl-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/layers@9.3.4/dist.min.js` | 同上 |
| `deck.gl-mapbox-9.3.4.min.js` | `https://unpkg.com/@deck.gl/mapbox@9.3.4/dist.min.js` | 同上 |
| `deck.gl-mesh-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/mesh-layers@9.3.4/dist.min.js` | 同上 |
| `deck.gl-geo-layers-9.3.4.min.js` | `https://unpkg.com/@deck.gl/geo-layers@9.3.4/dist.min.js` | 同上 |
| `fonts/orbitron-latin.woff2` | `https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Saira:wght@400;500;600;700&display=swap` の `/* latin */` ブロック | SIL OFL 1.1（`fonts/OFL-Orbitron.txt`） |
| `fonts/saira-latin.woff2` | 同上 | SIL OFL 1.1（`fonts/OFL-Saira.txt`） |
| `fonts/fonts.css` | 上記 css2 応答から `scripts/fetch_vendor.py` が生成（`src` をローカル相対に書き換え） | — |

Google css2 は **Chrome の UA で取得すると可変フォントの woff2** を返す（latin は 1 家族 1 ファイル）。
`unicode-range` は css2 の latin ブロックの値をそのまま写している。

## 読み込み順（重要・壊れ方が分かりにくい）

deck.gl 9.x の分割 UMD は 5 本とも `window.deck` に**マージ**される。依存があるので順序を守る:

1. `deck.gl-core` → 2. `deck.gl-layers` → 3. `deck.gl-mapbox`（ここまで `index.html` の `<script defer>`）
4. `deck.gl-mesh-layers` → 5. `deck.gl-geo-layers`（`js/lib/vendor-loader.js` が『交通』で遅延ロード）

`geo-layers` を `mesh-layers` より先に読むと `Class extends value undefined` で死ぬ（2026-09-03 Chromium 実測）。
起動時は 1〜3 の 238KB gzip だけ（全部入りは 460KB・geo 系は +237KB）。

## 再取得・版上げ

実行1（1 回だけ・リポジトリ直下で・上流から取り直して sha256 を作り直す）
```
python3 scripts/fetch_vendor.py
```

実行2（1 回だけ・取得せず固定値と突合するだけ）
```
python3 scripts/fetch_vendor.py --check
```

版を上げるときは `scripts/fetch_vendor.py` の `MAPLIBRE_VERSION` / `DECK_VERSION` と、
`index.html`・`js/lib/vendor-loader.js`・`tests/test_vendor_integrity.py` の **ファイル名**、
`vendor/README.md` のこの表をまとめて直す。`vercel.json` の `/vendor/(.*)` は
`max-age=31536000, immutable` なので **ファイル名に版を含めること**が必須。
````

- [ ] **Step 5: `index.html` の head を差し替える** — 置換前の 8 行（12〜19 行）→ 置換後の 10 行

置換前（全文）:
```html
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" />
  <!-- display フォント（タイトル/見出し/ワードマーク・body.font-on で適用）。?font=off で system-ui。 -->
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=Saira:wght@400;500;600;700&display=swap" />
  <link rel="stylesheet" href="css/orbis.css" />
  <script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
  <script src="https://unpkg.com/deck.gl@9.3.4/dist.min.js"></script>
```

置換後（全文）:
```html
  <!-- 実データの取得先だけ先に握る（タイル＝OpenFreeMap／スナップショット＝GitHub raw）。 -->
  <link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin />
  <link rel="preconnect" href="https://raw.githubusercontent.com" crossorigin />
  <link rel="stylesheet" href="vendor/maplibre-gl-5.24.0.css" />
  <!-- display フォント（タイトル/見出し/ワードマーク・body.font-on で適用）。?font=off で system-ui。
       自前配信＝vendor/fonts（厳格 CSP の font-src 'self' / style-src 'self' を満たす）。 -->
  <link rel="stylesheet" href="vendor/fonts/fonts.css" />
  <link rel="stylesheet" href="css/orbis.css" />
  <!-- deck.gl 9.x の分割 UMD は window.deck にマージされる。core→layers→mapbox の順が必須。
       mesh-layers / geo-layers（TripsLayer）は js/lib/vendor-loader.js が『交通』で遅延ロードする。
       defer なので末尾の module script より先に、文書順で実行される。 -->
  <script defer src="vendor/maplibre-gl-5.24.0.js"></script>
  <script defer src="vendor/deck.gl-core-9.3.4.min.js"></script>
  <script defer src="vendor/deck.gl-layers-9.3.4.min.js"></script>
  <script defer src="vendor/deck.gl-mapbox-9.3.4.min.js"></script>
```

- [ ] **Step 6: `js/main.js` に `?e2e=1` フックを足す** — 置換前 1 行（407 行）→ 置換後 7 行

置換前（全文）:
```javascript
  window.__orbis = { map, overlay, counts: {} };
```

置換後（全文）:
```javascript
  window.__orbis = { map, overlay, counts: {} };
  // e2e 能力アサート用フック（設計 §3.2・§4-4）。`window.__orbis` 自体は module 内の状態バスで
  // rebuild/refreshFeed/refreshSources が無条件に参照する＝「?e2e=1 の時だけ生やす」ことはできない。
  // 代わりに ?e2e=1 の時だけ e2e 専用の面を開く（通常導線では undefined＝外から掴む口を増やさない）。
  if (new URLSearchParams(location.search).get('e2e') === '1') {
    window.__orbis.e2e = { map, overlay };
  }
```

- [ ] **Step 7: 通ることを確認**

Run（実行1・この Task で足したテストだけ）:
```
python3 -m pytest tests/test_vendor_integrity.py -q
```
Expected: PASS（`27 passed`＝14 の parametrize＋3 の CDN marker＋単発 10）

Run（実行2・全体が赤くなっていないこと）:
```
python3 -m pytest -q
```
Expected: PASS（`failed` 0。合計数は Task 1〜3 が足したテストの分だけ 417＋α＋27 になる）

Run（実行3）:
```
node --test tests/*.test.js
```
Expected: PASS（`pass 643 / fail 0`＝ベースラインのまま。head の差し替えは JS ユニットに影響しない）

Run（実行4）:
```
python3 scripts/fetch_vendor.py --check
```
Expected: `OK: vendor 14 ファイルが tests/vendor.sha256 と一致`

- [ ] **Step 8: コミット**

Run（実行1・この 1 行で 1 コマンド）:
```
git add scripts/fetch_vendor.py vendor tests/vendor.sha256 tests/test_vendor_integrity.py index.html js/main.js
```

Run（実行2・この 1 行で 1 コマンド。ヒアドキュメントの `EOF` までが 1 実行）:
```
git commit -F - <<'EOF'
feat(vendor): 外部ライブラリを自前配信に切替（A2・sha256 固定）

- scripts/fetch_vendor.py（標準ライブラリのみ）で unpkg の maplibre-gl 5.24.0 と
  deck.gl 9.3.4 の分割 UMD 5 本、Google css2 の latin woff2 2 本、ライセンス 4 通を取得
- vendor/fonts/fonts.css を css2 応答から生成（src をローカル相対・font-display: swap）
- tests/vendor.sha256（sha256sum 互換）で 14 ファイルのバイトを固定し --check で再検証
- index.html の head から unpkg 2 本と Google Fonts 3 行を撤去し vendor 参照へ。
  deck は core→layers→mapbox の順の <script defer>（mesh/geo は Task 5 で遅延ロード）
- preconnect は実データ取得先（tiles.openfreemap.org / raw.githubusercontent.com）だけに
- js/main.js に ?e2e=1 のときだけ window.__orbis.e2e を開くフックを追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
```

---

### Task 5: A2 `js/lib/vendor-loader.js`＋テスト＋main.js の TripsLayer ガード

**Files:**
- Create: `js/lib/vendor-loader.js`
- Create: `tests/vendor_loader.test.js`
- Modify: `js/main.js`（42 行の直後に import 追加／166 行付近に `tripsLoading` 追加／167〜184 行の `tradeFlowLayer()`／306 行の呼び出し）
- Test: `tests/vendor_loader.test.js`

**Interfaces:**
- Consumes: `vendor/deck.gl-mesh-layers-9.3.4.min.js`・`vendor/deck.gl-geo-layers-9.3.4.min.js`（Task 4）／`js/main.js` の `rebuild(overlay)`。
- Produces（骨格 Interfaces のまま）:
  - `export const LAZY_VENDOR = ['vendor/deck.gl-mesh-layers-9.3.4.min.js', 'vendor/deck.gl-geo-layers-9.3.4.min.js']`
  - `export function ensureTripsLayer({ doc = document, root = globalThis } = {}) -> Promise<void>`
  - `export function _resetVendorLoaderForTests() -> void`

---

- [ ] **Step 1: 失敗するテストを書く** — `tests/vendor_loader.test.js` を新規作成（全文）

```javascript
// tests/vendor_loader.test.js
// TripsLayer（@deck.gl/geo-layers）の遅延ロード（設計 §3.2 / A2）。
// 実 DOM もネットワークも使わず、fake document（createElement/head.appendChild を記録し
// onload/onerror を手で発火）と fake root（globalThis.deck の有無）だけで契約を固定する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAZY_VENDOR, ensureTripsLayer, _resetVendorLoaderForTests } from '../js/lib/vendor-loader.js';

// マイクロタスクを全部流す（Promise の adopt を跨ぐので tick 数を数えない）。
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeDoc() {
  const created = [];
  const appended = [];
  return {
    created,
    appended,
    createElement(tag) {
      const el = { tagName: String(tag).toUpperCase(), src: '', async: true, defer: false, onload: null, onerror: null };
      created.push(el);
      return el;
    },
    head: { appendChild(el) { appended.push(el); return el; } },
  };
}

test('LAZY_VENDOR は mesh-layers → geo-layers の順（geo 単体は Class extends undefined で死ぬ）', () => {
  assert.deepEqual(LAZY_VENDOR, [
    'vendor/deck.gl-mesh-layers-9.3.4.min.js',
    'vendor/deck.gl-geo-layers-9.3.4.min.js',
  ]);
});

test('既に deck.TripsLayer があれば script を 1 本も注入しない', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = { deck: { TripsLayer: function TripsLayer() {} } };
  await ensureTripsLayer({ doc, root });
  assert.equal(doc.created.length, 0);
  assert.equal(doc.appended.length, 0);
});

test('2 本を順に注入する（1 本目の onload が来てから 2 本目）', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  let done = false;
  const p = ensureTripsLayer({ doc, root }).then(() => { done = true; });

  await flush();
  assert.equal(doc.created.length, 1, '最初は 1 本目だけ');
  assert.equal(doc.created[0].src, LAZY_VENDOR[0]);
  assert.equal(doc.created[0].async, false, '実行順を保つため async=false');
  assert.equal(doc.appended.length, 1, 'head に追加されている');
  assert.equal(done, false);

  doc.created[0].onload();
  await flush();
  assert.equal(doc.created.length, 2, '1 本目の onload 後に 2 本目');
  assert.equal(doc.created[1].src, LAZY_VENDOR[1]);
  assert.equal(done, false);

  doc.created[1].onload();
  await p;
  assert.equal(done, true);
  assert.equal(doc.created.length, 2, '余計に注入しない');
});

test('二重呼び出しは同一 Promise を返す（rAF から毎フレーム呼ばれても 1 回だけ）', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const a = ensureTripsLayer({ doc, root });
  const b = ensureTripsLayer({ doc, root });
  assert.equal(a, b);
  await flush();
  assert.equal(doc.created.length, 1);
  doc.created[0].onload();
  await flush();
  doc.created[1].onload();
  await a;
  assert.equal(doc.created.length, 2);
});

test('onerror で reject し、その後は再試行できる', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const p = ensureTripsLayer({ doc, root });
  await flush();
  doc.created[0].onerror();
  await assert.rejects(p, /vendor script load failed/);

  // 失敗した Promise はキャッシュに残さない＝次の呼び出しで新しく注入し直せる。
  const doc2 = makeDoc();
  const p2 = ensureTripsLayer({ doc: doc2, root });
  assert.notEqual(p, p2);
  await flush();
  assert.equal(doc2.created.length, 1);
  assert.equal(doc2.created[0].src, LAZY_VENDOR[0]);
  doc2.created[0].onload();
  await flush();
  doc2.created[1].onload();
  await p2;
});

test('_resetVendorLoaderForTests で保持中の Promise を捨てられる', async () => {
  _resetVendorLoaderForTests();
  const doc = makeDoc();
  const root = {};
  const a = ensureTripsLayer({ doc, root });
  _resetVendorLoaderForTests();
  const b = ensureTripsLayer({ doc, root });
  assert.notEqual(a, b);
  await flush();
  assert.equal(doc.created.length, 2, 'reset 後は別系列として 1 本目を注入し直す');
});
```

- [ ] **Step 2: 失敗を確認**

Run（実行1）:
```
node --test tests/vendor_loader.test.js
```
Expected: 失敗。`Cannot find module '.../js/lib/vendor-loader.js'`（`ERR_MODULE_NOT_FOUND`）で全 6 テストが fail。

- [ ] **Step 3: 最小実装** — `js/lib/vendor-loader.js` を新規作成（全文）

```javascript
// deck.gl の重い分割 UMD を「使う時だけ」読む遅延ローダ（設計 §3.2 / A2）。
// 起動時に読むのは core→layers→mapbox の 238KB gzip だけ。TripsLayer（貿易フロー）は
// @deck.gl/geo-layers にあり、geo-layers 単体では `Class extends value undefined` で死ぬので
// mesh-layers → geo-layers の順に 1 本ずつ（前の onload を待って）注入する（2026-09-03 Chromium 実測）。
// UMD は window.deck にマージされるので、読み終われば deck.TripsLayer がそのまま生える。

export const LAZY_VENDOR = [
  'vendor/deck.gl-mesh-layers-9.3.4.min.js',
  'vendor/deck.gl-geo-layers-9.3.4.min.js',
];

// 進行中/完了済みのロードをモジュール内に 1 つだけ保持する（rAF から毎フレーム呼ばれても 1 回）。
let _pending = null;

function loadScript(doc, src) {
  return new Promise((resolve, reject) => {
    const el = doc.createElement('script');
    el.src = src;
    el.async = false; // 実行順を保つ（1 本ずつ待つので実際には効かないが意図を残す）
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`vendor script load failed: ${src}`));
    doc.head.appendChild(el);
  });
}

// doc/root は差し替え可能（テストは fake document と fake globalThis を渡す）。
export function ensureTripsLayer({ doc = document, root = globalThis } = {}) {
  if (root && root.deck && typeof root.deck.TripsLayer === 'function') return Promise.resolve();
  if (_pending) return _pending;
  _pending = LAZY_VENDOR
    .reduce((chain, src) => chain.then(() => loadScript(doc, src)), Promise.resolve())
    .catch((err) => { _pending = null; throw err; }); // 失敗は握らない＝呼び出し側で再試行できる
  return _pending;
}

// テスト用。モジュール内に持つ Promise を捨てて初期状態へ戻す。
export function _resetVendorLoaderForTests() {
  _pending = null;
}
```

- [ ] **Step 4: 通ることを確認（ローダ単体）**

Run（実行1）:
```
node --test tests/vendor_loader.test.js
```
Expected: PASS（`pass 6 / fail 0`）

- [ ] **Step 5: `js/main.js` に import と読み込み中フラグを足す** — 2 箇所の置換

置換1・置換前（全文・42 行）:
```javascript
import { makeWatchlistStore, addCode, removeCode, joinWatchCountries } from './lib/drilldown/watchlist.js';
```
置換1・置換後（全文）:
```javascript
import { makeWatchlistStore, addCode, removeCode, joinWatchCountries } from './lib/drilldown/watchlist.js';
import { ensureTripsLayer } from './lib/vendor-loader.js';
```

置換2・置換前（全文・166 行）:
```javascript
let tradeTrips = null;
```
置換2・置換後（全文）:
```javascript
let tradeTrips = null;
let tripsLoading = false; // geo-layers 遅延ロードの二重起動ガード（drawAll は rAF から毎フレーム走る）
```

- [ ] **Step 6: TripsLayer builder にガードを入れる** — `tradeFlowLayer` の宣言〜`return new deck.TripsLayer({`（167〜176 行の 10 行）をまるごと置換

置換前（全文・167〜176 行）:
```javascript
function tradeFlowLayer() {
  const geo = snapshots.trade;
  if (!geo || !geo.features || REDUCED) return null;
  if (!tradeTrips) {
    tradeTrips = geo.features
      .filter((f) => f.geometry && f.geometry.type === 'LineString')
      .map((f) => ({ path: f.geometry.coordinates, timestamps: normalizedTimestamps(f.geometry.coordinates) }));
  }
  if (tradeTrips.length === 0) return null;
  return new deck.TripsLayer({
```

置換後（全文）:
```javascript
function tradeFlowLayer(overlay) {
  const geo = snapshots.trade;
  if (!geo || !geo.features || REDUCED) return null;
  if (!tradeTrips) {
    tradeTrips = geo.features
      .filter((f) => f.geometry && f.geometry.type === 'LineString')
      .map((f) => ({ path: f.geometry.coordinates, timestamps: normalizedTimestamps(f.geometry.coordinates) }));
  }
  if (tradeTrips.length === 0) return null;
  // TripsLayer は @deck.gl/geo-layers（mesh-layers 依存）＝『交通』を開いた時だけ遅延ロードする（A2）。
  // 未ロードなら 1 回だけ注入を起動し、この回は null（trade-flow 抜き）で描く。完了後の rebuild で出る。
  // 失敗しても再試行しない（drawAll は rAF から毎フレーム走るので再試行の嵐になる）。
  if (typeof deck.TripsLayer !== 'function') {
    if (!tripsLoading) {
      tripsLoading = true;
      ensureTripsLayer().then(() => rebuild(overlay)).catch(() => {});
    }
    return null;
  }
  return new deck.TripsLayer({
```

- [ ] **Step 7: 呼び出し側に overlay を渡す** — 置換前 1 行（306 行）→ 置換後 1 行

置換前（全文）:
```javascript
  if (ENABLED.has('trade')) { const fp = tradeFlowLayer(); if (fp) extra.push(fp); }
```
置換後（全文）:
```javascript
  if (ENABLED.has('trade')) { const fp = tradeFlowLayer(overlay); if (fp) extra.push(fp); }
```

- [ ] **Step 8: 通ることを確認**

Run（実行1）:
```
node --test tests/*.test.js
```
Expected: PASS（`pass 649 / fail 0`＝ベースライン 643＋6）

Run（実行2）:
```
python3 -m pytest -q
```
Expected: PASS（`failed` 0。Task 4 終了時と同じ数＝JS 変更は pytest に影響しない）

- [ ] **Step 9: コミット**

Run（実行1・この 1 行で 1 コマンド）:
```
git add js/lib/vendor-loader.js tests/vendor_loader.test.js js/main.js
```

Run（実行2・この 1 行で 1 コマンド。ヒアドキュメントの `EOF` までが 1 実行）:
```
git commit -F - <<'EOF'
feat(vendor): TripsLayer を mesh→geo の 2 本で遅延ロード（A2）

- js/lib/vendor-loader.js: ensureTripsLayer() が deck.TripsLayer 未定義のときだけ
  mesh-layers → geo-layers の順に <script> を 1 本ずつ注入（前の onload を待つ）。
  Promise はモジュール内に 1 つだけ保持し、reject 時は捨てて再試行できるようにする
- js/main.js: 貿易フロー builder は未ロードなら 1 回だけ注入を起動して null を返し、
  完了後の rebuild(overlay) で軌跡アニメを出す（二重起動は tripsLoading で防ぐ）
- 起動時の deck は core+layers+mapbox の 238KB gzip だけ（geo 系 237KB を初期から外す）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
```

---

### Task 6: A5 `js/lib/data-style.js`＋テスト＋21 箇所置換＋`showPopup`＋index.html 静的 2 件＋ちらつき防止 CSS＋`test_static_guards.py`

**Files:**
- Create: `js/lib/data-style.js`
- Create: `tests/data-style.test.js`
- Create: `tests/test_static_guards.py`
- Modify: `js/lib/selection.js`（43・61・154・170・174・194・197・212）／`js/lib/drilldown/drilldown_view.js`（82）／`js/ui/feed.js`（1〜3 の import・15・20・21・26 の直後・47・49 の直後）／`js/ui/forecast.js`（1 の直後・36 の直後・51・59・63）／`js/ui/instability.js`（1 の直後・61・64・86 の直後）／`js/ui/legend.js`（45 の直後・17・22・59 の直後）／`js/ui/panel.js`（5 の直後・15 の直後・59）／`js/ui/drilldown.js`（5 の直後・22 の直後・42・108 の直後）／`js/main.js`（42 の直後・92 の直後に `showPopup`・159/369/377/387/397/502/574・`boot()` 先頭）／`index.html`（94・133）／`css/orbis.css`（末尾に追記）
- Test: `tests/data-style.test.js`・`tests/test_static_guards.py`

**Interfaces:**
- Consumes: なし（新規モジュール）。`js/main.js` は `selPopup.getElement()`（MapLibre `Popup#getElement`）と `window.__orbis.map` を使う。
- Produces（骨格 Interfaces のまま）:
  - `js/lib/data-style.js`：`export function applyDataStyles(root) -> number`。`root` が Element で `data-style` を持てば自身にも適用。`root.querySelectorAll('[data-style]')` の各要素に `el.style.cssText = el.getAttribute('data-style')` → `el.removeAttribute('data-style')`。戻り値＝適用した要素数。`root` が null/undefined なら 0。
  - `js/main.js`：`function showPopup(lngLat, html)`＝`selPopup.setLngLat(lngLat).setHTML(html).addTo(map); applyDataStyles(selPopup.getElement());`

**`getTooltip` の判定（spec §3.5「実装時に main.js の getTooltip を確認・含まなければ不要」）: `.deck-tooltip` の MutationObserver は不要。**
根拠＝`js/main.js:344-359` の `getTooltip` は 3 経路とも**プレーン文字列**を返す（`気温 25°C｜…`／`水温 …`／`tooltipFor(...)`）。`tooltipFor`（`js/layers/registry.js:63-66`）が委譲する各層の `tooltip()` は `ships.js:53-60`（`shipTooltip`）・`currents.js:143`・`protests.js:65`・`firms.js:101`・`quakes.js:39`・`conflict.js:66`・`flights.js:67`・`trade.js:63`・`news.js:22` の 9 実装＋`sst.js:127`／`airtemp.js:115`（`null`）で、**いずれもタグを 1 つも含まない**（実測 grep で `js/layers/**` に `style="` は 0 件）。deck.gl は文字列の戻り値を `text` として扱う＝`.deck-tooltip` に HTML は入らない。ツールチップ要素自身の見た目は deck.gl が `element.style.*`（CSSOM）で当てるので CSP 対象外（RED 計測でも deck 由来の style 違反 0）。**将来の退行は本 Task が入れる「`js/**` に `style="` を書かない」静的ガードが捕まえる**ので、Observer は足さない。

---

- [ ] **Step 1: 失敗するテストを書く（data-style 単体）** — `tests/data-style.test.js` を新規作成（全文）

```javascript
// tests/data-style.test.js
// 厳格 CSP（style-src 'self'）下の唯一のスタイル注入口 applyDataStyles(root)（設計 §3.5 / A5）。
// 実 DOM を使わず、querySelectorAll / getAttribute / removeAttribute / style.cssText だけを持つ
// 最小オブジェクトで契約を固定する（repo 既存の DOM スタブ idiom＝tests/drilldown_render.test.js に倣う）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDataStyles } from '../js/lib/data-style.js';

function makeEl(attrs = {}) {
  const bag = { ...attrs };
  return {
    style: { cssText: '' },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(bag, name) ? bag[name] : null;
    },
    removeAttribute(name) { delete bag[name]; },
    hasAttr(name) { return Object.prototype.hasOwnProperty.call(bag, name); },
  };
}

// children は「今 data-style を持っている子」を毎回数え直す（属性除去が効いているか見るため）。
function makeRoot(children, selfAttrs = null) {
  const root = selfAttrs ? makeEl(selfAttrs) : {};
  root.querySelectorAll = (sel) => {
    assert.equal(sel, '[data-style]', 'セレクタは [data-style] 固定');
    return children.filter((c) => c.getAttribute('data-style') != null);
  };
  return root;
}

test('配下の [data-style] を cssText に流して属性を外す', () => {
  const a = makeEl({ 'data-style': '--chip:rgb(1,2,3)' });
  const b = makeEl({ 'data-style': 'width:42%' });
  const root = makeRoot([a, b]);
  assert.equal(applyDataStyles(root), 2);
  assert.equal(a.style.cssText, '--chip:rgb(1,2,3)');
  assert.equal(b.style.cssText, 'width:42%');
  assert.equal(a.hasAttr('data-style'), false);
  assert.equal(b.hasAttr('data-style'), false);
});

test('root 自身が data-style を持つ場合は自身にも適用する', () => {
  const child = makeEl({ 'data-style': 'color:#7fd8ff' });
  const root = makeRoot([child], { 'data-style': 'display:none' });
  assert.equal(applyDataStyles(root), 2);
  assert.equal(root.style.cssText, 'display:none');
  assert.equal(root.hasAttr('data-style'), false);
  assert.equal(child.style.cssText, 'color:#7fd8ff');
});

test('二重に呼んでも二度目は 0 件（属性が消えている＝冪等）', () => {
  const a = makeEl({ 'data-style': 'opacity:.7' });
  const root = makeRoot([a]);
  assert.equal(applyDataStyles(root), 1);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(a.style.cssText, 'opacity:.7', '既に当てた値は消さない');
});

test('data-style を持たない要素は cssText を触らない', () => {
  const plain = makeEl({ class: 'feed-row' });
  const root = makeRoot([plain]);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(plain.style.cssText, '');
});

test('空文字の data-style は無視する（cssText を空で上書きしない）', () => {
  const a = makeEl({ 'data-style': '' });
  a.style.cssText = 'color:red';
  const root = makeRoot([a]);
  assert.equal(applyDataStyles(root), 0);
  assert.equal(a.style.cssText, 'color:red');
});

test('root が null / undefined なら 0（例外を投げない）', () => {
  assert.equal(applyDataStyles(null), 0);
  assert.equal(applyDataStyles(undefined), 0);
});

test('querySelectorAll を持たない root（document 断片の代用）でも自身だけ処理する', () => {
  const only = makeEl({ 'data-style': 'display:none' });
  assert.equal(applyDataStyles(only), 1);
  assert.equal(only.style.cssText, 'display:none');
});
```

- [ ] **Step 2: 失敗を確認**

Run（実行1）:
```
node --test tests/data-style.test.js
```
Expected: 失敗。`Cannot find module '.../js/lib/data-style.js'`（`ERR_MODULE_NOT_FOUND`）で全 7 テストが fail。

- [ ] **Step 3: 最小実装** — `js/lib/data-style.js` を新規作成（全文）

```javascript
// 厳格 CSP（style-src 'self'）下で動的スタイルを当てる唯一の口（設計 §3.5 / A5）。
// テンプレートは style 属性ではなく data-style 属性を書き、innerHTML / insertAdjacentHTML の
// 直後にこれを呼ぶ。CSSOM 代入（el.style.cssText）は CSP の対象外＝インライン style 属性の
// パースを経ないので違反にならない。
//
// 注: このファイル自身も静的ガード（tests/test_static_guards.py）の対象なので、
// コードにもコメントにも「属性名＋等号＋引用符」の並びを書かない（属性名は ATTR 定数だけに持つ）。
//
// 属性は当てた直後に外す。理由＝`el.style.display = ''` のリセット型トグル
// （ui/alerts.js:78 の #alerts、ui/cams-pane.js:103-104 の #cams-one-tabs）を壊さないため。
// クラスで display:none を持たせると style.display='' がクラスに勝てず二度と開かない。
const ATTR = 'data-style';

function applyOne(el) {
  if (!el || typeof el.getAttribute !== 'function') return 0;
  const value = el.getAttribute(ATTR);
  if (!value) return 0;
  if (el.style) el.style.cssText = value;
  if (typeof el.removeAttribute === 'function') el.removeAttribute(ATTR);
  return 1;
}

// root（Element / Document）配下の [data-style] と root 自身に適用し、適用した要素数を返す。
export function applyDataStyles(root) {
  if (!root) return 0;
  let applied = 0;
  if (typeof root.querySelectorAll === 'function') {
    for (const el of Array.from(root.querySelectorAll(`[${ATTR}]`))) applied += applyOne(el);
  }
  applied += applyOne(root); // Document は getAttribute を持たないので 0
  return applied;
}
```

- [ ] **Step 4: 通ることを確認（data-style 単体）**

Run（実行1）:
```
node --test tests/data-style.test.js
```
Expected: PASS（`pass 7 / fail 0`）

- [ ] **Step 5: 失敗する静的ガードを書く** — `tests/test_static_guards.py` を新規作成（全文）

```python
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


def test_main_js_popup_goes_through_helper():
    """maplibre Popup は showPopup() に集約し、素の setHTML(...).addTo(map) を残さない。"""
    src = read("js/main.js")
    assert "function showPopup(lngLat, html)" in src
    assert "applyDataStyles(selPopup.getElement());" in src
    assert "setHTML(" not in src.replace(
        "selPopup.setLngLat(lngLat).setHTML(html).addTo(map);", ""
    ), "showPopup を通さない setHTML が残っている"
    assert src.count("showPopup(") == 8, "showPopup の定義 1＋呼び出し 7 箇所"


def test_flicker_guard_css_exists():
    """applyDataStyles が走るまでの 1 フレームを CSS で塞ぐ（設計 §3.5）。"""
    css = read("css/orbis.css")
    assert re.search(
        r"#alerts\[data-style\]\s*,\s*#cams-one-tabs\[data-style\]\s*\{[^}]*display:\s*none",
        css,
    ), "ちらつき防止の #alerts[data-style],#cams-one-tabs[data-style]{display:none} が無い"


@pytest.mark.xfail(
    strict=True,
    reason="Task 9 の `git rm --cached` まで .superpowers/sdd/cluster-C{4,7}-report.md が追跡されている。"
           "解消したらこの xfail マーカーを外す（strict=True なので XPASS は失敗になる）",
)
def test_no_tracked_agent_workdirs():
    out = subprocess.run(
        ["git", "ls-files", ".superpowers", ".claude", ".claire"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert out == "", f"追跡されている作業ディレクトリのファイル:\n{out}"
```

- [ ] **Step 6: 失敗を確認**

Run（実行1）:
```
python3 -m pytest tests/test_static_guards.py -q
```
Expected: 失敗。主な赤＝
`test_own_js_has_no_inline_patterns[js/lib/selection.js]` → `AssertionError: js/lib/selection.js: style= をテンプレートに持つ（data-style= にする）`（同種で drilldown_view.js・feed.js・forecast.js・instability.js・legend.js・panel.js の計 7 件）、
`test_page_has_no_inline_style_or_handlers[index.html]` → `AssertionError: index.html: style= が残っている（data-style= にする）`、
`test_index_static_data_styles_are_pinned` → `assert [] == ['display:none', 'display:none']`、
`test_apply_sites_are_pinned[...]` 7 件 → `applyDataStyles を import していない`、
`test_main_js_popup_goes_through_helper` → `assert 'function showPopup(lngLat, html)' in src`、
`test_flicker_guard_css_exists` → `ちらつき防止の … が無い`。
`test_no_tracked_agent_workdirs` は **xfail（`x`）** で赤にならない（Task 9 で解消したら XPASS＝失敗になるのでマーカーを外す）。

- [ ] **Step 7: `js/lib` の純ビルダ 9 箇所を置換（selection.js 8＋drilldown_view.js 1）**

**7-a. `js/lib/selection.js`（43/61/154/170/194/212 の 6 行は完全一致）** — `Edit` を `replace_all: true` で 1 回。

置換前（全文・6 箇所で一致）:
```javascript
    + `<div class="sel-top"><span class="sel-dot" style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
```
置換後（全文）:
```javascript
    + `<div class="sel-top"><span class="sel-dot" data-style="background:${dot};box-shadow:0 0 8px ${dot}"></span>`
```

**7-b. `js/lib/selection.js`（174/197 の 2 行は完全一致）** — `Edit` を `replace_all: true` で 1 回。

置換前（全文・2 箇所で一致）:
```javascript
    + `<div class="sel-hint"><a class="sel-link" style="color:#7fd8ff" href="${escapeHtml(safeUrl)}"`
```
置換後（全文）:
```javascript
    + `<div class="sel-hint"><a class="sel-link" data-style="color:#7fd8ff" href="${escapeHtml(safeUrl)}"`
```

**7-c. `js/lib/drilldown/drilldown_view.js`（82）**

置換前（全文）:
```javascript
  return `<div class="dd-header" data-lvl="${escapeHtml(lvl)}" data-arrow="${escapeHtml(arrow)}" style="--dd-lvl:${col}">`
```
置換後（全文）:
```javascript
  return `<div class="dd-header" data-lvl="${escapeHtml(lvl)}" data-arrow="${escapeHtml(arrow)}" data-style="--dd-lvl:${col}">`
```

- [ ] **Step 8: `js/ui` の 12 箇所を置換（feed 4／forecast 3／instability 2／legend 2／panel 1）**

**8-a. `js/ui/feed.js:15`**
置換前:
```javascript
      ? `<span class="feed-count" style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
```
置換後:
```javascript
      ? `<span class="feed-count" data-style="--barw:${countBarPct(it.count, maxCount)}%">${Number(it.count) || 0}件</span>`
```

**8-b. `js/ui/feed.js:20`**
置換前:
```javascript
      : `<span class="feed-dot" style="color:${c};background:${c}"></span>`;
```
置換後:
```javascript
      : `<span class="feed-dot" data-style="color:${c};background:${c}"></span>`;
```

**8-c. `js/ui/feed.js:21`**
置換前:
```javascript
    return `<div class="feed-row" data-i="${i}" style="--rowcat:${c}">
```
置換後:
```javascript
    return `<div class="feed-row" data-i="${i}" data-style="--rowcat:${c}">
```

**8-d. `js/ui/feed.js:47`**
置換前:
```javascript
      return `<button class="feed-chip${on ? ' active' : ''}" data-chip="${id}" style="--chip:${c}">${LABEL[id] || id}</button>`;
```
置換後:
```javascript
      return `<button class="feed-chip${on ? ' active' : ''}" data-chip="${id}" data-style="--chip:${c}">${LABEL[id] || id}</button>`;
```

**8-e. `js/ui/forecast.js:51`**
置換前:
```javascript
    return `<div class="fc-card fc-watch" style="--dom:${col}">`
```
置換後:
```javascript
    return `<div class="fc-card fc-watch" data-style="--dom:${col}">`
```

**8-f. `js/ui/forecast.js:59`**
置換前:
```javascript
  return `<div class="fc-card" style="--dom:${col};--lvl:${levelColor(c.attention_score)}">`
```
置換後:
```javascript
  return `<div class="fc-card" data-style="--dom:${col};--lvl:${levelColor(c.attention_score)}">`
```

**8-g. `js/ui/forecast.js:63`**
置換前:
```javascript
    +`<div class="fc-bar"><span class="fc-fill" style="width:${Math.max(0,Math.min(100,c.attention_score||0))}%"></span></div>`
```
置換後:
```javascript
    +`<div class="fc-bar"><span class="fc-fill" data-style="width:${Math.max(0,Math.min(100,c.attention_score||0))}%"></span></div>`
```

**8-h. `js/ui/instability.js:61`**
置換前:
```javascript
    `<div class="ins-row" style="--lvl:${col}">`
```
置換後:
```javascript
    `<div class="ins-row" data-style="--lvl:${col}">`
```

**8-i. `js/ui/instability.js:64`**
置換前:
```javascript
    + `<span class="ins-bar"><span class="ins-fill" style="width:${Math.max(0, Math.min(100, c.score || 0))}%"></span></span>`
```
置換後:
```javascript
    + `<span class="ins-bar"><span class="ins-fill" data-style="width:${Math.max(0, Math.min(100, c.score || 0))}%"></span></span>`
```

**8-j. `js/ui/legend.js:17`**
置換前:
```javascript
    `<div class="legend-tier"><span class="swatch swatch-${tierMarker}" style="color:${t.color}"></span>`
```
置換後:
```javascript
    `<div class="legend-tier"><span class="swatch swatch-${tierMarker}" data-style="color:${t.color}"></span>`
```

**8-k. `js/ui/legend.js:22`**
置換前:
```javascript
    + `<span class="swatch swatch-${lm.marker}" style="color:${lm.swatchColor}"></span>`
```
置換後:
```javascript
    + `<span class="swatch swatch-${lm.marker}" data-style="color:${lm.swatchColor}"></span>`
```

**8-l. `js/ui/panel.js:59`**
置換前:
```javascript
        <span class="swatch swatch-${marker}" style="color:${sw}"></span>
```
置換後:
```javascript
        <span class="swatch swatch-${marker}" data-style="color:${sw}"></span>
```

Run（実行1・置換漏れが無いことを確認する 1 コマンド。`-P` の lookbehind で `data-style="` を除外する
＝素の `grep 'style="'` だと `data-style="` にも当たって使えない）:
```
grep -rnP '(?<![\w-])style="' js/ --include=*.js
```
Expected: **出力なし**（exit 1）。21 箇所すべてが `data-style="` になっている。

- [ ] **Step 9: 各描画点に `applyDataStyles` を差す（import 6 本＋呼び出し 9 箇所）**

**9-a. `js/ui/feed.js` の import（3 行目の直後）**
置換前:
```javascript
import { countBarPct } from '../lib/feed.js';
```
置換後:
```javascript
import { countBarPct } from '../lib/feed.js';
import { applyDataStyles } from '../lib/data-style.js';
```

**9-b. `js/ui/feed.js` の `renderFeed`（26 行目の直後）**
置換前:
```javascript
  }).join('') || '<div class="feed-empty">イベントなし</div>';
```
置換後:
```javascript
  }).join('') || '<div class="feed-empty">イベントなし</div>';
  applyDataStyles(root); // 厳格 CSP: data-style を CSSOM へ（--rowcat / --barw / feed-dot の色）
```

**9-c. `js/ui/feed.js` の `renderChips`（49 行目）**
置換前:
```javascript
  root.innerHTML = html;
```
置換後:
```javascript
  root.innerHTML = html;
  applyDataStyles(root); // 厳格 CSP: チップの --chip を CSSOM へ
```

**9-d. `js/ui/forecast.js` の import（1 行目の直後）**
置換前:
```javascript
// AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
```
置換後:
```javascript
// AI FORECASTS UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM＋flyTo。
import { applyDataStyles } from '../lib/data-style.js';
```

**9-e. `js/ui/forecast.js:36`**
置換前:
```javascript
      el.innerHTML=cardHtml(c);
```
置換後:
```javascript
      el.innerHTML=cardHtml(c);
      applyDataStyles(el); // 厳格 CSP: --dom / --lvl / fc-fill の width を CSSOM へ
```

**9-f. `js/ui/instability.js` の import（1 行目の直後）**
置換前:
```javascript
// 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
```
置換後:
```javascript
// 国家不安定性インデックス UI（純粋ヘルパ＋描画）。globe レイヤーは作らず DOM セクション＋flyTo。
import { applyDataStyles } from '../lib/data-style.js';
```

**9-g. `js/ui/instability.js:86`**
置換前:
```javascript
    el.innerHTML = rowHtml(c);
```
置換後:
```javascript
    el.innerHTML = rowHtml(c);
    applyDataStyles(el); // 厳格 CSP: --lvl / ins-fill の width を CSSOM へ
```

**9-h. `js/ui/legend.js` の import（45 行目の直後）**
置換前:
```javascript
import { layers, descFor } from '../layers/registry.js';
```
置換後:
```javascript
import { layers, descFor } from '../layers/registry.js';
import { applyDataStyles } from '../lib/data-style.js';
```

**9-i. `js/ui/legend.js`（59 行目＝`insertAdjacentHTML` の直後）**
置換前:
```javascript
    <div class="legend-body" data-body="help" hidden>${helpHtml()}</div>`);
```
置換後:
```javascript
    <div class="legend-body" data-body="help" hidden>${helpHtml()}</div>`);
  applyDataStyles(rootEl); // 厳格 CSP: スウォッチの color を CSSOM へ
```

**9-j. `js/ui/panel.js` の import（5 行目の直後）**
置換前:
```javascript
import { groupLayers } from '../lib/categories.js';
```
置換後:
```javascript
import { groupLayers } from '../lib/categories.js';
import { applyDataStyles } from '../lib/data-style.js';
```

**9-k. `js/ui/panel.js`（15 行目＝`root.innerHTML` の直後）**
置換前:
```javascript
    </div>`).join('');
```
置換後:
```javascript
    </div>`).join('');
  applyDataStyles(root); // 厳格 CSP: スウォッチの color を CSSOM へ
```

**9-l. `js/ui/drilldown.js` の import（5 行目の直後）**
置換前:
```javascript
import { profileHtml } from '../lib/drilldown/profile_view.js';
```
置換後:
```javascript
import { profileHtml } from '../lib/drilldown/profile_view.js';
import { applyDataStyles } from '../lib/data-style.js';
```

**9-m. `js/ui/drilldown.js:22`（`mkRowButton`）**
置換前:
```javascript
  el.innerHTML = html;
```
置換後:
```javascript
  el.innerHTML = html;
  applyDataStyles(el); // 厳格 CSP: drilldown_view / instability の data-style を CSSOM へ
```

**9-n. `js/ui/drilldown.js:42`（ヘッダ）**
置換前:
```javascript
  if (titleEl) titleEl.innerHTML = drilldownHeaderHtml(header);
```
置換後:
```javascript
  if (titleEl) { titleEl.innerHTML = drilldownHeaderHtml(header); applyDataStyles(titleEl); }
```

**9-o. `js/ui/drilldown.js:108`（ウォッチリスト行）**
置換前:
```javascript
    btn.innerHTML = rowHtml(c);
```
置換後:
```javascript
    btn.innerHTML = rowHtml(c);
    applyDataStyles(btn); // 厳格 CSP: instability rowHtml の --lvl / width を CSSOM へ
```

- [ ] **Step 10: `js/main.js` に `showPopup` を入れ、7 箇所を置換し、boot で静的分を適用**

**10-a. import（42 行目の直後・Task 5 で足した vendor-loader の行と前後どちらでもよい）**
置換前:
```javascript
import { makeWatchlistStore, addCode, removeCode, joinWatchCountries } from './lib/drilldown/watchlist.js';
```
置換後:
```javascript
import { makeWatchlistStore, addCode, removeCode, joinWatchCountries } from './lib/drilldown/watchlist.js';
import { applyDataStyles } from './lib/data-style.js';
```

**10-b. `showPopup` ヘルパ（92 行目の直後・`updateFreshness` の説明コメントの前）**
置換前:
```javascript
const SHIP_PROJECT_MIN = 600; // 船は低速なので約10時間の長延長（12knで約222km先）。引きで到達ポインタが船首に重ならないように。
```
置換後:
```javascript
const SHIP_PROJECT_MIN = 600; // 船は低速なので約10時間の長延長（12knで約222km先）。引きで到達ポインタが船首に重ならないように。

// 着地点ポップアップの唯一の口（設計 §3.5 / A5）。selection.js のテンプレートは data-style を
// 吐くだけなので、setHTML で DOM になった直後に CSSOM へ流す。map は boot 後に必ず載る状態バスから取る。
function showPopup(lngLat, html) {
  const map = window.__orbis && window.__orbis.map;
  if (!selPopup || !map) return;
  selPopup.setLngLat(lngLat).setHTML(html).addTo(map);
  applyDataStyles(selPopup.getElement());
}
```

**10-c. 159 行（フィード行クリック）**
置換前:
```javascript
    if (selPopup) selPopup.setLngLat([it.lon, it.lat]).setHTML(html).addTo(map);
```
置換後:
```javascript
    showPopup([it.lon, it.lat], html);
```

**10-d. 369 行（航空機）**
置換前:
```javascript
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(flightPopupHtml(p, arrival, FLIGHT_PROJECT_MIN)).addTo(map);
```
置換後:
```javascript
        showPopup([p.lon, p.lat], flightPopupHtml(p, arrival, FLIGHT_PROJECT_MIN));
```

**10-e. 377 行（船舶）**
置換前:
```javascript
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(shipPopupHtml(p, arrival, SHIP_PROJECT_MIN)).addTo(map);
```
置換後:
```javascript
        showPopup([p.lon, p.lat], shipPopupHtml(p, arrival, SHIP_PROJECT_MIN));
```

**10-f. 387 行（ニュースピン）**
置換前:
```javascript
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(newsPopupHtml(p)).addTo(map);
```
置換後:
```javascript
        showPopup([p.lon, p.lat], newsPopupHtml(p));
```

**10-g. 397 行（紛争/抗議の個別点）**
置換前:
```javascript
        if (selPopup) selPopup.setLngLat([p.lon, p.lat]).setHTML(gdeltEventPopupHtml(p, info.layer.id)).addTo(map);
```
置換後:
```javascript
        showPopup([p.lon, p.lat], gdeltEventPopupHtml(p, info.layer.id));
```

**10-h. 502 行（ドリルダウンの行選択）**
置換前:
```javascript
          if (selPopup) selPopup.setLngLat([ev.lon, ev.lat]).setHTML(html).addTo(map);
```
置換後:
```javascript
          showPopup([ev.lon, ev.lat], html);
```

**10-i. 574 行（国検索）**
置換前:
```javascript
    if (selPopup) selPopup.setLngLat([country.lng, country.lat]).setHTML(`<div class="sel-title">${country.ja}</div>`).addTo(map);
```
置換後:
```javascript
    showPopup([country.lng, country.lat], `<div class="sel-title">${country.ja}</div>`);
```

**10-j. `boot()` の先頭（329-330 行）**
置換前:
```javascript
function boot() {
  const bootCtl = initBoot({ reduced: REDUCED });
```
置換後:
```javascript
function boot() {
  // index.html の静的 data-style（#alerts / #cams-one-tabs）を CSSOM へ流す（設計 §3.5 / A5）。
  // 以後の動的描画は各 innerHTML / insertAdjacentHTML 直後の applyDataStyles が受け持つ。
  applyDataStyles(document);
  const bootCtl = initBoot({ reduced: REDUCED });
```

Run（実行1・素の setHTML が残っていないことを確認する 1 コマンド）:
```
grep -n "setHTML\|selPopup" js/main.js
```
Expected: `setHTML` は `showPopup` の定義内の 1 行だけ。`selPopup` は **5 行**（宣言 1＝`let selPopup = null;`／
`showPopup` 内 3＝`if (!selPopup || !map) return;`・`selPopup.setLngLat(...)`・`applyDataStyles(selPopup.getElement());`／
生成 1＝`selPopup = new maplibregl.Popup({...})`）。7 箇所の `if (selPopup) selPopup.setLngLat(...)` は消えている。

- [ ] **Step 11: `index.html` の静的 2 件と `css/orbis.css` のちらつき防止**

**11-a. `index.html:94`**
置換前:
```html
      <section id="alerts" class="alerts-section" aria-label="急変アラート" style="display:none">
```
置換後:
```html
      <section id="alerts" class="alerts-section" aria-label="急変アラート" data-style="display:none">
```

**11-b. `index.html:133`**
置換前:
```html
          <div class="cams-one-tabs" id="cams-one-tabs" style="display:none"></div>
```
置換後:
```html
          <div class="cams-one-tabs" id="cams-one-tabs" data-style="display:none"></div>
```

**11-c. `css/orbis.css` 末尾に追記**（アンカー＝ファイル最終行の `}` 手前・`background-image: none; -webkit-mask: none; mask: none; padding: 0;` はファイル内で 1 回だけ出現）

置換前（全文・1725〜1731 行）:
```css
    /* オーロラオーバーレイの ::before を上書き — モバイルでは縁光を無効化 */
    background-image: none; -webkit-mask: none; mask: none; padding: 0;
    opacity: 1;
  }
}
```
置換後（全文）:
```css
    /* オーロラオーバーレイの ::before を上書き — モバイルでは縁光を無効化 */
    background-image: none; -webkit-mask: none; mask: none; padding: 0;
    opacity: 1;
  }
}

/* ===== 厳格 CSP（A5）: 静的 style="display:none" の data-style 化に伴うちらつき防止 =====
   applyDataStyles(document) は boot() で走る＝それまでの 1 フレームだけ属性が残る。
   属性がある間だけ隠し、適用後（属性が外れた後）は CSSOM の inline style が引き継ぐ。
   クラスで隠さない理由＝ui/alerts.js:78 と ui/cams-pane.js:103-104 が
   `el.style.display = ''` のリセット型で開閉するため（クラスだと二度と開かない）。 */
#alerts[data-style], #cams-one-tabs[data-style] { display: none; }
```

- [ ] **Step 12: 通ることを確認**

Run（実行1）:
```
node --test tests/*.test.js
```
Expected: PASS（`pass 656 / fail 0`＝Task 5 終了時 649＋data-style 7）

Run（実行2・この Task で足したガードだけ）:
```
python3 -m pytest tests/test_static_guards.py -q
```
Expected: PASS（参考＝`247 passed, 1 xfailed`。内訳＝ページ 6×4＋index 1＋`js/**/*.js` 71 本×3＋
APPLY_SITES 7＋単発 2＋xfail 1。`js/**/*.js` の本数が変われば数も動くので、見るのは
**`failed` 0 と `xpassed` 0**）。`test_no_tracked_agent_workdirs` は `x`（Task 9 で `git rm --cached`
したら XPASS＝失敗になるので、その時に xfail マーカーを外す）。

Run（実行3・全体が赤くなっていないこと）:
```
python3 -m pytest -q
```
Expected: PASS（`failed` 0・`xpassed` 0・`1 xfailed`）

Run（実行4・置換漏れの最終確認・この 1 行で 1 コマンド）:
```
grep -rnP '(?<![\w-])style="' js/ index.html --include=*.js --include=*.html
```
Expected: **出力なし**（exit 1）。`-P` の lookbehind が `data-style="` を除外する。

- [ ] **Step 13: コミット**

Run（実行1・この 1 行で 1 コマンド）:
```
git add js/lib/data-style.js tests/data-style.test.js tests/test_static_guards.py js/lib/selection.js js/lib/drilldown/drilldown_view.js js/ui/feed.js js/ui/forecast.js js/ui/instability.js js/ui/legend.js js/ui/panel.js js/ui/drilldown.js js/main.js index.html css/orbis.css
```

Run（実行2・この 1 行で 1 コマンド。ヒアドキュメントの `EOF` までが 1 実行）:
```
git commit -F - <<'EOF'
refactor(csp): style= を data-style＋CSSOM 適用に置換し静的ガードを追加（A5）

- js/lib/data-style.js: applyDataStyles(root) が [data-style] を el.style.cssText へ流し
  属性を外す（CSSOM は CSP 対象外。属性を外すのは style.display='' のリセット型トグルを
  壊さないため＝alerts.js / cams-pane.js が該当）
- テンプレート 21 箇所（selection 8 / feed 4 / forecast 3 / instability 2 / legend 2 /
  panel 1 / drilldown_view 1）を data-style= に機械置換（値は不変）
- 各 innerHTML / insertAdjacentHTML の直後で applyDataStyles を呼ぶ（9 箇所）。
  maplibre Popup は main.js の showPopup(lngLat, html) に集約（7 箇所を置換）
- index.html の静的 2 件（#alerts / #cams-one-tabs）を data-style 化し、boot 先頭で
  applyDataStyles(document)。css/orbis.css に属性が残る間だけのちらつき防止を追加
- tests/test_static_guards.py: HTML 6 枚と js/** の style= / on*= / javascript: /
  setAttribute('style') / CDN 参照を禁止し、applyDataStyles の呼び出し点を件数まで固定。
  .superpowers 等の追跡チェックは Task 9 まで xfail(strict=True)
- deck の getTooltip は全実装がプレーン文字列を返す（js/layers/** に style= は 0 件）ため
  .deck-tooltip の MutationObserver は不要と判定

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012CCrsHhfbbn3LrzaMoZ1MR
EOF
```

---

## Self-Review（分冊 part2・2026-09-03）

- **骨格 Interfaces との突合**：`LAZY_VENDOR` / `ensureTripsLayer({ doc, root })` / `_resetVendorLoaderForTests` / `applyDataStyles(root)` / `showPopup(lngLat, html)` は名前・引数・戻り値とも骨格どおり。ファイル名（`vendor/**` の 14 個）・CSP・Cache-Control・SW 版は本分冊では触らない。
- **骨格から読み替えた 3 点**（冒頭に明記）：`window.__orbis` の e2e ゲート（加算式に変更・理由＝状態バス）／`style=` は 19 ではなく 21 箇所（列挙どおり）／`selPopup` は 6 ではなく 7 箇所（列挙どおり）。ほかに逸脱なし。
- **spec §3.2 / §3.5 の項目 → Step**：vendor 配置＝T4 S3-4／index.html 差し替え＝T4 S5／`?e2e=1`＝T4 S6／integrity テスト＝T4 S1／遅延ロード＝T5 全体／`applyDataStyles`＝T6 S3／19（＝21）箇所置換＝T6 S7-8／呼び出し点＝T6 S9／Popup ヘルパ＝T6 S10／`getTooltip` の判定＝Task 6 見出し直下（不要と結論）／index.html 静的 2 件＋ちらつき防止 CSS＋`applyDataStyles(document)`＝T6 S11・S10-j／静的ガード＝T6 S5。ギャップなし。
- **既存テストへの影響**：`style="` の出力を期待する node テストは 0 件（実測 grep）。`design-tokens.test.js` の `var()` 健全性チェックに追加 CSS は変数を持ち込まない。`drilldown_css.test.js` / `secfit.test.js` の面禁則は対象セレクタが別。よって既存 643 テストは緑のまま。
- **未着手の依存**：Task 4 は Task 3（`vercel.json` の `builds` に `vendor/**`）と Task 2（静的ページ 5 枚）が先。Task 6 の `test_static_guards.py` は Task 2 の 5 ページが存在しないと `FileNotFoundError` になるので、実行順は骨格どおり 2 → 3 → 4 → 5 → 6。
