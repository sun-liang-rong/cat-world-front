"""Turn the generated cat preview into small project-ready icon assets."""

from pathlib import Path
import colorsys

from PIL import Image


SOURCE = Path('/tmp/cat-world-cat-orange.png')
OUTPUT = Path(__file__).resolve().parents[1] / 'assets' / 'resources'


def remove_chroma(image: Image.Image) -> Image.Image:
    rgba = image.convert('RGBA')
    pixels = []
    for red, green, blue, _alpha in rgba.getdata():
        chroma = red > 170 and blue > 150 and green < 125 and blue - green > 45
        pixels.append((red, green, blue, 0 if chroma else 255))
    rgba.putdata(pixels)
    box = rgba.getbbox()
    if not box:
        raise RuntimeError('Generated image did not contain a foreground subject')
    cropped = rgba.crop(box)
    size = max(cropped.width, cropped.height)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(cropped, ((size - cropped.width) // 2, (size - cropped.height) // 2))
    return canvas.resize((256, 256), Image.Resampling.LANCZOS)


def recolor(image: Image.Image, hue: float, saturation: float, value_scale: float) -> Image.Image:
    result = image.copy()
    pixels = []
    for red, green, blue, alpha in image.getdata():
        if alpha == 0:
            pixels.append((red, green, blue, alpha))
            continue
        h, s, v = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        if red > green + 12 and red > blue + 12:
            h = hue
            s = min(1, max(s, saturation))
            v = min(1, v * value_scale)
            red, green, blue = [round(channel * 255) for channel in colorsys.hsv_to_rgb(h, s, v)]
        pixels.append((red, green, blue, alpha))
    result.putdata(pixels)
    return result


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f'Missing generated source: {SOURCE}')
    base = remove_chroma(Image.open(SOURCE))
    cats = {
        'cat_orange': base,
        'cat_white': recolor(base, 0.12, 0.04, 1.1),
        'cat_black': recolor(base, 0.95, 0.08, 0.48),
        'cat_ragdoll': recolor(base, 0.08, 0.28, 0.88),
        'cat_aurora': recolor(base, 0.50, 0.40, 0.95),
    }
    cats_dir = OUTPUT / 'cats'
    cats_dir.mkdir(parents=True, exist_ok=True)
    for name, image in cats.items():
        image.save(cats_dir / f'{name}.png', 'PNG')

    shop_dir = OUTPUT / 'shop'
    shop_dir.mkdir(parents=True, exist_ok=True)
    for name, draw in {
        'item_hammer': draw_hammer,
        'item_dice': draw_dice,
        'item_extra_slot': draw_extra_slot,
        'item_glove': draw_glove,
    }.items():
        icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
        draw(icon)
        icon.save(shop_dir / f'{name}.png', 'PNG')

    tasks_dir = OUTPUT / 'tasks'
    tasks_dir.mkdir(parents=True, exist_ok=True)
    chest = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    draw_chest(chest)
    chest.save(tasks_dir / 'daily_chest.png', 'PNG')


def draw_hammer(image: Image.Image) -> None:
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((117, 55, 139, 210), 10, fill='#704830', outline='#e29a30', width=8)
    draw.rounded_rectangle((54, 45, 196, 88), 16, fill='#e29a30', outline='#704830', width=8)


def draw_dice(image: Image.Image) -> None:
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((47, 47, 209, 209), 28, fill='#f4b947', outline='#704830', width=9)
    for x, y in ((86, 86), (170, 86), (128, 128), (86, 170), (170, 170)):
        draw.ellipse((x - 11, y - 11, x + 11, y + 11), fill='#704830')


def draw_extra_slot(image: Image.Image) -> None:
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((37, 74, 219, 182), 24, fill='#fff8e2', outline='#704830', width=9)
    draw.line((80, 128, 176, 128), fill='#f18b2f', width=14)
    draw.line((128, 80, 128, 176), fill='#f18b2f', width=14)


def draw_glove(image: Image.Image) -> None:
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((73, 91, 183, 208), 28, fill='#d7e0e7', outline='#704830', width=9)
    for x, top in ((78, 25), (104, 13), (130, 20), (156, 39)):
        draw.rounded_rectangle((x, top, x + 25, 135), 12, fill='#d7e0e7', outline='#704830', width=8)


def draw_chest(image: Image.Image) -> None:
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((32, 82, 224, 194), 22, fill='#f19d36', outline='#ae6023', width=10)
    draw.rounded_rectangle((32, 52, 224, 124), 22, fill='#f7bd4e', outline='#ae6023', width=10)
    draw.line((32, 119, 224, 119), fill='#ae6023', width=10)
    draw.rectangle((119, 80, 137, 196), fill='#ffe06c')
    draw.rectangle((112, 109, 144, 143), fill='#ffe06c', outline='#ae6023', width=6)


if __name__ == '__main__':
    main()
