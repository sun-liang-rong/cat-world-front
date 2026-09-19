#!/usr/bin/env python3
"""Split a 3x5 themed tile sprite sheet into 15 RGBA icons.

The generator often returns a sheet whose pixel size is not divisible by 5x3.
This script chroma-keys a flat magenta (or the top-left pixel), finds the 15
largest opaque connected components, sorts them in reading order, and writes
theme-tile-01.png .. theme-tile-15.png for process_theme_tiles.py.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path

import sys

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from process_theme_tiles import process as fit_tile


ALPHA_THRESHOLD = 8


def parse_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip('#')
    return tuple(int(text[index:index + 2], 16) for index in (0, 2, 4))  # type: ignore[return-value]


def color_matches(pixel: tuple[int, int, int, int], background: tuple[int, int, int], tolerance: int) -> bool:
    return pixel[3] > 0 and max(abs(pixel[channel] - background[channel]) for channel in range(3)) <= tolerance


def remove_chroma(image: Image.Image, background: tuple[int, int, int], tolerance: int) -> Image.Image:
    pixels = image.load()
    width, height = image.size
    removed = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def add_if_background(x: int, y: int) -> None:
        index = y * width + x
        if not removed[index] and color_matches(pixels[x, y], background, tolerance):
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

    for index, is_background in enumerate(removed):
        if is_background:
            x = index % width
            y = index // width
            red, green, blue, _ = pixels[x, y]
            pixels[x, y] = (red, green, blue, 0)
    return image


def connected_boxes(image: Image.Image) -> list[tuple[int, int, int, int]]:
    pixels = image.load()
    width, height = image.size
    seen = bytearray(width * height)
    boxes: list[tuple[int, int, int, int, int]] = []

    for start_y in range(height):
        for start_x in range(width):
            start = start_y * width + start_x
            if seen[start] or pixels[start_x, start_y][3] <= ALPHA_THRESHOLD:
                continue
            queue: deque[tuple[int, int]] = deque([(start_x, start_y)])
            seen[start] = 1
            min_x = max_x = start_x
            min_y = max_y = start_y
            area = 0
            while queue:
                x, y = queue.popleft()
                area += 1
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
                for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    index = next_y * width + next_x
                    if seen[index] or pixels[next_x, next_y][3] <= ALPHA_THRESHOLD:
                        continue
                    seen[index] = 1
                    queue.append((next_x, next_y))
            if area >= 80:
                boxes.append((min_x, min_y, max_x + 1, max_y + 1, area))

    boxes.sort(key=lambda item: item[4], reverse=True)
    top = boxes[:15]
    if len(top) != 15:
        raise SystemExit(f'expected 15 tile blobs, found {len(top)}')
    top.sort(key=lambda item: (item[1] + item[3]) / 2)
    rows: list[list[tuple[int, int, int, int, int]]] = []
    for box in top:
        if not rows or box[1] > (rows[-1][-1][1] + rows[-1][-1][3]) / 2 + 24:
            rows.append([box])
        else:
            rows[-1].append(box)
    if len(rows) != 3:
        # Fall back to 5-wide reading order by y then x.
        top.sort(key=lambda item: (((item[1] + item[3]) / 2) // 80, item[0]))
        return [(item[0], item[1], item[2], item[3]) for item in top]
    ordered: list[tuple[int, int, int, int]] = []
    for row in rows:
        row.sort(key=lambda item: item[0])
        ordered.extend((item[0], item[1], item[2], item[3]) for item in row)
    return ordered


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--out-dir', type=Path, required=True)
    parser.add_argument('--background', default='FF00FF')
    parser.add_argument('--tolerance', type=int, default=48)
    parser.add_argument('--prefix', default='theme-tile')
    parser.add_argument('--skip-chroma', action='store_true', help='treat the sheet as already RGBA')
    args = parser.parse_args()

    image = Image.open(args.input).convert('RGBA')
    if args.skip_chroma or image.getpixel((0, 0))[3] == 0:
        keyed = image
    else:
        background = parse_rgb(args.background)
        keyed = remove_chroma(image, background, args.tolerance)
    boxes = connected_boxes(keyed)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for index, box in enumerate(boxes, start=1):
        tile = fit_tile(keyed.crop(box))
        out_path = args.out_dir / f'{args.prefix}-{index:02d}.png'
        tile.save(out_path)
        print(f'{out_path.name} {tile.size}')


if __name__ == '__main__':
    main()
