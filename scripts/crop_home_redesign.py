#!/usr/bin/env python3
"""首页改版素材裁切：河桥小镇背景 + 超萌挑战徽章。

- 背景：AI 生成的 1024x1536 竖版图，居中裁到 750x1334 设计稿比例后存为 JPG。
- 徽章：技能抠绿后的 RGBA 图，按不透明像素包围盒裁掉透明边并缩到 2x 显示尺寸。

用法：
  python3 scripts/crop_home_redesign.py
"""
from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError as error:  # pragma: no cover - depends on the local Python setup
    print(
        "[CatWorld] Pillow is required. Install it with: python3 -m pip install Pillow",
        file=sys.stderr,
    )
    raise SystemExit(2) from error

PROJECT_ROOT = Path(__file__).resolve().parent.parent
AI_IMAGE = PROJECT_ROOT / "AI-image"
RESOURCES = PROJECT_ROOT / "assets" / "resources"

# 设计稿比例 750x1334（FIXED_WIDTH 适配的基准画布）
DESIGN_RATIO = 750 / 1334
BG_TARGET = (864, 1536)  # 与旧 home_bg 的显示比例一致，避免拉伸变形
ICON_DISPLAY = (135, 128)  # 与 side_cat_club 相同的 2x 槽位尺寸


def crop_background() -> None:
    src = AI_IMAGE / "home_bg_river_raw.png"
    out = RESOURCES / "home" / "home_bg_river.jpg"
    image = Image.open(src).convert("RGB")
    width, height = image.size
    target_width = round(height * DESIGN_RATIO)
    if target_width <= width:
        left = (width - target_width) // 2
        image = image.crop((left, 0, left + target_width, height))
    else:
        target_height = round(width / DESIGN_RATIO)
        top = max(0, (height - target_height) // 2)
        image = image.crop((0, top, width, top + target_height))
    image = image.resize(BG_TARGET, Image.LANCZOS)
    image.save(out, "JPEG", quality=88)
    print(f"[CatWorld] background -> {out} {image.size}")


def crop_challenge_icon() -> None:
    src = AI_IMAGE / "side_challenge.png"
    out = RESOURCES / "home_crops" / "side_challenge.png"
    image = Image.open(src).convert("RGBA")
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    image = image.resize(ICON_DISPLAY, Image.LANCZOS)
    image.save(out, "PNG")
    print(f"[CatWorld] challenge icon -> {out} {image.size}")


if __name__ == "__main__":
    crop_background()
    crop_challenge_icon()
