#!/usr/bin/env python3
"""Crop the supplied no-number HUD sheet into transparent Cocos assets."""
from __future__ import annotations

import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


# Coordinates use the source image's top-left origin. Each box contains one
# complete HUD control and a little breathing room for the soft shadow.
CROPS: tuple[tuple[str, tuple[int, int, int, int]], ...] = (
    ("hud_avatar_clean", (0, 0, 1680, 768)),
    ("hud_lives_clean", (1680, 0, 2870, 768)),
    ("hud_coins_clean", (2870, 0, 4050, 768)),
    ("hud_diamonds_clean", (4050, 0, 5184, 768)),
)


def is_checkerboard(pixel: tuple[int, int, int, int]) -> bool:
    """Match the near-neutral checkerboard without removing cream artwork."""
    red, green, blue, alpha = pixel
    return alpha > 0 and min(red, green, blue) >= 180 and max(red, green, blue) - min(red, green, blue) <= 18


def remove_checkerboard(image: Image.Image) -> Image.Image:
    """Make checkerboard pixels transparent when they connect to the crop edge."""
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    pending: deque[tuple[int, int]] = deque()
    seen: set[tuple[int, int]] = set()

    for x in range(width):
        pending.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        pending.extend(((0, y), (width - 1, y)))

    while pending:
        x, y = pending.pop()
        if (x, y) in seen:
            continue
        seen.add((x, y))
        if not is_checkerboard(pixels[x, y]):
            continue
        pixels[x, y] = (0, 0, 0, 0)
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen:
                pending.append((nx, ny))

    return image


def clean_crop(image: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    crop = remove_checkerboard(image.crop(box))
    pixels = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            if pixels[x, y][3] < 8:
                pixels[x, y] = (0, 0, 0, 0)
    bbox = crop.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"crop {box} contains no visible artwork")
    crop = crop.crop(bbox)
    return crop


def write_crops(source: Path, output: Path) -> list[Path]:
    if not source.is_file():
        raise ValueError(f"source file does not exist: {source}")
    with Image.open(source) as raw:
        image = raw.convert("RGBA")

    output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    written: list[Path] = []
    for name, box in CROPS:
        target = output / f"{name}.png"
        crop = clean_crop(image, box)
        crop.save(target, "PNG", optimize=True)
        with Image.open(target) as saved:
            saved.load()
            if saved.mode != "RGBA" or saved.getchannel("A").getbbox() is None:
                raise ValueError(f"invalid output: {target}")
            size = saved.size
        written.append(target)
        manifest.append({"name": name, "source_box": box, "size": list(size), "file": target.name})

    (output / "manifest.json").write_text(
        json.dumps({"source": source.name, "crops": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    files = write_crops(args.source, args.output)
    print(f"Wrote {len(files)} crops to {args.output}")
    for path in files:
        print(path)
    print(args.output / "manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
