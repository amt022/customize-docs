"""Document check ("preflight"): finds problems in a PDF and in what editing did to it.

Every finding is a dict:
    {"id", "category", "severity", "page", "title", "detail", "boxes", "fix"}
category: text | layout | scan | structure | editing
severity: error (broken / will look wrong) | warning (likely problem) | info (worth knowing)
page: 1-based, or None for document-wide findings; boxes are PDF-space rectangles on that page.
"""
from __future__ import annotations

import io
import math
import re
import unicodedata
from collections import Counter, defaultdict
from typing import Optional

import numpy as np
import pikepdf
from PIL import Image

from .fonts import FontCache
from .interpreter import Glyph, PageModel

MAX_PAGES = 200  # per-page checks stop here on very long documents
MAX_BOXES = 30
STANDARD_FONTS = {
    "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique", "Helvetica", "Helvetica-Bold",
    "Helvetica-Oblique", "Helvetica-BoldOblique", "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic",
    "Symbol", "ZapfDingbats", "Arial", "Arial,Bold", "Arial,Italic", "Arial,BoldItalic", "TimesNewRoman",
    "TimesNewRoman,Bold", "CourierNew",
}
KNOWN_FILTERS = {"/FlateDecode", "/LZWDecode", "/ASCIIHexDecode", "/ASCII85Decode", "/RunLengthDecode",
                 "/DCTDecode", "/CCITTFaxDecode", "/JBIG2Decode", "/JPXDecode", "/Crypt"}


class Findings:
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, category: str, severity: str, title: str, detail: str = "", page: Optional[int] = None,
            boxes: Optional[list] = None, fix: str = "") -> None:
        self.items.append({
            "id": f"{category}-{len(self.items) + 1}", "category": category, "severity": severity, "page": page,
            "title": title, "detail": detail, "fix": fix,
            "boxes": [[round(float(v), 2) for v in b] for b in (boxes or [])[:MAX_BOXES]],
        })


def _area(b) -> float:
    return max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])


def _inter(a, b) -> float:
    return _area((max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])))


def _union(boxes) -> list[float]:
    return [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)]


def _bad_char(ch: str) -> bool:
    if not ch:
        return False  # part of an ActualText span: the span carries the text
    if ch == "�":
        return True
    cat = unicodedata.category(ch[0])
    return cat in ("Co", "Cn") or (cat == "Cc" and ch not in "\t\n\r")


def _family(name: str) -> str:
    name = re.sub(r"^[A-Z]{6}\+", "", name)
    return re.split(r"[-,]", name)[0].replace("MT", "").replace("PS", "").lower()


# ===================================================================== entry
def check_document(data: bytes, original: Optional[bytes] = None, ocr: Optional[dict[int, dict]] = None,
                   history: Optional[list[dict]] = None, was_encrypted: bool = False) -> dict:
    """Run every check. `original` is version 0 (for editing checks), `ocr` maps 1-based page
    numbers to stored OCR results, `history` is the list of applied edit reports."""
    f = Findings()
    try:
        pdf = pikepdf.open(io.BytesIO(data))
    except Exception as exc:  # unreadable: nothing else can run
        f.add("structure", "error", "The PDF cannot be opened", str(exc))
        return _result(f, 0)
    n_pages = len(pdf.pages)
    _check_structure(pdf, original or data, f, was_encrypted)
    fonts = FontCache()
    models: dict[int, PageModel] = {}
    for i in range(min(n_pages, MAX_PAGES)):
        try:
            model = PageModel(pdf, i, fonts)
        except Exception as exc:
            f.add("structure", "error", "Page content is damaged and cannot be read", str(exc), page=i + 1,
                  fix="Re-export the PDF from its source application")
            continue
        models[i] = model
        _check_page_text(model, f)
        _check_page_layout(model, f)
        if model.page_type() == "scanned":
            _check_scan(model, f, (ocr or {}).get(i + 1))
    if n_pages > MAX_PAGES:
        f.add("structure", "info", f"Only the first {MAX_PAGES} pages were checked", f"The document has {n_pages} pages")
    _check_fonts(fonts, f)
    _check_document_layout(pdf, models, f)
    if original is not None and original != data:
        _check_editing(original, data, pdf, models, f, history or [])
    return _result(f, n_pages)


def _result(f: Findings, n_pages: int) -> dict:
    order = {"error": 0, "warning": 1, "info": 2}
    f.items.sort(key=lambda x: (order[x["severity"]], x["page"] or 0))
    counts = Counter(x["severity"] for x in f.items)
    return {"pages": n_pages, "issues": f.items,
            "summary": {"error": counts.get("error", 0), "warning": counts.get("warning", 0), "info": counts.get("info", 0)}}


