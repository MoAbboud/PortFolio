"""Listing codes: short, unambiguous on paper, forgiving of how they are typed."""

from __future__ import annotations

from roamer import codes


def test_alphabet_has_nothing_that_misreads_on_paper() -> None:
    for confusable in "01ilo":
        assert confusable not in codes.ALPHABET


def test_new_codes_are_six_characters_from_the_alphabet() -> None:
    for _ in range(200):
        code = codes.new_code()
        assert codes.looks_valid(code), code


def test_a_code_typed_in_capitals_with_spaces_still_matches() -> None:
    assert codes.normalise("  K7M2QA ") == "k7m2qa"


def test_codes_outside_the_alphabet_are_not_valid() -> None:
    assert not codes.looks_valid("k7m2q0")  # zero
    assert not codes.looks_valid("k7m2q")  # too short
    assert not codes.looks_valid("../etc")
