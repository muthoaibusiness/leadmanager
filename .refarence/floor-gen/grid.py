"""Crop of a floor's original art (3x) with a labelled pixel grid.
usage: python3 grid.py <art.png> <x0> <y0> <x1> <y1> <step> <out.png>"""
import sys
from PIL import Image, ImageDraw
src, x0, y0, x1, y1, step, out = sys.argv[1], *map(int, sys.argv[2:7]), sys.argv[7]
im = Image.open(src).convert('RGB')
if im.width < 1500: im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS)
c = im.crop((x0, y0, x1, y1)); d = ImageDraw.Draw(c)
for x in range((x0 // step + 1) * step, x1, step):
    d.line([(x - x0, 0), (x - x0, c.height)], fill=(255, 0, 255), width=1); d.text((x - x0 + 2, 2), str(x), fill=(255, 255, 0))
for y in range((y0 // step + 1) * step, y1, step):
    d.line([(0, y - y0), (c.width, y - y0)], fill=(0, 255, 255), width=1); d.text((2, y - y0 + 2), str(y), fill=(255, 255, 0))
c.save(out)
