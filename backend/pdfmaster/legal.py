"""Hosted website: who runs it (shown on the Privacy Policy / Terms pages), consent version, and the access log.

Settings (hosted mode):
  PDFMASTER_OPERATOR          name of the person or business running the site (required on a real deployment)
  PDFMASTER_GRIEVANCE_EMAIL   grievance officer's email (IT Rules 2021 / DPDP Act; required on a real deployment)
  PDFMASTER_GRIEVANCE_NAME    grievance officer's name
  PDFMASTER_CONTACT_EMAIL     general contact (defaults to the grievance email)
  PDFMASTER_ADDRESS           postal address shown on the pages
  PDFMASTER_DATA_REGION       where files are stored, e.g. "India (AWS Mumbai, ap-south-1)"
  PDFMASTER_LOG_DIR           access log folder (default <data>/logs); one file per day
  PDFMASTER_LOG_DAYS          days of access logs kept (default 180, as CERT-In's 2022 directions ask)
"""
from __future__ import annotations

import logging
import os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

# Bump when the Privacy Policy or Terms change in substance; each sign-in records the version accepted.
TERMS_VERSION = "2026-11-08"


def settings() -> dict:
    grievance = os.environ.get("PDFMASTER_GRIEVANCE_EMAIL", "").strip()
    return {
        "version": TERMS_VERSION,
        "operator": os.environ.get("PDFMASTER_OPERATOR", "").strip(),
        "grievanceName": os.environ.get("PDFMASTER_GRIEVANCE_NAME", "").strip(),
        "grievanceEmail": grievance,
        "contactEmail": os.environ.get("PDFMASTER_CONTACT_EMAIL", "").strip() or grievance,
        "address": os.environ.get("PDFMASTER_ADDRESS", "").strip(),
        "dataRegion": os.environ.get("PDFMASTER_DATA_REGION", "").strip(),
        "logDays": log_days(),
    }


def check(real_deployment: bool) -> None:
    """A public site must name who runs it and a grievance contact; refuse to start without them."""
    s = settings()
    missing = [k for k, v in (("PDFMASTER_OPERATOR", s["operator"]), ("PDFMASTER_GRIEVANCE_EMAIL", s["grievanceEmail"])) if not v]
    if real_deployment and missing:
        raise RuntimeError(
            f"Hosted mode needs {' and '.join(missing)}: the Privacy Policy and Terms pages must say who runs the site "
            "and how to reach the grievance officer (see docs/DEPLOYMENT.md, Legal).")


def log_days() -> int:
    return max(1, int(os.environ.get("PDFMASTER_LOG_DAYS", "180")))


def access_logger(data_dir: Path) -> logging.Logger:
    """Daily access log files, kept for PDFMASTER_LOG_DAYS days. Lines hold no email, phone or file names."""
    folder = Path(os.environ.get("PDFMASTER_LOG_DIR") or Path(data_dir) / "logs")
    folder.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger("pdfmaster.access")
    log.setLevel(logging.INFO)
    log.propagate = False
    for h in list(log.handlers):  # module reloads (tests) must not stack handlers
        log.removeHandler(h)
        h.close()
    h = TimedRotatingFileHandler(folder / "access.log", when="midnight", backupCount=log_days(), utc=True, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(message)s", "%Y-%m-%dT%H:%M:%SZ"))
    h.formatter.converter = __import__("time").gmtime
    log.addHandler(h)
    return log
