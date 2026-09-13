"""The probe generation contracts: the JSON grammars the local model decodes under.

Two, because an entry and a raw message are different inputs. A raw message may hold no fact
at all ("thanks, go on"), so its grammar lets the model say so. An entry is a claim already
stored in memory, so its grammar does not: offered `has_fact`, qwen2.5:3b answered false for
three of six real entries - two decisions and an open thread - and a checkpoint that cannot
probe half the brief is measuring the probe writer, not the brief.
"""

from __future__ import annotations

from pydantic import BaseModel


class ProbeSpec(BaseModel):
    # False for content with no checkable fact in it - a greeting, a question, "thanks".
    # Uncovered probes are written from raw messages, and most raw messages are not facts.
    has_fact: bool
    question: str = ""
    expected_answer: str = ""


class EntryProbeSpec(BaseModel):
    """For an entry. There is always a fact, so there is no way to decline."""

    question: str
    expected_answer: str
