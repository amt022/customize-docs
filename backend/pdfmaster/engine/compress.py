"""Make a PDF smaller for download.

Levels:
  none      the file as stored
  lossless  identical pages: recompress every stream at maximum Flate, pack objects into
            compressed object streams, store identical streams (images, fonts) once, re-encode Type 1
            fonts as compact CFF, merge the replacement-font subsets that separate edits embedded,
            drop unused resources and thumbnails
  balanced  lossless + font hinting removed (screen-grid instructions; outlines unchanged)
            + photos above 150 dpi downsampled and re-encoded as JPEG (quality 75)
  strong    balanced, but images above 100 dpi, JPEG quality 60, and accessibility tags and
            XMP metadata removed

Glyph outlines, text and vector graphics are never altered, so text stays sharp and editable.
Bilevel scans (CCITT / JBIG2), images with decode arrays or unusual colour spaces are left alone.
"""
from __future__ import annotations

import hashlib
import io
import math
import zlib
from dataclasses import dataclass

import pikepdf
from PIL import Image

from .interpreter import PageModel

LEVELS = {
    # max effective dpi, JPEG quality
    "balanced": (150, 75),
    "strong": (100, 60),
}


@dataclass
class CompressResult:
    data: bytes
    original_size: int
    size: int
    images_recompressed: int
    level: str

    def stats(self) -> dict:
        saved = self.original_size - self.size
        return {"level": self.level, "originalSize": self.original_size, "size": self.size,
                "saved": saved, "savedPercent": round(100 * saved / self.original_size, 1) if self.original_size else 0.0,
                "imagesRecompressed": self.images_recompressed}


def compress(data: bytes, level: str = "lossless") -> CompressResult:
    if level == "none":
        return CompressResult(data, len(data), len(data), 0, level)
    if level not in ("lossless", *LEVELS):
        raise ValueError(f"Unknown compression level {level!r}")
    pdf = pikepdf.open(io.BytesIO(data))
    n_images = 0
    if level in LEVELS:
        n_images = _recompress_images(pdf, *LEVELS[level])
    _strip_extras(pdf)
    _merge_substitute_fonts(pdf)
    _type1_to_cff(pdf)
    _slim_truetype(pdf, drop_hints=level in LEVELS)
    if level == "strong":
        _strip_structure(pdf)
    _dedupe_streams(pdf)
    try:
        pdf.remove_unreferenced_resources()
    except Exception:
        pass  # unusual resource trees: keep them rather than fail the download
    buf = io.BytesIO()
    pdf.save(buf, compress_streams=True, recompress_flate=True,
             stream_decode_level=pikepdf.StreamDecodeLevel.generalized,
             object_stream_mode=pikepdf.ObjectStreamMode.generate)
    out = buf.getvalue()
    if len(out) >= len(data):  # never hand back a bigger file
        out = data
        n_images = 0
    return CompressResult(out, len(data), len(out), n_images, level)


def _strip_extras(pdf: pikepdf.Pdf) -> None:
    """Data no viewer needs to display the document."""
    for page in pdf.pages:
        for key in ("/Thumb", "/PieceInfo"):
            if key in page.obj:
                del page.obj[key]
    if "/PieceInfo" in pdf.Root:
        del pdf.Root["/PieceInfo"]


def _merge_substitute_fonts(pdf: pikepdf.Pdf) -> None:
    """Each text edit embeds its own subset of the replacement font. The subsets keep the
    original glyph ids (retain_gids), so they merge into one font program all edits share."""
    from fontTools.ttLib import TTFont

    groups: dict[str, list] = {}
    for obj in pdf.objects:
        if isinstance(obj, pikepdf.Dictionary) and obj.get("/Type") == "/FontDescriptor" and "/FontFile2" in obj:
            name = str(obj.get("/FontName", ""))
            if name.startswith("/PMSUBS+"):
                groups.setdefault(name, []).append(obj)
    for descs in groups.values():
        streams = {d.FontFile2.objgen: d.FontFile2 for d in descs if d.FontFile2.is_indirect}
        if len(streams) < 2:
            continue
        try:
            fonts = [TTFont(io.BytesIO(st.read_bytes())) for st in streams.values()]
            if any("glyf" not in f for f in fonts):
                continue
            base = max(fonts, key=lambda f: f["maxp"].numGlyphs)
            order = base.getGlyphOrder()
            for other in fonts:
                if other is base:
                    continue
                o_order = other.getGlyphOrder()
                if len(o_order) > len(order):
                    raise ValueError("not subsets of the same font")
                # glyph ids are shared (retain_gids); glyph names may differ between subsets
                to_base = {n: order[i] for i, n in enumerate(o_order)}
                for gid, name in enumerate(o_order):
                    g = other["glyf"][name]
                    b_name = order[gid]
                    if g.numberOfContours == 0 or base["glyf"][b_name].numberOfContours != 0:
                        continue
                    if g.isComposite():
                        for comp in g.components:
                            comp.glyphName = to_base[comp.glyphName]
                    base["glyf"][b_name] = g
                    base["hmtx"][b_name] = other["hmtx"][name]
            buf = io.BytesIO()
            base.save(buf)
        except Exception:
            continue
        merged = pdf.make_stream(buf.getvalue())
        for d in descs:
            d.FontFile2 = merged


