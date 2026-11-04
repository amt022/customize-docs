"""Content-stream interpreter: walks page (and form XObject) content and
records every glyph with its exact geometry, style and *source location*
(stream, operator index, array element, code index) so the editor can
rewrite exactly that glyph and nothing else."""
from __future__ import annotations

import codecs
import math
from dataclasses import dataclass, field
from typing import Optional

import pikepdf

from . import geometry as G
from .fonts import FontCache, PdfFont

TEXT_SHOW = {"Tj", "TJ", "'", '"'}


@dataclass
class TextState:
    font: Optional[PdfFont] = None
    font_res: Optional[str] = None
    size: float = 0.0
    tc: float = 0.0
    tw: float = 0.0
    th: float = 1.0
    tl: float = 0.0
    tr: int = 0
    ts: float = 0.0

    def copy(self) -> "TextState":
        return TextState(**self.__dict__)


PATH_END = {"n", "f", "F", "f*", "S", "s", "B", "B*", "b", "b*"}


@dataclass
class GState:
    ctm: G.Matrix = G.IDENTITY
    text: TextState = field(default_factory=TextState)
    fill_space: str = "DeviceGray"
    fill: tuple = (0.0,)
    clip: Optional[tuple[float, float, float, float]] = None  # bounding box of the clip path, page space

    def copy(self) -> "GState":
        return GState(self.ctm, self.text.copy(), self.fill_space, self.fill, self.clip)


def _intersect(a, b):
    if a is None:
        return b
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


@dataclass
class StreamInfo:
    key: str
    owner: object  # pikepdf.Page or pikepdf.Stream (form xobject)
    instructions: list
    resources: pikepdf.Dictionary
    parent: Optional[str] = None  # stream containing the Do operator
    parent_op: int = -1
    parent_resources: Optional[pikepdf.Dictionary] = None
    detached: bool = False
    dirty: bool = False


@dataclass
class Glyph:
    idx: int
    ch: str
    code: bytes
    font: PdfFont
    font_res: str
    size: float
    eff_size: float
    tc: float
    tw: float
    th: float
    ts: float
    tr: int
    color: str
    m: G.Matrix  # text space -> page space at the glyph origin (Tm x CTM)
    origin: tuple[float, float]
    end: tuple[float, float]
    adv_text: float  # advance in unscaled text space units (incl. Tc/Tw/Th)
    quad: list[tuple[float, float]]
    stream: str
    op: int
    elem: int  # TJ array index (0 for Tj/'/")
    sub: int  # code index inside the string
    chain: int  # changes whenever the text position is set absolutely
    group: int = -1  # ActualText span the glyph belongs to (edited as a unit)
    clip: Optional[tuple[float, float, float, float]] = None  # clip box in force when drawn

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        xs = [p[0] for p in self.quad]
        ys = [p[1] for p in self.quad]
        return (min(xs), min(ys), max(xs), max(ys))

    @property
    def direction(self) -> tuple[float, float]:
        v = G.apply_vec(self.m, 1, 0)
        n = G.norm(v) or 1.0
        return (v[0] / n, v[1] / n)

    @property
    def angle(self) -> float:
        d = self.direction
        return math.degrees(math.atan2(d[1], d[0]))


def _pdf_text(s) -> str:
    b = bytes(s)
    if b.startswith(codecs.BOM_UTF16_BE):
        return b[2:].decode("utf-16-be", errors="replace")
    return str(s)


def _color_hex(space: str, comps: tuple) -> str:
    try:
        c = [float(x) for x in comps]
        if space in ("DeviceRGB", "CalRGB") and len(c) >= 3:
            r, g, b = c[:3]
        elif space == "DeviceCMYK" and len(c) >= 4:
            C, M, Y, K = c[:4]
            r, g, b = (1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)
        elif len(c) == 1:
            r = g = b = c[0]
        elif len(c) == 3:
            r, g, b = c
        elif len(c) == 4:
            C, M, Y, K = c
            r, g, b = (1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)
        else:
            return "#000000"
        return "#%02x%02x%02x" % tuple(max(0, min(255, round(v * 255))) for v in (r, g, b))
    except Exception:
        return "#000000"


