"""The extractor protocol, and the rules every implementation obeys.

Three implementations produce the same object, which is what makes comparing them possible.
Copied from `mailman`, where the same arrangement produced that project's most interesting
result: a trained model that lost to eleven lines of regular expressions, visible only
because both existed behind one protocol and a harness could put them side by side.
"""

from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

from herder.domain.chunking import Chunk
from herder.schemas.extraction import Candidate, ExtractionOutcome


class ExtractorUnavailable(RuntimeError):
    """The extractor cannot run. Raised at startup, never swallowed.

    There is no silent fallback to the heuristic when a model is missing. A system quietly
    producing worse briefs than the operator believes is worse than one that refuses to
    start, because the briefs still look fine.
    """


@runtime_checkable
class Extractor(Protocol):
    name: str
    model: str

    def check_ready(self) -> None:
        """Raise ExtractorUnavailable, with the fix in the message, or return."""

    def extract(self, chunk: Chunk, existing_titles: list[str]) -> ExtractionOutcome:
        """Turn one chunk into candidate entries. Never raises for a model-side failure -
        those come back on the outcome so they can be counted and logged."""


def validate_lineage(
    candidates: list[Candidate], chunk: Chunk
) -> tuple[list[Candidate], int, int]:
    """Drop candidates whose lineage is empty or invented. Returns (kept, invented, empty).

    This is the one failure that cannot be tolerated. A model citing a message id it was
    never shown is fabricating evidence, and the audit trail is the product - an entry that
    cannot say where it came from is an unsupported claim, not a low-confidence one.

    A grammar can force the shape of an id. It cannot force the id to be one that was in the
    chunk, so this is checked in code against the exact set that was sent.
    """
    allowed = {str(i) for i in chunk.message_ids}
    kept: list[Candidate] = []
    invented = empty = 0

    for candidate in candidates:
        # A whitespace-only string is not a citation. Without the strip it counts as a
        # fabrication, which is a much more serious accusation than an empty field.
        cited = [ref.strip() for ref in candidate.lineage if ref and ref.strip()]
        if not cited:
            empty += 1
            continue

        real = [ref for ref in cited if ref in allowed]
        if not real:
            invented += 1
            continue

        # Partial fabrication: keep the real citations, drop the invented ones, and count
        # the candidate as clean. The claim is still supported by something that was said.
        kept.append(candidate.model_copy(update={"lineage": real}))

    return kept, invented, empty


_WORD = re.compile(r"\s+")


def make_title(sentence: str, limit: int = 80) -> str:
    """A short, stable title. Trimmed at a word boundary rather than mid-word."""
    text = _WORD.sub(" ", sentence).strip().rstrip(".!?,;:")
    if len(text) <= limit:
        return text
    cut = text[:limit]
    if " " in cut:
        cut = cut[: cut.rfind(" ")]
    return cut.rstrip(".!?,;:")
