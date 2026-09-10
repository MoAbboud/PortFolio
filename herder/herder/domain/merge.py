"""Deciding what to do with a candidate entry. Pure.

The merge step is what stops the memory growing linearly with the conversation, so this is
where the compaction claim is either true or false.

## Why NLI rather than a generative adjudicator

The four verdicts are almost exactly the three NLI labels, run in both directions between
the candidate (A) and an existing entry (B):

    A entails B  and  B entails A     ->  DUPLICATE   the same claim, said again
    A entails B  and  B does not      ->  UPDATE      A is more specific; it adds detail
    B entails A  and  A does not      ->  DUPLICATE   A is less specific; it adds nothing
    BOTH directions contradict        ->  SUPERSEDE   the claim has changed
    anything else                     ->  DISTINCT    a different claim

That asymmetry is the whole reason to run NLI twice. "We use Postgres" and "We use Postgres
16.2 in production" entail each other in one direction only, and which direction decides
whether the memory gains detail or silently discards it.

## Why supersede needs contradiction in BOTH directions

An earlier version of this module superseded on a contradiction in either direction. Measured
against `cross-encoder/nli-deberta-v3-base` on 2026-09-10, that was wrong:

    genuine reversal     "We no longer use Postgres" / "We use Postgres"
                         contradiction 1.00  <->  contradiction 1.00
    value changed        "budget is 5000 tokens" / "budget is 3000 tokens"
                         contradiction 1.00  <->  contradiction 1.00
    UNRELATED            "Amounts are always Decimal" / "The parser lives in transcript.py"
                         neutral 0.99        <->  contradiction 1.00

**Genuine contradictions come back symmetric; spurious ones are one-sided.** NLI models
invent confident contradictions between unrelated sentences, and the one-directional rule
would have retired a perfectly good entry on the strength of it - superseding on noise, with
no error anywhere to show it had happened. Requiring both directions separates the two cleanly
on every pair tested.

The similarity threshold makes this rare in practice, because two unrelated entries never
reach adjudication. "Rare" is not the same as "safe", and this is a silent failure.

A generative model asked to pick one of four words would also work, but it would be picking
a label and a confidence that nothing calibrates. Entailment is a measurement.

## The hard rule

**A candidate matching a removed entry is dropped.** Not merged, not re-created. Derivation
runs repeatedly over material that repeats itself, so without this the user deletes an entry,
the next derive re-creates it, and they delete it again forever. This single rule is what
makes the adjuster trustworthy, and it is tested end to end.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum

ENTAILMENT = "entailment"
CONTRADICTION = "contradiction"
NEUTRAL = "neutral"


class Verdict(StrEnum):
    CREATE = "create"
    DUPLICATE = "duplicate"
    UPDATE = "update"
    SUPERSEDE = "supersede"
    DISTINCT = "distinct"
    DROP = "drop"


@dataclass(frozen=True)
class Match:
    """An existing entry a candidate might belong to."""

    entry_id: uuid.UUID
    status: str
    title: str
    text: str
    similarity: float


@dataclass(frozen=True)
class Label:
    """One NLI result: the winning label and how confident it was."""

    label: str
    score: float


@dataclass(frozen=True)
class Decision:
    verdict: Verdict
    match: Match | None = None
    reason: str = ""
    # True when no label cleared the confidence floor, so the verdict was defaulted rather
    # than measured. Counted, so a run can report how often it was guessing.
    below_floor: bool = False


def choose_match(matches: list[Match], threshold: float, limit: int = 3) -> list[Match]:
    """The matches worth adjudicating: above the similarity threshold, most similar first.

    Adjudication is the expensive half and similarity is the cheap half, so the cheap filter
    runs first and only its survivors are adjudicated. Adjudicating every candidate against
    every entry is the obvious implementation and it makes the cost of a derive quadratic in
    the size of the memory.
    """
    above = [m for m in matches if m.similarity >= threshold]
    return sorted(above, key=lambda m: -m.similarity)[:limit]


def decide_against(match: Match, forward: Label, backward: Label, floor: float) -> Decision:
    """Turn two NLI results into a verdict for one match.

    `forward` is candidate-entails-existing; `backward` is existing-entails-candidate.
    """
    if match.status == "removed":
        # The hard rule, checked before anything else so no amount of model output can
        # route around it.
        return Decision(Verdict.DROP, match, "matches an entry the user removed")

    # Contradiction in BOTH directions, or it is not a contradiction. A one-sided reading is
    # what NLI produces for unrelated text, and acting on it retires a good entry on noise.
    contradicts = (
        forward.label == CONTRADICTION
        and backward.label == CONTRADICTION
        and min(forward.score, backward.score) >= floor
    )
    if contradicts:
        return Decision(Verdict.SUPERSEDE, match, "each contradicts the other: the claim has changed")

    forward_entails = forward.label == ENTAILMENT and forward.score >= floor
    backward_entails = backward.label == ENTAILMENT and backward.score >= floor

    if forward_entails and backward_entails:
        return Decision(Verdict.DUPLICATE, match, "each entails the other: the same claim")
    if forward_entails:
        # The candidate is the more specific of the two, so the memory gains detail.
        return Decision(Verdict.UPDATE, match, "the candidate is more specific than the stored entry")
    if backward_entails:
        # The stored entry already covers it. Bump last_seen and extend lineage, nothing more.
        return Decision(Verdict.DUPLICATE, match, "the stored entry already covers the candidate")

    if max(forward.score, backward.score) < floor:
        # Nothing was measured with enough confidence to act on. Fall back to `distinct` and
        # say so: the cost is a near-duplicate the user can see and remove, where the other
        # default - `duplicate` - would silently discard new information.
        return Decision(
            Verdict.DISTINCT, match, "no label cleared the confidence floor", below_floor=True
        )

    return Decision(Verdict.DISTINCT, match, "neither entails the other")


def merged_text(existing: str, candidate: str) -> str:
    """Text for an `update` revision.

    The more specific claim wins and the other is kept behind it, because an update that
    threw away the earlier wording would lose the phrasing a probe may already be graded
    against. Deliberately mechanical: this is not the place to ask a model to write prose.
    """
    existing, candidate = existing.strip(), candidate.strip()
    if not existing or existing == candidate:
        return candidate
    if existing in candidate:
        return candidate
    if candidate in existing:
        return existing
    return f"{candidate}\n\nPreviously: {existing}"
