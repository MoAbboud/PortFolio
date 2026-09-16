"""Rendering a brief under a token budget. Pure.

**The ordering is the whole design of this module**, because ordering is what decides what
gets thrown away. From requirements/03-architecture.md:

    pinned first
    then by priority:  constraint                  0
                       decision                    1
                       open_thread                 2
                       preference, identity        3
                       code_state                  4
                       glossary, fact              5
                       artifact_ref                6
    then by layer:     stable, project, session    (a tie-breaker, not the first key)
    then by last_seen descending

**Priority before layer since 2026-09-16, the author's decision.** Until then the sort was layer
first, then kind - and the heuristic extracts open threads into the `session` layer, so every
project-layer entry, down to an incidental `fact`, was considered before any open thread. At a
500-token budget the eight benchmark briefs held 35 plain facts and 2 open threads, and
open-thread recall had fallen from 0.46 to 0.08 once more facts were extracted. The layer still
decides where an entry *reads* (the sections below) and still breaks ties, so a stable preference
comes before a project one; it no longer decides what matters most.

Constraints come before facts because a model that has been told the constraints can behave
correctly without knowing every fact, and one that has the facts but not the constraints
cannot. The session tail gets a reserved share rather than competing on equal terms, because
verbatim recent text is what makes a resumed conversation feel continuous and it would
otherwise lose every tie to a durable entry. **How large that share is, is a parameter**
(`tail_reserve`), set from `HERDER_BRIEF_TAIL_RESERVE`, because at a small budget a quarter of it is
about two turns of verbatim text competing with every open thread.

**Two different orderings live in here and conflating them would be a bug.** The sort above
is the order entries are *considered in* as the budget is spent, so what survives follows
priority. The rendered text is then grouped into layer sections, because that is how it
reads. A pin therefore always survives, but a pinned session entry still appears under
Session rather than being hoisted above the Stable heading - a brief that contradicted its
own structure would be worse for the model reading it than one that buried a pin.

No IO, no database, no model. The token counter is injected so that tests can count in whole
words and assert budget boundaries exactly.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

# Default fraction of the budget held back for the verbatim session tail. The caller may pass
# its own; see `render_brief`. 0.25 until 2026-09-16; 0.10 since, measured together with the
# priority table: recall at a 500-token budget 98 -> 119 of 221, and the same recall at 3,000 in a
# brief of 772 tokens instead of 1,214. `core/config.py` must carry the same number (a test checks).
TAIL_RESERVE = 0.10

LAYER_ORDER = ("stable", "project", "session")
LAYER_HEADINGS = {
    "stable": "## Stable",
    "project": "## Project",
    "session": "## Session (most recent)",
}

# What matters most, whatever its layer. Lower is considered first. Equal numbers are equal
# priority and fall through to the layer, then to recency.
PRIORITY = {
    "constraint": 0,
    "decision": 1,
    "open_thread": 2,
    "preference": 3,
    "identity": 3,
    "code_state": 4,
    "glossary": 5,
    "fact": 5,
    "artifact_ref": 6,
}

# The kind vocabulary, in priority order - the table above is written in that order.
KIND_ORDER = tuple(PRIORITY)

TAIL_KIND = "tail"


@dataclass(frozen=True)
class RenderableEntry:
    id: uuid.UUID
    layer: str
    kind: str
    status: str  # active | pinned
    title: str
    text: str
    last_seen_at: dt.datetime

    @property
    def pinned(self) -> bool:
        return self.status == "pinned"


@dataclass
class RenderedBrief:
    text: str
    included_entry_ids: list[uuid.UUID] = field(default_factory=list)
    excluded_entry_ids: list[uuid.UUID] = field(default_factory=list)
    token_count: int = 0
    budget_tokens: int = 0
    tail_included: bool = False
    tail_truncated: bool = False
    # True when pinned entries alone exceeded the budget. The pins win - the user asked for
    # them explicitly - but the brief says so rather than pretending it fitted.
    over_budget: bool = False


def _sort_key(entry: RenderableEntry) -> tuple:
    priority = PRIORITY.get(entry.kind, max(PRIORITY.values()) + 1)
    layer = LAYER_ORDER.index(entry.layer) if entry.layer in LAYER_ORDER else len(LAYER_ORDER)
    # `not pinned` sorts False (0) first, so pins lead. Then priority, then layer as the
    # tie-breaker, then newest last_seen first.
    return (not entry.pinned, priority, layer, -entry.last_seen_at.timestamp())


def _one_line(text: str) -> str:
    """Collapse to a single line.

    The brief is a bullet list, and an entry carrying a newline breaks out of its own list
    item - a merged entry with a "Previously:" paragraph rendered as an orphaned block that a
    model reading the pack cannot attribute to anything. Structure beats fidelity here: an
    entry is a claim, and a claim fits on a line. Anything that genuinely needs its shape
    preserved belongs in the lineage, which keeps the raw message untouched.
    """
    return " ".join(text.split())


def _adds_nothing(title: str, body: str) -> bool:
    """True when the title is just the opening of the text.

    The heuristic extractor's titles are truncations of the sentence they came from, so
    printing both spent roughly double the tokens to say one thing - and the budget is the
    scarcest resource in this system. The local model writes a normalised title that differs
    from its text, and that case still prints both.
    """
    trimmed = title.rstrip(" .!?,;:").lower()
    lowered = body.lower()
    if not trimmed or not lowered.startswith(trimmed):
        return False
    # On a word boundary. "Rust" is not the opening of "Rustls is used for TLS", and dropping
    # it would lose the claim the title made.
    rest = lowered[len(trimmed) :]
    return not rest or not rest[0].isalnum()


def format_entry(entry: RenderableEntry) -> str:
    title = _one_line(entry.title)
    body = _one_line(entry.text)

    if not body or body == title:
        return f"- [{entry.kind}] {title}"
    if _adds_nothing(title, body):
        return f"- [{entry.kind}] {body}"
    return f"- [{entry.kind}] {title} - {body}"


def format_tail(text: str) -> str:
    """The tail as one list item, its continuation lines indented under the bullet.

    Not flattened like an entry: the tail is verbatim turns, one per line, and joining them
    would lose who said what. Left at column 0 they broke out of the list item exactly as a
    multi-line entry did, so they are indented instead.
    """
    first, *rest = text.split("\n")
    return "\n".join([f"- [{TAIL_KIND}] {first}", *(f"  {line}" for line in rest)])


def _truncate_tail(text: str, budget: int, count: Callable[[str], int]) -> tuple[str, bool]:
    """Fit the tail into `budget`, dropping from the FRONT.

    From the front because the tail is verbatim recent conversation: the end of it is the
    part that makes a resumed session feel continuous, and the beginning is the part the
    durable entries have most likely already captured.
    """
    if count(text) <= budget:
        return text, False

    lines = text.split("\n")
    while lines and count("\n".join(lines)) > budget:
        lines.pop(0)

    if lines:
        return "\n".join(lines), True

    # One line longer than the whole reserve. Drop leading words instead of giving up.
    words = text.split()
    while words and count(" ".join(words)) > budget:
        words.pop(0)
    return " ".join(words), True


def render_brief(
    entries: Sequence[RenderableEntry],
    budget_tokens: int,
    count: Callable[[str], int],
    tail_text: str | None = None,
    tail_entry_id: uuid.UUID | None = None,
    tail_reserve: float = TAIL_RESERVE,
) -> RenderedBrief:
    """Render active and pinned entries into a brief of at most `budget_tokens`.

    `tail_reserve` is the fraction of the budget held for the verbatim tail. Zero is allowed and
    means the tail is dropped; one or more would leave nothing for the entries and is refused.
    """
    if budget_tokens < 1:
        raise ValueError("budget_tokens must be positive")
    if not 0 <= tail_reserve < 1:
        raise ValueError("tail_reserve is a fraction of the budget, at least 0 and below 1")

    tail_tokens = int(budget_tokens * tail_reserve) if tail_text else 0
    body_budget = budget_tokens - tail_tokens

    result = RenderedBrief(text="", budget_tokens=budget_tokens)
    ordered = sorted((e for e in entries if e.kind != TAIL_KIND), key=_sort_key)

    used = 0
    sections: dict[str, list[str]] = {}
    stopped = False

    for entry in ordered:
        if stopped and not entry.pinned:
            result.excluded_entry_ids.append(entry.id)
            continue

        line = format_entry(entry)
        cost = count(line)
        if entry.layer not in sections:
            cost += count(LAYER_HEADINGS.get(entry.layer, f"## {entry.layer}"))

        if used + cost > body_budget and not entry.pinned:
            # Stop rather than skip. Skipping would let a trivial `fact` that happens to fit
            # displace a `decision` that did not, which inverts the priority the whole
            # ordering exists to enforce. The cost is a little wasted budget, and the
            # alternative is a brief whose contents no longer follow its own rules.
            # Revisit at stage 10 with the harness, not before.
            stopped = True
            result.excluded_entry_ids.append(entry.id)
            continue

        sections.setdefault(entry.layer, []).append(line)
        result.included_entry_ids.append(entry.id)
        used += cost
        if entry.pinned and used > body_budget:
            result.over_budget = True

    parts: list[str] = []
    for layer in LAYER_ORDER:
        if layer in sections:
            parts.append(LAYER_HEADINGS[layer])
            parts.extend(sections[layer])
    for layer in sections:
        if layer not in LAYER_ORDER:
            parts.append(f"## {layer}")
            parts.extend(sections[layer])

    if tail_text:
        heading = LAYER_HEADINGS["session"] if "session" not in sections else None

        def tail_cost(candidate: str) -> int:
            # The whole block as it will be printed - heading, bullet and indentation included.
            # Counting only the bare text let a full brief overrun its budget by the overhead.
            block = format_tail(candidate)
            return count(f"{heading}\n{block}" if heading else block)

        fitted, truncated = _truncate_tail(tail_text.strip(), tail_tokens, tail_cost)
        if fitted:
            if heading:
                parts.append(heading)
            parts.append(format_tail(fitted))
            result.tail_included = True
            result.tail_truncated = truncated
            used += tail_cost(fitted)
            if tail_entry_id is not None:
                result.included_entry_ids.append(tail_entry_id)
        elif tail_entry_id is not None:
            result.excluded_entry_ids.append(tail_entry_id)

    result.text = "\n".join(p for p in parts if p != "")
    result.token_count = count(result.text)
    return result
