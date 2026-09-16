"""The render algorithm. Pure, no database, no model.

Ordering is what decides what gets thrown away, so most of this file is about ordering. The
token counter counts whole words so budget boundaries can be asserted exactly.
"""

from __future__ import annotations

import datetime as dt
import uuid

import pytest

from herder.core.ids import uuid7
from herder.domain.render import (
    KIND_ORDER,
    LAYER_ORDER,
    PRIORITY,
    RenderableEntry,
    format_entry,
    render_brief,
)

BASE = dt.datetime(2026, 9, 10, 12, 0, tzinfo=dt.UTC)


def words(text: str) -> int:
    return len(text.split())


def entry(
    kind: str = "fact",
    layer: str = "project",
    status: str = "active",
    title: str = "a title",
    text: str = "",
    minutes_ago: int = 0,
    id: uuid.UUID | None = None,
) -> RenderableEntry:
    return RenderableEntry(
        id=id or uuid7(),
        layer=layer,
        kind=kind,
        status=status,
        title=title,
        text=text or title,
        last_seen_at=BASE - dt.timedelta(minutes=minutes_ago),
    )


def render(entries, budget=1000, **kwargs):
    return render_brief(entries, budget, words, **kwargs)


# ------------------------------------------------------------------ ordering


def test_layers_come_out_in_order() -> None:
    result = render([entry(layer="session"), entry(layer="stable"), entry(layer="project")])
    assert result.text.index("## Stable") < result.text.index("## Project")
    assert result.text.index("## Project") < result.text.index("## Session")


def test_kinds_are_ordered_within_a_layer() -> None:
    """Constraints before facts: a model told the constraints can behave correctly without
    every fact, and one with the facts but no constraints cannot."""
    entries = [entry(kind=k, title=k) for k in ("fact", "decision", "constraint", "preference")]
    lines = render(entries).text.splitlines()
    order = [line for line in lines if line.startswith("- ")]

    assert "[constraint]" in order[0]
    assert "[decision]" in order[1]
    assert "[preference]" in order[2]
    assert "[fact]" in order[3]


def test_a_pin_wins_inclusion_but_still_reads_in_its_own_layer() -> None:
    """Two different orderings, and conflating them would be a real bug.

    A pin's privilege is **inclusion**, not position: it is considered first when the budget
    is being spent, so it always survives. But the rendered text is grouped by layer, and
    hoisting a pinned session entry above the Stable heading would produce a brief that
    contradicts its own structure.
    """
    pinned = entry(kind="artifact_ref", layer="session", status="pinned", title="pinned one")
    result = render([entry(kind="constraint", layer="stable", title="a constraint"), pinned])

    assert pinned.id in result.included_entry_ids
    # Reads under Session, where it belongs.
    assert result.text.index("## Session") < result.text.index("pinned one")
    assert result.text.index("a constraint") < result.text.index("pinned one")


def test_an_open_thread_outranks_a_project_fact_when_the_budget_is_tight() -> None:
    """The author's decision of 2026-09-16: priority before layer.

    Open threads are extracted into the session layer. With layer first, every project fact was
    spent before any open thread, and at 500 tokens the benchmark briefs held 35 plain facts and 2
    open threads. What survives a tight budget now follows what matters most.
    """
    thread = entry(kind="open_thread", layer="session", title="who covers weekends is undecided")
    facts = [entry(kind="fact", layer="project", title=f"background fact number {i}") for i in range(5)]
    result = render([*facts, thread], budget=12)

    assert thread.id in result.included_entry_ids
    assert any(f.id in result.excluded_entry_ids for f in facts)


def test_a_constraint_still_outranks_an_open_thread() -> None:
    thread = entry(kind="open_thread", layer="session", title="an open question here")
    constraint = entry(kind="constraint", layer="project", title="never store card numbers")
    # constraint line 6 words + "## Project" 2 = 8 fits in 10; the thread would need 10 more.
    result = render([thread, constraint], budget=10)

    assert constraint.id in result.included_entry_ids
    assert thread.id in result.excluded_entry_ids


def test_the_layer_breaks_a_tie_between_equal_priorities() -> None:
    """Layer is no longer the first key, but it still decides between equals: a preference about
    the user outlives one about this project."""
    project_pref = entry(kind="preference", layer="project", title="project preference here")
    stable_pref = entry(kind="preference", layer="stable", title="stable preference here")
    # each costs 5 words plus a 2-word heading, so only one fits in 8.
    result = render([project_pref, stable_pref], budget=8)

    assert stable_pref.id in result.included_entry_ids
    assert project_pref.id in result.excluded_entry_ids


def test_recency_breaks_a_tie() -> None:
    old = entry(kind="fact", title="older", minutes_ago=99)
    new = entry(kind="fact", title="newer", minutes_ago=1)
    lines = [line for line in render([old, new]).text.splitlines() if line.startswith("- ")]
    assert "newer" in lines[0]


