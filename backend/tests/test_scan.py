"""Scanned-page editing. OCR results are synthesised from a known digital page so the
pipeline is tested without depending on Tesseract being installed."""
import importlib
import io
from pathlib import Path

import numpy as np
import pikepdf
import pytest
from fastapi.testclient import TestClient

from pdfmaster.engine.document import extract_page
from pdfmaster.engine.render import page_text, render_array

FIX = Path(__file__).parent / "fixtures"
DPI = 200


def scanned_pdf(src: bytes) -> bytes:
    """Rasterise page 1 into a JPEG and wrap it in a PDF, like a scanner would."""
    from PIL import Image

    arr = render_array(src, 0, DPI / 72)
    buf = io.BytesIO()
    Image.fromarray(arr).convert("L").save(buf, "JPEG", quality=90)
    pdf = pikepdf.new()
    w, h = (float(v) for v in extract_page(src, 0)["box"][2:])
    img = pikepdf.Stream(pdf, buf.getvalue())
    img.Type, img.Subtype, img.Width, img.Height = pikepdf.Name.XObject, pikepdf.Name.Image, arr.shape[1], arr.shape[0]
    img.ColorSpace, img.BitsPerComponent, img.Filter = pikepdf.Name.DeviceGray, 8, pikepdf.Name.DCTDecode
    content = pdf.make_stream(f"q {w} 0 0 {h} 0 0 cm /Im0 Do Q".encode())
    page = pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=[0, 0, w, h], Contents=content,
                              Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=pdf.make_indirect(img))))
    pdf.pages.append(pikepdf.Page(page))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def synthetic_ocr(src: bytes) -> dict:
    """Word boxes = ink extents of each word of the digital original (what Tesseract reports)."""
    model = extract_page(src, 0)
    H = model["box"][3]
    arr = render_array(src, 0, DPI / 72).mean(axis=2)
    z = DPI / 72
    words = []
    for line in model["lines"]:
        t, i = line["text"], 0
        while i < len(t):
            while i < len(t) and t[i].isspace():
                i += 1
            s = i
            while i < len(t) and not t[i].isspace():
                i += 1
            ids = [g for g in line["map"][s:i] if g >= 0]
            if not ids:
                continue
            bb = [model["glyphs"][g]["b"] for g in ids]
            x0, y0, x1, y1 = min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb)
            c0, r0, c1, r1 = int(x0 * z), int((H - y1) * z), int(x1 * z) + 1, int((H - y0) * z) + 1
            ink = arr[r0:r1, c0:c1] < 128
            rows, cols = np.nonzero(ink.any(axis=1))[0], np.nonzero(ink.any(axis=0))[0]
            if not len(rows):
                continue
            ir0, ir1, ic0, ic1 = r0 + rows[0], r0 + rows[-1] + 1, c0 + cols[0], c0 + cols[-1] + 1
            words.append({"text": t[s:i], "conf": 96.0, "line": line["id"], "color": "#000000",
                          "bbox": [ic0 / z, H - ir1 / z, ic1 / z, H - ir0 / z]})
    from pdfmaster.engine.ocr import OCR_VERSION

    return {"v": OCR_VERSION, "langs": "eng", "dpi": DPI, "words": words}