# ============================================================ A. text & fonts
def _check_fonts(fonts: FontCache, f: Findings) -> None:
    for font in fonts.all():
        if not font.used_codes:
            continue
        name = font.clean_name
        if font.type3:
            f.add("text", "info", f"Font '{name}' is a Type3 (drawn) font",
                  "Text in Type3 fonts can be viewed and annotated but not edited as text")
        elif not font.embedded:
            if font.base_font in STANDARD_FONTS or font.base14:
                f.add("text", "info", f"Standard font '{name}' is not embedded",
                      "Viewers use their own copy; spacing can differ slightly between viewers")
            else:
                f.add("text", "warning", f"Font '{name}' is not embedded",
                      "Viewers without this font installed substitute another one, which changes the look and spacing",
                      fix="Re-export the PDF with 'embed all fonts' enabled")


def _check_page_text(model: PageModel, f: Findings) -> None:
    page = model.page_index + 1
    visible = [g for g in model.glyphs if g.tr not in (3, 7) and g.ch.strip()]
    # garbled / uncopyable text, per font
    per_font: dict[str, list[Glyph]] = defaultdict(list)
    for g in model.glyphs:
        if g.tr in (3, 7) or g.ch.isspace():
            continue
        per_font[g.font.clean_name].append(g)
    for name, gl in per_font.items():
        bad = [g for g in gl if _bad_char(g.ch)]
        if len(bad) >= 3 and len(bad) / len(gl) > 0.05:
            f.add("text", "warning", f"Text in font '{name}' cannot be copied or searched correctly",
                  f"{len(bad)} of {len(gl)} characters have no Unicode meaning (missing or broken ToUnicode map); "
                  "copied text comes out garbled", page=page, boxes=[g.bbox for g in bad],
                  fix="Run OCR on the page, or re-export the PDF from its source")

    # duplicate text (the same glyph drawn twice on top of itself: fake bold, double export)
    seen: dict[tuple, Glyph] = {}
    dups = []
    for g in visible:
        k = (g.ch, round(g.origin[0] * 2), round(g.origin[1] * 2), round(g.eff_size))
        if k in seen:
            dups.append(g)
        else:
            seen[k] = g
    if len(dups) >= 3:
        f.add("text", "warning", "Text is drawn twice on top of itself",
              f"{len(dups)} characters are duplicated at the same position. Copying gives doubled text "
              "and edits only change one copy", page=page, boxes=[g.bbox for g in dups])

    # within words: font family / weight changes (substituted glyphs, unexpected bold)
    mixed, weight = [], []
    lines = model.lines()
    for line in lines:
        gl = [model.glyphs[i] for i in line["glyphs"]]
        for a, b in zip(gl, gl[1:]):
            if a.ch.isspace() or b.ch.isspace() or not a.ch or not b.ch or a.tr in (3, 7):
                continue
            if not (a.ch.isalnum() and b.ch.isalnum()):
                continue
            if _family(a.font.base_font) != _family(b.font.base_font):
                mixed.append((a, b))
            elif a.font.bold != b.font.bold or abs(a.eff_size - b.eff_size) > 0.15 * max(a.eff_size, b.eff_size):
                weight.append((a, b))
    if mixed:
        names = sorted({f"{_family(a.font.base_font)} / {_family(b.font.base_font)}" for a, b in mixed})
        f.add("text", "warning", "Words mix different fonts",
              f"{len(mixed)} places where a font change happens in the middle of a word ({', '.join(names[:3])}). "
              "This usually means a missing character was drawn with a substitute font",
              page=page, boxes=[_union([a.bbox, b.bbox]) for a, b in mixed],
              fix="Check that the substituted letters look right; install the original font for an exact match")
    if weight:
        f.add("text", "info", "Size or weight changes inside words",
              f"{len(weight)} places where letters of one word differ in size or boldness", page=page,
              boxes=[_union([a.bbox, b.bbox]) for a, b in weight])

    # spacing: letters overlapping each other, and visible gaps without a space character
    tight, joined = [], []
    for line in lines:
        gl = [model.glyphs[i] for i in line["glyphs"] if model.glyphs[i].tr not in (3, 7)]
        for a, b in zip(gl, gl[1:]):
            if not a.ch or not b.ch or a.group >= 0 or b.group >= 0:
                continue
            if unicodedata.category(b.ch[0]).startswith("M") or unicodedata.category(a.ch[0]).startswith("M"):
                continue
            d = a.direction
            gap = (b.origin[0] - a.end[0]) * d[0] + (b.origin[1] - a.end[1]) * d[1]
            size = max(a.eff_size, 1.0)
            wa = (a.end[0] - a.origin[0]) * d[0] + (a.end[1] - a.origin[1]) * d[1]
            if not a.ch.isspace() and not b.ch.isspace() and wa > 0 and gap < -0.35 * wa and gap > -2 * size:
                tight.append(_union([a.bbox, b.bbox]))
            if a.ch.strip() and b.ch.strip() and 0.25 * size < gap < 1.5 * size:
                joined.append(_union([a.bbox, b.bbox]))
    if len(tight) >= 2:
        f.add("text", "warning", "Letters overlap each other",
              f"{len(tight)} places where character spacing makes letters run into each other",
              page=page, boxes=tight)
    spaces = sum(1 for g in model.glyphs if g.ch == " ")
    if len(joined) >= 10 and spaces < len(joined):  # pages that separate words by position only
        f.add("text", "info", "Words look separated but have no space character",
              f"{len(joined)} gaps on the page have no space in the text, so copied or searched text joins words together",
              page=page, boxes=joined)

    # reading order: lines drawn bottom-to-top within a column read back out of order
    if len(lines) >= 6:
        inv = 0
        for p, q in zip(lines, lines[1:]):
            pb, qb = p["bbox"], q["bbox"]
            h = max(pb[3] - pb[1], 1.0)
            if qb[1] > pb[3] + 0.5 * h and min(pb[2], qb[2]) > max(pb[0], qb[0]):
                inv += 1
        if inv / (len(lines) - 1) > 0.3:
            f.add("text", "info", "Text is stored in an unusual reading order",
                  f"{inv} of {len(lines)} lines come before the line above them; copied text and screen readers "
                  "may read the page out of order", page=page)

    tiny = [g for g in visible if g.eff_size < 3]
    if len(tiny) >= 5:
        f.add("text", "info", "Very small text", f"{len(tiny)} characters are smaller than 3 pt", page=page,
              boxes=[g.bbox for g in tiny])
    hidden = [g for g in model.glyphs if g.tr in (3, 7) and g.ch.strip()]
    if hidden and model.page_type() == "digital":
        f.add("text", "info", "Page contains invisible text",
              f"{len(hidden)} invisible characters (searchable but not shown); check it matches what is visible",
              page=page, boxes=[_union([g.bbox for g in hidden])])