def test_an_unknown_kind_or_layer_sorts_last_rather_than_crashing() -> None:
    result = render([entry(kind="mystery", layer="elsewhere", title="odd"), entry(kind="constraint")])
    assert "odd" in result.text
    assert len(result.included_entry_ids) == 2


# ------------------------------------------------------------------ the budget


def test_everything_fits_when_the_budget_is_generous() -> None:
    entries = [entry(title=f"entry {i}") for i in range(5)]
    result = render(entries, budget=1000)
    assert len(result.included_entry_ids) == 5
    assert result.excluded_entry_ids == []


def test_what_does_not_fit_is_recorded_as_excluded() -> None:
    """A render that only recorded what it kept could never measure what the budget cost."""
    entries = [entry(kind="fact", title=f"entry number {i} with several words in it") for i in range(20)]
    result = render(entries, budget=30)

    assert result.included_entry_ids
    assert result.excluded_entry_ids
    assert len(result.included_entry_ids) + len(result.excluded_entry_ids) == 20


def test_the_budget_is_respected() -> None:
    entries = [entry(kind="fact", title=f"entry number {i} with several words in it") for i in range(20)]
    result = render(entries, budget=40)
    assert result.token_count <= 40


def test_a_pin_is_included_even_when_it_breaks_the_budget_and_says_so() -> None:
    """Invariant 8: every pinned entry is included.

    The user asked for it explicitly, so the pin outranks the budget - but the result
    reports `over_budget` rather than pretending it fitted.
    """
    long_title = " ".join(f"word{i}" for i in range(60))
    result = render([entry(status="pinned", title=long_title)], budget=10)

    assert len(result.included_entry_ids) == 1
    assert result.over_budget is True


def test_a_pin_after_the_budget_is_spent_is_still_included() -> None:
    filler = [entry(kind="fact", title=f"filler entry number {i} padding it out") for i in range(20)]
    pinned = entry(kind="artifact_ref", status="pinned", title="must appear")
    result = render([*filler, pinned], budget=30)

    assert pinned.id in result.included_entry_ids
    assert "must appear" in result.text


def test_a_zero_budget_is_an_error() -> None:
    with pytest.raises(ValueError):
        render([entry()], budget=0)


def test_no_entries_renders_an_empty_brief() -> None:
    result = render([])
    assert result.text == ""
    assert result.included_entry_ids == []


# ------------------------------------------------------------------ the tail
#
# The mechanics tests below pin `tail_reserve=0.25` explicitly: they test truncation and
# overhead with budgets sized for that share, not what the default share is.


def test_the_tail_is_appended_and_gets_its_reserve() -> None:
    tail_id = uuid7()
    result = render([entry(kind="constraint")], budget=100, tail_text="the last thing said", tail_entry_id=tail_id)

    assert result.tail_included is True
    assert result.tail_truncated is False
    assert "[tail] the last thing said" in result.text
    assert tail_id in result.included_entry_ids


def test_the_tail_is_truncated_from_the_front_keeping_the_most_recent() -> None:
    """The end of the tail is what makes a resumed session feel continuous."""
    tail = "\n".join(f"line {i} of the conversation" for i in range(40))
    result = render([entry()], budget=60, tail_text=tail, tail_reserve=0.25)

    assert result.tail_truncated is True
    assert "line 39" in result.text
    assert "line 0 " not in result.text


def test_a_single_tail_line_longer_than_the_reserve_drops_leading_words() -> None:
    tail = " ".join(f"word{i}" for i in range(200))
    result = render([entry()], budget=40, tail_text=tail, tail_reserve=0.25)

    assert result.tail_included is True
    assert "word199" in result.text
    assert "word0 " not in result.text


def test_the_tail_reserve_does_not_starve_when_there_is_no_tail() -> None:
    """No tail means no reserve - the entries get the whole budget."""
    entries = [entry(kind="fact", title=f"entry number {i} here") for i in range(10)]
    with_tail = render(entries, budget=40, tail_text="something recent")
    without = render(entries, budget=40)
    assert len(without.included_entry_ids) >= len(with_tail.included_entry_ids)


def test_the_tail_reserve_is_a_parameter() -> None:
    """A smaller reserve leaves more of a small budget for entries."""
    entries = [entry(kind="decision", title=f"decision number {i} made") for i in range(40)]
    tail = "\n".join(f"line {i} of the conversation" for i in range(40))
    # 200 words: a quarter leaves 150 for entries, a tenth leaves 180 and still fits a tail line.
    quarter = render(entries, budget=200, tail_text=tail, tail_reserve=0.25)
    tenth = render(entries, budget=200, tail_text=tail, tail_reserve=0.10)

    included = lambda r: len([i for i in r.included_entry_ids if i in {e.id for e in entries}])
    assert included(tenth) > included(quarter)
    assert tenth.tail_included


def test_a_zero_reserve_drops_the_tail() -> None:
    result = render([entry()], budget=40, tail_text="something recent", tail_reserve=0.0)
    assert result.tail_included is False
    assert "something recent" not in result.text


