"""Editing text in scanned pages.

The scan image itself is never re-encoded. An edit adds a small *patch* image,
drawn right after the scan, that covers the old word with reconstructed paper
and the new word drawn in matching size, width, colour and baseline. Text is
shaped with HarfBuzz and rasterised with FreeType, so Hindi works too.
Overlapping earlier patches are merged into the new one, so repeated edits
never leave remnants.
"""
from __future__ import annotations

import io
import zlib
from dataclasses import dataclass
from typing import Optional

import numpy as np
import pikepdf
from PIL import Image, ImageFilter

from .editor import EditError, PageEditor
from .interpreter import PageModel
from .ocr import add_text_layer, has_text_layer, mat_inverse_axis
from .sysfonts import SysFont, coverage_fonts, has_glyph, match_font

FAMILIES = {"sans": "Arial", "serif": "Times New Roman", "mono": "Courier New"}


def _style(name: str, bold: bool, italic: bool, serif: bool = False, mono: bool = False) -> tuple[Optional[SysFont], str]:
    """match_font, but always in the requested weight and slant: a plain name that is also a font's own
    PostScript name ('Tahoma', 'Calibri') would otherwise come back as the regular cut."""
    f, q = match_font(name, bold, italic, serif, mono)
    if f is not None and (f.bold != bold or f.italic != italic):
        from .sysfonts import _norm, _pick, font_index
        v = _pick([g for g in font_index() if _norm(g.family) == _norm(f.family)], bold, italic)
        if v is not None:
            f = v
    return f, q


# ------------------------------------------------------------------ raster text
@dataclass
class Raster:
    alpha: np.ndarray  # float32 0..1
    baseline: int  # row of the baseline
    origin: int  # column of the pen start
    ink: tuple[int, int, int, int]  # r0, c0, r1, c1 (exclusive) of inked pixels


def rasterize(text: str, font: SysFont, px: float) -> Raster:
    import freetype
    import uharfbuzz as hb

    from .sysfonts import _hb_face

    face_hb = _hb_face(font.path, font.index)
    upem = face_hb.upem
    hbf = hb.Font(face_hb)
    hbf.scale = (upem, upem)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbf, buf, {"kern": True, "liga": True})
    face = freetype.Face(font.path, index=font.index)
    size = max(int(round(px * 64)), 64)
    face.set_char_size(size, size, 72, 72)
    s = px / upem
    pad = int(px) + 4
    width = int(sum(p.x_advance for p in buf.glyph_positions) * s) + 2 * pad
    height = int(px * 2) + 2 * pad
    baseline = pad + int(px * 1.2)
    canvas = np.zeros((height, width), np.float32)
    pen = float(pad)
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        face.load_glyph(info.codepoint, freetype.FT_LOAD_DEFAULT | freetype.FT_LOAD_NO_HINTING | freetype.FT_LOAD_NO_BITMAP)  # no 1-bit strikes at small sizes
        face.glyph.render(freetype.FT_RENDER_MODE_NORMAL)
        bm = face.glyph.bitmap
        if bm.width and bm.rows:
            g = np.array(bm.buffer, np.float32).reshape(bm.rows, bm.pitch)[:, : bm.width] / 255.0
            x = int(round(pen + pos.x_offset * s)) + face.glyph.bitmap_left
            y = baseline - int(round(pos.y_offset * s)) - face.glyph.bitmap_top
            y0, x0 = max(y, 0), max(x, 0)
            y1, x1 = min(y + g.shape[0], height), min(x + g.shape[1], width)
            if y1 > y0 and x1 > x0:
                sub = g[y0 - y:y1 - y, x0 - x:x1 - x]
                canvas[y0:y1, x0:x1] = np.maximum(canvas[y0:y1, x0:x1], sub)
        pen += pos.x_advance * s
    rows = np.nonzero(canvas.max(axis=1) > 0.15)[0]
    cols = np.nonzero(canvas.max(axis=0) > 0.15)[0]
    ink = (int(rows[0]), int(cols[0]), int(rows[-1]) + 1, int(cols[-1]) + 1) if len(rows) else (baseline, pad, baseline, pad)
    return Raster(canvas, baseline, pad, ink)


def pick_font(text: str, family: str, bold: bool, italic: bool) -> SysFont:
    name = FAMILIES.get(family, "Arial")
    f, _ = _style(name, bold, italic, family == "serif", family == "mono")
    if f is not None and all(has_glyph(f, c) for c in text if not c.isspace()):
        return f
    for c in coverage_fonts(bold, italic):
        if all(has_glyph(c, ch) for ch in text if not ch.isspace()):
            return c
    if f is None:
        raise EditError("No installed font found")
    raise EditError("No installed font has glyphs for this text")



# ------------------------------------------------------------------ erasing
def _box_blur(a: np.ndarray, r: int) -> np.ndarray:
    """Mean over a (2r+1) square, edges replicated; works on 2-D or 3-D float arrays."""
    pad = [(r, r), (r, r)] + [(0, 0)] * (a.ndim - 2)
    p = np.pad(a, pad, mode="edge").astype(np.float64)
    c = np.cumsum(p, axis=0)
    c = np.concatenate([np.zeros_like(c[:1]), c], axis=0)
    p = c[2 * r + 1:] - c[:-2 * r - 1]
    c = np.cumsum(p, axis=1)
    c = np.concatenate([np.zeros_like(c[:, :1]), c], axis=1)
    return ((c[:, 2 * r + 1:] - c[:, :-2 * r - 1]) / float((2 * r + 1) ** 2)).astype(np.float32)


def _dilate(m: np.ndarray, r: int) -> np.ndarray:
    return _box_blur(m.astype(np.float32), r) > 0


def inpaint(arr: np.ndarray, mask: np.ndarray, exclude: Optional[np.ndarray] = None) -> np.ndarray:
    """Fill masked pixels from the surrounding ones with normalised blurs of growing size, so a
    gradient or soft texture continues smoothly through the hole."""
    out = arr.astype(np.float32).copy()
    known = (~mask if exclude is None else ~mask & ~exclude).astype(np.float32)
    todo = mask.copy()
    # first, row by row: a band edge (table stripe, banner border) running behind the word stays sharp when each row
    # is filled from the same row just left and right of the hole, instead of blurring the two sides together
    D = 6
    for y in np.nonzero(mask.any(axis=1))[0]:
        row = mask[y].astype(np.int8)
        edges = np.diff(np.concatenate([[0], row, [0]]))
        for a, b in zip(np.nonzero(edges == 1)[0], np.nonzero(edges == -1)[0]):
            left = out[y, max(a - D, 0):a][known[y, max(a - D, 0):a] > 0]
            right = out[y, b:b + D][known[y, b:b + D] > 0]
            if len(left) < 2 or len(right) < 2:
                continue
            lc, rc = np.median(left, axis=0), np.median(right, axis=0)
            if np.linalg.norm(np.atleast_1d(lc - rc)) > 18:  # the two sides differ: not a flat band, use the blur below
                continue
            t = ((np.arange(a, b) - a + 0.5) / (b - a))[:, None] if out.ndim == 3 else ((np.arange(a, b) - a + 0.5) / (b - a))
            out[y, a:b] = lc + (rc - lc) * t
            todo[y, a:b] = False
            known[y, a:b] = 1.0
    w3 = known[..., None] if out.ndim == 3 else known
    r = 2
    while todo.any() and r < max(mask.shape):
        num = _box_blur(out * w3, r)
        den = _box_blur(known, r)
        ok = todo & (den > 0.18)
        if ok.any():
            d = den[..., None] if out.ndim == 3 else den
            out[ok] = (num / np.maximum(d, 1e-6))[ok]
            known[ok] = 1.0
            w3 = known[..., None] if out.ndim == 3 else known
            todo &= ~ok
        r *= 2
    return out


