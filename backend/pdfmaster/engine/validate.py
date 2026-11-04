"""Fidelity checks after an edit: glyph-position comparison and pixel diff."""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable

import numpy as np

from .interpreter import PageModel
from .render import PageGeometry, array_to_png, geometry_for, page_count, render_array, render_png  # noqa: F401

TOL = 0.05  # pt


def _match(before: Iterable, after: Iterable):
    """Greedy match glyphs by character and position. Returns (unmatched_before, unmatched_after)."""
    pool = defaultdict(list)
    for g in after:
        pool[g.ch].append(g)
    missing = []
    for g in before:
        cands = pool.get(g.ch)
        hit = None
        if cands:
            for k, a in enumerate(cands):
                if abs(a.origin[0] - g.origin[0]) <= TOL and abs(a.origin[1] - g.origin[1]) <= TOL:
                    hit = k
                    break
        if hit is None:
            missing.append(g)
        else:
            cands.pop(hit)
    extra = [g for lst in pool.values() for g in lst]
    extra.sort(key=lambda g: g.idx)
    return missing, extra


def verify_positions(before: PageModel, after: PageModel, edited: set[int], reflow: set[int], new_texts: list[str]) -> dict:
    keep = [g for g in before.glyphs if g.idx not in edited and g.idx not in reflow]
    missing, extra = _match(keep, after.glyphs)
    expected = "".join(t for t in new_texts).replace(" ", "")
    # glyphs of reflowed text legitimately move; drop them from the "extra" list by content
    reflow_chars = "".join(before.glyphs[i].ch for i in sorted(reflow))
    got = "".join(g.ch for g in extra if not g.ch.isspace())
    text_ok = got == expected + reflow_chars.replace(" ", "") or got.replace(reflow_chars.replace(" ", ""), "", 1) == expected
    return {
        "unchangedGlyphs": len(keep) - len(missing),
        "movedGlyphs": len(missing),
        "moved": [{"ch": g.ch, "x": round(g.origin[0], 2), "y": round(g.origin[1], 2)} for g in missing[:20]],
        "newTextVerified": text_ok,
        "renderedNewText": got,
    }


def _geometry(data: bytes, index: int, zoom: float) -> PageGeometry:
    import pikepdf, io

    with pikepdf.open(io.BytesIO(data)) as pdf:
        return geometry_for(pdf.pages[index], zoom)


def pixel_diff(before: bytes, after: bytes, index: int, expected_rects: list, zoom: float = 1.5) -> dict:
    a, b = render_array(before, index, zoom), render_array(after, index, zoom)
    if a.shape != b.shape:
        return {"pageSizeChanged": True, "changedOutside": -1, "changedInside": -1}
    changed = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > 48
    allowed = np.zeros_like(changed)
    geo = _geometry(after, index, zoom)
    h, w = changed.shape
    for rect in expected_rects:
        x0, y0, x1, y1 = geo.rect_to_px(rect)
        x0, y0 = max(int(x0) - 2, 0), max(int(y0) - 2, 0)
        x1, y1 = min(int(x1) + 3, w), min(int(y1) + 3, h)
        if x1 > x0 and y1 > y0:
            allowed[y0:y1, x0:x1] = True
    outside = int((changed & ~allowed).sum())
    return {"pageSizeChanged": False, "changedOutside": outside, "changedInside": int((changed & allowed).sum())}


def diff_png(before: bytes, after: bytes, index: int, zoom: float = 1.5) -> tuple[bytes, dict]:
    """The edited page with changed pixels highlighted, plus statistics."""
    if index >= page_count(before) or index >= page_count(after):
        raise IndexError("page out of range")
    a, b = render_array(before, index, zoom), render_array(after, index, zoom)
    if a.shape != b.shape:
        h, w = max(a.shape[0], b.shape[0]), max(a.shape[1], b.shape[1])
        pa = np.full((h, w, 3), 255, np.uint8)
        pb = pa.copy()
        pa[: a.shape[0], : a.shape[1]] = a
        pb[: b.shape[0], : b.shape[1]] = b
        a, b = pa, pb
    changed = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > 48
    out = (b.astype(np.float32) * 0.35 + 255 * 0.65).astype(np.uint8)  # faded page
    removed = changed & (a.mean(axis=2) < b.mean(axis=2))  # ink present only before
    added = changed & ~removed
    out[removed] = (230, 57, 70)
    out[added] = (29, 120, 255)
    ys, xs = np.nonzero(changed)
    stats = {
        "changedPixels": int(changed.sum()),
        "changedRatio": float(changed.mean()),
        "region": None if not len(xs) else [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
        "zoom": zoom,
    }
    return array_to_png(out), stats
