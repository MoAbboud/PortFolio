"""The training-set builder's offline parts: the contamination guard and the swap rule.

No network and no dataset download - `build_dataset` imports `datasets` inside the functions that
need it, so the module can be imported and its rules tested without touching Hugging Face.

The contamination test is the one that matters. The benchmark's 261 hand-written facts are this
project's instrument; a model trained on the conversations they came from would be marking its own
homework, and the failure would be invisible in every number afterwards.
"""

from __future__ import annotations

from training.nli.build_dataset import (
    CONTRADICTION,
    ENTAILMENT,
    NEUTRAL,
    benchmark_sentences,
    normalise,
    swap_symmetric,
)
from training.nli.open_items import build as build_open_items


def test_the_benchmark_sentences_are_actually_found() -> None:
    """A guard that silently matched nothing would pass every contamination check."""
    sentences = benchmark_sentences()
    assert len(sentences) > 1_000
    assert any("felixstowe" in s for s in sentences)


def test_no_hand_written_pair_repeats_a_benchmark_sentence() -> None:
    bench = benchmark_sentences()
    for pair in build_open_items():
        assert normalise(pair["a"]) not in bench
        assert normalise(pair["b"]) not in bench


def test_the_hand_written_pairs_cover_every_relation_the_merge_step_needs() -> None:
    shapes = {(p["shape"], p["label"]) for p in build_open_items()}
    assert ("open_item", NEUTRAL) in shapes        # an unfinished item does not replace a claim
    assert ("coexisting", NEUTRAL) in shapes       # two attributes true at once
    assert ("unrelated", NEUTRAL) in shapes
    assert ("restatement", ENTAILMENT) in shapes   # the same claim again
    assert ("changed", CONTRADICTION) in shapes    # this one really does replace it


def test_only_the_symmetric_labels_are_swapped() -> None:
    """Contradiction holds both ways; entailment does not, and swapping it would teach the model that
    a refinement is a duplicate - the distinction the merge step depends on."""
    rows = [
        {"a": "x", "b": "y", "label": ENTAILMENT, "source": "t", "shape": "s"},
        {"a": "x", "b": "y", "label": CONTRADICTION, "source": "t", "shape": "s"},
        {"a": "x", "b": "y", "label": NEUTRAL, "source": "t", "shape": "s"},
    ]
    swapped = swap_symmetric(rows)
    assert {r["label"] for r in swapped} == {CONTRADICTION, NEUTRAL}
    for row in swapped:
        assert (row["a"], row["b"]) == ("y", "x")
        assert row["shape"].endswith("-swapped")