def _type1_to_cff(pdf: pikepdf.Pdf) -> int:
    """Re-encode embedded Type 1 font programs (FontFile) as CFF (FontFile3 /Type1C).

    Type 1 charstrings are eexec-encrypted, so Flate cannot shrink them; the same outlines in
    CFF are typically 70-80% smaller (LaTeX documents are mostly font data). Outlines are kept
    exactly (no coordinate rounding); only the hinting instructions are dropped."""
    from fontTools import t1Lib
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.t2CharStringPen import T2CharStringPen

    converted = 0
    seen: set = set()
    for desc in list(pdf.objects):
        if not (isinstance(desc, pikepdf.Dictionary) and desc.get("/Type") == "/FontDescriptor" and "/FontFile" in desc):
            continue
        ff = desc.FontFile
        if ff.is_indirect and ff.objgen in seen:
            continue
        try:
            t1 = t1Lib.T1Font.__new__(t1Lib.T1Font)  # parse from bytes rather than a file path
            t1.encoding = "ascii"
            t1.data = ff.read_bytes()
            t1.parse()
            font = t1.font
            glyphs = font["CharStrings"]
            order = [".notdef"] + [n for n in glyphs.keys() if n != ".notdef"]
            charstrings = {}
            for name in order:
                pen = T2CharStringPen(width=0, glyphSet=None, roundTolerance=0)
                if name in glyphs:
                    cs = glyphs[name]
                    cs.draw(pen)  # running the charstring also reads its advance width (hsbw)
                    pen = T2CharStringPen(width=getattr(cs, "width", 0) or 0, glyphSet=None, roundTolerance=0)
                    cs.draw(pen)
                charstrings[name] = pen.getCharString()
            ps = str(font.get("FontName", "Font"))
            fb = FontBuilder(1000, isTTF=False)
            fb.setupGlyphOrder(order)
            fb.setupCFF(ps, {"FullName": str(font.get("FullName", ps))}, charstrings, {})
            cff = fb.font["CFF "].cff
            top = cff.topDictIndex[0]
            matrix = font.get("FontMatrix")
            if matrix:
                top.FontMatrix = [float(v) for v in matrix]
            enc = font.get("Encoding")
            if isinstance(enc, list) and len(enc) == 256:
                # symbolic fonts (TeX) rely on their built-in encoding
                top.Encoding = [n if n in charstrings else ".notdef" for n in enc]
            elif enc != "StandardEncoding":
                continue
            buf = io.BytesIO()
            cff.compile(buf, fb.font)
            data = buf.getvalue()
        except Exception:
            continue  # seac accents, unusual fonts: keep the original program
        if len(data) >= len(ff.read_raw_bytes()):
            continue
        new = pdf.make_stream(data, Subtype=pikepdf.Name.Type1C)
        for d in pdf.objects:
            if isinstance(d, pikepdf.Dictionary) and d.get("/Type") == "/FontDescriptor" and "/FontFile" in d                     and d.FontFile.is_indirect and ff.is_indirect and d.FontFile.objgen == ff.objgen:
                del d["/FontFile"]
                d.FontFile3 = new
        if ff.is_indirect:
            seen.add(ff.objgen)
        converted += 1
    return converted


# tables PDF viewers never read: device metrics, layout features (glyph positions come from the
# content stream), signatures
UNUSED_TT_TABLES = ("VDMX", "hdmx", "LTSH", "DSIG", "PCLT", "kern", "GPOS", "GSUB", "GDEF", "JSTF", "meta", "BASE", "MATH")


