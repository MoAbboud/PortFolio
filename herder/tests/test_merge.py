"""The merge decision logic. Pure, no model, no database.

The merge step is what stops the memory growing linearly with the conversation, so this is
where the compaction claim is either true or false. The most important test here is the
removed-entry rule.
"""

from __future__ import annotations

from herder.core.ids import uuid7
from herder.domain.merge import (
    CONTRADICTION,
    ENTAILMENT,
    NEUTRAL,
    Decision,
    Label,
    Match,
    Verdict,
    announces_change,
    choose_match,
    claim_of,
    decide_against,
    decide_reversal,
    merged_text,
    pick_reversal,
    reversal_strength,
)


# ------------------------------------------------------- a candidate announcing a change (stage 10)


def test_a_strong_one_sided_contradiction_retires_the_entry_for_a_reversal() -> None:
    decision = decide_reversal(match(), [(label(NEUTRAL, 0.99), label(CONTRADICTION, 0.97))])
    assert decision is not None and decision.verdict is Verdict.SUPERSEDE


def test_any_reading_can_carry_it_the_full_sentence_or_the_claim() -> None:
    full, claim = (label(NEUTRAL, 0.99), label(NEUTRAL, 0.95)), (label(NEUTRAL, 0.99), label(CONTRADICTION, 0.99))
    assert decide_reversal(match(), [full, claim]).verdict is Verdict.SUPERSEDE


def test_a_weak_contradiction_is_not_enough_even_for_a_reversal() -> None:
    """The high bar replaces the second direction as the guard against invented contradictions."""
    assert decide_reversal(match(), [(label(CONTRADICTION, 0.6), label(NEUTRAL, 0.99))]) is None


def test_a_reversal_of_a_held_entry_asks_instead_of_overruling() -> None:
    held = Match(entry_id=uuid7(), status="active", title="t", text="x", similarity=0.9, held=True)
    assert decide_reversal(held, [(label(CONTRADICTION, 0.99), label(NEUTRAL, 0.9))]).verdict is Verdict.CONFLICT


def test_a_reversal_leaves_a_removed_entry_to_the_hard_rule() -> None:
    """None sends it back to `decide_against`, which drops the candidate. No way around removal."""
    assert decide_reversal(match(status="removed"), [(label(CONTRADICTION, 0.99), label(CONTRADICTION, 0.99))]) is None


def test_the_change_cue_and_the_claim() -> None:
    assert announces_change("Correction on the rota handover day - it switches on Mondays, not Fridays.")
    assert not announces_change("The on-call rota changes on Fridays.")
    assert claim_of("Correction on the rota handover day - it switches on Mondays.") == "it switches on Mondays."
    assert claim_of("Swap one of the ports I listed earlier: it's Felixstowe, not Rotterdam.") == "it's Felixstowe, not Rotterdam."
    assert claim_of("The case-study ports are Newark, Rotterdam and Singapore.") == "The case-study ports are Newark, Rotterdam and Singapore."

FLOOR = 0.5


def match(status: str = "active", similarity: float = 0.9, text: str = "stored text") -> Match:
    return Match(entry_id=uuid7(), status=status, title="stored", text=text, similarity=similarity)


def label(name: str, score: float = 0.9) -> Label:
    return Label(name, score)


def decide(m: Match, forward: Label, backward: Label, floor: float = FLOOR):
    return decide_against(m, forward, backward, floor)


# ------------------------------------------------------------------ the hard rule


def test_a_candidate_matching_a_removed_entry_is_dropped() -> None:
    """Removed means removed. Without this the user deletes an entry, the next derive
    re-creates it, and they delete it again forever."""
    decision = decide(match(status="removed"), label(ENTAILMENT), label(ENTAILMENT))
    assert decision.verdict is Verdict.DROP


def test_the_removed_rule_beats_a_contradiction() -> None:
    """No model output may route around it, whatever it says."""
    decision = decide(match(status="removed"), label(CONTRADICTION, 0.99), label(CONTRADICTION, 0.99))
    assert decision.verdict is Verdict.DROP


