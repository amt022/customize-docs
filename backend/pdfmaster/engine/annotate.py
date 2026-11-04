"""Standard PDF annotations with explicit appearance streams (so every viewer
draws them identically), plus signature/stamp images and page watermarks."""
from __future__ import annotations

import io
import math
import uuid
from datetime import datetime, timezone
from typing import Optional

import pikepdf

from .editor import EditError

WATERMARK_TAG = "/PMWatermark"


def _now_pdf() -> str:
    return datetime.now(timezone.utc).strftime("D:%Y%m%d%H%M%SZ")


def _rgb(color: str) -> list[float]:
    h = color.lstrip("#")
    if len(h) != 6:
        raise EditError(f"Bad colour {color!r}")
    return [round(int(h[i:i + 2], 16) / 255, 4) for i in (0, 2, 4)]


def _num(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".")


def _appearance(pdf: pikepdf.Pdf, rect: list[float], ops: str, resources: Optional[pikepdf.Dictionary] = None) -> pikepdf.Stream:
    """Form XObject in page coordinates, clipped to the annotation rectangle."""
    ap = pikepdf.Stream(pdf, ops.encode("latin-1"))
    ap.Type, ap.Subtype = pikepdf.Name.XObject, pikepdf.Name.Form
    ap.BBox = [rect[0], rect[1], rect[2], rect[3]]
    ap.Resources = resources if resources is not None else pikepdf.Dictionary()
    return pdf.make_indirect(ap)


def _base(subtype: str, rect: list[float], color: str, author: str, contents: str) -> pikepdf.Dictionary:
    return pikepdf.Dictionary(
        Type=pikepdf.Name.Annot, Subtype=pikepdf.Name("/" + subtype), Rect=[round(v, 3) for v in rect],
        C=_rgb(color), F=4, NM=pikepdf.String(f"pm-{uuid.uuid4().hex[:16]}"),
        T=pikepdf.String(author or "PDF Master"), M=pikepdf.String(_now_pdf()),
        Contents=pikepdf.String(contents or ""),
    )


def _attach(pdf: pikepdf.Pdf, page_index: int, annot: pikepdf.Dictionary) -> str:
    page = pdf.pages[page_index]
    annot.P = page.obj
    ref = pdf.make_indirect(annot)
    if "/Annots" not in page.obj:
        page.obj.Annots = pdf.make_indirect(pikepdf.Array())
    page.obj.Annots.append(ref)
    return str(annot.NM)


def _union(boxes):
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _gstate(opacity: float, multiply: bool = False) -> pikepdf.Dictionary:
    gs = pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, CA=opacity, ca=opacity)
    if multiply:
        gs.BM = pikepdf.Name.Multiply
    return pikepdf.Dictionary(ExtGState=pikepdf.Dictionary(GS0=gs))


# ----------------------------------------------------------------- text markup
def add_markup(pdf, page: int, kind: str, boxes: list[list[float]], color: str, opacity: float = 1.0,
               author: str = "", contents: str = "") -> str:
    """kind: Highlight | Underline | StrikeOut | Squiggly. boxes: one per line, PDF space."""
    if not boxes:
        raise EditError("Select some text first")
    if kind not in ("Highlight", "Underline", "StrikeOut", "Squiggly"):
        raise EditError(f"Unknown markup {kind}")
    rect = _union(boxes)
    pad = 1.0
    rect = [rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad]
    quads = []
    r, g, b = _rgb(color)
    ops = [f"/GS0 gs {r} {g} {b} rg {r} {g} {b} RG"]
    for x0, y0, x1, y1 in boxes:
        quads += [x0, y1, x1, y1, x0, y0, x1, y0]
        h = y1 - y0
        if kind == "Highlight":
            ops.append(f"{_num(x0)} {_num(y0)} {_num(x1 - x0)} {_num(h)} re f")
        elif kind == "Underline":
            w = max(h * 0.07, 0.5)
            ops.append(f"{_num(w)} w {_num(x0)} {_num(y0 + h * 0.12)} m {_num(x1)} {_num(y0 + h * 0.12)} l S")
        elif kind == "StrikeOut":
            w = max(h * 0.07, 0.5)
            ops.append(f"{_num(w)} w {_num(x0)} {_num(y0 + h * 0.45)} m {_num(x1)} {_num(y0 + h * 0.45)} l S")
        else:
            step = max(h * 0.12, 1.2)
            y, x, up, path = y0 + h * 0.06, x0, True, [f"{_num(max(h * 0.05, 0.4))} w {_num(x0)} {_num(y0 + h * 0.06)} m"]
            while x < x1:
                x = min(x + step, x1)
                path.append(f"{_num(x)} {_num(y + (step * 0.6 if up else 0))} l")
                up = not up
            ops.append(" ".join(path) + " S")
    a = _base(kind, rect, color, author, contents)
    a.QuadPoints = [round(v, 3) for v in quads]
    a.CA = opacity
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, rect, "\n".join(ops), _gstate(opacity, kind == "Highlight")))
    return _attach(pdf, page, a)


