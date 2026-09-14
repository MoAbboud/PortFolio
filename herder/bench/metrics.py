"""Scoring a method against a fact list. Pure.

For every fact, the reader - the same local model for every method - is given the method's
context and asked whether the statement is true, false or not stated. From its verdicts:

    recall             true facts judged true / true facts
                       how much of what was established survived into the context
    hallucination      false facts judged true / false facts
                       how often a rejected or reversed claim was carried forward as settled
    contradiction      true facts judged false / true facts
                       the context actively said the opposite of what was agreed
    compression        conversation tokens / context tokens

**Every rate is reported with its count** ("21 of 30"), because eight conversations is a small
corpus and a movement of one or two facts is noise. A percentage alone would hide that.

A verdict the reader failed to give is `error`: excluded from every rate and counted, never
defaulted to any of the three answers.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

VERDICTS = ("true", "false", "not_stated")


@dataclass(frozen=True)
class Judged:
    conversation: str
    archetype: str
    method: str
    fact_id: str
    kind: str
    truth: str  # the ground truth: "true" or "false"
    verdict: str  # the reader's: "true", "false", "not_stated", or "error"
    # How much the fact matters: essential, useful, incidental - or unrated, which is what
    # every row of a run recorded before the tiers existed carries.
    importance: str = "unrated"


@dataclass(frozen=True)
class Rate:
    hits: int
    total: int

    @property
    def value(self) -> float | None:
        return self.hits / self.total if self.total else None

    def __str__(self) -> str:
        return f"{self.value:.2f} ({self.hits} of {self.total})" if self.total else "- (0 facts)"


@dataclass
class Scores:
    recall: Rate
    hallucination: Rate
    contradiction: Rate
    errors: int
    facts: int
    by_kind: dict[str, Rate] = field(default_factory=dict)


def score(judged: Iterable[Judged]) -> Scores:
    rows = list(judged)
    usable = [r for r in rows if r.verdict in VERDICTS]
    true_rows = [r for r in usable if r.truth == "true"]
    false_rows = [r for r in usable if r.truth == "false"]

    by_kind: dict[str, Rate] = {}
    for kind in sorted({r.kind for r in true_rows}):
        mine = [r for r in true_rows if r.kind == kind]
        by_kind[kind] = Rate(sum(r.verdict == "true" for r in mine), len(mine))

    return Scores(
        recall=Rate(sum(r.verdict == "true" for r in true_rows), len(true_rows)),
        hallucination=Rate(sum(r.verdict == "true" for r in false_rows), len(false_rows)),
        contradiction=Rate(sum(r.verdict == "false" for r in true_rows), len(true_rows)),
        errors=len(rows) - len(usable),
        facts=len(rows),
        by_kind=by_kind,
    )


def group(judged: Iterable[Judged], *keys: str) -> dict[tuple, list[Judged]]:
    out: dict[tuple, list[Judged]] = {}
    for row in judged:
        out.setdefault(tuple(getattr(row, k) for k in keys), []).append(row)
    return out
