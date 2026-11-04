"""Page-level operations. Pages are 0-based here; the API converts from 1-based."""
from __future__ import annotations

import io

import pikepdf

from .editor import EditError


def _open(data: bytes) -> pikepdf.Pdf:
    return pikepdf.open(io.BytesIO(data))


def _save(pdf: pikepdf.Pdf) -> bytes:
    buf = io.BytesIO()
    pdf.save(buf, compress_streams=True)
    return buf.getvalue()


def _check(pdf: pikepdf.Pdf, pages: list[int]) -> None:
    n = len(pdf.pages)
    if not pages:
        raise EditError("No pages given")
    bad = [p + 1 for p in pages if not 0 <= p < n]
    if bad:
        raise EditError(f"Page(s) {bad} do not exist (document has {n})")


def rotate(data: bytes, pages: list[int], degrees: int) -> bytes:
    if degrees % 90:
        raise EditError("Rotation must be a multiple of 90°")
    pdf = _open(data)
    _check(pdf, pages)
    for p in set(pages):
        page = pdf.pages[p]
        page.obj.Rotate = (int(page.obj.get("/Rotate", 0)) + degrees) % 360
    return _save(pdf)


def delete(data: bytes, pages: list[int]) -> bytes:
    pdf = _open(data)
    _check(pdf, pages)
    if len(set(pages)) >= len(pdf.pages):
        raise EditError("A document must keep at least one page")
    for p in sorted(set(pages), reverse=True):
        del pdf.pages[p]
    return _save(pdf)


def reorder(data: bytes, order: list[int]) -> bytes:
    pdf = _open(data)
    n = len(pdf.pages)
    if sorted(order) != list(range(n)):
        raise EditError("New order must list every page exactly once")
    # append in the new order, then drop the originals; document-level objects survive
    for i in order:
        pdf.pages.append(pdf.pages[i])
    for _ in range(n):
        del pdf.pages[0]
    return _save(pdf)


def insert_blank(data: bytes, after: int) -> bytes:
    """Insert a blank page after page `after` (-1 = at the start), sized like its neighbour."""
    pdf = _open(data)
    ref = pdf.pages[max(0, min(after, len(pdf.pages) - 1))]
    box = [float(v) for v in ref.mediabox]
    blank = pikepdf.Page(pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=box, Resources=pikepdf.Dictionary(),
                                            Contents=pdf.make_stream(b"")))
    if "/Rotate" in ref.obj:
        blank.obj.Rotate = ref.obj.Rotate
    pdf.pages.insert(after + 1, blank)
    return _save(pdf)


def merge(data: bytes, other: bytes, after: int | None = None) -> bytes:
    """Insert all pages of `other` after page `after` (None = at the end)."""
    pdf = _open(data)
    src = _open(other)
    at = len(pdf.pages) if after is None else max(0, min(after + 1, len(pdf.pages)))
    for i, page in enumerate(src.pages):
        pdf.pages.insert(at + i, page)
    return _save(pdf)


def extract(data: bytes, pages: list[int]) -> bytes:
    pdf = _open(data)
    _check(pdf, pages)
    out = pikepdf.new()
    for p in pages:
        out.pages.append(pdf.pages[p])
    return _save(out)


def split(data: bytes, ranges: list[tuple[int, int]]) -> list[bytes]:
    """ranges are inclusive 0-based (start, end) pairs."""
    return [extract(data, list(range(a, b + 1))) for a, b in ranges]


def parse_ranges(spec: str, n: int) -> list[int]:
    """'1-3, 5, 8-' (1-based) -> [0, 1, 2, 4, 7, ... n-1]"""
    out: list[int] = []
    for part in spec.replace(" ", "").split(","):
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start = int(a) if a else 1
            end = int(b) if b else n
        else:
            start = end = int(part)
        if start < 1 or end > n or start > end:
            raise EditError(f"Invalid page range '{part}' (document has {n} pages)")
        out += list(range(start - 1, end))
    if not out:
        raise EditError("No pages selected")
    return out
