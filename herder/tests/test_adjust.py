"""The adjuster's rules, and derive's respect for entries a person holds. Pure."""

from __future__ import annotations

import pytest

from herder.core.ids import uuid7
from herder.domain.adjust import Refused, apply, check_edit
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL, Label, Match, Verdict, decide_against

FLOOR = 0.5


# ------------------------------------------------------------------ the status flow


@pytest.mark.parametrize(
    ("action", "before", "after"),
    [
        ("pin", "active", "pinned"),
        ("unpin", "pinned", "active"),
        ("remove", "active", "removed"),
        ("remove", "pinned", "removed"),
        ("remove", "archived", "removed"),
        ("restore", "removed", "active"),
        ("restore", "archived", "active"),
        ("archive", "active", "archived"),
    ],
)
def test_the_status_flow_in_the_data_model(action: str, before: str, after: str) -> None:
    assert apply(action, status=before, layer="project", kind="fact").status == after


@pytest.mark.parametrize(
    ("action", "status"),
    [("pin", "removed"), ("pin", "pinned"), ("unpin", "active"), ("restore", "active"), ("archive", "pinned")],
)
def test_a_move_the_flow_does_not_allow_is_refused_with_a_reason(action: str, status: str) -> None:
    """Pinning a removed entry means the person thinks it is active. Saying nothing would leave
    them believing it is in the brief."""
    with pytest.raises(Refused, match=status):
        apply(action, status=status, layer="project", kind="fact")


def test_a_superseded_entry_is_history_and_cannot_be_touched() -> None:
    for action in ("pin", "remove", "restore", "promote"):
        with pytest.raises(Refused, match="superseded"):
            apply(action, status="superseded", layer="project", kind="decision")


def test_the_session_tail_cannot_be_adjusted() -> None:
    with pytest.raises(Refused, match="tail"):
        apply("pin", status="active", layer="session", kind="tail")


def test_promote_moves_a_project_entry_to_stable_and_nothing_else() -> None:
    change = apply("promote", status="pinned", layer="project", kind="preference")
    assert (change.status, change.layer) == ("pinned", "stable")

    with pytest.raises(Refused, match="already"):
        apply("promote", status="active", layer="stable", kind="preference")
    with pytest.raises(Refused, match="Project"):
        apply("promote", status="active", layer="session", kind="preference")


def test_a_removed_entry_cannot_be_edited() -> None:
    with pytest.raises(Refused, match="restore"):
        check_edit(status="removed", kind="fact", layer=None)


# ------------------------------------------------------------------ derive and held entries


def match(status: str = "active", held: bool = False) -> Match:
    return Match(entry_id=uuid7(), status=status, title="t", text="We use Postgres.", similarity=0.9, held=held)


def test_a_contradiction_supersedes_an_entry_nobody_holds() -> None:
    decision = decide_against(match(), Label(CONTRADICTION, 0.99), Label(CONTRADICTION, 0.99), FLOOR)
    assert decision.verdict is Verdict.SUPERSEDE


def test_a_contradiction_of_a_held_entry_is_a_conflict_not_a_supersede() -> None:
    """The person pinned, wrote or edited it. Superseding would overrule them silently."""
    decision = decide_against(match(held=True), Label(CONTRADICTION, 0.99), Label(CONTRADICTION, 0.99), FLOOR)
    assert decision.verdict is Verdict.CONFLICT


def test_a_more_specific_candidate_does_not_rewrite_a_held_entry() -> None:
    decision = decide_against(match(held=True), Label(ENTAILMENT, 0.99), Label(NEUTRAL, 0.99), FLOOR)
    assert decision.verdict is Verdict.DUPLICATE


def test_a_removed_entry_is_still_dropped_even_if_held() -> None:
    decision = decide_against(match(status="removed", held=True), Label(CONTRADICTION, 0.99), Label(CONTRADICTION, 0.99), FLOOR)
    assert decision.verdict is Verdict.DROP
