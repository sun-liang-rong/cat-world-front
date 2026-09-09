#!/usr/bin/env python3
"""Crop the five transparent bottom-navigation icons from the supplied sheet."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


# Coordinates use the original sheet's top-left coordinate system.
CROPS = (
    ("nav_shop", (38, 163, 423, 555)),
    ("nav_decor", (467, 163, 852, 555)),
    ("nav_friends", (896, 163, 1279, 555)),
    ("nav_tasks", (1318, 163, 1704, 555)),
    ("nav_mailbox", (1749, 163, 2136, 555)),
)


def crop_icon(sheet: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    """Trim transparent/near-transparent sheet residue while preserving antialiasing."""
    icon = sheet.crop(box).convert("RGBA")
    pixels = icon.load()
    for y in range(icon.height):
        for x in range(icon.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha < 8:
                pixels[x, y] = (0, 0, 0, 0)

    visible = icon.getchannel("A").getbbox()
    if visible is None:
        raise ValueError(f"empty crop: {box}")
    return icon.crop(visible)


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
        crop_icon(sheet, box).save(target, "PNG")
        print(f"Wrote {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
