"""Pictures on a page: list them, move / resize / rotate / delete / replace them, and add new ones.

Images are edited by changing the instructions that draw them, never by re-encoding the picture
(except Replace, which embeds the new file). A move or resize wraps the image's own `Do` in
`q <matrix> cm ... Q`, which works wherever the image sits: in the page, nested transforms, or inside
a form object (that use is copied first, like text edits, so other pages are untouched).
"""
from __future__ import annotations

import math
from typing import Optional

import pikepdf

from . import geometry as G
from .editor import EditError, PageEditor
from .interpreter import PageModel

MIN_SIZE = 4.0  # points


def _inv(m: G.Matrix) -> G.Matrix:
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-12:
        raise EditError("This image has a degenerate size and cannot be edited")
    ia, ib, ic, id_ = d / det, -b / det, -c / det, a / det
    return (ia, ib, ic, id_, -(e * ia + f * ic), -(e * ib + f * id_))


def _bbox(ctm: G.Matrix) -> list[float]:
    pts = [G.apply(ctm, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def _visible(im: dict) -> bool:
    return "/PMPatch" not in im["xobj"]  # scan-edit patches are managed by the text editor


def describe(model: PageModel) -> list[dict]:
    """Images of the page for the UI. `id` is the position in drawing order."""
    out = []
    for i, im in enumerate(model.images):
        if not _visible(im):
            continue
        xo, c = im["xobj"], im["ctm"]
        bb = _bbox(c)
        w_pt, h_pt = math.hypot(c[0], c[1]), math.hypot(c[2], c[3])
        try:
            w_px, h_px = int(xo.Width), int(xo.Height)
        except Exception:
            w_px = h_px = 0
        dpi = min(w_px / max(w_pt / 72, 1e-6), h_px / max(h_pt / 72, 1e-6)) if w_px else 0
        clip = im.get("clip")
        clipped = False
        if clip is not None:
            # a frame that crops the picture (a frame equal to the picture only trims its edge)
            clipped = (clip[2] - clip[0]) < (bb[2] - bb[0]) - 1 or (clip[3] - clip[1]) < (bb[3] - bb[1]) - 1
        out.append({
            "id": i, "bbox": [round(v, 2) for v in bb], "width": w_px, "height": h_px, "dpi": round(dpi),
            "pageScan": False, "inForm": im["stream"] != "page", "clipped": clipped, "name": str(im["name"]).lstrip("/"),
            "hasAlpha": "/SMask" in xo, "colorSpace": _cs_name(xo),
        })
    # a picture covering (nearly) the whole page is a scan or background
    x0, y0, x1, y1 = model.mediabox
    for d in out:
        b = d["bbox"]
        d["pageScan"] = (b[2] - b[0]) * (b[3] - b[1]) > 0.85 * (x1 - x0) * (y1 - y0)
    return out


def _cs_name(xo) -> str:
    cs = xo.get("/ColorSpace")
    if isinstance(cs, pikepdf.Name):
        return str(cs)[1:].replace("Device", "")
    if isinstance(cs, pikepdf.Array) and len(cs):
        return str(cs[0])[1:]
    return ""


def _pick(model: PageModel, index: int) -> dict:
    if not 0 <= index < len(model.images) or not _visible(model.images[index]):
        raise EditError("That image no longer exists on this page")
    return model.images[index]


def _emit(editor: PageEditor, im: dict, wrap: Optional[list], delete: bool = False) -> None:
    """Replace the image's Do with `wrap` (instructions to put before it), or remove it."""
    key = im["stream"]
    editor._detach(key)
    info = editor.model.streams[key]
    ins = info.instructions[im["op"]]
    if delete:
        del info.instructions[im["op"]]
    else:
        info.instructions[im["op"]:im["op"] + 1] = [([], pikepdf.Operator("q"))] + (wrap or []) + [ins, ([], pikepdf.Operator("Q"))]
    info.dirty = True


def _flatten(editor: PageEditor) -> None:
    """Write every changed stream back (the page, and any form copy made for this edit)."""
    for info in editor.model.streams.values():
        if info.dirty:
            editor._write(info)


def transform(pdf: pikepdf.Pdf, page: int, index: int, bbox: Optional[list[float]] = None,
              rotate: int = 0) -> dict:
    """Move/resize the image to `bbox` (page coordinates) and/or rotate it by a multiple of 90°
    around its centre. Returns notes about the result."""
    model = PageModel(pdf, page)
    im = _pick(model, index)
    ctm = im["ctm"]
    old = _bbox(ctm)
    t = G.IDENTITY
    notes: dict = {"warnings": []}
    if rotate % 360:
        if rotate % 90:
            raise EditError("Images rotate in steps of 90 degrees")
        cx, cy = (old[0] + old[2]) / 2, (old[1] + old[3]) / 2
        r = math.radians(rotate)
        rot = (math.cos(r), math.sin(r), -math.sin(r), math.cos(r), 0.0, 0.0)
        t = G.mul(G.mul(G.translate(-cx, -cy), rot), G.translate(cx, cy))
        old = [min(p[0] for p in _corners(old, t)), min(p[1] for p in _corners(old, t)),
               max(p[0] for p in _corners(old, t)), max(p[1] for p in _corners(old, t))]
    if bbox is not None:
        nx0, ny0, nx1, ny1 = min(bbox[0], bbox[2]), min(bbox[1], bbox[3]), max(bbox[0], bbox[2]), max(bbox[1], bbox[3])
        if nx1 - nx0 < MIN_SIZE or ny1 - ny0 < MIN_SIZE:
            raise EditError("Images must be at least 4 pt wide and tall")
        ow, oh = old[2] - old[0], old[3] - old[1]
        if ow < 1e-6 or oh < 1e-6:
            raise EditError("This image has no size to scale")
        sx, sy = (nx1 - nx0) / ow, (ny1 - ny0) / oh
        scale = (sx, 0.0, 0.0, sy, nx0 - old[0] * sx, ny0 - old[1] * sy)
        t = G.mul(t, scale)
        final = [nx0, ny0, nx1, ny1]
    else:
        final = [min(p[0] for p in _corners(_bbox(ctm), t)), min(p[1] for p in _corners(_bbox(ctm), t)),
                 max(p[0] for p in _corners(_bbox(ctm), t)), max(p[1] for p in _corners(_bbox(ctm), t))]
    # local matrix M with M x ctm = ctm x T
    m = G.mul(G.mul(ctm, t), _inv(ctm))
    editor = PageEditor(pdf, model)
    _emit(editor, im, [([round(v, 6) for v in m], pikepdf.Operator("cm"))])
    _flatten(editor)
    x0, y0, x1, y1 = model.mediabox
    if final[0] < x0 - 0.5 or final[1] < y0 - 0.5 or final[2] > x1 + 0.5 or final[3] > y1 + 0.5:
        notes["warnings"].append("Part of the image is now outside the page and will not be visible")
    clip = im.get("clip")
    if clip is not None and (final[0] < clip[0] - 0.5 or final[1] < clip[1] - 0.5 or final[2] > clip[2] + 0.5 or final[3] > clip[3] + 0.5):
        notes["warnings"].append("The image sits inside a frame that crops it; the part outside the frame stays hidden")
    notes["bbox"] = [round(v, 2) for v in final]
    return notes


def _corners(b, t):
    return [G.apply(t, x, y) for x, y in ((b[0], b[1]), (b[2], b[1]), (b[0], b[3]), (b[2], b[3]))]


def delete(pdf: pikepdf.Pdf, page: int, index: int) -> None:
    model = PageModel(pdf, page)
    im = _pick(model, index)
    editor = PageEditor(pdf, model)
    _emit(editor, im, None, delete=True)
    _flatten(editor)


def replace(pdf: pikepdf.Pdf, page: int, index: int, data: bytes, fit: str = "contain") -> dict:
    """Swap the picture, keeping its place. `contain` keeps the new picture's proportions inside the
    old frame; `stretch` fills the frame exactly."""
    from .annotate import _image_xobject

    model = PageModel(pdf, page)
    im = _pick(model, index)
    xo, w, h = _image_xobject(pdf, data)
    c = im["ctm"]
    fw, fh = math.hypot(c[0], c[1]), math.hypot(c[2], c[3])
    sx = sy = 1.0
    if fit == "contain" and fw > 0 and fh > 0:
        a = w / h
        if a > fw / fh:
            sy = (fw / a) / fh
        else:
            sx = (fh * a) / fw
    local = (sx, 0.0, 0.0, sy, (1 - sx) / 2, (1 - sy) / 2)
    editor = PageEditor(pdf, model)
    key = im["stream"]
    editor._detach(key)
    info = editor.model.streams[key]
    res = info.resources
    xd = res.get("/XObject")
    if xd is None:
        res["/XObject"] = pikepdf.Dictionary()
        xd = res["/XObject"]
    n = 1
    while f"/PMImg{n}" in xd:
        n += 1
    name = pikepdf.Name(f"/PMImg{n}")
    xd[name] = xo
    do = pikepdf.ContentStreamInstruction([name], pikepdf.Operator("Do"))
    info.instructions[im["op"]:im["op"] + 1] = [
        ([], pikepdf.Operator("q")), ([round(v, 6) for v in local], pikepdf.Operator("cm")), do, ([], pikepdf.Operator("Q"))]
    info.dirty = True
    _flatten(editor)
    return {"pixels": [w, h]}


def insert(pdf: pikepdf.Pdf, page: int, rect: list[float], data: bytes, fit: str = "contain") -> dict:
    """Add a new picture to the top of the page, fitted into rect (page coordinates)."""
    from .annotate import _image_xobject

    x0, y0, x1, y1 = min(rect[0], rect[2]), min(rect[1], rect[3]), max(rect[0], rect[2]), max(rect[1], rect[3])
    bw, bh = x1 - x0, y1 - y0
    if bw < MIN_SIZE or bh < MIN_SIZE:
        raise EditError("The image area is too small")
    xo, w, h = _image_xobject(pdf, data)
    if fit == "stretch":
        dw, dh = bw, bh
    else:
        s = min(bw / w, bh / h)
        dw, dh = w * s, h * s
    ox, oy = x0 + (bw - dw) / 2, y0 + (bh - dh) / 2
    pg = pdf.pages[page]
    res = pg.obj.get("/Resources")
    if res is None:  # inherited from the page tree: give this page its own reference to it
        pg.obj.Resources = pg.resources
        res = pg.obj.Resources
    if "/XObject" not in res:
        res["/XObject"] = pikepdf.Dictionary()
    xd = res["/XObject"]
    n = 1
    while f"/PMImg{n}" in xd:
        n += 1
    name = f"/PMImg{n}"
    xd[name] = xo
    # isolate the existing content so an unbalanced graphics state cannot affect the new picture
    pg.contents_add(pdf.make_stream(b"q\n"), prepend=True)
    pg.contents_add(pdf.make_stream(f"Q\nq {dw:.4f} 0 0 {dh:.4f} {ox:.4f} {oy:.4f} cm {name} Do Q\n".encode()))
    return {"bbox": [round(ox, 2), round(oy, 2), round(ox + dw, 2), round(oy + dh, 2)], "pixels": [w, h]}


def new_document(pictures: list[bytes]) -> bytes:
    """A new PDF with one page per picture, each page shaped like its picture (at most A4 size)."""
    from .annotate import _image_xobject

    if not pictures:
        raise EditError("Choose at least one picture")
    pdf = pikepdf.Pdf.new()
    for data in pictures:
        xo, w, h = _image_xobject(pdf, data)
        long_side, short_side = (842.0, 595.0) if w >= h else (595.0, 842.0)
        s = min(short_side / min(w, h), long_side / max(w, h))
        pw, ph = round(w * s, 2), round(h * s, 2)
        pdf.add_blank_page(page_size=(pw, ph))
        pg = pdf.pages[-1]
        pg.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(PMImg1=xo))
        pg.obj.Contents = pdf.make_stream(f"q {pw} 0 0 {ph} 0 0 cm /PMImg1 Do Q\n".encode())
    import io

    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()
