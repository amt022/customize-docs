"""Image tools: list, move/resize/rotate, delete, replace and insert pictures on a page."""
import io
import zlib

import numpy as np
import pikepdf
from PIL import Image

from pdfmaster.engine import images as I
from pdfmaster.engine.document import page_json, save_pdf
from pdfmaster.engine.interpreter import PageModel
from pdfmaster.engine.render import render_array

_keep: list = []


def solid(color, size=(80, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def image_xobject(pdf, color, size=(80, 60)):
    img = Image.new("RGB", size, color)
    return pdf.make_stream(zlib.compress(img.tobytes()), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Image,
                           Width=size[0], Height=size[1], ColorSpace=pikepdf.Name.DeviceRGB, BitsPerComponent=8,
                           Filter=pikepdf.Name.FlateDecode)


def make_pdf(content: str, images: dict, form_content: str | None = None, form_images: dict | None = None) -> bytes:
    pdf = pikepdf.new()
    page = pdf.add_blank_page(page_size=(400, 400))
    xo = pikepdf.Dictionary({f"/{k}": v for k, v in {n: image_xobject(pdf, c) for n, c in images.items()}.items()})
    if form_content:
        form = pdf.make_stream(form_content.encode(), Type=pikepdf.Name.XObject, Subtype=pikepdf.Name.Form, BBox=[0, 0, 400, 400],
                               Resources=pikepdf.Dictionary(XObject=pikepdf.Dictionary(
                                   {f"/{k}": image_xobject(pdf, c) for k, c in (form_images or {}).items()})))
        xo["/Fm0"] = form
    page.Resources = pikepdf.Dictionary(XObject=xo)
    page.Contents = pdf.make_stream(content.encode())
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def open_pdf(data: bytes) -> pikepdf.Pdf:
    pdf = pikepdf.open(io.BytesIO(data))
    _keep.append(pdf)
    return pdf


def boxes(data: bytes) -> list[list[float]]:
    return [d["bbox"] for d in I.describe(PageModel(open_pdf(data), 0))]


def pixel(data: bytes, x: float, y: float):
    arr = render_array(data, 0, 1.0)
    return tuple(int(v) for v in arr[int(400 - y), int(x)][:3])


RED, GREEN, BLUE = (230, 20, 20), (20, 200, 20), (20, 20, 230)


def two_images() -> bytes:
    return make_pdf("q 100 0 0 75 50 300 cm /A Do Q q 100 0 0 75 250 100 cm /B Do Q", {"A": RED, "B": GREEN})


def test_images_are_listed_with_position_and_size():
    d = I.describe(PageModel(open_pdf(two_images()), 0))
    assert [x["bbox"] for x in d] == [[50, 300, 150, 375], [250, 100, 350, 175]]
    assert d[0]["width"] == 80 and d[0]["dpi"] == 58 and not d[0]["pageScan"]
    assert page_json(PageModel(open_pdf(two_images()), 0)).get("images") == d


def test_resize_moves_only_that_image():
    data = two_images()
    pdf = open_pdf(data)
    notes = I.transform(pdf, 0, 0, bbox=[20, 250, 220, 400])
    out = save_pdf(pdf)
    assert boxes(out) == [[20, 250, 220, 400], [250, 100, 350, 175]]
    assert notes["bbox"] == [20, 250, 220, 400]
    assert pixel(out, 120, 325) == RED and pixel(out, 60, 120) != RED and pixel(out, 300, 140) == GREEN


def test_resize_inside_nested_transform_and_form_object():
    content = "q 0.5 0 0 0.5 0 0 cm 1 0 0 1 100 100 cm 200 0 0 150 0 0 cm /A Do Q /Fm0 Do"
    form = "q 100 0 0 100 250 20 cm /F Do Q"
    data = make_pdf(content, {"A": RED}, form, {"F": BLUE})
    assert boxes(data) == [[50, 50, 150, 125], [250, 20, 350, 120]]
    pdf = open_pdf(data)
    I.transform(pdf, 0, 0, bbox=[10, 10, 110, 60])
    I.transform(pdf, 0, 1, bbox=[200, 200, 300, 260])  # the form image: the form is copied for this use
    out = save_pdf(pdf)
    assert boxes(out) == [[10, 10, 110, 60], [200, 200, 300, 260]]
    assert pixel(out, 250, 230) == BLUE


def test_rotate_90_swaps_proportions_around_the_centre():
    pdf = open_pdf(two_images())
    I.transform(pdf, 0, 0, rotate=90)
    b = boxes(save_pdf(pdf))[0]
    assert [round(v, 1) for v in b] == [62.5, 287.5, 137.5, 387.5]


def test_delete_and_replace():
    pdf = open_pdf(two_images())
    I.delete(pdf, 0, 0)
    out = save_pdf(pdf)
    assert boxes(out) == [[250, 100, 350, 175]] and pixel(out, 100, 340) == (255, 255, 255)

    pdf = open_pdf(two_images())
    I.replace(pdf, 0, 1, solid(BLUE, (40, 40)), "contain")  # square picture inside a 100x75 frame
    out = save_pdf(pdf)
    b = boxes(out)[1]
    assert round(b[2] - b[0]) == 75 and round(b[3] - b[1]) == 75 or round(b[3] - b[1]) == 75
    assert pixel(out, 300, 140) == BLUE
    pdf = open_pdf(two_images())
    I.replace(pdf, 0, 1, solid(BLUE, (40, 40)), "stretch")
    assert boxes(save_pdf(pdf))[1] == [250, 100, 350, 175]


def test_insert_new_image_keeps_proportions_and_stays_on_top():
    data = make_pdf("1 0 0 rg 0 0 400 400 re f q 1 0 0 1 5 5 cm", {})  # also leaves the graphics state unbalanced
    pdf = open_pdf(data)
    info = I.insert(pdf, 0, [100, 100, 300, 200], solid(GREEN, (200, 100)))
    out = save_pdf(pdf)
    assert info["bbox"] == [100.0, 100.0, 300.0, 200.0]
    assert boxes(out) == [[100, 100, 300, 200]]
    assert pixel(out, 200, 150) == GREEN and pixel(out, 50, 50) == (255, 0, 0)
    # a tall picture is fitted inside the area, centred
    pdf = open_pdf(data)
    info = I.insert(pdf, 0, [100, 100, 300, 200], solid(GREEN, (50, 100)))
    assert info["bbox"] == [175.0, 100.0, 225.0, 200.0]


def test_jpeg_is_embedded_without_recompression():
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (10, 120, 200)).save(buf, "JPEG", quality=90)
    jpeg = buf.getvalue()
    pdf = open_pdf(make_pdf("", {}))
    I.insert(pdf, 0, [10, 10, 110, 110], jpeg)
    xo = pdf.pages[0].Resources.XObject["/PMImg1"]
    assert xo.Filter == "/DCTDecode" and xo.read_raw_bytes() == jpeg


def test_bad_requests_are_rejected():
    import pytest

    from pdfmaster.engine.editor import EditError

    pdf = open_pdf(two_images())
    with pytest.raises(EditError):
        I.transform(pdf, 0, 9, bbox=[0, 0, 50, 50])
    with pytest.raises(EditError):
        I.transform(pdf, 0, 0, bbox=[0, 0, 1, 1])
    with pytest.raises(EditError):
        I.insert(pdf, 0, [0, 0, 100, 100], b"not an image")


def test_image_api_cycle_with_undo(tmp_path, monkeypatch):
    import base64
    import importlib

    from fastapi.testclient import TestClient

    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    c = TestClient(api.app)
    doc = c.post("/api/v1/documents", files={"file": ("i.pdf", two_images(), "application/pdf")}).json()["data"]
    url = f"/api/v1/documents/{doc['id']}"
    page = c.get(f"{url}/pages/1/text").json()["data"]
    assert [i["id"] for i in page["images"]] == [0, 1]

    r = c.post(f"{url}/pages/1/images", json={"action": "transform", "index": 0, "bbox": [0, 0, 200, 150], "baseVersion": 0})
    assert r.status_code == 200 and r.json()["data"]["version"] == 1
    assert c.get(f"{url}/pages/1/text").json()["data"]["images"][0]["bbox"] == [0, 0, 200, 150]

    png = "data:image/png;base64," + base64.b64encode(solid(BLUE)).decode()
    r = c.post(f"{url}/pages/1/images", json={"action": "insert", "rect": [10, 10, 110, 110], "image": png, "baseVersion": 1})
    assert r.status_code == 200
    assert len(c.get(f"{url}/pages/1/text").json()["data"]["images"]) == 3

    assert c.post(f"{url}/pages/1/images", json={"action": "delete", "index": 2, "baseVersion": 1}).status_code == 409  # stale
    r = c.post(f"{url}/pages/1/images", json={"action": "delete", "index": 2, "baseVersion": 2})
    assert r.status_code == 200 and len(c.get(f"{url}/pages/1/text").json()["data"]["images"]) == 2
    c.post(f"{url}/undo")
    assert len(c.get(f"{url}/pages/1/text").json()["data"]["images"]) == 3
    assert c.post(f"{url}/pages/1/images", json={"action": "transform", "index": 7, "bbox": [0, 0, 50, 50]}).status_code == 422


def test_new_document_from_pictures():
    import io

    import pikepdf
    from PIL import Image

    from pdfmaster.engine.images import new_document

    def png(w, h):
        b = io.BytesIO()
        Image.new("RGB", (w, h), (200, 30, 30)).save(b, "PNG")
        return b.getvalue()

    out = new_document([png(400, 200), png(200, 400)])
    pdf = pikepdf.open(io.BytesIO(out))
    assert len(pdf.pages) == 2
    w0, h0 = float(pdf.pages[0].MediaBox[2]), float(pdf.pages[0].MediaBox[3])
    w1, h1 = float(pdf.pages[1].MediaBox[2]), float(pdf.pages[1].MediaBox[3])
    assert w0 > h0 and h1 > w1 and max(w0, h0) <= 842.1
