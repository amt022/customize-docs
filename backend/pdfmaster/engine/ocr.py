"""OCR for scanned pages (Tesseract) and an invisible, searchable text layer.

OCR words are stored in PDF user space, keyed by a hash of the page's images,
so the result follows the page through reordering and survives text edits on
other pages; editing the scan changes the hash and the stored words with it.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import os
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Optional

import numpy as np
import pikepdf

from . import geometry as G
from .interpreter import PageModel
from .render import geometry_for, render_array

log = logging.getLogger(__name__)

TESSDATA_URL = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/{lang}.traineddata"
DEFAULT_LANGS = "eng+hin"
LAYER_TAG = "/PMOCR"
OCR_VERSION = 3  # bump when recognition improves so older results are offered again


class OcrUnavailable(Exception):
    pass


def tesseract_path() -> Optional[str]:
    cands = [os.environ.get("PDFMASTER_TESSERACT"), shutil.which("tesseract"),
             r"C:\Program Files\Tesseract-OCR\tesseract.exe",
             os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
             "/usr/bin/tesseract", "/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract"]
    return next((c for c in cands if c and os.path.isfile(c)), None)


def tessdata_dir(data_root: Path, langs: str) -> Path:
    """Our own tessdata folder: copies bundled models and downloads missing ones (e.g. Hindi)."""
    exe = tesseract_path()
    if not exe:
        raise OcrUnavailable("Tesseract OCR is not installed. Install it (e.g. winget install UB-Mannheim.TesseractOCR) and retry.")
    target = data_root / "tessdata"
    target.mkdir(parents=True, exist_ok=True)
    # Windows keeps tessdata beside the exe; Linux packages put it under /usr/share
    found = [Path(p) for p in (os.environ.get("TESSDATA_PREFIX"), Path(exe).parent / "tessdata",
                               "/usr/share/tesseract-ocr/5/tessdata", "/usr/share/tesseract-ocr/4.00/tessdata",
                               "/usr/share/tessdata") if p]
    bundled = next((p for p in found if p.is_dir() and p.resolve() != target.resolve()), found[0])
    for sub in ("configs", "tessconfigs"):  # the "tsv" output config lives here; without it Tesseract prints plain text
        if (bundled / sub).is_dir() and not (target / sub).exists():
            shutil.copytree(bundled / sub, target / sub)
    for lang in langs.split("+") + ["osd"]:
        f = target / f"{lang}.traineddata"
        if f.exists():
            continue
        if (bundled / f.name).exists():
            shutil.copy2(bundled / f.name, f)
            continue
        if lang == "osd":
            continue
        log.info("downloading %s language model", lang)
        tmp = f.with_suffix(".part")
        with urllib.request.urlopen(TESSDATA_URL.format(lang=lang), timeout=120) as r, open(tmp, "wb") as out:
            shutil.copyfileobj(r, out)
        tmp.replace(f)
    return target


def page_key(pdf: pikepdf.Pdf, index: int) -> str:
    """Identity of a scanned page's pixels: hash of every image drawn and where."""
    model = PageModel(pdf, index)
    h = hashlib.sha1()
    for im in model.images:
        h.update(im["xobj"].read_raw_bytes())
        h.update(repr(tuple(round(v, 3) for v in im["ctm"])).encode())
    h.update(repr([float(v) for v in pdf.pages[index].mediabox]).encode())
    return h.hexdigest()


