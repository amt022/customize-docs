import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    return TestClient(api.app)


def upload(client, name="base14.pdf"):
    r = client.post("/api/v1/documents", files={"file": (name, (FIX / name).read_bytes(), "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["data"]


def test_upload_rejects_non_pdf(client):
    r = client.post("/api/v1/documents", files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400


def test_full_edit_cycle(client):
    doc = upload(client)
    did = doc["id"]
    assert doc["page_count"] == 1 and doc["current_version"] == 0

    page = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    line = next(l for l in page["lines"] if l["text"].startswith("Transaction Amount"))
    start = line["text"].index("25,000")
    glyphs = [i for i in line["map"][start:start + 6] if i >= 0]

    body = {"page": 1, "edits": [{"glyphs": glyphs, "text": "35,000"}], "baseVersion": 0}
    preview = client.post(f"/api/v1/documents/{did}/edit/replace-text", json={**body, "dryRun": True}).json()["data"]
    assert preview["dryRun"] and preview["version"] == 0
    assert preview["verification"]["layoutPreserved"]

    res = client.post(f"/api/v1/documents/{did}/edit/replace-text", json=body).json()["data"]
    assert res["version"] == 1
    assert any("35,000" in l["text"] for l in res["page"]["lines"])

    # stale base version is rejected
    stale = client.post(f"/api/v1/documents/{did}/edit/replace-text", json=body)
    assert stale.status_code == 409

    hist = client.get(f"/api/v1/documents/{did}").json()["data"]
    assert hist["canUndo"] and hist["history"][0]["layoutPreserved"]

    assert client.post(f"/api/v1/documents/{did}/undo").json()["data"]["current_version"] == 0
    txt = client.get(f"/api/v1/documents/{did}/pages/1/text").json()["data"]
    assert any("25,000" in l["text"] for l in txt["lines"])
    assert client.post(f"/api/v1/documents/{did}/redo").json()["data"]["current_version"] == 1

    png = client.get(f"/api/v1/documents/{did}/compare/1.png?a=0")
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    stats = client.get(f"/api/v1/documents/{did}/compare/1?a=0").json()["data"]
    assert stats["changedPixels"] > 0

    dl = client.get(f"/api/v1/documents/{did}/download")
    assert dl.content.startswith(b"%PDF") and "edited" in dl.headers["content-disposition"]


def test_find_replace_all(client):
    doc = upload(client, "browser.pdf")
    did = doc["id"]
    hits = client.post(f"/api/v1/documents/{did}/find", json={"query": ".00"}).json()["data"]
    assert len(hits) == 3
    res = client.post(f"/api/v1/documents/{did}/edit/find-replace",
                      json={"query": ".00", "replacement": ".99", "anchor": "right", "fit": "none"}).json()["data"]
    assert res["replaced"] == 3 and res["version"] == 1
    assert res["verification"]["layoutPreserved"]


def test_unknown_document(client):
    assert client.get("/api/v1/documents/deadbeef").status_code == 404


def test_page_tools_and_undo(client):
    did = upload(client)["id"]
    base = f"/api/v1/documents/{did}"
    with open(FIX / "browser.pdf", "rb") as f:
        r = client.post(f"{base}/merge", files={"file": ("browser.pdf", f.read(), "application/pdf")}, data={"baseVersion": "0"})
    assert r.json()["data"]["page_count"] == 2
    assert client.post(f"{base}/pages", json={"op": "move", "from": 2, "to": 1}).json()["data"]["page_count"] == 2
    p1 = client.get(f"{base}/pages/1/text").json()["data"]
    assert p1["lines"][0]["text"] == "Tax Invoice"
    r = client.post(f"{base}/pages", json={"op": "rotate", "pages": [1], "degrees": 90}).json()["data"]
    assert client.get(f"{base}/pages/1/text").json()["data"]["rotation"] == 90
    assert client.post(f"{base}/pages", json={"op": "insert-blank", "after": 2}).json()["data"]["page_count"] == 3
    assert client.post(f"{base}/pages", json={"op": "delete", "pages": [3]}).json()["data"]["page_count"] == 2
    bad = client.post(f"{base}/pages", json={"op": "delete", "pages": [1, 2]})
    assert bad.status_code == 422
    # undo the delete brings the page back
    assert client.post(f"{base}/undo").json()["data"]["page_count"] == 3
    new = client.post(f"{base}/extract", json={"pages": "1-2", "splitEach": True}).json()["data"]
    assert len(new) == 2 and all(d["page_count"] == 1 for d in new)


def test_password_export(client):
    import io

    import pikepdf

    did = upload(client)["id"]
    r = client.post(f"/api/v1/documents/{did}/export", json={"userPassword": "s3cret", "allowCopy": False})
    assert r.status_code == 200
    with pytest.raises(pikepdf.PasswordError):
        pikepdf.open(io.BytesIO(r.content))
    with pikepdf.open(io.BytesIO(r.content), password="s3cret") as pdf:
        assert pdf.is_encrypted and not pdf.allow.extract
    # an encrypted upload needs its password, and is re-protected only on export
    r2 = client.post("/api/v1/documents", files={"file": ("p.pdf", r.content, "application/pdf")})
    assert r2.status_code == 401
    r3 = client.post("/api/v1/documents", files={"file": ("p.pdf", r.content, "application/pdf")}, data={"password": "s3cret"})
    assert r3.status_code == 201 and r3.json()["data"]["was_encrypted"] == 1


def test_desktop_token_required(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    monkeypatch.setenv("PDFMASTER_TOKEN", "t0ken")
    import pdfmaster.api as api

    importlib.reload(api)
    c = TestClient(api.app)
    assert c.get("/api/v1/health").status_code == 200
    assert c.get("/api/v1/documents").status_code == 403
    assert c.get("/api/v1/documents", headers={"X-PDFMaster-Token": "wrong"}).status_code == 403
    assert c.get("/api/v1/documents", headers={"X-PDFMaster-Token": "t0ken"}).status_code == 200
    monkeypatch.delenv("PDFMASTER_TOKEN")
    importlib.reload(api)


def test_upload_size_limit(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    monkeypatch.setenv("PDFMASTER_MAX_UPLOAD_MB", "1")
    import pdfmaster.api as api

    importlib.reload(api)
    client = TestClient(api.app)
    big = b"%PDF-1.4\n" + b"0" * (2 * 1024 * 1024)
    r = client.post("/api/v1/documents", files={"file": ("big.pdf", big, "application/pdf")})
    assert r.status_code == 413 and "too large" in r.json()["message"]
    # chunked read also stops oversized files when no Content-Length check applies
    import asyncio
    import io

    from fastapi import HTTPException, UploadFile

    with pytest.raises(HTTPException) as e:
        asyncio.run(api._read_limited(UploadFile(io.BytesIO(big)), 1024 * 1024))
    assert e.value.status_code == 413
    monkeypatch.delenv("PDFMASTER_MAX_UPLOAD_MB")
    importlib.reload(api)


def test_delete_goes_to_trash_and_can_be_restored(client):
    did = upload(client)["id"]
    assert client.delete(f"/api/v1/documents/{did}").status_code == 200
    assert client.get("/api/v1/documents").json()["data"] == []
    assert client.get(f"/api/v1/documents/{did}").status_code == 404
    trash = client.get("/api/v1/trash").json()["data"]
    assert [d["id"] for d in trash] == [did] and trash[0]["deleted_at"]
    r = client.post(f"/api/v1/trash/{did}/restore")
    assert r.status_code == 200 and r.json()["data"]["id"] == did
    assert [d["id"] for d in client.get("/api/v1/documents").json()["data"]] == [did]
    assert client.get("/api/v1/trash").json()["data"] == []
    # erasing needs the document to be in the trash first
    assert client.delete(f"/api/v1/trash/{did}").status_code == 404
    client.delete(f"/api/v1/documents/{did}")
    assert client.delete(f"/api/v1/trash/{did}").status_code == 200
    assert client.get("/api/v1/trash").json()["data"] == []
    assert client.post(f"/api/v1/trash/{did}/restore").status_code == 404


def test_trash_is_emptied_after_days(tmp_path):
    from pdfmaster.service import DocumentService

    svc = DocumentService(tmp_path, database_url="")
    old = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())["id"]
    new = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())["id"]
    svc.delete(old)
    svc.delete(new)
    with svc._db() as db:
        db.execute("UPDATE documents SET deleted_at='2020-01-01T00:00:00+00:00' WHERE id=?", (old,))
    assert svc.purge_trash(30) == 1
    assert [d["id"] for d in svc.trash()] == [new]
