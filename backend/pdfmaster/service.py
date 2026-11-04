"""Document storage, versioning (undo/redo) and edit orchestration.

Metadata lives in SQLite or PostgreSQL (`db.py`); PDF bytes and OCR results live in a
blob store, a local folder or S3 (`storage.py`), one immutable blob per version.
Version 0 is always the untouched upload.

Every document belongs to an owner (`current_owner`, set per request by the API); a
document of another owner behaves as if it did not exist. Desktop mode has one owner, "".
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Optional

from . import storage
from .db import Database
from .engine import ocr as ocr_engine
from .engine import pages as page_ops
from .engine.scanedit import edit_scan
from .engine.document import EditResult, apply_edits, extract_page, find_matches, is_signed, open_pdf, save_pdf
from .engine.editor import Edit, EditError
from .engine.render import page_count as count_pages
from .engine.security import Protection, protect
from .engine.validate import diff_png, render_png

SCHEMA = """
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    current_version INTEGER NOT NULL DEFAULT 0,
    head_version INTEGER NOT NULL DEFAULT 0,
    was_encrypted INTEGER NOT NULL DEFAULT 0,
    is_signed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    owner TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS document_versions (
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    checksum TEXT NOT NULL,
    change_summary TEXT,
    created_at TEXT NOT NULL,
    page_count INTEGER,
    PRIMARY KEY (document_id, version_number)
);
CREATE TABLE IF NOT EXISTS edit_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    result_version INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    operation_type TEXT NOT NULL,
    request TEXT NOT NULL,
    report TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_doc ON edit_operations(document_id, result_version);
