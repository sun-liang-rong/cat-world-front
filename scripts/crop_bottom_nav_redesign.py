#!/usr/bin/env python3
"""Crop the redesigned bottom-navigation sprites (tray + five icons) from the sheet."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


# Coordinates use the source sheet's top-left coordinate system, measured on
# AI-image/bottom-nav-redesign-sprite.png (1536x1024, RGBA).
CROPS = (
    ("nav_bar", (25, 170, 1512, 520)),
    ("nav_shop", (46, 581, 309, 846)),
    ("nav_adventure", (345, 581, 608, 846)),
    ("nav_rank", (641, 581, 900, 846)),
    ("nav_tasks", (934, 581, 1196, 846)),
    ("nav_mailbox", (1231, 581, 1493, 846)),
)


def crop_sprite(sheet: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Clean near-transparent residue, then trim to the visible bounding box."""
    sprite = sheet.crop(box).convert("RGBA")
    pixels = sprite.load()
    for y in range(sprite.height):
        for x in range(sprite.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha < 8:
                pixels[x, y] = (0, 0, 0, 0)

    visible = sprite.getchannel("A").getbbox()
    if visible is None:
        raise ValueError(f"empty crop: {box}")
    return sprite.crop(visible)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    with Image.open(args.source) as source:
        sheet = source.convert("RGBA")

    args.output.mkdir(parents=True, exist_ok=True)
    for name, box in CROPS:
        target = args.output / f"{name}.png"
        sprite = crop_sprite(sheet, box)
        sprite.save(target, "PNG")
        print(f"Wrote {target} {sprite.size[0]}x{sprite.size[1]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
