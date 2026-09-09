#!/usr/bin/env python3
"""Crop a sprite sheet with the Cat World image-asset skill's validator."""
from __future__ import annotations

import sys
from pathlib import Path


SKILL_SCRIPTS = Path(__file__).resolve().parents[1] / ".codex" / "skills" / "cat-world-image-assets" / "scripts"
if str(SKILL_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SKILL_SCRIPTS))

from crop_sprite_sheet import crop_sheet, main  # noqa: E402

__all__ = ["crop_sheet", "main"]


if __name__ == "__main__":
    raise SystemExit(main())
