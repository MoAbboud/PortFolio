"""Grading, probe selection and the integrity score. Pure, no database, no model."""

from __future__ import annotations

import pytest

from herder.core.ids import uuid7
from herder.domain.integrity import (
    EXCLUDED,
    INCLUDED,
    UNCOVERED,
    GradedProbe,
    ProbeTarget,
    grade,
    leaks_answer,
    score,
    select_probes,
)
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL, Label

FLOOR = 0.5


# ------------------------------------------------------------------ grading


def test_an_answer_that_entails_the_expected_one_scores_1() -> None:
    assert grade(Label(ENTAILMENT, 0.95), Label(NEUTRAL, 0.9), FLOOR).score == 1.0


def test_an_answer_that_contradicts_it_scores_0() -> None:
    assert grade(Label(CONTRADICTION, 0.95), Label(CONTRADICTION, 0.9), FLOOR).score == 0.0


def test_a_true_but_incomplete_answer_scores_half() -> None:
    """Neutral forward - it does not carry all of the expected answer - but what it did say
    is entailed by the expected answer, so it is right as far as it goes."""
    assert grade(Label(NEUTRAL, 0.9), Label(ENTAILMENT, 0.9), FLOOR).score == 0.5


def test_an_answer_that_misses_the_fact_scores_0() -> None:
    """ "Not stated." is neutral both ways, and a miss is a zero."""
    assert grade(Label(NEUTRAL, 0.9), Label(NEUTRAL, 0.9), FLOOR).score == 0.0


def test_a_weak_backward_entailment_is_not_enough_for_half() -> None:
    assert grade(Label(NEUTRAL, 0.9), Label(ENTAILMENT, 0.4), FLOOR).score == 0.0


def test_a_grade_below_the_floor_is_inconclusive_and_never_defaulted() -> None:
    """Both defaults are lies: 0 says the context failed, 1 says it worked, and nothing was
    measured either way."""
    result = grade(Label(ENTAILMENT, 0.4), Label(ENTAILMENT, 0.99), FLOOR)
    assert result.score is None
    assert result.inconclusive
    assert "inconclusive" in result.reason


def test_the_reason_keeps_both_labels_and_scores() -> None:
    reason = grade(Label(ENTAILMENT, 0.91), Label(NEUTRAL, 0.62), FLOOR).reason
    assert "entailment 0.91" in reason and "neutral 0.62" in reason


# ------------------------------------------------------------------ leaks


def test_a_question_that_states_its_answer_leaks() -> None:
    assert leaks_answer("Are money values always Decimal, never float?", "Money values are always Decimal, never float.")


def test_a_question_about_the_claim_does_not_leak() -> None:
    assert not leaks_answer("What numeric type must money values use?", "Money values must always be Decimal, never float.")


def test_sharing_topic_words_is_not_a_leak_when_the_answer_is_not_in_the_question() -> None:
    """The first real run discarded this: four of five words shared, and the fifth - 16.2 -
    is the whole answer."""
    assert not leaks_answer(
        "What version of Postgres is specifically used?", "The version of Postgres specifically used is 16.2."
    )


def test_an_answer_that_adds_nothing_to_the_question_leaks() -> None:
    assert leaks_answer("Which system uses Postgres for production?", "The system uses Postgres for production.")


def test_an_answer_with_no_content_words_cannot_leak() -> None:
    assert not leaks_answer("What was it?", "It was.")


# ------------------------------------------------------------------ selection


def targets(category: str, n: int, pinned: int = 0) -> list[ProbeTarget]:
    return [
        ProbeTarget(category, entry_id=uuid7() if category != UNCOVERED else None,
                    message_id=uuid7() if category == UNCOVERED else None, pinned=i < pinned)
        for i in range(n)
    ]


def test_three_included_two_excluded_one_uncovered() -> None:
    chosen = select_probes(targets(INCLUDED, 10), targets(EXCLUDED, 10), targets(UNCOVERED, 10), seed="s").targets
    assert [t.category for t in chosen].count(INCLUDED) == 3
    assert [t.category for t in chosen].count(EXCLUDED) == 2
    assert [t.category for t in chosen].count(UNCOVERED) == 1


def test_a_short_category_gets_fewer_and_says_so_rather_than_borrowing() -> None:
    """Topping up from another category would change what the score means without changing
    its label."""
    selection = select_probes(targets(INCLUDED, 10), [], targets(UNCOVERED, 10), seed="s")
    categories = [t.category for t in selection.targets]

    assert categories.count(INCLUDED) == 3
    assert categories.count(EXCLUDED) == 0
    assert selection.requested[EXCLUDED] == 2
    assert selection.available[EXCLUDED] == 0


def test_the_same_seed_chooses_the_same_probes() -> None:
    pool = targets(INCLUDED, 20)
    first = select_probes(pool, [], [], seed="injection-a").targets
    again = select_probes(list(reversed(pool)), [], [], seed="injection-a").targets
    assert first == again


def test_different_seeds_do_not_always_probe_the_same_entries() -> None:
    pool = targets(INCLUDED, 20)
    picks = {tuple(t.entry_id for t in select_probes(pool, [], [], seed=f"s{i}").targets) for i in range(10)}
    assert len(picks) > 1


def test_pins_are_probed_first() -> None:
    pool = targets(INCLUDED, 20, pinned=2)
    pins = {t.entry_id for t in pool if t.pinned}
    for i in range(10):
        chosen = {t.entry_id for t in select_probes(pool, [], [], seed=f"s{i}").targets}
        assert pins <= chosen


# ------------------------------------------------------------------ the score


def test_included_counts_double_the_other_two() -> None:
    result = score([GradedProbe(INCLUDED, 1.0), GradedProbe(EXCLUDED, 0.0)])
    assert result.integrity == pytest.approx(1.0 / 1.5)


def test_probing_only_what_was_included_would_hide_what_was_dropped() -> None:
    """The reason for the other two categories. Three perfect included probes and every
    excluded and uncovered probe failed is not a 1.0 brief."""
    included_only = score([GradedProbe(INCLUDED, 1.0)] * 3)
    everything = score([GradedProbe(INCLUDED, 1.0)] * 3 + [GradedProbe(EXCLUDED, 0.0)] * 2 + [GradedProbe(UNCOVERED, 0.0)])
    assert included_only.integrity == 1.0
    assert everything.integrity == pytest.approx(3 / 4.5)


def test_an_inconclusive_probe_is_left_out_of_the_score_and_counted() -> None:
    result = score([GradedProbe(INCLUDED, 1.0), GradedProbe(INCLUDED, None)])
    assert result.integrity == 1.0
    assert result.graded == 1
    assert result.inconclusive == 1


def test_nothing_graded_is_no_score_not_zero() -> None:
    result = score([GradedProbe(INCLUDED, None)])
    assert result.integrity is None


def test_each_category_is_reported_separately() -> None:
    result = score([GradedProbe(INCLUDED, 1.0), GradedProbe(INCLUDED, 0.5), GradedProbe(UNCOVERED, 0.0)])
    assert result.by_category[INCLUDED] == (0.75, 2)
    assert result.by_category[EXCLUDED] == (None, 0)
    assert result.by_category[UNCOVERED] == (0.0, 1)
