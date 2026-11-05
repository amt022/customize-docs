"""REST API (FastAPI). Run: uvicorn pdfmaster.api:app --port 8000"""
from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .engine.editor import Edit, EditError
from .engine.ocr import OcrUnavailable, tesseract_path
from .service import Conflict, DocumentService, NotFound, current_owner

logging.getLogger("fontTools").setLevel(logging.ERROR)

DATA = Path(os.environ.get("PDFMASTER_DATA", Path(__file__).resolve().parents[1] / "data"))
# Hosted mode: each browser gets its own private set of documents through a session cookie, and can
# sign in with a mobile number (auth.py) to keep them in an account.
MULTIUSER = os.environ.get("PDFMASTER_MULTIUSER", "") == "1"
SESSION_COOKIE = "formeasy_sid"
SESSION_DAYS = 30
COOKIE_SECURE = os.environ.get("PDFMASTER_COOKIE_SECURE", "1") != "0"  # set 0 only for plain-http testing
# Documents not touched for this long are deleted (0 = keep, the desktop default).
RETENTION_HOURS = float(os.environ.get("PDFMASTER_RETENTION_HOURS", "0"))  # browsers that did not sign in
ACCOUNT_RETENTION_DAYS = float(os.environ.get("PDFMASTER_ACCOUNT_RETENTION_DAYS", "0"))  # signed-in accounts
TRASH_DAYS = float(os.environ.get("PDFMASTER_TRASH_DAYS", "30"))  # "Recently deleted" is emptied after this (0 = never)
_TOKEN = os.environ.get("PDFMASTER_TOKEN")


def _startup_check() -> None:
    """Refuse configurations where every visitor would see every other visitor's documents."""
    hosted = bool(os.environ.get("PDFMASTER_DATABASE_URL")) or os.environ.get("PDFMASTER_STORAGE", "local").lower() == "s3"
    if hosted and not MULTIUSER and not _TOKEN and os.environ.get("PDFMASTER_SINGLE_USER") != "1":
        raise RuntimeError(
            "PostgreSQL / S3 storage is configured but PDFMASTER_MULTIUSER is not 1, so all visitors would share one "
            "document list. Set PDFMASTER_MULTIUSER=1 (or PDFMASTER_SINGLE_USER=1 if this really is a one-person server).")


_startup_check()
service = DocumentService(DATA)
if MULTIUSER:
    from .auth import Auth, AuthError, mask_phone, secret_from_env, sender_from_env

    auth = Auth(service.db, sender_from_env(), secret_from_env(DATA))
app = FastAPI(title="PDF Master API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("PDFMASTER_CORS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
API = "/api/v1"
MAX_UPLOAD = int(os.environ.get("PDFMASTER_MAX_UPLOAD_MB", "200")) * 1024 * 1024  # one PDF / whole request
MAX_IMAGE = 40 * 1024 * 1024  # one picture in "from images"
MAX_IMAGES = 200


@app.middleware("http")
async def _local_token(request: Request, call_next):
    # Desktop mode: the loopback server only answers the app window, which sends this token.
    if _TOKEN and request.url.path.startswith("/api/") and request.url.path != f"{API}/health":
        import hmac

        if not hmac.compare_digest(request.headers.get("x-pdfmaster-token", ""), _TOKEN):
            return JSONResponse({"success": False, "message": "Forbidden"}, status_code=403)
    size = request.headers.get("content-length")
    if size and size.isdigit() and int(size) > MAX_UPLOAD:
        return JSONResponse({"success": False, "message": _too_big(MAX_UPLOAD)}, status_code=413)
    if not MULTIUSER:
        return await call_next(request)
    from starlette.concurrency import run_in_threadpool

    sid = request.cookies.get(SESSION_COOKIE, "")
    fresh = not _valid_sid(sid)
    if fresh:
        sid = _new_sid()
    user = None if fresh else await run_in_threadpool(auth.user_for, sid)
    request.state.sid, request.state.user = sid, user
    token = current_owner.set(_owner(sid, user))
    try:
        response = await call_next(request)
    finally:
        current_owner.reset(token)
    replaced = any(h.startswith(f"{SESSION_COOKIE}=") for h in response.headers.getlist("set-cookie"))
    if not replaced and (fresh or request.url.path.startswith("/api/")):  # sliding expiry while the browser is in use
        _set_sid(response, sid)
    return response


@app.middleware("http")
async def _security_headers(request: Request, call_next):
    response = await call_next(request)
    if MULTIUSER:
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "same-origin")
        if COOKIE_SECURE:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return response


