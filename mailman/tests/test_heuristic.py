"""The keyless baseline. Every number the trained model produces gets compared to these."""

from __future__ import annotations

from decimal import Decimal

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
    """The contract is in the name, and the class is an implementation detail.

    The default was `heuristic` and is now `hybrid`, because the corpus comparison scored
    hybrid 92/92 against the heuristic's 82/92 - it is the heuristic's reading with
    `buyer_name` taken from the trained model when weights happen to be present. It is safe
    as a default precisely because it degrades to exactly the heuristic when they are not,
    which is what this test protects: a fresh checkout has no key and no 250MB of weights and
    still has to extract.
    """
    from mailman.hybrid import HybridExtractor

    extractor = build_extractor()
    assert isinstance(extractor, (HeuristicExtractor, HybridExtractor))

    fields = extractor.extract(INVOICE).fields
    assert fields.total == Decimal("270.00")
    assert fields.invoice_number == "INV-2026-0042"


def test_the_heuristic_can_still_be_selected_explicitly() -> None:
    """Rules only, with nothing else in the process. The comparison baseline depends on it."""
    assert isinstance(build_extractor("heuristic"), HeuristicExtractor)


def test_an_unknown_extractor_is_an_error_not_a_silent_default() -> None:
    with pytest.raises(UnknownExtractor):
        build_extractor("magic")


# Regressions found by the stage 3 corpus. All three were live in a build with 87 passing
# tests, because every money fixture written by hand used an amount under a thousand or one
# with a comma in it.

def test_a_bare_amount_over_999_is_visible() -> None:
    r"""The worst of them.

    `\d{1,3}(?:[,.]\d{3})*` requires a separator before any further digits, so "1404.00"
    matched nothing at all - every invoice of a thousand or more written without a comma had
    no total. Which is most of the invoices this system exists for.
    """
    from mailman.heuristic import _money_tokens

    assert _money_tokens("Total Due GBP 1404.00") == ["1404.00"]
    assert _money_tokens("Total Due GBP 29520.00") == ["29520.00"]
    # Grouped forms keep working, in both conventions.
    assert _money_tokens("GBP 1,404.00") == ["1,404.00"]
    assert _money_tokens("EUR 15.000,00") == ["15.000,00"]


def test_a_date_is_not_a_pair_of_amounts() -> None:
    """Two amounts on a line is the rule for a priced row, so a date became a line item."""
    from mailman.heuristic import _money_tokens

    assert _money_tokens("Invoice Date: 03/09/2026") == []
    assert _money_tokens("Due: 2026-08-01") == []


def test_an_identifier_is_not_a_pair_of_amounts() -> None:
    """Introduced by the fix for bare amounts, and caught by the same corpus on the next run.

    Allowing plain digit runs made the parts of INV-2026-0042 visible as amounts, so every
    document grew a phantom line item. A digit group preceded by a hyphen belongs to
    something larger.
    """
    from mailman.heuristic import _money_tokens

    assert _money_tokens("Invoice Number: INV-2026-0042") == []
    assert _money_tokens("Invoice Number: PT-2026-0451") == []


def test_negative_amounts_still_parse_after_that_tightening() -> None:
    """Both conventions, because the lookbehind change could easily have broken them."""
    from mailman.heuristic import _money_tokens

    assert _money_tokens("Discount GBP -46.00") == ["-46.00"]
    assert _money_tokens("Credit 240.00-") == ["240.00-"]
    assert _money_tokens("Returned GBP (100.00)") == ["(100.00)"]


def test_a_currency_code_between_two_amounts_is_not_a_date() -> None:
    """The regression the date mask introduced, and the reason the mask needs month names.

    `\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}` accepted any word as the month, and `\\b` allowed a
    match to start inside a number - so "GBP 30.00 GBP 1020.00" contained "00 GBP 1020",
    which the mask then removed. The four-figure line amount vanished silently on a document
    that still counted the right number of line items and still found the right total.
    """
    from mailman.heuristic import _first_date, _money_tokens

    assert _money_tokens("Reel stock lot 34   34   GBP 30.00   GBP 1020.00") == [
        "34",
        "34",
        "30.00",
        "1020.00",
    ]
    assert _first_date("Reel stock lot 34   34   GBP 30.00   GBP 1020.00") is None


def test_written_dates_in_every_form_the_parser_accepts_are_still_masked() -> None:
    """The other half of that change: narrowing the pattern must not lose a real date.

    One case per format in `parsing._UNAMBIGUOUS_FORMATS`, because a date the mask stops
    recognising becomes a pair of amounts again, which is the phantom line item returning.
    """
    from mailman.heuristic import _first_date, _money_tokens

    for line, expected in (
        ("Invoice Date: 2026-07-02", "2026-07-02"),
        ("Invoice Date: 2026/07/02", "2026/07/02"),
        ("Invoice Date: 03/09/2026", "03/09/2026"),
        ("Invoice Date: 14.08.2026", "14.08.2026"),
        ("Invoice Date: 14 August 2026", "14 August 2026"),
        ("Invoice Date: 14 Aug 2026", "14 Aug 2026"),
        ("Invoice Date: August 14, 2026", "August 14, 2026"),
        ("Invoice Date: Aug 14, 2026", "Aug 14, 2026"),
        ("Invoice Date: 14-Aug-2026", "14-Aug-2026"),
    ):
        assert _first_date(line) == expected, line
        assert _money_tokens(line) == [], line


