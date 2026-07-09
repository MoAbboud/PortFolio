"""Thin Anthropic client wrapper + JSON parsing helpers.

Single provider to start. The API key comes from an env var; the SDK handles
exponential-backoff retries on 429 / 5xx / connection errors (configured via
``max_retries``). Everything provider-specific is contained here so swapping
providers later touches only this module.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

import anthropic

from .config import API_KEY_ENV_VAR, API_MAX_RETRIES


class LLMError(RuntimeError):
    """Raised when the LLM call cannot be made or returns no usable text."""


def build_client() -> anthropic.Anthropic:
    """Construct an Anthropic client, reading the key from the env var.

    ``max_retries`` gives us exponential backoff on rate limits (429) and
    transient server errors (5xx) for free.
    """
    api_key = os.environ.get(API_KEY_ENV_VAR)
    if not api_key:
        raise LLMError(
            f"Missing API key: set the {API_KEY_ENV_VAR} environment variable."
        )
    return anthropic.Anthropic(api_key=api_key, max_retries=API_MAX_RETRIES)


def _first_text_block(response: anthropic.types.Message) -> str:
    """Return the first text block of a response (skips thinking blocks)."""
    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text
    raise LLMError("model response contained no text block")


def request_text(
    client: anthropic.Anthropic,
    *,
    model: str,
    system: str,
    user: str,
    max_tokens: int,
) -> str:
    """Make one non-streaming request and return the first text block.

    Adaptive thinking is on — this is reasoning-heavy work. SDK-level retries
    already cover rate limits and server errors; anything else is surfaced as an
    ``LLMError`` for the caller to handle.
    """
    try:
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            thinking={"type": "adaptive"},
            system=system,
            messages=[{"role": "user", "content": user}],
        )
    except anthropic.APIError as exc:  # pragma: no cover - passthrough wrapper
        raise LLMError(f"Anthropic API error: {exc}") from exc
    return _first_text_block(response)


# --------------------------------------------------------------------------- #
# Lenient JSON extraction
# --------------------------------------------------------------------------- #
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)


def parse_json(raw: str) -> Any:
    """Parse a JSON value out of a model response.

    Placeholder prompts may not always yield clean JSON, so we:
      1. strip a ``` fenced block if present,
      2. try a direct json.loads,
      3. fall back to the first {...} or [...] substring.

    Raises ``json.JSONDecodeError`` (or ``ValueError``) on failure so callers can
    retry-once-then-skip.
    """
    text = raw.strip()

    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Fall back: grab the first balanced-looking object/array substring.
    start = _first_json_start(text)
    if start is None:
        raise ValueError("no JSON object or array found in model response")
    return json.loads(text[start:_matching_end(text, start)])


def _first_json_start(text: str) -> int | None:
    for i, ch in enumerate(text):
        if ch in "{[":
            return i
    return None


def _matching_end(text: str, start: int) -> int:
    """Return the index just past the bracket that matches text[start]."""
    open_ch = text[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_str = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
    # Unbalanced — let json.loads raise a precise error on the whole tail.
    return len(text)
