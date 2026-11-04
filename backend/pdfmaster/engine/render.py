"""Page rendering with PDFium (pypdfium2, Apache-2.0/BSD) and PDF<->pixel mapping."""
from __future__ import annotations

import io
import threading

import numpy as np
import pypdfium2 as pdfium

# PDFium is not thread-safe; serialise all calls into it.
_LOCK = threading.RLock()


def open_doc(data: bytes, password: str | None = None) -> pdfium.PdfDocument:
    return pdfium.PdfDocument(data, password=password)


def page_count(data: bytes) -> int:
    with _LOCK:
        return len(open_doc(data))


def render_array(data: bytes, index: int, zoom: float) -> np.ndarray:
    """RGB uint8 array of the page as displayed (page /Rotate applied)."""
    with _LOCK:
        doc = open_doc(data)
        page = doc[index]
        img = page.render(scale=zoom, draw_annots=True, may_draw_forms=True).to_pil().convert("RGB")
        return np.asarray(img).copy()


def render_png(data: bytes, index: int, zoom: float = 1.5) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(render_array(data, index, zoom)).save(buf, "PNG", optimize=False)
    return buf.getvalue()


def array_to_png(arr: np.ndarray) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(arr).save(buf, "PNG")
    return buf.getvalue()


class PageGeometry:
    """Maps PDF user space to pixels of a page rendered at `zoom` (and back)."""

    def __init__(self, cropbox: tuple[float, float, float, float], rotation: int, zoom: float):
        self.x0, self.y0, self.x1, self.y1 = cropbox
        self.rot = rotation % 360
        self.z = zoom
        self.w = (self.x1 - self.x0) * zoom
        self.h = (self.y1 - self.y0) * zoom

    def to_px(self, x: float, y: float) -> tuple[float, float]:
        u, v = (x - self.x0) * self.z, (self.y1 - y) * self.z
        if self.rot == 90:
            return self.h - v, u
        if self.rot == 180:
            return self.w - u, self.h - v
        if self.rot == 270:
            return v, self.w - u
        return u, v

    def rect_to_px(self, r) -> tuple[float, float, float, float]:
        pts = [self.to_px(r[0], r[1]), self.to_px(r[2], r[3])]
        return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))

    def to_pdf(self, px: float, py: float) -> tuple[float, float]:
        if self.rot == 90:
            v, u = self.h - px, py
        elif self.rot == 180:
            u, v = self.w - px, self.h - py
        elif self.rot == 270:
            v, u = px, self.w - py
        else:
            u, v = px, py
        return u / self.z + self.x0, self.y1 - v / self.z


def geometry_for(pdf_page, zoom: float) -> PageGeometry:
    """pdf_page: a pikepdf.Page."""
    box = pdf_page.obj.get("/CropBox") or pdf_page.mediabox
    x0, y0, x1, y1 = (float(v) for v in box)
    return PageGeometry((min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)), int(pdf_page.obj.get("/Rotate", 0)), zoom)


def page_text(data: bytes, index: int) -> str:
    with _LOCK:
        doc = open_doc(data)
        return doc[index].get_textpage().get_text_range()
