"""In-place text replacement.

Strategy (per edit):
  1. Every selected glyph is replaced, inside its own TJ array, by a kerning
     number of exactly the same advance -> nothing after it can move.
  2. The new text is inserted at the first selected glyph, encoded in the
     ORIGINAL font wherever the embedded font has the glyph.
  3. Characters the original (usually subset) font lacks are drawn with the
     closest installed font, embedded as a small subset, switched in and out
     with Tf inside the same text object, so colour, size, rendering mode,
     character/word spacing and position all stay those of the original.
  4. A trailing kern cancels the new text's advance (anchor left/right/center),
     unless the caller asked to reflow the rest of the line.
"""
from __future__ import annotations

import codecs
import logging
from dataclasses import dataclass, field
from collections import Counter
from typing import Optional

import pikepdf

from . import geometry as G
from .fonts import PdfFont
from .interpreter import Glyph, PageModel
from .sysfonts import EmbeddedSubstitute, coverage_fonts, has_glyph, match_font

log = logging.getLogger(__name__)

SPACES = {" ", " ", " ", " ", " "}


class EditError(Exception):
    pass


@dataclass
class Edit:
    glyphs: list[int]
    text: str
    anchor: str = "left"  # left | right | center | auto
    fit: str = "none"  # none | squeeze | reflow | auto
    style: Optional[dict] = None  # scanned pages: {"family": sans|serif|mono, "bold", "italic"}


@dataclass
class Segment:
    kind: str  # "orig" | "sub" | "space"
    chars: str = ""
    codes: list[bytes] = field(default_factory=list)
    sub: Optional[EmbeddedSubstitute] = None
    shaped: list = field(default_factory=list)  # ShapedGlyph list for "sub"
    advance: float = 0.0  # text space units, before squeeze


def _complex_script(text: str) -> bool:
    """Scripts that need shaping (Indic, Arabic, Thai...): never glyph-by-glyph."""
    return any(0x0590 <= ord(c) <= 0x0DFF or 0x0E00 <= ord(c) <= 0x0FFF or 0x1000 <= ord(c) <= 0x109F
               or 0xA8E0 <= ord(c) <= 0xA8FF for c in text)


@dataclass
class Plan:
    edit: Edit
    host: Glyph
    selected: list[Glyph]
    segments: list[Segment]
    a_new: float
    w_span: float
    scale: float = 1.0
    pre: float = 0.0
    post: float = 0.0
    # centred lines: the line start moves by `lead` (text units) at `lead_glyph`
    lead: float = 0.0
    lead_glyph: Optional[Glyph] = None
    # horizontal scaling that brings the new text back to the line's normal width
    # (the selection may itself be text squeezed by an earlier edit)
    boost: float = 1.0
    report: dict = field(default_factory=dict)


def _text_units(host: Glyph, vec: tuple[float, float]) -> float:
    """Project a page-space vector on the host baseline, in host text-space units."""
    u = G.apply_vec(host.m, 1, 0)
    n2 = u[0] * u[0] + u[1] * u[1]
    return (vec[0] * u[0] + vec[1] * u[1]) / n2 if n2 else 0.0


class Substitutes:
    """System fonts embedded during one apply() call, keyed by font file."""

    def __init__(self) -> None:
        self.by_key: dict[tuple, EmbeddedSubstitute] = {}
        self.match_cache: dict[str, tuple] = {}

    def for_char(self, font: PdfFont, ch: str) -> Optional[tuple[EmbeddedSubstitute, str]]:
        return self.for_text(font, ch)

    def for_text(self, font: PdfFont, text: str) -> Optional[tuple[EmbeddedSubstitute, str]]:
        """Closest installed font that has glyphs for every character of text."""
        key = font.base_font
        if key not in self.match_cache:
            self.match_cache[key] = match_font(font.clean_name, font.bold, font.italic, font.serif, font.monospace)
        sysfont, quality = self.match_cache[key]
        candidates = []
        if sysfont is not None:
            candidates.append((sysfont, quality))
        candidates += [(f, "coverage") for f in coverage_fonts(font.bold, font.italic)]
        for f, q in candidates:
            if all(has_glyph(f, c) for c in text if not c.isspace()):
                k = (f.path, f.index)
                if k not in self.by_key:
                    self.by_key[k] = EmbeddedSubstitute(f)
                return self.by_key[k], q
        return None


