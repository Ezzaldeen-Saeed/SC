"""مفسّر اللهجة المصرية (الخطوة 4) — إعادة تصدير الواجهة العامة."""
from __future__ import annotations

from .interpreter import (
    DialectHint,
    EgyptianDialectInterpreter,
    get_interpreter,
    hint_block,
    interpret,
)

__all__ = [
    "EgyptianDialectInterpreter",
    "DialectHint",
    "get_interpreter",
    "interpret",
    "hint_block",
]
