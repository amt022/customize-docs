"""Generate test PDFs that cover the main font situations.

Dev-only: needs `pip install pymupdf` (AGPL). The generated fixtures are committed,
and the app itself does not use PyMuPDF."""
import subprocess, sys
from pathlib import Path
import pymupdf

OUT = Path(__file__).parent / "fixtures"
OUT.mkdir(exist_ok=True)

LINES = [
    ("STATEMENT OF ACCOUNT", 18),
    ("Customer Name: Ashish Tripathi", 11),
    ("Account Number: 1234567890", 11),
    ("Transaction Amount: 25,000", 11),
    ("Date: 01 November 2026", 11),
]


def base14():
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for text, size in LINES:
        page.insert_text((72, y), text, fontsize=size, fontname="helv", color=(0.1, 0.2, 0.5) if size > 12 else (0, 0, 0))
        y += size * 2
    page.insert_text((400, 72), "Page 1", fontsize=9, fontname="tiro")
    # right-aligned amount column
    w = pymupdf.get_text_length("25,000.00", "helv", 11)
    page.insert_text((520 - w, 200), "25,000.00", fontsize=11, fontname="helv")
    page.draw_rect(pymupdf.Rect(60, 40, 540, 220), color=(0.5, 0.5, 0.5))
    doc.save(OUT / "base14.pdf")


def embedded_subset():
    doc = pymupdf.open()
    page = doc.new_page()
    y = 72
    for text, size in LINES:
        page.insert_text((72, y), text, fontsize=size, fontname="arial", fontfile=r"C:\Windows\Fonts\arial.ttf")
        y += size * 2
    page.insert_text((72, y + 10), "Bold total 99", fontsize=12, fontname="arialbd", fontfile=r"C:\Windows\Fonts\arialbd.ttf")
    doc.subset_fonts()
    doc.save(OUT / "subset.pdf", garbage=3, deflate=True)


def browser():
    html = OUT / "invoice.html"
    html.write_text("""<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Calibri,Arial,sans-serif;margin:40px;color:#222}
    h1{font-family:'Times New Roman',serif;color:#1a3c7a}
    td{padding:4px 12px;border-bottom:1px solid #ccc} .r{text-align:right}
    </style></head><body><h1>Tax Invoice</h1>
    <p>Billed to: <b>Ashish Tripathi</b>, Lucknow</p>
    <table><tr><td>Item</td><td class=r>Amount</td></tr>
    <tr><td>Consulting services</td><td class=r>&#8377;25,000.00</td></tr>
    <tr><td>Design work</td><td class=r>&#8377;7,500.00</td></tr>
    <tr><td><b>Total</b></td><td class=r><b>&#8377;32,500.00</b></td></tr></table>
    <p style="text-align:justify;width:420px">Payment is due within thirty days of the invoice date. Please quote the invoice number with your payment so that it can be matched quickly.</p>
    </body></html>""", encoding="utf-8")
    edge = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
    subprocess.run([edge, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={OUT / 'browser.pdf'}", html.as_uri()], check=True, timeout=60)


if __name__ == "__main__":
    base14(); embedded_subset()
    if sys.platform == "win32":
        browser()
    print(sorted(p.name for p in OUT.glob("*.pdf")))