# --------------------------------------------------------------------- notes
def add_note(pdf, page: int, x: float, y: float, text: str, color: str = "#f5c400", author: str = "") -> str:
    rect = [x, y - 20, x + 20, y]
    r, g, b = _rgb(color)
    ops = (f"{r} {g} {b} rg 0.35 0.3 0.1 RG 0.8 w {_num(x + 1)} {_num(y - 19)} 18 18 re B "
           f"0.3 0.25 0.05 RG 1 w {_num(x + 5)} {_num(y - 7)} m {_num(x + 15)} {_num(y - 7)} l "
           f"{_num(x + 5)} {_num(y - 11)} m {_num(x + 15)} {_num(y - 11)} l {_num(x + 5)} {_num(y - 15)} m {_num(x + 12)} {_num(y - 15)} l S")
    a = _base("Text", rect, color, author, text)
    a.Name = pikepdf.Name.Comment
    a.Open = False
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, rect, ops))
    return _attach(pdf, page, a)


# -------------------------------------------------------------------- shapes
def add_shape(pdf, page: int, kind: str, rect: list[float], color: str, width: float = 1.5,
              fill: Optional[str] = None, opacity: float = 1.0, author: str = "", contents: str = "") -> str:
    x0, y0, x1, y1 = min(rect[0], rect[2]), min(rect[1], rect[3]), max(rect[0], rect[2]), max(rect[1], rect[3])
    if x1 - x0 < 2 or y1 - y0 < 2:
        raise EditError("Shape is too small")
    r, g, b = _rgb(color)
    ops = [f"/GS0 gs {r} {g} {b} RG {_num(width)} w"]
    paint = "S"
    if fill:
        fr, fg, fb = _rgb(fill)
        ops.append(f"{fr} {fg} {fb} rg")
        paint = "B"
    hw = width / 2
    if kind == "Square":
        ops.append(f"{_num(x0 + hw)} {_num(y0 + hw)} {_num(x1 - x0 - width)} {_num(y1 - y0 - width)} re {paint}")
    elif kind == "Circle":
        cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 - hw, (y1 - y0) / 2 - hw
        k = 0.5523
        ops.append(
            f"{_num(cx + rx)} {_num(cy)} m "
            f"{_num(cx + rx)} {_num(cy + k * ry)} {_num(cx + k * rx)} {_num(cy + ry)} {_num(cx)} {_num(cy + ry)} c "
            f"{_num(cx - k * rx)} {_num(cy + ry)} {_num(cx - rx)} {_num(cy + k * ry)} {_num(cx - rx)} {_num(cy)} c "
            f"{_num(cx - rx)} {_num(cy - k * ry)} {_num(cx - k * rx)} {_num(cy - ry)} {_num(cx)} {_num(cy - ry)} c "
            f"{_num(cx + k * rx)} {_num(cy - ry)} {_num(cx + rx)} {_num(cy - k * ry)} {_num(cx + rx)} {_num(cy)} c {paint}")
    else:
        raise EditError(f"Unknown shape {kind}")
    a = _base(kind, [x0, y0, x1, y1], color, author, contents)
    a.BS = pikepdf.Dictionary(W=width, S=pikepdf.Name.S)
    a.CA = opacity
    if fill:
        a.IC = _rgb(fill)
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, [x0, y0, x1, y1], "\n".join(ops), _gstate(opacity)))
    return _attach(pdf, page, a)