def run_tesseract(data: bytes, index: int, data_root: Path, langs: str = DEFAULT_LANGS, dpi: int = 300) -> dict:
    exe = tesseract_path()
    tessdata = tessdata_dir(data_root, langs)
    zoom = dpi / 72.0
    arr = render_array(data, index, zoom)
    with pikepdf.open(io.BytesIO(data)) as pdf:
        geo = geometry_for(pdf.pages[index], zoom)
    from PIL import Image

    with tempfile.TemporaryDirectory() as td:
        img = Path(td) / "page.png"
        from PIL import ImageOps

        # stretched grey reads better than colour on phone photos (shadows, tinted paper, light-on-dark banners)
        ImageOps.autocontrast(Image.fromarray(arr).convert("L"), cutoff=1).save(img)
        env = dict(os.environ, TESSDATA_PREFIX=str(tessdata), OMP_THREAD_LIMIT="2")
        def run(psm: str) -> str:
            proc = subprocess.run([exe, str(img), "stdout", "-l", langs, "--dpi", str(dpi), "--psm", psm, "tsv"],
                                  capture_output=True, env=env, timeout=600)
            if proc.returncode != 0:
                raise OcrUnavailable(proc.stderr.decode("utf-8", "replace")[-400:])
            out = proc.stdout.decode("utf-8", "replace")
            if not out.startswith("level"):
                raise OcrUnavailable("Tesseract did not return word positions: " + proc.stderr.decode("utf-8", "replace")[-300:])
            return out

        tsv = run("3")
        try:  # a second look for scattered words: the layout pass skips short lines standing alone on a picture
            sparse = run("11")
        except (OcrUnavailable, subprocess.TimeoutExpired):
            sparse = ""

    def rows(out: str):
        for row in csv.DictReader(io.StringIO(out), delimiter="\t", quoting=csv.QUOTE_NONE):
            text = (row.get("text") or "").strip()
            conf = float(row.get("conf") or -1)
            if row.get("level") == "5" and text and conf >= 0:
                yield row, text, conf, tuple(int(row[k]) for k in ("left", "top", "width", "height"))

    found = [r + (0,) for r in rows(tsv)]
    boxes = [b for _r, _t, _c, b, _p in found]
    for row, text, conf, (l, t, w, h) in rows(sparse):
        # only sure, real words (pictures give this pass plenty of noise) where the first pass found nothing
        if conf < 85 or sum(c.isalnum() for c in text) < 2:
            continue
        if any(l < bl + bw and bl < l + w and t < bt + bh and bt < t + h for bl, bt, bw, bh in boxes):
            continue
        found.append((row, text, conf, (l, t, w, h), 1))

    gray = arr.mean(axis=2)
    words, lines = [], {}
    for row, text, conf, (l, t, w, h), source in found:
        (ax, ay), (bx, by) = geo.to_pdf(l, t), geo.to_pdf(l + w, t + h)
        patch = arr[t:t + h, l:l + w].reshape(-1, 3)
        g = gray[t:t + h, l:l + w].reshape(-1)
        color = "#000000"
        if len(g):
            dark = patch[g <= np.percentile(g, 15)]
            if len(dark):
                color = "#%02x%02x%02x" % tuple(int(v) for v in np.median(dark, axis=0))
        key = (source, row["block_num"], row["par_num"], row["line_num"])
        lid = lines.setdefault(key, len(lines))
        words.append({
            "text": text, "conf": round(conf, 1), "line": lid,
            "bbox": [round(min(ax, bx), 2), round(min(ay, by), 2), round(max(ax, bx), 2), round(max(ay, by), 2)],
            "color": color,
        })
    return {"v": OCR_VERSION, "langs": langs, "dpi": dpi, "words": words}


def _bands(profile: np.ndarray, min_gap: int) -> list[tuple[int, int]]:
    """Runs of non-empty entries, joined across gaps shorter than min_gap."""
    idx = np.flatnonzero(profile > 0)
    if not len(idx):
        return []
    out = [[int(idx[0]), int(idx[0]) + 1]]
    for i in idx[1:]:
        if i - out[-1][1] < min_gap:
            out[-1][1] = int(i) + 1
        else:
            out.append([int(i), int(i) + 1])
    return [tuple(b) for b in out]


def _main_band(ink: np.ndarray) -> np.ndarray:
    """A hand-drawn box often catches the edge of the line above or below, or of the next word: keep the
    band of rows holding most of the ink, then drop separate pieces touching the box's left or right side."""
    rows = ink.sum(axis=1)
    bands = _bands(rows, 2)
    if len(bands) > 1:
        r0, r1 = max(bands, key=lambda b: rows[b[0]:b[1]].sum())
        out = np.zeros_like(ink)
        out[r0:r1] = ink[r0:r1]
        ink = out
    h = max(int(np.ptp(np.flatnonzero(ink.any(axis=1)))) + 1, 1) if ink.any() else 1
    cols = ink.sum(axis=0)
    cb = _bands(cols, max(int(0.25 * h), 2))
    if len(cb) > 1:
        keep = np.zeros(ink.shape[1], bool)
        for k, (c0, c1) in enumerate(cb):
            at_edge = (k == 0 and c0 <= 1) or (k == len(cb) - 1 and c1 >= ink.shape[1] - 1)
            if not at_edge or cols[c0:c1].sum() >= 0.5 * cols.sum():
                keep[c0:c1] = True
        ink = ink & keep[None, :]
    return ink