def texture(full: np.ndarray, hole: np.ndarray, oy: int, ox: int, paper: np.ndarray, limit: float, hpx: float) -> Optional[np.ndarray]:
    """Fine texture (paper grain, fabric, print screen) for a hole, copied tile by tile from the nearest plain
    background around it, so the fill is not a smooth blob on grainy or textured paper.
    hole is in a region whose top-left is (oy, ox) in full. Returns the zero-mean texture for the region."""
    ys, xs = np.nonzero(hole)
    if not len(ys):
        return None
    H, W = full.shape[:2]
    T = max(int(0.8 * hpx), 8)
    rings = [(dy, dx) for dy in range(-5, 6) for dx in range(-5, 6) if dy or dx]
    rings.sort(key=lambda o: (max(abs(o[0]), abs(o[1])), abs(o[0]) * 1.5 + abs(o[1])))  # nearest first, same line preferred
    # only the neighbourhood the tiles can come from
    gy0, gx0 = max(oy + int(ys.min()) - 6 * T, 0), max(ox + int(xs.min()) - 6 * T, 0)
    gy1, gx1 = min(oy + int(ys.max()) + 6 * T, H), min(ox + int(xs.max()) + 6 * T, W)
    full_f = full[gy0:gy1, gx0:gx1].astype(np.float32)
    dist = np.linalg.norm(full_f - paper, axis=-1) if full.ndim == 3 else np.abs(full_f - paper[0])
    clean = dist <= limit
    oy, ox, H, W = oy - gy0, ox - gx0, gy1 - gy0, gx1 - gx0
    r = max(int(0.08 * hpx), 2)
    out = np.zeros(hole.shape + full.shape[2:], np.float32)
    got, missing = [], []
    for ty in range(ys.min(), ys.max() + 1, T):
        for tx in range(xs.min(), xs.max() + 1, T):
            th, tw = min(T, hole.shape[0] - ty), min(T, hole.shape[1] - tx)
            if not hole[ty:ty + th, tx:tx + tw].any():
                continue
            for dy, dx in rings:
                sy, sx = oy + ty + dy * T, ox + tx + dx * T
                if sy < 0 or sx < 0 or sy + th > H or sx + tw > W:
                    continue
                if clean[max(sy - r, 0):sy + th + r, max(sx - r, 0):sx + tw + r].mean() < 0.995:
                    continue
                y0_, x0_ = max(sy - r, 0), max(sx - r, 0)
                big = full_f[y0_:sy + th + r, x0_:sx + tw + r]
                hf = big - _box_blur(big, r)
                out[ty:ty + th, tx:tx + tw] = hf[sy - y0_:sy - y0_ + th, sx - x0_:sx - x0_ + tw]
                got.append((ty, tx, out[ty:ty + th, tx:tx + tw].copy()))
                break
            else:
                missing.append((ty, tx, th, tw))
    if not got:
        return None
    for ty, tx, th, tw in missing:  # same texture, from the nearest tile that found clean background
        _gy, _gx, t_ = min(got, key=lambda g: abs(g[0] - ty) + abs(g[1] - tx))
        reps = (int(np.ceil(th / t_.shape[0])), int(np.ceil(tw / t_.shape[1]))) + (1,) * (t_.ndim - 2)
        out[ty:ty + th, tx:tx + tw] = np.tile(t_, reps)[:th, :tw]
    return out


def ink_mask(arr: np.ndarray, paper: np.ndarray, ink: np.ndarray, window: tuple, seed: tuple, grow: int, thr: float = 0.3,
             block: Optional[np.ndarray] = None) -> tuple:
    """Pixels that look like the word's ink, grown from the word's own box so strokes that stick
    out past the OCR box (calligraphy, descenders, swashes) are removed with it."""
    a3 = arr if arr.ndim == 3 else arr[..., None]
    axis = ink - paper
    dist = float(np.linalg.norm(axis))
    if dist < 24:
        return None, None
    t = np.linalg.norm(a3 - paper, axis=-1) / dist  # 0 = paper colour, 1 = ink colour, in any direction
    cand = np.zeros(t.shape, bool)
    wy0, wx0, wy1, wx1 = window
    # lighter-than-paper pixels (the white gap between table rows) are only part of the word as a shadow / glow,
    # which hugs the letters; further away they are another background and must not be erased
    proj = ((a3 - paper) @ axis) / max(dist * dist, 1e-6)
    inkward = (t > thr) & (proj > 0.1)
    near = _dilate(inkward, max(int(0.2 * (seed[2] - seed[0])), 2))
    cand[wy0:wy1, wx0:wx1] = ((t > thr) & ((proj > -0.02) | near))[wy0:wy1, wx0:wx1]
    # other words: growth must not walk into them through touching shadows or glow (but they stay in cand,
    # so the fill never borrows their colour)
    free = cand & ~block if block is not None else cand
    cur = np.zeros(t.shape, bool)
    sy0, sx0, sy1, sx1 = seed
    cur[sy0:sy1, sx0:sx1] = free[sy0:sy1, sx0:sx1]
    for _ in range(grow):
        nxt = _dilate(cur, 1) & free
        if (nxt == cur).all():
            break
        cur = nxt
    return cur, cand


# ------------------------------------------------------------------ reading the scan: tilt and typeface
def _ink_bool(arr: np.ndarray, paper: Optional[np.ndarray] = None) -> np.ndarray:
    """Which pixels of a crop are text: whatever differs from the crop's dominant colour (or from `paper`, when the
    caller knows it: a tight box around bold text is mostly ink, so its median is not the paper)."""
    a3 = arr if arr.ndim == 3 else arr[..., None]
    paper = np.median(a3.reshape(-1, a3.shape[2]), axis=0) if paper is None else np.atleast_1d(paper)
    dd = np.linalg.norm(a3 - paper, axis=-1)
    top = float(np.percentile(dd, 99)) if dd.size else 0.0
    if top < 30:
        return np.zeros(dd.shape, bool)
    # the text's own colour, measured along the paper->ink direction, so a drop shadow or glow of the
    # opposite tone (dark shadow under white text) is not counted as part of the letters
    ink = np.median(a3[dd >= np.percentile(dd, 98)], axis=0)
    axis = ink - paper
    t = ((a3 - paper) @ axis) / max(float(axis @ axis), 1e-6)
    m = (t > 0.4) & (dd > 18.0)
    return m & (_box_blur(m.astype(np.float32), 1) > 0.4)  # drop isolated specks of grain


def estimate_tilt(mask: np.ndarray) -> float:
    """Slope s (rows per column, positive = the line rises to the right) of the text lines in a crop.
    Straightening rows by y + x*s makes the row histogram sharpest when s matches the real tilt."""
    ys, xs = np.nonzero(mask)
    if len(xs) < 200 or xs.max() - xs.min() < 60:
        return 0.0
    ys, xs = ys.astype(np.float64), xs.astype(np.float64)
    xs -= xs.mean()

    def score(t: float) -> float:
        r = np.round(ys + xs * t).astype(np.int64)
        return float((np.bincount(r - r.min()).astype(np.float64) ** 2).sum())

    grid = np.arange(-0.09, 0.0901, 0.005)
    best = max(grid, key=score)
    best = max(np.arange(best - 0.005, best + 0.0051, 0.001), key=score)
    return float(best) if score(best) > 1.04 * score(0.0) else 0.0


