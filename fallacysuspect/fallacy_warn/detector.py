"""Pass 1 — the detector.

Send the whole input to the LLM once and get candidate fallacies back
generously (favor recall). Returns lightweight candidate dicts; validation and
skepticism happen in pass 2.
"""

from __future__ import annotations

import json
from typing import Any, TypedDict

import anthropic

from . import prompts
from .config import DEFAULT_MODEL, FALLACY_TYPES, JSON_RETRIES, MAX_TOKENS_DETECTOR
from .llm import parse_json, request_text


class Candidate(TypedDict):
    fallacy_type: str
    span: str
    reasoning: str


def _coerce_candidates(data: Any) -> list[Candidate]:
    """Pull a list of candidate dicts out of parsed JSON, tolerantly.

    Accepts either {"candidates": [...]} or a bare list. Raises ValueError if the
    shape is unusable so the caller can retry.
    """
    if isinstance(data, dict):
        items = data.get("candidates", [])
    elif isinstance(data, list):
        items = data
    else:
        raise ValueError("detector JSON is neither an object nor a list")

    if not isinstance(items, list):
        raise ValueError("'candidates' is not a list")

    candidates: list[Candidate] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        span = item.get("span")
        ftype = item.get("fallacy_type")
        if not isinstance(span, str) or not span.strip():
            continue
        if not isinstance(ftype, str) or not ftype.strip():
            continue
        candidates.append(
            Candidate(
                fallacy_type=ftype.strip(),
                span=span.strip(),
                reasoning=str(item.get("reasoning", "")).strip(),
            )
        )
    return candidates


def detect(
    client: anthropic.Anthropic,
    text: str,
    *,
    model: str = DEFAULT_MODEL,
) -> list[Candidate]:
    """Return candidate fallacies for ``text``.

    On malformed JSON, retry once (``JSON_RETRIES``) then give up gracefully with
    an empty list rather than crashing.
    """
    taxonomy = "\n".join(f"- {name}" for name in FALLACY_TYPES)
    system = prompts.DETECTOR_SYSTEM.format(taxonomy=taxonomy)
    user = prompts.DETECTOR_USER.format(text=text)

    for _attempt in range(JSON_RETRIES + 1):
        raw = request_text(
            client,
            model=model,
            system=system,
            user=user,
            max_tokens=MAX_TOKENS_DETECTOR,
        )
        try:
            data = parse_json(raw)
            return _coerce_candidates(data)
        except (json.JSONDecodeError, ValueError):
            continue

    return []
