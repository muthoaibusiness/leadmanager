"""Floors 2-5 in the 1st Floor's look, shop by shop.

Inputs: cleanN.webp (baked colour and names removed), shapesN.json (exact
outlines, outline2.py), the 1st Floor base/layers, lut.json, grey_ramp.json.

1. Everything outside the shops: the same smooth brightness curve as before
   (the floor's non-shop brightness matched to the 1st Floor's), then the
   1st Floor's own neutral grey for each brightness. Plants and the warm
   wall glow kept as drawn.
2. Each shop: redrawn from the 1st Floor's own shop tile, warped into the
   shop's outline (affine for 3 corners, bilinear for 4), with the tile's
   rim, bevel and light gradient: the same surface, edge to edge.
   Notched outlines (x01) use the bounding quad; the tile is masked to the
   outline so nothing spills.
3. Status layers: the finished base through the 1st Floor's lookups; the app
   clips each to the shop outline, so colour fills the shop to its rim.

usage: python3 build2.py <n>"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

n = sys.argv[1]
ramp = np.array(json.load(open('grey_ramp.json')), np.float32)
lut = {k: np.array(v, np.float32) for k, v in json.load(open('lut.json')).items()}
shops = json.load(open(f'shapes{n}.json'))
ref_img = Image.open('f1-base.webp').convert('RGB')
ref = np.asarray(ref_img).astype(np.float32)
RH, RW = ref.shape[:2]
ref_boxes = json.load(open('shapes1.json'))
img = np.asarray(Image.open(f'clean{n}.webp').convert('RGB')).astype(np.float32)
H, W = img.shape[:2]


def lum(a):
    return 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]


def poly(b, w, h):
    if b.get('shape'):
        return [(x * w, y * h) for x, y in b['shape']]
    x0, y0, x1, y1 = b['x'] * w, b['y'] * h, (b['x'] + b['w']) * w, (b['y'] + b['h']) * h
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def mask(boxes, w, h, grow=0):
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    for b in boxes:
        d.polygon(poly(b, w, h), fill=255)
    if grow:
        m = m.filter(ImageFilter.MaxFilter(2 * grow + 1))
    return m


# --- 1. outside the shops --------------------------------------------------
L = lum(img)
mx, mn = img.max(-1), img.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
plant = (img[..., 1] > img[..., 0] + 12) & (img[..., 1] > img[..., 2] + 12) & (sat > 0.25)
glow = (img[..., 0] > img[..., 2] + 40) & (sat > 0.35) & (L > 120)
keep = np.asarray(Image.fromarray(((plant | glow) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
shop_m = np.asarray(mask(shops, W, H)) > 0
ref_shop = np.asarray(mask(ref_boxes, RW, RH)) > 0
Lr = lum(ref)[~ref_shop]
Ls = L[~shop_m & ~keep]
qs = [0.05, 0.25, 0.5, 0.7, 0.85, 0.93]
xs = [0.0] + [float(np.quantile(Ls, q)) for q in qs] + [215.0, 255.0]
ys = [0.0] + [float(np.quantile(Lr, q)) for q in qs] + [215.0, 255.0]
for i in range(1, len(ys)):
    ys[i] = max(ys[i], ys[i - 1] + 0.5)
ys = [min(y, x) if x < 215 else y for x, y in zip(xs, ys)]
curve = np.interp(np.arange(256), xs, ys)
curve = np.convolve(np.pad(curve, 6, mode='edge'), np.ones(13) / 13, mode='valid')
out = ramp[np.clip(np.rint(curve[np.clip(np.rint(L), 0, 255).astype(int)]), 0, 255).astype(int)]
out[keep] = img[keep]

# --- 2. shops: the 1st Floor tile, warped in -------------------------------
# reference tile: SHOP-141 (a clean, square-cornered, glint-free 1st Floor shop)
rb = next(b for b in ref_boxes if b['unitId'] == 'SHOP-141')
P = 4  # the tile includes its rim; take its rectangle as drawn
tx0, ty0 = int(rb['x'] * RW) - P, int(rb['y'] * RH) - P
tx1, ty1 = int((rb['x'] + rb['w']) * RW) + P, int((rb['y'] + rb['h']) * RH) + P
tile = ref[ty0:ty1, tx0:tx1]
TH, TW = tile.shape[:2]
E = 22  # border band (rim + bevel) kept at a fixed width: nine-slice


def nine_slice(w, h):
    e = max(4, min(E, w // 3, h // 3))
    res = np.zeros((h, w, 3), np.float32)
    ys_ = [(0, e, 0, e), (e, TH - e, e, h - e), (TH - e, TH, h - e, h)]
    xs_ = [(0, e, 0, e), (e, TW - e, e, w - e), (TW - e, TW, w - e, w)]
    for sy0, sy1, dy0, dy1 in ys_:
        for sx0, sx1, dx0, dx1 in xs_:
            if dy1 <= dy0 or dx1 <= dx0:
                continue
            piece = Image.fromarray(np.clip(tile[sy0:sy1, sx0:sx1], 0, 255).astype(np.uint8))
            res[dy0:dy1, dx0:dx1] = np.asarray(piece.resize((dx1 - dx0, dy1 - dy0), Image.LANCZOS), np.float32)
    return res


scale = W / RW
for b in shops:
    pts = poly(b, W, H)
    xs_ = [p[0] for p in pts]; ys_ = [p[1] for p in pts]
    bx0, by0 = int(np.floor(min(xs_))), int(np.floor(min(ys_)))
    bx1, by1 = int(np.ceil(max(xs_))), int(np.ceil(max(ys_)))
    w, h = bx1 - bx0, by1 - by0
    if w < 8 or h < 8:
        continue
    # slanted bottom: build the tile as the bounding rectangle, then shear the
    # bottom part so the drawn bottom rim follows the slope
    flat = nine_slice(w, h)
    # bottom edge y at each column, from the outline
    bot = np.full(w, float(by1))
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).polygon([(x - bx0, y - by0) for x, y in pts], fill=255)
    mk = np.asarray(m) > 0
    for c in range(w):
        col = np.nonzero(mk[:, c])[0]
        if len(col):
            bot[c] = by0 + col.max() + 1
    warped = np.empty_like(flat)
    for c in range(w):
        hh = int(round(bot[c] - by0))
        hh = max(8, min(h, hh))
        # resample this column of the flat tile into height hh, keeping the
        # bottom rim band (last E px) at full size
        col = flat[:, c]
        e = max(4, min(E, hh // 3))
        top = col[:h - e]
        tail = col[h - e:]
        top_r = np.asarray(Image.fromarray(np.clip(top[:, None, :], 0, 255).astype(np.uint8)).resize((1, hh - e), Image.BILINEAR), np.float32)[:, 0]
        warped[:hh - e, c] = top_r
        warped[hh - e:hh, c] = tail
        warped[hh:, c] = out[by0 + hh:by1, bx0 + c] if hh < h else warped[hh:, c]
    reg = out[by0:by1, bx0:bx1]
    reg[mk] = warped[mk]
    out[by0:by1, bx0:bx1] = reg

base = np.clip(out, 0, 255)
Image.fromarray(base.astype(np.uint8)).save(f'w{n}-base.webp', quality=90, method=6)
gL = np.clip(np.rint(lum(base)), 0, 255).astype(int)
for k, t in lut.items():
    Image.fromarray(np.clip(t[gL], 0, 255).astype(np.uint8)).save(f'w{n}-{k}.webp', quality=90, method=6)
print(json.dumps({'floor': n, 'size': [W, H], 'tile': [TW, TH]}))