def unshear(mask: np.ndarray, t: float) -> np.ndarray:
    if abs(t) < 1e-6:
        return mask
    h, w = mask.shape
    extra = int(np.ceil(w * abs(t))) + 1
    out = np.zeros((h + 2 * extra, w), bool)
    for j in range(w):
        col = np.nonzero(mask[:, j])[0]
        if len(col):
            out[col + extra + int(round(j * t)), j] = True
    return out


def _tight(mask: np.ndarray) -> Optional[np.ndarray]:
    """Crop to the text itself, ignoring stray pixels far from the main body of ink."""
    if mask.sum() < 8:
        return None
    rows, cols = mask.sum(axis=1), mask.sum(axis=0)
    r = np.nonzero(rows >= max(0.1 * rows.max(), 2))[0]
    if not len(r):
        return None
    sub = mask[r[0]:r[-1] + 1]
    cols = sub.sum(axis=0)
    c = np.nonzero(cols >= 1)[0]
    return sub[:, c[0]:c[-1] + 1] if len(c) else None


def _body(mask: np.ndarray) -> Optional[tuple[int, int]]:
    """Top and bottom row (exclusive) of the main body of a word: where the row profile is at least half its peak,
    i.e. the x-height band of lowercase, or the full height of caps and digits. Measured the same way on the scan
    and on a font's rendering, it sizes the new text and seats it on the original baseline."""
    rows = mask.sum(axis=1).astype(np.float64)
    if rows.max() < 2:
        return None
    # half the typical row, not the densest one: a '+' bar, '=' or underline makes a single spike row
    ref = float(np.percentile(rows[rows > 0], 75))
    r = np.nonzero(rows >= 0.5 * ref)[0]
    return int(r[0]), int(r[-1]) + 1


def _finish_alpha(alpha: np.ndarray, hx: float, k: float) -> np.ndarray:
    """Rendered text as it is drawn on the scan: stretched by hx, softened like the scan's own blur."""
    im = Image.fromarray((alpha * 255).astype(np.uint8))
    im = im.resize((max(int(round(im.width * hx)), 1), im.height), Image.LANCZOS)
    im = im.filter(ImageFilter.GaussianBlur(0.35 * max(k / 3, 0.5)))
    return (np.asarray(im).astype(np.float32) / 255.0) ** 0.85


def _scan_like(al: np.ndarray) -> np.ndarray:
    """Threshold rendered text the way _ink_bool thresholds the scan."""
    m = al > 0.4
    return m & (_box_blur(m.astype(np.float32), 1) > 0.4)


def _reweight(al: np.ndarray, beta: float) -> np.ndarray:
    """Thicker (beta > 0) or thinner (beta < 0) strokes, by up to one pixel each side."""
    if abs(beta) < 1e-3:
        return al
    im = Image.fromarray((np.clip(al, 0, 1) * 255).astype(np.uint8))
    other = np.asarray(im.filter(ImageFilter.MaxFilter(3) if beta > 0 else ImageFilter.MinFilter(3))).astype(np.float32) / 255.0
    return al + abs(beta) * (other - al)


def _fit_weight(al: np.ndarray, target: float) -> float:
    """The stroke weight change that gives rendered text as much ink as the scan's original word."""
    lo, hi = -1.0, 1.0
    for _ in range(12):
        mid = (lo + hi) / 2
        if _scan_like(_reweight(al, mid)).sum() < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def _fingerprint(mask: np.ndarray) -> np.ndarray:
    im = Image.fromarray((mask * 255).astype(np.uint8)).resize((240, 48), Image.BILINEAR).filter(ImageFilter.GaussianBlur(1.0))
    v = np.asarray(im, np.float32).ravel()
    v -= v.mean()
    return v / (np.linalg.norm(v) + 1e-6)


_OLDSTYLE = {"Georgia", "Constantia", "Candara", "Corbel"}  # digits that sit below the line: poor for numbers
_CANDIDATES = ["Arial", "Times New Roman", "Cambria", "Calibri", "Georgia", "Verdana", "Tahoma", "Segoe UI", "Book Antiqua",
               "Garamond", "Constantia", "Palatino Linotype", "Trebuchet MS", "Courier New", "Century Schoolbook", "Candara"]


_SERIF = {"Times New Roman", "Cambria", "Georgia", "Book Antiqua", "Garamond", "Constantia", "Palatino Linotype", "Century Schoolbook"}
_PAGE_RANKS: dict = {}  # per scan image, so every edit on a page lands on the same typeface


def _prepare(refs: list) -> list:
    prepared = []
    for mask, text in refs:
        tight = _tight(mask) if mask is not None else None
        if tight is not None and text.strip():
            prepared.append((_fingerprint(tight), tight.shape[1] / tight.shape[0], text, max(len(text.strip()), 1), tight.shape[0]))
    if len(prepared) >= 3:  # a crop much taller than the rest caught a neighbouring line: ignore it
        med = float(np.median([p[4] for p in prepared]))
        prepared = [p for p in prepared if p[4] <= 1.8 * med]
    return prepared


def rank_fonts(refs: list, italic: bool = False) -> dict:
    """Score every installed candidate typeface (regular weight) against text cut from the scan.
    refs: (ink mask, text) pairs. Returns {(path, index): (score, font)}."""
    prepared = _prepare(refs)
    out, seen = {}, set()
    if not prepared:
        return out
    for name in _CANDIDATES:
        f, quality = _style(name, False, italic, False, False)
        if f is None or quality == "similar" or (f.path, f.index) in seen:
            continue
        seen.add((f.path, f.index))
        total, weight = 0.0, 0.0
        for fp, ar, text, n, _h in prepared:
            if not all(has_glyph(f, c) for c in text if not c.isspace()):
                continue
            cand = _tight(rasterize(text, f, 48.0).alpha > 0.4)
            if cand is None:
                continue
            sc = float(_fingerprint(cand) @ fp) - 0.8 * abs(np.log((cand.shape[1] / cand.shape[0]) / ar))
            total, weight = total + sc * n, weight + n
        if weight:
            out[(f.path, f.index)] = (total / weight, f)
    return out


def auto_font(local: dict, page: dict, new_text: str, bold: bool, italic: bool, heavy: bool) -> Optional[SysFont]:
    """Pick from the rankings: the nearby text decides serif vs sans, the whole page decides which one,
    so edits all over one page use one consistent typeface."""
    keys = set(local) | set(page)
    if not keys:
        return None
    digits = any(c.isdigit() for c in new_text)

    def usable(k):
        f = (local.get(k) or page.get(k))[1]
        return all(has_glyph(f, c) for c in new_text if not c.isspace()) and not (digits and f.family in _OLDSTYLE)

    ok = [k for k in keys if usable(k)]
    if not ok:
        return None

    def score(k):
        if k in local and k in page:  # the text around the word counts most, the page a little (keeps edits consistent)
            return 0.85 * local[k][0] + 0.15 * page[k][0]
        return (local.get(k) or page.get(k))[0]

    top_local = max((k for k in ok if k in local), key=lambda k: local[k][0], default=None)
    if top_local is not None:
        serif = local[top_local][1].family in _SERIF
        same = [k for k in ok if (((local.get(k) or page.get(k))[1].family in _SERIF) == serif)]
        ok = same or ok
    best = (local.get(max(ok, key=score)) or page.get(max(ok, key=score)))[1]
    if bold or heavy:
        bf, q = _style(best.family, True, italic, False, False)
        if bf is not None and q != "similar" and all(has_glyph(bf, c) for c in new_text if not c.isspace()):
            return bf
    return best


