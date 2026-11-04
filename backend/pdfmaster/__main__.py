"""Run the PDF Master server: python -m pdfmaster [--port N] [--host 127.0.0.1]

The desktop app starts this on a random loopback port with PDFMASTER_TOKEN set,
so only the app window (which sends the token) can use the API.
"""
import argparse

import uvicorn


def main() -> None:
    ap = argparse.ArgumentParser(prog="pdfmaster")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    import os

    if args.host not in ("127.0.0.1", "localhost", "::1") and os.environ.get("PDFMASTER_MULTIUSER") != "1" \
            and not os.environ.get("PDFMASTER_TOKEN") and os.environ.get("PDFMASTER_SINGLE_USER") != "1":
        ap.error("listening on the network without PDFMASTER_MULTIUSER=1 would show every visitor every document; "
                 "set PDFMASTER_MULTIUSER=1 (or PDFMASTER_SINGLE_USER=1 for a one-person server)")
    from pdfmaster.api import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
