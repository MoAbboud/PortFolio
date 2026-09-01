"""Money and dates: the two places extraction actually goes wrong."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from mailman.parsing import parse_date, parse_money


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("1,234.56", Decimal("1234.56")),
        ("1.234,56", Decimal("1234.56")),   # European separators
        ("1 234,56", Decimal("1234.56")),
        ("$1,234.56", Decimal("1234.56")),
        ("EUR 99", Decimal("99")),
        ("240.00", Decimal("240.00")),
        ("(240.00)", Decimal("-240.00")),   # accountants' negative
        ("240.00-", Decimal("-240.00")),    # trailing minus
        ("-12.5", Decimal("-12.5")),
    ],
)
def test_amounts_printed_the_way_documents_print_them(raw, expected) -> None:
    assert parse_money(raw).value == expected


@pytest.mark.parametrize("raw", ["", "  ", "abc", None])
def test_an_unreadable_amount_is_an_error_not_a_zero(raw) -> None:
    """The distinction this whole parser exists for."""
    parsed = parse_money(raw)
    assert parsed.value is None
    assert parsed.error


def test_when_both_separators_appear_the_last_one_is_the_decimal() -> None:
    """True in every convention, so the locale never has to be known."""
    assert parse_money("1.234.567,89").value == Decimal("1234567.89")
    assert parse_money("1,234,567.89").value == Decimal("1234567.89")


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("2026-08-14", date(2026, 8, 14)),
        ("2026/08/14", date(2026, 8, 14)),
        ("14 August 2026", date(2026, 8, 14)),
        ("Aug 14, 2026", date(2026, 8, 14)),
        ("14-Aug-2026", date(2026, 8, 14)),
    ],
)
def test_unambiguous_dates(raw, expected) -> None:
    parsed = parse_date(raw)
    assert parsed.value == expected
    assert not parsed.ambiguous


def test_an_ambiguous_date_is_parsed_and_flagged() -> None:
    """03/04/2026 is two real dates and the document does not say which."""
    parsed = parse_date("03/04/2026")
    assert parsed.value == date(2026, 4, 3)
    assert parsed.convention == "day-first"
    assert parsed.ambiguous


def test_a_date_that_can_only_be_read_one_way_is_not_flagged() -> None:
    parsed = parse_date("13/04/2026")
    assert parsed.value == date(2026, 4, 13)
    assert not parsed.ambiguous


def test_the_convention_can_be_switched() -> None:
    assert parse_date("03/04/2026", day_first=False).value == date(2026, 3, 4)


@pytest.mark.parametrize("raw", ["31/02/2026", "nope", "", None])
def test_an_unreadable_date_is_an_error(raw) -> None:
    parsed = parse_date(raw)
    assert parsed.value is None
    assert parsed.error