# ------------------------------------------------------------------ the edit
def _decode(xobj: pikepdf.Stream) -> Image.Image:
    if xobj.get("/ImageMask", False):
        raise EditError("This scan is stored as a stencil mask and cannot be edited")
    try:
        im = pikepdf.PdfImage(xobj).as_pil_image()
    except Exception as exc:
        raise EditError(f"Cannot decode the scanned image ({exc}); JBIG2 scans need jbig2dec") from exc
    if im.mode in ("1", "P", "LA"):
        im = im.convert("L") if im.mode != "P" else im.convert("RGB")
    elif im.mode in ("CMYK", "RGBA", "I;16"):
        im = im.convert("RGB")
    return im


def _hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


@dataclass
class ScanEditResult:
    data: bytes
    report: dict
    ocr: dict


def edit_scan(data: bytes, page: int, ocr: dict, word_ids: list[int], new_text: str,
              anchor: str = "auto", family: str = "auto", bold: bool = False, italic: bool = False) -> ScanEditResult:
    words = ocr["words"]
    try:
        sel = [words[i] for i in sorted(set(word_ids))]
    except IndexError:
        raise EditError("Selection no longer matches the OCR result; reload the page")
    if not sel:
        raise EditError("Nothing selected")
    old_text = " ".join(w["text"] for w in sel)
    pdf = pikepdf.open(io.BytesIO(data))
    model = PageModel(pdf, page)
    bx0 = min(w["bbox"][0] for w in sel); by0 = min(w["bbox"][1] for w in sel)
    bx1 = max(w["bbox"][2] for w in sel); by1 = max(w["bbox"][3] for w in sel)
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2

    # the scan image under the words (patches are not candidates)
    base = None
    for im in model.images:
        if "/PMPatch" in im["xobj"]:
            continue
        ax = mat_inverse_axis(im["ctm"])
        if ax is None:
            continue
        a, d, e, f = ax
        if min(e, e + a) <= cx <= max(e, e + a) and min(f, f + d) <= cy <= max(f, f + d):
            base = (im, ax)
    if base is None:
        raise EditError("No upright scan image found under this text (rotated or skewed placements are not supported)")
    im, (a, d, e, f) = base
    xobj = im["xobj"]
    W, H = int(xobj.Width), int(xobj.Height)

    def to_px(x, y):
        return (x - e) / a * W, (1 - (y - f) / d) * H

    def to_pdf(c, r):
        return e + a * c / W, f + d * (1 - r / H)

    def rect_px(b):
        (c0, r0), (c1, r1) = to_px(b[0], b[1]), to_px(b[2], b[3])
        return min(c0, c1), min(r0, r1), max(c0, c1), max(r0, r1)

    old_rects = [rect_px(w["bbox"]) for w in sel]
    oc0 = min(r[0] for r in old_rects); or0 = min(r[1] for r in old_rects)
    oc1 = max(r[2] for r in old_rects); or1 = max(r[3] for r in old_rects)
    hpx = max(or1 - or0, 2.0)
    wpx = max(oc1 - oc0, 2.0)

    img = _decode(xobj)
    if img.size != (W, H):
        img = img.resize((W, H))
    full = np.asarray(img).astype(np.float32)

    def crop(c0, r0, c1, r1, grow=0.0):
        x0, y0 = int(max(c0 - grow, 0)), int(max(r0 - grow, 0))
        x1, y1 = int(min(c1 + grow, W)), int(min(r1 + grow, H))
        return full[y0:y1, x0:x1] if x1 > x0 and y1 > y0 else None

    # how tilted is this line (phone photos of paper rarely sit level)?
    tilt = 0.0
    line_rects = [rect_px(w["bbox"]) for w in words if w["line"] == sel[0]["line"]]
    lc = crop(min(r[0] for r in line_rects), min(r[1] for r in line_rects),
              max(r[2] for r in line_rects), max(r[3] for r in line_rects), 2.0)
    if lc is not None and lc.size:
        tilt = estimate_tilt(_ink_bool(lc))
    hpx_c = max(hpx - wpx * abs(tilt), 0.55 * hpx)  # the word's own height, without the tilt's extra

    # typeface, size, width and baseline from how the *original* text sits in its box
    wc = crop(oc0, or0, oc1, or1)
    side_paper = None
    if wc is not None:
        r0_, r1_ = int(max(or0, 0)), int(min(or1, H))
        c0_, c1_ = int(max(oc0, 0)), int(min(oc1, W))
        beside = [full[r0_:r1_, max(c0_ - 5, 0):c0_], full[r0_:r1_, c1_:min(c1_ + 5, W)]]
        beside = [b.reshape(-1, b.shape[-1]) if b.ndim == 3 else b.reshape(-1, 1) for b in beside if b.size]
        if beside and sum(len(b) for b in beside) >= 12:
            side_paper = np.median(np.concatenate(beside), axis=0)
    word_mask = unshear(_ink_bool(wc, side_paper), tilt) if wc is not None else None
    tight = _tight(word_mask) if word_mask is not None else None
    if tight is not None and 0.5 * hpx <= tight.shape[0] <= hpx:  # the ink's own height beats the OCR box's slack
        hpx_c = float(tight.shape[0])
    font = None
    reused = False
    prev = [w for w in words if w.get("edited") and w.get("font") and w["line"] == sel[0]["line"]]
    if family == "auto" and prev and not bold and not italic:
        from .sysfonts import font_index
        fp, fi = prev[-1]["font"]
        font = next((f for f in font_index() if f.path == fp and f.index == fi), None)
        if font is not None and not all(has_glyph(font, c) for c in (new_text or old_text) if not c.isspace()):
            font = None
        reused = font is not None
    if font is None and family == "auto" and wc is not None:
        refs = [(word_mask, old_text)]
        by_line: dict[int, list[dict]] = {}
        for w in words:
            by_line.setdefault(w["line"], []).append(w)

        def line_ref(li):
            lw = sorted(by_line[li], key=lambda w: w["bbox"][0])
            text = " ".join(w["text"] for w in lw)
            rs = [rect_px(w["bbox"]) for w in lw]
            lcrop = crop(min(r[0] for r in rs), min(r[1] for r in rs), max(r[2] for r in rs), max(r[3] for r in rs), 2.0)
            if lcrop is None or lcrop.size == 0:
                return None
            raw = _ink_bool(lcrop)
            return unshear(raw, estimate_tilt(raw)), text

        near = sorted(by_line, key=lambda li: (li != sel[0]["line"], abs(li - sel[0]["line"])))
        for li in near[:4]:
            if li != sel[0]["line"] and len(" ".join(w["text"] for w in by_line[li])) < 14:
                continue
            r = line_ref(li)
            if r:
                refs.append(r)
        local = rank_fonts(refs, italic)

        import hashlib
        pkey = (hashlib.sha1(xobj.read_raw_bytes()).hexdigest(), italic, int(hpx // 4))
        if pkey not in _PAGE_RANKS:
            def same_size(li):  # only text of about this word's size says which typeface the body uses
                hs = [rect_px(w["bbox"])[3] - rect_px(w["bbox"])[1] for w in by_line[li]]
                return 0.75 * hpx <= float(np.median(hs)) <= 1.3 * hpx

            sized = [li for li in by_line if same_size(li)] or list(by_line)
            longest = sorted(sized, key=lambda li: -sum(len(w["text"]) for w in by_line[li]))[:8]
            prefs = [r for r in (line_ref(li) for li in longest if len(by_line[li]) >= 3) if r]
            body = [r for r in (line_ref(li) for li in sized[:40] if len(by_line[li]) >= 4) if r][:12]
            dens = [t.mean() for t in (_tight(m) for m, _t in body) if t is not None]
            _PAGE_RANKS[pkey] = (rank_fonts(prefs, italic), float(np.median(dens)) if dens else 0.0)
            if len(_PAGE_RANKS) > 16:
                _PAGE_RANKS.pop(next(iter(_PAGE_RANKS)))
        page_rank, body_density = _PAGE_RANKS[pkey]
        tm = _tight(word_mask) if word_mask is not None else None
        heavy = bool(tm is not None and body_density and tm.mean() > 1.4 * body_density and len(old_text) >= 3)
        font = auto_font(local, page_rank, new_text or old_text, bold, italic, heavy)
    if font is None:
        fam = family if family in FAMILIES else "sans"
        font = pick_font(new_text or old_text, fam, bold, italic)
    probe_font = font if all(has_glyph(font, c) for c in old_text if not c.isspace()) else pick_font(old_text, "sans", bold, italic)
    probe = rasterize(old_text, probe_font, 100.0)
    pr0, pc0, pr1, pc1 = probe.ink
    k = hpx_c / max(pr1 - pr0, 1)
    hx = float(np.clip(wpx / max((pc1 - pc0) * k, 1), 0.75, 1.3))
    xc = (oc0 + oc1) / 2
    baseline_c = (or0 + or1) / 2 - hpx_c / 2 + (probe.baseline - pr0) * k  # baseline under the word's middle
    weight = 0.0
    body_s = _body(word_mask) if tight is not None else None
    ink_l, ink_r = oc0, oc1  # where the old word's ink starts and ends (OCR boxes carry slack)
    if word_mask is not None and word_mask.any():
        body_rows = word_mask[body_s[0]:body_s[1]] if body_s else word_mask
        cs = body_rows.sum(axis=0)
        cols = np.nonzero(cs >= max(2, 0.08 * cs.max()))[0]  # stray glow at the box edge is not a letter
        if len(cols):
            ink_l, ink_r = int(max(oc0, 0)) + int(cols[0]), int(max(oc0, 0)) + int(cols[-1]) + 1

    def fit_to_scan(f: SysFont) -> Optional[tuple]:
        """Render the old word in typeface f at the scan's own scale and measure it exactly like the scan's word:
        same body height (size), width (hx), baseline and amount of ink (stroke weight)."""
        pf = f if all(has_glyph(f, c) for c in old_text if not c.isspace()) else probe_font
        kk = k
        for _ in range(3):
            pr = rasterize(old_text, pf, 100.0 * kk)
            pb = _body(_scan_like(_finish_alpha(pr.alpha, 1.0, kk)))
            if not pb or pb[1] - pb[0] < 2:
                return None
            kk *= (body_s[1] - body_s[0]) / (pb[1] - pb[0])
        pr = rasterize(old_text, pf, 100.0 * kk)
        pm = _scan_like(_finish_alpha(pr.alpha, 1.0, kk))
        pb, cols = _body(pm), np.nonzero(pm.any(axis=0))[0]
        if not pb or not len(cols):
            return None
        hh = float(np.clip(tight.shape[1] / (cols[-1] - cols[0] + 1), 0.75, 1.3))
        # unshear() moved column j down by extra + j*tilt rows; undo that at the word's middle
        extra = int(np.ceil(wc.shape[1] * abs(tilt))) + 1
        cy0, cx0 = int(max(or0, 0)), int(max(oc0, 0))
        base = cy0 + body_s[1] + (pr.baseline - pb[1]) - extra - (xc - cx0) * tilt
        alh = _finish_alpha(pr.alpha, hh, kk)
        have, want = float(_scan_like(alh).sum()), float(word_mask.sum())
        wgt = _fit_weight(alh, want) if have > 0 and 0.5 < want / have < 2.0 else 0.0
        return kk, hh, base, wgt

    if body_s and body_s[1] - body_s[0] >= 4:
        fit = fit_to_scan(font)
        if fit and not bold and not reused and fit[3] > 0:
            # regular or bold: whichever reproduces the original with the least thickening and stretching
            bf, q = _style(font.family, True, italic, False, False)
            if (bf is not None and q != "similar" and (bf.path, bf.index) != (font.path, font.index)
                    and all(has_glyph(bf, c) for c in new_text if not c.isspace())):
                fb = fit_to_scan(bf)

                def cost(f_):
                    return abs(f_[3]) + 2.0 * abs(np.log(f_[1]))
                if fb and cost(fb) < cost(fit):
                    font, fit = bf, fb
        if fit:
            k, hx, baseline_c, weight = fit
    baseline_row = baseline_c

    new_raster = rasterize(new_text, font, 100.0 * k) if new_text.strip() else None
    shift_dx, shift_dy, t_rects, trailing = 0, 0, [], []
    if new_raster is not None:
        nr0, nc0, nr1, nc1 = new_raster.ink
        ink_w = (nc1 - nc0) * hx
        resolved = anchor
        if anchor == "auto":
            resolved = "left"
        # shrink text that would run over the neighbouring words (or off the scan), down to half size
        line_words = [w for w in words if w["line"] == sel[0]["line"] and w not in sel]
        gap = 0.2 * hpx
        left_limit = max([rect_px(w["bbox"])[2] + gap for w in line_words if rect_px(w["bbox"])[2] <= oc0 + 1] + [0.0])
        right_limit = min([rect_px(w["bbox"])[0] - gap for w in line_words if rect_px(w["bbox"])[0] >= oc1 - 1] + [float(W)])
        mid = (oc0 + oc1) / 2
        room = {"right": oc1 - left_limit, "center": 2 * min(mid - left_limit, right_limit - mid)}.get(resolved, right_limit - oc0)
        # longer text: slide the rest of the line over (same size and letters) when the page has room
        trailing = sorted([w for w in line_words if rect_px(w["bbox"])[0] >= oc1 - 1], key=lambda w: rect_px(w["bbox"])[0])
        # shorter text: pull it back, like a word processor, so no hole is left in the line
        if resolved == "left" and trailing:
            t_rects = [rect_px(w["bbox"]) for w in trailing]
            t0, t1 = min(r[0] for r in t_rects), max(r[2] for r in t_rects)
            old_w = ink_r - ink_l
            need = ink_l + ink_w + max(t0 - ink_r, gap) - t0
            edge = max(rect_px(w["bbox"])[2] for w in words)
            grow_ok = ink_w > room > 0 and need > 0 and t1 + need <= min(max(edge, t1) + 0.02 * W, 0.99 * W)
            if t0 - oc1 < 3 * hpx and (grow_ok or need < -0.25 * (body_s[1] - body_s[0] if body_s else hpx)):
                shift_dx = int(round(need))
                shift_dy = int(round(-shift_dx * tilt))
                room = max(room, ink_w)
            else:
                trailing, t_rects = [], []
        if ink_w > room > 0:
            if hx > 0.75:  # first condense the letters a little (keeps the height)
                new_hx = max(0.75, hx * room / ink_w)
                ink_w *= new_hx / hx
                hx = new_hx
            if ink_w > room:  # then make the text smaller, down to 60%
                shrink = max(room / ink_w, 0.6)
                k *= shrink
                new_raster = rasterize(new_text, font, 100.0 * k)
                nr0, nc0, nr1, nc1 = new_raster.ink
                ink_w = (nc1 - nc0) * hx
            if ink_w > room * 1.02 + 2:
                have = int(len(new_text.strip()))
                raise EditError(
                    f"'{new_text.strip()}' is too long for the gap before the next word on this line ({have} characters would "
                    "not fit without overlapping it). Select the following words too (Shift+click) to replace them as well, "
                    "or use shorter text.")
        if resolved == "right":
            left_ink = oc1 - ink_w
        elif resolved == "center":
            left_ink = (oc0 + oc1) / 2 - ink_w / 2
        else:
            left_ink = ink_l
        baseline_row = baseline_c - (left_ink - xc) * tilt  # the line's baseline where the new word starts
        top = baseline_row - new_raster.baseline
        rise = ink_w * tilt
        new_rect = (left_ink, top + nr0 - max(rise, 0), left_ink + ink_w, top + nr1 + max(-rise, 0))
    else:
        resolved, new_rect = anchor, None

    # region covered by the patch (+ earlier patches it overlaps)
    pad = 1.0 * hpx
    rc0, rr0, rc1, rr1 = oc0 - pad, or0 - pad, oc1 + pad, or1 + pad
    if new_rect:
        rc0, rr0 = min(rc0, new_rect[0] - pad), min(rr0, new_rect[1] - pad)
        rc1, rr1 = max(rc1, new_rect[2] + pad), max(rr1, new_rect[3] + pad)
    blk = None
    if shift_dx:
        blk = (int(max(min(r[0] for r in t_rects) - 0.15 * hpx, 0)), int(max(min(r[1] for r in t_rects) - 0.2 * hpx, 0)),
               int(min(np.ceil(max(r[2] for r in t_rects) + 0.15 * hpx), W)), int(min(np.ceil(max(r[3] for r in t_rects) + 0.2 * hpx), H)))
        rc0, rc1 = min(rc0, blk[0] + shift_dx - pad), max(rc1, blk[2] + shift_dx + pad)
        rr0, rr1 = min(rr0, blk[1] + shift_dy - pad), max(rr1, blk[3] + shift_dy + pad)
    # which scan a patch belongs to: a fingerprint of the image data (object numbers change when the file is saved;
    # older patches carry "num gen", still accepted)
    import hashlib
    base_id = "sha1:" + hashlib.sha1(xobj.read_raw_bytes()).hexdigest()[:20]
    base_ids = {base_id, f"{xobj.objgen[0]} {xobj.objgen[1]}"}
    old_patches = []
    for p in model.images:
        meta = p["xobj"].get("/PMPatch")
        if meta is None or str(meta.Base) not in base_ids:
            continue
        pc = [float(v) for v in meta.Rect]
        if pc[0] < rc1 and pc[2] > rc0 and pc[1] < rr1 and pc[3] > rr0:
            old_patches.append((p, pc))
            rc0, rr0, rc1, rr1 = min(rc0, pc[0]), min(rr0, pc[1]), max(rc1, pc[2]), max(rr1, pc[3])
    rc0, rr0 = max(int(np.floor(rc0)), 0), max(int(np.floor(rr0)), 0)
    rc1, rr1 = min(int(np.ceil(rc1)), W), min(int(np.ceil(rr1)), H)
    if rc1 <= rc0 or rr1 <= rr0:
        raise EditError("Edited area falls outside the scan")

    region = img.crop((rc0, rr0, rc1, rr1))
    for p, pc in old_patches:  # bring earlier edits into the new patch
        pim = _decode(p["xobj"]).convert(region.mode)
        region.paste(pim, (int(pc[0]) - rc0, int(pc[1]) - rr0))
    arr = np.asarray(region).astype(np.float32)
    gray = arr if arr.ndim == 2 else arr.mean(axis=2)
    blk_pix = arr[blk[1] - rr0:blk[3] - rr0, blk[0] - rc0:blk[2] - rc0].copy() if blk else None

    # erase old words: find their ink (growing past the OCR box), then fill it from the surroundings
    rng = np.random.default_rng(7)
    H_, W_ = arr.shape[:2]
    mask = np.zeros((H_, W_), bool)
    avoid = np.zeros((H_, W_), bool)  # other ink nearby: must not bleed into the hole
    draw_rgb = None
    shadow = None  # (row offset, col offset, colour) of a drop shadow under the original text
    holes = []  # (hole, paper, limit) per word, for the texture
    protect = np.zeros((H_, W_), bool)  # other words' boxes: their ink is never erased
    erase = {id(w) for w in sel} | {id(w) for w in trailing}
    for w in words:
        if id(w) in erase:
            continue
        c0, r0, c1, r1 = rect_px(w["bbox"])
        x0, y0, x1, y1 = int(max(c0 - rc0, 0)), int(max(r0 - rr0, 0)), int(min(c1 - rc0, W_)), int(min(r1 - rr0, H_))
        if x1 > x0 and y1 > y0:
            protect[y0:y1, x0:x1] = True
    for (c0, r0, c1, r1) in old_rects + t_rects:
        protect[int(max(r0 - rr0, 0)):int(max(r1 - rr0, 0)), int(max(c0 - rc0, 0)):int(max(c1 - rc0, 0))] = False
    for (c0, r0, c1, r1) in old_rects + t_rects:
        ex, ey = 0.12 * hpx, 0.15 * hpx
        x0, y0 = int(max(c0 - ex - rc0, 0)), int(max(r0 - ey - rr0, 0))
        x1, y1 = int(min(c1 + ex - rc0, W_)), int(min(r1 + ey - rr0, H_))
        m = max(int(0.3 * hpx), 3)
        ring = np.zeros((H_, W_), bool)
        ring[max(y0 - m, 0):y1 + m, max(x0 - m, 0):x1 + m] = True
        ring[y0:y1, x0:x1] = False
        mask[y0:y1, x0:x1] = True
        if not ring.any() or y1 <= y0 or x1 <= x0:
            continue
        # paper = what surrounds the word; ink = what inside the box differs most from it
        # (so white-on-red, dark-on-light and colour-fringed photos all work, whatever the OCR guessed)
        paper = np.atleast_1d(np.median(arr[ring], axis=0)).astype(np.float32)
        inner = arr[y0:y1, x0:x1]
        dd = np.linalg.norm(inner - paper, axis=-1) if inner.ndim == 3 else np.abs(inner - paper[0])
        if dd.max() < 20:
            continue
        ink_rgb = np.atleast_1d(np.median(inner[dd >= np.percentile(dd, 90)], axis=0)).astype(np.float32)
        if draw_rgb is None:
            draw_rgb = tuple(int(v) for v in (ink_rgb if ink_rgb.size == 3 else [ink_rgb[0]] * 3))
        wm = int(0.75 * hpx)
        window = (max(y0 - wm, 0), max(x0 - wm, 0), min(y1 + wm, H_), min(x1 + wm, W_))
        rdist = np.linalg.norm(arr[ring] - paper, axis=-1) if arr.ndim == 3 else np.abs(arr[ring] - paper[0])
        noise = float(np.percentile(rdist, 85))  # paper grain / blur halo level around the word
        thr = float(np.clip(1.5 * noise / max(np.linalg.norm(ink_rgb - paper), 1.0), 0.16, 0.4))
        grown, cand = ink_mask(arr, paper, ink_rgb, window, (y0, x0, y1, x1), int(2.0 * hpx), thr, protect)
        if grown is not None:
            hole = _dilate(grown, max(int(0.12 * hpx), 3)) & ~protect
            hole[y0:y1, x0:x1] = True
            mask |= hole
            avoid |= _dilate(cand, 2)
            holes.append((hole, paper, max(0.45 * float(np.linalg.norm(ink_rgb - paper)), 2.0 * noise)))
            if shadow is None and arr.ndim == 3:
                # a shadow / glow of the opposite tone, offset from the letters (white text on a banner)
                axis = ink_rgb - paper
                tt = ((arr - paper) @ axis) / max(float(axis @ axis), 1e-6)
                lit, dark = grown & (tt > 0.5), grown & (tt < -0.15) & (np.linalg.norm(arr - paper, axis=-1) > max(1.5 * noise, 18))
                if lit.sum() > 20 and dark.sum() > 0.25 * lit.sum():
                    R = max(int(0.2 * hpx), 2)
                    sc = {(oy, ox): int((np.roll(lit, (oy, ox), (0, 1)) & dark).sum()) for oy in range(-R, R + 1) for ox in range(-R, R + 1)}
                    (oy, ox), hit = max(sc.items(), key=lambda kv: kv[1])
                    if hit > 0.3 * dark.sum():
                        deep = dark & (tt <= np.percentile(tt[dark], 40))
                        shadow = (oy, ox, np.median(arr[deep], axis=0).astype(np.float32), min(dark.sum() / lit.sum(), 2.0))
    if mask.any():
        filled = inpaint(arr, mask, avoid & ~mask)
        ring_all = _dilate(mask, 6) & ~_dilate(mask, 2) & ~avoid
        if ring_all.any():  # speckles in the surroundings pull the average up: pin the fill to their median
            shift = np.median(arr[ring_all], axis=0) - np.median(filled[mask], axis=0)
            filled = np.where(mask[..., None] if arr.ndim == 3 else mask, filled + np.clip(shift, -25, 25), filled)
        if ring_all.any():
            hp = arr - _box_blur(arr, 2)  # the scan's own grain, measured next to the hole
            hr = hp[ring_all]
            grain = np.minimum(1.4826 * np.median(np.abs(hr - np.median(hr, axis=0)), axis=0), 8)  # robust: ignore bright specks
        else:
            grain = 0
        noise = rng.normal(0, 1, arr.shape).astype(np.float32) * grain
        for hole, paper_h, limit in holes:  # the real texture, where plain background of the same size is near
            tex = texture(full, hole, rr0, rc0, paper_h, limit, hpx)
            if tex is not None:
                noise = np.where(hole[..., None] if arr.ndim == 3 else hole, tex, noise)
        soft = np.clip(_box_blur(mask.astype(np.float32), 2) * 1.5, 0, 1)  # feathered edge, no visible rectangle
        soft = soft[..., None] if arr.ndim == 3 else soft
        arr = np.clip(arr * (1 - soft) + (filled + noise) * soft, 0, 255)

    if blk_pix is not None:  # the rest of the line, moved over with the line's tilt
        bh, bw = blk_pix.shape[:2]
        sy, sx = blk[1] - rr0 + shift_dy, blk[0] - rc0 + shift_dx
        y0, x0, y1, x1 = max(sy, 0), max(sx, 0), min(sy + bh, H_), min(sx + bw, W_)
        if y1 > y0 and x1 > x0:
            ry = np.clip(np.minimum(np.arange(bh) + 1, bh - np.arange(bh)) / 3.0, 0, 1)
            rx = np.clip(np.minimum(np.arange(bw) + 1, bw - np.arange(bw)) / 3.0, 0, 1)
            wgt = np.minimum.outer(ry, rx)[y0 - sy:y1 - sy, x0 - sx:x1 - sx]
            wgt = wgt if arr.ndim == 2 else wgt[..., None]
            arr[y0:y1, x0:x1] = arr[y0:y1, x0:x1] * (1 - wgt) + blk_pix[y0 - sy:y1 - sy, x0 - sx:x1 - sx] * wgt

    # draw the new text
    color = draw_rgb or _hex_rgb(sel[0].get("color", "#000000"))
    if new_raster is not None:
        al = np.clip(_reweight(_finish_alpha(new_raster.alpha, hx, k), weight), 0, 1)
        lift = 0
        if abs(tilt) > 1e-4:
            lift = int(np.ceil(al.shape[1] * abs(tilt))) + 2
            padded = np.zeros((al.shape[0] + 2 * lift, al.shape[1]), np.float32)
            padded[lift:lift + al.shape[0]] = al
            sheared = Image.fromarray((padded * 255).astype(np.uint8)).transform(
                (padded.shape[1], padded.shape[0]), Image.AFFINE, (1, 0, 0, tilt, 1, -new_raster.ink[1] * hx * tilt), Image.BILINEAR)
            al = np.asarray(sheared).astype(np.float32) / 255.0
        ox = int(round(new_rect[0] - new_raster.ink[1] * hx - rc0))
        oy = int(round(baseline_row - new_raster.baseline - rr0)) - lift
        y0, x0 = max(oy, 0), max(ox, 0)
        y1, x1 = min(oy + al.shape[0], arr.shape[0]), min(ox + al.shape[1], arr.shape[1])
        if shadow is not None:
            sy_, sx_, srgb, spread = shadow
            sal = np.asarray(Image.fromarray((_reweight(al, min(spread - 0.6, 1.0)) * 255).clip(0, 255).astype(np.uint8))
                             .filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0
            qy, qx = oy + sy_, ox + sx_
            u0, v0 = max(qy, 0), max(qx, 0)
            u1, v1 = min(qy + sal.shape[0], arr.shape[0]), min(qx + sal.shape[1], arr.shape[1])
            if u1 > u0 and v1 > v0:
                sa = sal[u0 - qy:u1 - qy, v0 - qx:v1 - qx, None]
                arr[u0:u1, v0:v1] = arr[u0:u1, v0:v1] * (1 - sa) + srgb * sa
        if y1 > y0 and x1 > x0:
            a_ = al[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
            ink = np.array(color if arr.ndim == 3 else [sum(color) / 3], np.float32)
            if arr.ndim == 2:
                arr[y0:y1, x0:x1] = arr[y0:y1, x0:x1] * (1 - a_) + ink[0] * a_
            else:
                arr[y0:y1, x0:x1] = arr[y0:y1, x0:x1] * (1 - a_[..., None]) + ink * a_[..., None]

    # the working region is generous; keep only what changed (plus earlier patches) so untouched scan
    # pixels are not re-encoded
    keep = np.zeros((H_, W_), bool)
    mp = max(int(0.25 * hpx), 2)
    if mask.any():
        keep |= _dilate(mask, mp)
    if new_rect:
        keep[max(int(new_rect[1] - rr0) - mp, 0):int(new_rect[3] - rr0) + mp, max(int(new_rect[0] - rc0) - mp, 0):int(new_rect[2] - rc0) + mp] = True
    if blk:
        keep[max(blk[1] + shift_dy - rr0 - mp, 0):blk[3] + shift_dy - rr0 + mp, max(blk[0] + shift_dx - rc0 - mp, 0):blk[2] + shift_dx - rc0 + mp] = True
    for _p, pc in old_patches:
        keep[max(int(pc[1]) - rr0, 0):int(pc[3]) - rr0, max(int(pc[0]) - rc0, 0):int(pc[2]) - rc0] = True
    ys, xs = np.nonzero(keep)
    if len(ys):
        cy0, cy1, cx0, cx1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        arr = arr[cy0:cy1, cx0:cx1]
        rc0, rr0 = rc0 + cx0, rr0 + cy0
        rc1, rr1 = rc0 + arr.shape[1], rr0 + arr.shape[0]
    patch = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), region.mode)
    pobj = _patch_xobject(pdf, patch, str(xobj.get("/Filter", "")) == "/DCTDecode")
    pobj.PMPatch = pikepdf.Dictionary(Base=pikepdf.String(base_id), Rect=[rc0, rr0, rc1, rr1])
    pobj = pdf.make_indirect(pobj)

    # place it right after the scan is drawn; drop the patches it replaces
    editor = PageEditor(pdf, model)
    editor._detach(im["stream"])
    info = model.streams[im["stream"]]

    def wrapped(key, op):  # a patch's Do with the q / cm / Q drawn around it
        ins = model.streams[key].instructions
        if op >= 2 and op + 1 < len(ins) and [str(ins[j][1]) for j in (op - 2, op - 1, op + 1)] == ["q", "cm", "Q"]:
            return (op - 2, op - 1, op, op + 1)
        return (op,)

    drop = {(p["stream"], j) for p, _ in old_patches for j in wrapped(p["stream"], p["op"])}
    res = info.resources
    if "/XObject" not in res:
        res.XObject = pikepdf.Dictionary()
    n = 1
    while f"/PMI{n}" in res.XObject:
        n += 1
    name = f"/PMI{n}"
    res.XObject[name] = pobj
    m = [(rc1 - rc0) / W, 0, 0, (rr1 - rr0) / H, rc0 / W, 1 - rr1 / H]
    # right after the scan, but above any earlier patch of it that stays, so nothing older can cover the new edit
    after = im["op"]
    for q in model.images:
        meta = q["xobj"].get("/PMPatch")
        if meta is None or q["stream"] != im["stream"] or (q["stream"], q["op"]) in drop or q["op"] <= after:
            continue
        if str(meta.Base) in base_ids or float(meta.Rect[0]) < rc1 and float(meta.Rect[2]) > rc0 and float(meta.Rect[1]) < rr1 and float(meta.Rect[3]) > rr0:
            nxt = info.instructions[q["op"] + 1] if q["op"] + 1 < len(info.instructions) else None
            after = q["op"] + 1 if nxt is not None and str(nxt[1]) == "Q" else q["op"]
    new_instrs = []
    for i, ins in enumerate(info.instructions):
        if (info.key, i) in drop:
            continue
        new_instrs.append(ins)
        if i == after:
            new_instrs += [([], pikepdf.Operator("q")), ([round(v, 8) for v in m], pikepdf.Operator("cm")),
                           ([pikepdf.Name(name)], pikepdf.Operator("Do")), ([], pikepdf.Operator("Q"))]
    for key in {s for s, _ in drop} - {info.key}:  # patches drawn from another stream
        other = model.streams[key]
        other.instructions = [ins for j, ins in enumerate(other.instructions) if (key, j) not in drop]
        other.dirty = True
    info.instructions = new_instrs
    info.dirty = True
    for s in model.streams.values():
        if s.dirty:
            editor._write(s)

    # OCR words follow the edit
    new_words = [w for i, w in enumerate(words) if i not in set(word_ids)]
    if shift_dx:
        (px0, py0), (px1, py1) = to_pdf(0, 0), to_pdf(shift_dx, shift_dy)
        moved = {id(w) for w in trailing}
        new_words = [{**w, "bbox": [round(w["bbox"][0] + px1 - px0, 2), round(w["bbox"][1] + py1 - py0, 2),
                                    round(w["bbox"][2] + px1 - px0, 2), round(w["bbox"][3] + py1 - py0, 2)]} if id(w) in moved else w
                     for w in new_words]
    if new_rect is not None:
        (x0, y1_), (x1, y0_) = to_pdf(new_rect[0], new_rect[1]), to_pdf(new_rect[2], new_rect[3])
        new_words.append({"text": new_text, "conf": 100.0, "line": sel[0]["line"], "color": sel[0].get("color", "#000000"),
                          "bbox": [round(min(x0, x1), 2), round(min(y0_, y1_), 2), round(max(x0, x1), 2), round(max(y0_, y1_), 2)],
                          "edited": True, "font": [font.path, font.index]})
    new_ocr = {**ocr, "words": new_words}
    if has_text_layer(pdf, page):
        add_text_layer(pdf, page, new_words)

    # does it collide with the next word on the line?
    overflow = 0.0
    if new_rect is not None and not shift_dx:
        nx1 = to_pdf(new_rect[2], 0)[0]
        right = [w["bbox"][0] for w in words if w["line"] == sel[0]["line"] and w not in sel and w["bbox"][0] >= bx1 - 0.5]
        if right:
            overflow = max(0.0, nx1 - (min(right) - 0.15 * (by1 - by0)))
    buf = io.BytesIO()
    pdf.save(buf, compress_streams=True)
    report = {
        "originalText": old_text, "newText": new_text, "font": font.label, "fontSize": round((by1 - by0), 2),
        "strategy": "scan-patch", "substitutes": [], "fits": overflow <= 0.01, "overflow": round(overflow, 2),
        "scale": round(hx, 3), "anchor": resolved, "fit": "none", "fitApplied": "none",
        "originalWidth": round(bx1 - bx0, 2), "newWidth": round(abs(to_pdf(new_rect[2], 0)[0] - to_pdf(new_rect[0], 0)[0]), 2) if new_rect else 0,
        "warnings": ([f"New text overlaps the next word by {overflow:.1f}pt"] if overflow > 0.01 else []),
        "notes": ["Scanned page: the old word was painted over with reconstructed paper and the new word drawn to match"],
    }
    return ScanEditResult(buf.getvalue(), report, new_ocr)


def _patch_xobject(pdf: pikepdf.Pdf, im: Image.Image, jpeg: bool) -> pikepdf.Stream:
    cs = pikepdf.Name.DeviceGray if im.mode == "L" else pikepdf.Name.DeviceRGB
    if jpeg:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=95, subsampling=0)
        data, flt = buf.getvalue(), pikepdf.Name.DCTDecode
    else:
        data, flt = zlib.compress(im.tobytes(), 9), pikepdf.Name.FlateDecode
    s = pikepdf.Stream(pdf, data)
    s.Type, s.Subtype = pikepdf.Name.XObject, pikepdf.Name.Image
    s.Width, s.Height, s.ColorSpace, s.BitsPerComponent, s.Filter = im.width, im.height, cs, 8, flt
    return s
