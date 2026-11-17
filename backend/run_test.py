"""A throwaway desktop-mode copy for trying things out: python run_test.py  ->  http://127.0.0.1:8002

Same app as the desktop build, but its documents live in backend/data-test, so nothing done here touches
the real ones in backend/data. Delete the folder to start clean.
"""
import os
from pathlib import Path

import uvicorn

here = Path(__file__).resolve().parent
os.environ.setdefault("PDFMASTER_DATA", str(here / "data-test"))

if __name__ == "__main__":
    uvicorn.run("pdfmaster.api:app", app_dir=str(here), host="127.0.0.1", port=8002)
