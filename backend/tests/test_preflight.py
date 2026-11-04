"""Document check: each category finds what it should, and a clean file stays clean."""
import io
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image, ImageDraw, ImageFont

from pdfmaster.engine.document import apply_edits, find_matches
from pdfmaster.engine.editor import Edit
from pdfmaster.engine.preflight import Findings, _analyse_scan_image, check_document

FIX = Path(__file__).parent / "fixtures"


def titles(result, severity=None):
    return {i["title"] for i in result["issues"] if severity is None or i["severity"] == severity}


def make_pdf(content: str, annots=None) -> bytes:
    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1,
                                                BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding))
    page = pdf.add_blank_page(page_size=(612, 792))
    page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
    page.Contents = pdf.make_stream(content.encode())
    if annots:
        page.Annots = pdf.make_indirect(pikepdf.Array([pdf.make_indirect(a) for a in annots]))
    pdf.docinfo["/Title"] = "Test"
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def test_clean_document_has_no_errors_or_warnings():
    data = (FIX / "base14.pdf").read_bytes()
    r = check_document(data, data)
    assert r["summary"]["error"] == 0 and r["summary"]["warning"] == 0, r["issues"]


def test_layout_problems_are_found():
    data = make_pdf(
        "BT /F1 12 Tf 1 0 0 1 580 700 Tm (Runs off the edge) Tj ET "          # crosses the right edge
        "BT /F1 12 Tf 1 0 0 1 700 600 Tm (Entirely outside) Tj ET "           # off the page
        "q 100 490 40 30 re W n BT /F1 12 Tf 1 0 0 1 100 500 Tm (Clipped text here) Tj ET Q "
        "BT /F1 12 Tf 1 0 0 1 100 400 Tm (Overlapping) Tj ET "
        "BT /F1 12 Tf 1 0 0 1 102 400.5 Tm (Text on top) Tj ET"
    )
    t = titles(check_document(data))
    assert {"Text cut off at the page edge", "Text outside the page", "Text clipped by its container", "Overlapping text"} <= t


def test_broken_links_and_fields_are_found():
    annots = [
        pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[100, 100, 200, 120]),
        pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[100, 130, 200, 150],
                           A=pikepdf.Dictionary(S=pikepdf.Name.URI, URI="www.example.com")),
        pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Link, Rect=[100, 160, 200, 180],
                           Dest=pikepdf.String("nowhere")),
        pikepdf.Dictionary(Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Widget, Rect=[100, 200, 200, 220], FT=pikepdf.Name.Tx),
    ]
    t = titles(check_document(make_pdf("BT /F1 12 Tf 100 700 Td (Hi) Tj ET", annots)))
    assert {"Link goes nowhere", "Web link is malformed", "Broken internal link", "Form field has no appearance",
            "Form field has no name"} <= t


def test_unembedded_and_garbled_fonts_are_found():
    # a TrueType font that is neither embedded nor standard, drawing codes without any Unicode meaning
    data = make_pdf("BT /F2 12 Tf 100 700 Td <0102030405060708> Tj ET")
    pdf = pikepdf.open(io.BytesIO(data))
    pdf.pages[0].Resources.Font.F2 = pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Font, Subtype=pikepdf.Name.TrueType, BaseFont=pikepdf.Name("/FancyCorpSans"),
        FirstChar=0, LastChar=255, Widths=[500] * 256,
        FontDescriptor=pikepdf.Dictionary(Type=pikepdf.Name.FontDescriptor, FontName=pikepdf.Name("/FancyCorpSans"), Flags=4,
                                          FontBBox=[0, -200, 1000, 900], ItalicAngle=0, Ascent=800, Descent=-200,
                                          CapHeight=700, StemV=80)))
    buf = io.BytesIO()
    pdf.save(buf)
    t = titles(check_document(buf.getvalue()))
    assert "Font 'FancyCorpSans' is not embedded" in t
    assert "Text in font 'FancyCorpSans' cannot be copied or searched correctly" in t


def test_bad_edit_is_reported_and_auto_edit_is_not():
    data = (FIX / "base14.pdf").read_bytes()
    m = find_matches(data, "Name:", match_case=True)  # mid-line: the customer's name follows
    page, hit = next((p, h[0]) for p, h in m.items() if h)
    long_text = "Name of the account holder:"
    forced = apply_edits(data, page, [Edit(hit["glyphs"], long_text, "left", "none")])
    assert not forced.verification["layoutPreserved"]
    hist = [{"page": page + 1, "summary": "x", "report": {"reports": forced.reports, "verification": forced.verification}}]
    t = titles(check_document(forced.data, data, history=hist))
    assert "Edited text overlaps neighbouring content" in t

    auto = apply_edits(data, page, [Edit(hit["glyphs"], long_text, "auto", "auto")])
    assert auto.verification["overlapping"] == 0 and auto.verification["offPage"] == 0


def _scan_image() -> Image.Image:
    img = Image.new("L", (1240, 1754), 255)
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 36)
    except OSError:
        font = ImageFont.load_default()
    for k in range(25):
        d.text((120, 120 + k * 60), f"Line {k}: The quick brown fox jumps over the lazy dog 0123", fill=0, font=font)
    return img


def scan_titles(img):
    f = Findings()
    _analyse_scan_image(img, 1, f)
    return {i["title"] for i in f.items}


def test_scan_quality_checks():
    img = _scan_image()
    assert scan_titles(img) == set()
    assert "Page is skewed" in scan_titles(img.rotate(3, fillcolor=255, resample=Image.BICUBIC))
    assert "Scan is too dark" in scan_titles(img.point(lambda v: v * 0.5))
    assert "Faded text" in scan_titles(img.point(lambda v: 150 + v * 0.4))
    noisy = np.asarray(img).copy()
    noisy[np.random.default_rng(0).random(noisy.shape) < 0.004] = 20
    assert "Background noise or specks" in scan_titles(Image.fromarray(noisy))


def test_check_endpoint(tmp_path, monkeypatch):
    import importlib

    from fastapi.testclient import TestClient

    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    client = TestClient(api.app)
    doc = client.post("/api/v1/documents", files={"file": ("a.pdf", (FIX / "base14.pdf").read_bytes(), "application/pdf")}).json()["data"]
    r = client.get(f"/api/v1/documents/{doc['id']}/check")
    assert r.status_code == 200
    body = r.json()["data"]
    assert body["version"] == 0 and set(body["summary"]) == {"error", "warning", "info"}
