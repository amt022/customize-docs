"""Minimal CMap parser for ToUnicode maps and embedded encoding CMaps.

Handles codespacerange, bfchar, bfrange (incrementing and array forms),
cidchar and cidrange, which covers what PDF producers emit in practice.
"""
from __future__ import annotations

import re

_TOKEN = re.compile(rb"<[0-9A-Fa-f\s]*>|\[|\]|/[^\s/<>\[\]()]+|\([^)]*\)|[^\s<>\[\]/()]+")


def _hex(tok: bytes) -> bytes:
    digits = re.sub(rb"\s", b"", tok[1:-1]).decode()
    if len(digits) % 2:  # PDF rule: a missing final digit is 0
        digits += "0"
    return bytes.fromhex(digits)


def _utf16(b: bytes) -> str:
    if len(b) % 2:
        b = b"\x00" + b
    try:
        return b.decode("utf-16-be")
    except UnicodeDecodeError:
        return "�"


class CMap:
    def __init__(self) -> None:
        # (nbytes, low bytes, high bytes)
        self.codespaces: list[tuple[int, bytes, bytes]] = []
        self.unicode: dict[bytes, str] = {}
        self.cids: dict[bytes, int] = {}

    # -- decoding -----------------------------------------------------------
    def split(self, data: bytes) -> list[bytes]:
        """Split a string operand into character codes using the codespace ranges."""
        if not self.codespaces:
            return [data[i:i + 2] for i in range(0, len(data), 2)]
        out, i = [], 0
        lengths = sorted({n for n, _, _ in self.codespaces})
        while i < len(data):
            for n in lengths:
                chunk = data[i:i + n]
                if len(chunk) == n and self._in_space(chunk):
                    out.append(chunk)
                    i += n
                    break
            else:
                n = lengths[0]
                out.append(data[i:i + n])
                i += n
        return out

    def _in_space(self, code: bytes) -> bool:
        for n, lo, hi in self.codespaces:
            if n == len(code) and all(lo[k] <= code[k] <= hi[k] for k in range(n)):
                return True
        return False


def parse_cmap(data: bytes) -> CMap:
    cm = CMap()
    toks = _TOKEN.findall(data)
    i = 0
    n = len(toks)
    while i < n:
        t = toks[i]
        if t == b"begincodespacerange":
            i += 1
            while i < n and toks[i] != b"endcodespacerange":
                lo, hi = _hex(toks[i]), _hex(toks[i + 1])
                cm.codespaces.append((len(lo), lo, hi))
                i += 2
        elif t == b"beginbfchar":
            i += 1
            while i < n and toks[i] != b"endbfchar":
                src, dst = toks[i], toks[i + 1]
                if src.startswith(b"<"):
                    cm.unicode[_hex(src)] = _utf16(_hex(dst)) if dst.startswith(b"<") else _glyphname(dst)
                i += 2
        elif t == b"beginbfrange":
            i += 1
            while i < n and toks[i] != b"endbfrange":
                lo, hi = _hex(toks[i]), _hex(toks[i + 1])
                i += 2
                width = len(lo)
                start, end = int.from_bytes(lo, "big"), int.from_bytes(hi, "big")
                if toks[i] == b"[":
                    i += 1
                    k = 0
                    while toks[i] != b"]":
                        code = (start + k).to_bytes(width, "big")
                        cm.unicode[code] = _utf16(_hex(toks[i]))
                        k += 1
                        i += 1
                    i += 1
                else:
                    dst = _hex(toks[i])
                    i += 1
                    if end - start > 65535:
                        continue
                    base = int.from_bytes(dst, "big") if dst else 0
                    dlen = max(len(dst), 2)
                    for k in range(end - start + 1):
                        code = (start + k).to_bytes(width, "big")
                        cm.unicode[code] = _utf16((base + k).to_bytes(dlen, "big"))
        elif t == b"begincidchar":
            i += 1
            while i < n and toks[i] != b"endcidchar":
                cm.cids[_hex(toks[i])] = int(toks[i + 1])
                i += 2
        elif t == b"begincidrange":
            i += 1
            while i < n and toks[i] != b"endcidrange":
                lo, hi, cid = _hex(toks[i]), _hex(toks[i + 1]), int(toks[i + 2])
                width = len(lo)
                start, end = int.from_bytes(lo, "big"), int.from_bytes(hi, "big")
                if end - start <= 65535:
                    for k in range(end - start + 1):
                        cm.cids[(start + k).to_bytes(width, "big")] = cid + k
                i += 3
        i += 1
    return cm


def _glyphname(tok: bytes) -> str:
    from fontTools.agl import toUnicode

    return toUnicode(tok.lstrip(b"/").decode("latin-1")) or "�"


def build_tounicode(mapping: dict[bytes, str], code_len: int) -> bytes:
    """Serialise a code -> unicode map as a ToUnicode CMap stream."""
    lo = "00" * code_len
    hi = "FF" * code_len
    lines = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin",
        "begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Adobe-Identity-UCS def",
        "/CMapType 2 def",
        "1 begincodespacerange",
        f"<{lo}> <{hi}>",
        "endcodespacerange",
    ]
    items = sorted((c, u) for c, u in mapping.items() if u and u != "�")
    for k in range(0, len(items), 100):
        chunk = items[k:k + 100]
        lines.append(f"{len(chunk)} beginbfchar")
        for code, uni in chunk:
            lines.append(f"<{code.hex().upper()}> <{uni.encode('utf-16-be').hex().upper()}>")
        lines.append("endbfchar")
    lines += ["endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end"]
    return "\n".join(lines).encode("ascii")
