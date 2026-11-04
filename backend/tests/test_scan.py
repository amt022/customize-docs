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
    return {"v": 2, "langs": "eng", "dpi": DPI, "words": words}


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