@pytest.fixture()
def scanned_doc(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    client = TestClient(api.app)
    src = (FIX / "base14.pdf").read_bytes()
    data = scanned_pdf(src)
    r = client.post("/api/v1/documents", files={"file": ("scan.pdf", data, "application/pdf")})
    did = r.json()["data"]["id"]
    api.service.save_ocr(did, data, 1, synthetic_ocr(src))
    return client, api.service, did


def word_ids(model, *texts):
    return [g["i"] for g in model["glyphs"] if g["c"] in texts]


def test_scanned_page_uses_ocr_words(scanned_doc):
    client, _, did = scanned_doc
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    assert m["type"] == "scanned" and m["source"] == "ocr"
    assert any(l["text"] == "Customer Name: Ashish Tripathi" for l in m["lines"])


def test_edit_scanned_word_patches_only_that_area(scanned_doc):
    client, service, did = scanned_doc
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    ids = word_ids(m, "25,000")
    r = client.post(f"/api/v1/documents/{did}/edit/replace-text",
                    json={"page": 1, "edits": [{"glyphs": ids, "text": "35,000"}]}).json()
    assert r["success"], r
    rep = r["data"]["reports"][0]
    assert rep["strategy"] == "scan-patch" and rep["fits"]
    before, after = service.data(did, 0), service.data(did)
    # original scan image is untouched; one small patch image was added
    with pikepdf.open(io.BytesIO(after)) as pdf:
        xs = pdf.pages[0].Resources.XObject
        patches = [k for k in xs.keys() if k.startswith("/PMI")]
        assert len(patches) == 1
        assert xs[patches[0]].Width < 300
    with pikepdf.open(io.BytesIO(before)) as a, pikepdf.open(io.BytesIO(after)) as b:
        assert a.pages[0].Resources.XObject.Im0.read_raw_bytes() == b.pages[0].Resources.XObject.Im0.read_raw_bytes()
    # pixels changed only around the word
    za, zb = render_array(before, 0, 1.0), render_array(after, 0, 1.0)
    changed = np.abs(za.astype(int) - zb.astype(int)).max(axis=2) > 40
    ys, xs_ = np.nonzero(changed)
    word = next(g for g in m["glyphs"] if g["c"] == "25,000")["b"]
    H = m["box"][3]
    assert xs_.min() >= word[0] - 6 and xs_.max() <= word[2] + 12
    assert ys.min() >= H - word[3] - 6 and ys.max() <= H - word[1] + 6
    # the OCR model follows the edit
    m2 = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    assert any("35,000" in l["text"] for l in m2["lines"])


def test_repeated_edit_of_same_word_leaves_no_remnant(scanned_doc):
    client, service, did = scanned_doc
    for new in ("1,25,000", "9"):
        m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
        line = next(l for l in m["lines"] if l["text"].startswith("Transaction"))
        ids = [line["map"][-1]]
        r = client.post(f"/api/v1/documents/{did}/edit/replace-text", json={"page": 1, "edits": [{"glyphs": ids, "text": new}]})
        assert r.status_code == 200, r.text
    with pikepdf.open(io.BytesIO(service.data(did))) as pdf:
        assert len([k for k in pdf.pages[0].Resources.XObject.keys() if k.startswith("/PMI")]) >= 1
        drawn = [i for i in pikepdf.parse_content_stream(pdf.pages[0]) if str(i.operator) == "Do"]
        assert len(drawn) == 2  # the scan + one merged patch
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    assert any(l["text"] == "Transaction Amount: 9" for l in m["lines"])


def test_edits_stay_on_top_after_objects_are_renumbered():
    """Saving renumbers objects; later edits must still find (and replace) the earlier patches of the scan,
    or an old patch drawn above would hide the new text."""
    from pdfmaster.engine.scanedit import edit_scan

    src = (FIX / "base14.pdf").read_bytes()
    data, ocr = scanned_pdf(src), synthetic_ocr(src)
    line = next(w["line"] for w in ocr["words"] if w["text"] == "Transaction")
    for k in range(3):
        idx = [i for i, w in enumerate(ocr["words"]) if w["line"] == line]
        r = edit_scan(data, 0, ocr, [idx[-1]], f"{k + 1}000")
        with pikepdf.open(io.BytesIO(r.data)) as pdf:  # shift every object number, like a real re-save can
            pdf.Root.Pad = pdf.make_indirect(pikepdf.Dictionary(N=k))
            pdf.Root.Pad2 = pdf.make_indirect(pikepdf.Array([1, 2, 3]))
            out = io.BytesIO()
            pdf.save(out)
        data, ocr = out.getvalue(), r.ocr
    with pikepdf.open(io.BytesIO(data)) as pdf:
        drawn = [str(i.operands[0]) for i in pikepdf.parse_content_stream(pdf.pages[0]) if str(i.operator) == "Do"]
    assert drawn[0] == "/Im0" and len(drawn) == 2, drawn  # the scan + one merged patch, nothing older above it
    assert any(w["text"] == "3000" and w.get("edited") for w in ocr["words"])


def test_scanned_find_replace_and_searchable_layer(scanned_doc):
    client, service, did = scanned_doc
    hits = client.post(f"/api/v1/documents/{did}/find", json={"query": "Ashish"}).json()["data"]
    assert len(hits) == 1 and hits[0]["scanned"]
    r = client.post(f"/api/v1/documents/{did}/edit/find-replace", json={"query": "Ashish", "replacement": "Rahul"}).json()["data"]
    assert r["replaced"] == 1
    r = client.post(f"/api/v1/documents/{did}/ocr/text-layer", json={}).json()
    assert r["success"], r
    text = page_text(service.data(did), 0)
    assert "Rahul" in text and "Ashish" not in text  # invisible layer reflects the edit
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    assert m["source"] == "ocr"  # still edited as a scan, not via the invisible layer
    # editing after the layer exists keeps the layer in sync
    ids = word_ids(m, "25,000")
    client.post(f"/api/v1/documents/{did}/edit/replace-text", json={"page": 1, "edits": [{"glyphs": ids, "text": "77,000"}]})
    assert "77,000" in page_text(service.data(did), 0)


def test_hindi_on_scanned_page(scanned_doc):
    from pdfmaster.engine.sysfonts import coverage_fonts

    if not coverage_fonts(False, False):
        pytest.skip("no Indic font")
    client, _, did = scanned_doc
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    r = client.post(f"/api/v1/documents/{did}/edit/replace-text",
                    json={"page": 1, "edits": [{"glyphs": word_ids(m, "Tripathi"), "text": "त्रिपाठी"}]})
    assert r.status_code == 200, r.text


def test_ocr_reports_missing_engine(scanned_doc, monkeypatch):
    client, _, did = scanned_doc
    import pdfmaster.engine.ocr as ocr

    monkeypatch.setattr(ocr, "tesseract_path", lambda: None)
    r = client.post(f"/api/v1/documents/{did}/ocr", json={})
    assert r.status_code == 503 and r.json()["ocrUnavailable"]


def test_small_text_is_rasterized_from_outlines_not_1bit_strikes():
    # Calibri / Arial carry 1-bit bitmap strikes at small sizes; reading one as 8-bit gray turned digits into thin bars
    from pdfmaster.engine.scanedit import pick_font, rasterize

    r = rasterize("1999", pick_font("1999", "sans", True, False), 16.7)
    a = r.alpha[r.ink[0]:r.ink[2], r.ink[1]:r.ink[3]]
    assert a.sum() > 100  # four bold digits ~11 px tall; the broken read gave about 27


def test_erase_keeps_a_band_edge_that_runs_behind_the_word():
    # a word sitting on the bottom edge of a grey table stripe: the fill must not smear grey into the cream below
    import numpy as np

    from pdfmaster.engine.scanedit import inpaint

    arr = np.zeros((30, 60, 3), np.float32)
    arr[:15] = 210
    arr[15:] = 252
    mask = np.zeros((30, 60), bool)
    mask[8:22, 15:45] = True
    out = inpaint(arr, mask)
    assert np.abs(out - arr).max() < 3


def _form_pdf() -> bytes:
    """A two-column form in Times: labels on the left, values far to the right on the same baselines."""
    import io as _io

    rows = [("Name :", "SHIVANGI TRIPATHI"), ("Father's Name :", "RAKESH TRIPATHI"), ("Gender :", "Female"),
            ("Marital Status :", "Unmarried"), ("Category :", "General"), ("Nationality :", "Indian"),
            ("State of Birth :", "UTTAR PRADESH"), ("Identification Mark :", "Mole on left hand")]
    ops = []
    for i, (label, value) in enumerate(rows):
        y = 760 - i * 28
        ops.append(f"BT /F1 11 Tf 60 {y} Td ({label.replace(chr(39), chr(92) + chr(39))}) Tj ET")
        ops.append(f"BT /F1 11 Tf 380 {y} Td ({value}) Tj ET")
    pdf = pikepdf.new()
    font = pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name("/Times-Roman"))
    page = pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=[0, 0, 595, 842],
                              Contents=pdf.make_stream("\n".join(ops).encode()),
                              Resources=pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font)))
    pdf.pages.append(pikepdf.Page(page))
    out = _io.BytesIO()
    pdf.save(out)
    return out.getvalue()


