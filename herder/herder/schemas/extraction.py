"""The extraction contract.

One definition, used three ways: as the JSON grammar the local model decodes under, as the
parse target for whatever comes back, and as the shape the heuristic extractor emits. Three
implementations producing the same object is what makes comparing them possible at all.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Layer = Literal["stable", "project", "session"]
Kind = Literal[
    "fact",
    "decision",
    "constraint",
    "preference",
    "identity",
    "open_thread",
    "code_state",
    "artifact_ref",
    "glossary",
    "tail",
]

# Titles are short and stable across rephrasings, because they are what the merge step is
# given as "the titles you already know" on the next pass. A title that drifts every time
# makes the model restate things the system already has.
TITLE_MAX = 80


class Candidate(BaseModel):
    layer: Layer
    kind: Kind
    title: str = Field(max_length=TITLE_MAX)
    text: str
    # Message ids from the chunk. Mandatory, and validated against the chunk that was
    # actually sent - a model citing an id it was never shown is inventing evidence, and
    # the audit trail is the product.
    lineage: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    supersedes_title: str | None = None

    @field_validator("title", "text")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class CandidateList(BaseModel):
    entries: list[Candidate] = Field(default_factory=list)


class ExtractionOutcome(BaseModel):
    """What one extraction call produced, including what it lost and why."""

    candidates: list[Candidate] = Field(default_factory=list)
    # Counted, never silently discarded. A run that cannot say what it dropped is a run
    # whose numbers mean nothing.
    dropped_invented_lineage: int = 0
    dropped_empty_lineage: int = 0
    failed: bool = False
    error: str | None = None
    raw_output: str | None = None
    validated_first_try: bool = True
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    # Reported separately because on a CPU the split is the finding: prompt processing is
    # expected to dominate, and that is what makes chunk size the biggest lever on how long
    # a derive takes. Zero for extractors that do no inference.
    prompt_ms: int = 0
    generation_ms: int = 0
    model: str = ""
    prompt_version: str | None = None
