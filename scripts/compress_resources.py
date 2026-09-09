#!/usr/bin/env python3
"""Compress Cocos image resources without changing their Cocos references.

RGBA images use an adaptive indexed-PNG profile based on their long edge. A
quality check can fall back to lossless PNG encoding when quantization is too
visibly different. Opaque RGB images above a configurable size use
quality-checked JPEG by default. WebP is intentionally not used because WeChat
Mini Games do not support it.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, UnidentifiedImageError
except ImportError as error:  # pragma: no cover - depends on the local Python setup
    print(
        "[CatWorld] Pillow is required. Install it with: python3 -m pip install Pillow",
        file=sys.stderr,
    )
    raise SystemExit(2) from error


PNG_SUFFIX = ".png"
JPEG_SUFFIX = ".jpg"
JPEG_SUFFIXES = {".jpg", ".jpeg"}
IMAGE_SUFFIXES = {PNG_SUFFIX, *JPEG_SUFFIXES}

# These assets are exported at a much higher resolution than their fixed-width
# UI slots need. Keep roughly 2x the design-resolution display size for sharp
# device rendering without carrying the original screenshot-sized textures.
DISPLAY_SIZE_PROFILES: dict[str, tuple[int, int]] = {
    # Gameplay feedback art is displayed at roughly half these dimensions;
    # keeping a 2x working size avoids wasting texture memory on 1254px exports.
    "game/combo_x2.png": (720, 720),
    "game/combo_x3.png": (720, 720),
    "game/combo_x4.png": (720, 720),
    "game/cat_skill_badge.png": (96, 96),
    "tasks/daily_progress_track.png": (442, 84),
    "home_crops/hud_avatar_clean.png": (368, 156),
    "home_crops/hud_coins_clean.png": (304, 102),
    "home_crops/nav_adventure.png": (212, 212),
    "home_crops/nav_guide.png": (212, 212),
    "home_crops/nav_rank.png": (212, 212),
    "home_crops/nav_shop.png": (212, 212),
    "home_crops/nav_tasks.png": (212, 212),
    "home_top_crops/avatar.png": (368, 156),
    "home_top_crops/paw.png": (304, 102),
}


@dataclass(frozen=True)
class CompressionTier:
    name: str
    max_dimension: int
    max_colors: int | None
    max_mean_error: float
    max_p95_error: float


# The limits are based on the source image's long edge. Small icons stay
# lossless; larger artwork can use more palette colors. The error limits below
# stop a visually noisy image from being replaced by a poor quantized version.
COMPRESSION_TIERS = (
    CompressionTier("tiny-lossless", 128, None, 0, 0),
    CompressionTier("small", 256, 128, 10, 24),
    CompressionTier("medium", 512, 192, 8, 20),
    CompressionTier("large", 1024, 256, 7, 18),
    CompressionTier("xlarge", 2**31 - 1, 256, 6, 16),
)

QUALITY_FACTORS = {
    "high": 0.8,
    "balanced": 1.0,
    # The compact profile favors package size while retaining the
    # dimension-aware quality check.
    "compact": 1.5,
}


@dataclass(frozen=True)
class JpegTier:
    name: str
    max_dimension: int
    quality: int
    max_mean_error: float
    max_p95_error: float


# JPEG is only used for opaque images. It is especially effective for the
# large photographic background, while transparent UI art remains PNG.
JPEG_TIERS = (
    JpegTier("jpeg-medium", 1024, 97, 3.0, 10),
    JpegTier("jpeg-large", 1536, 94, 3.5, 11),
    JpegTier("jpeg-xlarge", 2**31 - 1, 92, 3.5, 11),
)


def format_size(size: int) -> str:
    value = float(size)
    for unit in ("B", "KiB", "MiB", "GiB"):
        if value < 1024 or unit == "GiB":
            return f"{value:.2f} {unit}"
        value /= 1024
    return f"{size} B"


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def should_exclude(relative_path: Path, patterns: list[str]) -> bool:
    path_text = relative_path.as_posix()
    return any(relative_path.match(pattern) or path_text == pattern for pattern in patterns)


def load_image(source: Path) -> Image.Image:
    with Image.open(source) as opened:
        opened.load()
        return opened.copy()


def select_tier(
    dimensions: tuple[int, int],
    color_limit: int | None,
    quality: str,
) -> CompressionTier:
    max_dimension = max(dimensions)
    for tier in COMPRESSION_TIERS:
        if max_dimension <= tier.max_dimension:
            if tier.max_colors is None or color_limit is None:
                colors = tier.max_colors
            else:
                colors = min(tier.max_colors, color_limit)
            factor = QUALITY_FACTORS[quality]
            return CompressionTier(
                tier.name,
                tier.max_dimension,
                colors,
                tier.max_mean_error * factor,
                tier.max_p95_error * factor,
            )
    raise ValueError(f"unsupported image dimensions: {dimensions}")


def has_alpha(image: Image.Image) -> bool:
    return "A" in image.getbands() or "transparency" in image.info


def select_jpeg_tier(dimensions: tuple[int, int], quality: str) -> JpegTier:
    max_dimension = max(dimensions)
    for tier in JPEG_TIERS:
        if max_dimension <= tier.max_dimension:
            quality_delta = {"high": 2, "balanced": 0, "compact": -2}[quality]
            return JpegTier(
                tier.name,
                tier.max_dimension,
                max(85, min(100, tier.quality + quality_delta)),
                tier.max_mean_error * QUALITY_FACTORS[quality],
                tier.max_p95_error * QUALITY_FACTORS[quality],
            )
    raise ValueError(f"unsupported image dimensions: {dimensions}")


def make_candidate(image: Image.Image, colors: int | None) -> Image.Image:
    # A previous run already produced a palette PNG. Re-quantizing it can
    # slowly change colors on every run, so keep it and only optimize encoding.
    if image.mode == "P" or colors is None or not has_alpha(image):
        return image.copy()
    rgba = image.convert("RGBA")
    return rgba.quantize(
        colors=colors,
        method=Image.Quantize.FASTOCTREE,
        dither=Image.Dither.NONE,
    )


def resize_candidate(
    image: Image.Image,
    relative_path: Path,
    allow_resize: bool,
) -> tuple[Image.Image, tuple[int, int] | None]:
    """Downsample only explicitly profiled assets, preserving aspect ratio."""
    if not allow_resize:
        return image.copy(), None

    target = DISPLAY_SIZE_PROFILES.get(relative_path.as_posix())
    if not target or image.size[0] <= target[0] and image.size[1] <= target[1]:
        return image.copy(), None

    scale = min(target[0] / image.size[0], target[1] / image.size[1])
    resized_size = (
        max(1, round(image.size[0] * scale)),
        max(1, round(image.size[1] * scale)),
    )
    resized = image.resize(resized_size, Image.Resampling.LANCZOS)
    if has_alpha(image):
        resized = resized.convert("RGBA")
    return resized, target


def quality_errors(original: Image.Image, candidate: Image.Image) -> tuple[float, float]:
    """Return mean and 95th percentile visible channel error on a sample."""
    original_rgba = original.convert("RGBA")
    candidate_rgba = candidate.convert("RGBA")
    if original_rgba.size != candidate_rgba.size:
        original_rgba = original_rgba.resize(candidate_rgba.size, Image.Resampling.LANCZOS)
    original_pixels = original_rgba.load()
    candidate_pixels = candidate_rgba.load()
    width, height = original_rgba.size
    sample_count = min(width * height, 20_000)
    step = max(1, (width * height) // sample_count)
    errors: list[float] = []

    for index in range(0, width * height, step):
        x = index % width
        y = index // width
        source_pixel = original_pixels[x, y]
        candidate_pixel = candidate_pixels[x, y]
        if source_pixel[3] == 0 and candidate_pixel[3] == 0:
            continue

        alpha_weight = source_pixel[3] / 255
        rgb_error = max(
            abs(source_pixel[channel] - candidate_pixel[channel]) * alpha_weight
            for channel in range(3)
        )
        alpha_error = abs(source_pixel[3] - candidate_pixel[3])
        errors.append(max(rgb_error, alpha_error))

    if not errors:
        return 0, 0
    errors.sort()
    p95_index = min(len(errors) - 1, int(len(errors) * 0.95))
    return sum(errors) / len(errors), errors[p95_index]


def passes_quality_check(
    original: Image.Image,
    candidate: Image.Image,
    tier: CompressionTier,
) -> tuple[bool, float, float]:
    if tier.max_colors is None:
        return True, 0, 0
    mean_error, p95_error = quality_errors(original, candidate)
    return (
        mean_error <= tier.max_mean_error and p95_error <= tier.max_p95_error,
        mean_error,
        p95_error,
    )


def passes_error_limits(
    original: Image.Image,
    candidate: Image.Image,
    max_mean_error: float,
    max_p95_error: float,
) -> tuple[bool, float, float]:
    mean_error, p95_error = quality_errors(original, candidate)
    return (
        mean_error <= max_mean_error and p95_error <= max_p95_error,
        mean_error,
        p95_error,
    )


def encoded_png(image: Image.Image, source: Path) -> bytes:
    """Return optimized PNG bytes and validate its dimensions."""
    original_size = image.size
    with tempfile.NamedTemporaryFile(
        prefix=f".{source.stem}.",
        suffix=".tmp",
        dir=source.parent,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)

    try:
        image.save(temporary_path, format="PNG", optimize=True)
        with Image.open(temporary_path) as encoded:
            if encoded.size != original_size:
                raise ValueError(
                    f"dimensions changed from {original_size} to {encoded.size}"
                )
        return temporary_path.read_bytes()
    finally:
        temporary_path.unlink(missing_ok=True)


def encoded_jpeg(
    image: Image.Image,
    source: Path,
    quality: int,
) -> tuple[bytes, Image.Image]:
    """Return optimized JPEG bytes and a decoded copy for quality checking."""
    original_size = image.size
    with tempfile.NamedTemporaryFile(
        prefix=f".{source.stem}.",
        suffix=".tmp",
        dir=source.parent,
        delete=False,
    ) as temporary:
        temporary_path = Path(temporary.name)

    try:
        image.convert("RGB").save(
            temporary_path,
            format="JPEG",
            quality=quality,
            optimize=True,
            progressive=True,
        )
        with Image.open(temporary_path) as encoded:
            encoded.load()
            if encoded.size != original_size:
                raise ValueError(
                    f"dimensions changed from {original_size} to {encoded.size}"
                )
            decoded = encoded.convert("RGBA").copy()
        return temporary_path.read_bytes(), decoded
    finally:
        temporary_path.unlink(missing_ok=True)


def write_atomically(path: Path, data: bytes, mode_source: Path | None = None) -> None:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{path.stem}.",
            suffix=".tmp",
            dir=path.parent,
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(data)
            temporary.flush()
            os.fsync(temporary.fileno())
        if path.exists():
            shutil.copymode(path, temporary_path)
        elif mode_source and mode_source.exists():
            shutil.copymode(mode_source, temporary_path)
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path:
            temporary_path.unlink(missing_ok=True)


def backup_original(source: Path, resources_root: Path, backup_root: Path) -> None:
    target = backup_root / source.relative_to(resources_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Never overwrite an existing backup. This keeps the first original safe
    # when the compression script is run more than once.
    if not target.exists():
        shutil.copy2(source, target)
    source_meta = source.with_name(source.name + ".meta")
    if source_meta.exists():
        target_meta = target.with_name(target.name + ".meta")
        if not target_meta.exists():
            shutil.copy2(source_meta, target_meta)


def update_meta_extension(
    source: Path,
    target: Path,
) -> bytes | None:
    """Update the generated image meta file while preserving its UUID."""
    source_meta = source.with_name(source.name + ".meta")
    if not source_meta.exists():
        return None

    metadata = json.loads(source_meta.read_text(encoding="utf-8"))
    files = metadata.get("files")
    if not isinstance(files, list) or source.suffix not in files:
        raise ValueError(f"image meta does not contain {source.suffix}: {source_meta}")
    metadata["files"] = [target.suffix if value == source.suffix else value for value in files]
    return (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def replace_with_jpeg(
    source: Path,
    target: Path,
    data: bytes,
    meta_data: bytes,
    resources_root: Path,
    backup_root: Path | None,
) -> None:
    target_meta = target.with_name(target.name + ".meta")
    source_meta = source.with_name(source.name + ".meta")
    replacing_same_path = source == target
    if not replacing_same_path and (target.exists() or target_meta.exists()):
        raise FileExistsError(f"JPEG target already exists: {target}")
    if not source_meta.exists():
        raise FileNotFoundError(f"source meta is required for JPEG conversion: {source_meta}")

    if backup_root:
        backup_original(source, resources_root, backup_root)
    write_atomically(target, data, source)
    try:
        if not replacing_same_path:
            write_atomically(target_meta, meta_data, source_meta)
            source.unlink()
            if source_meta.exists():
                source_meta.unlink()
    except OSError:
        # The original is still recoverable when --backup-dir was supplied.
        if not replacing_same_path:
            target.unlink(missing_ok=True)
            target_meta.unlink(missing_ok=True)
        raise


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compress PNG/JPEG files under assets/resources in place."
    )
    parser.add_argument(
        "--resources",
        type=Path,
        default=Path("assets/resources"),
        help="resource directory, relative to the current directory (default: assets/resources)",
    )
    parser.add_argument(
        "--colors",
        type=int,
        help="upper limit for adaptive palette colors, from 2 to 256 (default: tier-based)",
    )
    parser.add_argument(
        "--quality",
        choices=tuple(QUALITY_FACTORS),
        default="compact",
        help="quality/size tradeoff: high, balanced, or compact (default: compact)",
    )
    parser.add_argument(
        "--lossless",
        action="store_true",
        help="disable palette quantization and only optimize PNG encoding",
    )
    parser.add_argument(
        "--opaque-format",
        choices=("png", "jpg"),
        default="jpg",
        help="format for large opaque images: png or jpg (default: jpg)",
    )
    parser.add_argument(
        "--opaque-min-dimension",
        type=int,
        default=512,
        help="minimum long edge for opaque images to use JPG (default: 512px)",
    )
    parser.add_argument(
        "--min-savings",
        type=float,
        default=0.01,
        help="minimum fractional saving before replacing a file (default: 0.01)",
    )
    backup_group = parser.add_mutually_exclusive_group()
    backup_group.add_argument(
        "--backup-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "cat-world-originals",
        help="directory for original image files (default: system temp/cat-world-originals)",
    )
    backup_group.add_argument(
        "--no-backup",
        action="store_true",
        help="do not keep original image backups",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="PATTERN",
        help="exclude a relative path or glob; may be repeated",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="calculate savings without changing files",
    )
    args = parser.parse_args()

    if args.colors is not None and not 2 <= args.colors <= 256:
        parser.error("--colors must be between 2 and 256")
    if args.opaque_min_dimension < 1:
        parser.error("--opaque-min-dimension must be at least 1")
    if not 0 <= args.min_savings < 1:
        parser.error("--min-savings must be between 0 and 1")
    if args.lossless:
        args.colors = None
    return args


def main() -> int:
    args = parse_args()
    resources_root = args.resources.expanduser().resolve()
    if not resources_root.is_dir():
        print(f"[CatWorld] Resource directory does not exist: {resources_root}", file=sys.stderr)
        return 2

    backup_root = None if args.no_backup else args.backup_dir.expanduser().resolve()
    if backup_root and is_relative_to(backup_root, resources_root):
        print("[CatWorld] --backup-dir must be outside the resource directory", file=sys.stderr)
        return 2

    sources = sorted(
        source
        for source in resources_root.rglob("*")
        if source.is_file()
        and source.suffix.lower() in IMAGE_SUFFIXES
        and not should_exclude(source.relative_to(resources_root), args.exclude)
    )
    if not sources:
        print(f"[CatWorld] No PNG/JPEG files found under {resources_root}")
        return 0

    before_total = sum(source.stat().st_size for source in sources)
    changed = 0
    skipped = 0
    failed = 0
    saved_total = 0

    for source in sources:
        original_bytes = source.stat().st_size
        relative_path = source.relative_to(resources_root)
        source_suffix = source.suffix.lower()
        try:
            original_image = load_image(source)
            dimensions = original_image.size

            # Existing JPEGs are re-encoded in place. Lossless mode and an
            # explicit PNG output request leave them untouched rather than
            # writing PNG bytes into a .jpg path.
            if source_suffix in JPEG_SUFFIXES and (
                args.lossless or args.opaque_format != "jpg"
            ):
                skipped += 1
                continue

            working_image, resized_to = resize_candidate(
                original_image,
                relative_path,
                allow_resize=not args.lossless,
            )
            resize_profile = (
                f"resize={dimensions[0]}x{dimensions[1]}"
                f"->{working_image.size[0]}x{working_image.size[1]}"
                if resized_to
                else ""
            )

            is_opaque = not has_alpha(original_image)
            should_try_jpeg = (
                not args.lossless
                and args.opaque_format == "jpg"
                and is_opaque
                and (
                    source_suffix in JPEG_SUFFIXES
                    or max(dimensions) >= args.opaque_min_dimension
                )
            )
            if should_try_jpeg:
                jpeg_target = source.with_suffix(JPEG_SUFFIX)
                jpeg_tier = select_jpeg_tier(dimensions, args.quality)
                compressed, jpeg_candidate = encoded_jpeg(
                    working_image,
                    source,
                    jpeg_tier.quality,
                )
                quality_ok, mean_error, p95_error = passes_error_limits(
                    original_image,
                    jpeg_candidate,
                    jpeg_tier.max_mean_error,
                    jpeg_tier.max_p95_error,
                )
                if quality_ok:
                    meta_data = update_meta_extension(source, jpeg_target)
                    if meta_data is None:
                        quality_ok = False
                        profile = f"{jpeg_tier.name}/missing-meta"
                    else:
                        profile = (
                            f"{jpeg_tier.name}/q{jpeg_tier.quality}"
                            f"({mean_error:.1f}/{p95_error:.1f})"
                        )
                else:
                    meta_data = None
                    profile = (
                        f"{jpeg_tier.name}/png-fallback"
                        f"({mean_error:.1f}/{p95_error:.1f})"
                    )

                if quality_ok:
                    compressed_format = "jpg"
                else:
                    # JPEG did not pass the error limits. PNG sources can
                    # still use the normal PNG path; an existing JPEG stays
                    # in its original format.
                    if source_suffix in JPEG_SUFFIXES:
                        skipped += 1
                        continue
                    compressed = None
                    compressed_format = "png"
            else:
                compressed = None
                compressed_format = "png"
                meta_data = None
                profile = ""

            if compressed is None:
                if args.lossless:
                    tier = CompressionTier("lossless", 2**31 - 1, None, 0, 0)
                    candidate = working_image
                else:
                    tier = select_tier(working_image.size, args.colors, args.quality)
                    candidate = make_candidate(working_image, tier.max_colors)
                png_quality_ok, png_mean_error, png_p95_error = passes_quality_check(
                    original_image,
                    candidate,
                    tier,
                )
                if not png_quality_ok:
                    candidate = working_image
                    png_profile = (
                        f"{tier.name}/lossless-fallback"
                        f"({png_mean_error:.1f}/{png_p95_error:.1f})"
                    )
                else:
                    png_profile = tier.name
                compressed = encoded_png(candidate, source)
                profile = f"{profile}; {png_profile}" if profile else png_profile
            if resize_profile:
                profile = f"{resize_profile}; {profile}" if profile else resize_profile
        except (OSError, UnidentifiedImageError, ValueError) as error:
            failed += 1
            print(f"[CatWorld] ERROR {relative_path}: {error}", file=sys.stderr)
            continue

        savings = 1 - len(compressed) / original_bytes if original_bytes else 0
        if len(compressed) >= original_bytes or savings < args.min_savings:
            skipped += 1
            continue

        if not args.dry_run:
            try:
                if compressed_format == "jpg":
                    replace_with_jpeg(
                        source,
                        source.with_suffix(JPEG_SUFFIX),
                        compressed,
                        meta_data,
                        resources_root,
                        backup_root,
                    )
                else:
                    if backup_root:
                        backup_original(source, resources_root, backup_root)
                    write_atomically(source, compressed)
            except OSError as error:
                failed += 1
                print(f"[CatWorld] ERROR {relative_path}: {error}", file=sys.stderr)
                continue

        changed += 1
        saved_total += original_bytes - len(compressed)
        action = "would compress" if args.dry_run else "compressed"
        print(
            f"[CatWorld] {action} {relative_path} "
            f"{format_size(original_bytes)} -> {format_size(len(compressed))} "
            f"({savings:.1%}, {dimensions[0]}x{dimensions[1]} -> "
            f"{working_image.size[0]}x{working_image.size[1]}, "
            f"{compressed_format.upper()}, {profile})"
        )

    after_total = before_total - saved_total
    print(
        f"[CatWorld] {'Preview' if args.dry_run else 'Done'}: "
        f"{changed} changed, {skipped} skipped, {failed} failed; "
        f"image total {format_size(before_total)} -> {format_size(after_total)}, "
        f"saved {format_size(saved_total)}"
    )
    if args.dry_run:
        print("[CatWorld] Dry run: no files were changed.")
    if backup_root and changed and not args.dry_run:
        print(f"[CatWorld] Originals are available at {backup_root}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
