"""ORBIS の PWA アイコンを生成（濃紺地に光るオーブ）。"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")


def make(size):
    img = Image.new("RGB", (size, size), "#05080f")
    d = ImageDraw.Draw(img)
    cx = cy = size // 2
    r = int(size * 0.34)
    # グロー
    for i in range(6, 0, -1):
        rr = r + i * size // 60
        alpha = 18 - i * 2
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=(57, 208, 255))
    # オーブ本体
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#0a1c38", outline=(57, 208, 255), width=max(2, size // 80))
    # 経線
    d.ellipse([cx - r // 2, cy - r, cx + r // 2, cy + r], outline=(57, 208, 255), width=max(1, size // 160))
    img.save(os.path.join(OUT, f"icon-{size}.png"))


if __name__ == "__main__":
    os.makedirs(os.path.abspath(OUT), exist_ok=True)
    for s in (192, 512):
        make(s)
    # apple-touch-icon
    Image.open(os.path.join(OUT, "icon-192.png")).save(os.path.join(OUT, "apple-touch-icon.png"))
    print("icons written")