def test_the_removed_rule_beats_a_low_confidence_reading() -> None:
    decision = decide(match(status="removed"), label(NEUTRAL, 0.1), label(NEUTRAL, 0.1))
    assert decision.verdict is Verdict.DROP


# ------------------------------------------------------------------ the four verdicts


def test_mutual_entailment_is_a_duplicate() -> None:
    decision = decide(match(), label(ENTAILMENT), label(ENTAILMENT))
    assert decision.verdict is Verdict.DUPLICATE


def test_a_more_specific_candidate_is_an_update() -> None:
    """"We use Postgres" and "We use Postgres 16.2 in production" entail one way only.

    Which way decides whether the memory gains the detail or silently discards it.
    """
    decision = decide(match(), forward=label(ENTAILMENT), backward=label(NEUTRAL))
    assert decision.verdict is Verdict.UPDATE


def test_a_less_specific_candidate_is_a_duplicate() -> None:
    """The stored entry already covers it, so there is nothing to add."""
    decision = decide(match(), forward=label(NEUTRAL), backward=label(ENTAILMENT))
    assert decision.verdict is Verdict.DUPLICATE


def test_contradiction_in_both_directions_supersedes() -> None:
    """A genuine reversal reads as contradiction both ways. Measured 1.00/1.00 on every
    real contradiction tested against nli-deberta-v3-base."""
    decision = decide(match(), label(CONTRADICTION), label(CONTRADICTION))
    assert decision.verdict is Verdict.SUPERSEDE


def test_a_one_sided_contradiction_does_not_supersede() -> None:
    """This is what NLI returns for UNRELATED text, not for a changed claim.

    Measured: "Amounts are always Decimal" against "The parser lives in transcript.py" comes
    back neutral 0.99 forward and contradiction 1.00 backward. Superseding on that would
    retire a good entry on noise, with nothing anywhere to show it had happened.
    """
    assert decide(match(), label(NEUTRAL, 0.99), label(CONTRADICTION, 1.0)).verdict is Verdict.DISTINCT
    assert decide(match(), label(CONTRADICTION, 1.0), label(NEUTRAL, 0.99)).verdict is Verdict.DISTINCT


def test_a_one_sided_contradiction_against_entailment_still_follows_the_entailment() -> None:
    """The entailment is the measured signal; the lone contradiction is the artefact."""
    decision = decide(match(), forward=label(ENTAILMENT), backward=label(CONTRADICTION))
    assert decision.verdict is Verdict.UPDATE


def test_neutral_both_ways_is_distinct() -> None:
    decision = decide(match(), label(NEUTRAL), label(NEUTRAL))
    assert decision.verdict is Verdict.DISTINCT
    assert decision.below_floor is False


# ------------------------------------------------------------------ the confidence floor


def test_nothing_above_the_floor_falls_back_to_distinct_and_says_so() -> None:
    """`distinct` costs a near-duplicate the user can see and remove. `duplicate` would
    silently discard new information, which is the worse failure."""
    decision = decide(match(), label(ENTAILMENT, 0.2), label(ENTAILMENT, 0.3))
    assert decision.verdict is Verdict.DISTINCT
    assert decision.below_floor is True


def test_a_contradiction_below_the_floor_does_not_supersede() -> None:
    """Superseding on a guess would retire a good entry on no evidence."""
    decision = decide(match(), label(CONTRADICTION, 0.3), label(CONTRADICTION, 0.3))
    assert decision.verdict is not Verdict.SUPERSEDE


def test_entailment_below_the_floor_does_not_update() -> None:
    decision = decide(match(), label(ENTAILMENT, 0.3), label(NEUTRAL, 0.95))
    assert decision.verdict is Verdict.DISTINCT
    assert decision.below_floor is False  # neutral was measured confidently


def test_the_floor_is_configurable() -> None:
    weak = decide(match(), label(ENTAILMENT, 0.6), label(ENTAILMENT, 0.6), floor=0.9)
    strong = decide(match(), label(ENTAILMENT, 0.6), label(ENTAILMENT, 0.6), floor=0.5)
    assert weak.verdict is Verdict.DISTINCT
    assert strong.verdict is Verdict.DUPLICATE


