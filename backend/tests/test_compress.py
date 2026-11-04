"""Download compression: smaller files, identical pages for lossless, nothing broken."""
import io
import zlib
from pathlib import Path

import numpy as np
import pikepdf
from PIL import Image

from pdfmaster.engine.compress import compress
from pdfmaster.engine.document import apply_edits, extract_page, find_matches
from pdfmaster.engine.editor import Edit
from pdfmaster.engine.render import render_array

FIX = Path(__file__).parent / "fixtures"
_open: list = []  # keep opened PDFs alive while their objects are inspected


def xobjects(data: bytes):
    pdf = pikepdf.open(io.BytesIO(data))
    _open.append(pdf)
    return pdf.pages[0].Resources.XObject


def pixels_equal(a: bytes, b: bytes) -> bool:
    n = len(pikepdf.open(io.BytesIO(a)).pages)
    return all(np.array_equal(render_array(a, i, 1.0), render_array(b, i, 1.0)) for i in range(n))


def photo_pdf(copies: int = 2) -> bytes:
    """A 1200x900 px noisy photo placed 3 inches wide (400 dpi), embedded `copies` times
    uncompressed-ish (Flate), as an editor that never deduplicates would write it."""
    rng = np.random.default_rng(0)
    yy, xx = np.mgrid[0:900, 0:1200]
    img = np.stack([(xx / 5) % 255, (yy / 4) % 255, ((xx + yy) / 7) % 255], axis=2)
    img = (img + rng.normal(0, 18, img.shape)).clip(0, 255).astype(np.uint8)
    pdf = pikepdf.new()
    names = {}
    ops = []
    for k in range(copies):
        xo = pdf.make_stream(zlib.compress(img.tobytes(), 6), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
                             Width=1200, Height=900, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8,
                             Filter=pikepdf.Name.FlateDecode)
        names[f"/Im{k}"] = xo
        ops.append(f"q 216 0 0 162 72 {500 - 200 * k} cm /Im{k} Do Q")
    page = pdf.add_blank_page(page_size=(612, 792))
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(names))
    page.Contents = pdf.make_stream(" ".join(ops).encode())
    buf = io.BytesIO()
    pdf.save(buf, compress_streams=False)
    return buf.getvalue()


def test_lossless_keeps_pages_and_text_identical():
    data = (FIX / "browser.pdf").read_bytes()
    r = compress(data, "lossless")
    assert r.size <= len(data)
    assert pixels_equal(data, r.data)
    assert [l["text"] for l in extract_page(data, 0)["lines"]] == [l["text"] for l in extract_page(r.data, 0)["lines"]]


def test_duplicate_images_are_stored_once():
    data = photo_pdf(copies=2)
    r = compress(data, "lossless")
    xobjs = xobjects(r.data)
    assert xobjs.Im0.objgen == xobjs.Im1.objgen  # both names now point at one stored image
    assert r.size < len(data) * 0.6
    assert pixels_equal(data, r.data)


def test_balanced_downsamples_photos_and_strong_is_smaller_still():
    data = photo_pdf(copies=1)
    lossless, balanced, strong = (compress(data, lvl) for lvl in ("lossless", "balanced", "strong"))
    assert balanced.images_recompressed == 1 and strong.images_recompressed == 1
    assert strong.size < balanced.size < lossless.size
    im = xobjects(balanced.data).Im0
    assert int(im.Width) == 450  # 3 inches at 150 dpi
    # still the same picture: small average difference after JPEG + downsampling
    a, b = render_array(data, 0, 0.5).astype(int), render_array(balanced.data, 0, 0.5).astype(int)
    assert np.abs(a - b).mean() < 12


def test_line_art_is_never_turned_into_jpeg():
    img = Image.new("RGB", (1200, 900), "white")
    for x in range(0, 1200, 40):
        img.paste((20, 60, 200), (x, 0, x + 4, 900))
    pdf = pikepdf.new()
    xo = pdf.make_stream(zlib.compress(img.tobytes()), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image, Width=1200,
                         Height=900, ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8, Filter=pikepdf.Name.FlateDecode)
    page = pdf.add_blank_page(page_size=(612, 792))
    page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im0=xo))
    page.Contents = pdf.make_stream(b"q 216 0 0 162 72 500 cm /Im0 Do Q")
    buf = io.BytesIO()
    pdf.save(buf)
    r = compress(buf.getvalue(), "strong")
    assert xobjects(r.data).Im0.get("/Filter") != "/DCTDecode"


