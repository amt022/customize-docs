"""Try hosted (multi-user) mode locally: python run_hosted.py  ->  http://127.0.0.1:8001

Each browser gets its own document list. Uses a separate data folder so desktop documents are not touched.
Plain http, so the session cookie is not marked Secure; production must use HTTPS and leave that on.
"""
import os
from pathlib import Path

import uvicorn

here = Path(__file__).resolve().parent
os.environ.setdefault("PDFMASTER_DATA", str(here / "data-hosted"))
os.environ["PDFMASTER_MULTIUSER"] = "1"
os.environ.setdefault("PDFMASTER_COOKIE_SECURE", "0")
os.environ.setdefault("PDFMASTER_RETENTION_HOURS", "24")
os.environ.setdefault("PDFMASTER_EMAIL", "console")  # sign-in codes appear in this server's log
os.environ.setdefault("PDFMASTER_SMS", "console")
# placeholder details for the Privacy Policy / Terms pages (a real deployment must set its own)
os.environ.setdefault("PDFMASTER_OPERATOR", "FormEasy (local test)")
os.environ.setdefault("PDFMASTER_GRIEVANCE_NAME", "Test Officer")
os.environ.setdefault("PDFMASTER_GRIEVANCE_EMAIL", "grievance@example.com")
os.environ.setdefault("PDFMASTER_DATA_REGION", "this computer")

if __name__ == "__main__":
    uvicorn.run("pdfmaster.api:app", app_dir=str(here), host="127.0.0.1", port=8001)