def _valid_sid(sid: str) -> bool:
    return len(sid) == 43 and sid.replace("-", "").replace("_", "").isalnum()


def _new_sid() -> str:
    import secrets

    return secrets.token_urlsafe(32)  # 43 chars; unguessable, so it is the key to this browser's documents


def _owner(sid: str, user: Optional[dict]) -> str:
    # anonymous owners are a hash of the cookie, so a database leak does not hand out working session cookies
    return f"u:{user['id']}" if user else hashlib.sha256(sid.encode()).hexdigest()


def _set_sid(response: Response, sid: str) -> None:
    response.set_cookie(SESSION_COOKIE, sid, max_age=SESSION_DAYS * 86400, httponly=True,
                        secure=COOKIE_SECURE, samesite="lax", path="/")


def _sweep() -> None:
    import threading
    import time

    def loop():
        while True:
            try:
                n = service.purge_older_than(RETENTION_HOURS, accounts=False) if RETENTION_HOURS > 0 else 0
                if ACCOUNT_RETENTION_DAYS > 0:
                    n += service.purge_older_than(ACCOUNT_RETENTION_DAYS * 24, accounts=True)
                if TRASH_DAYS > 0:
                    n += service.purge_trash(TRASH_DAYS)
                if n:
                    logging.getLogger("pdfmaster").info("Deleted %d expired document(s)", n)
            except Exception:
                logging.getLogger("pdfmaster").exception("Expiry sweep failed")
            time.sleep(15 * 60)

    threading.Thread(target=loop, name="pdfmaster-expiry", daemon=True).start()


if RETENTION_HOURS > 0 or ACCOUNT_RETENTION_DAYS > 0 or TRASH_DAYS > 0:
    _sweep()


def _too_big(limit: int) -> str:
    return f"File is too large (limit {limit // (1024 * 1024)} MB). Compress or split it first."


async def _read_limited(file: UploadFile, limit: int = MAX_UPLOAD) -> bytes:
    """Read an upload in chunks and stop as soon as it passes the limit (no Content-Length needed)."""
    parts, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, _too_big(limit))
        parts.append(chunk)
    return b"".join(parts)


