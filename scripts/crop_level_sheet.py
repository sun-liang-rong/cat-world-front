#!/usr/bin/env python3
"""Extract clean transparent level-game sprites from the supplied reference sheet."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image
from rembg import new_session, remove


# Coordinates use the 1536x1024 sheet's top-left origin. Each box contains one
# complete item with enough breathing room for the foreground remover.
CROPS: tuple[tuple[str, tuple[int, int, int, int]], ...] = (
    ("fish", (20, 590, 225, 815)),
    ("yarn", (232, 590, 440, 800)),
    ("paw", (445, 590, 650, 805)),
    ("bell", (650, 590, 835, 820)),
    ("mouse", (870, 580, 1085, 820)),
    ("can", (1095, 595, 1290, 820)),
    ("milk", (1310, 580, 1515, 825)),
    ("bowl", (10, 785, 215, 1015)),
    ("bone", (190, 785, 410, 1010)),
    ("feather", (390, 785, 600, 1015)),
    ("leaf", (570, 785, 770, 1015)),
    ("bow", (750, 785, 970, 1015)),
    ("basket", (955, 785, 1160, 1015)),
    ("biscuit", (1140, 785, 1350, 1015)),
    ("heart", (1350, 785, 1535, 1015)),
)


def trim_alpha(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            if pixels[x, y][3] < 10:
                pixels[x, y] = (0, 0, 0, 0)
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("foreground extraction returned an empty image")
    return image.crop(bbox)


def write_crops(source: Path, output: Path) -> None:
    if not source.is_file():
        raise ValueError(f"source file does not exist: {source}")
    with Image.open(source) as raw:
        sheet = raw.convert("RGB")

    output.mkdir(parents=True, exist_ok=True)
    # Use the full model so thin silhouettes (especially the feather shaft)
    # keep a clean edge instead of retaining the source sheet's glow.
    session = new_session("u2net")
    manifest: list[dict[str, object]] = []
    for name, box in CROPS:
        crop = sheet.crop(box)
        # Rembg removes the colored glow/background while preserving the
        # antialiased outline and interior highlights of the game item.
        clean = trim_alpha(remove(crop, session=session))
        target = output / f"{name}.png"
        clean.save(target, "PNG", optimize=True)
        with Image.open(target) as saved:
            saved.load()
            if saved.mode != "RGBA" or saved.getchannel("A").getbbox() is None:
                raise ValueError(f"invalid output: {target}")
            manifest.append({"name": name, "source_box": box, "size": list(saved.size), "file": target.name})

    (output / "manifest.json").write_text(
        json.dumps({"source": source.name, "crops": manifest}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    write_crops(args.source, args.output)
    print(f"Wrote {len(CROPS)} clean sprites to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
