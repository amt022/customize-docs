"""Hosted-mode storage: per-browser isolation, S3 blobs, PostgreSQL, expiry, concurrent edits."""
import importlib
import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdfmaster.engine.editor import Edit
from pdfmaster.service import Conflict, DocumentService, NotFound

FIX = Path(__file__).parent / "fixtures"


def _upload(client, name="base14.pdf"):
    r = client.post("/api/v1/documents", files={"file": (name, (FIX / name).read_bytes(), "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def test_each_browser_sees_only_its_own_documents(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    monkeypatch.setenv("PDFMASTER_MULTIUSER", "1")
    monkeypatch.setenv("PDFMASTER_COOKIE_SECURE", "0")  # the test client talks plain http
    monkeypatch.setenv("PDFMASTER_SMS", "console")
    import pdfmaster.api as api

    importlib.reload(api)
    alice, bob = TestClient(api.app), TestClient(api.app)
    did = _upload(alice)
    assert "formeasy_sid" in alice.cookies
    assert [d["id"] for d in alice.get("/api/v1/documents").json()["data"]] == [did]
    assert bob.get("/api/v1/documents").json()["data"] == []
    for path in (f"/api/v1/documents/{did}", f"/api/v1/documents/{did}/file", f"/api/v1/documents/{did}/pages/1/text"):
        assert bob.get(path).status_code == 404, path
    assert bob.delete(f"/api/v1/documents/{did}").status_code == 404
    assert bob.post(f"/api/v1/documents/{did}/undo").status_code == 404
    assert alice.get(f"/api/v1/documents/{did}/file").status_code == 200
    assert "owner" not in alice.get(f"/api/v1/documents/{did}").json()["data"]
    # a forged cookie is just another (empty) browser
    eve = TestClient(api.app, cookies={"formeasy_sid": "x" * 43})
    assert eve.get("/api/v1/documents").json()["data"] == []
    monkeypatch.delenv("PDFMASTER_MULTIUSER")
    importlib.reload(api)


def _edit_cycle(svc: DocumentService):
    doc = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())
    did = doc["id"]
    line = svc.page_model(did, 1)["lines"][0]
    glyphs = [i for i in line["map"] if i >= 0][:3]
    svc.replace_text(did, 1, [Edit(glyphs, "XYZ", "auto", "auto")], 0, False)
    svc.replace_text(did, 1, [Edit(glyphs, "ABC", "auto", "auto")], 1, False)
    assert svc.get(did)["current_version"] == 2
    svc.undo(did)
    svc.replace_text(did, 1, [Edit(glyphs, "QQQ", "auto", "auto")], 1, False)  # drops the redo branch
    doc = svc.get(did)
    assert (doc["current_version"], doc["head_version"]) == (2, 2)
    assert svc.data(did, 0) == (FIX / "base14.pdf").read_bytes()
    with pytest.raises(Conflict):  # a second server still holding version 1 must not overwrite version 2
        svc._commit(did, {**doc, "current_version": 1}, svc.data(did), 1, "TEST", {"summary": "stale"}, {})
    return did


def test_s3_store(tmp_path, monkeypatch):
    moto = pytest.importorskip("moto")
    import boto3

    from pdfmaster.storage import S3Store

    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    with moto.mock_aws():
        s3 = boto3.client("s3", region_name="ap-south-1")
        s3.create_bucket(Bucket="formeasy-test", CreateBucketConfiguration={"LocationConstraint": "ap-south-1"})
        svc = DocumentService(tmp_path, store=S3Store("formeasy-test", "prod", client=s3), database_url="")
        did = _edit_cycle(svc)

        def keys():
            return sorted(o["Key"] for o in s3.list_objects_v2(Bucket="formeasy-test").get("Contents", []))

        names = [k.rsplit("/", 1)[1] for k in keys()]
        assert len(names) == 3 and [n.split("-")[0] for n in names] == ["v0", "v1", "v2"]  # dropped v2 deleted
        assert all(k.startswith(f"prod/docs/{did}/") for k in keys())
        head = s3.head_object(Bucket="formeasy-test", Key=keys()[0])
        assert head["ServerSideEncryption"] == "AES256"
        assert not (tmp_path / "docs").exists()  # nothing written to local disk
        svc.delete(did)
        assert len(keys()) == 3  # only moved to "Recently deleted"
        svc.delete_forever(did)
        assert keys() == []
        with pytest.raises(NotFound):
            svc.get(did)


def test_expired_documents_are_deleted(tmp_path):
    svc = DocumentService(tmp_path, database_url="")
    old = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())["id"]
    new = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())["id"]
    with svc._db() as db:
        db.execute("UPDATE documents SET updated_at='2020-01-01T00:00:00+00:00' WHERE id=?", (old,))
    assert svc.purge_older_than(24) == 1
    assert [d["id"] for d in svc.list()] == [new]
    assert not (tmp_path / "docs" / old).exists()


def test_old_local_layout_still_opens(tmp_path):
    """Databases from before this change store version files as docs/<id>/v0.pdf."""
    svc = DocumentService(tmp_path, database_url="")
    did = svc.create("base14.pdf", (FIX / "base14.pdf").read_bytes())["id"]
    folder = tmp_path / "docs" / did
    (blob,) = folder.glob("v0-*.pdf")
    blob.rename(folder / "v0.pdf")
    with svc._db() as db:
        db.execute("UPDATE document_versions SET storage_key='v0.pdf' WHERE document_id=?", (did,))
    assert svc.data(did) == (FIX / "base14.pdf").read_bytes()
    assert svc.page_model(did, 1)["lines"]


def test_postgres(tmp_path):
    url = os.environ.get("PDFMASTER_TEST_DATABASE_URL")
    server = None
    if not url:
        pgserver = pytest.importorskip("pgserver")
        server = pgserver.get_server(tmp_path / "pg", cleanup_mode="stop")
        url = server.get_uri()
    svc = DocumentService(tmp_path / "data", database_url=url)
    try:
        _edit_cycle(svc)
        assert len(svc.list()) == 1
        from pdfmaster.auth import Auth, AuthError

        sent = {}
        auth = Auth(svc.db, type("S", (), {"send": lambda self, p, c: sent.update({p: c})})(), b"k")
        auth.request_code("9876543210")
        with pytest.raises(AuthError):
            auth.verify_code("9876543210", "x")
        user = auth.verify_code("9876543210", sent["+919876543210"])
        assert auth.user_for(auth.start_session(user["id"]))["phone"] == "+919876543210"
        assert svc.reassign_owner("", f"u:{user['id']}") == 1
        assert svc.purge_older_than(-1, accounts=False) == 0  # LIKE 'u:%' survives the %s placeholders
        assert svc.purge_older_than(-1, accounts=True) == 1
    finally:
        svc.db.close()
        if server is not None:
            server.cleanup()