def test_replacement_font_subsets_from_several_edits_are_merged():
    data = (FIX / "subset.pdf").read_bytes()
    for old, new in [("Ashish", "Zygmunt"), ("November", "Quxwell")]:
        m = find_matches(data, old, match_case=True)
        page, hit = next((p, h[0]) for p, h in m.items() if h)
        data = apply_edits(data, page, [Edit(hit["glyphs"], new, "auto", "auto")]).data

    def font_files(d):
        pdf = pikepdf.open(io.BytesIO(d))
        out = set()
        for f in pdf.pages[0].Resources.Font.values():
            if str(f.get("/BaseFont", "")).startswith("/PMSUBS+"):
                out.add(f.DescendantFonts[0].FontDescriptor.FontFile2.objgen)
        return out

    if len(font_files(data)) < 2:
        import pytest
        pytest.skip("the edits did not need two separate substitute subsets on this system")
    r = compress(data, "lossless")
    assert len(font_files(r.data)) == 1
    assert pixels_equal(data, r.data)
    text = " ".join(l["text"] for l in extract_page(r.data, 0)["lines"])
    assert "Zygmunt" in text and "Quxwell" in text


def test_export_compresses_then_protects(tmp_path, monkeypatch):
    import importlib

    from fastapi.testclient import TestClient

    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    client = TestClient(api.app)
    doc = client.post("/api/v1/documents", files={"file": ("p.pdf", photo_pdf(2), "application/pdf")}).json()["data"]
    sizes = client.get(f"/api/v1/documents/{doc['id']}/compression").json()["data"]
    assert sizes["strong"]["size"] < sizes["balanced"]["size"] < sizes["lossless"]["size"] < sizes["none"]["size"]
    r = client.post(f"/api/v1/documents/{doc['id']}/export",
                    json={"userPassword": "pw123", "ownerPassword": "", "compression": "balanced"})
    assert r.status_code == 200
    assert int(r.headers["x-compressed-size"]) < int(r.headers["x-original-size"])
    with pikepdf.open(io.BytesIO(r.content), password="pw123") as pdf:
        assert pdf.is_encrypted and len(pdf.pages) == 1


def test_type1_fonts_become_compact_cff_with_identical_pages():
    data = (FIX / "type1.pdf").read_bytes()
    r = compress(data, "lossless")
    assert r.size < len(data) * 0.6
    assert pixels_equal(data, r.data)
    assert [l["text"] for l in extract_page(data, 0)["lines"]] == [l["text"] for l in extract_page(r.data, 0)["lines"]]
    fonts = xobjects_fonts(r.data)
    assert all("/FontFile3" in d and "/FontFile" not in d for d in fonts)
    assert all(d.FontFile3.Subtype == "/Type1C" for d in fonts)
    # converted fonts can still be edited with
    m = find_matches(r.data, "quick", match_case=True)
    page, hit = next((p, h[0]) for p, h in m.items() if h)
    res = apply_edits(r.data, page, [Edit(hit["glyphs"], "quiet", "auto", "auto")])
    assert res.verification["layoutPreserved"] and "quiet brown" in " ".join(l["text"] for l in extract_page(res.data, 0)["lines"])


def xobjects_fonts(data: bytes) -> list:
    pdf = pikepdf.open(io.BytesIO(data))
    _open.append(pdf)
    return [f.FontDescriptor for f in pdf.pages[0].Resources.Font.values()]


def test_levels_differ_on_text_only_pdf():
    """A text-only PDF (no images) must still get smaller at each stronger level."""
    data = (FIX / "browser.pdf").read_bytes()
    lossless, balanced, strong = (compress(data, lvl) for lvl in ("lossless", "balanced", "strong"))
    assert pixels_equal(data, lossless.data)
    assert balanced.size < lossless.size * 0.8  # font hinting removed
    assert strong.size <= balanced.size
    # hinting only nudges antialiasing: nothing moves, text is unchanged
    a, b = render_array(data, 0, 1.0).astype(int), render_array(balanced.data, 0, 1.0).astype(int)
    assert (np.abs(a - b).max(axis=2) > 0).mean() < 0.03
    assert [l["text"] for l in extract_page(data, 0)["lines"]] == [l["text"] for l in extract_page(balanced.data, 0)["lines"]]
    # glyph outlines are untouched, so the edited download can still be edited
    m = find_matches(balanced.data, "Lucknow", match_case=True)
    page, hit = next((p, h[0]) for p, h in m.items() if h)
    assert apply_edits(balanced.data, page, [Edit(hit["glyphs"], "Kanpur", "auto", "auto")]).verification["newTextVerified"]


def test_smallest_removes_tags_and_metadata_only_there():
    data = (FIX / "browser.pdf").read_bytes()
    def root_keys(d: bytes) -> set:
        with pikepdf.open(io.BytesIO(d)) as pdf:
            return {str(k) for k in pdf.Root.keys()}

    assert "/StructTreeRoot" in root_keys(data)
    assert "/StructTreeRoot" in root_keys(compress(data, "balanced").data)
    keys = root_keys(compress(data, "strong").data)
    assert "/StructTreeRoot" not in keys and "/Metadata" not in keys
