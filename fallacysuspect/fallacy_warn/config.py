"""Tunable configuration for fallacy_warn.

Everything a human is likely to edit while iterating on the tool lives here:
the fallacy taxonomy, the model, token budgets, and the confidence->warning
bucketing. Keep prompt *wording* in ``prompts.py``; keep prompt-independent
knobs here.
"""

from __future__ import annotations

import os

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
# Local-model decision thresholds
# --------------------------------------------------------------------------- #
# The detector was trained on a 50/50 balanced set, but in a real transcript only
# a small share of sentences are fallacious. Taking plain argmax therefore
# over-flags badly (it will call "Thank you both." a fallacy). These gates correct
# for that prior mismatch:
#
#   * DETECT_THRESHOLD — the detector must be this sure it's a fallacy at all.
#   * TYPE_THRESHOLD   — the typer must be this sure *which* fallacy it is. This is
#                        the strongest signal: real fallacies score high, noise low.
#   * MIN_WORDS        — skip short/procedural lines ("Thanks.", "That's my close.")
#                        that aren't arguments and were never in the training data.
#
# Raise for fewer, safer flags; lower for more recall. Override via env vars.
#
# The right detector threshold depends on the MODEL KIND, because the two produce
# very differently-shaped probabilities (measured on held-out real-world prose):
#   * DistilBERT softmax is peaky   -> P(fallacy) is usually 0.9+; 0.70 works.
#   * TF-IDF LogReg is flat         -> median P(fallacy) is 0.47, max 0.95. At 0.70
#     recall collapses to 0.34. Its measured best-F1 point is ~0.45.
# Using one number for both silently throws away most real fallacies on TF-IDF.
DETECT_THRESHOLD_BY_KIND: dict[str, float] = {"bert": 0.70, "tfidf": 0.45}

# Explicit override (applies to whichever kind is loaded); empty = use the table.
_DETECT_ENV = os.environ.get("FALLACY_DETECT_THRESHOLD", "").strip()
DETECT_THRESHOLD: float | None = float(_DETECT_ENV) if _DETECT_ENV else None

# How a flag is decided. Two modes:
#
#   "combined" (default) — flag when P(fallacy) x P(type) >= FLAG_THRESHOLD.
#   "gates"    (legacy)  — flag when P(fallacy) >= detect_threshold AND
#                          P(type) >= TYPE_THRESHOLD, as two independent vetoes.
#
# Measured on the held-out MAFALDA test documents with the v2_bert models:
#
#   strategy                     precision  recall  false alarms
#   two independent gates          1.00      0.31       0%
#   detector alone (no type gate)  0.63      0.67      20%
#   combined score >= 0.33         0.85      0.46       4%
#
# The detector CANNOT be trusted alone: on a real debate transcript it scores
# "A basic income is what lets her breathe." at 1.00. Letting it decide by itself
# flagged 25 of 59 sentences. But two independent vetoes are too strict the other
# way — they threw away correctly-detected fallacies whenever the typer, spreading
# its mass over 13 similar classes, couldn't clear 0.50 (an ad hominem it had
# labelled CORRECTLY was binned at 0.38).
#
# Multiplying the two signals uses both without letting either veto alone: it buys
# ~50% more recall than the gates for 4% false alarms. Precision still leads,
# because for a warning tool a false alarm costs more than a miss.
SCORE_MODE: str = os.environ.get("FALLACY_SCORE_MODE", "combined").strip().lower()

# Tuned on the held-out MAFALDA validation documents: the highest-recall point that
# still keeps precision >= 0.90. Raise for fewer, safer flags; lower for more recall.
FLAG_THRESHOLD: float = float(os.environ.get("FALLACY_FLAG_THRESHOLD", "0.33"))

# Only a veto in "gates" mode. In "combined" mode it just decides whether the type is
# presented as confident or as a best guess.
TYPE_THRESHOLD: float = float(os.environ.get("FALLACY_TYPE_THRESHOLD", "0.50"))

MIN_WORDS: int = int(os.environ.get("FALLACY_MIN_WORDS", "8"))


def detect_threshold(kind: str) -> float:
    """Detector confidence gate for the given model kind."""
    if DETECT_THRESHOLD is not None:
        return DETECT_THRESHOLD
    return DETECT_THRESHOLD_BY_KIND.get(kind, 0.70)

# --------------------------------------------------------------------------- #
# Database
# --------------------------------------------------------------------------- #
# Every evaluation stores the submitted text + its analysis result. SQLite by
# default (a single file, zero external service). Override the path with the
# FALLACY_WARN_DB env var; point it at a mounted volume to persist in Docker.
DB_PATH: str = os.environ.get("FALLACY_WARN_DB", "fallacy_warn.db")

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
