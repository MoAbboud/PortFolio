"""Orchestration — wire the two passes together.

    detect (pass 1, one call)  ->  verify (pass 2, one call per candidate)

Kept deliberately thin: the two passes live in their own modules so each can be
reworked independently.
"""

from __future__ import annotations

from typing import Optional

import anthropic

from .config import DEFAULT_MODEL
from .detector import detect
from .llm import build_client
from .models import AnalysisResult, Flag
from .verifier import verify


def analyze(
    text: str,
    *,
    model: str = DEFAULT_MODEL,
    client: Optional[anthropic.Anthropic] = None,
) -> AnalysisResult:
    """Run the full two-pass analysis over ``text``.

    Pass a ``client`` to reuse a connection or inject a fake in tests; otherwise
    one is built from the environment.
    """
    if not text or not text.strip():
        return AnalysisResult(text=text, flags=[])

    client = client or build_client()

    candidates = detect(client, text, model=model)

    flags: list[Flag] = []
    for candidate in candidates:
        flag = verify(client, text, candidate, model=model)
        if flag is not None:
            flags.append(flag)

    return AnalysisResult(text=text, flags=flags)
