"""Font model: decode PDF string bytes to unicode + widths, and encode new text
back into the *same* font, checking that the embedded font actually contains
the glyphs (subset fonts usually do not contain every character)."""
from __future__ import annotations

import io
import logging
import re
from functools import lru_cache
from typing import Optional

import pikepdf
from fontTools.agl import UV2AGL, toUnicode
from fontTools.encodings.StandardEncoding import StandardEncoding

from .cmap import CMap, build_tounicode, parse_cmap

log = logging.getLogger(__name__)


def _codec_table(codec: str) -> list[Optional[str]]:
    names: list[Optional[str]] = []
    for b in range(256):
        try:
            ch = bytes([b]).decode(codec)
        except UnicodeDecodeError:
            names.append(None)
            continue
        if b < 32:
            names.append(None)
            continue
        names.append(UV2AGL.get(ord(ch), f"uni{ord(ch):04X}"))
    return names


ENCODINGS: dict[str, list[Optional[str]]] = {
    "WinAnsiEncoding": _codec_table("cp1252"),
    "MacRomanEncoding": _codec_table("mac_roman"),
    "StandardEncoding": [n if n != ".notdef" else None for n in StandardEncoding],
}
ENCODINGS["WinAnsiEncoding"][0xA0] = "space"
ENCODINGS["WinAnsiEncoding"][0xAD] = "hyphen"

_BASE14 = {
    "helvetica": "helv", "helvetica-bold": "hebo", "helvetica-oblique": "heit",
    "helvetica-boldoblique": "hebi", "arial": "helv", "arialmt": "helv",
    "arial-bold": "hebo", "arial-boldmt": "hebo", "arial-italic": "heit",
    "arial-italicmt": "heit", "arial-bolditalic": "hebi", "arial-bolditalicmt": "hebi",
    "times-roman": "tiro", "times-bold": "tibo", "times-italic": "tiit",
    "times-bolditalic": "tibi", "timesnewroman": "tiro", "timesnewromanpsmt": "tiro",
    "courier": "cour", "courier-bold": "cobo", "courier-oblique": "coit",
    "courier-boldoblique": "cobi", "symbol": "symb", "zapfdingbats": "zadb",
}


# Metric-compatible installed fonts for the standard 14 (Arial == Helvetica widths, etc.)
_BASE14_SUBST = {
    "helv": ("Arial", False, False), "hebo": ("Arial", True, False), "heit": ("Arial", False, True),
    "hebi": ("Arial", True, True), "tiro": ("Times New Roman", False, False), "tibo": ("Times New Roman", True, False),
    "tiit": ("Times New Roman", False, True), "tibi": ("Times New Roman", True, True),
    "cour": ("Courier New", False, False), "cobo": ("Courier New", True, False),
    "coit": ("Courier New", False, True), "cobi": ("Courier New", True, True),
    "symb": ("Symbol", False, False), "zadb": ("Segoe UI Symbol", False, False),
}


@lru_cache(maxsize=None)
def _base14_metrics(key: str) -> dict[int, float]:
    """unicode -> advance (1/1000 em) from an installed metric-compatible font."""
    from .sysfonts import load_ttfont, match_font

    family, bold, italic = _BASE14_SUBST.get(key, ("Arial", False, False))
    f, _ = match_font(family, bold, italic, "Times" in family, "Courier" in family)
    if f is None:
        return {}
    tt = load_ttfont(f.path, f.index)
    upem = tt["head"].unitsPerEm
    hmtx = tt["hmtx"]
    return {u: hmtx[name][0] * 1000.0 / upem for u, name in (tt.getBestCmap() or {}).items()}


def _base14_width(key: str, ch: str) -> float:
    if key in ("cour", "cobo", "coit", "cobi"):
        return 600.0
    return _base14_metrics(key).get(ord(ch), 0.0)


SUBSET_RE = re.compile(r"^[A-Z]{6}\+")


