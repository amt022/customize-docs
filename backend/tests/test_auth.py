"""Hosted website accounts: mobile number + OTP sign-in, moving documents, sign-out, account deletion."""
import importlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pdfmaster.auth import AuthError, code_email, mask_email, mask_phone, normalize_email, normalize_phone

FIX = Path(__file__).parent / "fixtures"
PHONE = "98765 43210"


class Inbox:
    def __init__(self):
        self.codes: dict[str, str] = {}

    def send(self, phone, code):
        self.codes[phone] = code


@pytest.fixture()
def hosted(tmp_path, monkeypatch):
    for k, v in {"PDFMASTER_DATA": str(tmp_path), "PDFMASTER_MULTIUSER": "1", "PDFMASTER_COOKIE_SECURE": "0",
                 "PDFMASTER_SMS": "console"}.items():
        monkeypatch.setenv(k, v)
    import pdfmaster.api as api

    importlib.reload(api)
    api.auth.sender = Inbox()
    api.auth.email_sender = Inbox()
    yield api
    monkeypatch.delenv("PDFMASTER_MULTIUSER")
    importlib.reload(api)


def _upload(c):
    r = c.post("/api/v1/documents", files={"file": ("form.pdf", (FIX / "base14.pdf").read_bytes(), "application/pdf")})
    assert r.status_code == 201, r.text
    return r.json()["data"]["id"]


def _names(c):
    return [d["id"] for d in c.get("/api/v1/documents").json()["data"]]


def _sign_in(api, c, phone=PHONE):
    r = c.post("/api/v1/auth/code", json={"phone": phone})
    assert r.status_code == 200, r.text
    code = api.auth.sender.codes["+919876543210"]
    r = c.post("/api/v1/auth/verify", json={"phone": phone, "acceptTerms": True, "code": code})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def test_sign_in_keeps_documents_and_follows_the_person(hosted):
    laptop, phone = TestClient(hosted.app), TestClient(hosted.app)
    did = _upload(laptop)
    before = laptop.cookies["formeasy_sid"]
    s = _sign_in(hosted, laptop)
    assert s["user"]["login"] == "+9198••••••10" and s["user"]["kind"] == "phone" and s["movedDocuments"] == 1
    assert laptop.cookies["formeasy_sid"] != before  # new cookie value on sign-in
    assert _names(laptop) == [did]
    assert laptop.get("/api/v1/session").json()["data"]["user"]["login"] == "+9198••••••10"
    # the same person on another device sees the same documents once signed in
    assert _names(phone) == []
    _sign_in(hosted, phone)
    assert _names(phone) == [did]
    # someone holding the cookie from before sign-in gets nothing
    old = TestClient(hosted.app, cookies={"formeasy_sid": before})
    assert _names(old) == [] and old.get(f"/api/v1/documents/{did}").status_code == 404
    # sign out: this browser starts empty, the account keeps its files
    r = laptop.post("/api/v1/auth/logout")
    assert r.json()["data"]["user"] is None
    assert _names(laptop) == [] and _names(phone) == [did]


def test_wrong_codes_and_limits(hosted):
    c = TestClient(hosted.app)
    assert c.post("/api/v1/auth/code", json={"phone": "123456789"}).status_code == 400
    assert c.post("/api/v1/auth/code", json={"phone": PHONE}).status_code == 200
    assert c.post("/api/v1/auth/code", json={"phone": PHONE}).status_code == 429  # resend too soon
    real = hosted.auth.sender.codes["+919876543210"]
    wrong = "000000" if real != "000000" else "111111"
    for left in (4, 3, 2, 1):
        r = c.post("/api/v1/auth/verify", json={"phone": PHONE, "acceptTerms": True, "code": wrong})
        assert r.status_code == 400 and f"{left} tr" in r.json()["message"]
    assert c.post("/api/v1/auth/verify", json={"phone": PHONE, "acceptTerms": True, "code": wrong}).status_code == 400
    # five wrong guesses use up the code, even the right one is refused now
    assert c.post("/api/v1/auth/verify", json={"phone": PHONE, "acceptTerms": True, "code": real}).status_code == 429
    assert c.get("/api/v1/session").json()["data"]["user"] is None


def test_code_is_single_use(hosted):
    c = TestClient(hosted.app)
    _sign_in(hosted, c)
    code = hosted.auth.sender.codes["+919876543210"]
    other = TestClient(hosted.app)
    assert other.post("/api/v1/auth/verify", json={"phone": PHONE, "acceptTerms": True, "code": code}).status_code == 400


def test_delete_account_erases_everything(hosted):
    c = TestClient(hosted.app)
    _sign_in(hosted, c)
    did = _upload(c)
    r = c.delete("/api/v1/auth/account")
    assert r.status_code == 200 and r.json()["data"]["deletedDocuments"] == 1
    with hosted.service._db() as db:
        assert db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0
        assert db.execute("SELECT COUNT(*) AS n FROM documents").fetchone()["n"] == 0
    assert not (Path(hosted.DATA) / "docs" / did).exists()
    assert c.delete("/api/v1/auth/account").status_code == 401


def test_expiry_keeps_accounts_separate(hosted):
    anon, member = TestClient(hosted.app), TestClient(hosted.app)
    a = _upload(anon)
    _sign_in(hosted, member)
    m = _upload(member)
    with hosted.service._db() as db:
        db.execute("UPDATE documents SET updated_at='2020-01-01T00:00:00+00:00'")
    assert hosted.service.purge_older_than(24, accounts=False) == 1
    assert _names(anon) == [] and _names(member) == [m]
    assert hosted.service.purge_older_than(24, accounts=True) == 1
    assert _names(member) == [] and a != m


