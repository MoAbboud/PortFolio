"""Token counting.

An estimator, and consistently the same estimator. The property that matters is that it
never quietly becomes a different ruler - a fallback approximation would corrupt every
budget and compression ratio measured against the first one.
"""

from __future__ import annotations

from herder.core.tokens import ENCODING, count_tokens


def test_counts_something_sensible() -> None:
    assert count_tokens("hello world") > 0
    assert count_tokens("") == 0


def test_is_deterministic() -> None:
    text = "The brief is a token-budgeted rendering of active entries."
    assert count_tokens(text) == count_tokens(text)


def test_longer_text_costs_more() -> None:
    assert count_tokens("one two three four five") > count_tokens("one two")


def test_special_tokens_are_not_special() -> None:
    """A conversation can contain anything, including strings that look like control tokens.

    Counting must not raise on them - `disallowed_special=()` is what stops that, and this
    test is why it is there.
    """
    assert count_tokens("<|endoftext|> is just text here") > 0


def test_the_ruler_is_named_and_fixed() -> None:
    assert ENCODING == "cl100k_base"
