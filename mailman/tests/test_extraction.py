"""Extraction, and the four ways it fails.

No provider is called. A fake extractor stands in, because what is being tested here is the
pipeline's handling of each outcome - which row gets written, which status the document
lands in - and that is exactly the part a real API call would make slow, costly and flaky.
"""

from __future__ import annotations

import pytest

from mailman import status as st, storage
from mailman.extractor import ExtractionError, ExtractionResult
from mailman.invoice import InvoiceFields, InvoiceRead
from mailman.models import Extraction
from mailman.pipeline import extract_document
from mailman.ingest import ingest


def an_invoice(**overrides) -> InvoiceRead:
    data = {
        "invoice_number": "INV-2026-0042",
        "vendor_name": "Acme Corp.",
        "buyer_name": "Buyer Ltd",
        "issue_date": "2026-08-14",
        "due_date": "2026-09-13",
        "currency": "GBP",
        "subtotal": "200.00",
        "tax": "40.00",
        "total": "240.00",
        "line_items": [
            {"line_no": 1, "description": "Widget", "quantity": "2", "unit_price": "100.00", "amount": "200.00"}
        ],
        "confidence": 0.9,
        "unreadable": [],
    }
    data.update(overrides)
    return InvoiceRead.model_validate(data)


class FakeExtractor:
    """Returns whatever it was constructed with, or raises whatever it was given."""

    model_name = "fake-model"
    prompt_version = "v0-test"

    def __init__(self, *, read: InvoiceRead | None = None, error: ExtractionError | None = None):
        self._read = read
        self._error = error
        self.calls = 0

    def extract(self, document_text: str) -> ExtractionResult:
        self.calls += 1
        if self._error is not None:
            raise self._error
        return ExtractionResult(
            fields=InvoiceFields(self._read or an_invoice()),
            raw_response={"stub": True},
            model_name=self.model_name,
            prompt_version=self.prompt_version,
            latency_ms=1234,
            token_count=567,
        )


def a_received_document(db_session, tmp_path, pdf_with_text):
    store = storage.LocalDocumentStore(tmp_path)
    document = ingest(
        db_session, store, filename="inv.pdf", data=pdf_with_text, max_bytes=10_000_000
    )
    assert document.status == st.RECEIVED
    return document, store


def test_a_good_extraction_lands_at_extracted(db_session, tmp_path, pdf_with_text) -> None:
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    extraction = extract_document(db_session, store, FakeExtractor(), document.id)

    db_session.refresh(document)
    assert document.status == st.EXTRACTED
    assert extraction.extracted_data["invoice_number"] == "INV-2026-0042"
    assert extraction.extracted_data["total"] == "240.00"
    assert extraction.error is None

    # Recorded from the first extraction, because they cannot be backfilled.
    assert extraction.latency_ms == 1234
    assert extraction.token_count == 567
    assert extraction.model_name == "fake-model"
    assert extraction.prompt_version == "v0-test"


def test_amounts_are_stored_as_strings_never_floats(db_session, tmp_path, pdf_with_text) -> None:
    """A float in the record is how money loses a cent."""
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    extraction = extract_document(db_session, store, FakeExtractor(), document.id)

    for key in ("subtotal", "tax", "total"):
        assert isinstance(extraction.extracted_data[key], str)
    for item in extraction.extracted_data["line_items"]:
        assert isinstance(item["amount"], str)


@pytest.mark.parametrize(
    "kind",
    ["malformed", "missing_fields", "refused", "unavailable"],
)
def test_every_failure_writes_a_row_and_fails_the_document(
    db_session, tmp_path, pdf_with_text, kind
) -> None:
    """Throwing failures away would remove the record of how often the model fails."""
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    error = ExtractionError(kind, f"simulated {kind}", raw={"evidence": kind}, attempts=2)

    extraction = extract_document(db_session, store, FakeExtractor(error=error), document.id)

    db_session.refresh(document)
    assert document.status == st.FAILED
    assert extraction.extracted_data is None
    assert extraction.error.startswith(kind)
    assert extraction.raw_response == {"evidence": kind}
    assert extraction.attempts == 2
    assert kind in document.status_history[-1]["detail"]


def test_a_document_is_not_extracted_twice(db_session, tmp_path, pdf_with_text) -> None:
    """The guard is the status, so a duplicate background task cannot double-spend."""
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    extractor = FakeExtractor()

    extract_document(db_session, store, extractor, document.id)
    second = extract_document(db_session, store, extractor, document.id)

    assert second is None
    assert extractor.calls == 1
    assert db_session.query(Extraction).filter_by(document_id=document.id).count() == 1


def test_an_unparseable_amount_is_recorded_not_zeroed(db_session, tmp_path, pdf_with_text) -> None:
    """"could not read this" and "this is zero" must never look the same."""
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    read = an_invoice(subtotal="two hundred pounds")

    extraction = extract_document(db_session, store, FakeExtractor(read=read), document.id)

    assert extraction.extracted_data["subtotal"] is None
    assert "subtotal" in extraction.extracted_data["parse_problems"]


def test_an_ambiguous_date_is_flagged(db_session, tmp_path, pdf_with_text) -> None:
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    read = an_invoice(issue_date="03/04/2026")

    extraction = extract_document(db_session, store, FakeExtractor(read=read), document.id)

    assert "issue_date" in extraction.extracted_data["ambiguous_dates"]


def test_missing_required_fields_are_named(db_session, tmp_path, pdf_with_text) -> None:
    read = an_invoice(invoice_number=None, total=None)
    fields = InvoiceFields(read)
    assert fields.missing_required == ["invoice_number", "total"]


class ExplodingExtractor:
    """Raises something the pipeline was never told about."""

    model_name = "exploding"
    prompt_version = "v0-test"

    def extract(self, document_text: str) -> ExtractionResult:
        raise TypeError("something nobody anticipated")


def test_an_unexpected_exception_cannot_strand_a_document(
    db_session, tmp_path, pdf_with_text
) -> None:
    """The hole this closes was real.

    With no API key the SDK raises TypeError at client construction. That was not one of the
    handled exceptions, so the background task died after the move to `extracting` and the
    document sat there forever - a state nothing could move it out of and no operator could
    explain. Any exception now produces a row, a reason and a terminal status.
    """
    document, store = a_received_document(db_session, tmp_path, pdf_with_text)

    extraction = extract_document(db_session, store, ExplodingExtractor(), document.id)

    db_session.refresh(document)
    assert document.status == st.FAILED, "a document must never be left in extracting"
    assert extraction.error.startswith("internal: TypeError")
    assert document.processed_at is not None


def test_a_missing_api_key_says_so(db_session, tmp_path, pdf_with_text) -> None:
    """A configuration problem should read as one, not as a bug in this code."""
    from mailman.extractor import AnthropicExtractor

    document, store = a_received_document(db_session, tmp_path, pdf_with_text)
    extraction = extract_document(
        db_session, store, AnthropicExtractor(api_key=None), document.id
    )

    db_session.refresh(document)
    assert document.status == st.FAILED
    assert "ANTHROPIC_API_KEY" in extraction.error