def test_form_value_far_from_its_label_is_matched_to_the_serif_typeface():
    """OCR lines cross the gap between a label and its value. Measured as one piece, the wide gap made
    the widest typeface (Courier New) win and the page looked lighter, so edits also came out bold."""
    from pdfmaster.engine import scanedit

    src = _form_pdf()
    data, ocr = scanned_pdf(src), synthetic_ocr(src)
    for w in ocr["words"]:  # Tesseract puts a label and its value on one line, across the gap
        w["line"] = round(w["bbox"][1] / 10)
    scanedit._PAGE_RANKS.clear()
    idx = next(i for i, w in enumerate(ocr["words"]) if w["text"] == "Female")
    rep = scanedit.edit_scan(data, 0, ocr, [idx], "Male").report
    assert "Courier" not in rep["font"] and "Bold" not in rep["font"], rep["font"]
    assert any(n in rep["font"] for n in ("Times", "Liberation Serif", "Tinos")), rep["font"]


def test_shorter_word_pulls_the_whole_rest_of_the_line_left():
    """SHIVANGI -> OM pulls TRIPATHI left. The patch only covered where TRIPATHI went, so its right
    end was cut off the moved copy and the old letters stayed behind ('OM TRIPA   THI')."""
    from pdfmaster.engine import scanedit

    src = _form_pdf()
    data, ocr = scanned_pdf(src), synthetic_ocr(src)
    scanedit._PAGE_RANKS.clear()
    ws = ocr["words"]
    i = next(i for i, w in enumerate(ws) if w["text"] == "SHIVANGI")
    trip = ws[i + 1]
    assert trip["text"] == "TRIPATHI"
    out = scanedit.edit_scan(data, 0, ocr, [i], "OM").data
    z, H = DPI / 72, 842
    r0, r1 = int((H - trip["bbox"][3]) * z) - 2, int((H - trip["bbox"][1]) * z) + 3

    def band(pdf):
        return render_array(pdf, 0, z).mean(axis=2)[r0:r1] < 110
    before, after = band(data), band(out)
    c0, c1 = int(trip["bbox"][0] * z), int(trip["bbox"][2] * z) + 2
    cols = np.nonzero(after.any(axis=0))[0]
    assert cols[-1] < c1 - 0.4 * (c1 - c0), "TRIPATHI was not pulled left (or its old end stayed behind)"
    moved = after[:, cols[-1] - (c1 - c0) + 1:cols[-1] + 1].sum()
    assert moved >= 0.85 * before[:, c0:c1].sum(), "the moved TRIPATHI lost letters"


