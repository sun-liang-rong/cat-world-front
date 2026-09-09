#!/usr/bin/env python3
"""Crop the non-uniform Cat World UI sheet into named transparent PNGs."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


# Coordinates are in the source sheet's top-left coordinate system.
CROPS: tuple[tuple[str, tuple[int, int, int, int]], ...] = (
    ("hud_avatar", (20, 0, 315, 135)),
    ("hud_lives", (330, 20, 555, 125)),
    ("hud_coins", (558, 20, 784, 125)),
    ("hud_diamonds", (787, 20, 1012, 125)),
    ("hud_settings", (1014, 20, 1115, 125)),
    ("side_events", (10, 135, 140, 270)),
    ("side_adventure", (145, 135, 280, 270)),
    ("title_logo", (295, 120, 940, 355)),
    ("side_daily", (10, 265, 140, 405)),
    ("side_moments", (145, 265, 280, 405)),
    ("title_subtitle", (390, 350, 830, 430)),
    ("side_vip", (10, 395, 140, 530)),
    ("side_cat_club", (145, 395, 295, 530)),
    ("button_orange_state_1", (945, 130, 1215, 225)),
    ("button_orange_state_2", (945, 215, 1215, 305)),
    ("button_orange_state_3", (945, 295, 1215, 385)),
    ("button_disabled", (945, 375, 1215, 465)),
    ("button_start", (295, 425, 775, 580)),
    ("building_sign_top", (770, 450, 980, 535)),
    ("building_awning_green", (770, 520, 980, 615)),
    ("building_locked_shop", (965, 450, 1215, 595)),
    ("building_sign_left", (10, 545, 195, 665)),
    ("building_sign_left_cat", (190, 535, 365, 670)),
    ("level_banner", (355, 575, 755, 660)),
    ("building_awning_pink", (765, 600, 975, 690)),
    ("building_sign_right", (965, 580, 1215, 710)),
    ("control_add", (20, 645, 88, 730)),
    ("control_coin", (95, 645, 170, 730)),
    ("control_diamond", (180, 645, 258, 730)),
    ("control_heart", (260, 645, 330, 730)),
    ("control_settings", (340, 645, 415, 730)),
    ("control_sound", (418, 645, 492, 730)),
    ("control_music", (495, 645, 570, 730)),
    ("control_play", (570, 645, 650, 730)),
    ("control_pause", (650, 645, 730, 730)),
    ("control_check", (735, 675, 810, 750)),
    ("control_lock", (805, 675, 875, 750)),
    ("decoration_flags", (880, 675, 1005, 785)),
    ("item_paw", (15, 715, 95, 810)),
    ("item_paw_red", (93, 715, 175, 810)),
    ("item_rocket", (175, 715, 260, 810)),
    ("item_yarn", (260, 735, 330, 800)),
    ("item_flower_white", (340, 715, 415, 805)),
    ("item_flower_pink", (415, 715, 490, 805)),
    ("item_leaf", (490, 715, 560, 805)),
    ("item_star_1", (570, 715, 650, 805)),
    ("item_star_2", (650, 715, 735, 805)),
    ("item_fish", (735, 730, 830, 815)),
    ("decoration_sparkles", (835, 750, 925, 830)),
    ("badge_1", (940, 775, 1010, 850)),
    ("badge_2", (1020, 775, 1090, 850)),
    ("badge_3", (1100, 775, 1175, 850)),
    ("nav_shop", (15, 795, 175, 955)),
    ("nav_decor", (175, 795, 330, 955)),
    ("nav_friends", (330, 795, 480, 955)),
    ("nav_tasks", (480, 795, 630, 955)),
    ("nav_mailbox", (630, 795, 785, 955)),
    ("small_crown", (795, 850, 865, 925)),
    ("small_check_box", (865, 850, 930, 925)),
    ("small_check_round", (925, 845, 1005, 925)),
    ("badge_new", (1005, 850, 1120, 925)),
    ("small_add", (1140, 850, 1205, 925)),
    ("board_large", (15, 950, 200, 1145)),
    ("board_small", (205, 980, 350, 1135)),
    ("board_slots", (350, 950, 780, 1065)),
    ("board_progress", (350, 1050, 780, 1165)),
    ("dialog_cat", (790, 920, 1015, 1125)),
    ("dialog_panel", (1020, 930, 1215, 1130)),
    ("meter_heart_red", (20, 1140, 120, 1245)),
    ("meter_heart_brown", (130, 1140, 225, 1245)),
    ("meter_energy", (270, 1135, 540, 1235)),
    ("meter_heart_small_1", (540, 1140, 610, 1235)),
    ("meter_heart_small_2", (600, 1140, 670, 1235)),
    ("meter_heart_small_3", (660, 1140, 730, 1235)),
    ("toggle_green", (790, 1135, 885, 1200)),
    ("toggle_brown", (880, 1135, 1005, 1200)),
    ("button_cancel", (1015, 1120, 1095, 1210)),
    ("button_confirm", (1100, 1120, 1205, 1210)),
)

# These boxes sit next to another sprite in the source sheet. Keep the main
# connected artwork so a neighboring shadow or highlight is not exported.
LARGEST_ONLY = frozenset(
    {
        "button_orange_state_1",
        "button_orange_state_2",
        "button_orange_state_3",
        "button_disabled",
        "button_start",
        "building_awning_green",
        "building_awning_pink",
        "building_sign_left_cat",
        "building_sign_right",
        "item_fish",
        "item_flower_white",
        "item_star_1",
        "item_star_2",
        "meter_energy",
        "meter_heart_small_1",
        "meter_heart_small_2",
        "meter_heart_small_3",
        "board_progress",
        "control_heart",
        "toggle_brown",
    }
)

# The lower-right sign is adjacent to the bunting string. This small region
# belongs to the neighboring flag and is excluded from the sign crop.
EXCLUDED_REGIONS: dict[str, tuple[tuple[int, int, int, int], ...]] = {
    "building_sign_right": ((140, 104, 250, 130),),
}


def is_border_matte(pixel: tuple[int, int, int, int]) -> bool:
    red, green, blue, alpha = pixel
    if alpha == 0:
        return True
    return min(red, green, blue) >= 180 and max(red, green, blue) - min(red, green, blue) <= 18


def remove_border_matte(image: Image.Image) -> Image.Image:
    """Remove checkerboard-like pixels connected to the crop border."""
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    pending: list[tuple[int, int]] = []
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
        if not is_border_matte(pixels[x, y]):
            continue
        pixels[x, y] = (0, 0, 0, 0)
        for neighbor in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            nx, ny = neighbor
            if 0 <= nx < width and 0 <= ny < height and neighbor not in seen:
                pending.append(neighbor)
    return image


def component_masks(image: Image.Image) -> list[set[tuple[int, int]]]:
    """Return alpha-connected regions for selecting a clean sprite."""
    alpha = image.getchannel("A")
    width, height = image.size
    pixels = alpha.load()
    visited: set[tuple[int, int]] = set()
    regions: list[set[tuple[int, int]]] = []
    for y in range(height):
        for x in range(width):
            if (x, y) in visited or pixels[x, y] == 0:
                continue
            region: set[tuple[int, int]] = set()
            pending = [(x, y)]
            visited.add((x, y))
            while pending:
                px, py = pending.pop()
                region.add((px, py))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = px + dx, py + dy
                        point = (nx, ny)
                        if not (0 <= nx < width and 0 <= ny < height):
                            continue
                        if point in visited or pixels[nx, ny] == 0:
                            continue
                        visited.add(point)
                        pending.append(point)
            regions.append(region)
    return regions


def clean_crop(image: Image.Image, name: str, box: tuple[int, int, int, int]) -> Image.Image:
    crop = remove_border_matte(image.crop(box))
    pixels = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            red, green, blue, alpha = pixels[x, y]
            # The source has low-alpha checkerboard residue around artwork.
            if alpha < 8:
                pixels[x, y] = (0, 0, 0, 0)
    if name in LARGEST_ONLY:
        regions = component_masks(crop)
        if not regions:
            raise ValueError(f"crop {name} contains no visible artwork")
        allowed = max(regions, key=len)
        pixels = crop.load()
        for y in range(crop.height):
            for x in range(crop.width):
                if (x, y) not in allowed:
                    pixels[x, y] = (0, 0, 0, 0)
    for x0, y0, x1, y1 in EXCLUDED_REGIONS.get(name, ()):
        for y in range(max(0, y0), min(crop.height, y1)):
            for x in range(max(0, x0), min(crop.width, x1)):
                pixels[x, y] = (0, 0, 0, 0)
    bbox = crop.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError(f"crop {box} contains no visible artwork")
    crop = crop.crop(bbox)
    pixels = crop.load()
    for y in range(crop.height):
        for x in range(crop.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                pixels[x, y] = (0, 0, 0, 0)
    return crop


def validate(image: Image.Image, path: Path) -> None:
    if image.mode != "RGBA":
        raise ValueError(f"{path.name} is not RGBA")
    if image.getchannel("A").getbbox() is None:
        raise ValueError(f"{path.name} is empty")
    for red, green, blue, alpha in image.getdata():
        if alpha == 0 and (red, green, blue) != (0, 0, 0):
            raise ValueError(f"{path.name} contains hidden RGB matte pixels")


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
        crop = clean_crop(image, name, box)
        crop.save(target, "PNG")
        with Image.open(target) as saved:
            saved.load()
            validate(saved, target)
            width, height = saved.size
        written.append(target)
        manifest.append({"name": name, "source_box": box, "size": [width, height], "file": target.name})

    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps({"source": str(source), "crops": manifest}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return written


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("assets/generated/sprites/home_sheet.png"))
    parser.add_argument("--output", type=Path, default=Path("assets/generated/sprites/home_crops"))
    args = parser.parse_args()
    files = write_crops(args.source, args.output)
    print(f"Wrote {len(files)} crops to {args.output}")
    for path in files:
        print(path)
    print(args.output / "manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
