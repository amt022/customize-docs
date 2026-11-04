"""Export options: AES-256 password protection and permissions."""
from __future__ import annotations

import io
from dataclasses import dataclass

import pikepdf


@dataclass
class Protection:
    user_password: str = ""  # needed to open; empty = opens without a password
    owner_password: str = ""  # needed to change permissions
    allow_print: bool = True
    allow_copy: bool = True
    allow_modify: bool = True
    allow_annotate: bool = True


def protect(data: bytes, p: Protection) -> bytes:
    if not p.user_password and not p.owner_password:
        return data
    owner = p.owner_password or p.user_password
    perms = pikepdf.Permissions(
        print_lowres=p.allow_print, print_highres=p.allow_print,
        extract=p.allow_copy, accessibility=True,
        modify_other=p.allow_modify, modify_assembly=p.allow_modify, modify_form=p.allow_modify or p.allow_annotate,
        modify_annotation=p.allow_annotate,
    )
    with pikepdf.open(io.BytesIO(data)) as pdf:
        buf = io.BytesIO()
        pdf.save(buf, encryption=pikepdf.Encryption(user=p.user_password, owner=owner, R=6, allow=perms))
        return buf.getvalue()
