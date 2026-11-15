"""Native-resolution crops of a floor as the app draws it (base + status
layers clipped to shop outlines), with the outlines drawn in red on a copy.
usage: python3 zoom.py <n> <base> <prefix> <out> <x0 y0 x1 y1 fractions>"""
import json, sys
from PIL import Image, ImageDraw
n, bp, pre, out = sys.argv[1:5]
x0, y0, x1, y1 = [float(v) for v in sys.argv[5:9]]
u = json.load(open('units.json'))[0]
st = {s['id']: s for s in (u['unit_statuses'] or [])}
look = {}
for v in u['variants']:
    for x in v['units']:
        s = st.get(x.get('tag'))
        k = (s['name'] if s else x.get('status', 'available')).lower()
        look[x['id']] = k if k in ('available', 'hold', 'landowner', 'reserved') else None
base = Image.open(bp).convert('RGB'); W, H = base.size
shapes = json.load(open(f'shapes{n}.json'))
def poly(b):
    if b.get('shape'): return [(x * W, y * H) for x, y in b['shape']]
    a, c, d, e = b['x'] * W, b['y'] * H, (b['x'] + b['w']) * W, (b['y'] + b['h']) * H
    return [(a, c), (d, c), (d, e), (a, e)]
comp = base.copy(); layers = {}
for b in shapes:
    k = look.get(b['unitId'])
    if not k: continue
    layers.setdefault(k, Image.open(f'{pre}-{k}.webp').convert('RGB'))
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(poly(b), fill=255)
    comp.paste(layers[k], (0, 0), m)
box = (int(x0 * W), int(y0 * H), int(x1 * W), int(y1 * H))
a = comp.crop(box)
lines = comp.copy(); d = ImageDraw.Draw(lines)
for b in shapes: d.polygon(poly(b), outline=(255, 40, 40))
bb = lines.crop(box)
s = Image.new('RGB', (a.width * 2 + 10, a.height), (255, 255, 255)); s.paste(a, (0, 0)); s.paste(bb, (a.width + 10, 0))
s.save(out)