class PageEditor:
    def __init__(self, pdf: pikepdf.Pdf, model: PageModel):
        self.pdf = pdf
        self.model = model
        self.subs = Substitutes()

    # ------------------------------------------------------------------ plan
    def plan(self, edit: Edit) -> Plan:
        gl = self.model.glyphs
        if not edit.glyphs:
            raise EditError("Nothing selected")
        try:
            ids = set(edit.glyphs)
            groups = {gl[i].group for i in ids} - {-1}
            ids |= {g.idx for g in gl if g.group in groups}
            selected = [gl[i] for i in sorted(ids)]
        except IndexError:
            raise EditError("Selection no longer matches the page; reload and try again")
        host = selected[0]
        if not host.font.editable:
            raise EditError(f"Font {host.font.clean_name} ({host.font.subtype}) cannot be re-encoded (Type3 or vertical text)")
        if host.size == 0 or host.th == 0:
            raise EditError("Text uses a zero font size or scale and cannot be edited")
        f = host.font
        report: dict = {"warnings": [], "substitutes": []}

        segments: list[Segment] = []
        text = "".join(" " if c in "\r\n\t" else c for c in edit.text)
        if _complex_script(text):
            # shaped as one run so conjuncts and matras come out right
            found = self.subs.for_text(f, text)
            if found is None:
                raise EditError("No installed font can render this script; install a font such as Nirmala UI or Noto Sans")
            sub, quality = found
            segments.append(Segment("sub", text, sub=sub))
            report["substitutes"] += [{"char": c, "font": sub.font.label, "quality": quality} for c in text if not c.isspace()]
        else:
            for ch in text:
                if ch in SPACES:
                    code = f.encode_char(" ")
                    if code is not None:
                        self._push(segments, "orig", ch, code)
                    else:
                        w = f.width(b" ") if not f.composite else 0
                        if not w:
                            found = self.subs.for_char(f, " ")
                            w = found[0].advance(" ") if found else 278.0
                        seg = Segment("space", " ")
                        seg.advance = ((w / 1000.0) * host.size + host.tc + host.tw) * host.th
                        segments.append(seg)
                    continue
                code = f.encode_char(ch)
                if code is not None:
                    self._push(segments, "orig", ch, code)
                    continue
                found = self.subs.for_char(f, ch)
                if found is None:
                    raise EditError(f"No available font (original or installed) has a glyph for {ch!r}")
                sub, quality = found
                if segments and segments[-1].kind == "sub" and segments[-1].sub is sub:
                    segments[-1].chars += ch
                else:
                    segments.append(Segment("sub", ch, sub=sub))
                report["substitutes"].append({"char": ch, "font": sub.font.label, "quality": quality})

        # advances
        for seg in segments:
            if seg.kind == "orig":
                for code, ch in zip(seg.codes, seg.chars):
                    f.prepare_code(code, ch)
                seg.advance = sum(
                    ((f.width(c) / 1000.0) * host.size + host.tc + (host.tw if f.is_word_space(c) else 0.0)) * host.th
                    for c in seg.codes
                )
            elif seg.kind == "sub":
                seg.shaped = seg.sub.shape(seg.chars)
                seg.sub.use(seg.shaped)
                seg.advance = sum(((g.advance / 1000.0) * host.size + host.tc) * host.th for g in seg.shaped)
        a_new = sum(s.advance for s in segments)
        last = selected[-1]
        w_span = _text_units(host, (last.end[0] - host.origin[0], last.end[1] - host.origin[1]))

        plan = Plan(edit, host, selected, segments, a_new, w_span, report=report)
        if edit.anchor == "auto":
            plan.edit = Edit(edit.glyphs, edit.text, self._detect_anchor(selected), edit.fit)
        self._fit(plan)
        orig_txt = "".join(g.ch for g in selected)
        n_sub = len(report["substitutes"])
        report.update({
            "originalText": orig_txt,
            "newText": edit.text,
            "font": f.clean_name,
            "fontSize": round(host.eff_size, 2),
            "strategy": "original-font" if n_sub == 0 else ("substitute-font" if n_sub == len(edit.text.replace(" ", "")) else "mixed"),
            "anchor": plan.edit.anchor,
            "fit": edit.fit,
            "scale": round(plan.scale / plan.boost, 4),
            "originalWidth": round(w_span * self._page_per_text(host), 2),
            "newWidth": round(a_new * plan.scale * self._page_per_text(host), 2),
        })
        if n_sub:
            fonts = sorted({s["font"] for s in report["substitutes"]})
            chars = "".join(sorted({s["char"] for s in report["substitutes"]}))
            report["warnings"].append(
                f"The embedded font '{f.clean_name}' has no glyph for {chars!r}; drawn with installed font {', '.join(fonts)}"
            )
        if any(g.stream != "page" for g in selected):
            report["notes"] = ["Text was inside a reusable form object; this use was given its own copy so other uses are unchanged"]
        return plan

    @staticmethod
    def _page_per_text(host: Glyph) -> float:
        return G.norm(G.apply_vec(host.m, 1, 0))

    @staticmethod
    def _push(segments: list[Segment], kind: str, ch: str, code: bytes) -> None:
        if segments and segments[-1].kind == kind:
            segments[-1].chars += ch
            segments[-1].codes.append(code)
        else:
            segments.append(Segment(kind, ch, [code]))

    def _neighbours(self, plan: Plan) -> tuple[Optional[float], Optional[float]]:
        """Free space (text units) right of the span start and left of the span end."""
        host = plan.host
        sel = {g.idx for g in plan.selected}
        d = host.direction
        t0 = -host.origin[0] * d[1] + host.origin[1] * d[0]
        s0 = host.origin[0] * d[0] + host.origin[1] * d[1]
        last = plan.selected[-1]
        s1 = last.end[0] * d[0] + last.end[1] * d[1]
        right = left = None
        size = host.eff_size
        for g in self.model.glyphs:
            if g.idx in sel or g.tr == 7 or g.ch.isspace():
                continue
            gd = g.direction
            if abs(gd[0] - d[0]) > 0.02 or abs(gd[1] - d[1]) > 0.02:
                continue
            t = -g.origin[0] * d[1] + g.origin[1] * d[0]
            if abs(t - t0) > 0.5 * size:
                continue
            gs = g.origin[0] * d[0] + g.origin[1] * d[1]
            ge = g.end[0] * d[0] + g.end[1] * d[1]
            if gs >= s1 - 0.05 * size:
                right = gs if right is None else min(right, gs)
            elif ge <= s0 + 0.05 * size:
                left = ge if left is None else max(left, ge)
        ppt = self._page_per_text(host)
        x0, y0, x1, y1 = self.model.mediabox
        if right is None:
            # distance to the page edge along the baseline
            right = s0 + max(abs(x1 - host.origin[0]), 0) if abs(d[0]) > 0.7 else s0 + abs(y1 - host.origin[1])
        if left is None:
            left = s0 - (abs(host.origin[0] - x0) if abs(d[0]) > 0.7 else abs(host.origin[1] - y0))
        gap = 0.15 * size
        return (right - gap - s0) / ppt, (s1 - (left + gap)) / ppt

    def _segments(self) -> list[list[int]]:
        """Line pieces separated by wide gaps (table cells, tab stops)."""
        out = []
        for line in self.model.lines():
            cur: list[int] = []
            prev = None
            for i in line["glyphs"]:
                g = self.model.glyphs[i]
                if prev is not None:
                    d = prev.direction
                    gap = (g.origin[0] - prev.end[0]) * d[0] + (g.origin[1] - prev.end[1]) * d[1]
                    if gap > 0.8 * max(g.eff_size, prev.eff_size):
                        out.append(cur)
                        cur = []
                if not g.ch.isspace() or cur:
                    cur.append(i)
                prev = g
            if cur:
                out.append(cur)
        return out

    def _detect_anchor(self, selected: list[Glyph]) -> str:
        """Right/center when the selection ends its cell and that cell lines up with
        others on the page by its right edge / centre (number columns, titles)."""
        if selected[0].direction[0] < 0.99:
            return "left"
        sel = {g.idx for g in selected}
        gl = self.model.glyphs

        def box(seg):
            while seg and gl[seg[-1]].ch.isspace():
                seg = seg[:-1]
            return min(gl[i].bbox[0] for i in seg), max(gl[i].bbox[2] for i in seg), seg

        segs = [box(sg) for sg in self._segments()]
        mine = next((b for b in segs if sel & set(b[2])), None)
        if mine is None:
            return "left"
        x0, x1, seg = mine
        cx = (x0 + x1) / 2
        # glyph boxes include side bearings, so centres of centred lines differ by a point or two
        c_tol = max(2.0, 0.08 * selected[0].eff_size)
        right = center = left = 0
        for a0, a1, other in segs:
            if other is seg:
                continue
            if abs(a0 - x0) < 0.6:
                left += 1
            elif abs(a1 - x1) < 0.6:
                right += 1
            elif abs((a0 + a1) / 2 - cx) < c_tol:
                center += 1
        ends = seg[-1] in sel
        if right > left and right >= center and ends:
            return "right"
        if center > left and center > right:
            return "center"
        return "left"

    def _fit(self, plan: Plan) -> None:
        e = plan.edit
        right_room, left_room = self._neighbours(plan)
        plan.boost = self._natural_th(plan) / plan.host.th
        w, a = plan.w_span, plan.a_new * plan.boost
        mode = e.fit
        recenter = False
        if e.anchor == "center" and mode in ("auto", "reflow") and abs(a - w) > 1e-6:
            # centred line: grow or shrink it on both sides, like a word processor would
            recenter = self._check_recenter(plan)
            if recenter:
                mode = "reflow"
        if mode == "auto":
            # Mid-sentence edits close/open the gap when the rest of the line flows from
            # the same text run; table cells and absolutely placed text never move.
            mode = "none"
            if e.anchor == "left" and abs(a - w) > 1e-6:
                try:
                    self._check_reflow(plan)
                    if plan.report.get("reflowGlyphs"):
                        mode = "reflow"
                except EditError:
                    plan.report.pop("reflowGlyphs", None)
            if mode == "none":
                # nothing can move out of the way: narrow the text rather than overprint
                mode = "squeeze-auto"
        plan.report["fitApplied"] = "none" if mode == "squeeze-auto" else mode
        if e.anchor == "right":
            room = left_room
        elif e.anchor == "center":
            extra_r = right_room - w
            extra_l = left_room - w
            room = w + 2 * min(extra_r, extra_l)
        else:
            room = right_room
        if mode == "reflow":
            room = float("inf")
        scale = 1.0
        if mode == "reflow" and a > w:
            # the line may grow, but not past the page margins or the clip area
            ppt = self._page_per_text(plan.host)
            limit = self._line_growth_limit(plan, both_sides=recenter)
            if limit is not None and (a - w) * ppt > limit + 1e-6:
                if e.fit == "auto":
                    scale = (w + limit / ppt) / a
                    plan.report["squeezedToMargins"] = True
                    if scale < 0.6:
                        plan.report["warnings"].append(
                            f"Text compressed to {scale:.0%} of its width to stay inside the page margins; consider shorter text")
                else:
                    plan.report["warnings"].append("The line now runs past the page margin and may be cut off")
        if a > max(room, w) > 0 and mode in ("squeeze", "squeeze-auto"):
            room = max(room, w)
            scale = room / a
            plan.report["fitApplied"] = "squeeze"
            if scale < 0.6:
                plan.report["warnings"].append(f"Text compressed to {scale:.0%} of its width to fit; consider shorter text")
        a_eff = a * scale
        # the original text already occupied w, so anything up to that width always fits
        overflow = max(0.0, a_eff - max(room, w)) if room != float("inf") else 0.0
        ppt = self._page_per_text(plan.host)
        plan.report["fits"] = overflow <= 1e-6
        plan.report["overflow"] = round(overflow * ppt, 2)
        if overflow > 1e-6:
            plan.report["warnings"].append(
                f"New text is {plan.report['overflow']}pt wider than the free space and will overlap neighbouring content"
            )
        if e.anchor == "right" and mode != "reflow":
            pre = w - a_eff
        elif e.anchor == "center" and mode != "reflow":
            pre = (w - a_eff) / 2
        else:
            pre = 0.0
        if recenter:
            plan.lead = -(a_eff - w) / 2
            post = -w
            plan.report["shift"] = round((a_eff - w) / 2 * ppt, 2)
            plan.report["recentered"] = True
        elif mode == "reflow":
            if "reflowGlyphs" not in plan.report:
                self._check_reflow(plan)
            post = -(pre + w)
            plan.report["shift"] = round((a_eff - w) * ppt, 2)
        else:
            post = -(pre + a_eff)
        plan.scale, plan.pre, plan.post = scale * plan.boost, pre, post

    def _line_growth_limit(self, plan: Plan, both_sides: bool) -> Optional[float]:
        """How far (page units) a horizontal line may grow per side before it leaves the
        clip area, the page or the page's text margins."""
        if abs(plan.host.direction[0]) < 0.99:
            return None
        line = [g for g in self._line_glyphs(plan) if not g.ch.isspace()]
        if not line:
            return None
        x0 = min(g.bbox[0] for g in line)
        x1 = max(g.bbox[2] for g in line)
        px0, _, px1, _ = self.model.mediabox
        visible = [g for g in self.model.glyphs if not g.ch.isspace() and g.tr != 7 and abs(g.direction[0]) > 0.99]
        # text margins: the widest text on the page, but never narrower than 10% of the page width
        margin = 0.1 * (px1 - px0)
        left = min(min((g.bbox[0] for g in visible), default=x0), px0 + margin)
        right = max(max((g.bbox[2] for g in visible), default=x1), px1 - margin)
        clip = plan.host.clip
        if clip is not None:
            left, right = max(left, clip[0]), min(right, clip[2])
        left, right = max(left, px0), min(right, px1)
        room_l, room_r = max(0.0, x0 - left), max(0.0, right - x1)
        if plan.host.direction[0] < 0:
            room_l, room_r = room_r, room_l
        return 2 * min(room_l, room_r) if both_sides else room_r

    def _natural_th(self, plan: Plan) -> float:
        """The horizontal scaling (Tz) of the rest of the line. A selection squeezed by an
        earlier edit then gets its normal width back instead of staying squeezed."""
        host = plan.host
        if host.th <= 0:
            return 1.0
        sel = {g.idx for g in plan.selected}
        rest = [g.th for g in self._line_glyphs(plan)
                if g.idx not in sel and g.ch.strip() and abs(g.eff_size - host.eff_size) < 0.05 * host.eff_size]
        if not rest:
            return host.th
        return Counter(round(t, 4) for t in rest).most_common(1)[0][0]

    def _line_glyphs(self, plan: Plan) -> list[Glyph]:
        sel = {g.idx for g in plan.selected}
        return [self.model.glyphs[i] for line in self.model.lines() if sel & set(line["glyphs"]) for i in line["glyphs"]]

    def _check_reflow(self, plan: Plan) -> None:
        sel = {g.idx for g in plan.selected}
        chain = plan.selected[-1].chain
        if any(g.chain != chain for g in plan.selected):
            raise EditError("Reflow is not possible: the selection is positioned in several pieces; use squeeze instead")
        after = [g for g in self._line_glyphs(plan) if g.idx > max(sel)]
        # separately placed spaces (common at the end of Word lines) are invisible and may stay put
        if any(g.chain != chain and not g.ch.isspace() for g in after):
            raise EditError("Reflow is not possible: the rest of the line is positioned independently; use squeeze or keep layout")
        plan.report["reflowGlyphs"] = [g.idx for g in after if g.chain == chain]

    def _check_recenter(self, plan: Plan) -> bool:
        """A centred line can be re-centred when all its visible text is one text run."""
        host = plan.host
        chain = host.chain
        if any(g.chain != chain for g in plan.selected):
            return False
        line = [g for g in self._line_glyphs(plan) if g.chain == chain or not g.ch.isspace()]
        if any(g.chain != chain or g.stream != host.stream for g in line):
            return False
        sel = {g.idx for g in plan.selected}
        plan.lead_glyph = min(line, key=lambda g: g.idx)
        plan.report["reflowGlyphs"] = [g.idx for g in line if g.idx not in sel]
        return True

    # ----------------------------------------------------------------- apply
    def apply(self, edits: list[Edit]) -> list[dict]:
        plans = [self.plan(e) for e in edits]
        used: set[int] = set()
        for p in plans:
            ids = {g.idx for g in p.selected}
            if ids & used:
                raise EditError("Edits overlap")
            used |= ids
        self._register_substitutes(plans)
        by_stream: dict[str, list[Plan]] = {}
        for p in plans:
            for key in {g.stream for g in p.selected}:
                by_stream.setdefault(key, []).append(p)
        for key in by_stream:
            self._detach(key)
        for key, ps in by_stream.items():
            self._rewrite_stream(key, ps)
        for info in self.model.streams.values():
            if info.dirty:
                self._write(info)
        for font in self.model.fonts.all():
            font.commit(self.pdf)
        return [p.report for p in plans]

    def _register_substitutes(self, plans: list[Plan]) -> None:
        for sub in self.subs.by_key.values():
            if sub.gids:
                sub.build(self.pdf)
        # add a resource name in every stream that uses it
        for p in plans:
            res = self.model.streams[p.host.stream].resources
            for seg in p.segments:
                if seg.kind != "sub":
                    continue
                sub = seg.sub
                names = sub.res_names
                rkey = id(res)
                if rkey in names:
                    continue
                if "/Font" not in res:
                    res.Font = pikepdf.Dictionary()
                fonts = res.Font
                n = 1
                while f"/PMF{n}" in fonts:
                    n += 1
                name = f"/PMF{n}"
                fonts[name] = sub.font_obj
                names[rkey] = name

    def _detach(self, key: str) -> None:
        """Give one use of a form XObject its own copy (recursively up to the page)."""
        info = self.model.streams[key]
        if key == "page" or info.detached:
            return
        self._detach(info.parent)
        parent = self.model.streams[info.parent]
        src = info.owner
        clone = pikepdf.Stream(self.pdf, src.read_raw_bytes())
        for k, v in src.items():
            if k != "/Length":
                clone[k] = v
        clone = self.pdf.make_indirect(clone)
        xdict = info.parent_resources.get("/XObject")
        n = 1
        while f"/PMX{n}" in xdict:
            n += 1
        name = f"/PMX{n}"
        xdict[name] = clone
        parent.instructions[info.parent_op] = pikepdf.ContentStreamInstruction([pikepdf.Name(name)], pikepdf.Operator("Do"))
        parent.dirty = True
        info.owner = clone
        info.detached = True

    def _write(self, info) -> None:
        data = pikepdf.unparse_content_stream(info.instructions)
        if info.key == "page":
            info.owner.obj.Contents = self.pdf.make_stream(data)
        else:
            info.owner.write(data)
        info.dirty = False

    def _rewrite_stream(self, key: str, plans: list[Plan]) -> None:
        info = self.model.streams[key]
        selected: dict[tuple, Glyph] = {}
        starts: dict[tuple, Plan] = {}
        leads: dict[tuple, tuple[Plan, Glyph]] = {}
        for p in plans:
            for g in p.selected:
                if g.stream == key:
                    selected[(g.op, g.elem, g.sub)] = g
            if p.host.stream == key:
                starts[(p.host.op, p.host.elem, p.host.sub)] = p
            lg = p.lead_glyph
            if lg is not None and lg.stream == key and abs(p.lead) > 1e-9:
                leads[(lg.op, lg.elem, lg.sub)] = (p, lg)
        touched_ops = sorted({k[0] for k in selected} | {k[0] for k in leads})
        replacement: dict[int, list] = {}
        for op_i in touched_ops:
            replacement[op_i] = self._rewrite_op(info, op_i, selected, starts, leads)
        new_instrs = []
        for i, ins in enumerate(info.instructions):
            if i in replacement:
                new_instrs.extend(replacement[i])
            else:
                new_instrs.append(ins)
        info.instructions = new_instrs
        info.dirty = True

    def _rewrite_op(self, info, op_i: int, selected: dict, starts: dict, leads: dict) -> list:
        ins = info.instructions[op_i]
        op = str(ins.operator)
        ops = list(ins.operands)
        out: list = []
        if op == "'":
            out.append(([], pikepdf.Operator("T*")))
            items = [ops[0]]
        elif op == '"':
            out += [([ops[0]], pikepdf.Operator("Tw")), ([ops[1]], pikepdf.Operator("Tc")), ([], pikepdf.Operator("T*"))]
            items = [ops[2]]
        elif op == "Tj":
            items = [ops[0]]
        else:
            items = list(ops[0])

        # any glyph of the op gives us its text state
        sample = next((g for k, g in selected.items() if k[0] == op_i), None) or next(g for k, (_, g) in leads.items() if k[0] == op_i)
        font, size, th, res = sample.font, sample.size, sample.th, sample.font_res
        to_kern = lambda adv, h=th: -adv * 1000.0 / (size * h)

        cur: list = []

        def add_code(code: bytes) -> None:
            if cur and isinstance(cur[-1], bytearray):
                cur[-1].extend(code)
            else:
                cur.append(bytearray(code))

        def add_kern(k: float) -> None:
            if abs(k) < 1e-6:
                return
            if cur and isinstance(cur[-1], float):
                cur[-1] += k
            else:
                cur.append(float(k))

        def flush() -> None:
            arr = []
            for x in cur:
                if isinstance(x, bytearray):
                    arr.append(pikepdf.String(bytes(x)))
                elif abs(x) > 1e-6:
                    arr.append(round(x, 4))
            if arr:
                out.append(([pikepdf.Array(arr)], pikepdf.Operator("TJ")))
            cur.clear()

        for ei, item in enumerate(items):
            if not isinstance(item, pikepdf.String):
                try:
                    add_kern(float(item))
                except (TypeError, ValueError):
                    pass
                continue
            for si, code in enumerate(font.split(bytes(item))):
                k = (op_i, ei, si)
                if k in leads:
                    # shift the start of a centred line (TJ kerns are in thousandths of text space, negated)
                    p, lg = leads[k]
                    add_kern(-p.lead * 1000.0 / (lg.size * lg.th))
                plan = starts.get(k)
                if plan is not None:
                    self._emit_insertion(plan, cur, add_code, add_kern, flush, out, res, size, th)
                g = selected.get(k)
                if g is not None:
                    add_kern(to_kern(g.adv_text))
                else:
                    add_code(code)
        flush()
        return out

    def _emit_insertion(self, plan: Plan, cur, add_code, add_kern, flush, out, res, size, th) -> None:
        to_kern = lambda adv, h=th: -adv * 1000.0 / (size * h)
        add_kern(to_kern(plan.pre))
        scaled = abs(plan.scale - 1.0) > 1e-4
        host = plan.host
        resources = self.model.streams[host.stream].resources
        for seg in plan.segments:
            if seg.kind == "space":
                add_kern(to_kern(seg.advance * plan.scale))
                continue
            if seg.kind == "orig" and not scaled:
                for c in seg.codes:
                    add_code(c)
                continue
            flush()
            if scaled:
                out.append(([round(th * plan.scale * 100, 4)], pikepdf.Operator("Tz")))
            if seg.kind == "sub":
                name = seg.sub.res_names[id(resources)]
                one_to_one = len(seg.shaped) == len(seg.chars) and all(g.text for g in seg.shaped)
                if not one_to_one:
                    # glyphs and characters do not map 1:1 (conjuncts, reordered matras):
                    # give extractors and search the real text
                    actual = pikepdf.String(codecs.BOM_UTF16_BE + seg.chars.encode("utf-16-be"))
                    out.append(([pikepdf.Name("/Span"), pikepdf.Dictionary(ActualText=actual)], pikepdf.Operator("BDC")))
                out.append(([pikepdf.Name(name), size], pikepdf.Operator("Tf")))
                self._emit_shaped(seg, out, size, host.ts)
            else:
                out.append(([pikepdf.Array([pikepdf.String(b"".join(seg.codes))])], pikepdf.Operator("TJ")))
            if seg.kind == "sub":
                out.append(([pikepdf.Name(res), size], pikepdf.Operator("Tf")))
                if not one_to_one:
                    out.append(([], pikepdf.Operator("EMC")))
            if scaled:
                out.append(([round(th * 100, 4)], pikepdf.Operator("Tz")))
        add_kern(to_kern(plan.post))

    @staticmethod
    def _emit_shaped(seg: Segment, out: list, size: float, ts: float) -> None:
        """Glyph ids with the shaper's positions: TJ kerns for x, Ts rise for y."""
        arr: list = []

        def flush():
            if arr:
                out.append(([pikepdf.Array(arr.copy())], pikepdf.Operator("TJ")))
                arr.clear()

        def kern(k: float):
            if abs(k) < 1e-3:
                return
            if arr and not isinstance(arr[-1], pikepdf.String):
                arr[-1] = round(float(arr[-1]) + k, 3)
            else:
                arr.append(round(k, 3))

        for g in seg.shaped:
            code = pikepdf.String(EmbeddedSubstitute.code(g.gid))
            if abs(g.y_offset) > 0.5:
                flush()
                out.append(([round(ts + g.y_offset / 1000.0 * size, 4)], pikepdf.Operator("Ts")))
                out.append(([pikepdf.Array([v for v in (round(-g.x_offset, 3),) if abs(v) > 1e-3] + [code])], pikepdf.Operator("TJ")))
                out.append(([round(ts, 4)], pikepdf.Operator("Ts")))
            else:
                kern(-g.x_offset)
                arr.append(code)
            # PDF advances by the glyph width; correct to the shaper's advance
            kern(-(g.advance - g.x_offset - g.width))
        flush()
