import base64
import importlib
import io
from pathlib import Path

import numpy as np
import pikepdf
import pytest
from fastapi.testclient import TestClient

from pdfmaster.engine.render import page_text, render_array

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture()
def doc(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    c = TestClient(api.app)
    r = c.post("/api/v1/documents", files={"file": ("b.pdf", (FIX / "browser.pdf").read_bytes(), "application/pdf")})
    return c, api.service, r.json()["data"]["id"]


def png_signature() -> str:
    from PIL import Image, ImageDraw

    im = Image.new("RGBA", (300, 100), (0, 0, 0, 0))
    ImageDraw.Draw(im).line([(10, 80), (80, 20), (150, 70), (290, 30)], fill=(10, 30, 120, 255), width=6)
    buf = io.BytesIO()
    im.save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def test_all_annotation_types_render_and_list(doc):
    c, service, did = doc
    base = f"/api/v1/documents/{did}"
    m = c.get(f"{base}/pages/1/text").json()["data"]
    line = next(l for l in m["lines"] if l["text"].startswith("Billed"))
    glyphs = [i for i in line["map"] if i >= 0][:10]
    specs = [
        {"type": "highlight", "glyphs": glyphs},
        {"type": "underline", "glyphs": glyphs},
        {"type": "strikeout", "glyphs": glyphs, "color": "#0000ff"},
        {"type": "note", "x": 400, "y": 700, "text": "Check this amount"},
        {"type": "rect", "rect": [50, 400, 200, 450], "color": "#1f8a4c"},
        {"type": "ellipse", "rect": [220, 400, 320, 450]},
        {"type": "ink", "paths": [[[60, 300], [90, 330], [120, 300], [150, 330]]], "width": 3},
        {"type": "signature", "rect": [350, 280, 550, 340], "image": png_signature()},
        {"type": "stamp", "rect": [350, 350, 520, 400], "text": "Approved"},
    ]
    before = render_array(service.data(did), 0, 1.0)
    for s in specs:
        r = c.post(f"{base}/annotations", json={"page": 1, **s})
        assert r.status_code == 200, (s["type"], r.text)
    after = render_array(service.data(did), 0, 1.0)
    assert (np.abs(before.astype(int) - after.astype(int)).max(axis=2) > 40).sum() > 2000
    listed = c.get(f"{base}/pages/1/annotations").json()["data"]
    assert sorted(a["type"] for a in listed) == sorted(
        ["Highlight", "Underline", "StrikeOut", "Text", "Square", "Circle", "Ink", "Stamp", "Stamp"])
    with pikepdf.open(io.BytesIO(service.data(did))) as pdf:
        for a in pdf.pages[0].Annots:
            assert "/AP" in a  # every annotation carries its own appearance
    nm = next(a["id"] for a in listed if a["type"] == "Ink")
    c.delete(f"{base}/pages/1/annotations/{nm}")
    assert len(c.get(f"{base}/pages/1/annotations").json()["data"]) == 8
    c.post(f"{base}/undo")
    assert len(c.get(f"{base}/pages/1/annotations").json()["data"]) == 9
    assert "Ashish Tripathi" in page_text(service.data(did), 0)


def test_watermark_add_and_remove(doc):
    c, service, did = doc
    base = f"/api/v1/documents/{did}"
    r = c.post(f"{base}/watermark", json={"text": "CONFIDENTIAL"})
    assert r.status_code == 200, r.text
    assert "CONFIDENTIAL" in page_text(service.data(did), 0)
    c.post(f"{base}/watermark", json={"remove": True})
    assert "CONFIDENTIAL" not in page_text(service.data(did), 0)
    assert "Tax Invoice" in page_text(service.data(did), 0)


def test_bad_image_rejected(doc):
    c, _, did = doc
    r = c.post(f"/api/v1/documents/{did}/annotations",
               json={"page": 1, "type": "signature", "rect": [0, 0, 100, 50], "image": "data:image/png;base64,AAAA"})
    assert r.status_code == 422
