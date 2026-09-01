"""The invoice shape.

One definition, used three ways: it is the structured output schema sent to the model, the
target the response is parsed into, and the thing the validation rules and the harness both
read. Three uses, one definition, so they cannot drift.

Every amount and date is a **string** on the wire - the characters as printed on the
document. Two reasons, and both matter:

1. A float in JSON is how money silently loses a cent. Strings cross the boundary intact.
2. "the system could not read this amount" and "this amount is zero" have to be
   distinguishable. A model forced to emit a number has to invent one; a model returning
   the printed characters lets the parser fail honestly, and a field that failed to parse
   is one of the signals that sends a document to review.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, Field

from mailman import parsing


class LineItemRead(BaseModel):
    """One line as printed."""

    line_no: int = Field(description="1-based position of this line on the document")
    description: str | None = Field(description="The line description, as printed")
    quantity: str | None = Field(description="Quantity as printed, or null if absent")
    unit_price: str | None = Field(description="Unit price as printed, or null if absent")
    amount: str | None = Field(description="Line total as printed, or null if absent")


class InvoiceRead(BaseModel):
    """An invoice as the model read it. Nothing here has been interpreted yet."""

    invoice_number: str | None = Field(description="The invoice number, as printed")
    vendor_name: str | None = Field(description="Who issued the invoice")
    buyer_name: str | None = Field(description="Who the invoice is addressed to")
    issue_date: str | None = Field(description="Issue date exactly as printed, not reformatted")
    due_date: str | None = Field(description="Due date exactly as printed, or null")
    currency: str | None = Field(description="Three-letter currency code, e.g. GBP, USD, EUR")
    subtotal: str | None = Field(description="Subtotal as printed")
    tax: str | None = Field(description="Tax or VAT total as printed")
    total: str | None = Field(description="Grand total as printed")
    line_items: list[LineItemRead] = Field(description="Every line item, in document order")
    confidence: float = Field(
        description="How confident you are overall, 0.0 to 1.0",
        ge=0.0,
        le=1.0,
    )
    unreadable: list[str] = Field(
        description="Names of fields you could not read from the document at all"
    )


# Fields a record cannot be filed without. Everything else may legitimately be absent.
REQUIRED_FIELDS: tuple[str, ...] = ("invoice_number", "vendor_name", "total", "currency")


class InvoiceFields:
    """The parsed view of an InvoiceRead: real Decimals, real dates, and what failed.

    Deliberately not a Pydantic model. Its job is to carry both the value and the reason a
    value is missing, and a validation model that raises on bad input cannot do that - the
    bad input is the thing worth keeping.
    """

    def __init__(self, read: InvoiceRead) -> None:
        self.read = read
        self.problems: dict[str, str] = {}

        self.invoice_number = (read.invoice_number or "").strip() or None
        self.vendor_name = (read.vendor_name or "").strip() or None
        self.buyer_name = (read.buyer_name or "").strip() or None
        self.currency = (read.currency or "").strip().upper() or None

        self.subtotal = self._money("subtotal", read.subtotal)
        self.tax = self._money("tax", read.tax)
        self.total = self._money("total", read.total)

        issue = parsing.parse_date(read.issue_date)
        due = parsing.parse_date(read.due_date)
        self.issue_date = issue.value
        self.due_date = due.value
        self.date_conventions = {"issue_date": issue.convention, "due_date": due.convention}
        self.ambiguous_dates = [
            name
            for name, parsed in (("issue_date", issue), ("due_date", due))
            if parsed.ambiguous
        ]
        if read.issue_date and issue.error:
            self.problems["issue_date"] = issue.error

        self.line_items: list[dict[str, Any]] = []
        for item in read.line_items:
            self.line_items.append(
                {
                    "line_no": item.line_no,
                    "description": item.description,
                    "quantity": self._money(f"line_items[{item.line_no}].quantity", item.quantity),
                    "unit_price": self._money(f"line_items[{item.line_no}].unit_price", item.unit_price),
                    "amount": self._money(f"line_items[{item.line_no}].amount", item.amount),
                }
            )

    def _money(self, field: str, raw: str | None) -> Decimal | None:
        if raw is None:
            return None
        parsed = parsing.parse_money(raw)
        if not parsed.ok:
            # Recorded rather than raised. An unparseable amount is a fact about the
            # document, and it is one of the reasons a document goes to a person.
            self.problems[field] = parsed.error or "unparseable"
        return parsed.value

    @property
    def missing_required(self) -> list[str]:
        return [name for name in REQUIRED_FIELDS if getattr(self, name, None) is None]

    def to_json(self) -> dict[str, Any]:
        """The stored form. Amounts are strings so no float ever appears in the record."""

        def money(value: Decimal | None) -> str | None:
            return None if value is None else str(value)

        return {
            "invoice_number": self.invoice_number,
            "vendor_name": self.vendor_name,
            "buyer_name": self.buyer_name,
            "issue_date": self.issue_date.isoformat() if self.issue_date else None,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "currency": self.currency,
            "subtotal": money(self.subtotal),
            "tax": money(self.tax),
            "total": money(self.total),
            "line_items": [
                {
                    "line_no": item["line_no"],
                    "description": item["description"],
                    "quantity": money(item["quantity"]),
                    "unit_price": money(item["unit_price"]),
                    "amount": money(item["amount"]),
                }
                for item in self.line_items
            ],
            "model_confidence": self.read.confidence,
            "model_says_unreadable": self.read.unreadable,
            "parse_problems": self.problems,
            "ambiguous_dates": self.ambiguous_dates,
            "date_conventions": self.date_conventions,
            "missing_required": self.missing_required,
        }
