"""The residue: user sentences that no entry covers. Pure.

## Why this exists

Measured on 2026-09-17, against the eight benchmark conversations:

    brief at a 3,000-token budget      772 tokens used, 22-31% of the budget
    entries excluded for want of room  0, in every one of the eight
    user sentences over the length floor  869
    matched a rule, became candidates     238  (27%)
    matched NO rule, silently dropped     631  (73%), about 6,679 tokens

So at the budget the project actually ships with, **the render step was not dropping anything
and the brief was using a quarter of its room**, while three-quarters of what the user said was
discarded at extraction and never offered to it. Recall at 3,000 was 0.68 against 0.92 for a
control that simply pasted the user's turns - a control that fits, because the user side of these
conversations is only 13% of the transcript. herder was losing 53 recoverable facts while holding
2,228 spare tokens per brief.

That is not a compression trade-off. It is a system throwing away material it had room to keep,
and it is invisible in every number the harness reported, because `excluded` counts entries that
did not fit and these were never entries at all.

## What it does, and the one rule that matters

The residue is spent **only on what is left after every entry and the tail have been placed**. It
is not a reserve and it cannot displace anything: a sentence no rule claimed is the least
trustworthy material in the system, and the priority ordering that decides what a brief keeps is
the design. If the budget binds, the residue is empty and the brief is exactly what it was before.
At a 500-token budget that is precisely what happens, which is why this change is expected to move
the 3,000-token number and leave the 500-token one alone.

## Why "not covered by an entry" rather than "matched no rule"

The obvious definition is "sentences the heuristic's rules did not match". It is also the wrong
one, because it is a fact about one extractor: run the `local` extractor and the phrase means
nothing. Coverage is a property of the *result* - did anything in the memory end up carrying this
sentence - and it is the same question `integrity.py` already asks with its `uncovered` probe
category. Entries are verbatim user sentences 96% of the time, so substring matching after
normalisation answers it cheaply and without a model.

## What is deliberately excluded, and the risk that is not

A sentence is dropped from the residue when it is carried by an entry of ANY status, not merely an
active one:

- **superseded** - the claim was replaced. Re-admitting it as raw text would put a stale claim
  back in the brief by the back door, and undo the one thing herder does that nothing else in the
  comparison does.
- **removed** - the hard rule in `merge.py` says a claim the user removed never comes back. A
  residue that ignored it would resurrect deleted entries on the next render, which is the exact
  failure that rule exists to prevent and would make the adjuster untrustworthy.

**The risk this does not cover, stated before measuring:** a claim whose original sentence matched
no rule, and which was later reversed by a sentence that did. The original never became an entry,
so nothing supersedes it, and it will enter the residue while its reversal sits above it as a
`decision`. The brief would then carry both. Filtering that needs an entailment check between each
residue sentence and the active entries, and render runs inside HTTP requests where this system
does not load models - so it is not done here. The benchmark's 40 false facts are what will say
whether it matters; if wrong claims move off 0.00, this is the first place to look.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from herder.domain.hashing import normalise

# Shorter than the extractor's floor of 20. The extractor is deciding whether a sentence is worth
# making a durable, mergeable claim out of; this is deciding whether it is worth a few spare
# tokens. "No franchising." is fifteen characters. Below ten is acknowledgement noise.
MIN_RESIDUE_CHARS = 10

# A question states nothing, so it cannot be remembered. Found on the residue's first real output
# (2026-09-17, planning-coffee-roaster): of 21 sentences it offered, 11 were the user asking the
# assistant something - "What usually goes wrong with the lease?", "How would you approach the new
# manager?" - and they would have spent budget to tell a later model what its predecessor had been
# asked rather than what was decided. The `fact` rule in the heuristic extractor excludes questions
# for the same reason; the residue had inherited no such filter because it inherited no rules.
#
# The test is the question mark, which is general English, deliberately NOT the shapes the
# benchmark's conversation generator happens to use. `test_heuristic.py` bans keying on those and
# the same standard applies here, so a sentence is refused for how English marks a question and
# for nothing else.
_QUESTION = re.compile(r"\?\s*$")


@dataclass(frozen=True)
class ResidueSentence:
    """A user sentence and where it came from. Ordered by the caller, oldest first."""

    text: str
    message_id: object = None


def _key(text: str) -> str:
    return " ".join(normalise(text).lower().split())


def uncovered(
    sentences: Sequence[ResidueSentence],
    entry_texts: Iterable[str],
    *,
    min_chars: int = MIN_RESIDUE_CHARS,
) -> list[ResidueSentence]:
    """The sentences no entry carries, oldest first, de-duplicated.

    `entry_texts` is every entry's current text whatever its status - see the module docstring
    for why a superseded or removed entry still suppresses its sentence.
    """
    covered = [_key(t) for t in entry_texts if t and t.strip()]
    seen: set[str] = set()
    out: list[ResidueSentence] = []

    for sentence in sentences:
        key = _key(sentence.text)
        if len(key) < min_chars or key in seen:
            continue
        if _QUESTION.search(sentence.text.strip()):
            continue
        # Substring rather than equality: a merged entry keeps "... Previously: <the old text>"
        # in one field, so the sentence it absorbed is inside it rather than equal to it.
        if any(key in entry or entry in key for entry in covered):
            continue
        seen.add(key)
        out.append(sentence)

    return out
