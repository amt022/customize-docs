from pathlib import Path

import pytest

from pdfmaster.engine.document import apply_edits, extract_page, find_matches
from pdfmaster.engine.editor import Edit, EditError

FIX = Path(__file__).parent / "fixtures"


def load(name: str) -> bytes:
    p = FIX / f"{name}.pdf"
    if not p.exists():
        pytest.skip(f"fixture {name}.pdf missing (run tests/make_fixtures.py)")
    return p.read_bytes()


def hit(data: bytes, text: str, n: int = 0):
    m = find_matches(data, text, match_case=True)
    flat = [(p, h) for p, hs in sorted(m.items()) for h in hs]
    assert flat, f"{text!r} not found"
    return flat[n]


def edit(data: bytes, find: str, new: str, **kw):
    page, h = hit(data, find)
    return apply_edits(data, page, [Edit(h["glyphs"], new, **kw)])


def page_text(data: bytes, page: int = 0) -> str:
    # read back through our own extractor (honours ActualText) - independent of any renderer
    return "\n".join(l["text"] for l in extract_page(data, page)["lines"])


@pytest.mark.parametrize("name", ["base14", "subset", "browser"])
def test_same_width_replacement_keeps_everything_else(name):
    data = load(name)
    res = edit(data, "25,000", "35,000")
    v = res.verification
    assert v["movedGlyphs"] == 0
    assert v["newTextVerified"], v
    assert v["changedOutside"] == 0
    assert v["layoutPreserved"]
    assert "35,000" in page_text(res.data)
    assert "25,000" not in page_text(res.data).split("32,500")[0] or name != "browser"


def test_extraction_reads_lines_and_fonts():
    pj = extract_page(load("browser.pdf".removesuffix(".pdf")), 0)
    texts = [l["text"] for l in pj["lines"]]
    assert "Billed to: Ashish Tripathi, Lucknow" in texts
    assert any("Calibri" in f["name"] for f in pj["fonts"].values())
    assert pj["type"] == "digital"


def test_name_change_in_subset_font_uses_original_glyphs_where_possible():
    data = load("subset")
    res = edit(data, "Ashish", "Rahul", fit="auto")
    r = res.reports[0]
    assert r["fitApplied"] == "reflow" and r["shift"] < 0
    # 'a','h','u' exist in the subset (from "Tripathi"/"Number"); 'R' and 'l' never occur
    assert {s["char"] for s in r["substitutes"]} == {"R", "l"}
    assert r["strategy"] == "mixed"
    assert res.verification["movedGlyphs"] == 0
    assert "Customer Name: Rahul Tripathi" in page_text(res.data).replace("\xa0", " ")


def test_shorter_text_keeps_following_word_in_place():
    data = load("base14")
    before = extract_page(data, 0)
    res = edit(data, "Ashish", "Ram")
    trip_before = [g for g in before["glyphs"] if g["c"] == "T" and g["o"][1] == before["glyphs"][hit(data, "Tripathi")[1]["glyphs"][0]]["o"][1]]
    after = res.page
    assert any(g["o"] == trip_before[0]["o"] for g in after["glyphs"] if g["c"] == "T")
    assert res.verification["movedGlyphs"] == 0


def test_longer_text_warns_instead_of_silently_overlapping():
    res = edit(load("base14"), "Ashish", "Ashishkumar")
    r = res.reports[0]
    assert not r["fits"] and r["overflow"] > 0
    assert not res.verification["layoutPreserved"]


def test_squeeze_fits_into_available_space():
    res = edit(load("base14"), "Ashish", "Ashishkumar", fit="squeeze")
    r = res.reports[0]
    assert r["fits"] and r["scale"] < 1
    assert res.verification["movedGlyphs"] == 0


def test_reflow_moves_rest_of_line():
    data = load("base14")
    res = edit(data, "Ashish", "Ashishkumar", fit="reflow")
    assert res.reports[0]["fits"]
    assert res.verification["movedGlyphs"] == 0
    assert "Customer Name: Ashishkumar Tripathi" in page_text(res.data)
    # nothing else on the page moved, and the other lines are intact
    assert "Account Number: 1234567890" in page_text(res.data)