# ---------------------------------------------------------------- invitation cards: script names, small capitals
def _card(rows, size=(1100, 520)):
    """A picture of a card as a one-page PDF (1 px = 1 pt) and its OCR words.
    rows: (font file, px, y, [(text as drawn, text as OCR reads it, confidence)]) per centred line."""
    from PIL import Image, ImageDraw, ImageFont

    from pdfmaster.engine.ocr import OCR_VERSION
    from pdfmaster.engine.sysfonts import BUNDLED_FONTS

    W, H = size
    im = Image.new("RGB", size, (228, 238, 244))
    d = ImageDraw.Draw(im)
    words = []
    for li, (file, px, y, parts) in enumerate(rows):
        font = ImageFont.truetype(str(BUNDLED_FONTS / file), px)
        x = (W - d.textlength(" ".join(t for t, _o, _c in parts), font=font)) / 2
        for drawn, read, conf in parts:
            d.text((x, y), drawn, font=font, fill=(70, 80, 66))
            l, t, r, b = d.textbbox((x, y), drawn, font=font)
            words.append({"text": read, "conf": conf, "line": li, "color": "#465042", "bbox": [l, H - b, r, H - t]})
            x += d.textlength(drawn + " ", font=font)
    pdf = pikepdf.new()
    img = pikepdf.Stream(pdf, im.tobytes())
    img.Type, img.Subtype, img.Width, img.Height = pikepdf.Name.XObject, pikepdf.Name.Image, W, H
    img.ColorSpace, img.BitsPerComponent = pikepdf.Name.DeviceRGB, 8
    content = pdf.make_stream(f"q {W} 0 0 {H} 0 0 cm /Im0 Do Q".encode())
    pdf.pages.append(pikepdf.Page(pikepdf.Dictionary(
        Type=pikepdf.Name.Page, MediaBox=[0, 0, W, H], Contents=content,
        Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=pdf.make_indirect(img))))))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue(), {"v": OCR_VERSION, "langs": "eng", "dpi": 72, "words": words}


