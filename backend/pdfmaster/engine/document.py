"""High-level engine API used by the service layer (no web framework here)."""
from __future__ import annotations

import io
import re
from dataclasses import dataclass

import pikepdf

from .editor import Edit, EditError, PageEditor
from .fonts import FontCache
from .interpreter import PageModel
from .validate import pixel_diff, verify_positions

WARM_PAGES = 30


def open_pdf(data: bytes, password: str = "") -> pikepdf.Pdf:
    return pikepdf.open(io.BytesIO(data), password=password)


def save_pdf(pdf: pikepdf.Pdf) -> bytes:
    buf = io.BytesIO()
    pdf.save(buf, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.preserve)
    return buf.getvalue()


def is_signed(pdf: pikepdf.Pdf) -> bool:
    acro = pdf.Root.get("/AcroForm")
    if acro is None:
        return False
    if int(acro.get("/SigFlags", 0)) & 1:
        return True
    for f in acro.get("/Fields", []):
        if str(f.get("/FT", "")) == "/Sig" and "/V" in f:
            return True
    return False


def font_key(font) -> str:
    o = font.obj
    return f"{o.objgen[0]}_{o.objgen[1]}" if o.is_indirect else f"d{id(o)}"


def page_json(model: PageModel) -> dict:
    from .images import describe as describe_images


    x0, y0, x1, y1 = model.mediabox
    fonts = {}
    glyphs = []
    for g in model.glyphs:
        k = font_key(g.font)
        if k not in fonts:
            fonts[k] = g.font.info()
        b = g.bbox
        glyphs.append({
            "i": g.idx, "c": g.ch, "b": [round(v, 2) for v in b],
            "o": [round(g.origin[0], 2), round(g.origin[1], 2)],
            "a": round(g.angle, 2), "f": k, "s": round(g.eff_size, 2), "col": g.color,
            "tr": g.tr, "x": g.stream != "page",
        })
    return {
        "page": model.page_index + 1,
        "box": [x0, y0, x1, y1],
        "rotation": model.rotation,
        "type": model.page_type(),
        "fonts": fonts,
        "glyphs": glyphs,
        "lines": [{"id": l["id"], "text": l["text"], "map": l["map"], "bbox": [round(v, 2) for v in l["bbox"]]} for l in model.lines()],
        "warnings": sorted(set(model.warnings))[:20],
        "images": describe_images(model),
    }


def extract_page(data: bytes, page: int) -> dict:
    pdf = open_pdf(data)
    return page_json(PageModel(pdf, page))


@dataclass
class EditResult:
    data: bytes
    reports: list[dict]
    verification: dict
    page: dict


def _expected_rects(before: PageModel, after: PageModel, edited: set[int], reflow: set[int], extra_idx: list[int]) -> list:
    rects = [before.glyphs[i].bbox for i in edited | reflow]
    rects += [after.glyphs[i].bbox for i in extra_idx]
    return rects


def _placement_problems(before: PageModel, after: PageModel, changed: set[int], new_glyphs: list) -> dict:
    """Where the edited text landed: off the page, outside its clip box, or on top of other text."""
    from .preflight import _area, _inter

    page_box = after.mediabox
    others = [g for g in before.glyphs if g.idx not in changed and g.ch.strip() and g.tr not in (3, 7)]
    off = clipped = overlap = 0
    for g in new_glyphs:
        if not g.ch.strip() or g.tr in (3, 7):
            continue
        b = g.bbox
        a = _area(b) or 1e-6
        if _inter(b, page_box) / a < 0.9:
            off += 1
        elif g.clip is not None and _inter(b, g.clip) / a < 0.6:
            clipped += 1
        elif any(_inter(b, o.bbox) / min(a, _area(o.bbox) or 1e-6) > 0.35
                 and abs(g.origin[1] - o.origin[1]) < 0.6 * max(g.eff_size, o.eff_size) for o in others):
            overlap += 1
    return {"offPage": off, "clipped": clipped, "overlapping": overlap}


def apply_edits(data: bytes, page: int, edits: list[Edit]) -> EditResult:
    pdf = open_pdf(data)
    if page < 0 or page >= len(pdf.pages):
        raise EditError("Page out of range")
    fonts = FontCache()
    # Interpreting other pages records which codes each font already draws, which
    # lets us safely reuse glyphs of fonts whose program we cannot inspect.
    for i in range(min(len(pdf.pages), WARM_PAGES)):
        if i != page:
            PageModel(pdf, i, fonts)
    model = PageModel(pdf, page, fonts)
    before_model = model
    editor = PageEditor(pdf, model)
    reports = editor.apply(edits)
    out = save_pdf(pdf)

    after = PageModel(open_pdf(out), page)
    edited = {i for e in edits for i in e.glyphs}
    reflow = {i for r in reports for i in r.get("reflowGlyphs", [])}
    ver = verify_positions(before_model, after, edited, reflow, [e.text for e in edits])
    from .validate import _match

    keep = [g for g in before_model.glyphs if g.idx not in edited and g.idx not in reflow]
    _, extra = _match(keep, after.glyphs)
    rects = _expected_rects(before_model, after, edited, reflow, [g.idx for g in extra])
    px = pixel_diff(data, out, page, rects)
    ver.update(px)
    warnings = []
    if ver["movedGlyphs"]:
        warnings.append(f"{ver['movedGlyphs']} untouched characters changed position")
    if not ver["newTextVerified"]:
        warnings.append("Re-reading the edited page did not return exactly the new text")
    if px.get("changedOutside", 0) > 25:
        warnings.append(f"{px['changedOutside']} pixels changed outside the edited area")
    if is_signed(pdf):
        warnings.append("This PDF is digitally signed; editing invalidates the signature")
    problems = _placement_problems(before_model, after, edited | reflow, extra)
    ver.update(problems)
    if problems["offPage"]:
        warnings.append(f"{problems['offPage']} new characters run off the page")
    if problems["clipped"]:
        warnings.append(f"{problems['clipped']} new characters are cut off by their text box")
    if problems["overlapping"]:
        warnings.append(f"{problems['overlapping']} new characters overlap other text")
    ver["warnings"] = warnings
    ver["layoutPreserved"] = (ver["movedGlyphs"] == 0 and px.get("changedOutside", 0) <= 25
                              and all(r.get("fits", True) for r in reports)
                              and not any(problems.values()))
    return EditResult(out, reports, ver, page_json(after))


def find_matches(data: bytes, query: str, match_case: bool = False, whole_word: bool = False, pages: list[int] | None = None) -> dict[int, list[dict]]:
    pdf = open_pdf(data)
    flags = 0 if match_case else re.IGNORECASE
    pat = re.escape(query)
    if whole_word:
        pat = rf"(?<!\w){pat}(?!\w)"
    rx = re.compile(pat, flags)
    found: dict[int, list[dict]] = {}
    for p in pages if pages is not None else range(len(pdf.pages)):
        model = PageModel(pdf, p)
        for line in model.lines():
            text = line["text"].replace(" ", " ")
            for m in rx.finditer(text):
                ids = {i for i in line["map"][m.start():m.end()] if i >= 0}
                groups = {model.glyphs[i].group for i in ids} - {-1}
                ids = sorted(ids | {g.idx for g in model.glyphs if g.group in groups})
                if not ids:
                    continue
                streams = {model.glyphs[i].stream for i in ids}
                found.setdefault(p, []).append({
                    "glyphs": ids, "text": m.group(0), "line": line["id"],
                    "bbox": line["bbox"], "splitStreams": len(streams) > 1,
                })
    return found