def test_right_anchor_keeps_right_edge():
    data = load("base14")
    page, h = hit(data, "25,000.00")
    before = extract_page(data, 0)
    right_before = max(before["glyphs"][i]["b"][2] for i in h["glyphs"])
    res = apply_edits(data, page, [Edit(h["glyphs"], "5,000.00", anchor="right")])
    m = find_matches(res.data, "5,000.00", match_case=True)
    ids = [x for x in m[0] if x["text"] == "5,000.00" and "25" not in x["text"]][-1]["glyphs"]
    right_after = max(res.page["glyphs"][i]["b"][2] for i in ids)
    assert abs(right_after - right_before) < 0.05


def test_delete_text():
    res = edit(load("subset"), "Bold ", "")
    assert "total 99" in page_text(res.data).replace(" ", " ")
    assert "Bold" not in page_text(res.data)
    assert res.verification["movedGlyphs"] == 0


def test_bold_text_stays_bold():
    data = load("subset")
    res = edit(data, "99", "42")
    assert res.reports[0]["font"].startswith("Arial Bold")
    assert "total 42" in page_text(res.data).replace("\xa0", " ")


def test_hindi_text_is_shaped_with_installed_font():
    from pdfmaster.engine.sysfonts import coverage_fonts

    if not coverage_fonts(False, False):
        pytest.skip("no Indic-capable font installed")
    res = edit(load("subset"), "Tripathi", "त्रिपाठी")
    r = res.reports[0]
    assert r["strategy"] == "substitute-font"
    assert "त्रिपाठी" in page_text(res.data)
    assert res.verification["movedGlyphs"] == 0


def test_multiple_edits_in_one_pass_and_find_replace():
    data = load("browser")
    m = find_matches(data, ".00", match_case=True)
    edits = [Edit(h["glyphs"], ".50", anchor="right") for h in m[0]]
    res = apply_edits(data, 0, edits)
    txt = page_text(res.data)
    assert txt.count(".50") == 3 and ".00" not in txt
    assert res.verification["movedGlyphs"] == 0


def test_overlapping_edits_rejected():
    data = load("base14")
    _, h = hit(data, "Ashish")
    with pytest.raises(EditError):
        apply_edits(data, 0, [Edit(h["glyphs"], "A"), Edit(h["glyphs"][:2], "B")])


def test_justified_paragraph_word_replacement():
    data = load("browser")
    res = edit(data, "thirty", "sixty")
    assert "within sixty days" in page_text(res.data)
    assert res.verification["movedGlyphs"] == 0


def test_auto_keeps_table_cells_fixed():
    data = load("browser")
    res = edit(data, "25,000.00", "5,000.00", anchor="right", fit="auto")
    assert res.reports[0]["fitApplied"] == "none"
    assert res.verification["movedGlyphs"] == 0


def test_auto_anchor_detects_right_aligned_column():
    data = load("browser")
    res = edit(data, "25,000.00", "1,25,000.00", anchor="auto", fit="auto")
    assert res.reports[0]["anchor"] == "right"
    res = edit(data, "Ashish", "Rahul", anchor="auto", fit="auto")
    assert res.reports[0]["anchor"] == "left"


def _form_pdf() -> bytes:
    """Two pages that both draw one shared form XObject; page text continues into the form."""
    import io

    import pikepdf

    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1,
                                                BaseFont=pikepdf.Name.Helvetica, Encoding=pikepdf.Name.WinAnsiEncoding))
    res = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
    form = pikepdf.Stream(pdf, b"BT /F1 12 Tf 120 700 Td (Shared footer) Tj ET")
    form.Type, form.Subtype = pikepdf.Name.XObject, pikepdf.Name.Form
    form.BBox, form.Resources = [0, 0, 612, 792], res
    form = pdf.make_indirect(form)
    for label in (b"Header", b"Second"):
        content = pdf.make_stream(b"BT /F1 12 Tf 72 700 Td (" + label + b") Tj ET /Fx Do")
        page = pikepdf.Dictionary(Type=pikepdf.Name.Page, MediaBox=[0, 0, 612, 792], Contents=content,
                                  Resources=pikepdf.Dictionary(Font=res.Font, XObject=pikepdf.Dictionary(Fx=form)))
        pdf.pages.append(pikepdf.Page(page))
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def test_edit_in_shared_form_only_changes_that_use():
    data = _form_pdf()
    res = edit(data, "footer", "notice")
    assert "Shared notice" in page_text(res.data, 0)
    assert "Shared footer" in page_text(res.data, 1)
    assert res.verification["movedGlyphs"] == 0