# =================================================================== B. layout
def _check_page_layout(model: PageModel, f: Findings) -> None:
    page = model.page_index + 1
    x0, y0, x1, y1 = model.mediabox
    visible = [g for g in model.glyphs if g.tr not in (3, 7) and g.ch.strip()]
    outside, partial, clipped = [], [], []
    page_box = (x0, y0, x1, y1)
    for line in model.lines():
        gl = [model.glyphs[i] for i in line["glyphs"]]
        gl = [g for g in gl if g.tr not in (3, 7) and g.ch.strip()]
        if not gl:
            continue
        frac = [_inter(g.bbox, page_box) / (_area(g.bbox) or 1e-6) for g in gl]
        out = [g.bbox for g, fr in zip(gl, frac) if fr < 0.9]
        if out and len(out) == len(gl):
            outside += out  # the whole line is off the page
        elif out:
            partial += out  # the line starts on the page and runs over its edge
        for g, fr in zip(gl, frac):
            if fr >= 0.9 and g.clip is not None and _inter(g.bbox, g.clip) / (_area(g.bbox) or 1e-6) < 0.6:
                clipped.append(g.bbox)
    if outside:
        f.add("layout", "warning", "Text outside the page",
              f"{len(outside)} characters are placed outside the visible page area and will not be seen or printed",
              page=page, boxes=[[max(b[0], x0), max(b[1], y0), min(b[2], x1), min(b[3], y1)] for b in outside])
    if partial:
        f.add("layout", "error", "Text cut off at the page edge",
              f"{len(partial)} characters run over the edge of the page", page=page, boxes=partial,
              fix="Shorten the text or use 'Squeeze to fit'")
    if clipped:
        f.add("layout", "error", "Text clipped by its container",
              f"{len(clipped)} characters fall outside the clipping area of their text box and are hidden",
              page=page, boxes=clipped, fix="Shorten the text or use 'Squeeze to fit'")

    # overlapping text: characters of different lines on top of each other
    line_of = {}
    for li, line in enumerate(model.lines()):
        for i in line["glyphs"]:
            line_of[i] = li
    grid: dict[tuple, list[Glyph]] = defaultdict(list)
    cell = 24.0
    overlaps = []
    for g in visible:
        b = g.bbox
        keys = {(int(x // cell), int(y // cell)) for x in (b[0], b[2]) for y in (b[1], b[3])}
        hit = False
        for k in keys:
            for o in grid[k]:
                if line_of.get(o.idx) == line_of.get(g.idx):
                    continue
                small = min(_area(b), _area(o.bbox)) or 1e-6
                # ink boxes include ascent/descent padding, so require a real overlap
                if _inter(b, o.bbox) / small > 0.35 and abs(g.origin[1] - o.origin[1]) < 0.6 * max(g.eff_size, o.eff_size):
                    overlaps.append(_union([b, o.bbox]))
                    hit = True
                    break
            if hit:
                break
        for k in keys:
            grid[k].append(g)
    if len(overlaps) >= 2:
        f.add("layout", "error", "Overlapping text",
              f"{len(overlaps)} characters are printed on top of other text", page=page, boxes=overlaps,
              fix="Undo the edit that caused it, or edit with 'Shift rest of line' / 'Squeeze to fit'")

    rotated = [g for g in visible if abs(g.angle % 90) > 1 and abs(g.angle % 90) < 89]
    if rotated:
        f.add("layout", "info", "Text at an angle", f"{len(rotated)} characters are rotated by a non-right angle",
              page=page, boxes=[_union([g.bbox for g in rotated])])


def _check_document_layout(pdf: pikepdf.Pdf, models: dict[int, PageModel], f: Findings) -> None:
    sizes = Counter()
    for i, page in enumerate(pdf.pages):
        n = i + 1
        try:
            mb = [float(v) for v in page.mediabox]
        except Exception:
            f.add("structure", "error", "Page has no valid size (MediaBox)", page=n)
            continue
        w, h = abs(mb[2] - mb[0]), abs(mb[3] - mb[1])
        if w < 3 or h < 3 or w > 14400 or h > 14400:
            f.add("structure", "error", "Invalid page size", f"{w:.0f} x {h:.0f} pt is outside what PDF allows", page=n)
        rot = page.obj.get("/Rotate", 0)
        try:
            if int(rot) % 90:
                f.add("layout", "error", "Invalid page rotation", f"/Rotate is {rot}; it must be a multiple of 90", page=n)
        except (TypeError, ValueError):
            f.add("layout", "error", "Invalid page rotation value", str(rot), page=n)
        if "/CropBox" in page.obj:
            cb = [float(v) for v in page.obj.CropBox]
            if _inter(cb, mb) < 0.5 * _area(cb):
                f.add("layout", "warning", "Visible area lies outside the page", "The CropBox is mostly outside the MediaBox", page=n)
        uu = float(page.obj.get("/UserUnit", 1))
        if abs(uu - 1) > 1e-6:
            f.add("layout", "info", "Page uses a custom scale (UserUnit)", f"1 unit = {uu} pt; some tools ignore this", page=n)
        r = int(rot) % 360 if isinstance(rot, int) else 0
        sizes[(round(w if r in (0, 180) else h), round(h if r in (0, 180) else w))] += 1
    if len(sizes) > 1:
        desc = ", ".join(f"{a}x{b} pt ({c} page{'s' if c > 1 else ''})" for (a, b), c in sizes.most_common(4))
        f.add("layout", "info", "Pages have different sizes or orientations", desc)

    # margins: pages whose text starts far from where it starts on most pages
    lefts = {}
    for i, m in models.items():
        xs = [g.bbox[0] for g in m.glyphs if g.tr not in (3, 7) and g.ch.strip() and abs(g.direction[0]) > 0.99]
        if len(xs) > 20:
            lefts[i] = float(np.percentile(xs, 5))
    if len(lefts) >= 3:
        med = float(np.median(list(lefts.values())))
        odd = [i + 1 for i, v in lefts.items() if abs(v - med) > 36]
        if odd and len(odd) < len(lefts) / 2:
            f.add("layout", "info", "Inconsistent left margin",
                  f"Text on page{'s' if len(odd) > 1 else ''} {', '.join(map(str, odd[:10]))} starts more than half an inch "
                  f"away from the usual margin")


# ==================================================================== C. scans
def _main_image(model: PageModel):
    best, best_area = None, 0.0
    for im in model.images:
        c = im["ctm"]
        a = abs(c[0] * c[3] - c[1] * c[2])
        if a > best_area:
            best, best_area = im, a
    return best


def _check_scan(model: PageModel, f: Findings, ocr: Optional[dict]) -> None:
    page = model.page_index + 1
    im = _main_image(model)
    if im is not None:
        xo, c = im["xobj"], im["ctm"]
        placed_w = math.hypot(c[0], c[1])
        placed_h = math.hypot(c[2], c[3])
        try:
            w_px, h_px = int(xo.Width), int(xo.Height)
            dpi = min(w_px / max(placed_w / 72, 1e-6), h_px / max(placed_h / 72, 1e-6))
            if dpi < 100:
                f.add("scan", "error", "Scan resolution is very low",
                      f"About {dpi:.0f} dpi; text will look blurry and OCR will make many mistakes (300 dpi recommended)",
                      page=page, fix="Rescan at 300 dpi")
            elif dpi < 200:
                f.add("scan", "warning", "Scan resolution is low", f"About {dpi:.0f} dpi (300 dpi recommended for OCR)",
                      page=page)
        except Exception:
            pass
        img = _decode(xo)
        if img is not None:
            _analyse_scan_image(img, page, f)
    if ocr:
        words = ocr.get("words", [])
        low = [w for w in words if (w.get("conf") or 0) < 60]
        if words and low:
            sev = "warning" if len(low) / len(words) > 0.1 else "info"
            sample = ", ".join(repr(w["text"]) for w in low[:8])
            f.add("scan", sev, "OCR is unsure about some words",
                  f"{len(low)} of {len(words)} recognised words have low confidence ({sample}); check them before relying "
                  "on search or edits", page=page, boxes=[w["bbox"] for w in low])
    # duplicate invisible text layers (OCR run twice, or by two tools)
    inv = [g for g in model.glyphs if g.tr in (3, 7) and g.ch.strip()]
    if inv:
        cnt = Counter((g.ch, round(g.origin[0]), round(g.origin[1])) for g in inv)
        dup = sum(v - 1 for v in cnt.values() if v > 1)
        if dup > 0.3 * len(inv):
            f.add("scan", "warning", "Duplicate OCR text layers",
                  "The page has two or more invisible text layers; search finds every word twice and copied text is doubled",
                  page=page, fix="Remove the extra layer and run 'Make searchable' once")


def _decode(xo) -> Optional[Image.Image]:
    try:
        return pikepdf.PdfImage(xo).as_pil_image()
    except Exception:
        return None


def _analyse_scan_image(img: Image.Image, page: int, f: Findings) -> None:
    g = img.convert("L")
    scale = 1200 / max(g.size)
    if scale < 1:
        # nearest keeps single-pixel specks and edge sharpness intact
        g = g.resize((max(1, int(g.width * scale)), max(1, int(g.height * scale))), Image.NEAREST)
    a = np.asarray(g, dtype=np.float32)
    p90 = float(np.percentile(a, 90))
    flat = a.ravel()
    k = max(1, flat.size // 1000)
    p2 = float(np.partition(flat, k)[:k].mean())  # ink level: darkest 0.1% (text covers little of a page)
    if p90 < 150:
        f.add("scan", "warning", "Scan is too dark", "The paper background is dark grey; text is hard to read and OCR suffers",
              page=page)
    if p90 - p2 < 70:
        f.add("scan", "warning", "Low contrast", "Text and background are too similar in brightness", page=page)
    elif p2 > 110:
        f.add("scan", "warning", "Faded text", "Even the darkest text is light grey; parts may be unreadable", page=page)
    # uneven lighting: background brightness across a 4x4 grid
    h, w = a.shape
    tiles = [np.percentile(a[r * h // 4:(r + 1) * h // 4, c * w // 4:(c + 1) * w // 4], 90) for r in range(4) for c in range(4)]
    if max(tiles) - min(tiles) > 60:
        f.add("scan", "info", "Uneven brightness", "Part of the page is noticeably darker than the rest (shadow or fold)",
              page=page)
    # ink relative to the local paper brightness, so shadows are not mistaken for text
    bg = np.ones_like(a)
    th_, tw_ = max(1, h // 8), max(1, w // 8)
    for r in range(0, h, th_):
        for c in range(0, w, tw_):
            bg[r:r + th_, c:c + tw_] = max(float(np.percentile(a[r:r + th_, c:c + tw_], 90)), 1.0)
    rel_ink = p2 / max(p90, 1.0)
    ink = a / bg < (1 + rel_ink) / 2
    ink_n = int(ink.sum())
    if ink_n < 50:
        return
    # noise: dark dots with no dark neighbours (letter strokes always have some)
    pad = np.pad(ink, 1)
    neigh = sum(pad[1 + dy:1 + dy + h, 1 + dx:1 + dx + w].astype(np.int8)
                for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx)
    specks = int((ink & (neigh == 0)).sum())
    if specks > 200 and specks / ink_n > 0.02:
        f.add("scan", "warning", "Background noise or specks", f"About {specks} isolated dark specks; they confuse OCR",
              page=page)
    # blur: how sharp the strongest edges are relative to the contrast
    gx = np.abs(np.diff(a, axis=1))
    sharp = float(np.percentile(gx, 99.5)) / max(p90 - p2, 1.0)
    if sharp < 0.25:
        f.add("scan", "warning", "Scan looks blurry", "Letter edges are soft; OCR accuracy will be lower", page=page)
    # skew: rotation that makes text rows line up best
    angle = _skew_angle(ink)
    if angle is not None and abs(angle) >= 0.5:
        f.add("scan", "warning" if abs(angle) >= 1.5 else "info", "Page is skewed",
              f"The scan is rotated by about {angle:+.1f}°; scan edits need an upright page and OCR is less accurate",
              page=page, fix="Rescan with the page straight, or deskew it before uploading")


def _skew_angle(ink: np.ndarray) -> Optional[float]:
    h, w = ink.shape
    s = 600 / max(h, w)
    m = Image.fromarray((ink * 255).astype(np.uint8))
    if s < 1:
        m = m.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)
    best, best_score, base = None, -1.0, None
    for ang in np.arange(-5, 5.01, 0.25):
        r = np.asarray(m.rotate(float(ang), resample=Image.BILINEAR, fillcolor=0), dtype=np.float32)
        score = float(np.var(r.sum(axis=1)))
        if abs(ang) < 1e-9:
            base = score
        if score > best_score:
            best, best_score = float(ang), score
    if base is None or best_score < base * 1.15:
        return 0.0  # no clearly better angle: treat as straight
    return -best


# =============================================================== D. structure
def _check_structure(pdf: pikepdf.Pdf, original: bytes, f: Findings, was_encrypted: bool) -> None:
    try:
        orig = pikepdf.open(io.BytesIO(original))
        for _ in orig.objects:
            pass
        warns = orig.get_warnings()
        if warns:
            # qpdf prefixes the stream name ("stream <_io.BytesIO ...> (object 7 0): ...")
            first = re.sub(r"^stream <[^>]*>\s*", "", str(warns[0]))
            f.add("structure", "warning", "The file was damaged and has been repaired",
                  f"{len(warns)} problem(s) such as: {first}", fix="Download a fresh copy, or re-export from the source")
    except Exception as exc:
        f.add("structure", "error", "The original file is damaged", str(exc))
    if was_encrypted:
        f.add("structure", "info", "The original was password protected",
              "Editing works on a decrypted copy; protect the file again when downloading if it should stay locked")

    # metadata
    title = str(pdf.docinfo.get("/Title", "")) if pdf.trailer.get("/Info") is not None else ""
    xmp_title = ""
    try:
        with pdf.open_metadata(set_pikepdf_as_editor=False) as meta:
            xmp_title = str(meta.get("dc:title", "") or "")
    except Exception:
        f.add("structure", "warning", "Document metadata (XMP) is damaged")
    if not title.strip() and not xmp_title.strip():
        f.add("structure", "info", "The document has no title", "Viewers show the file name instead; screen readers announce no title")
    elif title and xmp_title and title.strip() != xmp_title.strip():
        f.add("structure", "warning", "Title metadata is inconsistent",
              f"Document info says '{title}' but XMP metadata says '{xmp_title}'")
    for k in ("/CreationDate", "/ModDate"):
        v = str(pdf.docinfo.get(k, "")) if pdf.trailer.get("/Info") is not None else ""
        if v and not v.startswith("D:") and not v[:4].isdigit():
            f.add("structure", "info", f"Malformed {k[1:]} in metadata", v)

    # images and compression
    seen = set()
    for i, page in enumerate(pdf.pages[:MAX_PAGES]):
        try:
            xobjs = page.resources.get("/XObject") or {}
            items = list(xobjs.items())
        except Exception:
            items = []
        for name, xo in items:
            if not isinstance(xo, pikepdf.Stream) or xo.get("/Subtype") != "/Image" or xo.objgen in seen:
                continue
            seen.add(xo.objgen)
            filt = xo.get("/Filter")
            filters = [str(x) for x in (filt if isinstance(filt, pikepdf.Array) else [filt] if filt is not None else [])]
            unknown = [x for x in filters if x not in KNOWN_FILTERS]
            if unknown:
                f.add("structure", "error", "Image uses an unsupported compression", f"{name}: {', '.join(unknown)}", page=i + 1)
                continue
            if "/JPXDecode" in filters:
                f.add("structure", "info", "Image uses JPEG 2000 compression", f"{name}: some older viewers cannot show it", page=i + 1)
            if len(seen) > 60:
                continue
            try:
                pikepdf.PdfImage(xo).as_pil_image()
            except pikepdf.DependencyError:
                f.add("structure", "info", "Image needs an extra decoder", f"{name} ({', '.join(filters)}) cannot be decoded here",
                      page=i + 1)
            except Exception as exc:
                f.add("structure", "error", "Image is corrupted", f"{name}: {exc}", page=i + 1)

    _check_annotations(pdf, f)


def _check_annotations(pdf: pikepdf.Pdf, f: Findings) -> None:
    n_pages = len(pdf.pages)
    page_objs = {p.obj.objgen: i for i, p in enumerate(pdf.pages)}
    names = _named_dests(pdf)
    acro = pdf.Root.get("/AcroForm")
    need_ap = bool(acro.get("/NeedAppearances", False)) if acro is not None else False
    for i, page in enumerate(pdf.pages[:MAX_PAGES]):
        n = i + 1
        try:
            mb = [float(v) for v in page.mediabox]
        except Exception:
            continue
        for a in page.obj.get("/Annots") or []:
            if not isinstance(a, pikepdf.Dictionary):
                f.add("structure", "warning", "Broken annotation entry", "An annotation reference points to nothing", page=n)
                continue
            sub = str(a.get("/Subtype", ""))
            if "/Rect" not in a:
                f.add("structure", "error", f"Annotation {sub[1:] or '?'} has no position", page=n)
                continue
            try:
                r = [float(v) for v in a.Rect]
                r = [min(r[0], r[2]), min(r[1], r[3]), max(r[0], r[2]), max(r[1], r[3])]
            except Exception:
                f.add("structure", "error", f"Annotation {sub[1:]} has an invalid position", page=n)
                continue
            if sub not in ("/Popup",) and _inter(r, mb) == 0 and _area(r) > 0:
                f.add("structure", "warning", f"{sub[1:]} annotation is outside the page", page=n, boxes=[r])
            if sub == "/Link":
                _check_link(a, r, n, n_pages, page_objs, names, f)
            if sub == "/Widget":
                if "/AP" not in a and not need_ap:
                    f.add("structure", "warning", "Form field has no appearance",
                          f"Field '{_field_name(a)}' may show up blank in some viewers", page=n, boxes=[r])
                if not _field_name(a):
                    f.add("structure", "warning", "Form field has no name", "Its value cannot be filled or exported", page=n, boxes=[r])


def _field_name(a) -> str:
    parts, node, hops = [], a, 0
    while isinstance(node, pikepdf.Dictionary) and hops < 20:
        if "/T" in node:
            parts.append(str(node.T))
        node = node.get("/Parent")
        hops += 1
    return ".".join(reversed(parts))


def _named_dests(pdf: pikepdf.Pdf) -> Optional[set]:
    out = set()
    try:
        dests = pdf.Root.get("/Dests")
        if isinstance(dests, pikepdf.Dictionary):
            out |= {str(k)[1:] for k in dests.keys()}
        tree = pdf.Root.get("/Names", {}).get("/Dests")
        if tree is not None:
            for k, _ in pikepdf.NameTree(tree).items():
                out.add(str(k))
    except Exception:
        return None
    return out


def _check_link(a, r, n, n_pages, page_objs, names, f: Findings) -> None:
    action = a.get("/A")
    dest = a.get("/Dest")
    if action is None and dest is None:
        f.add("structure", "warning", "Link goes nowhere", "A link area has no target", page=n, boxes=[r])
        return
    if isinstance(action, pikepdf.Dictionary):
        s = str(action.get("/S", ""))
        if s == "/URI":
            uri = str(action.get("/URI", ""))
            if not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", uri):
                f.add("structure", "warning", "Web link is malformed", f"'{uri}' has no scheme such as https://", page=n, boxes=[r])
            return
        if s == "/GoTo":
            dest = action.get("/D")
        else:
            return
    if isinstance(dest, (pikepdf.String, pikepdf.Name)):
        key = str(dest)[1:] if isinstance(dest, pikepdf.Name) else str(dest)
        if names is not None and key not in names:
            f.add("structure", "error", "Broken internal link", f"Named destination '{key}' does not exist", page=n, boxes=[r])
    elif isinstance(dest, pikepdf.Array) and len(dest):
        target = dest[0]
        if isinstance(target, pikepdf.Dictionary):
            if target.objgen not in page_objs:
                f.add("structure", "error", "Broken internal link", "The link points to a page that no longer exists", page=n, boxes=[r])
        elif isinstance(target, int) and not 0 <= int(target) < n_pages:
            f.add("structure", "error", "Broken internal link", f"The link points to page {int(target) + 1}", page=n, boxes=[r])


# ================================================================ E. editing
def _check_editing(original: bytes, data: bytes, pdf: pikepdf.Pdf, models: dict[int, PageModel], f: Findings,
                   history: list[dict]) -> None:
    from .document import is_signed
    from .render import render_array

    try:
        orig = pikepdf.open(io.BytesIO(original))
    except Exception:
        return
    if is_signed(orig):
        f.add("editing", "error", "Digital signature is no longer valid",
              "The document was signed; any change after signing invalidates the signature",
              fix="Ask the signer to sign the edited version again")

    # what the edits themselves reported
    def page_text(n) -> str:
        m = models.get((n or 1) - 1)
        return "".join(g.ch for g in m.glyphs if not g.ch.isspace()) if m is not None else ""

    for h in history:
        page = h.get("page")
        rep = h.get("report") or {}
        ver = rep.get("verification") or {}
        for r in rep.get("reports") or []:
            new_text = "".join((r.get("newText") or "").split())
            if new_text and new_text not in page_text(page):
                continue  # replaced again by a later edit: what it reported no longer applies
            label = f"'{r.get('originalText', '')}' → '{r.get('newText', '')}'"
            subs = r.get("substitutes") or []
            if subs:
                fonts = sorted({s["font"] for s in subs})
                chars = "".join(sorted({s["char"] for s in subs}))
                f.add("editing", "warning", "Replacement font used",
                      f"{label}: '{chars}' drawn with {', '.join(fonts)} because '{r.get('font')}' lacks those letters",
                      page=page, fix="Install the original font family and redo the edit for an exact match")
            if not r.get("fits", True):
                f.add("editing", "error", "Edited text overlaps neighbouring content",
                      f"{label} is {r.get('overflow')} pt too wide", page=page,
                      fix="Undo and edit again with 'Squeeze to fit' or 'Shift rest of line'")
            elif r.get("scale", 1) < 0.75:
                f.add("editing", "warning", "Edited text is strongly compressed",
                      f"{label} was narrowed to {round(r['scale'] * 100)}% of its normal width to fit", page=page)
        if ver.get("movedGlyphs"):
            f.add("editing", "error", "Text shifted after editing",
                  f"{ver['movedGlyphs']} untouched characters moved in edit '{h.get('summary', '')}'", page=page)
        if ver.get("changedOutside", 0) > 25:
            f.add("editing", "warning", "Page changed outside the edited area",
                  f"{ver['changedOutside']} pixels changed around edit '{h.get('summary', '')}' (background or graphics may be damaged)",
                  page=page)

    # links whose text changed
    if len(orig.pages) == len(pdf.pages):
        for i, m in models.items():
            try:
                mo = PageModel(orig, i)
            except Exception:
                continue
            for a in pdf.pages[i].obj.get("/Annots") or []:
                if not isinstance(a, pikepdf.Dictionary) or a.get("/Subtype") != "/Link" or "/Rect" not in a:
                    continue
                r = [float(v) for v in a.Rect]
                r = [min(r[0], r[2]), min(r[1], r[3]), max(r[0], r[2]), max(r[1], r[3])]
                before, after = _text_in(mo, r), _text_in(m, r)
                if before.strip() and before != after:
                    spill = _text_spills(m, r)
                    f.add("editing", "warning", "Link text changed",
                          f"The link area used to cover '{before.strip()}' and now covers '{after.strip()}'"
                          + ("; the new text extends beyond the clickable area" if spill else ""),
                          page=i + 1, boxes=[r], fix="Check the link still points to the right place")

        # pages that look different from the original
        changed = []
        for i in range(min(len(pdf.pages), 30)):
            try:
                a0 = render_array(original, i, 0.5)
                a1 = render_array(data, i, 0.5)
            except Exception:
                continue
            if a0.shape != a1.shape:
                changed.append((i + 1, 100.0))
                continue
            diff = np.abs(a0.astype(np.int16) - a1.astype(np.int16)).max(axis=2) > 40
            pct = float(diff.mean() * 100)
            if pct > 0.05:
                changed.append((i + 1, pct))
        if changed:
            f.add("editing", "info", "Pages that differ from the original",
                  ", ".join(f"page {p} ({pct:.1f}% of the area)" if pct >= 0.1 else f"page {p} (small change)" for p, pct in changed[:15])
                  + ". Use the Changes view to see exactly what differs")
    else:
        f.add("editing", "info", "Page count changed", f"{len(orig.pages)} pages originally, {len(pdf.pages)} now")


def _text_in(model: PageModel, r) -> str:
    out = []
    for g in model.glyphs:
        b = g.bbox
        if _inter(b, r) > 0.5 * (_area(b) or 1e-6):
            out.append(g.ch)
    return "".join(out)


def _text_spills(model: PageModel, r) -> bool:
    for g in model.glyphs:
        b = g.bbox
        if not g.ch.strip():
            continue
        ov = _inter(b, r) / (_area(b) or 1e-6)
        if 0.05 < ov < 0.5:
            return True
    return False