CREDIT_NOTE = """HARROW AND FINCH
CREDIT NOTE
Credit Note Number: CN-2026-0019
Date: 21 August 2026

Description            Qty   Unit Price     Amount
Returned goods           4     GBP (25.00)  GBP (100.00)

Subtotal                                    GBP (100.00)
VAT 20%                                      GBP (20.00)
Total Due                                   GBP (120.00)
"""


def test_a_credit_note_is_read_as_an_invoice_with_the_signs_reversed() -> None:
    """A scope decision, not a bug fix: credit notes are in scope.

    One arrives in the same post as an invoice, and refusing it means a real document the
    system cannot file. Nothing downstream needs a special case - the arithmetic rules hold
    unchanged, because -100.00 plus -20.00 is still -120.00.
    """
    fields = HeuristicExtractor().extract(CREDIT_NOTE).fields

    assert fields.invoice_number == "CN-2026-0019"
    assert fields.subtotal == Decimal("-100.00")
    assert fields.tax == Decimal("-20.00")
    assert fields.total == Decimal("-120.00")
    assert fields.subtotal + fields.tax == fields.total

    (line,) = fields.line_items
    assert line["quantity"] == Decimal("4")
    assert line["unit_price"] == Decimal("-25.00")
    assert line["amount"] == Decimal("-100.00")


def test_the_words_credit_note_alone_are_not_an_invoice_number() -> None:
    """The heading sits on its own line above the real number, as it does on a real one."""
    from mailman.heuristic import _INVOICE_NUMBER

    assert _INVOICE_NUMBER.search("CREDIT NOTE") is None
    assert _INVOICE_NUMBER.search("Credit Note Number: CN-2026-0019").group(1) == "CN-2026-0019"


# The fifth silent bug. Every label test in `heuristic` was `word in line.lower` - a
# substring search over the whole line - so a description containing one of the six totals
# words was dropped before its amounts were read, and a description containing "tax" became
# the document's tax. Found by probing the extractor with descriptions the corpus did not
# contain, after the corpus itself had come back 9/10 clean.
TOTALS_WORDS_IN_DESCRIPTIONS = """STANWICK SURVEYORS
INVOICE
Invoice Number: SS-2026-0143
Invoice Date: 2026-04-17
Due Date: 2026-05-17

Description               Qty    Unit Price     Amount
Total station hire          3       GBP 90.00   GBP 270.00
Overdue account fee         1       GBP 40.00    GBP 40.00
Tax advisory services       2      GBP 100.00   GBP 200.00
Site survey                 1      GBP 320.00   GBP 320.00

Subtotal                                         GBP 830.00
VAT 20%                                          GBP 166.00
Total Due                                        GBP 996.00
"""


def test_a_description_containing_a_totals_word_is_still_a_line_item() -> None:
    """A total station is a surveying instrument, and "Overdue" contains "due".

    Before the fix this returned one line item of four. It raised nothing and the record
    looked complete: an invoice with a subtotal of 830.00 above a single 320.00 line. That
    is the same shape as the four bugs before it, and the reason the arithmetic rules in
    stage 4 are worth more than any per-field label.
    """
    fields = HeuristicExtractor().extract(TOTALS_WORDS_IN_DESCRIPTIONS).fields

    assert [line["description"] for line in fields.line_items] == [
        "Total station hire",
        "Overdue account fee",
        "Tax advisory services",
        "Site survey",
    ]
    assert sum(line["amount"] for line in fields.line_items) == fields.subtotal


def test_a_priced_row_named_tax_does_not_become_the_documents_tax() -> None:
    """The wrong-number half of the same bug, and the more dangerous half.

    A dropped line item leaves the arithmetic visibly short. "Tax advisory services" put
    200.00 into the tax field, which is a plausible tax on a subtotal of 830.00 and is
    exactly the confidently-wrong answer this system is designed around.
    """
    fields = HeuristicExtractor().extract(TOTALS_WORDS_IN_DESCRIPTIONS).fields

    assert fields.subtotal == Decimal("830.00")
    assert fields.tax == Decimal("166.00")
    assert fields.total == Decimal("996.00")
    assert fields.subtotal + fields.tax == fields.total


def test_the_totals_block_is_still_excluded_from_the_line_items() -> None:
    """The other side of the fix, and the one that could quietly come back.

    Loosening the totals-word test is how a totals row becomes a line item, which would
    inflate every document's line sum instead of shortening it. "VAT 20%" carries two
    amounts - the rate and the tax - so it is the row that a rule keyed on "at least two
    amounts" would let through if the label test stopped catching it.
    """
    fields = HeuristicExtractor().extract(TOTALS_WORDS_IN_DESCRIPTIONS).fields

    descriptions = [line["description"].lower() for line in fields.line_items]
    assert not [text for text in descriptions if text.startswith(("subtotal", "vat", "total due"))]
    assert len(fields.line_items) == 4


def test_label_words_are_matched_as_words_not_as_letters() -> None:
    """The mechanism, asserted directly, because the two tests above could pass by accident."""
    from mailman.heuristic import _Line, _has_label

    def line(text: str) -> _Line:
        return _Line(text, text.lower())

    assert not _has_label(line("Overdue account fee"), ("due",))
    assert _has_label(line("Due Date: 2026-05-17"), ("due",))
    assert not _has_label(line("Duesenberg Motors Ltd"), ("due",))
    assert not _has_label(line("Subtotal"), ("total",))
    assert _has_label(line("Total Due"), ("total",))
