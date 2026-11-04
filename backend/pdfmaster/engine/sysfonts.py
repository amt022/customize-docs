"""Find an installed font that matches a PDF font, and embed it as a compact
Type0/Identity-H subset so missing characters can be drawn in the closest
possible typeface."""
from __future__ import annotations

import io
import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pikepdf
from fontTools import subset as ftsubset
from fontTools.ttLib import TTCollection, TTFont

from .cmap import build_tounicode

log = logging.getLogger(__name__)


def _font_dirs() -> list[Path]:
    dirs = []
    if sys.platform == "win32":
        windir = os.environ.get("WINDIR", r"C:\Windows")
        dirs.append(Path(windir) / "Fonts")
        local = os.environ.get("LOCALAPPDATA")
        if local:
            dirs.append(Path(local) / "Microsoft" / "Windows" / "Fonts")
    elif sys.platform == "darwin":
        dirs += [Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library/Fonts"]
    else:
        dirs += [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts"]
    extra = os.environ.get("PDFMASTER_FONT_DIRS")
    if extra:
        dirs += [Path(p) for p in extra.split(os.pathsep)]
    return [d for d in dirs if d.is_dir()]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


@dataclass
class SysFont:
    path: str
    index: int
    family: str
    style: str
    postscript: str
    bold: bool
    italic: bool

    @property
    def label(self) -> str:
        return f"{self.family} {self.style}".strip()


@lru_cache(maxsize=1)
def font_index() -> list[SysFont]:
    cache = Path(os.environ.get("PDFMASTER_DATA", Path(__file__).resolve().parents[2] / "data")) / "font-index.json"
    try:
        if cache.exists():
            return [SysFont(**d) for d in json.loads(cache.read_text("utf-8"))]
    except Exception:
        pass
    fonts: list[SysFont] = []
    for d in _font_dirs():
        for p in d.rglob("*"):
            if p.suffix.lower() not in (".ttf", ".ttc", ".otf"):
                continue
            try:
                if p.suffix.lower() == ".ttc":
                    faces = TTCollection(str(p), lazy=True).fonts
                else:
                    faces = [TTFont(str(p), lazy=True)]
                for i, f in enumerate(faces):
                    if "glyf" not in f:  # only TrueType outlines are embedded as CIDFontType2
                        continue
                    name = f["name"]
                    fam = str(name.getDebugName(16) or name.getDebugName(1) or "")
                    sty = str(name.getDebugName(17) or name.getDebugName(2) or "")
                    ps = str(name.getDebugName(6) or "")
                    os2 = f["OS/2"] if "OS/2" in f else None
                    bold = (os2.usWeightClass >= 600) if os2 else "bold" in sty.lower()
                    italic = "italic" in sty.lower() or "oblique" in sty.lower()
                    fonts.append(SysFont(str(p), i, fam, sty, ps, bold, italic))
            except Exception as exc:
                log.debug("skip font %s: %s", p, exc)
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps([f.__dict__ for f in fonts]), "utf-8")
    except Exception:
        pass
    return fonts


# Common PDF font names -> installed family names
_ALIASES = {
    "helvetica": ["arial", "liberationsans", "nimbussans", "dejavusans"],
    "arialmt": ["arial"],
    "timesroman": ["timesnewroman", "liberationserif", "nimbusroman", "dejavuserif"],
    "times": ["timesnewroman", "liberationserif"],
    "timesnewromanpsmt": ["timesnewroman"],
    "courier": ["couriernew", "liberationmono", "dejavusansmono"],
    "couriernewpsmt": ["couriernew"],
    "symbol": ["segoeuisymbol", "symbol"],
}
_FALLBACK_SANS = ["arial", "segoeui", "liberationsans", "dejavusans", "notosans"]
_FALLBACK_SERIF = ["timesnewroman", "liberationserif", "dejavuserif", "notoserif"]
_FALLBACK_MONO = ["couriernew", "consolas", "liberationmono", "dejavusansmono"]
# Wide-coverage fonts used per character when the main match lacks a glyph (â‚¹, Devanagari, ...)
_COVERAGE = ["nirmalaui", "mangal", "segoeui", "arialunicodems", "notosansdevanagari", "segoeuisymbol", "dejavusans"]

_STYLE_WORDS = re.compile(r"(bold|italic|oblique|regular|semibold|light|medium|black|mt|ps|-|,)", re.I)


def _family_key(pdf_name: str) -> str:
    base = re.sub(r"^[A-Z]{6}\+", "", pdf_name)
    base = base.split("-")[0].split(",")[0]
    return _norm(_STYLE_WORDS.sub("", base))


def _pick(cands: list[SysFont], bold: bool, italic: bool) -> Optional[SysFont]:
    if not cands:
        return None
    return sorted(cands, key=lambda f: (f.bold != bold, f.italic != italic, f.style.lower() not in ("regular", "bold", "italic", "bold italic")))[0]


def match_font(pdf_name: str, bold: bool, italic: bool, serif: bool, mono: bool) -> tuple[Optional[SysFont], str]:
    """Returns (font, quality) where quality is 'exact' | 'family' | 'similar'."""
    idx = font_index()
    clean = re.sub(r"^[A-Z]{6}\+", "", pdf_name)
    ps = _norm(clean)
    for f in idx:
        if _norm(f.postscript) == ps:
            return f, "exact"
    fam = _family_key(clean)
    by_family: dict[str, list[SysFont]] = {}
    for f in idx:
        by_family.setdefault(_norm(f.family), []).append(f)
    if fam in by_family:
        return _pick(by_family[fam], bold, italic), "family"
    for alias in _ALIASES.get(fam, []) + _ALIASES.get(ps, []):
        if alias in by_family:
            return _pick(by_family[alias], bold, italic), "similar"
    for alias in (_FALLBACK_MONO if mono else _FALLBACK_SERIF if serif else _FALLBACK_SANS):
        if alias in by_family:
            return _pick(by_family[alias], bold, italic), "similar"
    return (idx[0], "similar") if idx else (None, "none")


def coverage_fonts(bold: bool, italic: bool) -> list[SysFont]:
    idx = font_index()
    by_family: dict[str, list[SysFont]] = {}
    for f in idx:
        by_family.setdefault(_norm(f.family), []).append(f)
    return [p for p in (_pick(by_family.get(k, []), bold, italic) for k in _COVERAGE) if p]


@lru_cache(maxsize=64)
def load_ttfont(path: str, index: int) -> TTFont:
    if path.lower().endswith(".ttc"):
        return TTFont(path, fontNumber=index)
    return TTFont(path)


def has_glyph(f: SysFont, ch: str) -> bool:
    tt = load_ttfont(f.path, f.index)
    cmap = tt.getBestCmap() or {}
    return len(ch) == 1 and ord(ch) in cmap


@dataclass
class ShapedGlyph:
    gid: int
    advance: float  # 1/1000 em, as positioned by the shaper
    x_offset: float
    y_offset: float
    width: float  # 1/1000 em, the font's own advance (what a PDF viewer applies)
    text: str  # unicode text of the cluster (first glyph of a cluster only)


class EmbeddedSubstitute:
    """A system font embedded into the PDF for characters the original font lacks.

    Text is shaped with HarfBuzz (ligatures, Indic conjuncts and matra
    reordering) and the subset keeps the original glyph ids, so the content
    stream uses the shaper's glyph ids directly as Identity-H codes."""

    def __init__(self, font: SysFont):
        self.font = font
        self.tt = load_ttfont(font.path, font.index)
        self.cmap = self.tt.getBestCmap() or {}
        self.order = self.tt.getGlyphOrder()
        self.upem = self.tt["head"].unitsPerEm
        self.chars: set[str] = set()
        self.gids: set[int] = set()
        self.tounicode: dict[int, str] = {}
        self.font_obj = None
        self.res_names: dict = {}

    def can(self, ch: str) -> bool:
        return len(ch) == 1 and ord(ch) in self.cmap

    def _width(self, gid: int) -> float:
        return self.tt["hmtx"][self.order[gid]][0] * 1000.0 / self.upem

    def advance(self, ch: str) -> float:
        return self._width(self.order.index(self.cmap[ord(ch)]))

    def shape(self, text: str) -> list[ShapedGlyph]:
        import uharfbuzz as hb

        face = _hb_face(self.font.path, self.font.index)
        hbfont = hb.Font(face)
        hbfont.scale = (self.upem, self.upem)
        buf = hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        hb.shape(hbfont, buf, {"kern": True, "liga": True})
        infos, poss = buf.glyph_infos, buf.glyph_positions
        clusters = sorted({i.cluster for i in infos}) + [len(text)]
        k = 1000.0 / self.upem
        out, seen = [], set()
        for info, pos in zip(infos, poss):
            c = info.cluster
            cluster_text = ""
            if c not in seen:
                seen.add(c)
                nxt = next(x for x in clusters if x > c)
                cluster_text = text[c:nxt]
            out.append(ShapedGlyph(info.codepoint, pos.x_advance * k, pos.x_offset * k, pos.y_offset * k,
                                   self._width(info.codepoint), cluster_text))
        return out

    def use(self, glyphs: list[ShapedGlyph]) -> None:
        for g in glyphs:
            self.gids.add(g.gid)
            if g.text and g.gid not in self.tounicode:
                self.tounicode[g.gid] = g.text

    @staticmethod
    def code(gid: int) -> bytes:
        return gid.to_bytes(2, "big")

    def build(self, pdf: pikepdf.Pdf) -> pikepdf.Dictionary:
        opts = ftsubset.Options()
        opts.glyph_names = False
        opts.notdef_outline = True
        opts.name_IDs = ["*"]
        opts.retain_gids = True
        opts.layout_features = []
        opts.hinting = True
        opts.drop_tables += ["GSUB", "GPOS", "GDEF", "DSIG", "kern"]
        p = self.font.path
        sub = TTFont(p, fontNumber=self.font.index) if p.lower().endswith(".ttc") else TTFont(p)
        subsetter = ftsubset.Subsetter(opts)
        subsetter.populate(gids=[0] + sorted(self.gids))
        subsetter.subset(sub)
        out = io.BytesIO()
        sub.save(out)
        data = out.getvalue()

        tag = "PMSUBS+"
        ps = re.sub(r"[^A-Za-z0-9-]", "", self.font.postscript or self.font.family) or "Font"
        upem = sub["head"].unitsPerEm
        hhea = sub["hhea"]
        os2 = sub["OS/2"] if "OS/2" in sub else None
        head = sub["head"]
        flags = 32 | (64 if self.font.italic else 0) | (1 << 18 if self.font.bold else 0)
        scale = 1000.0 / upem
        descriptor = pikepdf.Dictionary(
            Type=pikepdf.Name.FontDescriptor,
            FontName=pikepdf.Name("/" + tag + ps),
            Flags=flags,
            FontBBox=pikepdf.Array([round(v * scale) for v in (head.xMin, head.yMin, head.xMax, head.yMax)]),
            ItalicAngle=float(sub["post"].italicAngle) if "post" in sub else 0,
            Ascent=round((os2.sTypoAscender if os2 else hhea.ascent) * scale),
            Descent=round((os2.sTypoDescender if os2 else hhea.descent) * scale),
            CapHeight=round((getattr(os2, "sCapHeight", 0) or hhea.ascent) * scale),
            StemV=120 if self.font.bold else 80,
            FontFile2=pdf.make_stream(data),
        )
        widths = pikepdf.Array()
        for gid in sorted(self.gids):
            widths.append(gid)
            widths.append(pikepdf.Array([round(self._width(gid), 3)]))
        cidfont = pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.CIDFontType2,
            BaseFont=pikepdf.Name("/" + tag + ps),
            CIDSystemInfo=pikepdf.Dictionary(Registry=pikepdf.String("Adobe"), Ordering=pikepdf.String("Identity"), Supplement=0),
            FontDescriptor=pdf.make_indirect(descriptor),
            DW=1000,
            W=widths,
            CIDToGIDMap=pikepdf.Name.Identity,
        )
        tounicode = {self.code(g): t for g, t in self.tounicode.items()}
        font = pikepdf.Dictionary(
            Type=pikepdf.Name.Font,
            Subtype=pikepdf.Name.Type0,
            BaseFont=pikepdf.Name("/" + tag + ps),
            Encoding=pikepdf.Name("/Identity-H"),
            DescendantFonts=pikepdf.Array([pdf.make_indirect(cidfont)]),
            ToUnicode=pdf.make_stream(build_tounicode(tounicode, 2)),
        )
        self.font_obj = pdf.make_indirect(font)
        return self.font_obj


@lru_cache(maxsize=16)
def _hb_face(path: str, index: int):
    import uharfbuzz as hb

    blob = hb.Blob.from_file_path(path)
    return hb.Face(blob, index)
