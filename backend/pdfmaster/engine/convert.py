"""Download a document in another format: page images (JPG/PNG), Word, Excel, plain text.

Word and Excel files are written directly as Office Open XML (zip + XML), so no extra
libraries are needed. Text comes from the page model (digital text, or OCR words of a scan);
table cells are found from horizontal gaps and lined up into columns across the page.
"""
from __future__ import annotations

import io
import re
import zipfile
from typing import Callable, Optional
from xml.sax.saxutils import escape

from .render import render_array

FORMATS = ("jpg", "png", "docx", "xlsx", "txt")
MIME = {
    "jpg": "image/jpeg",
    "png": "image/png",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "txt": "text/plain; charset=utf-8",
    "zip": "application/zip",
}
_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _x(s: str) -> str:
    return escape(_CTRL.sub("", s))


# ------------------------------------------------------------------ images
def page_image(data: bytes, index: int, fmt: str, dpi: int, quality: int = 90) -> bytes:
    from PIL import Image

    img = Image.fromarray(render_array(data, index, dpi / 72.0))
    buf = io.BytesIO()
    if fmt == "jpg":
        img.save(buf, "JPEG", quality=quality, optimize=True, dpi=(dpi, dpi))
    else:
        img.save(buf, "PNG", dpi=(dpi, dpi))
    return buf.getvalue()


def images(data: bytes, pages0: list[int], fmt: str, dpi: int, stem: str) -> tuple[bytes, str, str]:
    """One page -> the image itself; several -> a zip of images."""
    if len(pages0) == 1:
        p = pages0[0]
        return page_image(data, p, fmt, dpi), f"{stem}-page{p + 1}.{fmt}", MIME[fmt]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # JPG/PNG are already compressed
        for p in pages0:
            z.writestr(f"{stem}-page{p + 1}.{fmt}", page_image(data, p, fmt, dpi))
    return buf.getvalue(), f"{stem}-{fmt}.zip", MIME["zip"]


# ------------------------------------------------------------- text layout
def _segments(model: dict) -> list[dict]:
    """Runs of text on one line, split where the horizontal gap is wider than a word space."""
    glyphs = model.get("glyphs", [])
    segs = []
    for line in model.get("lines", []):
        cur: Optional[dict] = None
        prev = None
        for ch, gi in zip(line["text"], line["map"]):
            if gi < 0:  # inserted word space
                if cur is not None:
                    cur["text"] += ch
                continue
            g = glyphs[gi]
            b = g["b"]
            size = max(float(g.get("s") or 0), b[3] - b[1], 1.0)
            if prev is not None and cur is not None and b[0] - prev[2] > 1.1 * size:
                segs.append(cur)
                cur = None
            if cur is None:
                cur = {"text": "", "x0": b[0], "x1": b[2], "y0": b[1], "y1": b[3], "size": size}
            cur["text"] += ch
            cur["x0"], cur["x1"] = min(cur["x0"], b[0]), max(cur["x1"], b[2])
            cur["y0"], cur["y1"] = min(cur["y0"], b[1]), max(cur["y1"], b[3])
            prev = b
        if cur is not None:
            segs.append(cur)
    for s in segs:
        s["text"] = re.sub(r"\s+", " ", s["text"]).strip()
    return [s for s in segs if s["text"]]


def rows(model: dict) -> list[list[dict]]:
    """Segments grouped into visual rows (top to bottom), each row left to right."""
    segs = sorted(_segments(model), key=lambda s: -(s["y0"] + s["y1"]) / 2)
    out: list[list[dict]] = []
    for s in segs:
        mid = (s["y0"] + s["y1"]) / 2
        if out:
            r = out[-1]
            top, bot = max(t["y1"] for t in r), min(t["y0"] for t in r)
            h = min(top - bot, s["y1"] - s["y0"])
            if bot - 0.1 * h <= mid <= top + 0.1 * h:
                r.append(s)
                continue
        out.append([s])
    for r in out:
        r.sort(key=lambda s: s["x0"])
    return out


def table(model: dict) -> list[list[str]]:
    """Page text as a grid. Columns are the merged horizontal spans of cells in rows that have
    several cells, so left-, right- and centre-aligned columns all line up."""
    rs = rows(model)
    if not rs:
        return []
    spans = sorted((s["x0"], s["x1"]) for r in rs if len(r) > 1 for s in r)
    cols: list[list[float]] = []
    for a, b in spans:
        if cols and a <= cols[-1][1] + 1.0:
            cols[-1][1] = max(cols[-1][1], b)
        else:
            cols.append([a, b])
    grid = []
    for r in rs:
        cells: list[str] = []
        for s in r:
            # leftmost column the cell reaches
            col = next((k for k, c in enumerate(cols) if c[1] >= s["x0"] - 1.0), max(len(cols) - 1, 0))
            col = max(col, len(cells))  # never put two segments in one cell
            cells += [""] * (col - len(cells))
            cells.append(s["text"])
        grid.append(cells)
    return grid


