"""Verification: choosing probes, grading answers, and the integrity score. Pure.

This is the third of the three parts of the design that have to be the author's own (the
render ordering and the merge verdicts are the other two). Everything here is a judgement
about what it costs to be wrong in each direction, so each rule carries its reason.

## The three categories, and why they are weighted differently

    included   3 probes  weight 1.0  did the context transmit
    excluded   2 probes  weight 0.5  what did compression cost
    uncovered  1 probe   weight 0.5  what did extraction miss

An included entry the model could not recall is a failure of the system as built. An excluded
one is a budget decision working as intended - it should pull the score down, but not dominate
it. And a system that only probed what it included would report a high score for a brief that
had dropped almost everything, which is the reason the other two categories exist at all.

## Grading

NLI, not a generative judge, run on (premise, hypothesis) pairs:

    forward   premise = question + answer   hypothesis = expected answer
    backward  premise = expected answer     hypothesis = answer

    forward entails                          ->  1    the answer carries the expected fact
    forward contradicts                      ->  0    the answer says something else
    forward neutral, backward entails        ->  0.5  what it said is true, but not all of it
                                                      (the author's call, 2026-09-13)
    forward neutral, backward does not       ->  0    the answer does not carry the fact
    forward below the confidence floor       ->  inconclusive: excluded and flagged

The question goes into the forward premise because a short answer is not a sentence on its
own: "Decimal." entails nothing, while "What type holds money values? Decimal." entails
"Money values are stored as Decimal."

**Inconclusive is never defaulted to 0 or to 1.** Both defaults are lies, in opposite
directions, and a score built on guesses cannot be told apart from one built on measurements.
"""

from __future__ import annotations

import random
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field

from herder.domain.merge import CONTRADICTION, ENTAILMENT, Label

INCLUDED = "included"
EXCLUDED = "excluded"
UNCOVERED = "uncovered"
CATEGORIES = (INCLUDED, EXCLUDED, UNCOVERED)

WEIGHTS = {INCLUDED: 1.0, EXCLUDED: 0.5, UNCOVERED: 0.5}
DEFAULT_COUNTS = {INCLUDED: 3, EXCLUDED: 2, UNCOVERED: 1}

# A probe whose question gives away its answer is testing reading comprehension of the
# question, not memory. For an excluded entry that is worse than useless: the model answers
# correctly from the question alone and the score says compression cost nothing.
_WORD = re.compile(r"[a-z0-9][a-z0-9.\-]*[a-z0-9]|[a-z0-9]")
_STOPWORDS = frozenset(
    """
    a an and are as at be been but by do does for from has have in into is it its of on or
    that the their them there these they this to was we were what when where which who why
    will with would you your our us i my me not no yes so than then also just only all any
    """.split()
)


# ------------------------------------------------------------------------ grading


@dataclass(frozen=True)
class Grade:
    score: float | None  # 0, 0.5, 1, or None when inconclusive
    reason: str

    @property
    def inconclusive(self) -> bool:
        return self.score is None


def grade(forward: Label, backward: Label, floor: float) -> Grade:
    """Turn the two NLI readings into 1, 0.5, 0 or inconclusive, with the reason kept."""
    detail = f"forward {forward.label} {forward.score:.2f}, backward {backward.label} {backward.score:.2f}"

    if forward.score < floor:
        return Grade(None, f"inconclusive: no label cleared the floor of {floor} ({detail})")
    if forward.label == ENTAILMENT:
        return Grade(1.0, f"the answer entails the expected answer ({detail})")
    if forward.label == CONTRADICTION:
        return Grade(0.0, f"the answer contradicts the expected answer ({detail})")
    if backward.label == ENTAILMENT and backward.score >= floor:
        return Grade(0.5, f"the answer is true but carries only part of the expected answer ({detail})")
    return Grade(0.0, f"the answer does not carry the expected answer ({detail})")


# ------------------------------------------------------------------------ probes


def content_words(text: str) -> set[str]:
    return {w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS}


_YES_NO = re.compile(r"^\s*(is|are|was|were|does|do|did|can|could|should|will|would|has|have|had)\b", re.IGNORECASE)


