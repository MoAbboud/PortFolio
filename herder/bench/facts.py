"""The ground-truth fact list: its format, loading, saving and checking. Pure apart from file IO.

`bench/datasets/<name>/facts.json`, written by a person reading the conversation in the
authoring page at `/bench`. **Never from an extraction** - that is what breaks the circle of a
model checking a model's work, and it is the one part of the benchmark that is the author's.

A fact is one claim, as a sentence that stands on its own, with:

- `kind` - the same vocabulary entries use, so results can be read per kind.
- `truth` - `true` if it holds at the end of the conversation; `false` if the conversation
  contains it but it does not hold - an assistant proposal the user turned down, or a decision
  later reversed. False facts are what the hallucination rate is measured on: a method that
  carries a rejected idea forward as settled is the failure a memory system must not have.
- `turns` - the turn numbers (1-based) where it is established or rejected, so a miss can be
  traced back to the conversation without re-reading all of it.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

KINDS = (
    "decision", "constraint", "preference", "identity", "fact", "open_thread", "code_state", "artifact_ref", "glossary",
)
TRUTHS = ("true", "false")
FORMAT_VERSION = 1
# The plan asks for 30 to 60. Fewer is allowed while writing, and the harness says so loudly.
TARGET_FACTS = 30


class FactError(ValueError):
    pass


@dataclass
class Fact:
    id: str
    statement: str
    kind: str
    truth: str
    turns: list[int] = field(default_factory=list)
    note: str = ""


@dataclass
class FactList:
    conversation: str
    facts: list[Fact] = field(default_factory=list)
    format_version: int = FORMAT_VERSION

    @property
    def true_facts(self) -> list[Fact]:
        return [f for f in self.facts if f.truth == "true"]

    @property
    def false_facts(self) -> list[Fact]:
        return [f for f in self.facts if f.truth == "false"]


def validate(fact: Fact, turn_count: int) -> None:
    if not fact.statement.strip():
        raise FactError("a fact needs a statement")
    if len(fact.statement) > 400:
        raise FactError("keep a fact to one claim - that statement is over 400 characters")
    if fact.kind not in KINDS:
        raise FactError(f"unknown kind {fact.kind!r}; expected one of {', '.join(KINDS)}")
    if fact.truth not in TRUTHS:
        raise FactError("truth is 'true' or 'false'")
    bad = [t for t in fact.turns if not 1 <= t <= turn_count]
    if bad:
        raise FactError(f"turn numbers out of range (1-{turn_count}): {bad}")


def parse_turns(text: str) -> list[int]:
    """'12, 40 41' -> [12, 40, 41]. Anything that is not a number is an error, not ignored."""
    out: list[int] = []
    for piece in text.replace(",", " ").split():
        if not piece.isdigit():
            raise FactError(f"turn numbers are whole numbers; {piece!r} is not")
        out.append(int(piece))
    return sorted(set(out))


def path_for(datasets: Path, name: str) -> Path:
    return datasets / name / "facts.json"


def load(datasets: Path, name: str) -> FactList:
    path = path_for(datasets, name)
    if not path.exists():
        return FactList(conversation=name)
    raw = json.loads(path.read_text(encoding="utf-8"))
    return FactList(
        conversation=raw["conversation"],
        facts=[Fact(**f) for f in raw.get("facts", [])],
        format_version=raw.get("format_version", FORMAT_VERSION),
    )


def save(datasets: Path, facts: FactList) -> None:
    path = path_for(datasets, facts.conversation)
    body = {"conversation": facts.conversation, "format_version": facts.format_version, "facts": [asdict(f) for f in facts.facts]}
    # Written to a temporary name and renamed, so a crash mid-write cannot leave a truncated
    # file - hours of a person's reading are in this file.
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    tmp.replace(path)


def next_id(facts: FactList) -> str:
    numbers = [int(f.id[1:]) for f in facts.facts if f.id[1:].isdigit()]
    return f"f{(max(numbers) + 1) if numbers else 1:03d}"
