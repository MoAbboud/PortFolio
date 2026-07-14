"""Validated data structures for a fallacy flag.

A ``Flag`` is the final, validated unit the tool emits. Raw model output is
turned into a ``Flag`` by ``build_flag`` / ``validate_and_build``, which is the
single place span/type/confidence validation happens. Malformed input raises
``ValueError`` so callers can retry-once-then-skip rather than crash.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Any, Optional

from .config import FALLACY_TYPES, bucket_warning


@dataclass(frozen=True)
class Flag:
    """One flagged, verified possible fallacy.

    Fields mirror the spec:
      fallacy_type    one label from the fixed taxonomy
      span            exact quoted text from the original input
      confidence      how sure we are this is a fallacy AT ALL, 0.0-1.0
      warning_level   low/medium/high, bucketed from confidence
      explanation     one-line reason
      charitable_read one-line steel-man (optional)
      type_confidence how sure we are of the *label* specifically (optional)

    ``confidence`` and ``type_confidence`` answer two different questions, and
    conflating them is what made the tool drop real findings: the detector can be
    certain a sentence is fallacious while the typer is unsure which of 13 types to
    call it. A low ``type_confidence`` means "we stand by the flag, not the name".
    """

    fallacy_type: str
    span: str
    confidence: float
    warning_level: str
    explanation: str
    charitable_read: Optional[str] = None
    type_confidence: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class AnalysisResult:
    """The full result of analyzing one piece of text."""

    text: str
    flags: list[Flag]

    def to_dict(self) -> dict[str, Any]:
        return {"text": self.text, "flags": [f.to_dict() for f in self.flags]}


# --------------------------------------------------------------------------- #
# Validation helpers
# --------------------------------------------------------------------------- #
_WS = re.compile(r"\s+")


def _normalize(s: str) -> str:
    """Collapse runs of whitespace so verbatim-quote checks tolerate reflow."""
    return _WS.sub(" ", s).strip()


def normalize_fallacy_type(raw: str) -> str:
    """Return the canonical taxonomy label, or raise ValueError if unknown."""
    if not isinstance(raw, str):
        raise ValueError(f"fallacy_type must be a string, got {type(raw).__name__}")
    candidate = raw.strip().lower()
    if candidate not in FALLACY_TYPES:
        raise ValueError(f"unknown fallacy_type: {raw!r}")
    return candidate


def span_in_text(span: str, text: str) -> bool:
    """True if ``span`` appears in ``text`` (whitespace- and case-insensitive)."""
    if not isinstance(span, str) or not span.strip():
        return False
    return _normalize(span).lower() in _normalize(text).lower()


def _coerce_confidence(raw: Any) -> float:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise ValueError(f"confidence must be a number, got {raw!r}")
    # Clamp into range rather than reject — the model is close enough.
    return max(0.0, min(1.0, value))


def build_flag(
    *,
    fallacy_type: str,
    span: str,
    confidence: Any,
    explanation: str,
    charitable_read: Optional[str] = None,
    text: str,
) -> Flag:
    """Validate raw fields against ``text`` and construct a ``Flag``.

    Raises ``ValueError`` if the fallacy type is off-taxonomy, the span is not a
    verbatim quote from ``text``, or the confidence is not numeric.
    """
    canonical_type = normalize_fallacy_type(fallacy_type)

    if not span_in_text(span, text):
        raise ValueError(f"span not found verbatim in text: {span!r}")

    conf = _coerce_confidence(confidence)

    expl = (explanation or "").strip() or "(no explanation provided)"

    charitable: Optional[str]
    if charitable_read is None or (isinstance(charitable_read, str) and not charitable_read.strip()):
        charitable = None
    else:
        charitable = str(charitable_read).strip()

    return Flag(
        fallacy_type=canonical_type,
        span=span.strip(),
        confidence=conf,
        warning_level=bucket_warning(conf),
        explanation=expl,
        charitable_read=charitable,
    )
