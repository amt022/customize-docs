"""PDF affine matrices: [a b c d e f], row-vector convention (p' = p x M)."""
from __future__ import annotations

import math
from typing import Sequence

Matrix = tuple[float, float, float, float, float, float]

IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def mat(values: Sequence) -> Matrix:
    a, b, c, d, e, f = (float(v) for v in values)
    return (a, b, c, d, e, f)


def mul(m1: Matrix, m2: Matrix) -> Matrix:
    """m1 x m2 (apply m1 first, then m2)."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2,
        a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2,
        c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2,
        e1 * b2 + f1 * d2 + f2,
    )


def translate(tx: float, ty: float) -> Matrix:
    return (1.0, 0.0, 0.0, 1.0, tx, ty)


def apply(m: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return (x * a + y * c + e, x * b + y * d + f)


def apply_vec(m: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, _, _ = m
    return (x * a + y * c, x * b + y * d)


def norm(v: tuple[float, float]) -> float:
    return math.hypot(v[0], v[1])