def test_edit_across_page_and_form_streams():
    data = _form_pdf()
    page, h = hit(data, "Header Shared")
    res = apply_edits(data, page, [Edit(h["glyphs"], "Title", fit="none")])
    t = page_text(res.data, 0)
    assert "Title" in t and "Header" not in t and "Shared" not in t
    assert "footer" in t
    assert "Shared footer" in page_text(res.data, 1)


def test_independent_renderer_reads_edit():
    from pdfmaster.engine.render import page_text as pdfium_text

    res = edit(load("base14"), "25,000", "35,000")
    assert "35,000" in pdfium_text(res.data, 0)



def _centred_certificate() -> bytes:
    """Word-style layout: each centred line is one TJ plus a separately placed trailing space;
    the last line has a label and a value placed independently."""
    import io

    import pikepdf

    pdf = pikepdf.new()
    font = pdf.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1,
                                                BaseFont=pikepdf.Name.Courier, Encoding=pikepdf.Name.WinAnsiEncoding))
    ops = []
    for text, size, y in [("Alpha University", 20, 500), ("CERTIFICATE OF COMPLETION", 30, 440), ("This is to certify that", 15, 395)]:
        w = 0.6 * size * len(text)  # Courier: every glyph is 600 units wide
        ops.append(f"BT /F1 {size} Tf 1 0 0 1 {396 - w / 2:.2f} {y} Tm [({text})] TJ ET")
        ops.append(f"BT /F1 {size} Tf 1 0 0 1 {396 + w / 2:.2f} {y} Tm [( )] TJ ET")
    ops.append("BT /F1 12 Tf 1 0 0 1 100 200 Tm [(Name:)] TJ ET")
    ops.append("BT /F1 12 Tf 1 0 0 1 160 200 Tm [(Rahul)] TJ ET")
    page = pdf.add_blank_page(page_size=(792, 612))
    page.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
    page.Contents = pdf.make_stream(" ".join(ops).encode())
    buf = io.BytesIO()
    pdf.save(buf)
    return buf.getvalue()


def test_centred_line_grows_on_both_sides_instead_of_overlapping():
    data = _centred_certificate()
    before = {l["text"].strip(): l for l in extract_page(data, 0)["lines"]}
    res = edit(data, "CERTIFICATE", "CERTIFICATE WWWWW", anchor="auto", fit="auto")
    r = res.reports[0]
    assert r["anchor"] == "center" and r["fitApplied"] == "reflow" and r.get("recentered")
    v = res.verification
    assert v["movedGlyphs"] == 0 and v["changedOutside"] == 0 and v["newTextVerified"], v
    after = {l["text"].strip(): l for l in extract_page(res.data, 0)["lines"]}
    line = after["CERTIFICATE WWWWW OF COMPLETION"]
    old = before["CERTIFICATE OF COMPLETION"]
    centre = lambda l: (l["bbox"][0] + l["bbox"][2]) / 2
    assert abs(centre(line) - 396) < 1.0  # still centred on the page
    assert line["bbox"][0] < old["bbox"][0] - 40  # grew to the left too


def test_text_that_cannot_move_aside_is_narrowed_rather_than_overprinted():
    data = _centred_certificate()
    res = edit(data, "Name:", "Student name:", anchor="auto", fit="auto")
    r = res.reports[0]
    assert r["fitApplied"] == "squeeze" and r["fits"] and r["scale"] < 1, r
    assert res.verification["movedGlyphs"] == 0


def test_re_editing_squeezed_text_restores_normal_width():
    data = _centred_certificate()
    first = edit(data, "CERTIFICATE", "CERTIFICATE " + "W" * 30, anchor="auto", fit="auto")
    assert first.reports[0]["scale"] < 1 and first.reports[0].get("squeezedToMargins")
    second = edit(first.data, "CERTIFICATE " + "W" * 30, "DIPLOMA", anchor="auto", fit="auto")
    r = second.reports[0]
    assert r["scale"] == 1.0 and r.get("recentered"), r
    assert second.verification["layoutPreserved"], second.verification
    from pdfmaster.engine.document import open_pdf
    from pdfmaster.engine.interpreter import PageModel
    m = PageModel(open_pdf(second.data), 0)
    text = "".join(g.ch for g in m.glyphs)
    i = text.index("DIPLOMA")
    assert all(abs(m.glyphs[k].th - 1.0) < 1e-6 for k in range(i, i + 7))  # no leftover squeeze
