"""Floors 2-5 of Citizen Avenue in the 1st Floor's neutral look.

Start: the cleaned base (cleanN.webp: baked shop colour and names removed,
walls/escalators/plants/wall glow kept), traced shop outlines (shapesN.json).

1. Neutral grey: every pixel takes the 1st Floor's own grey for its brightness
   (grey_ramp.json), so floor, void and walls use the 1st Floor's exact cool
   greys. Plants and the warm wall glow are kept as drawn (strongly coloured).
2. Brightness: the open floor is brought to the 1st Floor's corridor level, but
   only where it is lighter (the 5th Floor food court's beige tiles), so it
   reads as the same dark floor; dark areas are left as they are.
3. Shops: each shop's surface becomes the 1st Floor's average shop surface,
   inside its traced rim; the rim is kept.
4. Status layers: the finished base through the 1st Floor's lookups (lut.json).

usage: python3 build.py <n>   (reads cleanN.webp, shapesN.json; writes vN-*.webp)
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

n = sys.argv[1]
ramp = np.array(json.load(open('grey_ramp.json')), np.float32)
lut = {k: np.array(v, np.float32) for k, v in json.load(open('lut.json')).items()}
shops = json.load(open(f'shapes{n}.json'))
ref = np.asarray(Image.open('f1-base.webp').convert('RGB')).astype(np.float32)
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


def mask(boxes, w, h):
    m = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(m)
    for b in boxes:
        d.polygon(poly(b, w, h), fill=255)
    return m


L = lum(img)
mx, mn = img.max(-1), img.min(-1)
sat = (mx - mn) / np.maximum(mx, 1)
# keep: plants (green, saturated) and the warm wall glow / light strips (warm, bright-ish)
plant = (img[..., 1] > img[..., 0] + 12) & (img[..., 1] > img[..., 2] + 12) & (sat > 0.25)
glow = (img[..., 0] > img[..., 2] + 40) & (sat > 0.35) & (L > 120)
keep = plant | glow
keep = np.asarray(Image.fromarray((keep * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0

shop_m_img = mask(shops, W, H)
shop_m = np.asarray(shop_m_img) > 0

# 2. brightness: one smooth curve for the whole drawing (no masks, no seams),
#    matching this floor's non-shop brightness distribution to the 1st Floor's
#    at a few anchor points, then smoothed. Very bright lines (walls, light
#    strips, L > 215) keep their brightness so the outline stays crisp.
RH0, RW0 = ref.shape[:2]
ref_shop = np.asarray(mask(ref_boxes, RW0, RH0)) > 0
Lr = lum(ref)[~ref_shop]
Ls = L[~shop_m & ~keep]
qs = [0.05, 0.25, 0.5, 0.7, 0.85, 0.93]
xs = [0.0] + [float(np.quantile(Ls, q)) for q in qs] + [215.0, 255.0]
ys = [0.0] + [float(np.quantile(Lr, q)) for q in qs] + [215.0, 255.0]
# monotone, never brighten (only ever pull light floors down toward the 1st Floor)
for i in range(1, len(ys)):
    ys[i] = max(ys[i], ys[i - 1] + 0.5)
ys = [min(y, x) if x < 215 else y for x, y in zip(xs, ys)]
curve = np.interp(np.arange(256), xs, ys)
curve = np.convolve(np.pad(curve, 6, mode='edge'), np.ones(13) / 13, mode='valid')
Ln = curve[np.clip(np.rint(L), 0, 255).astype(int)]
open_floor = np.zeros_like(shop_m)

# 1. neutral grey from the 1st Floor ramp
gi = np.clip(np.rint(Ln), 0, 255).astype(int)
out = ramp[gi]
out[keep] = img[keep]

# 3. shop surface: 1st Floor average surface, inside the rim
G = 48
acc = np.zeros((G, G, 3), np.float64); cnt = 0
RH, RW = ref.shape[:2]
for b in ref_boxes:
    pts = poly(b, RW, RH)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0, x1, y1 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
    ix, iy = int((x1 - x0) * .08), int((y1 - y0) * .10)
    t = ref[y0 + iy:y1 - iy, x0 + ix:x1 - ix]
    if t.shape[0] < 20 or t.shape[1] < 20 or ((t[..., 0] - t[..., 2]) > 25).mean() > 0.002:
        continue
    acc += np.asarray(Image.fromarray(t.astype(np.uint8)).resize((G, G), Image.BILINEAR), np.float64); cnt += 1
surface = (acc / max(cnt, 1)).astype(np.uint8)
RIM = max(6, int(round(10 * W / 2940)))
interior = np.asarray(shop_m_img.filter(ImageFilter.MinFilter(2 * RIM + 1))) > 0
for b in shops:
    pts = poly(b, W, H)
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    x0, y0, x1, y1 = int(min(xs)), int(min(ys)), int(np.ceil(max(xs))), int(np.ceil(max(ys)))
    w, h = x1 - x0, y1 - y0
    if w < 4 or h < 4:
        continue
    tile = np.asarray(Image.fromarray(surface).resize((w, h), Image.BICUBIC)).astype(np.float32)
    sel = interior[y0:y1, x0:x1]
    reg = out[y0:y1, x0:x1]
    reg[sel] = tile[sel]
    out[y0:y1, x0:x1] = reg

base = np.clip(out, 0, 255)
Image.fromarray(base.astype(np.uint8)).save(f'v{n}-base.webp', quality=88, method=6)
gL = np.clip(np.rint(lum(base)), 0, 255).astype(int)
for k, t in lut.items():
    Image.fromarray(np.clip(t[gL], 0, 255).astype(np.uint8)).save(f'v{n}-{k}.webp', quality=88, method=6)
print(json.dumps({'floor': n, 'size': [W, H], 'kept_px': int(keep.sum()), 'open_floor_frac': round(float(open_floor.mean()), 3), 'ref_shops': cnt}))