def add_ink(pdf, page: int, paths: list[list[list[float]]], color: str, width: float = 2.0,
            opacity: float = 1.0, author: str = "") -> str:
    pts = [p for path in paths for p in path]
    if len(pts) < 2:
        raise EditError("Draw a longer stroke")
    hw = width / 2 + 1
    rect = [min(p[0] for p in pts) - hw, min(p[1] for p in pts) - hw, max(p[0] for p in pts) + hw, max(p[1] for p in pts) + hw]
    r, g, b = _rgb(color)
    ops = [f"/GS0 gs {r} {g} {b} RG {_num(width)} w 1 J 1 j"]
    for path in paths:
        if len(path) < 2:
            continue
        ops.append(f"{_num(path[0][0])} {_num(path[0][1])} m " + " ".join(f"{_num(x)} {_num(y)} l" for x, y in path[1:]) + " S")
    a = _base("Ink", rect, color, author, "")
    a.InkList = [[round(v, 2) for p in path for v in p] for path in paths]
    a.BS = pikepdf.Dictionary(W=width, S=pikepdf.Name.S)
    a.CA = opacity
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, rect, "\n".join(ops), _gstate(opacity)))
    return _attach(pdf, page, a)


# ------------------------------------------------------- signatures & stamps
def _image_xobject(pdf, png: bytes) -> tuple[pikepdf.Stream, int, int]:
    """PDF image from PNG/JPEG/GIF/WebP bytes. JPEG photos are stored as they are (no quality loss,
    small file); everything else is stored losslessly, with an alpha channel as a soft mask."""
    import zlib

    from PIL import Image, ImageOps

    try:
        im = Image.open(io.BytesIO(png))
        im.load()
    except Exception as exc:
        raise EditError(f"Not a usable image: {exc}") from exc
    if im.width * im.height > 6000 * 6000:
        raise EditError("Image is too large")
    if im.format == "JPEG" and im.mode in ("RGB", "L"):
        oriented = ImageOps.exif_transpose(im)
        data = png
        if oriented.size != im.size or oriented.getexif().get(0x0112) != im.getexif().get(0x0112):
            buf = io.BytesIO()
            oriented.save(buf, "JPEG", quality=92)  # EXIF rotation baked in; viewers ignore EXIF
            data, im = buf.getvalue(), oriented
        x = pikepdf.Stream(pdf, data)
        x.Type, x.Subtype, x.Width, x.Height = pikepdf.Name.XObject, pikepdf.Name.Image, im.width, im.height
        x.ColorSpace = pikepdf.Name.DeviceRGB if im.mode == "RGB" else pikepdf.Name.DeviceGray
        x.BitsPerComponent, x.Filter = 8, pikepdf.Name.DCTDecode
        return pdf.make_indirect(x), im.width, im.height
    im = ImageOps.exif_transpose(im).convert("RGBA")
    rgb = im.convert("RGB")
    alpha = im.getchannel("A")
    x = pikepdf.Stream(pdf, zlib.compress(rgb.tobytes(), 9))
    x.Type, x.Subtype, x.Width, x.Height = pikepdf.Name.XObject, pikepdf.Name.Image, im.width, im.height
    x.ColorSpace, x.BitsPerComponent, x.Filter = pikepdf.Name.DeviceRGB, 8, pikepdf.Name.FlateDecode
    if alpha.getextrema() != (255, 255):
        sm = pikepdf.Stream(pdf, zlib.compress(alpha.tobytes(), 9))
        sm.Type, sm.Subtype, sm.Width, sm.Height = pikepdf.Name.XObject, pikepdf.Name.Image, im.width, im.height
        sm.ColorSpace, sm.BitsPerComponent, sm.Filter = pikepdf.Name.DeviceGray, 8, pikepdf.Name.FlateDecode
        x.SMask = pdf.make_indirect(sm)
    return pdf.make_indirect(x), im.width, im.height