# ------------------------------------------------------------------ candidate selection


def test_only_matches_above_the_threshold_are_adjudicated() -> None:
    """Similarity is arithmetic over an index; adjudication is a model call."""
    kept = choose_match([match(similarity=0.9), match(similarity=0.5)], threshold=0.86)
    assert len(kept) == 1


def test_the_most_similar_come_first() -> None:
    matches = [match(similarity=0.87), match(similarity=0.99), match(similarity=0.9)]
    kept = choose_match(matches, threshold=0.86)
    assert [round(m.similarity, 2) for m in kept] == [0.99, 0.9, 0.87]


def test_at_most_three_are_adjudicated() -> None:
    """Adjudicating every candidate against every entry makes a derive quadratic."""
    matches = [match(similarity=0.9 + i / 1000) for i in range(10)]
    assert len(choose_match(matches, threshold=0.86)) == 3


def test_nothing_above_the_threshold_means_nothing_to_adjudicate() -> None:
    assert choose_match([match(similarity=0.1)], threshold=0.86) == []


# ------------------------------------------------------------------ merged text


def test_an_update_keeps_the_earlier_wording_behind_the_new() -> None:
    """A probe may already be graded against the earlier phrasing."""
    text = merged_text("We use Postgres.", "We use Postgres 16.2 in production.")
    assert "Postgres 16.2" in text
    assert "Previously: We use Postgres." in text


def test_a_candidate_containing_the_existing_text_just_replaces_it() -> None:
    text = merged_text("We use Postgres", "We use Postgres in production")
    assert text == "We use Postgres in production"


def test_a_candidate_already_covered_by_the_existing_text_changes_nothing() -> None:
    text = merged_text("We use Postgres in production", "We use Postgres")
    assert text == "We use Postgres in production"


def test_identical_text_does_not_duplicate_itself() -> None:
    assert merged_text("Same thing", "Same thing") == "Same thing"


def test_an_empty_existing_text_is_replaced() -> None:
    assert merged_text("", "something new") == "something new"


# ------------------------------------------------------------------ which entry a reversal retires

# Added 2026-09-18. The readings below are the ones measured on coding-photo-sync, where the old
# first-by-similarity rule retired the true entry and served the stale one.



def _label(label: str, score: float) -> Label:
    return Label(label, score)


C, N = CONTRADICTION, NEUTRAL
STALE_READINGS = [(_label(C, 1.00), _label(C, 1.00)), (_label(N, 1.00), _label(N, 1.00))]
TRUE_READINGS = [(_label(N, 0.95), _label(C, 1.00)), (_label(C, 0.94), _label(N, 0.97))]


def _option(text: str, readings) -> tuple[Decision, tuple[float, float]]:
    match = Match(entry_id=uuid7(), status="active", title=text, text=text, similarity=0.6)
    return Decision(Verdict.SUPERSEDE, match, "test"), reversal_strength(readings)


def test_a_two_way_contradiction_outranks_a_one_way_one() -> None:
    assert reversal_strength(STALE_READINGS) == (1.00, 1.00)
    assert reversal_strength(TRUE_READINGS) == (0.0, 1.00)


def test_the_reversal_retires_the_entry_it_contradicts_not_the_most_similar_one() -> None:
    """The photo-sync case. The true entry comes first because it is more similar; the correction
    must still retire the stale one."""
    true_first = [_option("runs every six hours", TRUE_READINGS), _option("run it every hour", STALE_READINGS)]
    assert pick_reversal(true_first).match.text == "run it every hour"


def test_one_way_reversals_still_work_when_nothing_reads_both_ways() -> None:
    """The case the change-cue rule was built for must keep working."""
    only = [_option("the rota switches on Fridays", TRUE_READINGS)]
    assert pick_reversal(only).match.text == "the rota switches on Fridays"


def test_ties_keep_similarity_order_so_a_single_option_behaves_as_before() -> None:
    first, second = _option("first", STALE_READINGS), _option("second", STALE_READINGS)
    assert pick_reversal([first, second]).match.text == "first"
    assert pick_reversal([]) is None