def test_accounts_off_on_desktop(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    import pdfmaster.api as api

    importlib.reload(api)
    c = TestClient(api.app)
    assert c.post("/api/v1/auth/code", json={"phone": PHONE}).status_code == 404
    assert c.get("/api/v1/session").json()["data"]["multiUser"] is False


def test_shared_list_on_a_server_is_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("PDFMASTER_DATA", str(tmp_path))
    monkeypatch.setenv("PDFMASTER_STORAGE", "s3")
    import pdfmaster.api as api

    with pytest.raises(RuntimeError, match="PDFMASTER_MULTIUSER"):
        importlib.reload(api)
    monkeypatch.setenv("PDFMASTER_MULTIUSER", "1")
    monkeypatch.delenv("PDFMASTER_SMS", raising=False)
    monkeypatch.delenv("PDFMASTER_EMAIL", raising=False)
    monkeypatch.setenv("PDFMASTER_STORAGE", "local")
    with pytest.raises(RuntimeError, match="PDFMASTER_SMS"):
        importlib.reload(api)
    monkeypatch.delenv("PDFMASTER_MULTIUSER")
    importlib.reload(api)


def test_phone_numbers():
    for raw in ("9876543210", "+91 98765 43210", "09876543210", "919876543210", "0091-98765-43210"):
        assert normalize_phone(raw) == "+919876543210", raw
    assert normalize_phone("+44 7700 900123") == "+447700900123"
    for bad in ("12345", "5876543210", "+91 12345 67890", "abcdefghij"):
        with pytest.raises(AuthError):
            normalize_phone(bad)
    assert mask_phone("+919876543210") == "+9198••••••10"


def test_sign_in_with_email_creates_account_and_keeps_documents(hosted):
    c = TestClient(hosted.app)
    did = _upload(c)
    r = c.post("/api/v1/auth/code", json={"login": "  Ashish.T@Example.com "})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["sentTo"] == "as••••@example.com" and r.json()["data"]["kind"] == "email"
    code = hosted.auth.email_sender.codes["ashish.t@example.com"]
    assert not hosted.auth.sender.codes  # nothing went out by SMS
    r = c.post("/api/v1/auth/verify", json={"login": "ashish.t@example.com", "acceptTerms": True, "code": code})
    assert r.status_code == 200, r.text
    s = r.json()["data"]
    assert s["user"] == {"login": "as••••@example.com", "kind": "email"} and s["movedDocuments"] == 1
    assert s["signIn"] == ["email", "phone"]
    # the same address (any case) on another device is the same account
    other = TestClient(hosted.app)
    other.post("/api/v1/auth/code", json={"login": "ASHISH.T@example.com"})
    code = hosted.auth.email_sender.codes["ashish.t@example.com"]
    other.post("/api/v1/auth/verify", json={"login": "ASHISH.T@example.com", "acceptTerms": True, "code": code})
    assert _names(other) == [did]


def test_email_only_server_refuses_phone(hosted):
    hosted.auth.sender = None
    c = TestClient(hosted.app)
    assert c.get("/api/v1/session").json()["data"]["signIn"] == ["email"]
    r = c.post("/api/v1/auth/code", json={"login": PHONE})
    assert r.status_code == 400 and "email" in r.json()["message"]
    assert c.post("/api/v1/auth/code", json={"login": "not-an-email@"}).status_code == 400


def test_email_failure_lets_user_retry(hosted):
    class Down:
        def send(self, *_):
            raise OSError("smtp down")

    hosted.auth.email_sender = Down()
    c = TestClient(hosted.app)
    r = c.post("/api/v1/auth/code", json={"login": "a@b.in"})
    assert r.status_code == 502 and "email" in r.json()["message"]
    hosted.auth.email_sender = Inbox()
    assert c.post("/api/v1/auth/code", json={"login": "a@b.in"}).status_code == 200  # no 30 s wait after a failure


def test_email_addresses_and_message():
    assert normalize_email(" Ram.Kumar+exam@Gmail.COM ") == "ram.kumar+exam@gmail.com"
    for bad in ("ram", "ram@", "@gmail.com", "ram@gmail", "ram@@gmail.com", "ram..k@gmail.com", "a b@x.in"):
        with pytest.raises(AuthError):
            normalize_email(bad)
    assert mask_email("ram@x.in") == "r••••@x.in"
    msg = code_email("ram@x.in", "FormEasy <no-reply@formeasy.in>", "123456")
    assert msg["Subject"].startswith("123456") and msg["To"] == "ram@x.in"
    assert "123456" in msg.get_body(("plain",)).get_content()


def test_smtp_sender_sends_the_code(monkeypatch):
    import smtplib

    from pdfmaster.auth import SmtpSender

    sent = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            sent["addr"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self, context):
            sent["tls"] = True

        def login(self, user, password):
            sent["login"] = (user, password)

        def send_message(self, msg):
            sent["msg"] = msg

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    for k, v in {"SMTP_HOST": "smtp-relay.example.com", "SMTP_USER": "u", "SMTP_PASSWORD": "p",
                 "SMTP_FROM": "FormEasy <no-reply@formeasy.in>"}.items():
        monkeypatch.setenv(k, v)
    monkeypatch.delenv("SMTP_PORT", raising=False)
    monkeypatch.delenv("SMTP_SECURITY", raising=False)
    SmtpSender().send("ram@x.in", "654321")
    assert sent["addr"] == ("smtp-relay.example.com", 587) and sent["tls"] and sent["login"] == ("u", "p")
    assert sent["msg"]["To"] == "ram@x.in" and "654321" in sent["msg"]["Subject"]