def ok(data, message: str = "OK", status: int = 200) -> JSONResponse:
    return JSONResponse(
        {"success": True, "message": message, "data": data, "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        status_code=status,
    )


@app.exception_handler(HTTPException)
async def _http(_: Request, exc: HTTPException):
    return JSONResponse({"success": False, "message": str(exc.detail)}, status_code=exc.status_code)


@app.exception_handler(NotFound)
async def _nf(_: Request, exc: NotFound):
    return JSONResponse({"success": False, "message": f"Not found: {exc}"}, status_code=404)


@app.exception_handler(Conflict)
async def _conflict(_: Request, exc: Conflict):
    return JSONResponse({"success": False, "message": str(exc)}, status_code=409)


@app.exception_handler(EditError)
async def _edit(_: Request, exc: EditError):
    return JSONResponse({"success": False, "message": str(exc)}, status_code=422)


@app.exception_handler(OcrUnavailable)
async def _ocr(_: Request, exc: OcrUnavailable):
    return JSONResponse({"success": False, "message": str(exc), "ocrUnavailable": True}, status_code=503)


@app.exception_handler(PermissionError)
async def _perm(_: Request, exc: PermissionError):
    return JSONResponse({"success": False, "message": str(exc), "needsPassword": True}, status_code=401)


@app.exception_handler(ValueError)
async def _bad(_: Request, exc: ValueError):
    return JSONResponse({"success": False, "message": str(exc)}, status_code=400)


# ------------------------------------------------------------------ documents
@app.get(f"{API}/health")
def health():
    return ok({"status": "up"})


@app.get(f"{API}/session")
def session_info(request: Request):
    """Who is signed in, and what the UI tells the user about where their files are kept."""
    return ok(_session(getattr(request.state, "user", None)))


def _session(user: Optional[dict]) -> dict:
    return {"multiUser": MULTIUSER, "retentionHours": RETENTION_HOURS or None,
            "accountRetentionDays": ACCOUNT_RETENTION_DAYS or None, "maxUploadMb": MAX_UPLOAD // (1024 * 1024),
            "trashDays": TRASH_DAYS or None,
            "user": {"phone": mask_phone(user["phone"])} if user else None}


# ----------------------------------------------------------------- accounts
class CodeIn(BaseModel):
    phone: str = Field(min_length=6, max_length=24)


class VerifyIn(CodeIn):
    code: str = Field(min_length=4, max_length=10)


def _need_accounts() -> None:
    if not MULTIUSER:
        raise HTTPException(404, "Accounts are only available on the website")


def _auth_call(fn, *args):
    try:
        return fn(*args)
    except AuthError as exc:
        raise HTTPException(exc.status, str(exc))


@app.post(f"{API}/auth/code")
def send_code(body: CodeIn, request: Request):
    _need_accounts()
    from .auth import CODE_MINUTES, RESEND_SECONDS

    phone = _auth_call(auth.request_code, body.phone, request.client.host if request.client else "")
    return ok({"phone": mask_phone(phone), "resendSeconds": RESEND_SECONDS, "expiresMinutes": CODE_MINUTES}, "Code sent")


@app.post(f"{API}/auth/verify")
def verify_code(body: VerifyIn, request: Request):
    _need_accounts()
    user = _auth_call(auth.verify_code, body.phone, body.code)
    moved = 0
    if request.state.user is None:  # documents made before signing in come along
        moved = service.reassign_owner(_owner(request.state.sid, None), _owner("", user))
    else:
        auth.end_session(request.state.sid)
    # a new cookie value on sign-in, so a cookie someone saw earlier does not become a signed-in session
    sid = auth.start_session(user["id"])
    response = ok({**_session(user), "movedDocuments": moved}, "Signed in")
    _set_sid(response, sid)
    return response


@app.post(f"{API}/auth/logout")
def logout(request: Request):
    _need_accounts()
    auth.end_session(request.state.sid)
    response = ok(_session(None), "Signed out")
    _set_sid(response, _new_sid())
    return response


@app.delete(f"{API}/auth/account")
def delete_account(request: Request):
    """Erase the account and every document in it."""
    _need_accounts()
    user = request.state.user
    if user is None:
        raise HTTPException(401, "Sign in first")
    n = service.delete_owner(_owner("", user))
    auth.delete_user(user["id"])
    response = ok({**_session(None), "deletedDocuments": n}, "Account deleted")
    _set_sid(response, _new_sid())
    return response


@app.post(f"{API}/documents")
async def upload(file: UploadFile = File(...), password: str = Form("")):
    data = await _read_limited(file)
    doc = service.create(file.filename or "document.pdf", data, password)
    return ok(doc, "Document uploaded", 201)


@app.post(f"{API}/documents/from-images")
async def from_images(files: list[UploadFile] = File(...)):
    if len(files) > MAX_IMAGES:
        raise HTTPException(413, f"Too many pictures (limit {MAX_IMAGES}). Make several PDFs and merge them.")
    pictures = [(f.filename or "image", await _read_limited(f, MAX_IMAGE)) for f in files]
    return ok(service.create_from_images(pictures), "Document created", 201)


@app.get(f"{API}/documents")
def list_documents():
    return ok(service.list())


@app.get(f"{API}/documents/{{doc_id}}")
def get_document(doc_id: str):
    return ok(service.get(doc_id))


@app.delete(f"{API}/documents/{{doc_id}}")
def delete_document(doc_id: str):
    service.delete(doc_id)
    return ok(None, "Moved to Recently deleted")


@app.get(f"{API}/trash")
def list_trash():
    return ok(service.trash())


@app.post(f"{API}/trash/{{doc_id}}/restore")
def restore_document(doc_id: str):
    return ok(service.restore(doc_id), "Restored")


@app.delete(f"{API}/trash/{{doc_id}}")
def erase_document(doc_id: str):
    service.delete_forever(doc_id)
    return ok(None, "Deleted permanently")


@app.get(f"{API}/documents/{{doc_id}}/file")
def get_file(doc_id: str, version: Optional[int] = None):
    data = service.data(doc_id, version)
    return Response(data, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@app.get(f"{API}/documents/{{doc_id}}/download")
def download(doc_id: str):
    doc = service.get(doc_id)
    data = service.data(doc_id)
    name = doc["original_name"]
    if doc["current_version"]:
        stem = name[:-4] if name.lower().endswith(".pdf") else name
        name = f"{stem}-edited.pdf"
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"})


@app.get(f"{API}/documents/{{doc_id}}/pages/{{page}}/text")
def page_text(doc_id: str, page: int, version: Optional[int] = None):
    return ok(service.page_model(doc_id, page, version))


@app.get(f"{API}/documents/{{doc_id}}/pages/{{page}}/render.png")
def render(doc_id: str, page: int, version: Optional[int] = None, zoom: float = 1.5):
    return Response(service.render(doc_id, page, version, max(0.2, min(zoom, 6))), media_type="image/png")


# ---------------------------------------------------------------------- edits
class EditIn(BaseModel):
    glyphs: list[int] = Field(min_length=1)
    text: str = Field(max_length=2000)
    anchor: Literal["left", "right", "center", "auto"] = "auto"
    fit: Literal["none", "squeeze", "reflow", "auto"] = "auto"
    style: Optional[dict] = None  # scanned pages: {"family": "sans"|"serif"|"mono", "bold": bool, "italic": bool}


class ReplaceIn(BaseModel):
    page: int
    edits: list[EditIn] = Field(min_length=1, max_length=500)
    baseVersion: Optional[int] = None
    dryRun: bool = False


@app.post(f"{API}/documents/{{doc_id}}/edit/replace-text")
def replace_text(doc_id: str, body: ReplaceIn):
    edits = [Edit(e.glyphs, e.text, e.anchor, e.fit, e.style) for e in body.edits]
    res = service.replace_text(doc_id, body.page, edits, body.baseVersion, body.dryRun)
    return ok(res, "Preview ready" if body.dryRun else "Text replaced")


class FindIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    matchCase: bool = False
    wholeWord: bool = False


@app.post(f"{API}/documents/{{doc_id}}/find")
def find(doc_id: str, body: FindIn):
    return ok(service.find(doc_id, body.query, body.matchCase, body.wholeWord))


class FindReplaceIn(FindIn):
    replacement: str = Field(max_length=2000)
    anchor: Literal["left", "right", "center", "auto"] = "auto"
    fit: Literal["none", "squeeze", "reflow", "auto"] = "auto"
    baseVersion: Optional[int] = None
    dryRun: bool = False


@app.post(f"{API}/documents/{{doc_id}}/edit/find-replace")
def find_replace(doc_id: str, body: FindReplaceIn):
    res = service.find_replace(doc_id, body.query, body.replacement, body.matchCase, body.wholeWord,
                               body.anchor, body.fit, body.baseVersion, body.dryRun)
    return ok(res)


@app.post(f"{API}/documents/{{doc_id}}/undo")
def undo(doc_id: str):
    return ok(service.undo(doc_id))


@app.post(f"{API}/documents/{{doc_id}}/redo")
def redo(doc_id: str):
    return ok(service.redo(doc_id))


# ------------------------------------------------------------------------ OCR
@app.get(f"{API}/ocr/status")
def ocr_status():
    return ok({"available": tesseract_path() is not None, "engine": "tesseract", "path": tesseract_path(),
               "languages": ["eng", "hin"]})


class OcrIn(BaseModel):
    pages: Optional[list[int]] = None  # default: every scanned page
    langs: str = Field("eng+hin", pattern=r"^[a-z_]{3,8}(\+[a-z_]{3,8})*$")
    force: bool = False


@app.post(f"{API}/documents/{{doc_id}}/ocr")
def start_ocr(doc_id: str, body: OcrIn):
    return ok(service.start_ocr(doc_id, body.pages, body.langs, body.force), "OCR started", 202)


@app.get(f"{API}/jobs/{{job_id}}")
def job(job_id: str):
    return ok(service.job(job_id))


class VersionIn(BaseModel):
    baseVersion: Optional[int] = None


@app.post(f"{API}/documents/{{doc_id}}/ocr/text-layer")
def text_layer(doc_id: str, body: VersionIn):
    return ok(service.add_text_layer(doc_id, body.baseVersion), "Searchable text layer added")


@app.get(f"{API}/documents/{{doc_id}}/check")
def check(doc_id: str):
    return ok(service.check(doc_id))


# ------------------------------------------------------------- AI assistant
from .assistant import Assistant, AssistantUnavailable  # noqa: E402

assistant = Assistant(service)


@app.exception_handler(AssistantUnavailable)
async def _assistant_down(_: Request, exc: AssistantUnavailable):
    return JSONResponse({"success": False, "message": str(exc), "assistantUnavailable": True}, status_code=503)


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    conversationId: Optional[str] = None


@app.post(f"{API}/documents/{{doc_id}}/assistant")
def chat(doc_id: str, body: ChatIn):
    return ok(assistant.chat(doc_id, body.message, body.conversationId))


@app.delete(f"{API}/assistant/{{conversation_id}}")
def reset_chat(conversation_id: str):
    assistant.reset(conversation_id)
    return ok(None)


# ---------------------------------------------------------------- annotations
HEX = r"^#[0-9a-fA-F]{6}$"


class AnnotIn(BaseModel):
    page: int
    type: Literal["highlight", "underline", "strikeout", "squiggly", "note", "rect", "ellipse", "ink",
                  "signature", "image", "stamp"]
    glyphs: list[int] = []
    rect: Optional[list[float]] = Field(None, min_length=4, max_length=4)
    x: Optional[float] = None
    y: Optional[float] = None
    paths: Optional[list[list[list[float]]]] = None
    text: str = Field("", max_length=5000)
    color: Optional[str] = Field(None, pattern=HEX)
    fill: Optional[str] = Field(None, pattern=HEX)
    opacity: Optional[float] = Field(None, ge=0.05, le=1)
    width: Optional[float] = Field(None, gt=0, le=40)
    image: Optional[str] = None  # data URL (PNG/JPEG) for signature/image
    author: str = Field("", max_length=100)
    baseVersion: Optional[int] = None


@app.post(f"{API}/documents/{{doc_id}}/annotations")
def add_annotation(doc_id: str, body: AnnotIn):
    spec = body.model_dump(exclude_none=True, exclude={"page", "baseVersion"})
    return ok(service.annotate(doc_id, body.page, spec, body.baseVersion), "Annotation added")


class ImageIn(BaseModel):
    action: Literal["insert", "transform", "delete", "replace"]
    index: Optional[int] = Field(None, ge=0)
    bbox: Optional[list[float]] = Field(None, min_length=4, max_length=4)  # new position and size (page coordinates)
    rect: Optional[list[float]] = Field(None, min_length=4, max_length=4)  # insert: the area to fit the picture in
    rotate: Optional[int] = None  # degrees, multiple of 90
    image: Optional[str] = None  # data URL (PNG / JPEG / GIF / WebP) for insert and replace
    fit: Literal["contain", "stretch"] = "contain"
    baseVersion: Optional[int] = None


@app.post(f"{API}/documents/{{doc_id}}/pages/{{page}}/images")
def image_operation(doc_id: str, page: int, body: ImageIn):
    spec = body.model_dump(exclude_none=True, exclude={"baseVersion"})
    return ok(service.image_operation(doc_id, page, spec, body.baseVersion), "Image updated")


@app.get(f"{API}/documents/{{doc_id}}/pages/{{page}}/annotations")
def list_annotations(doc_id: str, page: int):
    return ok(service.annotations(doc_id, page))


@app.delete(f"{API}/documents/{{doc_id}}/pages/{{page}}/annotations/{{nm}}")
def delete_annotation(doc_id: str, page: int, nm: str, baseVersion: Optional[int] = None):
    return ok(service.delete_annotation(doc_id, page, nm, baseVersion))


class WatermarkIn(BaseModel):
    text: str = Field("", max_length=100)
    pages: Optional[list[int]] = None
    color: str = Field("#888888", pattern=HEX)
    opacity: float = Field(0.18, ge=0.03, le=1)
    angle: float = Field(45, ge=-90, le=90)
    size: Optional[float] = Field(None, gt=4, le=400)
    remove: bool = False
    baseVersion: Optional[int] = None


@app.post(f"{API}/documents/{{doc_id}}/watermark")
def watermark(doc_id: str, body: WatermarkIn):
    spec = body.model_dump(exclude_none=True, exclude={"baseVersion"})
    return ok(service.watermark(doc_id, spec, body.baseVersion))


# ---------------------------------------------------------------------- pages
class PageOpIn(BaseModel):
    op: Literal["rotate", "delete", "reorder", "move", "insert-blank"]
    pages: list[int] = []
    degrees: int = 90
    order: list[int] = []
    from_: Optional[int] = Field(None, alias="from")
    to: Optional[int] = None
    after: Optional[int] = None
    baseVersion: Optional[int] = None


@app.post(f"{API}/documents/{{doc_id}}/pages")
def page_operation(doc_id: str, body: PageOpIn):
    params = body.model_dump(by_alias=True, exclude_none=True)
    return ok(service.page_operation(doc_id, body.op, params, body.baseVersion))


@app.post(f"{API}/documents/{{doc_id}}/merge")
async def merge(doc_id: str, file: UploadFile = File(...), after: Optional[int] = Form(None),
                baseVersion: Optional[int] = Form(None), password: str = Form("")):
    data = await _read_limited(file)
    from .engine.document import open_pdf, save_pdf

    try:
        data = save_pdf(open_pdf(data, password))  # validates and decrypts
    except Exception as exc:
        if "password" in str(exc).lower():
            raise PermissionError("The PDF to insert is password protected")
        raise ValueError(f"Cannot read PDF: {exc}")
    params = {"data": data, "after": after, "name": file.filename}
    return ok(service.page_operation(doc_id, "merge", params, baseVersion))


class ExtractIn(BaseModel):
    pages: str = Field(min_length=1, max_length=200)  # "1-3,5"
    splitEach: bool = False


@app.post(f"{API}/documents/{{doc_id}}/extract")
def extract(doc_id: str, body: ExtractIn):
    return ok(service.extract(doc_id, body.pages, body.splitEach), "Created", 201)


class ExportIn(BaseModel):
    userPassword: str = Field("", max_length=128)
    ownerPassword: str = Field("", max_length=128)
    allowPrint: bool = True
    allowCopy: bool = True
    allowModify: bool = True
    allowAnnotate: bool = True
    compression: Literal["none", "lossless", "balanced", "strong"] = "none"


@app.get(f"{API}/documents/{{doc_id}}/compression")
def compression_options(doc_id: str):
    return ok(service.compression_options(doc_id))


@app.post(f"{API}/documents/{{doc_id}}/export")
def export(doc_id: str, body: ExportIn):
    from .engine.security import Protection

    doc = service.get(doc_id)
    data, stats = service.export(doc_id, Protection(body.userPassword, body.ownerPassword, body.allowPrint,
                                                    body.allowCopy, body.allowModify, body.allowAnnotate), body.compression)
    stem = doc["original_name"][:-4] if doc["original_name"].lower().endswith(".pdf") else doc["original_name"]
    name = f"{stem}{'-edited' if doc['current_version'] else ''}{'-protected' if body.userPassword or body.ownerPassword else ''}.pdf"
    return Response(data, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
                             "X-Original-Size": str(stats["originalSize"]), "X-Compressed-Size": str(stats["size"])})


@app.get(f"{API}/documents/{{doc_id}}/convert")
def convert(doc_id: str, format: Literal["jpg", "png", "docx", "xlsx", "txt"], pages: str = Query("", max_length=200), dpi: int = 150):
    data, name, mime, info = service.convert(doc_id, format, pages, dpi)
    return Response(data, media_type=mime,
                    headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
                             "X-Pages-Without-Text": ",".join(map(str, info["noText"])),
                             "Access-Control-Expose-Headers": "Content-Disposition, X-Pages-Without-Text"})


@app.get(f"{API}/documents/{{doc_id}}/compare/{{page}}.png")
def compare_png(doc_id: str, page: int, a: int = 0, b: Optional[int] = None):
    png, stats = service.compare_png(doc_id, page, a, b)
    return Response(png, media_type="image/png", headers={"X-Diff-Stats": str(stats["changedPixels"])})


@app.get(f"{API}/documents/{{doc_id}}/compare/{{page}}")
def compare_stats(doc_id: str, page: int, a: int = 0, b: Optional[int] = None):
    _, stats = service.compare_png(doc_id, page, a, b)
    return ok(stats)


# ------------------------------------------------------------- web frontend
_WEB = Path(os.environ.get("PDFMASTER_WEB", Path(__file__).resolve().parents[2] / "web" / "dist"))
if _WEB.is_dir():
    app.mount("/assets", StaticFiles(directory=_WEB / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = (_WEB / path).resolve()
        if path and f.is_file() and _WEB.resolve() in f.parents:
            return FileResponse(f)
        # index.html must never be cached: it points at the current hashed bundles
        return FileResponse(_WEB / "index.html", headers={"Cache-Control": "no-cache"})
