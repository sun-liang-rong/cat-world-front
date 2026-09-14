#!/usr/bin/env python3
"""Prepare the home-screen 3D tile board sprite.

Takes a magenta-keyed or already-RGBA board illustration, clears leftover
chroma fringe, trims the transparent border, resizes to the game display
width and writes it into assets/resources/home/.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

from PIL import Image

OUTPUT_DIR = Path(__file__).resolve().parents[1] / 'assets' / 'resources' / 'home'
DEFAULT_KEY = (255, 0, 255)


def parse_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip('#')
    if ',' in text:
        parts = [int(part) for part in text.split(',')]
        if len(parts) != 3:
            raise argparse.ArgumentTypeError('chroma-key must be R,G,B or RRGGBB')
        return parts[0], parts[1], parts[2]
    if len(text) != 6:
        raise argparse.ArgumentTypeError('chroma-key must be R,G,B or RRGGBB')
    return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def color_matches(pixel: tuple[int, int, int, int], key: tuple[int, int, int], tolerance: int) -> bool:
    return pixel[3] > 0 and max(abs(pixel[channel] - key[channel]) for channel in range(3)) <= tolerance


def magentaish(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    return alpha > 0 and red > 160 and blue > 160 and green < 130 and red + blue - 2 * green > 120


def clear_chroma(image: Image.Image, key: tuple[int, int, int], tolerance: int) -> Image.Image:
    rgba = image.convert('RGBA')
    width, height = rgba.size
    pixels = rgba.load()
    removed = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def add_if_background(x: int, y: int) -> None:
        index = y * width + x
        if not removed[index] and color_matches(pixels[x, y], key, tolerance):
            removed[index] = 1
            queue.append((x, y))

    for x in range(width):
        add_if_background(x, 0)
        if height > 1:
            add_if_background(x, height - 1)
    for y in range(1, height - 1):
        add_if_background(0, y)
        if width > 1:
            add_if_background(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height:
                add_if_background(next_x, next_y)

    for y in range(height):
        for x in range(width):
            pixel = pixels[x, y]
            if removed[y * width + x] or magentaish(pixel):
                pixels[x, y] = (pixel[0], pixel[1], pixel[2], 0)
    return rgba


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=OUTPUT_DIR / 'home_board_3d.png')
    parser.add_argument('--width', type=int, default=900, help='final asset width in pixels (aspect preserved)')
    parser.add_argument('--chroma-key', type=parse_rgb, default=DEFAULT_KEY)
    parser.add_argument('--chroma-tolerance', type=int, default=88)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.input.is_file():
        raise SystemExit(f'input image does not exist: {args.input}')

    image = clear_chroma(Image.open(args.input), args.chroma_key, args.chroma_tolerance)
    box = image.getbbox()
    if not box:
        raise SystemExit('no opaque pixels found after keying')
    image = image.crop(box)

    scale = args.width / image.width
    target = (args.width, max(1, round(image.height * scale)))
    image = image.resize(target, Image.Resampling.LANCZOS)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    image.save(args.output, format='PNG', optimize=True)
    print(f'wrote {args.output.resolve()} ({image.width}x{image.height})')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