class PageModel:
    """All glyphs of one page, in content-stream order."""

    def __init__(self, pdf: pikepdf.Pdf, page_index: int, fonts: Optional[FontCache] = None):
        self.pdf = pdf
        self.page_index = page_index
        self.page = pdf.pages[page_index]
        self.fonts = fonts or FontCache()
        self.streams: dict[str, StreamInfo] = {}
        self.glyphs: list[Glyph] = []
        self.image_area = 0.0
        self.warnings: list[str] = []
        self._chain = 0
        self._visiting: set = set()
        self._groups = 0
        self._occurrences: dict[str, int] = {}
        self.images: list[dict] = []  # image XObjects drawn on the page (for OCR / scan edits)
        resources = self.page.obj.get("/Resources")
        if resources is None:
            resources = self.page.resources  # inherited from the page tree
        instrs = pikepdf.parse_content_stream(self.page)
        self.streams["page"] = StreamInfo("page", self.page, instrs, resources)
        self._run("page", instrs, resources, GState(), 0)

    # ------------------------------------------------------------------ geometry
    @property
    def mediabox(self) -> tuple[float, float, float, float]:
        box = self.page.obj.get("/CropBox") or self.page.mediabox
        x0, y0, x1, y1 = (float(v) for v in box)
        return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))

    @property
    def rotation(self) -> int:
        return int(self.page.obj.get("/Rotate", 0)) % 360

    # ---------------------------------------------------------------- interpret
    def _run(self, key: str, instrs, resources, gs: GState, depth: int) -> None:
        stack: list[GState] = []
        marked: list[Optional[list]] = []  # BDC stack: [text, group id, first glyph seen]
        tm = tlm = G.IDENTITY
        fonts_res = resources.get("/Font") if resources is not None else None
        path: list[tuple[float, float]] = []  # current path points, page space (for clip boxes)
        clip_pending = False
        for op_i, ins in enumerate(instrs):
            op = str(ins.operator)
            if op == "INLINE IMAGE":
                self.image_area += abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])
                continue
            ops = ins.operands
            ts = gs.text
            try:
                if op == "q":
                    stack.append(gs.copy())
                elif op == "Q":
                    if stack:
                        gs = stack.pop()
                elif op == "cm":
                    gs.ctm = G.mul(G.mat(ops), gs.ctm)
                elif op == "re":
                    x, y, w, h = (float(v) for v in ops[:4])
                    path += [G.apply(gs.ctm, x, y), G.apply(gs.ctm, x + w, y), G.apply(gs.ctm, x, y + h), G.apply(gs.ctm, x + w, y + h)]
                elif op in ("m", "l"):
                    path.append(G.apply(gs.ctm, float(ops[0]), float(ops[1])))
                elif op in ("c", "v", "y"):
                    nums = [float(v) for v in ops]
                    path += [G.apply(gs.ctm, nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
                elif op in ("W", "W*"):
                    clip_pending = True
                elif op in PATH_END:
                    if clip_pending and path:
                        xs = [pt[0] for pt in path]
                        ys = [pt[1] for pt in path]
                        gs.clip = _intersect(gs.clip, (min(xs), min(ys), max(xs), max(ys)))
                    path = []
                    clip_pending = False
                elif op == "BT":
                    tm = tlm = G.IDENTITY
                    self._chain += 1
                elif op == "ET":
                    pass
                elif op == "Td":
                    tlm = G.mul(G.translate(float(ops[0]), float(ops[1])), tlm)
                    tm = tlm
                    self._chain += 1
                elif op == "TD":
                    ts.tl = -float(ops[1])
                    tlm = G.mul(G.translate(float(ops[0]), float(ops[1])), tlm)
                    tm = tlm
                    self._chain += 1
                elif op == "Tm":
                    tm = tlm = G.mat(ops)
                    self._chain += 1
                elif op == "T*":
                    tlm = G.mul(G.translate(0, -ts.tl), tlm)
                    tm = tlm
                    self._chain += 1
                elif op == "Tc":
                    ts.tc = float(ops[0])
                elif op == "Tw":
                    ts.tw = float(ops[0])
                elif op == "Tz":
                    ts.th = float(ops[0]) / 100.0
                elif op == "TL":
                    ts.tl = float(ops[0])
                elif op == "Tr":
                    ts.tr = int(ops[0])
                elif op == "Ts":
                    ts.ts = float(ops[0])
                elif op == "Tf":
                    name = str(ops[0])
                    ts.font_res = name
                    ts.size = float(ops[1])
                    fd = fonts_res.get(name) if fonts_res is not None else None
                    ts.font = self.fonts.get(fd) if isinstance(fd, pikepdf.Dictionary) else None
                    if ts.font is None:
                        self.warnings.append(f"Font resource {name} missing")
                elif op in ("g", "rg", "k"):
                    gs.fill_space = {"g": "DeviceGray", "rg": "DeviceRGB", "k": "DeviceCMYK"}[op]
                    gs.fill = tuple(ops)
                elif op == "cs":
                    gs.fill_space = str(ops[0])[1:]
                    gs.fill = (0.0,)
                elif op in ("sc", "scn"):
                    nums = tuple(o for o in ops if not isinstance(o, pikepdf.Name))
                    if nums:
                        gs.fill = nums
                elif op in TEXT_SHOW:
                    if op == "'" or op == '"':
                        if op == '"':
                            ts.tw, ts.tc = float(ops[0]), float(ops[1])
                        tlm = G.mul(G.translate(0, -ts.tl), tlm)
                        tm = tlm
                        self._chain += 1
                        items = [(0, ops[-1])]
                    elif op == "Tj":
                        items = [(0, ops[0])]
                    else:
                        items = list(enumerate(ops[0]))
                    start = len(self.glyphs)
                    tm = self._show(items, gs, tm, key, op_i)
                    span = next((m for m in reversed(marked) if m is not None), None)
                    if span is not None:
                        for g in self.glyphs[start:]:
                            g.group = span[1]
                            g.ch = "" if span[2] else span[0]
                            span[2] = True
                elif op == "Do":
                    self._do(str(ops[0]), resources, gs, depth, key, op_i)
                elif op in ("BDC", "BMC"):
                    entry = None
                    props = ops[1] if op == "BDC" and len(ops) > 1 else None
                    if isinstance(props, pikepdf.Dictionary) and "/ActualText" in props:
                        self._groups += 1
                        entry = [_pdf_text(props.ActualText), self._groups, False]
                    marked.append(entry)
                elif op == "EMC":
                    if marked:
                        marked.pop()
            except (IndexError, TypeError, ValueError) as exc:
                self.warnings.append(f"Skipped malformed operator {op}: {exc}")

    def _do(self, name: str, resources, gs: GState, depth: int, parent: str, op_i: int) -> None:
        xobjs = resources.get("/XObject") if resources is not None else None
        xo = xobjs.get(name) if xobjs is not None else None
        if not isinstance(xo, pikepdf.Stream):
            return
        sub = str(xo.get("/Subtype", ""))
        if sub == "/Image":
            self.image_area += abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])
            self.images.append({"name": name, "xobj": xo, "ctm": gs.ctm, "stream": parent, "op": op_i, "clip": gs.clip})
            return
        if sub != "/Form" or depth > 8:
            return
        base = f"xobj:{xo.objgen[0]}:{xo.objgen[1]}" if xo.is_indirect else f"xobj:{id(xo)}"
        if base in self._visiting:
            return
        # every use of a form gets its own key, so an edit can detach just that use
        n = self._occurrences.get(base, 0)
        self._occurrences[base] = n + 1
        key = f"{base}#{n}"
        self._visiting.add(base)
        try:
            inner = gs.copy()
            if "/Matrix" in xo:
                inner.ctm = G.mul(G.mat(xo.Matrix), inner.ctm)
            res = xo.get("/Resources") or resources
            self.streams[key] = StreamInfo(key, xo, pikepdf.parse_content_stream(xo), res, parent, op_i, resources)
            self._run(key, self.streams[key].instructions, res, inner, depth + 1)
        finally:
            self._visiting.discard(base)

    def _show(self, items, gs: GState, tm: G.Matrix, key: str, op_i: int) -> G.Matrix:
        ts = gs.text
        font = ts.font
        color = _color_hex(gs.fill_space, gs.fill)
        for ei, item in items:
            if not isinstance(item, pikepdf.String):
                try:
                    tx = -float(item) / 1000.0 * ts.size * ts.th
                except (TypeError, ValueError):
                    continue
                tm = G.mul(G.translate(tx, 0), tm)
                continue
            if font is None:
                continue
            data = bytes(item)
            for si, code in enumerate(font.split(data)):
                w0 = font.width(code) / 1000.0
                m = G.mul(tm, gs.ctm)
                trm = G.mul((ts.size * ts.th, 0, 0, ts.size, 0, ts.ts), m)
                asc, desc = font.ascent / 1000.0, font.descent / 1000.0
                quad = [G.apply(trm, 0, desc), G.apply(trm, w0, desc), G.apply(trm, w0, asc), G.apply(trm, 0, asc)]
                tx = (w0 * ts.size + ts.tc + (ts.tw if font.is_word_space(code) else 0.0)) * ts.th
                origin = G.apply(trm, 0, 0)
                eff = ts.size * G.norm(G.apply_vec(m, 0, 1))
                font.used_codes.add(code)
                nxt = G.mul(G.translate(tx, 0), tm)
                end = G.apply(G.mul((1, 0, 0, 1, 0, ts.ts), G.mul(nxt, gs.ctm)), 0, 0)
                self.glyphs.append(Glyph(
                    idx=len(self.glyphs), ch=font.to_unicode(code), code=code, font=font,
                    font_res=ts.font_res, size=ts.size, eff_size=eff, tc=ts.tc, tw=ts.tw,
                    th=ts.th, ts=ts.ts, tr=ts.tr, color=color, m=m, origin=origin, end=end,
                    adv_text=tx, quad=quad, stream=key, op=op_i, elem=ei, sub=si, chain=self._chain,
                    clip=gs.clip,
                ))
                tm = nxt
        return tm

    # -------------------------------------------------------------------- lines
    def lines(self) -> list[dict]:
        """Group glyphs into visual line segments (stream order + geometry)."""
        out: list[dict] = []
        cur: Optional[dict] = None
        prev: Optional[Glyph] = None
        for g in self.glyphs:
            if g.tr == 7:
                continue
            d = g.direction
            s = g.origin[0] * d[0] + g.origin[1] * d[1]
            t = -g.origin[0] * d[1] + g.origin[1] * d[0]
            if cur is not None and prev is not None:
                pd = prev.direction
                pe = prev.end[0] * pd[0] + prev.end[1] * pd[1]
                size = max(prev.eff_size, g.eff_size, 1e-3)
                same_dir = abs(d[0] - pd[0]) < 0.02 and abs(d[1] - pd[1]) < 0.02
                gap = s - pe
                if same_dir and abs(t - cur["t"]) < 0.35 * size and -0.5 * size < gap < 2.5 * size:
                    if gap > 0.18 * size and not prev.ch.isspace() and not g.ch.isspace() and (g.group < 0 or g.group != prev.group):
                        cur["chars"].append(" ")
                        cur["map"].append(-1)
                    for c in g.ch:
                        cur["chars"].append(c)
                        cur["map"].append(g.idx)
                    cur["glyphs"].append(g.idx)
                    prev = g
                    continue
            cur = {"t": t, "chars": list(g.ch or "�"), "map": [g.idx] * len(g.ch or "�"), "glyphs": [g.idx]}
            out.append(cur)
            prev = g
        result = []
        for i, ln in enumerate(out):
            boxes = [self.glyphs[k].bbox for k in ln["glyphs"]]
            result.append({
                "id": i,
                "text": "".join(ln["chars"]),
                "map": ln["map"],
                "glyphs": ln["glyphs"],
                "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
            })
        return result

    def page_type(self) -> str:
        visible = sum(1 for g in self.glyphs if g.tr not in (3, 7))
        invisible = len(self.glyphs) - visible
        x0, y0, x1, y1 = self.mediabox
        img_cov = self.image_area / max((x1 - x0) * (y1 - y0), 1)
        if visible > 0:
            return "hybrid" if img_cov > 0.5 else "digital"
        if invisible > 0 or img_cov > 0.3:
            return "scanned"
        return "empty"
