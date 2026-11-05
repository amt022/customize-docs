"""Download as JPG / PNG / Word / Excel / text."""
import importlib
import io
import re
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    return TestClient(api.app)


def upload(client, name):
    r = client.post("/api/v1/documents", files={"file": (name, (FIX / name).read_bytes(), "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def merge_copy(client, did, name):
    """Make the document two pages long."""
    r = client.post(f"/api/v1/documents/{did}/merge", files={"file": (name, (FIX / name).read_bytes(), "application/pdf")})
    assert r.status_code == 200, r.text


def test_jpg_one_page_and_png_zip(client):
    did = upload(client, "browser.pdf")
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "jpg", "dpi": 100})
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "browser-page1.jpg" in r.headers["content-disposition"]
    img = Image.open(io.BytesIO(r.content))
    assert img.format == "JPEG" and img.width > 500

    merge_copy(client, did, "base14.pdf")
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "png"})
    assert r.headers["content-type"] == "application/zip"
    names = zipfile.ZipFile(io.BytesIO(r.content)).namelist()
    assert names == ["browser-edited-page1.png", "browser-edited-page2.png"]
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "png", "pages": "2"})
    assert r.headers["content-type"] == "image/png"
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "png", "pages": "5"})
    assert r.status_code >= 400


def test_excel_lines_up_table_columns_and_keeps_amounts_numeric(client):
    did = upload(client, "browser.pdf")
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "xlsx"})
    assert r.status_code == 200 and r.headers["content-disposition"].endswith(".xlsx")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert {"[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"} <= set(z.namelist())
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    # amounts land in column B as numbers, whatever their width (right-aligned column)
    assert re.search(r'<c r="B\d+"><v>25000.00</v></c>', sheet)
    assert re.search(r'<c r="B\d+"><v>7500.00</v></c>', sheet)
    assert re.search(r'<c r="A\d+" t="inlineStr"><is><t xml:space="preserve">Design work</t>', sheet)


def test_word_and_text(client):
    did = upload(client, "base14.pdf")
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "docx"})
    assert r.status_code == 200
    doc = zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode()
    assert "Customer Name: Ashish Tripathi" in doc
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "txt"})
    assert "STATEMENT OF ACCOUNT\tPage 1" in r.content.decode("utf-8")
    assert r.headers["x-pages-without-text"] == ""


def test_word_places_untexted_scan_as_picture(client):
    pic = Image.new("RGB", (400, 300), "white")
    buf = io.BytesIO()
    pic.save(buf, "JPEG")
    r = client.post("/api/v1/documents/from-images", files=[("files", ("scan.jpg", buf.getvalue(), "image/jpeg"))])
    if r.status_code == 404:
        pytest.skip("no from-images endpoint")
    assert r.status_code == 201, r.text
    did = r.json()["data"]["id"]
    r = client.get(f"/api/v1/documents/{did}/convert", params={"format": "docx"})
    assert r.headers["x-pages-without-text"] == "1"
    z = zipfile.ZipFile(io.BytesIO(r.content))
    assert "word/media/page1.png" in z.namelist()
    assert 'r:embed="img1"' in z.read("word/document.xml").decode()