_CARD = [
    ("Cinzel.ttf", 30, 40, [("Celebrations", "CELEBRATIONS", 96.0), ("of", "OF", 96.0)]),
    ("GreatVibes-Regular.ttf", 120, 110, [("Bikash", "CBikash", 37.0)]),  # OCR misreads the flourish
    ("Cinzel.ttf", 30, 300, [("Lt.", "LT.", 95.0), ("Shobhavati", "SHOBHAVATI", 92.0), ("Devi", "DEVI", 90.0),
                              ("Dayal", "DAYAL", 95.0), ("Agarwal", "AGARWAL", 96.0)]),
]


def test_cursive_name_is_redrawn_in_a_script_typeface_and_stays_centred():
    """The name on an invitation ("Bikash" in joined-up script) came back as plain Trebuchet, at the left edge."""
    from pdfmaster.engine import scanedit

    data, ocr = _card(_CARD)
    i = next(i for i, w in enumerate(ocr["words"]) if w["text"] == "CBikash")
    old = ocr["words"][i]["bbox"]
    res = scanedit.edit_scan(data, 0, ocr, [i], "Ashish")
    assert any(n in res.report["font"] for n in scanedit._SCRIPT), res.report["font"]
    assert res.report["anchor"] == "center"
    new = res.ocr["words"][-1]["bbox"]
    assert abs((new[0] + new[2]) / 2 - (old[0] + old[2]) / 2) < 12
    assert "Ashish" != "CBikash" and res.ocr["words"][-1]["text"] == "Ashish"


def test_printed_words_are_not_taken_for_script():
    from pdfmaster.engine import scanedit as se

    for name in ("Arial", "Times New Roman"):
        for italic in (False, True):
            f, _q = se._style(name, False, italic)
            if f is None or f.italic != italic:
                continue
            for text in ("Female", "Category", "Nationality", "Wavy", "yummy", "Kumar"):
                assert not se.looks_cursive(se._scan_like(se.rasterize(text, f, 60.0).alpha), text), (f.label, text)