def _slim_truetype(pdf: pikepdf.Pdf, drop_hints: bool) -> None:
    """Drop TrueType tables no PDF viewer uses (pixel-identical). With drop_hints, also remove
    the hinting programs: glyph outlines stay exact, only screen-grid fitting is lost, which
    changes antialiasing by a fraction of a pixel and nothing in print."""
    from fontTools.ttLib import TTFont

    done: set = set()
    for desc in list(pdf.objects):
        if not (isinstance(desc, pikepdf.Dictionary) and desc.get("/Type") == "/FontDescriptor" and "/FontFile2" in desc):
            continue
        ff = desc.FontFile2
        if not ff.is_indirect or ff.objgen in done:
            continue
        done.add(ff.objgen)
        try:
            font = TTFont(io.BytesIO(ff.read_bytes()))
            changed = False
            for tag in UNUSED_TT_TABLES:
                if tag in font:
                    del font[tag]
                    changed = True
            if drop_hints and "glyf" in font:
                for tag in ("fpgm", "prep", "cvt "):
                    if tag in font:
                        del font[tag]
                        changed = True
                glyf = font["glyf"]
                for name in glyf.keys():
                    g = glyf[name]
                    g.expand(glyf)
                    if hasattr(g, "program") and len(g.program.getBytecode()):
                        g.removeHinting()
                        changed = True
                maxp = font["maxp"]
                for attr in ("maxSizeOfInstructions", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements",
                             "maxTwilightPoints", "maxStorage"):
                    if hasattr(maxp, attr):
                        setattr(maxp, attr, 0)
                maxp.maxZones = 1
            if not changed:
                continue
            buf = io.BytesIO()
            font.save(buf)
        except Exception:
            continue  # unusual font: keep it exactly as it is
        data = buf.getvalue()
        if len(data) < len(ff.read_bytes()):
            ff.write(data)
            if "/Length1" in ff:
                ff.Length1 = len(data)


def _strip_structure(pdf: pikepdf.Pdf) -> None:
    """Smallest only: accessibility tags (structure tree) and XMP metadata. Pages look the
    same; screen readers lose the reading structure."""
    for key in ("/StructTreeRoot", "/MarkInfo", "/Metadata"):
        if key in pdf.Root:
            del pdf.Root[key]
    for page in pdf.pages:
        if "/StructParents" in page.obj:
            del page.obj["/StructParents"]
        for a in page.obj.get("/Annots") or []:
            if isinstance(a, pikepdf.Dictionary) and "/StructParent" in a:
                del a["/StructParent"]


def _dedupe_streams(pdf: pikepdf.Pdf) -> None:
    """Point every reference to a byte-identical stream (same data, same dictionary) at one copy."""
    canonical: dict[tuple, pikepdf.Object] = {}
    remap: dict[tuple, pikepdf.Object] = {}
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream):
            continue
        try:
            raw = obj.read_raw_bytes()
        except Exception:
            continue
        meta = repr(sorted((str(k), repr(v)) for k, v in obj.items() if k != "/Length"))
        key = (hashlib.sha1(raw).hexdigest(), meta)
        if key in canonical:
            remap[obj.objgen] = canonical[key]
        else:
            canonical[key] = obj
    if not remap:
        return
    def swap(v):
        if isinstance(v, pikepdf.Object) and v.is_indirect and v.objgen in remap:
            return remap[v.objgen]
        return None

    def fix(container) -> None:
        # direct containers cannot form cycles; indirect ones are each visited from pdf.objects
        if isinstance(container, pikepdf.Array):
            for i in range(len(container)):
                v = container[i]
                new = swap(v)
                if new is not None:
                    container[i] = new
                elif isinstance(v, (pikepdf.Array, pikepdf.Dictionary)) and not v.is_indirect:
                    fix(v)
        else:
            for k in list(container.keys()):
                v = container[k]
                new = swap(v)
                if new is not None:
                    container[k] = new
                elif isinstance(v, (pikepdf.Array, pikepdf.Dictionary)) and not v.is_indirect:
                    fix(v)

    for obj in list(pdf.objects):
        if isinstance(obj, (pikepdf.Dictionary, pikepdf.Array, pikepdf.Stream)):
            fix(obj)
    fix(pdf.trailer)


