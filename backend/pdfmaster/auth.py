"""Accounts for the hosted website: sign in with an email address or a mobile number and a
one-time code (OTP). A new address or number creates the account.

Signing in is optional. Without it a browser keeps its documents through an anonymous session
cookie; signing in moves them to the account, so they follow the person to any device.
Codes and session tokens are stored only as keyed hashes. The login (email lower-cased, or phone
as +<country><number>) is kept in the `phone` columns, so older databases need no migration.

PDFMASTER_EMAIL picks how emailed codes are sent (at least one of EMAIL / SMS must be set):
  console  print to the server log (local testing only)
  smtp     SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_SECURITY (starttls|ssl|none)
           works with Brevo, Resend, Amazon SES, Zoho, Gmail Workspace and others

PDFMASTER_SMS picks how texted codes are sent:
  console  print to the server log (local testing only)
  twilio   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
  msg91    MSG91_AUTH_KEY, MSG91_TEMPLATE_ID (a DLT-approved template with an ##otp## variable)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from .db import Database

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS otp_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TEXT NOT NULL,
    window_start TEXT NOT NULL,
    window_count INTEGER NOT NULL DEFAULT 0
)
"""

CODE_MINUTES = 10
MAX_ATTEMPTS = 5  # wrong guesses per code
RESEND_SECONDS = 30
MAX_SENDS_PER_HOUR = 5  # per number; a code is 6 digits, so at most 25 guesses an hour
MAX_SENDS_PER_IP_HOUR = 20
SESSION_DAYS = 30

log = logging.getLogger("pdfmaster.auth")


class AuthError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(t: datetime) -> str:
    return t.isoformat(timespec="seconds")


def normalize_phone(raw: str) -> str:
    """'98765 43210', '+91-98765-43210', '09876543210' -> '+919876543210'. Other countries need the + prefix."""
    s = re.sub(r"[\s\-().]", "", raw or "")
    if s.startswith("00"):
        s = "+" + s[2:]
    if not s.startswith("+"):
        digits = s[1:] if len(s) == 11 and s.startswith("0") else s[2:] if len(s) == 12 and s.startswith("91") else s
        if not re.fullmatch(r"[6-9]\d{9}", digits):
            raise AuthError("Enter a 10-digit Indian mobile number, or the full number with + and country code")
        return "+91" + digits
    if not re.fullmatch(r"\+[1-9]\d{7,14}", s) or (s.startswith("+91") and not re.fullmatch(r"\+91[6-9]\d{9}", s)):
        raise AuthError("That does not look like a mobile number")
    return s


def mask_phone(phone: str) -> str:
    return phone[:-10] + phone[-10:-8] + "•" * 6 + phone[-2:] if len(phone) > 10 else phone


_EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+")


def normalize_email(raw: str) -> str:
    s = (raw or "").strip().lower()
    if len(s) > 254 or not _EMAIL.fullmatch(s) or ".." in s or s.split("@")[1].endswith("."):
        raise AuthError("That does not look like an email address")
    return s


def is_email(login: str) -> bool:
    return "@" in login


def normalize_login(raw: str) -> str:
    """An email address (lower-cased) or a mobile number (+<country><number>)."""
    return normalize_email(raw) if "@" in (raw or "") else normalize_phone(raw)


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return (name[:2] if len(name) > 4 else name[:1]) + "•" * 4 + "@" + domain


def mask_login(login: str) -> str:
    return mask_email(login) if is_email(login) else mask_phone(login)


# ------------------------------------------------------------------ SMS senders
class ConsoleSender:
    """Testing only: the code goes to the server log instead of the phone."""

    name = "console"

    def send(self, phone: str, code: str) -> None:
        log.warning("OTP for %s is %s (PDFMASTER_SMS=console: not really sent)", phone, code)


