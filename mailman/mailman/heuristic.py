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

from mailman.invoice import REQUIRED_FIELDS, InvoiceFields, InvoiceRead, LineItemRead

PROMPT_VERSION = "heuristic-v1"

_MONEY = re.compile(
    r"(?<![\w.])"
    r"(?:[$\u00a3\u20ac]\s?)?"
    r"\(?-?\d{1,3}(?:[ ,.]\d{3})*(?:[.,]\d{2})?\)?-?"
    r"(?![\w])"
)

_DATE = re.compile(
    r"\b("
    r"\d{4}[-/]\d{1,2}[-/]\d{1,2}"
    r"|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}"
    r"|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}"
    r"|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4}"
    r"|\d{1,2}-[A-Za-z]{3}-\d{4}"
    r")\b"
)

# `inv\b` rather than `inv` so the word INVOICE cannot match its own first three letters
# and hand back "OICE" as the invoice number. Found by running it on a realistic layout,
# where a bare "INVOICE" heading sits on its own line above the real number.
_INVOICE_NUMBER = re.compile(
    r"(?:invoice|inv\b)\s*(?:number|no\.?|num|#)?\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-_/]{2,})",
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
    r"invoice|receipt|bill|statement|date|due|total|subtotal|tax|vat|page|"
    r"description|quantity|amount|price|qty|terms|number",
    re.IGNORECASE,
)

_TOTALS_WORDS = ("total", "subtotal", "tax", "vat", "balance", "due")


@dataclass(frozen=True)
class _Line:
    text: str
    lower: str


def _money_tokens(text: str) -> list[str]:
    return [m.group(0).strip() for m in _MONEY.finditer(text)]


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
            if "date" in line.lower and "due" not in line.lower:
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
            if any(label in line.lower for label in labels):
                found = _first_date(line.text)
                if found:
                    return found
        return None

    def _labelled_amount(self, lines: list[_Line], labels: tuple[str, ...]) -> str | None:
        for line in lines:
            if not any(label in line.lower for label in labels):
                continue
            is_subtotal_line = any(
                word in line.lower for word in ("subtotal", "sub total", "net")
            )
            if "total" in line.lower and not is_subtotal_line:
                continue
            amount = _last_money(line.text)
            if amount:
                return amount
        return None

    def _total(self, lines: list[_Line]) -> str | None:
        # The most specific label wins, so a subtotal is never mistaken for the total.
        for labels in (("grand total", "amount due", "total due", "balance due"), ("total",)):
            for line in reversed(lines):
                if not any(label in line.lower for label in labels):
                    continue
                if "subtotal" in line.lower or "sub total" in line.lower:
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
            if any(word in line.lower for word in _TOTALS_WORDS):
                continue
            amounts = _money_tokens(line.text)
            if len(amounts) < 2:
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