CREATE TABLE IF NOT EXISTS processing_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    result TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON processing_jobs(status)
"""
# columns added after the first release; created on old databases at start-up
COLUMNS = {
    "document_versions": [("page_count", "INTEGER")],
    "documents": [("owner", "TEXT NOT NULL DEFAULT ''"), ("deleted_at", "TEXT")],
}
INDEXES = """
CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner, updated_at);
CREATE INDEX IF NOT EXISTS idx_docs_updated ON documents(updated_at)
"""

MAX_UPLOAD = int(os.environ.get("PDFMASTER_MAX_UPLOAD_MB", "200")) * 1024 * 1024
current_owner: ContextVar[str] = ContextVar("pdfmaster_owner", default="")
log = logging.getLogger("pdfmaster")


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class DocumentService:
    def __init__(self, root: Path, store=None, database_url: Optional[str] = None):
        self.root = Path(root)  # local working folder: SQLite file (if used), tessdata copy, font index
        self.root.mkdir(parents=True, exist_ok=True)
        self.store = store or storage.from_env(self.root)
        url = os.environ.get("PDFMASTER_DATABASE_URL", "") if database_url is None else database_url
        self.db = Database(url, self.root / "pdfmaster.db")
        self._lock = threading.RLock()
        self._jobs = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pdfmaster-job")
        self._models: OrderedDict[tuple, dict] = OrderedDict()
        self.db.init(SCHEMA, COLUMNS)
        self.db.init(INDEXES, {})

    def _db(self):
        return self.db.connect()

    # ----------------------------------------------------------------- basics
    @staticmethod
    def _blob(doc_id: str, name: str) -> str:
        if not doc_id.replace("-", "").isalnum():
            raise NotFound(doc_id)
        return f"docs/{doc_id}/{name}"

    def create(self, name: str, data: bytes, password: str = "") -> dict:
        if len(data) > MAX_UPLOAD:
            raise ValueError(f"File is larger than {MAX_UPLOAD // (1024 * 1024)} MB")
        if not data.lstrip()[:5].startswith(b"%PDF"):
            raise ValueError("Not a PDF file")
        try:
            pdf = open_pdf(data, password)
        except Exception as exc:
            if "password" in str(exc).lower():
                raise PermissionError("PDF is password protected") from exc
            raise ValueError(f"Cannot read PDF: {exc}") from exc
        encrypted = pdf.is_encrypted
        if encrypted:
            data = save_pdf(pdf)  # keep a decrypted working copy
        doc_id = uuid.uuid4().hex
        checksum = hashlib.sha256(data).hexdigest()
        key = f"v0-{uuid.uuid4().hex[:16]}.pdf"
        self.store.put(self._blob(doc_id, key), data)
        now = _now()
        with self._db() as db:
            db.execute(
                "INSERT INTO documents (id, original_name, file_size, page_count, checksum, current_version, head_version, "
                "was_encrypted, is_signed, created_at, updated_at, owner) VALUES (?,?,?,?,?,0,0,?,?,?,?,?)",
                (doc_id, name, len(data), len(pdf.pages), checksum, int(encrypted), int(is_signed(pdf)), now, now,
                 current_owner.get()),
            )
            db.execute("INSERT INTO document_versions (document_id, version_number, storage_key, checksum, change_summary, "
                       "created_at, page_count) VALUES (?,?,?,?,?,?,?)",
                       (doc_id, 0, key, checksum, "Original upload", now, len(pdf.pages)))
        return self.get(doc_id)

    def create_from_images(self, pictures: list[tuple[str, bytes]]) -> dict:
        from .engine.images import new_document

        if sum(len(d) for _, d in pictures) > MAX_UPLOAD:
            raise ValueError(f"Pictures are larger than {MAX_UPLOAD // (1024 * 1024)} MB in total")
        first = pictures[0][0].rsplit(".", 1)[0] if pictures else "images"
        return self.create(f"{first or 'images'}.pdf", new_document([d for _, d in pictures]))

    def get(self, doc_id: str) -> dict:
        with self._db() as db:
            row = db.execute("SELECT * FROM documents WHERE id=? AND owner=? AND deleted_at IS NULL", (doc_id, current_owner.get())).fetchone()
            if row is None:
                raise NotFound(doc_id)
            ops = db.execute(
                "SELECT result_version, page_number, operation_type, request, report, created_at FROM edit_operations "
                "WHERE document_id=? ORDER BY result_version", (doc_id,)
            ).fetchall()
        doc = dict(row)
        doc.pop("owner", None)
        doc.pop("deleted_at", None)
        doc["canUndo"] = doc["current_version"] > 0
        doc["canRedo"] = doc["current_version"] < doc["head_version"]
        doc["history"] = [
            {
                "version": o["result_version"], "page": o["page_number"], "type": o["operation_type"],
                "summary": json.loads(o["request"]).get("summary", ""), "createdAt": o["created_at"],
                "applied": o["result_version"] <= doc["current_version"],
                "layoutPreserved": json.loads(o["report"]).get("verification", {}).get("layoutPreserved"),
            }
            for o in ops
        ]
        return doc

    def list(self) -> list[dict]:
        with self._db() as db:
            rows = db.execute("SELECT * FROM documents WHERE owner=? AND deleted_at IS NULL ORDER BY updated_at DESC",
                              (current_owner.get(),)).fetchall()
        return [{k: v for k, v in dict(r).items() if k not in ("owner", "deleted_at")} for r in rows]

    # Deleting moves a document to "Recently deleted"; it is erased only from there (or after TRASH_DAYS).
    def delete(self, doc_id: str) -> None:
        self.get(doc_id)
        with self._db() as db:
            db.execute("UPDATE documents SET deleted_at=? WHERE id=?", (_now(), doc_id))

    def trash(self) -> list[dict]:
        with self._db() as db:
            rows = db.execute("SELECT * FROM documents WHERE owner=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC",
                              (current_owner.get(),)).fetchall()
        return [{k: v for k, v in dict(r).items() if k != "owner"} for r in rows]

    def restore(self, doc_id: str) -> dict:
        with self._db() as db:
            n = db.execute("UPDATE documents SET deleted_at=NULL WHERE id=? AND owner=? AND deleted_at IS NOT NULL",
                           (doc_id, current_owner.get())).rowcount
        if not n:
            raise NotFound(doc_id)
        return self.get(doc_id)

    def delete_forever(self, doc_id: str) -> None:
        with self._db() as db:
            row = db.execute("SELECT id FROM documents WHERE id=? AND owner=? AND deleted_at IS NOT NULL",
                             (doc_id, current_owner.get())).fetchone()
        if row is None:
            raise NotFound(doc_id)
        self._remove(doc_id)

    def purge_trash(self, days: float) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self._db() as db:
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE deleted_at < ?", (cutoff,)).fetchall()]
        for doc_id in ids:
            try:
                self._remove(doc_id)
            except Exception:
                log.exception("Could not erase deleted document %s", doc_id)
        return len(ids)

    def _remove(self, doc_id: str) -> None:
        with self._db() as db:
            db.execute("DELETE FROM documents WHERE id=?", (doc_id,))
        self.store.delete_prefix(self._blob(doc_id, ""))

    def reassign_owner(self, old: str, new: str) -> int:
        """Move documents to another owner (an anonymous browser signing in to an account)."""
        with self._db() as db:
            return db.execute("UPDATE documents SET owner=? WHERE owner=?", (new, old)).rowcount

    def delete_owner(self, owner: str) -> int:
        with self._db() as db:
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE owner=?", (owner,)).fetchall()]
        for doc_id in ids:
            self._remove(doc_id)
        return len(ids)

    def purge_older_than(self, hours: float, accounts: Optional[bool] = None) -> int:
        """Delete documents not touched for `hours`: all of them, or only account (True) / anonymous (False) ones."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
        which = "" if accounts is None else " AND owner LIKE 'u:%'" if accounts else " AND owner NOT LIKE 'u:%'"
        with self._db() as db:
            ids = [r["id"] for r in db.execute("SELECT id FROM documents WHERE updated_at < ?" + which, (cutoff,)).fetchall()]
        for doc_id in ids:
            try:
                self._remove(doc_id)
            except Exception:  # one bad document must not stop the sweep
                log.exception("Could not delete expired document %s", doc_id)
        return len(ids)

    def _version_key(self, doc_id: str, doc: dict, version: Optional[int]) -> str:
        v = doc["current_version"] if version is None else version
        if v < 0 or v > doc["head_version"]:
            raise NotFound(f"version {v}")
        with self._db() as db:
            row = db.execute("SELECT storage_key FROM document_versions WHERE document_id=? AND version_number=?",
                             (doc_id, v)).fetchone()
        if row is None:
            raise NotFound(f"version {v}")
        return self._blob(doc_id, row["storage_key"])

    def data(self, doc_id: str, version: Optional[int] = None) -> bytes:
        key = self._version_key(doc_id, self.get(doc_id), version)
        data = self.store.get(key)
        if data is None:
            raise NotFound(f"file of {doc_id}")
        return data

    # ------------------------------------------------------------------ pages
    def page_model(self, doc_id: str, page: int, version: Optional[int] = None) -> dict:
        doc = self.get(doc_id)
        if not 1 <= page <= doc["page_count"]:
            raise NotFound(f"page {page}")
        key = self._version_key(doc_id, doc, version)
        model = self._models.get((key, page))
        if model is None:  # version blobs never change, so the blob key is a safe cache key
            data = self.store.get(key)
            if data is None:
                raise NotFound(f"file of {doc_id}")
            model = extract_page(data, page - 1)
            with self._lock:
                self._models[(key, page)] = model
                while len(self._models) > 64:
                    self._models.popitem(last=False)
        if model["type"] != "scanned":
            return model
        ocr = self.get_ocr(doc_id, page, version)
        if ocr is not None:
            return {**ocr_engine.ocr_page_model(page - 1, model["box"], model["rotation"], ocr), "images": model.get("images", [])}
        return {**model, "ocrAvailable": ocr_engine.tesseract_path() is not None}

    # -------------------------------------------------------------------- OCR
    def _page_key(self, data: bytes, page: int) -> str:
        return _cached_key(hashlib.sha1(data).hexdigest(), data, page - 1)

    def _load_ocr(self, doc_id: str, data: bytes, page: int) -> Optional[dict]:
        raw = self.store.get(self._blob(doc_id, f"ocr/{self._page_key(data, page)}.json"))
        return json.loads(raw) if raw is not None else None

    def get_ocr(self, doc_id: str, page: int, version: Optional[int] = None) -> Optional[dict]:
        res = self._load_ocr(doc_id, self.data(doc_id, version), page)
        return res if res and res.get("words") and res.get("v", 1) >= ocr_engine.OCR_VERSION else None  # an empty result is a failed run, so offer OCR again

    def save_ocr(self, doc_id: str, data: bytes, page: int, ocr: dict) -> None:
        self.store.put(self._blob(doc_id, f"ocr/{self._page_key(data, page)}.json"), json.dumps(ocr).encode("utf-8"))

    def start_ocr(self, doc_id: str, pages: Optional[list[int]], langs: str, force: bool = False) -> dict:
        doc = self.get(doc_id)
        if ocr_engine.tesseract_path() is None:
            raise ocr_engine.OcrUnavailable(
                "Tesseract OCR is not installed on this computer. Install it (winget install UB-Mannheim.TesseractOCR, "
                "or set PDFMASTER_TESSERACT to tesseract.exe) and try again.")
        data = self.data(doc_id)
        if pages is None:
            pages = [p for p in range(1, doc["page_count"] + 1) if self.page_model(doc_id, p)["type"] == "scanned"]
        job_id = uuid.uuid4().hex
        now = _now()
        with self._db() as db:
            db.execute("INSERT INTO processing_jobs VALUES (?,?,?,?,?,?,?,?,?)",
                       (job_id, doc_id, "OCR", "QUEUED", 0, None, None, now, now))
        self._jobs.submit(self._run_ocr, job_id, doc_id, data, pages, langs, force)
        return self.job(job_id)

    def _job_update(self, job_id: str, **fields) -> None:
        sets = ", ".join(f"{k}=?" for k in fields)
        with self._db() as db:
            db.execute(f"UPDATE processing_jobs SET {sets}, updated_at=? WHERE id=?", (*fields.values(), _now(), job_id))

    def _run_ocr(self, job_id: str, doc_id: str, data: bytes, pages: list[int], langs: str, force: bool) -> None:
        self._job_update(job_id, status="RUNNING")
        done = []
        try:
            for k, p in enumerate(pages):
                old = None if force else self._load_ocr(doc_id, data, p)
                if not (old and old.get("words")):
                    self.save_ocr(doc_id, data, p, ocr_engine.run_tesseract(data, p - 1, self.root, langs))
                done.append(p)
                self._job_update(job_id, progress=(k + 1) / max(len(pages), 1))
            self._job_update(job_id, status="DONE", progress=1.0, result=json.dumps({"pages": done}))
        except Exception as exc:  # reported through the job, not lost in a thread
            self._job_update(job_id, status="FAILED", error=str(exc)[:1000], result=json.dumps({"pages": done}))

    def job(self, job_id: str) -> dict:
        with self._db() as db:
            row = db.execute("SELECT j.* FROM processing_jobs j JOIN documents d ON d.id = j.document_id "
                             "WHERE j.id=? AND d.owner=?", (job_id, current_owner.get())).fetchone()
        if row is None:
            raise NotFound(job_id)
        d = dict(row)
        d["result"] = json.loads(d["result"]) if d["result"] else None
        return d

    def _scanned_ocr(self, doc_id: str, data: bytes) -> dict[int, dict]:
        """OCR results of scanned pages that have them (1-based page keys)."""
        from .engine.interpreter import PageModel

        out = {}
        pdf = None
        for p in range(1, count_pages(data) + 1):
            ocr = self._load_ocr(doc_id, data, p)
            if ocr is not None:
                pdf = pdf or open_pdf(data)
                if PageModel(pdf, p - 1).page_type() == "scanned":
                    out[p] = ocr
        return out

    def add_text_layer(self, doc_id: str, base_version: Optional[int]) -> dict:
        """New version with an invisible OCR text layer on every OCR'd scanned page (searchable PDF)."""
        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        data = self.data(doc_id)
        scanned = self._scanned_ocr(doc_id, data)
        if not scanned:
            raise EditError("No OCR results yet; run OCR first")
        pdf = open_pdf(data)
        for p, ocr in scanned.items():
            ocr_engine.add_text_layer(pdf, p - 1, ocr["words"])
        out = save_pdf(pdf)
        for p, ocr in scanned.items():
            self.save_ocr(doc_id, out, p, ocr)
        v = self._commit(doc_id, doc, out, min(scanned), "OCR_LAYER",
                         {"summary": f"Searchable text layer on {len(scanned)} page(s)"}, {})
        return {**self.get(doc_id), "version": v}

    # ------------------------------------------------------------------ edits
    def _check_version(self, doc: dict, base_version: Optional[int]) -> None:
        if base_version is not None and base_version != doc["current_version"]:
            raise Conflict(f"Document is at version {doc['current_version']}, request was made against {base_version}")

    def _commit(self, doc_id: str, doc: dict, data: bytes, page: int, kind: str, request: dict, report: dict) -> int:
        cur = doc["current_version"]
        new_v = cur + 1
        checksum = hashlib.sha256(data).hexdigest()
        key = f"v{new_v}-{uuid.uuid4().hex[:16]}.pdf"
        self.store.put(self._blob(doc_id, key), data)  # unique name: nothing else reads it until the row exists
        pages = count_pages(data)
        now = _now()
        try:
            with self._lock, self._db() as db:
                # the version guard makes two servers (or two tabs) editing at once safe: one wins, one gets Conflict
                moved = db.execute("UPDATE documents SET current_version=?, head_version=?, page_count=?, updated_at=? "
                                   "WHERE id=? AND current_version=?", (new_v, new_v, pages, now, doc_id, cur)).rowcount
                if moved != 1:
                    raise Conflict("The document was changed meanwhile; reload and try again")
                # editing after undo discards the redo branch
                dropped = [r["storage_key"] for r in db.execute(
                    "SELECT storage_key FROM document_versions WHERE document_id=? AND version_number>?", (doc_id, cur)).fetchall()]
                db.execute("DELETE FROM document_versions WHERE document_id=? AND version_number>?", (doc_id, cur))
                db.execute("DELETE FROM edit_operations WHERE document_id=? AND result_version>?", (doc_id, cur))
                db.execute("INSERT INTO document_versions (document_id, version_number, storage_key, checksum, change_summary, "
                           "created_at, page_count) VALUES (?,?,?,?,?,?,?)",
                           (doc_id, new_v, key, checksum, request.get("summary", ""), now, pages))
                db.execute(
                    "INSERT INTO edit_operations (document_id,result_version,page_number,operation_type,request,report,created_at) VALUES (?,?,?,?,?,?,?)",
                    (doc_id, new_v, page, kind, json.dumps(request), json.dumps(report), now),
                )
        except BaseException:
            self.store.delete(self._blob(doc_id, key))
            raise
        for old in dropped:
            if old != key:
                self.store.delete(self._blob(doc_id, old))
        return new_v

    def replace_text(self, doc_id: str, page: int, edits: list[Edit], base_version: Optional[int], dry_run: bool) -> dict:
        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        data = self.data(doc_id)
        if self.page_model(doc_id, page).get("source") == "ocr":
            return self._replace_scanned(doc_id, doc, data, page, self.get_ocr(doc_id, page), edits, dry_run)
        result: EditResult = apply_edits(data, page - 1, edits)
        summary = "; ".join(f"'{r['originalText']}' → '{r['newText']}'" for r in result.reports)
        out = {"dryRun": dry_run, "reports": result.reports, "verification": result.verification, "summary": summary}
        if dry_run:
            out["version"] = doc["current_version"]
            return out
        request = {"summary": summary, "edits": [e.__dict__ for e in edits]}
        out["version"] = self._commit(doc_id, doc, result.data, page, "REPLACE_TEXT", request, out)
        out["page"] = result.page
        return out

    @staticmethod
    def _scan_apply(data: bytes, page: int, ocr: dict, edits: list[Edit]) -> tuple[bytes, dict, list[dict]]:
        reports, cur, cur_ocr = [], data, ocr
        # later words first so earlier word indices stay valid
        for e in sorted(edits, key=lambda e: -min(e.glyphs)):
            st = e.style or {}
            res = edit_scan(cur, page - 1, cur_ocr, e.glyphs, e.text, e.anchor,
                            st.get("family", "auto"), bool(st.get("bold")), bool(st.get("italic")))
            cur, cur_ocr = res.data, res.ocr
            reports.append(res.report)
        return cur, cur_ocr, reports

    def _replace_scanned(self, doc_id, doc, data, page, ocr, edits, dry_run) -> dict:
        cur, cur_ocr, reports = self._scan_apply(data, page, ocr, edits)
        _, stats = diff_png(data, cur, page - 1, zoom=1.0)
        verification = {"layoutPreserved": all(r["fits"] for r in reports), "changedPixels": stats["changedPixels"],
                        "movedGlyphs": 0, "newTextVerified": True, "warnings": []}
        summary = "; ".join(f"'{r['originalText']}' → '{r['newText']}'" for r in reports)
        out = {"dryRun": dry_run, "reports": reports, "verification": verification, "summary": summary}
        if dry_run:
            out["version"] = doc["current_version"]
            return out
        self.save_ocr(doc_id, cur, page, cur_ocr)
        out["version"] = self._commit(doc_id, doc, cur, page, "REPLACE_SCANNED_TEXT",
                                      {"summary": summary, "edits": [e.__dict__ for e in edits]}, out)
        out["page"] = self.page_model(doc_id, page)
        return out

    def find(self, doc_id: str, query: str, match_case: bool, whole_word: bool) -> list[dict]:
        if not query:
            return []
        data = self.data(doc_id)
        hits = find_matches(data, query, match_case, whole_word)
        out = [{"page": p + 1, **h} for p, lst in sorted(hits.items()) for h in lst]
        out += self._find_scanned(doc_id, data, query, match_case, whole_word)
        return sorted(out, key=lambda h: h["page"])

    def _find_scanned(self, doc_id, data, query, match_case, whole_word) -> list[dict]:
        import re

        pat = re.escape(query)
        if whole_word:
            pat = r"(?<!\w)" + pat + r"(?!\w)"
        rx = re.compile(pat, 0 if match_case else re.IGNORECASE)
        out = []
        for p, ocr in self._scanned_ocr(doc_id, data).items():
            model = ocr_engine.ocr_page_model(p - 1, [0, 0, 0, 0], 0, ocr)
            for line in model["lines"]:
                for m in rx.finditer(line["text"]):
                    ids = sorted({i for i in line["map"][m.start():m.end()] if i >= 0})
                    if ids:
                        out.append({"page": p, "glyphs": ids, "text": m.group(0), "line": line["id"],
                                    "bbox": line["bbox"], "splitStreams": False, "scanned": True})
        return out

    def find_replace(self, doc_id: str, query: str, replacement: str, match_case: bool, whole_word: bool,
                     anchor: str, fit: str, base_version: Optional[int], dry_run: bool) -> dict:
        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        if not query:
            raise EditError("Search text is empty")
        data = self.data(doc_id)
        hits = find_matches(data, query, match_case, whole_word)
        for h in self._find_scanned(doc_id, data, query, match_case, whole_word):
            hits.setdefault(h["page"] - 1, []).append(h)
        reports, skipped, pages_changed = [], [], []
        scanned_ocr = self._scanned_ocr(doc_id, data)
        pending_ocr: dict[int, dict] = {}
        layout_ok = True
        for p, lst in sorted(hits.items()):
            edits = [Edit(h["glyphs"], replacement, anchor, fit) for h in lst if not h["splitStreams"]]
            skipped += [{"page": p + 1, "text": h["text"], "reason": "spans separate content streams"} for h in lst if h["splitStreams"]]
            if not edits:
                continue
            try:
                if p + 1 in scanned_ocr:
                    data, pending_ocr[p + 1], reps = self._scan_apply(data, p + 1, scanned_ocr[p + 1], edits)
                    pages_changed.append(p + 1)
                    reports += [{"page": p + 1, **r} for r in reps]
                    continue
                res = apply_edits(data, p, edits)
            except EditError as exc:
                skipped += [{"page": p + 1, "text": query, "reason": str(exc)}]
                continue
            data = res.data
            pages_changed.append(p + 1)
            layout_ok &= bool(res.verification.get("layoutPreserved"))
            for r in res.reports:
                reports.append({"page": p + 1, **r})
        out = {
            "dryRun": dry_run, "matches": sum(len(v) for v in hits.values()), "replaced": len(reports),
            "pages": pages_changed, "reports": reports, "skipped": skipped,
            "verification": {"layoutPreserved": layout_ok},
            "summary": f"Replace '{query}' → '{replacement}' ({len(reports)}×)",
        }
        if dry_run or not reports:
            out["version"] = doc["current_version"]
            return out
        for pg, o in pending_ocr.items():
            self.save_ocr(doc_id, data, pg, o)
        request = {"summary": out["summary"], "query": query, "replacement": replacement}
        out["version"] = self._commit(doc_id, doc, data, pages_changed[0], "FIND_REPLACE", request, out)
        return out

    def undo(self, doc_id: str) -> dict:
        return self._move(doc_id, -1)

    def redo(self, doc_id: str) -> dict:
        return self._move(doc_id, +1)

    def _move(self, doc_id: str, step: int) -> dict:
        with self._lock:
            doc = self.get(doc_id)
            v = doc["current_version"] + step
            if v < 0 or v > doc["head_version"]:
                raise Conflict("Nothing to undo" if step < 0 else "Nothing to redo")
            with self._db() as db:
                row = db.execute("SELECT page_count FROM document_versions WHERE document_id=? AND version_number=?", (doc_id, v)).fetchone()
            pages = row["page_count"] if row and row["page_count"] else count_pages(self.data(doc_id, v))
            with self._db() as db:
                db.execute("UPDATE documents SET current_version=?, page_count=?, updated_at=? WHERE id=?", (v, pages, _now(), doc_id))
        return self.get(doc_id)

    # ------------------------------------------------------------------ pages
    def page_operation(self, doc_id: str, op: str, params: dict, base_version: Optional[int]) -> dict:
        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        data = self.data(doc_id)
        n = doc["page_count"]
        pages0 = [p - 1 for p in params.get("pages", [])]
        if op == "rotate":
            out = page_ops.rotate(data, pages0, int(params.get("degrees", 90)))
            summary = f"Rotate page(s) {_fmt(params['pages'])} by {params.get('degrees', 90)}°"
        elif op == "delete":
            out = page_ops.delete(data, pages0)
            summary = f"Delete page(s) {_fmt(params['pages'])}"
        elif op == "reorder":
            order = [p - 1 for p in params["order"]]
            out = page_ops.reorder(data, order)
            summary = "Reorder pages"
        elif op == "move":
            order = list(range(n))
            src, dst = params["from"] - 1, params["to"] - 1
            if not (0 <= src < n and 0 <= dst < n):
                raise EditError("Page out of range")
            order.insert(dst, order.pop(src))
            out = page_ops.reorder(data, order)
            summary = f"Move page {params['from']} to {params['to']}"
        elif op == "insert-blank":
            after = int(params.get("after", n)) - 1
            out = page_ops.insert_blank(data, after)
            summary = f"Insert blank page after {after + 1}"
        elif op == "merge":
            other = params["data"]
            after = params.get("after")
            out = page_ops.merge(data, other, None if after is None else int(after) - 1)
            summary = f"Insert {params.get('name', 'PDF')} ({count_pages(other)} pages)"
        else:
            raise EditError(f"Unknown page operation {op}")
        version = self._commit(doc_id, doc, out, (pages0[0] + 1) if pages0 else 1, "PAGES", {"summary": summary, "op": op}, {"summary": summary})
        return {**self.get(doc_id), "version": version}

    def extract(self, doc_id: str, spec: str, split_each: bool = False) -> list[dict]:
        """New document(s) from a page range like '1-3,5'."""
        doc = self.get(doc_id)
        data = self.data(doc_id)
        pages0 = page_ops.parse_ranges(spec, doc["page_count"])
        stem = doc["original_name"][:-4] if doc["original_name"].lower().endswith(".pdf") else doc["original_name"]
        if split_each:
            return [self.create(f"{stem}-p{p + 1}.pdf", page_ops.extract(data, [p])) for p in pages0]
        return [self.create(f"{stem}-pages-{spec.replace(' ', '')}.pdf", page_ops.extract(data, pages0))]

    def export(self, doc_id: str, protection: Protection, compression: str = "none") -> tuple[bytes, dict]:
        """Download copy: compressed first (encryption makes data incompressible), then protected."""
        from .engine.compress import compress

        result = compress(self.data(doc_id), compression)
        return protect(result.data, protection), result.stats()

    def compression_options(self, doc_id: str) -> dict:
        """Download size at every compression level, so the user can choose."""
        from .engine.compress import compress

        data = self.data(doc_id)
        return {lvl: compress(data, lvl).stats() for lvl in ("none", "lossless", "balanced", "strong")}

    # ------------------------------------------------------------ annotations
    def annotate(self, doc_id: str, page: int, spec: dict, base_version: Optional[int]) -> dict:
        from .engine import annotate as A

        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        if not 1 <= page <= doc["page_count"]:
            raise NotFound(f"page {page}")
        kind = spec["type"]
        pdf = open_pdf(self.data(doc_id))
        color = spec.get("color") or {"highlight": "#ffd400", "note": "#f5c400", "stamp": "#c0362c"}.get(kind, "#d62828")
        author = spec.get("author", "")
        markup = {"highlight": "Highlight", "underline": "Underline", "strikeout": "StrikeOut", "squiggly": "Squiggly"}
        if kind in markup:
            boxes = self._line_boxes(doc_id, page, spec.get("glyphs") or [])
            A.add_markup(pdf, page - 1, markup[kind], boxes, color,
                         float(spec.get("opacity", 1.0 if kind != "highlight" else 0.5)), author, spec.get("text", ""))
        elif kind == "note":
            A.add_note(pdf, page - 1, float(spec["x"]), float(spec["y"]), spec.get("text", ""), color, author)
        elif kind in ("rect", "ellipse"):
            A.add_shape(pdf, page - 1, "Square" if kind == "rect" else "Circle", spec["rect"], color,
                        float(spec.get("width", 1.5)), spec.get("fill"), float(spec.get("opacity", 1.0)), author, spec.get("text", ""))
        elif kind == "ink":
            A.add_ink(pdf, page - 1, spec["paths"], color, float(spec.get("width", 2.0)), float(spec.get("opacity", 1.0)), author)
        elif kind in ("signature", "image"):
            A.add_image_stamp(pdf, page - 1, spec["rect"], _decode_data_url(spec.get("image", "")), kind, author)
        elif kind == "stamp":
            A.add_text_stamp(pdf, page - 1, spec["rect"], spec.get("text") or "APPROVED", color, author)
        else:
            raise EditError(f"Unknown annotation type {kind}")
        summary = f"Add {kind} on page {page}"
        v = self._commit(doc_id, doc, save_pdf(pdf), page, "ANNOTATE", {"summary": summary}, {"summary": summary})
        return {**self.get(doc_id), "version": v}

    # ----------------------------------------------------------------- images
    def image_operation(self, doc_id: str, page: int, spec: dict, base_version: Optional[int]) -> dict:
        """Insert a picture, or move / resize / rotate / delete / replace one that is already on the page."""
        from .engine import images as I

        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        if not 1 <= page <= doc["page_count"]:
            raise NotFound(f"page {page}")
        action = spec["action"]
        pdf = open_pdf(self.data(doc_id))
        index = spec.get("index")
        if action != "insert" and index is None:
            raise EditError("Say which image to change")
        notes: dict = {}
        if action == "insert":
            notes = I.insert(pdf, page - 1, spec["rect"], _decode_data_url(spec.get("image", "")), spec.get("fit", "contain"))
            summary = f"Insert image on page {page}"
        elif action == "transform":
            if spec.get("bbox") is None and not spec.get("rotate"):
                raise EditError("Nothing to change")
            notes = I.transform(pdf, page - 1, index, spec.get("bbox"), int(spec.get("rotate") or 0))
            summary = f"{'Rotate' if spec.get('rotate') and spec.get('bbox') is None else 'Resize'} image on page {page}"
        elif action == "delete":
            I.delete(pdf, page - 1, index)
            summary = f"Delete image on page {page}"
        elif action == "replace":
            notes = I.replace(pdf, page - 1, index, _decode_data_url(spec.get("image", "")), spec.get("fit", "contain"))
            summary = f"Replace image on page {page}"
        else:
            raise EditError(f"Unknown image action {action}")
        v = self._commit(doc_id, doc, save_pdf(pdf), page, "IMAGE", {"summary": summary}, {"summary": summary, **notes})
        return {**self.get(doc_id), "version": v, "notes": notes}

    def _line_boxes(self, doc_id: str, page: int, glyphs: list[int]) -> list[list[float]]:
        model = self.page_model(doc_id, page)
        want = set(glyphs)
        boxes = []
        for line in model["lines"]:
            ids = [i for i in dict.fromkeys(line["map"]) if i >= 0 and i in want]
            if ids:
                bb = [model["glyphs"][i]["b"] for i in ids]
                boxes.append([min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb), max(b[3] for b in bb)])
        return boxes

    def annotations(self, doc_id: str, page: int) -> list[dict]:
        from .engine.annotate import list_annotations

        return list_annotations(open_pdf(self.data(doc_id)), page - 1)

    def delete_annotation(self, doc_id: str, page: int, nm: str, base_version: Optional[int]) -> dict:
        from .engine.annotate import delete_annotation

        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        pdf = open_pdf(self.data(doc_id))
        delete_annotation(pdf, page - 1, nm)
        v = self._commit(doc_id, doc, save_pdf(pdf), page, "ANNOTATE", {"summary": f"Delete annotation on page {page}"}, {})
        return {**self.get(doc_id), "version": v}

    def watermark(self, doc_id: str, spec: dict, base_version: Optional[int]) -> dict:
        from .engine import annotate as A

        doc = self.get(doc_id)
        self._check_version(doc, base_version)
        pdf = open_pdf(self.data(doc_id))
        pages = [p - 1 for p in (spec.get("pages") or range(1, doc["page_count"] + 1))]
        if spec.get("remove"):
            if not A.remove_watermarks(pdf, pages):
                raise EditError("No watermark added by PDF Master was found")
            summary = "Remove watermark"
        else:
            A.add_watermark(pdf, pages, spec["text"], spec.get("color", "#888888"), float(spec.get("opacity", 0.18)),
                            float(spec.get("angle", 45)), spec.get("size"))
            summary = f"Watermark '{spec['text']}' on {len(pages)} page(s)"
        v = self._commit(doc_id, doc, save_pdf(pdf), pages[0] + 1, "WATERMARK", {"summary": summary}, {})
        return {**self.get(doc_id), "version": v}

    # ------------------------------------------------------------- comparison
    def check(self, doc_id: str) -> dict:
        """Document check: problems in the PDF itself and in what the applied edits did."""
        from .engine.preflight import check_document

        doc = self.get(doc_id)
        data = self.data(doc_id)
        original = self.data(doc_id, 0)
        ocr = {}
        for p in range(1, doc["page_count"] + 1):
            res = self._load_ocr(doc_id, data, p)
            if res is not None:
                ocr[p] = res
        with self._db() as db:
            rows = db.execute(
                "SELECT page_number, request, report FROM edit_operations WHERE document_id=? AND result_version<=? "
                "AND operation_type='REPLACE_TEXT' ORDER BY result_version", (doc_id, doc["current_version"])).fetchall()
        history = [{"page": r["page_number"], "summary": json.loads(r["request"]).get("summary", ""),
                    "report": json.loads(r["report"])} for r in rows]
        result = check_document(data, original, ocr, history, bool(doc["was_encrypted"]))
        return {**result, "version": doc["current_version"]}

    def compare_png(self, doc_id: str, page: int, a: int, b: Optional[int]) -> tuple[bytes, dict]:
        return diff_png(self.data(doc_id, a), self.data(doc_id, b), page - 1)

    def render(self, doc_id: str, page: int, version: Optional[int], zoom: float) -> bytes:
        return render_png(self.data(doc_id, version), page - 1, zoom)


def _fmt(pages: list[int]) -> str:
    return ", ".join(str(p) for p in pages)


@lru_cache(maxsize=256)
def _cached_key(digest: str, data: bytes, page: int) -> str:
    return ocr_engine.page_key(open_pdf(data), page)


def _decode_data_url(url: str) -> bytes:
    import base64

    if not url:
        raise EditError("No image supplied")
    payload = url.split(",", 1)[1] if url.startswith("data:") else url
    try:
        data = base64.b64decode(payload, validate=False)
    except Exception as exc:
        raise EditError("Image data is not valid base64") from exc
    if len(data) > 25 * 1024 * 1024:
        raise EditError("Image is larger than 25 MB")
    return data
