"""Pixel comparison: 1st Floor vs floor N, as the app draws them (base, then
each shop's status layer clipped to its outline).

usage: python3 diag.py <n> <base> <layer_prefix>
writes diagN.png (rows: right column, left column, front row, front middle;
columns: 1st base | N base | 1st tinted | N tinted) and prints tone stats."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw

n, base_path, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
u = json.load(open('units.json'))[0]
st = {s['id']: s for s in (u['unit_statuses'] or [])}
look = {}
for v in u['variants']:
    for x in v['units']:
        s = st.get(x.get('tag'))
        k = (s['name'] if s else x.get('status', 'available')).lower()
        look[x['id']] = k if k in ('available', 'hold', 'landowner', 'reserved') else None


def poly(b, W, H):
    if b.get('shape'):
        return [(x * W, y * H) for x, y in b['shape']]
    x0, y0, x1, y1 = b['x'] * W, b['y'] * H, (b['x'] + b['w']) * W, (b['y'] + b['h']) * H
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def compose(fl, bp, pre):
    base = Image.open(bp).convert('RGB'); W, H = base.size
    shapes = json.load(open(f'shapes{fl}.json'))
    out = base.copy(); layers = {}
    for b in shapes:
        k = look.get(b['unitId'])
        if not k:
            continue
        layers.setdefault(k, Image.open(f'{pre}-{k}.webp').convert('RGB'))
        m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).polygon(poly(b, W, H), fill=255)
        out.paste(layers[k], (0, 0), m)
    return base, out, shapes


def crop(img, shapes, ids, margin):
    W, H = img.size
    pts = [p for b in shapes if b['unitId'] in ids for p in poly(b, W, H)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return img.crop((int(min(xs) - margin), int(min(ys) - margin), int(max(xs) + margin), int(max(ys) + margin)))


def stats(fl, img, shapes, label):
    a = np.asarray(img).astype(np.float32); H, W = a.shape[:2]
    for k in ('available', 'hold', 'landowner'):
        inner = Image.new('L', (W, H), 0); rim = Image.new('L', (W, H), 0)
        d1, d2 = ImageDraw.Draw(inner), ImageDraw.Draw(rim)
        cnt = 0
        for b in shapes:
            if look.get(b['unitId']) != k:
                continue
            p = poly(b, W, H); xs = [q[0] for q in p]; ys = [q[1] for q in p]
            cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
            sh = [(cx + (x - cx) * 0.7, cy + (y - cy) * 0.7) for x, y in p]
            d1.polygon(sh, fill=255); d2.polygon(p, fill=255); cnt += 1
        if not cnt:
            continue
        m = np.asarray(inner) > 0
        px = a[m]; L = 0.299 * px[:, 0] + 0.587 * px[:, 1] + 0.114 * px[:, 2]
        mx, mn = px.max(1), px.min(1); sat = ((mx - mn) / np.maximum(mx, 1)).mean()
        print(f'  floor {fl} {label} {k:9s} shops {cnt:2d} interior mean {px.mean(0).round().astype(int)} L {L.mean():5.1f} Lstd {L.std():4.1f} sat {sat:.3f}')


b1, t1, s1 = compose('1', 'f1-base.webp', 'f1')
bn, tn, sn = compose(n, base_path, prefix)
groups = [
    (['SHOP-111', 'SHOP-110', 'SHOP-109'], {'2': ['SHOP-211', 'SHOP-210', 'SHOP-209'], '3': ['SHOP-311', 'SHOP-310', 'SHOP-309'], '4': ['SHOP-411', 'SHOP-410', 'SHOP-409'], '5': ['SHOP-514', 'SHOP-515', 'SHOP-516']}),
    (['SHOP-120', 'SHOP-121', 'SHOP-122'], {'2': ['SHOP-221', 'SHOP-222', 'SHOP-223'], '3': ['SHOP-321', 'SHOP-322', 'SHOP-323'], '4': ['SHOP-421', 'SHOP-422', 'SHOP-423'], '5': ['SHOP-505', 'SHOP-504', 'SHOP-503']}),
    (['SHOP-101', 'SHOP-102'], {'2': ['SHOP-201', 'SHOP-202'], '3': ['SHOP-301', 'SHOP-302'], '4': ['SHOP-401', 'SHOP-402'], '5': ['SHOP-501', 'SHOP-502']}),
    (['SHOP-103', 'SHOP-104', 'SHOP-105'], {'2': ['SHOP-203', 'SHOP-204', 'SHOP-205'], '3': ['SHOP-303', 'SHOP-304', 'SHOP-305'], '4': ['SHOP-403', 'SHOP-404', 'SHOP-405'], '5': ['SHOP-521', 'SHOP-522']}),
]
CH = 300
rows = []
for ids1, idsn in groups:
    cells = [crop(b1, s1, ids1, 50), crop(bn, sn, idsn[n], 50), crop(t1, s1, ids1, 50), crop(tn, sn, idsn[n], 50)]
    cells = [c.resize((max(1, int(c.width * CH / c.height)), CH)) for c in cells]
    rows.append(cells)
Wp = max(sum(c.width for c in r) + 30 for r in rows)
panel = Image.new('RGB', (Wp, len(rows) * (CH + 10)), (255, 255, 255))
for i, r in enumerate(rows):
    x = 0
    for c in r:
        panel.paste(c, (x, i * (CH + 10))); x += c.width + 10
panel.save(f'diag{n}.png')
stats('1', t1, s1, 'tinted')
stats(n, tn, sn, 'tinted')
for fl, img in (('1', b1), (n, bn)):
    a = np.asarray(img).astype(np.float32); H, W = a.shape[:2]
    print(f'  floor {fl} outside {a[:int(.05*H), :int(.06*W)].reshape(-1, 3).mean(0).round().astype(int)}')