# ------------------------------------------------------------------- text
def text(models: list[dict]) -> bytes:
    pages = []
    for m in models:
        lines = ["\t".join(s["text"] for s in r) for r in rows(m)]
        pages.append("\n".join(lines))
    return ("\n\f\n".join(pages) + "\n").encode("utf-8")


# ------------------------------------------------------------------ Excel
_NUM = re.compile(r"^-?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d+)?$")


def _number(s: str) -> Optional[str]:
    """'1,234.50' -> '1234.50'; ids, phone numbers and leading zeros stay text."""
    s = re.sub(r"^(?:₹|Rs\.?|INR|\$)\s*", "", s)  # currency prefix: keep the amount summable
    if not _NUM.match(s):
        return None
    plain = s.replace(",", "")
    digits = plain.lstrip("-").split(".")[0]
    if len(digits) > 12 or (len(digits) > 1 and digits[0] == "0"):
        return None
    return plain


def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def xlsx(models: list[dict], page_numbers: list[int]) -> bytes:
    sheets = []
    for m in models:
        grid = table(m)
        width = max((len(r) for r in grid), default=0)
        cols = []
        for c in range(width):
            longest = max((len(r[c]) for r in grid if c < len(r)), default=0)
            cols.append(f'<col min="{c + 1}" max="{c + 1}" width="{min(max(longest * 1.1 + 2, 8), 80):.1f}" customWidth="1"/>')
        body = []
        for i, r in enumerate(grid):
            cells = []
            for c, v in enumerate(r):
                if not v:
                    continue
                ref = f"{_col(c)}{i + 1}"
                num = _number(v)
                if num is not None:
                    cells.append(f'<c r="{ref}"><v>{num}</v></c>')
                else:
                    cells.append(f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{_x(v)}</t></is></c>')
            body.append(f'<row r="{i + 1}">{"".join(cells)}</row>')
        sheets.append(_XML + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                      + (f"<cols>{''.join(cols)}</cols>" if cols else "")
                      + f"<sheetData>{''.join(body)}</sheetData></worksheet>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _XML +
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(len(sheets)))
                   + "</Types>")
        z.writestr("_rels/.rels", _XML +
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml", _XML +
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="Page {p}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, p in enumerate(page_numbers))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels", _XML +
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>'
                             for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   "</Relationships>")
        z.writestr("xl/styles.xml", _XML +
                   '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                   '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
                   '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
                   '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
                   '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
                   '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
                   "</styleSheet>")
        for i, s in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", s)
    return buf.getvalue()


# ------------------------------------------------------------------- Word
def docx(models: list[dict], page_png: Callable[[int], tuple[bytes, int, int]], page_indexes: list[int]) -> bytes:
    """Text pages become paragraphs (cells separated by tabs); pages without text (an un-OCR'd
    scan) are placed as a picture so nothing is lost. A page break separates pages."""
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    paras: list[str] = []
    media: list[bytes] = []
    for k, (m, idx) in enumerate(zip(models, page_indexes)):
        if k:
            paras.append('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        rs = rows(m)
        if rs:
            for r in rs:
                runs = '<w:r><w:tab/></w:r>'.join(f'<w:r><w:t xml:space="preserve">{_x(s["text"])}</w:t></w:r>' for s in r)
                paras.append(f"<w:p>{runs}</w:p>")
            continue
        png, w, h = page_png(idx)
        media.append(png)
        n = len(media)
        cx = 6 * 914400  # 6 inches wide, keep aspect
        cy = int(cx * h / max(w, 1))
        paras.append(
            '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Page %d"/>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
            '<pic:nvPicPr><pic:cNvPr id="%d" name="page%d.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="img%d"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
            "</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
            % (cx, cy, n, idx + 1, n, n, n, cx, cy))
    doc = (_XML + f'<w:document {W} '
           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
           'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
           'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
           'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
           f"<w:body>{''.join(paras) or '<w:p/>'}"
           '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
           "</w:body></w:document>")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", _XML +
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Default Extension="png" ContentType="image/png"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   "</Types>")
        z.writestr("_rels/.rels", _XML +
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
                   "</Relationships>")
        z.writestr("word/_rels/document.xml.rels", _XML +
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="img{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/page{i + 1}.png"/>'
                             for i in range(len(media)))
                   + "</Relationships>")
        z.writestr("word/document.xml", doc)
        for i, png in enumerate(media):
            z.writestr(f"word/media/page{i + 1}.png", png, zipfile.ZIP_STORED)
    return buf.getvalue()
