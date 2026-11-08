"""Render a floor the way the app does (FloorPlanCanvas, tinted artwork):
base image, then each shop's status layer clipped to its polygon.
usage: python3 render.py <floor 1-5> <base> <layer_prefix> <out.png> [crop x0 y0 x1 y1 as fractions]"""
import json, sys
from PIL import Image, ImageDraw
n, base_path, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
crop = [float(v) for v in sys.argv[5:9]] if len(sys.argv) >= 9 else None
u = json.load(open('units.json'))[0]
statuses = {s['id']: s for s in (u['unit_statuses'] or [])}
look = {}
for v in u['variants']:
    for x in v['units']:
        s = statuses.get(x.get('tag'))
        key = (s['name'] if s else x.get('status', 'available')).lower()
        look[x['id']] = key if key in ('available', 'hold', 'landowner', 'reserved') else None
shapes = json.load(open(f'shapes{n}.json'))
base = Image.open(base_path).convert('RGB'); W, H = base.size
layers = {}
out_im = base.copy()
for b in shapes:
    k = look.get(b['unitId'])
    if not k: continue
    if k not in layers: layers[k] = Image.open(f'{prefix}-{k}.webp').convert('RGB')
    pts = [(x * W, y * H) for x, y in b['shape']] if b.get('shape') else [(b['x'] * W, b['y'] * H), ((b['x'] + b['w']) * W, b['y'] * H), ((b['x'] + b['w']) * W, (b['y'] + b['h']) * H), (b['x'] * W, (b['y'] + b['h']) * H)]
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(pts, fill=255)
    out_im.paste(layers[k], (0, 0), m)
if crop: out_im = out_im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
out_im.thumbnail((1100, 1100)); out_im.save(out)