@pytest.mark.parametrize("reserve", [-0.1, 1.0, 1.5])
def test_a_reserve_outside_zero_to_one_is_refused(reserve: float) -> None:
    with pytest.raises(ValueError, match="tail_reserve"):
        render([entry()], budget=40, tail_text="x", tail_reserve=reserve)


def test_a_multi_line_tail_stays_inside_its_own_list_item() -> None:
    """The same defect `_one_line` fixed for entries, on the one entry it does not touch.

    The tail is verbatim turns, one per line, and flattening it would lose who said what - so
    its continuation lines are indented under the bullet instead of left at column 0, where
    they read as orphaned text belonging to no item. Found in the real loop-demo brief.
    """
    tail = "user: first thing\nassistant: ok\nuser: last thing"
    result = render([entry(kind="constraint")], budget=100, tail_text=tail, tail_reserve=0.25)

    lines = result.text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith("- [tail]"))
    assert lines[start] == "- [tail] user: first thing"
    assert lines[start + 1 :] == ["  assistant: ok", "  user: last thing"]


def test_the_tail_block_fits_its_reserve_with_its_heading_and_bullet() -> None:
    """Counted in characters, so the heading, the bullet and the indentation all cost
    something. Only the bare tail text used to be counted, so a brief whose entries filled
    their share could overrun the budget by the overhead."""
    budget = 400
    entries = [entry(kind="fact", title=f"entry number {i} padding") for i in range(30)]
    tail = "\n".join(f"user: line {i} of the conversation" for i in range(40))
    result = render_brief(entries, budget, len, tail_text=tail, tail_reserve=0.25)

    assert result.tail_included is True
    section = result.text[result.text.index("## Session") :]
    assert len(section) <= int(budget * 0.25)
    assert result.token_count <= budget


def test_an_entry_of_kind_tail_in_the_list_is_not_rendered_as_a_normal_entry() -> None:
    """The tail is passed separately; a stored tail entry must not appear twice."""
    result = render([entry(kind="tail", layer="session", title="stale tail"), entry(kind="constraint")])
    assert "stale tail" not in result.text


# ------------------------------------------------------------------ formatting


def test_the_line_carries_the_kind_the_title_and_the_text() -> None:
    line = format_entry(entry(kind="decision", title="Use Postgres", text="Because of concurrent writes."))
    assert line == "- [decision] Use Postgres - Because of concurrent writes."


def test_a_title_that_is_its_own_text_is_not_repeated() -> None:
    line = format_entry(entry(kind="fact", title="Same", text="Same"))
    assert line == "- [fact] Same"


def test_a_multi_line_entry_is_flattened_onto_one_line() -> None:
    """The brief is a bullet list, and a newline breaks an entry out of its own list item.

    A merged entry carries "Previously: ..." on a new paragraph, which rendered as an
    orphaned block a model reading the pack could not attribute to anything. Found by looking
    at a real stage 5 pack.
    """
    line = format_entry(
        entry(kind="constraint", title="Decimal for money", text="Decimal for money.\n\nPreviously: never floats.")
    )
    assert "\n" not in line
    assert "Previously: never floats." in line


def test_a_title_that_is_only_the_opening_of_the_text_is_not_printed_twice() -> None:
    """The heuristic's titles are truncations of their own sentence, so printing both spent
    roughly double the tokens to say one thing. Re-rendering the corpus after this fix cut a
    brief from 300 tokens to 219."""
    line = format_entry(
        entry(
            kind="constraint",
            title="Money values are always Decimal, never float",
            text="Money values are always Decimal, never float, everywhere in the system.",
        )
    )
    assert line.count("Money values are always Decimal") == 1
    assert line.endswith("everywhere in the system.")


def test_a_title_that_only_prefixes_a_longer_word_still_prints() -> None:
    """ "Rust" is not the opening of "Rustls is used for TLS" - it is a different word, and
    dropping it would lose the claim the title made."""
    line = format_entry(entry(kind="decision", title="Rust", text="Rustls is used for TLS."))
    assert line == "- [decision] Rust - Rustls is used for TLS."


def test_a_genuinely_different_title_still_prints_both() -> None:
    """The local model writes a normalised title that is not a prefix of its text, and that
    is exactly the case worth keeping both halves of."""
    line = format_entry(
        entry(kind="decision", title="Postgres in production", text="Production runs on Postgres, not SQLite.")
    )
    assert "Postgres in production - Production runs on Postgres" in line


def test_the_vocabularies_match_the_data_model() -> None:
    assert LAYER_ORDER == ("stable", "project", "session")
    assert KIND_ORDER[:3] == ("constraint", "decision", "open_thread")
    assert KIND_ORDER[-1] == "artifact_ref"
    assert "tail" not in KIND_ORDER
    assert set(KIND_ORDER) == set(PRIORITY)


def test_the_render_default_and_the_setting_agree() -> None:
    """Two defaults for one number would drift: the domain function would render one share in
    tests and the product another. Same shape as the embedding-dimension check."""
    from herder.core.config import Settings
    from herder.domain.render import TAIL_RESERVE

    assert Settings(_env_file=None).brief_tail_reserve == TAIL_RESERVE
