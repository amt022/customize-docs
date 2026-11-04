"""Rough load test: N simulated people each upload a PDF, list, render and download it.

Usage: python loadtest.py [base_url] [users]      (default http://127.0.0.1:8001, 20)
Needs a hosted-mode server (run_hosted.py). Each simulated person has their own cookie jar.
"""
import io
import statistics
import sys
import threading
import time
import urllib.request
from http.cookiejar import CookieJar

import pikepdf

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8001").rstrip("/") + "/api/v1"
USERS = int(sys.argv[2]) if len(sys.argv) > 2 else 20


def make_pdf() -> bytes:
    pdf = pikepdf.new()
    for _ in range(3):
        pdf.add_blank_page(page_size=(595, 842))
    out = io.BytesIO()
    pdf.save(out)
    return out.getvalue()


PDF = make_pdf()
times: dict[str, list[float]] = {}
errors: list[str] = []
lock = threading.Lock()


def timed(name, fn):
    t = time.perf_counter()
    try:
        r = fn()
    except Exception as e:  # noqa: BLE001
        with lock:
            errors.append(f"{name}: {e}")
        return None
    with lock:
        times.setdefault(name, []).append(time.perf_counter() - t)
    return r


def person(i: int):
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(CookieJar()))
    get = lambda path: op.open(BASE + path, timeout=60).read()  # noqa: E731
    boundary = "----lt" + str(i)
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"t{i}.pdf\"\r\n"
            f"Content-Type: application/pdf\r\n\r\n").encode() + PDF + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + "/documents", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    import json
    up = timed("upload", lambda: json.loads(op.open(req, timeout=60).read()))
    if not up:
        return
    doc = up["data"]["id"]
    timed("list", lambda: get("/documents"))
    for p in range(1, 4):
        timed("render", lambda: get(f"/documents/{doc}/pages/{p}/render.png"))
    timed("download", lambda: get(f"/documents/{doc}/download"))


start = time.perf_counter()
threads = [threading.Thread(target=person, args=(i,)) for i in range(USERS)]
[t.start() for t in threads]
[t.join() for t in threads]
print(f"{USERS} users in {time.perf_counter() - start:.1f}s, {len(errors)} errors")
for k, v in times.items():
    v.sort()
    print(f"{k:9} n={len(v):3} median={statistics.median(v):.2f}s p95={v[int(len(v) * .95) - 1]:.2f}s max={v[-1]:.2f}s")
for e in errors[:5]:
    print("ERROR", e)
