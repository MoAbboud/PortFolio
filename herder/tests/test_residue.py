"""Which user sentences the residue offers, and which it must refuse. Pure.

The refusals are the important half. The residue exists to spend leftover budget on material
extraction missed, and the way that goes wrong is by quietly re-admitting a claim the merge step
or the user had already taken out - which would undo the one thing herder does that no other
method in the benchmark does.
"""

from __future__ import annotations

from herder.domain.residue import MIN_RESIDUE_CHARS, ResidueSentence, uncovered


def sentences(*texts: str) -> list[ResidueSentence]:
    return [ResidueSentence(text=t) for t in texts]


def texts(result) -> list[str]:
    return [r.text for r in result]


def test_a_sentence_no_entry_carries_is_offered():
    result = uncovered(sentences("We roast about 400 kg of coffee a month."), ["A different claim entirely."])
    assert texts(result) == ["We roast about 400 kg of coffee a month."]


def test_a_sentence_an_entry_already_carries_is_not_repeated():
    result = uncovered(sentences("The thesis is due in May."), ["The thesis is due in May."])
    assert result == []


def test_a_superseded_claim_does_not_come_back_as_residue():
    """The merge step replaced it. Re-admitting the raw sentence would serve the stale claim
    beside its correction, which is the failure the change-cue rule exists to prevent."""
    merged = "Revising the fit-out budget: capped at 85,000 now. Previously: The fit-out budget is capped at 120,000."
    result = uncovered(sentences("The fit-out budget is capped at 120,000."), [merged])
    assert result == []


def test_a_removed_entry_is_not_resurrected_by_the_residue():
    """merge.py's hard rule: a claim the user removed never comes back. The caller passes the
    texts of entries of every status precisely so this holds."""
    result = uncovered(sentences("Reorder suggestions go to Marisol only."), ["Reorder suggestions go to Marisol only."])
    assert result == []


def test_matching_ignores_case_and_whitespace():
    result = uncovered(sentences("  We   use  Postgres.  "), ["we use postgres."])
    assert result == []


def test_the_same_sentence_said_twice_is_offered_once():
    result = uncovered(sentences("No franchising.", "No franchising."), [])
    assert texts(result) == ["No franchising."]


def test_acknowledgement_noise_is_below_the_floor():
    result = uncovered(sentences("ok", "sure", "yes"), [])
    assert result == []


def test_a_short_prohibition_clears_the_floor():
    """"No franchising." is fifteen characters and a whole constraint. The floor is lower than
    the extractor's twenty for exactly this case."""
    assert len("No franchising.") >= MIN_RESIDUE_CHARS
    assert texts(uncovered(sentences("No franchising."), [])) == ["No franchising."]


def test_order_is_preserved_oldest_first():
    result = uncovered(sentences("first sentence here", "second sentence here", "third sentence here"), [])
    assert texts(result) == ["first sentence here", "second sentence here", "third sentence here"]


def test_an_empty_entry_text_suppresses_nothing():
    result = uncovered(sentences("a real sentence here"), ["", "   "])
    assert texts(result) == ["a real sentence here"]


def test_a_question_is_not_memory():
    """Found on the residue's first real output: half of what it offered was the user asking the
    assistant something, which tells a later model what was asked rather than what was settled."""
    result = uncovered(sentences(
        "What usually goes wrong with the lease?",
        "Can you walk me through the numbers?",
        "We roast about 400 kg of coffee a month.",
    ), [])
    assert texts(result) == ["We roast about 400 kg of coffee a month."]


def test_the_question_filter_is_the_question_mark_not_a_phrasing():
    """A sentence that opens with a question word but states something is kept. The benchmark's
    generator has house phrasings and no rule here may key on them - the same standard
    `test_heuristic.py` enforces for the extractor."""
    kept = "How the rota works is written up in the handover doc."
    assert texts(uncovered(sentences(kept), [])) == [kept]
