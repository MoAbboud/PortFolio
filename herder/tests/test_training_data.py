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


def test_the_second_run_shapes_are_present() -> None:
    """Added after the first trained model lost a reversal that had a lead-in."""
    shapes = {(p["shape"], p["label"]) for p in build_open_items()}
    assert ("announced_change", CONTRADICTION) in shapes
    assert ("announced_elsewhere", NEUTRAL) in shapes     # a cue is not a verdict
    assert ("announced_same", ENTAILMENT) in shapes       # a cue that lands on the held value agrees


def test_every_announced_pair_carries_the_merge_steps_change_cue() -> None:
    """If a frame did not match `CHANGE_CUE`, herder would never send that shape down the reversal
    path, and training on it would teach a case the merge step never asks about."""
    from herder.domain.merge import announces_change

    announced = [p for p in build_open_items() if p["shape"].startswith("announced")]
    assert announced
    missing = [p["a"] for p in announced if not announces_change(p["a"])]
    assert missing == []


def test_no_announced_pair_opens_the_way_a_benchmark_reversal_does() -> None:
    """The cue vocabulary is ordinary English; the benchmark's own openers are not to be copied.
    Same principle as attempt 3's lead-in test: learn the language, not the answer key's phrasing."""
    import re

    from herder.domain.merge import announces_change

    openers = set()
    for sentence in benchmark_sentences():
        if announces_change(sentence):
            openers.add(re.split(r":|\s-\s", sentence, maxsplit=1)[0].strip())
    assert openers, "found no benchmark reversals - the guard would pass vacuously"

    for pair in build_open_items():
        if pair["shape"].startswith("announced"):
            text = normalise(pair["a"])
            assert not any(text.startswith(opener) for opener in openers), pair["a"]


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
