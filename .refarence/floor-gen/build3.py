"""Floors 2-5 of Citizen Avenue, shop for shop from the 1st Floor.

Every shop on floor N is redrawn with the tile of the 1st Floor shop in the
same place on the plan (nearest normalised centre, same kind: plain rectangle,
sloped front-row quad, or the notched corner shop), so its rim, bevel, light
gradient and wall glow are the 1st Floor's own. The tile is mapped into the
shop's exact outline: left/right/top/bottom bands of E px (rim + bevel) keep
their width, the middle stretches, and each column follows the outline's own
top and bottom (so sloped and notched bottoms carry the rim along them).
Floor N's own pillars (pure black notches cut into a shop) are put back.

Outside the shops: one smooth brightness curve (outside and floor matched to
the 1st Floor's), then the 1st Floor's neutral grey for each brightness.
Plants and the warm wall glow stay as drawn.

Status layers: the finished base through the 1st Floor's luminance lookups;
the app clips each layer to the shop outline.

usage: python3 build3.py <n>   (cleanN.webp, shapesN.json -> xN-*.webp)"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

n = sys.argv[1]
E = 14
ramp = np.array(json.load(open('grey_ramp.json')), np.float32)
lut = {k: np.array(v, np.float32) for k, v in json.load(open('lut.json')).items()}
shops = json.load(open(f'shapes{n}.json'))
ref = np.asarray(Image.open('f1-base.webp').convert('RGB')).astype(np.float32)
RH, RW = ref.shape[:2]
ref_shops = json.load(open('shapes1.json'))
img = np.asarray(Image.open(f'clean{n}.webp').convert('RGB')).astype(np.float32)
H, W = img.shape[:2]


def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def poly(b, w, h):
    if b.get('shape'):
        return [(x * w, y * h) for x, y in b['shape']]
    x0, y0, x1, y1 = b['x'] * w, b['y'] * h, (b['x'] + b['w']) * w, (b['y'] + b['h']) * h
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def bb(b, w, h):
    p = poly(b, w, h)
    return min(q[0] for q in p), min(q[1] for q in p), max(q[0] for q in p), max(q[1] for q in p)


def kind(b, w, h):
    p = poly(b, w, h)
    if len(p) == 4:
        return 'slope' if abs(p[2][1] - p[3][1]) > 6 else 'rect'
    return f'poly{len(p)}'


def mask_of(boxes, w, h):
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    for b in boxes:
        d.polygon(poly(b, w, h), fill=255)
    return np.asarray(m) > 0


def local_mask(b, w, h, x0, y0, cw, ch):
    m = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(m).polygon([(x - x0, y - y0) for x, y in poly(b, w, h)], fill=255)
    return np.asarray(m) > 0


def col_span(pts, xs):
    """Exact top and bottom of a polygon at each x (x-monotone outlines)."""
    xs = np.asarray(xs, float)
    top = np.full(xs.shape, np.inf); bot = np.full(xs.shape, -np.inf)
    k = len(pts)
    for i in range(k):
        (ax, ay), (bx_, by) = pts[i], pts[(i + 1) % k]
        if abs(bx_ - ax) < 1e-9:
            continue
        lo, hi = min(ax, bx_), max(ax, bx_)
        inr = (xs >= lo) & (xs <= hi)
        y = ay + (xs - ax) * (by - ay) / (bx_ - ax)
        top = np.where(inr, np.minimum(top, y), top)
        bot = np.where(inr, np.maximum(bot, y), bot)
    return top, bot


def seg_map(t, t0, t1, s0, s1, e):
    """t in [t0, t1) to [s0, s1); e px at each end keep their size."""
    tl, sl = t1 - t0, s1 - s0
    e = np.minimum(e, np.minimum(tl, sl) / 3.0)
    rel = t - t0
    mid = s0 + e + (rel - e) * (sl - 2 * e) / np.maximum(tl - 2 * e, 1.0)
    return np.where(rel < e, s0 + rel, np.where(rel >= tl - e, s1 - (tl - rel), mid))


def bilinear(a, x, y):
    h, w = a.shape[:2]
    x = np.clip(x, 0, w - 1.001); y = np.clip(y, 0, h - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None]; fy = (y - y0)[..., None]
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy)
            + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)


# ---------------------------------------------------------------- outside
L = lum(img)
Lr = lum(ref)
mx, mn = img.max(-1), img.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
plant = (img[..., 1] > img[..., 0] + 12) & (img[..., 1] > img[..., 2] + 12) & (sat > 0.25)
glow = (img[..., 0] > img[..., 2] + 40) & (sat > 0.35) & (L > 120)
keep = np.asarray(Image.fromarray(((plant | glow) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
shop_m = mask_of(shops, W, H)
ref_shop = mask_of(ref_shops, RW, RH)
o_n = float(np.median(L[:int(.05 * H), :int(.06 * W)]))
o_1 = float(np.median(Lr[:int(.05 * RH), :int(.06 * RW)]))
fl_n = L[~shop_m & ~keep & (L > o_n + 12) & (L < 200)]
fl_1 = Lr[~ref_shop & (Lr > o_1 + 12) & (Lr < 200)]
qs = [0.25, 0.5, 0.7, 0.85, 0.93]
xs = [0.0, o_n] + [float(np.quantile(fl_n, q)) for q in qs] + [215.0, 255.0]
ys = [0.0, o_1] + [float(np.quantile(fl_1, q)) for q in qs] + [215.0, 255.0]
pairs = sorted(zip(xs, ys))
xs = [p[0] for p in pairs]; ys = [p[1] for p in pairs]
for i in range(1, len(ys)):
    ys[i] = max(ys[i], ys[i - 1] + 0.5)
curve = np.interp(np.arange(256), xs, ys)
curve = np.convolve(np.pad(curve, 6, mode='edge'), np.ones(13) / 13, mode='valid')
outside_img = ramp[np.clip(np.rint(curve[np.clip(np.rint(L), 0, 255).astype(int)]), 0, 255).astype(int)]
outside_img[keep] = img[keep]
out = outside_img.copy()

# ---------------------------------------------------------------- sources
U1 = (min(bb(b, RW, RH)[0] for b in ref_shops), min(bb(b, RW, RH)[1] for b in ref_shops),
      max(bb(b, RW, RH)[2] for b in ref_shops), max(bb(b, RW, RH)[3] for b in ref_shops))
UN = (min(bb(b, W, H)[0] for b in shops), min(bb(b, W, H)[1] for b in shops),
      max(bb(b, W, H)[2] for b in shops), max(bb(b, W, H)[3] for b in shops))


def ncenter(b, w, h, U):
    x0, y0, x1, y1 = bb(b, w, h)
    return np.array([((x0 + x1) / 2 - U[0]) / (U[2] - U[0]), ((y0 + y1) / 2 - U[1]) / (U[3] - U[1])])


src = []
for b in ref_shops:
    x0, y0, x1, y1 = bb(b, RW, RH)
    mm = local_mask(b, RW, RH, int(x0), int(y0), int(x1) - int(x0) + 1, int(y1) - int(y0) + 1)
    mm = np.asarray(Image.fromarray((mm * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(17))) > 0
    t = Lr[int(y0):int(y1) + 1, int(x0):int(x1) + 1][:mm.shape[0], :mm.shape[1]]
    src.append({'b': b, 'kind': kind(b, RW, RH), 'c': ncenter(b, RW, RH, U1),
                'asp': (x1 - x0) / (y1 - y0), 'notch': float(((t < 16) & mm).sum() / max(mm.sum(), 1))})

pairing = []
for b in shops:
    k = kind(b, W, H)
    x0, y0, x1, y1 = bb(b, W, H)
    c, asp = ncenter(b, W, H, UN), (x1 - x0) / (y1 - y0)
    pool = [s for s in src if s['kind'] == k] or [s for s in src if s['kind'] == 'rect']
    if k == 'rect':
        # pillar notches belong to each drawing; take only clean 1st Floor tiles
        clean_pool = [s for s in pool if s['notch'] < 0.0005]
        pool = clean_pool or pool
    s = min(pool, key=lambda s: float(np.hypot(*(s['c'] - c))) + 0.25 * abs(np.log(asp / s['asp'])))
    pairing.append((b, s))

# ---------------------------------------------------------------- shops
for b, s in pairing:
    sx0, sy0, sx1, sy1 = bb(s['b'], RW, RH)
    sx0, sy0, sx1, sy1 = int(np.floor(sx0)), int(np.floor(sy0)), int(np.ceil(sx1)), int(np.ceil(sy1))
    stile = ref[sy0:sy1, sx0:sx1]
    sh, sw = stile.shape[:2]
    spts = [(x - sx0, y - sy0) for x, y in poly(s['b'], RW, RH)]
    sxs = [p[0] for p in spts]

    tx0, ty0, tx1, ty1 = bb(b, W, H)
    tx0, ty0, tx1, ty1 = int(np.floor(tx0)), int(np.floor(ty0)), int(np.ceil(tx1)), int(np.ceil(ty1))
    w, h = tx1 - tx0, ty1 - ty0
    tm = local_mask(b, W, H, tx0, ty0, w, h)
    tpts = [(x - tx0, y - ty0) for x, y in poly(b, W, H)]
    txs = [p[0] for p in tpts]

    C, R = np.meshgrid(np.arange(w, dtype=float), np.arange(h, dtype=float))
    # x: outline's own left/right edges map onto the source's, bands kept
    SX = seg_map(C + 0.5, min(txs), max(txs), min(sxs), max(sxs), E)
    st, sb = col_span(spts, np.clip(SX, min(sxs) + 1e-6, max(sxs) - 1e-6))
    tt, tb = col_span(tpts, np.clip(C + 0.5, min(txs) + 1e-6, max(txs) - 1e-6))
    SY = seg_map(R + 0.5, tt, tb, st, sb, E)
    SX, SY = SX - 0.5, SY - 0.5
    tile = bilinear(stile, SX, SY)

    reg = out[ty0:ty1, tx0:tx1]
    reg[tm] = tile[tm]
    # floor N's own pillars: pure black cut into the shop, reached from the
    # dark gap outside the outline
    Lc = L[ty0:ty1, tx0:tx1]
    dark = Lc < 14
    reach = dark & ~tm
    for _ in range(60):
        g = (np.asarray(Image.fromarray((reach * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0) & dark
        if (g == reach).all():
            break
        reach = g
    back = reach & tm
    reg[back] = outside_img[ty0:ty1, tx0:tx1][back]
    out[ty0:ty1, tx0:tx1] = reg

base = np.clip(out, 0, 255)
Image.fromarray(base.astype(np.uint8)).save(f'x{n}-base.webp', quality=90, method=6)
gL = np.clip(np.rint(lum(base)), 0, 255).astype(int)
for k, t in lut.items():
    Image.fromarray(np.clip(t[gL], 0, 255).astype(np.uint8)).save(f'x{n}-{k}.webp', quality=90, method=6)

# checks: (a) no two outlines overlap; (b) no outline swallows a bright line
# of the original drawing (outer wall, another shop's rim): count bright
# low-saturation clean-image pixels deeper than 6 px inside each outline
cover = np.zeros((H, W), np.uint8)
bleed = []
for b in shops:
    x0, y0, x1, y1 = [int(v) for v in bb(b, W, H)]
    m = local_mask(b, W, H, x0, y0, x1 - x0 + 1, y1 - y0 + 1)
    cover[y0:y1 + 1, x0:x1 + 1] += m
    deep = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(13))) > 0
    hit = (L[y0:y1 + 1, x0:x1 + 1] > 200) & (sat[y0:y1 + 1, x0:x1 + 1] < 0.15) & deep
    if hit.sum() > 30:
        bleed.append(f"{b['unitId']}:{int(hit.sum())}")
print(json.dumps({'floor': n, 'overlap_px': int((cover > 1).sum()), 'bleed': bleed,
                  'pairs': {b['unitId']: s['b']['unitId'] for b, s in pairing}}))
