"""The pluggable scorer interface.

Phase 1 defines the contract only. Phase 2 adds concrete scorers (valid-JSON,
field-by-field match, and an LLM judge) as subclasses — without touching the
runner, the loader, or the storage layer. That separation is the whole point:
you can grow the scoring logic independently of everything else.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .models import Case, ModelResponse, ScoreResult


class Scorer(ABC):
    """Base class for all scorers.

    A scorer looks at one case and the model's response to that case and
    produces a ScoreResult. Scorers must be pure and deterministic where
    possible (an LLM-judge scorer is the exception, and should record the
    judge's reasoning in ScoreResult.detail).
    """

    #: Human-readable name, stored per row so runs can be compared per scorer.
    name: str = "base"

    @abstractmethod
    def score(self, case: Case, response: ModelResponse) -> ScoreResult:
        """Return a ScoreResult for this (case, response) pair."""
        raise NotImplementedError

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<Scorer {self.name!r}>"
