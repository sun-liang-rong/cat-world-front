#!/usr/bin/env python3
"""Prepare themed match-tile element sprites for the game.

Takes the chroma-keyed RGBA element icons produced by the fusheng-imagegen
skill (AI-image/grassland-tile-*.png), trims the transparent border, resizes
onto a fixed 200x200 transparent canvas matching the generic tile set, and
writes tile_1..tile_15 into assets/resources/game/tiles/<theme>/ so the file
order matches the element kind order used by GameScreen.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

RESOURCE_ROOT = Path(__file__).resolve().parents[1] / 'assets' / 'resources' / 'game' / 'tiles'
CANVAS = 200
CONTENT_BOX = 188
ALPHA_THRESHOLD = 8


def process(image: Image.Image) -> Image.Image:
    alpha = image.getchannel('A')
    box = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0).getbbox()
    if box is None:
        raise ValueError('image is fully transparent')
    content = image.crop(box)
    scale = min(CONTENT_BOX / content.width, CONTENT_BOX / content.height)
    target = (max(1, round(content.width * scale)), max(1, round(content.height * scale)))
    content = content.resize(target, Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(content, ((CANVAS - target[0]) // 2, (CANVAS - target[1]) // 2))
    return canvas


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--src-dir', type=Path, required=True, help='directory with processed RGBA icons')
    parser.add_argument('--pattern', default='*-tile-*.png', help='glob of source icons inside src-dir')
    parser.add_argument('--theme', required=True, help='theme folder name under game/tiles, e.g. grassland')
    args = parser.parse_args()

    sources = sorted(args.src_dir.glob(args.pattern))
    if not sources:
        raise SystemExit(f'no source icons matched {args.src_dir / args.pattern}')
    out_dir = RESOURCE_ROOT / args.theme
    out_dir.mkdir(parents=True, exist_ok=True)

    for index, path in enumerate(sources, start=1):
        if index > 15:
            raise SystemExit('more than 15 source icons; element kinds are fixed at 15')
        canvas = process(Image.open(path).convert('RGBA'))
        out_path = out_dir / f'tile_{index}.png'
        canvas.save(out_path)
        print(f'{path.name} -> {out_path.relative_to(RESOURCE_ROOT.parents[2])}')


if __name__ == '__main__':
    main()
