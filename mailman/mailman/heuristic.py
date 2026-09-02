"""Extraction with no model at all: regular expressions and layout rules.

This is the baseline. It costs nothing, needs no key, no GPU and no weights, so it is the
extractor the system runs by default and the one that is actually deployable. It is also
the number every later approach has to beat - a trained model that cannot beat keyword
matching on invoices is not worth the weights it takes up.

It is deliberately unclever. Where an invoice is ambiguous it returns null rather than
guessing, because a null goes to review and a guess goes into the database.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from functools import lru_cache

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields, InvoiceRead, LineItemRead

PROMPT_VERSION = "heuristic-v1"

# Two alternatives, and the second one is the fix. `\d{1,3}(?:[,.]\d{3})*` alone requires a
# separator before any further digits, so "1404.00" matched nothing at all - every amount of
# a thousand or more written without a comma was invisible to the extractor. Found by the
# stage 3 corpus on its second document; 87 tests had missed it because every fixture used
# an amount under a thousand or one with a comma in it.
#
#   grouped:   1,404  or  1.404  (a separator every three digits)
#   ungrouped: 1404   or  270    (a plain run of digits)
_MONEY = re.compile(
    # The hyphen in the lookbehind matters. Allowing bare digit runs (the fix above)
    # made the parts of an identifier visible as amounts: INV-2026-0042 offered up
    # "2026" and "0042", two amounts on a line is the rule for a priced row, and every
    # document grew a phantom line item. A digit group preceded by a hyphen belongs to
    # something larger. A genuine negative is still matched, because the match starts at
    # the minus sign and the lookbehind sees the space before it.
    r"(?<![\w.\-])"
    r"(?:[$£€]\s?)?"
    r"\(?-?(?:\d{1,3}(?:[,.]\d{3})+|\d+)(?:[.,]\d{2})?\)?-?"
    r"(?![\w])"
)

# The word in a written date has to be a month. `[A-Za-z]{3,9}` was any word at all, and
# `\b` let a match start inside a number, so "GBP 30.00 GBP 1020.00" contained "00 GBP 1020"
# - a date, by that pattern. Dates are masked out before amounts are looked for, so the
# 1020.00 then became invisible: a wrong line amount on a document that otherwise extracted
# cleanly. Found by summing the corpus line items against their own subtotal rather than
# counting them, which is the check the earlier corpus run did not make.
_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"

_DATE = re.compile(
    # Not `\b`. There is a word boundary between the "." and the "00" of "30.00", which is
    # exactly how a match came to start in the middle of an amount.
    r"(?<![\w.])("
    r"\d{4}[-/]\d{1,2}[-/]\d{1,2}"
    r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"
    r"|\d{1,2}\s+" + _MONTH + r"\s+\d{4}"
    r"|" + _MONTH + r"\s+\d{1,2},\s*\d{4}"
    r"|\d{1,2}-" + _MONTH + r"-\d{4}"
    r")(?![\w])",
    re.IGNORECASE,
)

# `inv\b` rather than `inv` so the word INVOICE cannot match its own first three letters
# and hand back "OICE" as the invoice number. Found by running it on a realistic layout,
# where a bare "INVOICE" heading sits on its own line above the real number.
#
# "credit note" is here because credit notes are in scope: a credit note is an invoice with
# the signs reversed, it arrives in the same post, and refusing one means a real document
# the system cannot file. The arithmetic rules handle it unchanged - a subtotal of -100.00
# plus tax of -20.00 still has to equal a total of -120.00. It comes first in the
# alternation so that "Credit Note Number" is not read by the `invoice` branch.
_INVOICE_NUMBER = re.compile(
    r"(?:credit\s+note|invoice|inv\b)"
    r"\s*(?:number|no\.?|num|#)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,})",
    re.IGNORECASE,
)

# Left behind once the amounts are stripped out of a line: "Widget GBP" rather than "Widget".
# Currency codes are stripped from a line description by token, not by regex.
_CURRENCY_CODES = frozenset(
    {"GBP", "USD", "EUR", "CAD", "AUD", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN"}
)

_CURRENCY_CODE = re.compile(r"\b(GBP|USD|EUR|CAD|AUD|CHF|JPY|SEK|NOK|DKK|PLN)\b")
_SYMBOL_TO_CODE = {"\u00a3": "GBP", "$": "USD", "\u20ac": "EUR"}

_NOT_A_NAME = re.compile(
    r"\b(?:invoice|receipt|bill|statement|date|due|total|subtotal|tax|vat|page|"
    r"description|quantity|amount|price|qty|terms|number)\b",
    re.IGNORECASE,
)

_TOTALS_WORDS = ("total", "subtotal", "tax", "vat", "balance", "due")


@dataclass(frozen=True)
class _Line:
    text: str
    lower: str


@lru_cache(maxsize=None)
def _label_pattern(labels: tuple[str, ...]) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(re.escape(word) for word in labels) + r")\b")


def _has_label(line: _Line, labels: tuple[str, ...]) -> bool:
    """Does this line carry one of these label words, as a word rather than as letters.

    Every label test in this module used `word in line.lower`, which is a substring search
    over the whole line. "Overdue account fee" contains "due", so it was read as a totals
    row and dropped before its amounts were looked at; "Duesenberg Motors" is not a vendor
    name for the same reason. The bug is silent in the way all four before it were - no
    exception, and a record that looks complete with three quarters of the invoice missing.
    """
    return _label_pattern(labels).search(line.lower) is not None


def _money_tokens(text: str) -> list[str]:
    """Amounts on a line, with dates masked out first.

    A slash or dashed date is several small numbers to a money pattern - "03/09/2026" reads
    as 03 and 09 - and two amounts on a line is the rule for "this is a priced row", so a
    date line became a phantom line item. Masking dates before looking for money is cheaper
    and more honest than trying to teach the money pattern what a date looks like.
    """
    return [m.group(0).strip() for m in _MONEY.finditer(_DATE.sub(" ", text))]


def _last_money(text: str) -> str | None:
    tokens = _money_tokens(text)
    return tokens[-1] if tokens else None


def _first_date(text: str) -> str | None:
    match = _DATE.search(text)
    return match.group(1) if match else None


class HeuristicExtractor:
    """Satisfies the same Extractor protocol as any model-backed extractor.

    That swapping one for the other is a constructor argument and nothing else is the whole
    point of having had a protocol there from the start.
    """

    model_name = "heuristic"
    prompt_version = PROMPT_VERSION

    def extract(self, document_text: str):
        # Imported inside the method so this module carries no dependency on the
        # provider-backed path, which is the one that needs a key.
        from mailman.extractor import ExtractionError, ExtractionResult

        started = time.monotonic()
        lines = [
            _Line(raw.strip(), raw.strip().lower())
            for raw in document_text.splitlines()
            if raw.strip()
        ]

        read = InvoiceRead(
            invoice_number=self._invoice_number(lines),
            vendor_name=self._vendor_name(lines),
            buyer_name=None,  # Not attempted. A guess here would be worse than a null.
            issue_date=self._issue_date(lines),
            due_date=self._labelled_date(lines, ("due",)),
            currency=self._currency(document_text),
            subtotal=self._labelled_amount(lines, ("subtotal", "sub total", "net")),
            tax=self._labelled_amount(lines, ("tax", "vat", "gst")),
            total=self._total(lines),
            line_items=self._line_items(lines),
            confidence=0.0,
            unreadable=[],
        )

        found = [name for name in REQUIRED_FIELDS if getattr(read, name, None)]
        # Simply how much of the required set it managed to find. Not a probability, and
        # not presented as one.
        read.confidence = round(len(found) / len(REQUIRED_FIELDS), 4)
        read.unreadable = [name for name in REQUIRED_FIELDS if not getattr(read, name, None)]

        fields = InvoiceFields(read)
        latency_ms = int((time.monotonic() - started) * 1000)

        if fields.missing_required:
            raise ExtractionError(
                "missing_fields",
                "required field(s) not found: " + ", ".join(fields.missing_required),
                raw={"extractor": "heuristic", "read": read.model_dump()},
            )

        return ExtractionResult(
            fields=fields,
            raw_response={"extractor": "heuristic", "read": read.model_dump()},
            model_name=self.model_name,
            prompt_version=self.prompt_version,
            latency_ms=latency_ms,
            token_count=0,
        )

    def _invoice_number(self, lines: list[_Line]) -> str | None:
        for line in lines:
            match = _INVOICE_NUMBER.search(line.text)
            if match:
                candidate = match.group(1).strip(".,;:")
                # A bare date after the word "invoice" is a date, not a number.
                if _DATE.fullmatch(candidate):
                    continue
                return candidate
        return None

    def _vendor_name(self, lines: list[_Line]) -> str | None:
        """The first line that looks like a name rather than a label.

        Crude on purpose. Invoices put the issuer at the top far more often than not, and
        anything more elaborate here is guesswork dressed up as a rule.
        """
        for line in lines[:6]:
            if _NOT_A_NAME.search(line.text):
                continue
            if _money_tokens(line.text) or _DATE.search(line.text):
                continue
            if len(line.text) < 3 or len(line.text) > 60:
                continue
            return line.text
        return None

    def _issue_date(self, lines: list[_Line]) -> str | None:
        labelled = self._labelled_date(lines, ("invoice date", "date of issue", "issued"))
        if labelled:
            return labelled
        for line in lines:
            if _has_label(line, ("date",)) and not _has_label(line, ("due",)):
                found = _first_date(line.text)
                if found:
                    return found
        # Last resort: the first date anywhere on the document.
        for line in lines:
            found = _first_date(line.text)
            if found:
                return found
        return None

    def _labelled_date(self, lines: list[_Line], labels: tuple[str, ...]) -> str | None:
        for line in lines:
            if _has_label(line, labels):
                found = _first_date(line.text)
                if found:
                    return found
        return None

    def _labelled_amount(self, lines: list[_Line], labels: tuple[str, ...]) -> str | None:
        for line in lines:
            if not _has_label(line, labels):
                continue
            # A line with three amounts is a priced row, whatever its description says.
            # Without this, "Tax advisory services  2  GBP 100.00  GBP 200.00" is the first
            # line matching "tax" and the document's tax becomes 200.00 instead of 166.00 -
            # a wrong number rather than a missing one, and one that still looks like tax.
            if len(_money_tokens(line.text)) >= 3:
                continue
            is_subtotal_line = _has_label(line, ("subtotal", "sub total", "net"))
            if _has_label(line, ("total",)) and not is_subtotal_line:
                continue
            amount = _last_money(line.text)
            if amount:
                return amount
        return None

    def _total(self, lines: list[_Line]) -> str | None:
        # The most specific label wins, so a subtotal is never mistaken for the total.
        for labels in (("grand total", "amount due", "total due", "balance due"), ("total",)):
            for line in reversed(lines):
                if not _has_label(line, labels):
                    continue
                if _has_label(line, ("subtotal", "sub total")):
                    continue
                if len(_money_tokens(line.text)) >= 3:
                    continue
                amount = _last_money(line.text)
                if amount:
                    return amount
        return None

    def _currency(self, text: str) -> str | None:
        code = _CURRENCY_CODE.search(text)
        if code:
            return code.group(1)
        for symbol, mapped in _SYMBOL_TO_CODE.items():
            if symbol in text:
                return mapped
        return None

    def _line_items(self, lines: list[_Line]) -> list[LineItemRead]:
        """Lines carrying at least two amounts, which is what a priced row looks like.

        Totals blocks are excluded by label. This misses wrapped descriptions and tables
        that continue across a page break, and those misses are what the harness is for.
        """
        items: list[LineItemRead] = []
        for line in lines:
            amounts = _money_tokens(line.text)
            if len(amounts) < 2:
                continue
            # The totals words only disqualify a line that is shaped like a totals row.
            # A totals row carries a label and one number, or two when the rate is printed
            # beside it ("VAT 20%   GBP 45.00"); a priced row carries three - quantity,
            # unit price, amount. Keying off the shape rather than the wording is what lets
            # "Total station hire  3  GBP 90.00  GBP 270.00" through, and a total station
            # is a real surveying instrument that really does get hired by the day.
            if len(amounts) < 3 and _has_label(line, _TOTALS_WORDS):
                continue
            description = _MONEY.sub("", line.text)
            # Stripping the amounts leaves the currency code behind: "Widget GBP".
            description = "".join(
                ch for ch in description if ch not in _SYMBOL_TO_CODE
            )
            description = " ".join(
                word for word in description.split() if word.upper() not in _CURRENCY_CODES
            )
            description = " ".join(description.split()).strip(" .:-")
            if not description:
                continue
            items.append(
                LineItemRead(
                    line_no=len(items) + 1,
                    description=description,
                    quantity=amounts[0] if len(amounts) >= 3 else None,
                    unit_price=amounts[-2],
                    amount=amounts[-1],
                )
            )
        return items
