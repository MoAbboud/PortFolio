"""Typed domain objects shared across the harness.

Keeping these dataclasses in one module means the loader, runner, scorers, and
storage all speak the same vocabulary and never pass raw dicts around.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class Case:
    """One labeled test case read from the JSONL file.

    Attributes:
        id: Stable, unique identifier for the case (used as a DB key).
        input_text: The messy input handed to the model.
        expected_json: The hand-labeled correct extraction, as a dict.
    """

    id: str
    input_text: str
    expected_json: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ModelResponse:
    """The raw result of running one case through the model.

    We keep the *raw text* (not a parsed dict) on purpose: scorers need to see
    exactly what the model emitted, including prose around the JSON or invalid
    syntax. Parsing is a scorer's job, not the runner's.
    """

    case_id: str
    model: str
    raw_text: str
    # Free-form metadata the runner can attach (token usage, latency, retries).
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ScoreResult:
    """The output of a single scorer for a single (case, response) pair.

    Attributes:
        scorer_name: Which scorer produced this (e.g. "valid_json").
        score: A numeric score. Convention: 1.0 = pass, 0.0 = fail, or a
            fraction for partial-credit scorers. Kept as a float so both
            boolean and graded scorers fit the same schema.
        detail: A dict explaining *why* — field-level diffs, parse errors, the
            judge's reasoning. Stored as JSON in the DB for later inspection.
    """

    scorer_name: str
    score: float
    detail: dict[str, Any] = field(default_factory=dict)