class TwilioSender:
    name = "twilio"

    def __init__(self):
        self.sid, self.token, self.sender = (os.environ.get(k, "") for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"))
        if not (self.sid and self.token and self.sender):
            raise RuntimeError("PDFMASTER_SMS=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM")

    def send(self, phone: str, code: str) -> None:
        body = urllib.parse.urlencode({"To": phone, "From": self.sender,
                                       "Body": f"{code} is your FormEasy sign-in code. It expires in {CODE_MINUTES} minutes."})
        req = urllib.request.Request(f"https://api.twilio.com/2010-04-01/Accounts/{self.sid}/Messages.json", body.encode(),
                                     {"Authorization": "Basic " + base64.b64encode(f"{self.sid}:{self.token}".encode()).decode()})
        urllib.request.urlopen(req, timeout=15).read()


class Msg91Sender:
    name = "msg91"

    def __init__(self):
        self.key, self.template = os.environ.get("MSG91_AUTH_KEY", ""), os.environ.get("MSG91_TEMPLATE_ID", "")
        if not (self.key and self.template):
            raise RuntimeError("PDFMASTER_SMS=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID")

    def send(self, phone: str, code: str) -> None:
        body = json.dumps({"template_id": self.template, "recipients": [{"mobiles": phone.lstrip("+"), "otp": code}]})
        req = urllib.request.Request("https://control.msg91.com/api/v5/flow/", body.encode(),
                                     {"authkey": self.key, "Content-Type": "application/json", "accept": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()


# ---------------------------------------------------------------- email senders
class ConsoleEmailSender:
    """Testing only: the code goes to the server log instead of the inbox."""

    name = "console"

    def send(self, email: str, code: str) -> None:
        log.warning("OTP for %s is %s (PDFMASTER_EMAIL=console: not really sent)", email, code)


def code_email(to: str, sender: str, code: str):
    from email.message import EmailMessage
    from email.utils import formatdate, make_msgid

    msg = EmailMessage()
    msg["Subject"] = f"{code} is your FormEasy sign-in code"
    msg["From"] = sender
    msg["To"] = to
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=sender.rpartition("@")[2].strip("> ") or None)
    msg.set_content(f"Your FormEasy sign-in code is {code}\n\nIt expires in {CODE_MINUTES} minutes. "
                    "If you did not ask for it, you can ignore this email; nobody can sign in without the code.\n")
    msg.add_alternative(
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222">'
        "<p>Your FormEasy sign-in code is</p>"
        f'<p style="font-size:30px;font-weight:bold;letter-spacing:6px;margin:12px 0">{code}</p>'
        f"<p>It expires in {CODE_MINUTES} minutes.</p>"
        '<p style="color:#777;font-size:13px">If you did not ask for it, you can ignore this email; '
        "nobody can sign in without the code.</p></div>", subtype="html")
    return msg


class SmtpSender:
    name = "smtp"

    def __init__(self):
        e = os.environ.get
        self.host, self.user, self.password = e("SMTP_HOST", ""), e("SMTP_USER", ""), e("SMTP_PASSWORD", "")
        self.sender = e("SMTP_FROM", "") or self.user
        self.security = e("SMTP_SECURITY", "starttls").lower()
        self.port = int(e("SMTP_PORT", "") or (465 if self.security == "ssl" else 587))
        if not (self.host and self.sender):
            raise RuntimeError("PDFMASTER_EMAIL=smtp needs SMTP_HOST and SMTP_FROM (plus SMTP_USER / SMTP_PASSWORD)")
        if self.security not in ("starttls", "ssl", "none"):
            raise RuntimeError("SMTP_SECURITY must be starttls, ssl or none")

    def send(self, email: str, code: str) -> None:
        import smtplib
        import ssl

        ctx = ssl.create_default_context()
        if self.security == "ssl":
            server = smtplib.SMTP_SSL(self.host, self.port, timeout=20, context=ctx)
        else:
            server = smtplib.SMTP(self.host, self.port, timeout=20)
        with server:
            if self.security == "starttls":
                server.starttls(context=ctx)
            if self.user:
                server.login(self.user, self.password)
            server.send_message(code_email(email, self.sender, code))


def senders_from_env() -> tuple[Optional[object], Optional[object]]:
    """(SMS sender, email sender); at least one must be configured."""
    sms_kind = os.environ.get("PDFMASTER_SMS", "").lower()
    email_kind = os.environ.get("PDFMASTER_EMAIL", "").lower()
    sms = {"console": ConsoleSender, "twilio": TwilioSender, "msg91": Msg91Sender}
    mail = {"console": ConsoleEmailSender, "smtp": SmtpSender}
    if sms_kind and sms_kind not in sms:
        raise RuntimeError("PDFMASTER_SMS must be msg91, twilio or console")
    if email_kind and email_kind not in mail:
        raise RuntimeError("PDFMASTER_EMAIL must be smtp or console")
    if not sms_kind and not email_kind:
        raise RuntimeError("Set PDFMASTER_EMAIL (smtp) and/or PDFMASTER_SMS (msg91 or twilio), or console for "
                           "local testing, so sign-in codes can be sent")
    return (sms[sms_kind]() if sms_kind else None, mail[email_kind]() if email_kind else None)


def secret_from_env(data_root: Path) -> bytes:
    """Key for hashing codes and tokens. Several servers must share PDFMASTER_SECRET."""
    env = os.environ.get("PDFMASTER_SECRET")
    if env:
        return env.encode()
    f = Path(data_root) / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
    return f.read_text().strip().encode()


# ------------------------------------------------------------------------ Auth
class Auth:
    def __init__(self, db: Database, sender, secret: bytes, email_sender=None):
        self.db, self.sender, self.secret, self.email_sender = db, sender, secret, email_sender
        # consent: which Privacy Policy / Terms version the person accepted, and when (latest sign-in)
        self.db.init(SCHEMA, {"users": [("terms_version", "TEXT"), ("terms_accepted_at", "TEXT")]})
        self._ip_sends: dict[str, list[float]] = {}
        self._ip_lock = threading.Lock()

    def _hash(self, *parts: str) -> str:
        return hmac.new(self.secret, "\x00".join(parts).encode(), hashlib.sha256).hexdigest()

    def token_hash(self, token: str) -> str:
        return self._hash("session", token)

    def methods(self) -> list[str]:
        return [m for m, snd in (("email", self.email_sender), ("phone", self.sender)) if snd is not None]

    # ------------------------------------------------------------------ codes
    def request_code(self, raw_login: str, ip: str = "") -> str:
        phone = normalize_login(raw_login)  # an email address or a phone number
        email = is_email(phone)
        sender = self.email_sender if email else self.sender
        if sender is None:
            raise AuthError(f"Sign-in by {'email' if email else 'mobile number'} is not available here. "
                            f"Use your {'mobile number' if email else 'email address'}.")
        self._limit_ip(ip)
        now = _now()
        with self.db.connect() as c:
            row = c.execute("SELECT * FROM otp_codes WHERE phone=?", (phone,)).fetchone()
            start, count = now, 0
            if row is not None:
                wait = RESEND_SECONDS - (now - datetime.fromisoformat(row["sent_at"])).total_seconds()
                if wait > 0:
                    raise AuthError(f"Wait {int(wait) + 1} seconds before asking for another code", 429)
                start = datetime.fromisoformat(row["window_start"])
                count = row["window_count"] if now - start < timedelta(hours=1) else 0
                start = start if count else now
                if count >= MAX_SENDS_PER_HOUR:
                    raise AuthError(f"Too many codes for this {'address' if email else 'number'}. Try again in an hour.", 429)
            code = f"{secrets.randbelow(10 ** 6):06d}"
            c.execute("DELETE FROM otp_codes WHERE phone=?", (phone,))
            c.execute("INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, sent_at, window_start, window_count) "
                      "VALUES (?,?,?,0,?,?,?)", (phone, self._hash("otp", phone, code),
                                                 _iso(now + timedelta(minutes=CODE_MINUTES)), _iso(now), _iso(start), count + 1))
        try:
            sender.send(phone, code)
        except Exception as exc:
            log.exception("Could not send OTP to %s", mask_login(phone))
            with self.db.connect() as c:  # let them retry straight away
                c.execute("DELETE FROM otp_codes WHERE phone=?", (phone,))
            raise AuthError(f"Could not send the code by {'email' if email else 'SMS'}. Try again in a minute.", 502) from exc
        return phone

    def _limit_ip(self, ip: str) -> None:
        if not ip:
            return
        t = time.monotonic()
        with self._ip_lock:
            recent = [s for s in self._ip_sends.get(ip, []) if t - s < 3600]
            if len(recent) >= MAX_SENDS_PER_IP_HOUR:
                raise AuthError("Too many sign-in attempts from this network. Try again later.", 429)
            self._ip_sends[ip] = recent + [t]

    def verify_code(self, raw_login: str, code: str, terms_version: Optional[str] = None) -> dict:
        """Checks the code and returns the user (created on first sign-in)."""
        phone = normalize_login(raw_login)
        code = re.sub(r"\s", "", code or "")
        now = _now()
        with self.db.connect() as c:
            row = c.execute("SELECT * FROM otp_codes WHERE phone=?", (phone,)).fetchone()
            if row is None or datetime.fromisoformat(row["expires_at"]) < now:
                raise AuthError("The code has expired. Ask for a new one.")
            # every guess is counted before comparing, in one statement, so parallel guesses cannot pass the limit
            counted = c.execute("UPDATE otp_codes SET attempts = attempts + 1 WHERE phone=? AND attempts < ?",
                                (phone, MAX_ATTEMPTS)).rowcount
        if counted != 1:
            raise AuthError("Too many wrong codes. Ask for a new one.", 429)
        if not hmac.compare_digest(row["code_hash"], self._hash("otp", phone, code)):
            left = MAX_ATTEMPTS - row["attempts"] - 1
            raise AuthError(f"Wrong code. {left} tr{'y' if left == 1 else 'ies'} left." if left else "Wrong code. Ask for a new one.")
        with self.db.connect() as c:
            # deleting the code is the claim on it: of two requests racing with the same code only one gets a row back
            if c.execute("DELETE FROM otp_codes WHERE phone=? AND code_hash=?", (phone, row["code_hash"])).rowcount != 1:
                raise AuthError("The code has already been used. Ask for a new one.")
            user = c.execute("SELECT id, phone FROM users WHERE phone=?", (phone,)).fetchone()
            if user is None:
                user = {"id": uuid.uuid4().hex, "phone": phone}
                c.execute("INSERT INTO users (id, phone, created_at, last_login_at) VALUES (?,?,?,?)",
                          (user["id"], phone, _iso(now), _iso(now)))
            else:
                c.execute("UPDATE users SET last_login_at=? WHERE id=?", (_iso(now), user["id"]))
            if terms_version:
                c.execute("UPDATE users SET terms_version=?, terms_accepted_at=? WHERE id=?",
                          (terms_version, _iso(now), user["id"]))
        return dict(user)

    # --------------------------------------------------------------- sessions
    def start_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        now = _now()
        with self.db.connect() as c:
            c.execute("DELETE FROM sessions WHERE expires_at < ?", (_iso(now),))
            c.execute("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                      (self.token_hash(token), user_id, _iso(now), _iso(now + timedelta(days=SESSION_DAYS))))
        return token

    def user_for(self, token: str) -> Optional[dict]:
        with self.db.connect() as c:
            row = c.execute("SELECT u.id, u.phone FROM sessions s JOIN users u ON u.id = s.user_id "
                            "WHERE s.token_hash=? AND s.expires_at > ?", (self.token_hash(token), _iso(_now()))).fetchone()
        return dict(row) if row else None

    def end_session(self, token: str) -> None:
        with self.db.connect() as c:
            c.execute("DELETE FROM sessions WHERE token_hash=?", (self.token_hash(token),))

    def delete_user(self, user_id: str) -> None:
        with self.db.connect() as c:
            c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
            c.execute("DELETE FROM users WHERE id=?", (user_id,))
