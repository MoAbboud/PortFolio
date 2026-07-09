"""Tunable configuration for fallacy_warn.

Everything a human is likely to edit while iterating on the tool lives here:
the fallacy taxonomy, the model, token budgets, and the confidence->warning
bucketing. Keep prompt *wording* in ``prompts.py``; keep prompt-independent
knobs here.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# Fallacy taxonomy
# --------------------------------------------------------------------------- #
# Fixed, editable list. The detector is told to only ever use these labels, and
# the verifier / validator reject anything outside the list. Edit freely.
FALLACY_TYPES: list[str] = [
    "ad hominem",
    "strawman",
    "slippery slope",
    "false dilemma",
    "appeal to authority",
    "circular reasoning",
    "hasty generalization",
    "appeal to emotion",
    "whataboutism",
    "red herring",
]

# --------------------------------------------------------------------------- #
# LLM provider settings (single provider to start: Anthropic)
# --------------------------------------------------------------------------- #
API_KEY_ENV_VAR: str = "ANTHROPIC_API_KEY"
DEFAULT_MODEL: str = "claude-opus-4-8"

# The SDK retries 429 / 5xx / connection errors with exponential backoff.
# This is our "handle API retries / rate limits with exponential backoff".
API_MAX_RETRIES: int = 4

# Non-streaming token budgets (both comfortably under SDK HTTP timeouts).
MAX_TOKENS_DETECTOR: int = 4096
MAX_TOKENS_VERIFIER: int = 1024

# How many times to re-ask the model when its JSON is malformed before giving
# up. 1 means: try once, retry once, then skip. (Total attempts = value + 1.)
JSON_RETRIES: int = 1

# --------------------------------------------------------------------------- #
# Confidence -> warning-level bucketing
# --------------------------------------------------------------------------- #
# A flag's warning_level is derived from the verifier's 0-1 confidence.
#   confidence <  WARNING_MEDIUM_MIN            -> "low"
#   WARNING_MEDIUM_MIN <= c < WARNING_HIGH_MIN  -> "medium"
#   confidence >= WARNING_HIGH_MIN              -> "high"
WARNING_MEDIUM_MIN: float = 0.40
WARNING_HIGH_MIN: float = 0.70

WARNING_LEVELS: tuple[str, str, str] = ("low", "medium", "high")


def bucket_warning(confidence: float) -> str:
    """Map a 0-1 confidence onto a low/medium/high warning level."""
    if confidence < WARNING_MEDIUM_MIN:
        return "low"
    if confidence < WARNING_HIGH_MIN:
        return "medium"
    return "high"