def test_small_capitals_keep_a_tall_first_letter_and_their_typeface():
    """"Lt. Shobhavati Devi" in small capitals: OCR reads SHOBHAVATI, and the replacement came out all in
    small letters, in another typeface, touching the next word."""
    from pdfmaster.engine import scanedit

    data, ocr = _card(_CARD)
    scanedit._PAGE_RANKS.clear()
    i = next(i for i, w in enumerate(ocr["words"]) if w["text"] == "SHOBHAVATI")
    devi = ocr["words"][i + 1]
    res = scanedit.edit_scan(data, 0, ocr, [i], "Rameshwari")
    assert "Cinzel" in res.report["font"], res.report["font"]
    new = res.ocr["words"][-1]["bbox"]
    arr = render_array(res.data, 0, 1.0).astype(np.float32)
    H = arr.shape[0]
    crop = arr[int(H - new[3]) - 1:int(H - new[1]) + 2, int(new[0]) - 1:int(new[2]) + 2]
    ink = scanedit._ink_bool(crop)
    ink = ink[np.flatnonzero(ink.any(axis=1))[0]:, np.flatnonzero(ink.any(axis=0))[0]:]
    tall = np.flatnonzero(ink[:max(int(0.1 * ink.shape[0]), 1)].any(axis=0))  # only the R reaches the top
    assert len(tall) and tall[-1] < 0.15 * ink.shape[1], tall
    moved = next(w for w in res.ocr["words"] if w["text"] == "DEVI")
    gap_before, gap_after = devi["bbox"][0] - ocr["words"][i]["bbox"][2], moved["bbox"][0] - new[2]
    assert gap_after > 0.5 * gap_before, (gap_before, gap_after)


def test_word_the_ocr_missed_can_be_marked_by_hand_and_edited():
    from pdfmaster.engine import ocr as ocr_engine, scanedit

    data, ocr = _card(_CARD)
    i = next(i for i, w in enumerate(ocr["words"]) if w["text"] == "CBikash")
    true = ocr["words"].pop(i)["bbox"]  # as if the OCR never saw the name
    loose = [true[0] - 25, true[1] - 12, true[2] + 30, true[3] + 10]
    marked = ocr_engine.mark_word(data, 0, ocr, loose, "Bikash")
    w = marked["words"][-1]
    assert w["manual"] and w["text"] == "Bikash" and w["line"] not in {o["line"] for o in ocr["words"]}
    assert all(abs(a - b) <= 4 for a, b in zip(w["bbox"], true)), (w["bbox"], true)
    res = scanedit.edit_scan(data, 0, marked, [len(marked["words"]) - 1], "Ashish")
    assert any(n in res.report["font"] for n in scanedit._SCRIPT), res.report["font"]
    # a box dragged too low catches the top of the line below: the word is still measured on its own
    below = next(o for o in ocr["words"] if o["text"] == "SHOBHAVATI")["bbox"]
    sloppy = [true[0] - 25, below[3] - 6, true[2] + 30, true[3] + 10]
    w2 = ocr_engine.mark_word(data, 0, ocr, sloppy, "Bikash")["words"][-1]
    assert all(abs(a - b) <= 4 for a, b in zip(w2["bbox"], true)), (w2["bbox"], true)
    with pytest.raises(ValueError):
        ocr_engine.mark_word(data, 0, ocr, [20, 20, 80, 60], "x")  # empty background


def test_mark_word_endpoint(scanned_doc):
    client, _service, did = scanned_doc
    m = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    g = next(g for g in m["glyphs"] if g["c"] == "25,000")
    b = g["b"]
    r = client.post(f"/api/v1/documents/{did}/pages/1/ocr/words",
                    json={"bbox": [b[0] - 3, b[1] - 3, b[2] + 3, b[3] + 3], "text": "25,000"})
    assert r.status_code == 200, r.text
    out = r.json()["data"]
    assert len(out["glyphs"]) == len(m["glyphs"]) + 1 and out["glyphs"][-1]["c"] == "25,000"
    r = client.post(f"/api/v1/documents/{did}/pages/1/ocr/words", json={"bbox": [1, 1, 30, 12], "text": "x"})
    assert r.status_code == 422 and "No text found" in r.json()["message"]
