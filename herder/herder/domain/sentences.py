"""Splitting a message into sentences. Pure.

This lived in `extractors/heuristic.py` until 2026-09-17, where it was private. The residue
step (`domain/residue.py`) needs exactly the same split, because the question it asks is "which
sentences did extraction not cover" and two different splitters would make that comparison
meaningless - a sentence the extractor saw as one unit and the residue saw as two would be
reported as uncovered even though it was captured.

It moved down into the domain rather than being imported across, because `extractors` already
imports from `domain` (`CHANGE_CUE`) and the reverse would be a cycle. The splitter is also the
more domain-ish half: where a sentence ends is a property of English, not of any one extractor's
rules.

Deliberately crude, and unchanged in moving: terminal punctuation followed by space, or a line
break. A real sentence splitter is not the interesting part of this project, and swapping one in
would change every extraction result for reasons that have nothing to do with the thing being
measured.
"""

from __future__ import annotations

import re

# Fenced code is pulled out before sentence splitting - a code block is not prose and splitting
# it on full stops produces nonsense - but its presence is a signal in itself, so the caller is
# told rather than the information being thrown away here.
FENCE = re.compile(r"```.*?```", re.DOTALL)

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+|\n+")


def strip_fences(text: str) -> tuple[str, bool]:
    """The text with fenced code replaced by a space, and whether any was there."""
    without = FENCE.sub(" ", text)
    return without, without != text


def split_sentences(text: str) -> list[str]:
    """Sentences, stripped, with the empties dropped. No length filtering - that is a policy
    the caller owns, and the extractor's floor is not the residue's."""
    return [s.strip() for s in SENTENCE_SPLIT.split(text) if s.strip()]
