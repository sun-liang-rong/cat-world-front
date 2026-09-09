#!/usr/bin/env python3
"""Crop the simplified home-page sprite sheet into named transparent PNGs.

Source: AI-image/home-simple-sprite.png (1536x1024, RGBA).
Coordinates use the sheet's top-left origin.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SHEET = PROJECT_ROOT / "AI-image" / "home-simple-sprite.png"
RESOURCES = PROJECT_ROOT / "assets" / "resources"

# (relpath, box, max_side) — max_side is the 2x display long edge.
CROPS: tuple[tuple[str, tuple[int, int, int, int], int], ...] = (
    ("home_top_crops/avatar.png", (185, 8, 385, 222), 236),
    ("home_top_crops/paw.png", (539, 46, 934, 166), 360),
    ("home_crops/hud_settings.png", (1048, 26, 1194, 175), 160),
    ("home/house_icon.png", (120, 228, 389, 427), 200),
    ("home_crops/chapter_chip.png", (396, 244, 862, 334), 760),
    ("home_crops/button_start.png", (916, 210, 1439, 371), 800),
    ("home/home_cats_group.png", (301, 377, 1239, 676), 1328),
    ("home_crops/nav_bar.png", (76, 680, 1460, 805), 1500),
    ("home_crops/nav_town.png", (184, 824, 365, 997), 212),
    ("home_crops/nav_cats.png", (432, 824, 611, 997), 212),
    ("home_crops/nav_shop.png", (680, 824, 861, 997), 212),
    ("home_crops/nav_tasks.png", (928, 824, 1108, 997), 212),
    ("home_crops/nav_more.png", (1176, 824, 1353, 997), 212),
)


def clean_alpha(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    width, height = image.size
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha < 10:
                pixels[x, y] = (0, 0, 0, 0)
                continue
            luma = (red * 3 + green * 4 + blue) // 8
            if alpha < 96 and luma < 36:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def crop_sprite(sheet: Image.Image, box: tuple[int, int, int, int], max_side: int) -> Image.Image:
    sprite = clean_alpha(sheet.crop(box))
    bbox = sprite.getbbox()
    if bbox is None:
        raise ValueError(f"empty crop: {box}")
    sprite = sprite.crop(bbox)
    width, height = sprite.size
    long_edge = max(width, height)
    if long_edge > max_side:
        scale = max_side / long_edge
        sprite = sprite.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.LANCZOS,
        )
    return sprite


def main() -> int:
    with Image.open(SHEET) as source:
        sheet = source.convert("RGBA")

    for relpath, box, max_side in CROPS:
        target = RESOURCES / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        sprite = crop_sprite(sheet, box, max_side)
        sprite.save(target, "PNG")
        print(f"[CatWorld] {relpath} {sprite.size[0]}x{sprite.size[1]} {sprite.mode}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
