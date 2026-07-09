"""Pass 2 — the verifier.

For EACH candidate, make a separate LLM call that skeptically checks whether it
is really a fallacy or just a forceful-but-valid argument, returning a
confidence 0-1. A candidate the verifier vetoes (``is_fallacy`` false) or that
fails validation is dropped rather than crashing the run.
"""

from __future__ import annotations

import json
from typing import Optional

import anthropic

from . import prompts
from .config import DEFAULT_MODEL, JSON_RETRIES, MAX_TOKENS_VERIFIER
from .detector import Candidate
from .llm import parse_json, request_text
from .models import Flag, build_flag


def verify(
    client: anthropic.Anthropic,
    text: str,
    candidate: Candidate,
    *,
    model: str = DEFAULT_MODEL,
) -> Optional[Flag]:
    """Verify one candidate. Returns a validated ``Flag`` or ``None``.

    ``None`` means: the verifier rejected it, its output stayed malformed after a
    retry, or validation (taxonomy / verbatim span) failed. Any of those is a
    skip, never a crash.
    """
    system = prompts.VERIFIER_SYSTEM
    user = prompts.VERIFIER_USER.format(
        text=text,
        fallacy_type=candidate["fallacy_type"],
        span=candidate["span"],
        reasoning=candidate.get("reasoning", ""),
    )

    for _attempt in range(JSON_RETRIES + 1):
        raw = request_text(
            client,
            model=model,
            system=system,
            user=user,
            max_tokens=MAX_TOKENS_VERIFIER,
        )
        try:
            verdict = parse_json(raw)
        except (json.JSONDecodeError, ValueError):
            continue  # malformed — retry once, then skip

        if not isinstance(verdict, dict):
            continue

        # Skeptical veto: the verifier decided it is not really a fallacy.
        if verdict.get("is_fallacy") is False:
            return None

        try:
            return build_flag(
                fallacy_type=candidate["fallacy_type"],
                span=candidate["span"],
                confidence=verdict.get("confidence"),
                explanation=verdict.get("explanation", ""),
                charitable_read=verdict.get("charitable_read"),
                text=text,
            )
        except ValueError:
            # Off-taxonomy label or span that isn't a verbatim quote: skip.
            return None

    return None
