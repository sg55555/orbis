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