class PdfFont:
    """Wraps one PDF font dictionary."""

    def __init__(self, fd: pikepdf.Dictionary):
        self.obj = fd
        self.subtype = str(fd.get("/Subtype", "/Type1"))[1:]
        self.base_font = str(fd.get("/BaseFont", "/Unknown"))[1:]
        self.composite = self.subtype == "Type0"
        self.type3 = self.subtype == "Type3"
        self.vertical = False
        self.warnings: list[str] = []
        self.used_codes: set[bytes] = set()
        self._tu_dirty = False
        self._new_widths: dict[int, float] = {}

        self.descendant = None
        if self.composite:
            desc = fd.get("/DescendantFonts")
            self.descendant = desc[0] if desc is not None and len(desc) else pikepdf.Dictionary()
        self.descriptor = (self.descendant if self.composite else fd).get("/FontDescriptor")

        # ToUnicode
        self.tounicode: dict[bytes, str] = {}
        self.has_tounicode = False
        tu = fd.get("/ToUnicode")
        if isinstance(tu, pikepdf.Stream):
            try:
                self.tounicode = parse_cmap(tu.read_bytes()).unicode
                self.has_tounicode = True
            except Exception as exc:  # pragma: no cover - defensive
                self.warnings.append(f"Unreadable ToUnicode map: {exc}")

        # Encoding / code splitting
        self.code_cmap: Optional[CMap] = None
        self.cmap_name = None
        self.glyph_names: list[Optional[str]] = [None] * 256
        if self.composite:
            enc = fd.get("/Encoding")
            if isinstance(enc, pikepdf.Name):
                self.cmap_name = str(enc)[1:]
                self.vertical = self.cmap_name.endswith("-V")
                if not self.cmap_name.startswith("Identity"):
                    self.warnings.append(f"Predefined CMap {self.cmap_name}: widths may be approximate")
            elif isinstance(enc, pikepdf.Stream):
                self.code_cmap = parse_cmap(enc.read_bytes())
                self.vertical = int(enc.get("/WMode", 0)) == 1
        else:
            self._load_simple_encoding(fd.get("/Encoding"))

        self._load_widths()
        self.ascent, self.descent = self._metrics()
        self.program = None  # fontTools TTFont or CFF top dict
        self.program_kind = None  # "tt" | "cff" | "type1" | None
        self.cff_charset: list[str] = []
        self._load_program()
        self._cid_to_gid = self._load_cid_to_gid()
        self._encode_cache: dict[str, Optional[bytes]] = {}

    # ------------------------------------------------------------------ setup
    def _load_simple_encoding(self, enc) -> None:
        base = "StandardEncoding"
        diffs = None
        if self.subtype == "TrueType" and enc is None:
            base = None
        if isinstance(enc, pikepdf.Name):
            base = str(enc)[1:]
        elif isinstance(enc, pikepdf.Dictionary):
            if "/BaseEncoding" in enc:
                base = str(enc.BaseEncoding)[1:]
            diffs = enc.get("/Differences")
        if base in ENCODINGS:
            self.glyph_names = list(ENCODINGS[base])
        if diffs is not None:
            code = 0
            for item in diffs:
                if isinstance(item, pikepdf.Name):
                    if 0 <= code < 256:
                        self.glyph_names[code] = str(item)[1:]
                    code += 1
                else:
                    code = int(item)
        self.symbolic_no_encoding = base is None

    def _load_widths(self) -> None:
        self.widths: dict[int, float] = {}
        self.default_width = 0.0
        if self.composite:
            d = self.descendant
            self.default_width = float(d.get("/DW", 1000))
            w = d.get("/W")
            if w is not None:
                items = list(w)
                i = 0
                while i < len(items):
                    first = int(items[i])
                    nxt = items[i + 1]
                    if isinstance(nxt, pikepdf.Array):
                        for k, val in enumerate(nxt):
                            self.widths[first + k] = float(val)
                        i += 2
                    else:
                        last, val = int(nxt), float(items[i + 2])
                        for cid in range(first, min(last, first + 65535) + 1):
                            self.widths[cid] = val
                        i += 3
        elif self.type3:
            pass
        else:
            first = int(self.obj.get("/FirstChar", 0))
            arr = self.obj.get("/Widths")
            if arr is not None:
                for k, val in enumerate(arr):
                    self.widths[first + k] = float(val)
            if self.descriptor is not None:
                self.default_width = float(self.descriptor.get("/MissingWidth", 0))
        self.base14 = None
        if not self.composite and "/Widths" not in self.obj:
            key = SUBSET_RE.sub("", self.base_font).lower().replace(",", "-").replace(" ", "")
            self.base14 = _BASE14.get(key) or _BASE14.get(key.split("-")[0])

    def _metrics(self) -> tuple[float, float]:
        asc, desc = 0.0, 0.0
        if self.descriptor is not None:
            asc = float(self.descriptor.get("/Ascent", 0))
            desc = float(self.descriptor.get("/Descent", 0))
        if asc <= 0:
            asc = 800.0
        if desc >= 0:
            desc = -200.0
        if asc - desc > 1600:  # bogus descriptors exist; clamp
            asc, desc = 800.0, -200.0
        return asc, desc

    def _load_program(self) -> None:
        if self.descriptor is None:
            return
        try:
            if "/FontFile2" in self.descriptor:
                from fontTools.ttLib import TTFont

                self.program = TTFont(io.BytesIO(self.descriptor.FontFile2.read_bytes()), lazy=True)
                self.program_kind = "tt"
            elif "/FontFile3" in self.descriptor:
                ff = self.descriptor.FontFile3
                sub = str(ff.get("/Subtype", ""))
                data = ff.read_bytes()
                if sub == "/OpenType":
                    from fontTools.ttLib import TTFont

                    self.program = TTFont(io.BytesIO(data), lazy=True)
                    self.program_kind = "tt" if "glyf" in self.program else "otcff"
                else:
                    from fontTools.cffLib import CFFFontSet

                    cff = CFFFontSet()
                    cff.decompile(io.BytesIO(data), None)
                    self.program = cff[cff.fontNames[0]]
                    self.program_kind = "cff"
                    self.cff_charset = list(self.program.charset)
            elif "/FontFile" in self.descriptor:
                self.program_kind = "type1"
        except Exception as exc:
            log.info("cannot parse font program of %s: %s", self.base_font, exc)
            self.warnings.append("Embedded font program could not be parsed; only characters already used can be reused")
            self.program = None
            self.program_kind = "unknown"

    def _load_cid_to_gid(self):
        if not self.composite:
            return None
        m = self.descendant.get("/CIDToGIDMap")
        if isinstance(m, pikepdf.Stream):
            data = m.read_bytes()
            return [int.from_bytes(data[i:i + 2], "big") for i in range(0, len(data) - 1, 2)]
        return "identity"

    # ------------------------------------------------------------- properties
    @property
    def embedded(self) -> bool:
        return self.descriptor is not None and any(k in self.descriptor for k in ("/FontFile", "/FontFile2", "/FontFile3"))

    @property
    def subset(self) -> bool:
        return bool(SUBSET_RE.match(self.base_font))

    @property
    def clean_name(self) -> str:
        return SUBSET_RE.sub("", self.base_font)

    @property
    def bold(self) -> bool:
        n = self.clean_name.lower()
        flags = int(self.descriptor.get("/Flags", 0)) if self.descriptor is not None else 0
        weight = float(self.descriptor.get("/FontWeight", 400)) if self.descriptor is not None else 400
        return any(w in n for w in ("bold", "black", "heavy", "semibold", "demi")) or bool(flags & (1 << 18)) or weight >= 600

    @property
    def italic(self) -> bool:
        n = self.clean_name.lower()
        flags = int(self.descriptor.get("/Flags", 0)) if self.descriptor is not None else 0
        return "italic" in n or "oblique" in n or bool(flags & 64)

    @property
    def serif(self) -> bool:
        flags = int(self.descriptor.get("/Flags", 0)) if self.descriptor is not None else 0
        n = self.clean_name.lower()
        return bool(flags & 2) or "times" in n or "serif" in n and "sans" not in n or "georgia" in n or "garamond" in n

    @property
    def monospace(self) -> bool:
        flags = int(self.descriptor.get("/Flags", 0)) if self.descriptor is not None else 0
        n = self.clean_name.lower()
        return bool(flags & 1) or "courier" in n or "mono" in n or "consol" in n

    @property
    def editable(self) -> bool:
        return not self.type3 and not self.vertical

    def info(self) -> dict:
        return {
            "name": self.clean_name,
            "baseFont": self.base_font,
            "type": self.subtype,
            "embedded": self.embedded,
            "subset": self.subset,
            "bold": self.bold,
            "italic": self.italic,
            "editable": self.editable,
            "warnings": self.warnings,
        }

    # --------------------------------------------------------------- decoding
    def split(self, data: bytes) -> list[bytes]:
        if not self.composite:
            return [data[i:i + 1] for i in range(len(data))]
        if self.code_cmap is not None:
            return self.code_cmap.split(data)
        return [data[i:i + 2] for i in range(0, len(data), 2)]

    def cid(self, code: bytes) -> int:
        if self.code_cmap is not None and self.code_cmap.cids:
            return self.code_cmap.cids.get(code, 0)
        return int.from_bytes(code, "big")

    def to_unicode(self, code: bytes) -> str:
        u = self.tounicode.get(code)
        if u:
            return u
        if not self.composite:
            name = self.glyph_names[code[0]]
            if name:
                u = toUnicode(name)
                if u:
                    return u
            c = code[0]
            if 32 <= c < 127:
                return chr(c)
            if c >= 0xA0:
                return bytes([c]).decode("cp1252", errors="replace")
            return "\ufffd"
        gid = self._gid(code)
        if isinstance(gid, int) and self.program_kind == "tt":
            rev = self._program_reverse_cmap()
            if gid in rev:
                return rev[gid]
        return "\ufffd"

    def width(self, code: bytes) -> float:
        """Glyph advance in 1/1000 text space units."""
        if self.composite:
            cid = self.cid(code)
            if cid in self._new_widths:
                return self._new_widths[cid]
            return self.widths.get(cid, self.default_width)
        c = code[0]
        if c in self._new_widths:
            return self._new_widths[c]
        if c in self.widths:
            return self.widths[c]
        if self.base14:
            ch = self.to_unicode(code)
            if ch and ch != "\ufffd":
                return _base14_width(self.base14, ch[0])
        return self.default_width

    @staticmethod
    def is_word_space(code: bytes) -> bool:
        return code == b" "

    # -------------------------------------------------------- program access
    def _program_cmap(self) -> dict[int, str]:
        if self.program_kind not in ("tt", "otcff") or "cmap" not in self.program:
            return {}
        best = self.program["cmap"].getBestCmap()
        return best or {}

    def _order_index(self) -> dict[str, int]:
        if not hasattr(self, "_order_idx"):
            self._order_idx = {n: i for i, n in enumerate(self.program.getGlyphOrder())}
        return self._order_idx

    def _program_reverse_cmap(self) -> dict[int, str]:
        if not hasattr(self, "_rev_cmap"):
            index = self._order_index()
            self._rev_cmap = {index[name]: chr(u) for u, name in self._program_cmap().items() if name in index}
        return self._rev_cmap

    def _gid(self, code: bytes):
        """Glyph id (int, TrueType) or glyph name (str, CFF) for a code."""
        if self.program is None:
            return None
        if self.composite:
            cid = self.cid(code)
            if self.program_kind == "tt":
                if self._cid_to_gid == "identity":
                    return cid
                return self._cid_to_gid[cid] if cid < len(self._cid_to_gid) else 0
            if self.program_kind == "cff":
                if hasattr(self.program, "ROS"):
                    name = f"cid{cid:05d}"
                    return name if name in self.program.CharStrings else None
                return self.cff_charset[cid] if cid < len(self.cff_charset) else None
            return None
        c = code[0]
        if self.program_kind == "tt":
            font = self.program
            order = font.getGlyphOrder()
            if "cmap" in font:
                for table in font["cmap"].tables:
                    if table.platformID == 3 and table.platEncID == 0:
                        name = table.cmap.get(0xF000 + c) or table.cmap.get(c)
                        if name:
                            return self._order_index().get(name)
                name = self.glyph_names[c]
                if name and not self.symbolic_no_encoding:
                    u = toUnicode(name)
                    best = self._program_cmap()
                    if u and len(u) == 1 and ord(u) in best:
                        gname = best[ord(u)]
                        return self._order_index().get(gname)
                    if name in self._order_index():
                        return self._order_index()[name]
                for table in font["cmap"].tables:
                    if table.platformID == 1 and table.platEncID == 0:
                        name = table.cmap.get(c)
                        if name:
                            return self._order_index().get(name)
            name = self.glyph_names[c]
            return self._order_index().get(name) if name else None
        if self.program_kind == "cff":
            name = self.glyph_names[c]
            if name and name in self.program.CharStrings:
                return name
            return None
        return None

    def glyph_present(self, code: bytes) -> Optional[bool]:
        """True/False if we can tell from the embedded program, None if unknown."""
        if code in self.used_codes:
            return True
        if not self.embedded:
            if self.composite:
                return None
            return self.glyph_names[code[0]] is not None or self.symbolic_no_encoding
        if self.program is None:
            return None
        gid = self._gid(code)
        if gid is None:
            return False
        if self.program_kind == "tt":
            font = self.program
            order = font.getGlyphOrder()
            if not isinstance(gid, int) or gid <= 0 or gid >= len(order):
                return False
            if "glyf" in font:
                g = font["glyf"][order[gid]]
                if g.numberOfContours == 0:
                    ch = self.to_unicode(code)
                    return ch.isspace() if ch else False
            return True
        if self.program_kind == "cff":
            return gid in self.program.CharStrings and gid != ".notdef"
        return None

    def _program_width(self, code: bytes) -> Optional[float]:
        if self.program_kind != "tt":
            return None
        gid = self._gid(code)
        font = self.program
        order = font.getGlyphOrder()
        if not isinstance(gid, int) or not (0 <= gid < len(order)) or "hmtx" not in font:
            return None
        adv = font["hmtx"][order[gid]][0]
        return adv * 1000.0 / font["head"].unitsPerEm

    # --------------------------------------------------------------- encoding
    def candidate_codes(self, ch: str) -> list[bytes]:
        out = [code for code, u in self.tounicode.items() if u == ch]
        if not self.composite:
            for c in range(256):
                name = self.glyph_names[c]
                if name and toUnicode(name) == ch:
                    out.append(bytes([c]))
            if self.symbolic_no_encoding and len(ch) == 1 and ord(ch) < 256:
                out.append(bytes([ord(ch)]))
        elif self.program_kind == "tt" and len(ch) == 1:
            gname = self._program_cmap().get(ord(ch))
            gid = self._order_index().get(gname)
            if gid is not None:
                cid = None
                if self._cid_to_gid == "identity":
                    cid = gid
                elif isinstance(self._cid_to_gid, list) and gid in self._cid_to_gid:
                    cid = self._cid_to_gid.index(gid)
                identity_enc = self.code_cmap is None and (self.cmap_name or "").startswith("Identity")
                if cid is not None and identity_enc:
                    out.append(cid.to_bytes(2, "big"))
        # prefer codes already drawn in the document
        out.sort(key=lambda c: c not in self.used_codes)
        seen, uniq = set(), []
        for c in out:
            if c not in seen:
                seen.add(c)
                uniq.append(c)
        return uniq

    def encode_char(self, ch: str) -> Optional[bytes]:
        if not self.editable:
            return None
        if ch in self._encode_cache:
            return self._encode_cache[ch]
        result = None
        for code in self.candidate_codes(ch):
            present = self.glyph_present(code)
            if present is True or (present is None and code in self.used_codes):
                result = code
                break
            if present is None and not self.embedded:
                result = code
                break
        self._encode_cache[ch] = result
        return result

    def prepare_code(self, code: bytes, ch: str) -> None:
        """Make sure widths and ToUnicode are right before a new code is drawn."""
        if code not in self.used_codes:
            pw = self._program_width(code)
            if self.composite:
                cid = self.cid(code)
                if cid not in self.widths and pw is not None and abs(pw - self.default_width) > 0.5:
                    self._new_widths[cid] = pw
            else:
                c = code[0]
                cur = self.widths.get(c)
                if (cur is None or cur == 0) and pw:
                    if "/Widths" in self.obj or cur is None and not self.base14:
                        self._new_widths[c] = pw
        if (self.has_tounicode or self.composite) and self.tounicode.get(code) != ch:
            self.tounicode[code] = ch
            self._tu_dirty = True
        self.used_codes.add(code)

    def commit(self, pdf: pikepdf.Pdf) -> None:
        """Write accumulated ToUnicode / width changes back to the font dict."""
        if self._tu_dirty:
            code_len = 2 if self.composite else 1
            self.obj.ToUnicode = pdf.make_stream(build_tounicode(self.tounicode, code_len))
            self.has_tounicode = True
            self._tu_dirty = False
        if not self._new_widths:
            return
        if self.composite:
            w = self.descendant.get("/W")
            if w is None:
                w = pikepdf.Array()
            for cid, val in sorted(self._new_widths.items()):
                w.append(cid)
                w.append(pikepdf.Array([round(val, 3)]))
                self.widths[cid] = val
            self.descendant.W = w
        else:
            first = int(self.obj.get("/FirstChar", 0))
            last = int(self.obj.get("/LastChar", first + len(self.obj.get("/Widths", [])) - 1))
            merged = dict(self.widths)
            merged.update(self._new_widths)
            lo = min(first, *self._new_widths)
            hi = max(last, *self._new_widths)
            self.obj.FirstChar = lo
            self.obj.LastChar = hi
            self.obj.Widths = pikepdf.Array([round(merged.get(c, self.default_width), 3) for c in range(lo, hi + 1)])
            self.widths = merged
        self._new_widths = {}


class FontCache:
    def __init__(self) -> None:
        self._fonts: dict = {}

    def get(self, fd: pikepdf.Dictionary) -> PdfFont:
        key = fd.objgen if fd.is_indirect else id(fd)
        f = self._fonts.get(key)
        if f is None:
            f = PdfFont(fd)
            self._fonts[key] = f
        return f

    def all(self) -> list[PdfFont]:
        return list(self._fonts.values())
