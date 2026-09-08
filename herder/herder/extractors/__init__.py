"""Selecting an extractor.

`HERDER_EXTRACTOR` chooses. An unknown value is an error and never a silent default: a typo
that quietly downgraded extraction would make every number measured afterwards a lie, and it
would look exactly like a working system.
"""

from __future__ import annotations

from herder.core.config import get_settings
from herder.extractors.base import Extractor, ExtractorUnavailable, validate_lineage
from herder.extractors.heuristic import HeuristicExtractor

KNOWN = ("heuristic", "local", "trained")


def get_extractor(name: str | None = None) -> Extractor:
    name = name or get_settings().extractor

    if name == "heuristic":
        return HeuristicExtractor()

    if name == "local":
        # Imported here rather than at module scope so that the heuristic path never pays
        # for, or fails on, anything the local model needs.
        from herder.extractors.local import LocalExtractor

        return LocalExtractor()

    if name == "trained":
        raise ExtractorUnavailable(
            "HERDER_EXTRACTOR=trained, but the trained extractor is stage 10. It arrives as "
            "a measured improvement over `heuristic` and `local`, not as a prerequisite - "
            "see requirements/00-plan.md."
        )

    raise ValueError(f"unknown extractor {name!r}; expected one of {', '.join(KNOWN)}")


__all__ = ["Extractor", "ExtractorUnavailable", "get_extractor", "validate_lineage", "KNOWN"]