def mark_word(data: bytes, index: int, ocr: Optional[dict], bbox: list[float], text: str, dpi: int = 300) -> dict:
    """Add a word the OCR did not find (joined-up script, text over a picture): the user drew `bbox` (PDF units)
    around it and typed what it says. The box is tightened to the ink inside it. Returns the new OCR result."""
    from .scanedit import _ink_bool

    zoom = dpi / 72.0
    arr = render_array(data, index, zoom)
    with pikepdf.open(io.BytesIO(data)) as pdf:
        geo = geometry_for(pdf.pages[index], zoom)
    c0, r0, c1, r1 = geo.rect_to_px(bbox)
    c0, r0 = max(int(c0), 0), max(int(r0), 0)
    c1, r1 = min(int(np.ceil(c1)), arr.shape[1]), min(int(np.ceil(r1)), arr.shape[0])
    if c1 - c0 < 4 or r1 - r0 < 4:
        raise ValueError("The box is too small")
    crop = arr[r0:r1, c0:c1].astype(np.float32)
    # the paper is what the edge of the box shows; the text is what differs from it
    edge = np.concatenate([crop[0], crop[-1], crop[:, 0], crop[:, -1]])
    ink = _ink_bool(crop, np.median(edge, axis=0))
    ink = _main_band(ink)
    rows_, cols_ = np.flatnonzero(ink.any(axis=1)), np.flatnonzero(ink.any(axis=0))
    if ink.sum() < 12 or not len(rows_):
        raise ValueError("No text found inside the box. Draw it closely around the word.")
    l, t, r, b = c0 + int(cols_[0]), r0 + int(rows_[0]), c0 + int(cols_[-1]) + 1, r0 + int(rows_[-1]) + 1
    color = "#%02x%02x%02x" % tuple(int(v) for v in np.median(crop[ink], axis=0))
    (ax, ay), (bx, by) = geo.to_pdf(l, t), geo.to_pdf(r, b)
    box = [round(min(ax, bx), 2), round(min(ay, by), 2), round(max(ax, bx), 2), round(max(ay, by), 2)]
    words = list((ocr or {}).get("words", []))
    # joins a line it sits on (same height, overlapping rows), so the words after it can be selected with it
    line, h = max([w["line"] for w in words], default=-1) + 1, box[3] - box[1]
    for w in words:
        wb = w["bbox"]
        over = min(wb[3], box[3]) - max(wb[1], box[1])
        if over > 0.6 * min(h, wb[3] - wb[1]) and 0.7 * h <= wb[3] - wb[1] <= 1.4 * h:
            line = w["line"]
            break
    words.append({"text": text.strip(), "conf": 0.0, "line": line, "bbox": box, "color": color, "manual": True})
    base = ocr or {"langs": DEFAULT_LANGS, "dpi": dpi}
    return {**base, "v": OCR_VERSION, "words": words}


def ocr_page_model(page_index: int, box, rotation: int, ocr: dict) -> dict:
    """Shape OCR words like an extracted digital page so the same UI can edit them."""
    words = ocr["words"]
    glyphs = []
    for i, w in enumerate(words):
        b = w["bbox"]
        glyphs.append({"i": i, "c": w["text"], "b": b, "o": [b[0], b[1]], "a": 0, "f": "ocr",
                       "s": round(b[3] - b[1], 2), "col": w["color"], "tr": 0, "x": False, "conf": w.get("conf")})
    by_line: dict[int, list[int]] = {}
    for i, w in enumerate(words):
        by_line.setdefault(w["line"], []).append(i)
    lines = []
    for lid, ids in sorted(by_line.items(), key=lambda kv: (-words[kv[1][0]]["bbox"][3], words[kv[1][0]]["bbox"][0])):
        ids.sort(key=lambda i: words[i]["bbox"][0])
        text, cmap = "", []
        for k, i in enumerate(ids):
            if k:
                text += " "
                cmap.append(-1)
            text += words[i]["text"]
            cmap += [i] * len(words[i]["text"])
        bb = [words[i]["bbox"] for i in ids]
        lines.append({"id": len(lines), "text": text, "map": cmap,
                      "bbox": [min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb)]})
    confs = [w["conf"] for w in words]
    return {
        "page": page_index + 1, "box": list(box), "rotation": rotation, "type": "scanned", "source": "ocr",
        "fonts": {"ocr": {"name": "Scanned text", "baseFont": "OCR", "type": "Scan", "embedded": False, "subset": False,
                          "bold": False, "italic": False, "editable": True, "warnings": []}},
        "glyphs": glyphs, "lines": lines, "warnings": [],
        "ocr": {"langs": ocr.get("langs"), "words": len(words), "meanConfidence": round(sum(confs) / len(confs), 1) if confs else None},
    }


