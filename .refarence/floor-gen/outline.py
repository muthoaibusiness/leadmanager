"""Clean shop outlines, the way the 1st Floor's were made: each shop is a
polygon with straight sides that sits on the drawn rim (the pale bevel line),
so colour fills the shop up to the rim and never crosses it.

For every shop, inside a window around its stored box:
  - sample the rim along each side (scan from the inside outward for the
    rim's bright peak), many samples per side;
  - fit one straight line per side through the samples, robustly (repeated
    least squares dropping the worst 20%), so pillars, door marks and stray
    pixels do not bend the edge; a near-flat or near-vertical side snaps;
  - the outline is the four corners where the side lines meet.
Shops whose drawn form is not a quadrilateral (the cut corner of SHOP-x01,
the stepped SHOP-206/-520) are set by hand in SPECIAL below, read off the
drawing with a pixel grid (grid.py).

usage: python3 outline.py <n> <art.png> <boxes.json> <out.json> [preview.png]
coordinates: the 3x art (same size as the floor's base image)."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

n, art, boxes_path, out_path = sys.argv[1:5]
prev = sys.argv[5] if len(sys.argv) > 5 else None
im = Image.open(art).convert('RGB')
im = im.resize((im.width * 3, im.height * 3), Image.LANCZOS)
W, H = im.size
L = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(1.0))).astype(np.float32)
boxes = json.load(open(boxes_path))
M = int(0.014 * W)

# Hand-read outlines (3x art pixels), for shapes a quadrilateral cannot hold.
SPECIAL = {
    '2': {
        'SHOP-201': [(72, 2112), (640, 2112), (640, 2455), (300, 2510), (262, 2440), (102, 2478), (72, 2478)],
    },
    '3': {}, '4': {},
    '5': {
        'SHOP-501': [(66, 2152), (522, 2152), (522, 2425), (225, 2502), (187, 2420), (115, 2435), (66, 2435)],
    },
}


def peak_out(prof):
    """Index of the rim: the brightest point of the first strong ridge met
    walking outward, before the dark gap. None if no rim."""
    inner = float(np.median(prof[:8]))
    for j in range(4, len(prof)):
        if prof[j] > max(inner + 28, 92):
            p = j
            while p + 1 < len(prof) and prof[p + 1] >= prof[p]:
                p += 1
            return p
        if prof[j] < min(inner * 0.5, 26):
            return j - 1
    return None


def fit(pts, horizontal):
    """Robust line through (x, y) points. horizontal: y = a*x + b, else
    x = a*y + b. Returns (a, b)."""
    p = np.array(pts, float)
    u, v = (p[:, 0], p[:, 1]) if horizontal else (p[:, 1], p[:, 0])
    keep = np.ones(len(u), bool)
    for _ in range(4):
        a, b = np.polyfit(u[keep], v[keep], 1)
        r = np.abs(v - (a * u + b))
        if keep.sum() < 6:
            break
        keep = r <= max(1.5, np.percentile(r[keep], 80))
    a, b = np.polyfit(u[keep], v[keep], 1)
    if abs(a) < 0.012:  # straight: snap flat / plumb at the median
        a, b = 0.0, float(np.median(v[keep]))
    return a, b


def meet(h, v):
    """Corner of horizontal line y=a1x+b1 and vertical line x=a2y+b2."""
    a1, b1 = h; a2, b2 = v
    y = (a1 * b2 + b1) / (1 - a1 * a2)
    return (a2 * y + b2, y)


out, notes = [], []
for bx in boxes:
    u = bx['unitId']
    if u in SPECIAL.get(n, {}):
        poly = [(float(x), float(y)) for x, y in SPECIAL[n][u]]
        notes.append(f'{u} hand')
    else:
        x0, y0 = bx['x'] * W, bx['y'] * H
        x1, y1 = (bx['x'] + bx['w']) * W, (bx['y'] + bx['h']) * H
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        side = {'T': [], 'B': [], 'L': [], 'R': []}
        for t in np.linspace(0.12, 0.88, 40):
            xs, ys = x0 + t * (x1 - x0), y0 + t * (y1 - y0)
            # top / bottom: walk vertically from the centre band outward
            for key, start, sgn in (('T', cy - (y1 - y0) * 0.25, -1), ('B', cy + (y1 - y0) * 0.25, 1)):
                rng = np.arange(int(start), int((y0 - M) if sgn < 0 else (y1 + M)), sgn)
                rng = rng[(rng >= 0) & (rng < H)]
                if len(rng) < 10: continue
                j = peak_out(L[rng, int(xs)])
                if j is not None: side[key].append((xs, float(rng[j])))
            for key, start, sgn in (('L', cx - (x1 - x0) * 0.25, -1), ('R', cx + (x1 - x0) * 0.25, 1)):
                rng = np.arange(int(start), int((x0 - M) if sgn < 0 else (x1 + M)), sgn)
                rng = rng[(rng >= 0) & (rng < W)]
                if len(rng) < 10: continue
                j = peak_out(L[int(ys), rng])
                if j is not None: side[key].append((float(rng[j]), ys))
        lines, miss = {}, []
        for key in 'TBLR':
            if len(side[key]) >= 8:
                lines[key] = fit(side[key], key in 'TB')
            else:
                miss.append(key)
                lines[key] = (0.0, {'T': y0, 'B': y1}[key]) if key in 'TB' else (0.0, {'L': x0, 'R': x1}[key])
        tl, tr = meet(lines['T'], lines['L']), meet(lines['T'], lines['R'])
        br, bl = meet(lines['B'], lines['R']), meet(lines['B'], lines['L'])
        poly = [tl, tr, br, bl]
        w0 = max(p[0] for p in poly) - min(p[0] for p in poly)
        h0 = max(p[1] for p in poly) - min(p[1] for p in poly)
        if not (0.8 < w0 / (x1 - x0) < 1.25 and 0.7 < h0 / (y1 - y0) < 1.35):
            poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            miss.append('SIZE')
        notes.append(f'{u} ' + ('ok' if not miss else 'fallback ' + ''.join(miss)))
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    nb = dict(bx)
    nb.update({'x': round(min(xs) / W, 4), 'y': round(min(ys) / H, 4),
               'w': round((max(xs) - min(xs)) / W, 4), 'h': round((max(ys) - min(ys)) / H, 4),
               'shape': [[round(x / W, 4), round(y / H, 4)] for x, y in poly]})
    out.append(nb)

json.dump(out, open(out_path, 'w'))
print('\n'.join(x for x in notes if not x.endswith(' ok')) or 'all ok', f'({len(out)} shops)')
if prev:
    p = im.copy(); d = ImageDraw.Draw(p)
    for b in out:
        d.polygon([(x * W, y * H) for x, y in b['shape']], outline=(255, 40, 40), width=2)
    p.save(prev)
