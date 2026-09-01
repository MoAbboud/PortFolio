"""Turning what the document said into values the system can check.

The model returns every amount and date as the string printed on the page. Parsing happens
here, in one place, and it reports *why* it failed rather than returning a zero. That
distinction matters: an amount the system could not read and an amount that really is zero
must never look the same, because one of them is a reason to send a document to review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

_CURRENCY_NOISE = re.compile(r"[^\d,.\-()]")
_TRAILING_MINUS = re.compile(r"^(.*?)-$")


@dataclass(frozen=True)
class ParsedMoney:
    value: Decimal | None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.value is not None


@dataclass(frozen=True)
class ParsedDate:
    value: date | None
    # Which reading was assumed. "iso", "day-first", "month-first", "unambiguous".
    convention: str | None = None
    # True when the same digits would parse to a different real date the other way round.
    ambiguous: bool = False
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.value is not None


def parse_money(raw: str | None) -> ParsedMoney:
    """Parse an amount as printed on a document.

    Handles the separator conventions that actually appear: 1,234.56 and 1.234,56 and
    1 234,56. When both separators are present the *last* one is the decimal separator,
    which is true in every convention and avoids having to know the document's locale.

    Parentheses and a trailing minus both mean negative - credit notes print them both ways.
    """
    if raw is None:
        return ParsedMoney(None, "missing")

    text = raw.strip()
    if not text:
        return ParsedMoney(None, "empty")

    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative = True
        text = text[1:-1]

    cleaned = _CURRENCY_NOISE.sub("", text)

    trailing = _TRAILING_MINUS.match(cleaned)
    if trailing:
        negative = True
        cleaned = trailing.group(1)

    if cleaned.startswith("-"):
        negative = True
        cleaned = cleaned[1:]

    cleaned = cleaned.replace("(", "").replace(")", "")
    if not cleaned:
        return ParsedMoney(None, f"no digits in {raw!r}")

    last_comma = cleaned.rfind(",")
    last_dot = cleaned.rfind(".")

    if last_comma == -1 and last_dot == -1:
        normalised = cleaned
    elif last_comma > last_dot:
        # Comma is the decimal separator; dots are thousands.
        normalised = cleaned.replace(".", "").replace(",", ".")
    else:
        normalised = cleaned.replace(",", "")

    try:
        value = Decimal(normalised)
    except InvalidOperation:
        return ParsedMoney(None, f"not a number: {raw!r}")

    return ParsedMoney(-value if negative else value)


# Formats tried in order. ISO first because it is unambiguous; the ambiguous pair is
# handled separately below rather than by whichever format happens to be listed first.
_UNAMBIGUOUS_FORMATS = (
    ("%Y-%m-%d", "iso"),
    ("%Y/%m/%d", "iso"),
    ("%d %B %Y", "unambiguous"),
    ("%d %b %Y", "unambiguous"),
    ("%B %d, %Y", "unambiguous"),
    ("%b %d, %Y", "unambiguous"),
    ("%d-%b-%Y", "unambiguous"),
)

_NUMERIC = re.compile(r"^\s*(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})\s*$")


def parse_date(raw: str | None, *, day_first: bool = True) -> ParsedDate:
    """Parse a date as printed, and say which reading was assumed.

    `03/04/2026` is two different real dates and the document almost never says which. The
    parser picks one - `day_first` decides - and flags the result as ambiguous, because a
    date that could be read either way is a reason to put the document in front of a person
    rather than a thing to guess quietly.
    """
    if raw is None:
        return ParsedDate(None, error="missing")

    text = raw.strip()
    if not text:
        return ParsedDate(None, error="empty")

    for fmt, convention in _UNAMBIGUOUS_FORMATS:
        try:
            return ParsedDate(datetime.strptime(text, fmt).date(), convention)
        except ValueError:
            continue

    match = _NUMERIC.match(text)
    if not match:
        return ParsedDate(None, error=f"unrecognised date format: {raw!r}")

    first, second, third = (int(part) for part in match.groups())

    if first > 31:  # a four-digit year leading: unambiguous
        year, month, day = first, second, third
        return _build(year, month, day, "iso", ambiguous=False, raw=raw)

    year = third if third > 99 else 2000 + third
    a, b = (first, second) if day_first else (second, first)
    day, month = a, b

    # Ambiguous only if the other reading is also a real date.
    other_valid = _is_real(year, day, month) and month <= 12 and day <= 12
    convention = "day-first" if day_first else "month-first"
    return _build(year, month, day, convention, ambiguous=other_valid, raw=raw)


def _is_real(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
    except ValueError:
        return False
    return True


def _build(
    year: int, month: int, day: int, convention: str, *, ambiguous: bool, raw: str
) -> ParsedDate:
    try:
        return ParsedDate(date(year, month, day), convention, ambiguous=ambiguous)
    except ValueError:
        return ParsedDate(None, convention, error=f"not a real date: {raw!r}")