def _placements(pdf: pikepdf.Pdf) -> dict[tuple, tuple[float, float]]:
    """Largest on-page width and height (points) of every image, over all its uses."""
    out: dict[tuple, tuple[float, float]] = {}
    for i in range(len(pdf.pages)):
        try:
            model = PageModel(pdf, i)
        except Exception:
            continue
        for im in model.images:
            xo = im["xobj"]
            if not xo.is_indirect:
                continue
            c = im["ctm"]
            w_pt, h_pt = math.hypot(c[0], c[1]), math.hypot(c[2], c[3])
            pw, ph = out.get(xo.objgen, (0.0, 0.0))
            out[xo.objgen] = (max(pw, w_pt), max(ph, h_pt))
    return out


def _recompress_images(pdf: pikepdf.Pdf, max_dpi: int, quality: int) -> int:
    placed = _placements(pdf)
    done = 0
    for obj in pdf.objects:
        if not isinstance(obj, pikepdf.Stream) or obj.get("/Subtype") != "/Image" or obj.objgen not in placed:
            continue
        try:
            if _recompress_one(obj, placed[obj.objgen], max_dpi, quality):
                done += 1
        except Exception:
            continue  # anything we cannot decode stays exactly as it was
    return done


def _recompress_one(xo: pikepdf.Stream, placed_pt: tuple[float, float], max_dpi: int, quality: int) -> bool:
    if xo.get("/ImageMask", False) or "/Decode" in xo or "/PMPatch" in xo:
        return False  # stencil masks, inverted decodes and scan-edit patches stay pixel-exact
    if int(xo.get("/BitsPerComponent", 8)) != 8:
        return False  # bilevel scans compress better as they are (CCITT / JBIG2 / 1-bit Flate)
    filters = xo.get("/Filter")
    names = [str(f) for f in (filters if isinstance(filters, pikepdf.Array) else [filters] if filters is not None else [])]
    if any(f in ("/JBIG2Decode", "/CCITTFaxDecode", "/JPXDecode") for f in names):
        return False
    cs = xo.get("/ColorSpace")
    comps = _components(cs)
    if comps not in (1, 3):
        return False  # CMYK, indexed, separation: re-encoding risks colour shifts
    w, h = int(xo.Width), int(xo.Height)
    w_pt, h_pt = placed_pt
    dpi = min(w / max(w_pt / 72, 1e-6), h / max(h_pt / 72, 1e-6))
    scale = min(1.0, max_dpi / dpi) if dpi > 0 else 1.0
    if w * h < 64 * 64 and scale >= 1.0:
        return False  # tiny icons: nothing to gain
    img = pikepdf.PdfImage(xo).as_pil_image()
    img = img.convert("L" if comps == 1 else "RGB")
    if scale < 0.95:
        img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    was_jpeg = "/DCTDecode" in names
    photo = was_jpeg or _is_photo(img)
    if photo:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=quality, optimize=True, progressive=False)
        new, new_filter = buf.getvalue(), pikepdf.Name.DCTDecode
    else:
        if scale >= 0.95:
            return False  # line art / screenshots already lossless: keep them exact
        new, new_filter = zlib.compress(img.tobytes(), 9), pikepdf.Name.FlateDecode
    if len(new) >= len(xo.read_raw_bytes()) * 0.9:
        return False  # not worth the quality change
    xo.write(new, filter=new_filter)
    xo.Width, xo.Height = img.width, img.height
    xo.BitsPerComponent = 8
    if "/DecodeParms" in xo:
        del xo["/DecodeParms"]
    if not isinstance(cs, pikepdf.Array):  # keep ICC profiles; plain spaces match the new pixels
        xo.ColorSpace = pikepdf.Name.DeviceGray if comps == 1 else pikepdf.Name.DeviceRGB
    return True


def _components(cs) -> int:
    if cs is None:
        return 0
    if isinstance(cs, pikepdf.Name):
        return {"/DeviceGray": 1, "/CalGray": 1, "/DeviceRGB": 3, "/CalRGB": 3, "/DeviceCMYK": 4}.get(str(cs), 0)
    if isinstance(cs, pikepdf.Array) and len(cs) >= 2 and cs[0] == "/ICCBased":
        try:
            return int(cs[1].get("/N", 0))
        except Exception:
            return 0
    return 0


def _is_photo(img: Image.Image) -> bool:
    """Photos have many colours; screenshots, charts and logos have few (JPEG would blur them)."""
    thumb = img.copy()
    thumb.thumbnail((128, 128))
    colours = thumb.getcolors(maxcolors=4096)
    return colours is None or len(colours) > 512
