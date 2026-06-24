#!/usr/bin/env python3
"""ORBIS の PWA/favicon アイコンを icon-master.svg / favicon.svg から生成。

PIL では SVG の glow/gradient を再現できないため、playwright 同梱の Chromium で
ラスタライズする（発光する軌道環globe をそのまま忠実に書き出す）。
リポルートから実行: python3 scripts/make_icons.py

scripts/ は .vercelignore 済みで本番には ship されない。
"""
import asyncio
import base64
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (source svg, 出力先, px) — source が無いジョブはスキップ（favicon.svg は別タスクで作成）。
JOBS = [
    ("icon-master.svg", "icons/icon-512.png", 512),
    ("icon-master.svg", "icons/icon-192.png", 192),
    ("icon-master.svg", "icons/apple-touch-icon.png", 180),
    ("favicon.svg", "favicon-32.png", 32),
]


async def main():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for src, out, size in JOBS:
            src_path = os.path.join(ROOT, src)
            if not os.path.exists(src_path):
                print("skip (no source):", src, "->", out)
                continue
            with open(src_path) as f:
                b64 = base64.b64encode(f.read().encode()).decode()
            page = await browser.new_page(
                viewport={"width": size, "height": size}, device_scale_factor=1
            )
            await page.set_content(
                f'<body style="margin:0">'
                f'<img src="data:image/svg+xml;base64,{b64}" '
                f'width="{size}" height="{size}"></body>'
            )
            await page.locator("img").screenshot(path=os.path.join(ROOT, out))
            await page.close()
            print("wrote", out, f"({size}x{size})")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
