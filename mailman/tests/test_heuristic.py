"""The keyless baseline. Every number the trained model produces gets compared to these."""

from __future__ import annotations

import pytest

from mailman.extractor import ExtractionError
from mailman.extractors import UnknownExtractor, build_extractor
from mailman.heuristic import HeuristicExtractor

INVOICE = """ACME CORP LTD
17 Fleet Street, London

INVOICE

Invoice Number: INV-2026-0042
Invoice Date: 14 August 2026
Due Date: 13/09/2026

Description            Qty   Unit Price     Amount
Widget assembly          2      GBP 100.00    200.00
Freight                  1       25.00         25.00

Subtotal                                      225.00
VAT 20%                                        45.00
Total Due                                     270.00
"""


@pytest.fixture
def extracted():
    return HeuristicExtractor().extract(INVOICE).fields.to_json()


def test_it_finds_the_header_fields(extracted) -> None:
    assert extracted["invoice_number"] == "INV-2026-0042"
    assert extracted["vendor_name"] == "ACME CORP LTD"
    assert extracted["issue_date"] == "2026-08-14"
    assert extracted["due_date"] == "2026-09-13"
    assert extracted["currency"] == "GBP"


def test_it_tells_the_subtotal_from_the_total(extracted) -> None:
    """The mistake this rule exists to avoid, since both lines say a form of "total"."""
    assert extracted["subtotal"] == "225.00"
    assert extracted["tax"] == "45.00"
    assert extracted["total"] == "270.00"


def test_the_word_invoice_is_not_read_as_an_invoice_number() -> None:
    """Regression: `inv` matched inside "INVOICE" and returned "OICE".

    Found by running it on a realistic layout, where a bare INVOICE heading sits above the
    real number. Every test passed before this one existed.
    """
    assert HeuristicExtractor().extract(INVOICE).fields.invoice_number == "INV-2026-0042"


def test_line_items_are_found_and_the_totals_block_is_not(extracted) -> None:
    items = extracted["line_items"]
    assert len(items) == 2
    assert items[0]["description"] == "Widget assembly"
    assert items[0]["quantity"] == "2"
    assert items[0]["unit_price"] == "100.00"
    assert items[0]["amount"] == "200.00"
    assert items[1]["description"] == "Freight"


def test_a_currency_code_is_stripped_from_a_description(extracted) -> None:
    """Removing the amounts leaves "Widget assembly GBP" behind if nothing else is done."""
    assert "GBP" not in extracted["line_items"][0]["description"]


def test_it_returns_nothing_rather_than_guessing() -> None:
    """A null goes to review. A guess goes into the database."""
    with pytest.raises(ExtractionError) as caught:
        HeuristicExtractor().extract("This is not an invoice at all.\nJust some words.")
    assert caught.value.kind == "missing_fields"


def test_the_buyer_is_not_attempted() -> None:
    """Deliberate. There is no rule that finds a buyer reliably, so it stays null."""
    assert HeuristicExtractor().extract(INVOICE).fields.buyer_name is None


def test_the_default_extractor_needs_no_key_and_no_weights() -> None:
    assert isinstance(build_extractor(), HeuristicExtractor)


def test_an_unknown_extractor_is_an_error_not_a_silent_default() -> None:
    with pytest.raises(UnknownExtractor):
        build_extractor("magic")