def add_image_stamp(pdf, page: int, rect: list[float], png: bytes, kind: str = "signature", author: str = "") -> str:
    """Signature or image stamp, fitted into rect keeping its aspect ratio."""
    x0, y0, x1, y1 = min(rect[0], rect[2]), min(rect[1], rect[3]), max(rect[0], rect[2]), max(rect[1], rect[3])
    img, w, h = _image_xobject(pdf, png)
    bw, bh = x1 - x0, y1 - y0
    s = min(bw / w, bh / h)
    dw, dh = w * s, h * s
    ox, oy = x0 + (bw - dw) / 2, y0 + (bh - dh) / 2
    ops = f"q {_num(dw)} 0 0 {_num(dh)} {_num(ox)} {_num(oy)} cm /Img Do Q"
    a = _base("Stamp", [x0, y0, x1, y1], "#000000", author, "Signature" if kind == "signature" else "Image stamp")
    a.Name = pikepdf.Name("/PMSignature" if kind == "signature" else "/PMImage")
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, [x0, y0, x1, y1], ops, pikepdf.Dictionary(XObject=pikepdf.Dictionary(Img=img))))
    return _attach(pdf, page, a)


def _text_run(pdf, text: str, size: float, bold: bool = True):
    """(font dict, TJ bytes, width) for text in an embedded, shaped installed font."""
    from .sysfonts import EmbeddedSubstitute, coverage_fonts, has_glyph, match_font

    f, _ = match_font("Arial", bold, False, False, False)
    if f is None or not all(has_glyph(f, c) for c in text if not c.isspace()):
        f = next((c for c in coverage_fonts(bold, False) if all(has_glyph(c, ch) for ch in text if not ch.isspace())), f)
    if f is None:
        raise EditError("No installed font available for the stamp text")
    sub = EmbeddedSubstitute(f)
    glyphs = sub.shape(text)
    sub.use(glyphs)
    font = sub.build(pdf)
    arr = []
    for g in glyphs:
        if abs(g.x_offset) > 0.5:
            arr.append(-g.x_offset)
        arr.append(pikepdf.String(sub.code(g.gid)))
        corr = g.advance - g.x_offset - g.width
        if abs(corr) > 0.5:
            arr.append(-corr)
    width = sum(g.advance for g in glyphs) / 1000 * size
    tj = pikepdf.unparse_content_stream([([pikepdf.Array(arr)], pikepdf.Operator("TJ"))]).decode("latin-1")
    return font, tj, width


def add_text_stamp(pdf, page: int, rect: list[float], text: str, color: str = "#c0362c", author: str = "") -> str:
    x0, y0, x1, y1 = min(rect[0], rect[2]), min(rect[1], rect[3]), max(rect[0], rect[2]), max(rect[1], rect[3])
    if not text.strip():
        raise EditError("Stamp text is empty")
    bw, bh = x1 - x0, y1 - y0
    size = bh * 0.55
    font, tj, width = _text_run(pdf, text.upper(), size)
    if width > bw * 0.88:
        size *= bw * 0.88 / width
        font, tj, width = _text_run(pdf, text.upper(), size)
    r, g, b = _rgb(color)
    bwid = max(bh * 0.06, 1)
    tx, ty = x0 + (bw - width) / 2, y0 + (bh - size * 0.72) / 2
    ops = (f"/GS0 gs {r} {g} {b} RG {r} {g} {b} rg {_num(bwid)} w "
           f"{_num(x0 + bwid)} {_num(y0 + bwid)} {_num(bw - 2 * bwid)} {_num(bh - 2 * bwid)} re S "
           f"BT /F1 {_num(size)} Tf {_num(tx)} {_num(ty)} Td {tj} ET")
    res = _gstate(0.9)
    res.Font = pikepdf.Dictionary(F1=font)
    a = _base("Stamp", [x0, y0, x1, y1], color, author, text)
    a.Name = pikepdf.Name("/" + ("".join(c for c in text.title() if c.isascii() and c.isalnum())[:30] or "Draft"))
    a.AP = pikepdf.Dictionary(N=_appearance(pdf, [x0, y0, x1, y1], ops, res))
    return _attach(pdf, page, a)