# ------------------------------------------------------------------ text layer
def remove_text_layer(pdf: pikepdf.Pdf, index: int) -> bool:
    page = pdf.pages[index]
    instrs = pikepdf.parse_content_stream(page)
    out, skipping, removed = [], 0, False
    for ins in instrs:
        op = str(ins.operator)
        if op in ("BMC", "BDC") and ins.operands and str(ins.operands[0]) == LAYER_TAG:
            skipping, removed = 1, True
            continue
        if skipping:
            if op in ("BMC", "BDC"):
                skipping += 1
            elif op == "EMC":
                skipping -= 1
            continue
        out.append(ins)
    if removed:
        page.obj.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return removed


def has_text_layer(pdf: pikepdf.Pdf, index: int) -> bool:
    return any(str(i.operator) == "BMC" and i.operands and str(i.operands[0]) == LAYER_TAG
               for i in pikepdf.parse_content_stream(pdf.pages[index]))


def add_text_layer(pdf: pikepdf.Pdf, index: int, words: list[dict]) -> None:
    """Invisible (Tr 3) text over each OCR word, scaled to the word box, for search/copy."""
    from .sysfonts import EmbeddedSubstitute, ShapedGlyph, coverage_fonts, has_glyph, match_font

    remove_text_layer(pdf, index)
    if not words:
        return
    latin, _ = match_font("Arial", False, False, False, False)
    fonts: list[EmbeddedSubstitute] = []

    def font_for(text: str) -> Optional[EmbeddedSubstitute]:
        for f in [latin] + coverage_fonts(False, False):
            if f and all(has_glyph(f, c) for c in text):
                for e in fonts:
                    if e.font is f:
                        return e
                e = EmbeddedSubstitute(f)
                fonts.append(e)
                return e
        return None

    runs = []
    for w in words:
        text = w["text"]
        sub = font_for(text)
        if sub is None:
            continue
        glyphs = []
        for c in text:
            gid = sub.order.index(sub.cmap[ord(c)])
            glyphs.append(ShapedGlyph(gid, sub._width(gid), 0, 0, sub._width(gid), c))
        sub.use(glyphs)
        runs.append((w, sub, glyphs))
    page = pdf.pages[index]
    res = page.obj.get("/Resources")
    if res is None:
        page.obj.Resources = res = pikepdf.Dictionary()
    if "/Font" not in res:
        res.Font = pikepdf.Dictionary()
    names = {}
    for n, sub in enumerate(fonts, 1):
        sub.build(pdf)
        name = f"/PMOCR{n}"
        res.Font[name] = sub.font_obj
        names[id(sub)] = name
    ops = [([pikepdf.Name(LAYER_TAG)], pikepdf.Operator("BMC")), ([], pikepdf.Operator("q")),
           ([], pikepdf.Operator("BT")), ([3], pikepdf.Operator("Tr"))]
    for w, sub, glyphs in runs:
        x0, y0, x1, y1 = w["bbox"]
        h = max(y1 - y0, 1.0)
        natural = sum(g.advance for g in glyphs) / 1000.0 * h
        tz = 100.0 * (x1 - x0) / natural if natural > 0 else 100.0
        ops += [
            ([pikepdf.Name(names[id(sub)]), round(h, 2)], pikepdf.Operator("Tf")),
            ([round(tz, 2)], pikepdf.Operator("Tz")),
            ([1, 0, 0, 1, round(x0, 2), round(y0 + 0.2 * h, 2)], pikepdf.Operator("Tm")),
            ([pikepdf.Array([pikepdf.String(b"".join(sub.code(g.gid) for g in glyphs))])], pikepdf.Operator("TJ")),
        ]
    ops += [([], pikepdf.Operator("ET")), ([], pikepdf.Operator("Q")), ([], pikepdf.Operator("EMC"))]
    existing = pikepdf.parse_content_stream(page)
    # wrap the original content so its graphics state cannot leak into the layer
    data = b"q\n" + pikepdf.unparse_content_stream(existing) + b"\nQ\n" + pikepdf.unparse_content_stream(ops)
    page.obj.Contents = pdf.make_stream(data)


def mat_inverse_axis(ctm) -> Optional[tuple]:
    """Axis-aligned image placement (a, d, e, f) or None if rotated/skewed."""
    a, b, c, d, e, f = ctm
    if abs(b) > 1e-6 or abs(c) > 1e-6 or abs(a) < 1e-9 or abs(d) < 1e-9:
        return None
    return a, d, e, f


__all__ = ["OcrUnavailable", "tesseract_path", "run_tesseract", "page_key", "ocr_page_model",
           "add_text_layer", "remove_text_layer", "has_text_layer", "G", "mat_inverse_axis"]
