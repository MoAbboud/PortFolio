"""fallacy_warn — a logical-fallacy *warning* tool.

This package flags *possible* logical fallacies in a wall of text as WARNINGS
with confidence scores. It is deliberately NOT a judge: it never declares who is
right, only that a passage *might* lean on a fallacy and how confident the
second pass is about that.

Public surface (Phase 1 skeleton):

    from fallacy_warn import analyze, Flag, AnalysisResult

    result = analyze("... a wall of argumentative text ...")
    for flag in result.flags:
        print(flag.warning_level, flag.fallacy_type, flag.span)
"""

from .config import FALLACY_TYPES
from .models import AnalysisResult, Flag
from .pipeline import analyze

__all__ = ["analyze", "Flag", "AnalysisResult", "FALLACY_TYPES"]