# ----------------------------------------------------------------- watermark
def add_watermark(pdf, pages: list[int], text: str, color: str = "#888888", opacity: float = 0.18,
                  angle: float = 45.0, size: Optional[float] = None) -> None:
    """Diagonal text drawn behind nothing and above the page content, tagged so it can be removed."""
    if not text.strip():
        raise EditError("Watermark text is empty")
    r, g, b = _rgb(color)
    for p in pages:
        page = pdf.pages[p]
        x0, y0, x1, y1 = (float(v) for v in (page.obj.get("/CropBox") or page.mediabox))
        w, h = x1 - x0, y1 - y0
        fs = size or min(w, h) / max(len(text), 4) * 1.6
        font, tj, width = _text_run(pdf, text, fs)
        rad = math.radians(angle)
        c, s = math.cos(rad), math.sin(rad)
        cx, cy = x0 + w / 2, y0 + h / 2
        # start so that the text's centre lands on the page centre
        sx = cx - (width / 2) * c + (fs * 0.35) * s
        sy = cy - (width / 2) * s - (fs * 0.35) * c
        res = page.obj.get("/Resources")
        if res is None:
            page.obj.Resources = res = pikepdf.Dictionary()
        for key in ("/Font", "/ExtGState"):
            if key not in res:
                res[key] = pikepdf.Dictionary()
        n = 1
        while f"/PMW{n}" in res.Font or f"/PMWG{n}" in res.ExtGState:
            n += 1
        res.Font[f"/PMW{n}"] = font
        res.ExtGState[f"/PMWG{n}"] = pikepdf.Dictionary(Type=pikepdf.Name.ExtGState, ca=opacity, CA=opacity)
        ops = (f"{WATERMARK_TAG} BMC q /PMWG{n} gs {r} {g} {b} rg BT /PMW{n} {_num(fs)} Tf "
               f"{_num(c)} {_num(s)} {_num(-s)} {_num(c)} {_num(sx)} {_num(sy)} Tm {tj} ET Q EMC")
        old = pikepdf.unparse_content_stream(pikepdf.parse_content_stream(page))
        page.obj.Contents = pdf.make_stream(b"q\n" + old + b"\nQ\n" + ops.encode("latin-1"))


def remove_watermarks(pdf, pages: list[int]) -> int:
    removed = 0
    for p in pages:
        page = pdf.pages[p]
        out, depth = [], 0
        for ins in pikepdf.parse_content_stream(page):
            op = str(ins.operator)
            if depth == 0 and op == "BMC" and ins.operands and str(ins.operands[0]) == WATERMARK_TAG:
                depth, removed = 1, removed + 1
                continue
            if depth:
                depth += 1 if op in ("BMC", "BDC") else -1 if op == "EMC" else 0
                continue
            out.append(ins)
        page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return removed


# --------------------------------------------------------------- list/delete
def list_annotations(pdf, page: int) -> list[dict]:
    out = []
    for a in pdf.pages[page].obj.get("/Annots", []):
        sub = str(a.get("/Subtype", ""))[1:]
        if sub in ("Popup", "Link", "Widget"):
            continue
        out.append({
            "id": str(a.get("/NM", "")) or None,
            "type": sub,
            "rect": [round(float(v), 2) for v in a.get("/Rect", [0, 0, 0, 0])],
            "contents": str(a.get("/Contents", "")),
            "author": str(a.get("/T", "")),
            "color": "#%02x%02x%02x" % tuple(int(float(v) * 255) for v in list(a.get("/C", [0, 0, 0]))[:3]) if len(a.get("/C", [])) >= 3 else None,
            "ours": str(a.get("/NM", "")).startswith("pm-"),
        })
    return out


def delete_annotation(pdf, page: int, nm: str) -> None:
    annots = pdf.pages[page].obj.get("/Annots")
    if annots is None:
        raise EditError("No annotations on this page")
    for i, a in enumerate(list(annots)):
        if str(a.get("/NM", "")) == nm:
            popup = a.get("/Popup")
            del annots[i]
            if popup is not None:
                for j, b in enumerate(list(annots)):
                    if b.objgen == popup.objgen:
                        del annots[j]
                        break
            return
    raise EditError("Annotation not found")
