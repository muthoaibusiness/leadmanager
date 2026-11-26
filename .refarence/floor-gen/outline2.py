"""Shop outlines like the 1st Floor's: straight sides on the outer edge of
each shop's drawn rim, so a status colour fills the shop to its rim and stops
there. Traced on the cleaned base (names removed), 3x scale.

Model (every shop in floors 2-5 is drawn this way): top, left and right sides
are straight and axis-aligned; the bottom is a straight line that may slope
(front row along the angled outer wall). Each side is placed at the rim's
outer half-max: the point just outside the bright rim line where brightness
has fallen half-way to the dark gap.

Shops whose drawn form is not one quad (the notched corner shop x01) take a
hand-read outline from SPECIAL, or fall back to the stored box (logged).

usage: python3 outline2.py <n> <clean.webp> <boxes.json> <out.json> <preview.png> [art.png]"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

n, clean, boxes_path, out_path, prev_path = sys.argv[1:6]
art = sys.argv[6] if len(sys.argv) > 6 else None
im = Image.open(clean).convert('RGB')
W, H = im.size
L = np.asarray(im.convert('L').filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32)
boxes = json.load(open(boxes_path))
M = int(0.016 * W)
SPECIAL = json.load(open('special.json')).get(n, {}) if __import__('os').path.exists('special.json') else {}


def edge_out(prof):
    """prof runs from inside the shop outward. The shop's outer edge is just
    past its rim: the rim is the first local peak at least 12 brighter than
    the surface just inside it; the edge is where that peak has fallen
    half-way to the trough beyond it. With no rim peak, the first point where
    the profile drops well below the surface. None if neither."""
    if len(prof) < 10:
        return None
    p = np.asarray(prof, float)
    inner = float(np.median(p[:8]))
    for j in range(4, len(p) - 2):
        local = float(np.median(p[max(0, j - 10):j - 2])) if j > 6 else inner
        if p[j] >= local + 12 and p[j] >= p[j - 1] and p[j] >= p[j + 1]:
            pk = j
            while pk + 1 < len(p) and p[pk + 1] >= p[pk]:
                pk += 1
            tail = p[pk:pk + 14]
            half = (p[pk] + float(tail.min())) / 2
            q = pk
            while q + 1 < len(p) and p[q + 1] > half:
                q += 1
            return q
        if p[j] < min(inner * 0.5, 26):
            return j - 1
        # no rim peak and no deep gap, but a sharp fall well below the
        # surface: the shop ends where the fall crosses half-way
        if j + 4 < len(p) and p[j] - p[j + 4] > max(25.0, inner * 0.35):
            lo = float(p[j:j + 8].min())
            half = (p[j] + lo) / 2
            q = j
            while q + 1 < len(p) and p[q + 1] > half:
                q += 1
            return q
    return None


def robust_median(v):
    v = np.array(v, float)
    m = np.median(v)
    dev = np.abs(v - m)
    return float(np.median(v[dev <= max(2.0, np.percentile(dev, 70))]))


def robust_line(pts):
    p = np.array(pts, float)
    x, y = p[:, 0], p[:, 1]
    keep = np.ones(len(x), bool)
    for _ in range(5):
        a, b = np.polyfit(x[keep], y[keep], 1)
        r = np.abs(y - (a * x + b))
        if keep.sum() < 8:
            break
        keep = r <= max(1.5, np.percentile(r[keep], 75))
    a, b = np.polyfit(x[keep], y[keep], 1)
    if abs(a) < 0.015:
        a, b = 0.0, float(np.median(y[keep]))
    return a, b


out, log = [], []
for bx in boxes:
    u = bx['unitId']
    x0, y0 = bx['x'] * W, bx['y'] * H
    x1, y1 = (bx['x'] + bx['w']) * W, (bx['y'] + bx['h']) * H
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if u in SPECIAL:
        poly = [tuple(map(float, p)) for p in SPECIAL[u]]
        log.append(f'{u} hand')
    else:
        T, Ls, R, B = [], [], [], []
        for t in np.linspace(0.12, 0.88, 48):
            xs = x0 + t * (x1 - x0)
            ys_lr = y0 + (0.15 + t * 0.5) * (y1 - y0)  # upper-middle of the sides
            r = np.arange(int(cy - (y1 - y0) * 0.25), int(max(0, y0 - M)), -1)
            e = edge_out(L[r, int(xs)])
            if e is not None: T.append(r[e] - 0.5)
            r = np.arange(int(cy + (y1 - y0) * 0.15), int(min(H, y1 + M)))
            e = edge_out(L[r, int(xs)])
            if e is not None: B.append((xs, r[e] + 0.5))
            r = np.arange(int(cx - (x1 - x0) * 0.25), int(max(0, x0 - M)), -1)
            e = edge_out(L[int(ys_lr), r])
            if e is not None: Ls.append(r[e] - 0.5)
            r = np.arange(int(cx + (x1 - x0) * 0.25), int(min(W, x1 + M)))
            e = edge_out(L[int(ys_lr), r])
            if e is not None: R.append(r[e] + 0.5)
        miss = ''
        t_ = robust_median(T) if len(T) >= 10 else (miss := miss + 'T') and y0
        l_ = robust_median(Ls) if len(Ls) >= 10 else (miss := miss + 'L') and x0
        r_ = robust_median(R) if len(R) >= 10 else (miss := miss + 'R') and x1
        if len(B) >= 10:
            a, b = robust_line(B)
        else:
            miss += 'B'; a, b = 0.0, y1
        # front row on the angled outer wall: the shop's floor runs to the
        # inner side of the bright wall line (L > 200). Fit that line and set
        # the bottom just inside it, parallel; this is cleaner than the shop's
        # own faint bottom rim (pillars and bevels bend it).
        wall = []
        for t in np.linspace(0.1, 0.9, 36):
            xs = x0 + t * (x1 - x0)
            r = np.arange(int(cy), int(min(H, y1 + M + 40)))
            col = L[r, int(xs)]
            hit = np.nonzero(col > 200)[0]
            if len(hit):
                wall.append((xs, float(r[hit[0]])))
        if len(wall) >= 18:
            wa, wb = robust_line(wall)
            # sloped wall right under this shop (within 70 px of its stored
            # bottom at both ends): this shop sits on it
            if abs(wa) > 0.05 and y1 > 0.74 * H and abs(wa * x0 + wb - y1) < 70 and abs(wa * x1 + wb - y1) < 70:
                # inner edge of the dark band between shop and wall: walk up
                # from the wall at the middle column to the shop's surface
                mid = (x0 + x1) / 2
                wy = wa * mid + wb
                r = np.arange(int(wy) - 1, int(cy), -1)
                col = L[r, int(mid)]
                inner = float(np.median(L[int(cy):int(cy) + 20, int(mid)]))
                k = next((i for i in range(len(col)) if col[i] >= inner * 0.85), None)
                gap = (wy - r[k]) if k is not None else 14.0
                a, b = wa, wb - gap
        poly = [(l_, t_), (r_, t_), (r_, a * r_ + b), (l_, a * l_ + b)]
        w0, h0 = r_ - l_, max(a * r_ + b, a * l_ + b) - t_
        if not (0.85 < w0 / (x1 - x0) < 1.2 and 0.75 < h0 / (y1 - y0) < 1.3):
            poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            miss += f' SIZE({w0 / (x1 - x0):.2f}x{h0 / (y1 - y0):.2f})'
        if miss:
            log.append(f'{u} fallback {miss}')
    xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
    nb = dict(bx)
    nb.update({'x': round(min(xs) / W, 4), 'y': round(min(ys) / H, 4),
               'w': round((max(xs) - min(xs)) / W, 4), 'h': round((max(ys) - min(ys)) / H, 4),
               'shape': [[round(x / W, 4), round(y / H, 4)] for x, y in poly]})
    out.append(nb)

# no overlaps: where two shops' outlines overlap, both pull back to the middle
def bbox(b):
    return b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
for i, a in enumerate(out):
    for c in out[i + 1:]:
        ax0, ay0, ax1, ay1 = bbox(a); cx0, cy0, cx1, cy1 = bbox(c)
        ox, oy = min(ax1, cx1) - max(ax0, cx0), min(ay1, cy1) - max(ay0, cy0)
        if ox > 0 and oy > 0:
            log.append(f'overlap {a["unitId"]}/{c["unitId"]} {ox * W:.1f}x{oy * H:.1f}px')

json.dump(out, open(out_path, 'w'))
print('\n'.join(log) or 'all fitted', f'| {len(out)} shops')
base = Image.open(art).convert('RGB').resize((W, H), Image.LANCZOS) if art else im.copy()
d = ImageDraw.Draw(base)
for b in out:
    d.polygon([(x * W, y * H) for x, y in b['shape']], outline=(255, 40, 40), width=2)
base.save(prev_path)
