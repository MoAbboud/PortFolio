"""Load labeled test cases from a JSONL file into typed Case objects.

JSONL (one JSON object per line) is the right format for a growing eval set:
you append a line to add a case, diffs are readable in code review, and you can
stream it without loading everything into memory.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

from .models import Case


class CaseLoadError(ValueError):
    """Raised when a line in the cases file is malformed or missing fields."""


def _parse_line(line_number: int, line: str) -> Case | None:
    """Parse a single JSONL line into a Case, or None for a blank line."""
    stripped = line.strip()
    if not stripped:
        return None
    try:
        obj = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise CaseLoadError(f"line {line_number}: invalid JSON — {exc}") from exc

    missing = {"id", "input_text", "expected_json"} - obj.keys()
    if missing:
        raise CaseLoadError(f"line {line_number}: missing field(s) {sorted(missing)}")
    if not isinstance(obj["expected_json"], dict):
        raise CaseLoadError(f"line {line_number}: expected_json must be an object")

    return Case(
        id=str(obj["id"]),
        input_text=str(obj["input_text"]),
        expected_json=obj["expected_json"],
    )


def iter_cases(path: str | Path) -> Iterator[Case]:
    """Yield Case objects from a JSONL file, skipping blank lines."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"cases file not found: {p}")
    with p.open(encoding="utf-8") as fh:
        for i, line in enumerate(fh, start=1):
            case = _parse_line(i, line)
            if case is not None:
                yield case


def load_cases(path: str | Path) -> list[Case]:
    """Read all cases into a list, raising on duplicate ids."""
    cases = list(iter_cases(path))
    seen: set[str] = set()
    for c in cases:
        if c.id in seen:
            raise CaseLoadError(f"duplicate case id: {c.id!r}")
        seen.add(c.id)
    return cases
