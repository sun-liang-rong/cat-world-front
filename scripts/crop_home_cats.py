#!/usr/bin/env python3
"""Prepare the home-screen plaza cat group sprite.

Takes the chroma-keyed RGBA group image, removes residual green fringe on the
fur edges, feathers the alpha edge, trims the transparent border, resizes to
the game display height and writes it into assets/resources/home/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageFilter

OUTPUT_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'resources' / 'home'


def near_transparent(pixels, x: int, y: int, width: int, height: int) -> bool:
    for dy in (-2, -1, 0, 1, 2):
        for dx in (-2, -1, 0, 1, 2):
            sample_x = min(max(x + dx, 0), width - 1)
            sample_y = min(max(y + dy, 0), height - 1)
            if pixels[sample_x, sample_y][3] < 120:
                return True
    return False


def despill(image: Image.Image) -> Image.Image:
    """Clamp green spill on edge pixels so the fur keeps a warm tone."""
    rgba = image.convert('RGBA')
    width, height = rgba.size
    pixels = rgba.load()
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0 or not near_transparent(pixels, x, y, width, height):
                continue
            if green > red and green > blue:
                pixels[x, y] = (red, max(red, blue), blue, alpha)
    return rgba


def clean_alpha(image: Image.Image) -> Image.Image:
    """Erode the outermost blended pixel ring, then soften the edge."""
    rgba = image.convert('RGBA')
    red, green, blue, alpha = rgba.split()
    eroded = alpha.filter(ImageFilter.MinFilter(3))
    softened = eroded.filter(ImageFilter.GaussianBlur(0.8))
    rgba.putalpha(softened)
    return rgba


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=None,
                        help='defaults to assets/resources/home/<input-stem>.png')
    parser.add_argument('--height', type=int, default=320,
                        help='final asset height in pixels (aspect preserved)')
    parser.add_argument('--skip-alpha-clean', action='store_true')
    parser.add_argument('--global-chroma', action='store_true',
                        help='also clear key-colored pixels trapped between subjects, '
                             'which the edge-connected flood fill cannot reach')
    parser.add_argument('--chroma-key', default='18,242,15',
                        help='key RGB sampled from the raw background')
    parser.add_argument('--chroma-tolerance', type=int, default=90)
    return parser.parse_args()


def clear_trapped_chroma(image: Image.Image, key: tuple[int, int, int], tolerance: int) -> Image.Image:
    """Drop leftover background pockets enclosed by the subjects."""
    rgba = image.convert('RGBA')
    pixels = rgba.load()
    width, height = rgba.size
    cleared = 0
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            if max(abs(red - key[0]), abs(green - key[1]), abs(blue - key[2])) <= tolerance:
                pixels[x, y] = (red, green, blue, 0)
                cleared += 1
    print(f'global chroma pass cleared {cleared} pixels')
    return rgba


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f'input image does not exist: {args.input}')

    image = Image.open(args.input)
    if image.mode != 'RGBA':
        raise SystemExit(f'input is not an RGBA sprite: {args.input}')

    if args.global_chroma:
        key = tuple(int(v) for v in args.chroma_key.split(','))
        image = clear_trapped_chroma(image, key, args.chroma_tolerance)

    image = despill(image)
    if not args.skip_alpha_clean:
        image = clean_alpha(image)

    box = image.getbbox()
    if not box:
        raise SystemExit('no opaque pixels found after keying')
    image = image.crop(box)

    scale = args.height / image.height
    target = (max(1, round(image.width * scale)), args.height)
    image = image.resize(target, Image.Resampling.LANCZOS)

    output = args.output or (OUTPUT_DIR / f'{args.input.stem}.png')
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format='PNG')
    print(f'wrote {output.resolve()} ({image.width}x{image.height})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
