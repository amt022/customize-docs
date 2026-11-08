"""Hosted website legal basics: consent at sign-in, operator / grievance details, access log, start-up check."""
import importlib

import pytest
from fastapi.testclient import TestClient

from test_auth import Inbox, PHONE, _upload, hosted  # noqa: F401  (fixture)


def _code(api, c, login=PHONE):
    assert c.post("/api/v1/auth/code", json={"login": login}).status_code == 200
    return api.auth.sender.codes["+919876543210"]


def test_sign_in_needs_consent_and_records_the_version(hosted):
    api = hosted
    c = TestClient(api.app)
    code = _code(api, c)
    r = c.post("/api/v1/auth/verify", json={"login": PHONE, "code": code})
    assert r.status_code == 422 and "Privacy Policy" in r.json()["message"]
    r = c.post("/api/v1/auth/verify", json={"login": PHONE, "code": code, "acceptTerms": True})
    assert r.status_code == 200, r.text
    with api.service.db.connect() as db:
        row = db.execute("SELECT terms_version, terms_accepted_at FROM users").fetchone()
    assert row["terms_version"] == api.legal.TERMS_VERSION and row["terms_accepted_at"]


def test_session_carries_operator_and_grievance_details(tmp_path, monkeypatch, hosted):
    monkeypatch.setenv("PDFMASTER_OPERATOR", "Ashish Tripathi")
    monkeypatch.setenv("PDFMASTER_GRIEVANCE_EMAIL", "grievance@formeasy.in")
    monkeypatch.setenv("PDFMASTER_DATA_REGION", "India (AWS Mumbai)")
    s = TestClient(hosted.app).get("/api/v1/session").json()["data"]["legal"]
    assert s["operator"] == "Ashish Tripathi" and s["grievanceEmail"] == s["contactEmail"] == "grievance@formeasy.in"
    assert s["dataRegion"] == "India (AWS Mumbai)" and s["logDays"] == 180 and s["version"]


def test_access_log_has_requests_but_no_email_or_file_name(hosted, tmp_path):
    api = hosted
    c = TestClient(api.app)
    _upload(c)
    c.post("/api/v1/auth/code", json={"login": "ashish.t@example.com"})
    code = api.auth.email_sender.codes["ashish.t@example.com"]
    c.post("/api/v1/auth/verify", json={"login": "ashish.t@example.com", "code": code, "acceptTerms": True})
    for h in api._access.handlers:
        h.flush()
    log = (tmp_path / "logs" / "access.log").read_text(encoding="utf-8")
    assert "POST /api/v1/documents 201" in log and "SIGN-IN" in log
    assert "example.com" not in log and "form.pdf" not in log


def test_real_deployment_refuses_to_start_without_operator_details(tmp_path, monkeypatch):
    for k, v in {"PDFMASTER_DATA": str(tmp_path), "PDFMASTER_MULTIUSER": "1", "PDFMASTER_COOKIE_SECURE": "1",
                 "PDFMASTER_EMAIL": "console", "PDFMASTER_SECRET": "x" * 32}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("PDFMASTER_OPERATOR", raising=False)
    monkeypatch.delenv("PDFMASTER_GRIEVANCE_EMAIL", raising=False)
    import pdfmaster.api as api

    with pytest.raises(RuntimeError, match="PDFMASTER_OPERATOR and PDFMASTER_GRIEVANCE_EMAIL"):
        importlib.reload(api)
    monkeypatch.setenv("PDFMASTER_OPERATOR", "FormEasy")
    monkeypatch.setenv("PDFMASTER_GRIEVANCE_EMAIL", "grievance@formeasy.in")
    importlib.reload(api)  # starts once both are set
    monkeypatch.delenv("PDFMASTER_MULTIUSER")
    importlib.reload(api)
