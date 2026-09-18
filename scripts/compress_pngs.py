#!/usr/bin/env python3
"""
PNG 图片压缩脚本：使用 pngquant（有损压缩，保留透明度）将大 PNG 压缩 60-80%。

安装依赖：
  brew install pngquant  # macOS

用法：
  python3 scripts/compress_pngs.py --dry-run  # 预览效果，不实际修改
  python3 scripts/compress_pngs.py            # 实际压缩
"""

import argparse
import os
import subprocess
from pathlib import Path

def compress_png(file_path: Path, dry_run: bool = False) -> tuple[int, int]:
    """
    压缩单个 PNG 文件。

    Returns:
        (原始大小 KB, 压缩后大小 KB)
    """
    original_size = file_path.stat().st_size

    # pngquant 参数：
    #   --quality 70-85: 质量范围（越低越小，但会丢细节）
    #   --speed 1: 最慢速度，最佳质量
    #   --force: 覆盖已存在的输出文件
    #   --ext .png: 直接替换原文件
    temp_path = file_path.with_suffix('.compressed.png')

    cmd = [
        'pngquant',
        '--quality', '70-85',
        '--speed', '1',
        '--output', str(temp_path),
        str(file_path)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if result.returncode != 0:
            # pngquant 返回 99 表示已经足够小，跳过
            if result.returncode == 99:
                return (original_size // 1024, original_size // 1024)
            print(f"  ⚠️  压缩失败: {file_path.name} (错误码 {result.returncode})")
            return (original_size // 1024, original_size // 1024)

        compressed_size = temp_path.stat().st_size

        # 只有压缩率 > 10% 才替换
        if compressed_size < original_size * 0.9:
            if not dry_run:
                temp_path.replace(file_path)
                print(f"  ✅ {file_path.name}: {original_size // 1024}KB → {compressed_size // 1024}KB "
                      f"(-{100 - compressed_size * 100 // original_size}%)")
            else:
                print(f"  📋 {file_path.name}: {original_size // 1024}KB → {compressed_size // 1024}KB "
                      f"(-{100 - compressed_size * 100 // original_size}%)")
                temp_path.unlink()
            return (original_size // 1024, compressed_size // 1024)
        else:
            temp_path.unlink()
            return (original_size // 1024, original_size // 1024)

    except FileNotFoundError:
        print("❌ pngquant 未安装，请运行: brew install pngquant")
        exit(1)

def main():
    parser = argparse.ArgumentParser(description='压缩 assets/resources/ 下的大 PNG 文件')
    parser.add_argument('--dry-run', action='store_true', help='预览效果，不实际修改文件')
    parser.add_argument('--min-size', type=int, default=50, help='只压缩大于 N KB 的文件（默认 50）')
    args = parser.parse_args()

    resources_dir = Path(__file__).parent.parent / 'assets' / 'resources'

    if not resources_dir.exists():
        print(f"❌ 找不到资源目录: {resources_dir}")
        exit(1)

    # 找出所有大于阈值的 PNG
    png_files = [
        f for f in resources_dir.rglob('*.png')
        if f.stat().st_size > args.min_size * 1024
    ]

    if not png_files:
        print(f"✅ 没有找到大于 {args.min_size}KB 的 PNG 文件")
        return

    print(f"📦 找到 {len(png_files)} 个大于 {args.min_size}KB 的 PNG 文件")
    print(f"{'🔍 [预览模式]' if args.dry_run else '⚙️  [压缩模式]'}\n")

    total_before = 0
    total_after = 0

    for png_file in sorted(png_files, key=lambda f: f.stat().st_size, reverse=True):
        before, after = compress_png(png_file, args.dry_run)
        total_before += before
        total_after += after

    print(f"\n📊 总计: {total_before}KB → {total_after}KB "
          f"(节省 {total_before - total_after}KB, -{100 - total_after * 100 // total_before if total_before > 0 else 0}%)")

    if args.dry_run:
        print("\n💡 执行实际压缩: python3 scripts/compress_pngs.py")

if __name__ == '__main__':
    main()
