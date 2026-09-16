"""How an NLI checkpoint's own labels are read. Pure, no model downloaded.

This is the quietest failure in the system. The merge step asks for entailment or contradiction and
acts on the answer; if the label columns were read in the wrong order, herder would merge
contradictions and retire duplicates, confidently, with nothing in any log to show it. So the mapping
is read from the model's config and anything unrecognised is refused rather than guessed.

Stage 10 added the fact-verification names: the checkpoints trained on revised claims - the closest
public analogue to this project's hardest merge case - call the same three labels supports, refutes
and not enough info.
"""

from __future__ import annotations

import pytest

from herder.core.nli import CrossEncoderNli, NliUnavailable
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL


class FakeModel:
    def __init__(self, id2label) -> None:
        self.config = type("Config", (), {"id2label": id2label})()


def labels_of(id2label) -> dict[int, str]:
    return CrossEncoderNli(model=FakeModel(id2label))._labels


def test_standard_nli_names_are_read_in_the_models_own_order() -> None:
    mapping = labels_of({0: "contradiction", 1: "entailment", 2: "neutral"})
    assert mapping == {0: CONTRADICTION, 1: ENTAILMENT, 2: NEUTRAL}


def test_a_different_column_order_is_honoured_not_assumed() -> None:
    """The reason this code exists: checkpoints disagree about the order."""
    mapping = labels_of({0: "entailment", 1: "neutral", 2: "contradiction"})
    assert mapping == {0: ENTAILMENT, 1: NEUTRAL, 2: CONTRADICTION}


def test_fact_verification_names_map_onto_the_three_labels() -> None:
    """supports / refutes / not enough info is the FEVER and VitaminC vocabulary."""
    mapping = labels_of({0: "SUPPORTS", 1: "REFUTES", 2: "NOT ENOUGH INFO"})
    assert mapping == {0: ENTAILMENT, 1: CONTRADICTION, 2: NEUTRAL}


def test_a_binary_head_is_refused() -> None:
    """Entailment / not_entailment cannot express contradiction, so it cannot produce `supersede`.
    Measured at stage 10: a zero-shot checkpoint with this head would have silently ended every
    reversal as `distinct`."""
    with pytest.raises(NliUnavailable, match="does not look like an NLI head"):
        labels_of({0: "entailment", 1: "not_entailment"})


def test_an_unknown_vocabulary_is_refused_rather_than_guessed() -> None:
    with pytest.raises(NliUnavailable, match="does not look like an NLI head"):
        labels_of({0: "yes", 1: "no", 2: "maybe"})


def test_a_model_with_no_labels_at_all_is_refused() -> None:
    with pytest.raises(NliUnavailable, match="no id2label"):
        labels_of({})