def leaks_answer(question: str, expected_answer: str) -> bool:
    """True when the question already gives away its answer.

    Two shapes, and neither is "the question shares a lot of words with the answer":

    - **A yes/no question.** "Are money values stored as Decimal?" states the claim and asks
      for agreement; "yes" scores without knowing anything.
    - **An answer that adds nothing to the question.** Every content word of the expected
      answer is already in the question.

    *Was:* 60% of the answer's content words appearing in the question. The first real run
    discarded "What version of Postgres is specifically used?" against "The version of
    Postgres specifically used is 16.2" - 4 of 5 words shared, and the one that was not shared
    is the entire answer. Topic words are always shared; what matters is whether anything is
    left once they are taken away.
    """
    answer = content_words(expected_answer)
    if not answer:
        return False
    return bool(_YES_NO.match(question)) or not (answer - content_words(question))


@dataclass(frozen=True)
class ProbeTarget:
    """Something a probe can be written about: an entry, or a raw message nothing claims."""

    category: str
    entry_id: uuid.UUID | None = None
    message_id: uuid.UUID | None = None
    pinned: bool = False


@dataclass
class Selection:
    targets: list[ProbeTarget] = field(default_factory=list)
    # How many each category asked for and how many existed to choose from. Reported, so a
    # checkpoint with fewer probes says why instead of looking like a full one.
    requested: dict[str, int] = field(default_factory=dict)
    available: dict[str, int] = field(default_factory=dict)


def select_probes(
    included: Sequence[ProbeTarget],
    excluded: Sequence[ProbeTarget],
    uncovered: Sequence[ProbeTarget],
    seed: str,
    counts: dict[str, int] | None = None,
) -> Selection:
    """Choose which targets get probed.

    **Seeded, not random and not fixed.** Always taking the first entries in render order
    would probe the constraints every time and never the facts; unseeded randomness would make
    a checkpoint impossible to reproduce. Seeding on the injection id gives the same probes
    for the same serve and different ones across serves.

    **Pins go first among included**, because a user who pinned something asked for it to be
    carried, and "was it carried" is exactly what an included probe measures.

    **No substitution.** When a category has fewer targets than it asks for, it gets fewer
    probes and the shortfall is reported. Topping it up from another category would change
    what the score means without changing its label.
    """
    counts = counts or DEFAULT_COUNTS
    rng = random.Random(seed)
    selection = Selection()

    for category, pool in ((INCLUDED, included), (EXCLUDED, excluded), (UNCOVERED, uncovered)):
        wanted = counts.get(category, 0)
        selection.requested[category] = wanted
        selection.available[category] = len(pool)

        pins = [t for t in pool if t.pinned]
        rest = sorted((t for t in pool if not t.pinned), key=lambda t: str(t.entry_id or t.message_id))
        chosen = pins[:wanted]
        if len(chosen) < wanted:
            chosen += rng.sample(rest, min(wanted - len(chosen), len(rest)))
        selection.targets.extend(chosen)

    return selection


# ------------------------------------------------------------------------ the score


@dataclass(frozen=True)
class GradedProbe:
    category: str
    score: float | None


@dataclass
class Integrity:
    integrity: float | None
    graded: int
    inconclusive: int
    # category -> (mean score, number graded). Reported beside the headline because the
    # headline alone cannot say whether transmission or compression is what pulled it down.
    by_category: dict[str, tuple[float | None, int]] = field(default_factory=dict)


def score(results: Sequence[GradedProbe]) -> Integrity:
    """The weighted mean over graded probes. None when nothing could be graded."""
    graded = [r for r in results if r.score is not None]
    by_category: dict[str, tuple[float | None, int]] = {}
    for category in CATEGORIES:
        scores = [r.score for r in graded if r.category == category]
        by_category[category] = (sum(scores) / len(scores) if scores else None, len(scores))

    weight = sum(WEIGHTS[r.category] for r in graded)
    value = sum(WEIGHTS[r.category] * r.score for r in graded) / weight if weight else None

    return Integrity(
        integrity=value,
        graded=len(graded),
        inconclusive=len(results) - len(graded),
        by_category=by_category,
    )
