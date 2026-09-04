"""Stage 6: promotion, corrections, and the transaction boundaries.

These are the tests the plan says concentrate on the state machine and the transaction
boundaries, and they need a real database - a half-committed transaction is exactly the thing
an in-memory fake cannot have.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from mailman import pipeline
from mailman import status as st
from mailman.corpus import CASES
from mailman.corpus_check import document_text
from mailman.heuristic import HeuristicExtractor
from mailman.models import Correction, Document, Extraction, Invoice, LineItem, Vendor
from mailman.promotion import (
    NotPromotable,
    apply_corrections,
    invoice_number_is_not_a_duplicate,
    normalise_vendor,
    promote,
    resolve_vendor,
    valid_field_path,
)
from mailman.transitions import move


def _case(name: str):
    return next(c for c in CASES if c.name == name)


def a_judged_document(session: Session, case_name: str = "01-clean") -> Document:
    """A document carried to `auto_approved` or `needs_review` the way the pipeline does it.

    Built through the real extractor and the real validation call rather than by inserting
    rows, because what is being tested downstream is the state machine, and a document put
    into a status by hand has not been through it.
    """
    case = _case(case_name)
    text, _ = document_text(case)

    document = Document(
        filename=f"{case.name}.pdf",
        storage_path=f"test/{uuid.uuid4()}.pdf",
        mime_type="application/pdf",
        status=st.RECEIVED,
        status_history=[],
    )
    session.add(document)
    session.commit()

    result = HeuristicExtractor().extract(text)
    move(document, st.EXTRACTING, actor="test")
    extraction = Extraction(
        document_id=document.id,
        model_name=result.model_name,
        prompt_version=result.prompt_version,
        raw_response=result.raw_response,
        extracted_data=result.fields.to_json(),
        latency_ms=result.latency_ms,
        token_count=result.token_count,
    )
    session.add(extraction)
    move(document, st.EXTRACTED, actor="test")
    session.commit()

    pipeline.validate_document(session, document.id, extraction)
    session.refresh(document)
    return document


# --- vendor normalisation --------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["ACME CORP LTD", "Acme Corp Ltd.", "Acme Corp", "acme  corp   limited", "Acme Corp, Ltd"],
)
def test_the_same_vendor_written_five_ways_normalises_to_one_key(name: str) -> None:
    """If punctuation makes two vendors, the duplicate-invoice check is trivially defeated."""
    assert normalise_vendor(name) == "acme"


def test_normalisation_does_not_erase_a_name_that_is_only_a_company_form() -> None:
    """"Limited" on its own is a bad vendor name and still has to be a key, not an empty
    string - an empty key would collide every such vendor into one row."""
    assert normalise_vendor("Limited") == "limited"


# --- promotion -------------------------------------------------------------------------


def test_approving_writes_the_invoice_and_the_line_items(db_session: Session) -> None:
    """Stage 6's stated end: a real row in `invoices`."""
    document = a_judged_document(db_session)
    invoice = promote(db_session, document.id, actor="tester")

    db_session.refresh(document)
    assert document.status == st.APPROVED
    assert invoice.invoice_number == "INV-2026-0042"
    assert invoice.total == Decimal("270.00")
    assert invoice.currency == "GBP"

    lines = db_session.query(LineItem).filter(LineItem.invoice_id == invoice.id).all()
    assert len(lines) == 2
    assert {l.line_no for l in lines} == {1, 2}
    assert sum(l.amount for l in lines) == invoice.subtotal


def test_the_vendor_is_created_on_approval_not_on_extraction(db_session: Session) -> None:
    """A reviewer approving is the human judgement that says this vendor is real.

    Creating vendors from extractions would fill the table with every misread name the model
    ever produced, and the duplicate check reads that table.
    """
    document = a_judged_document(db_session)
    key = normalise_vendor("ACME CORP LTD")
    assert resolve_vendor(db_session, "ACME CORP LTD") is None

    invoice = promote(db_session, document.id)
    vendor = db_session.get(Vendor, invoice.vendor_id)
    assert vendor is not None and vendor.normalized_name == key


def test_promotion_and_the_status_change_are_one_transaction(db_session: Session) -> None:
    """A half-promoted document is a state no status describes.

    Forced by promoting the same document twice: the second attempt has to leave nothing
    behind - no orphan invoice row, and the document still exactly as it was.
    """
    document = a_judged_document(db_session)
    promote(db_session, document.id)
    db_session.refresh(document)

    before = db_session.query(Invoice).count()
    with pytest.raises(NotPromotable):
        promote(db_session, document.id)
    db_session.rollback()

    db_session.refresh(document)
    assert document.status == st.APPROVED
    assert db_session.query(Invoice).count() == before


def test_the_same_invoice_from_the_same_vendor_is_refused(db_session: Session) -> None:
    """The expensive mistake this system exists to prevent."""
    first = a_judged_document(db_session)
    promote(db_session, first.id)

    second = a_judged_document(db_session)          # the same document content again
    with pytest.raises(NotPromotable, match="already recorded"):
        promote(db_session, second.id)
    db_session.rollback()

    db_session.refresh(second)
    assert second.status != st.APPROVED


def test_a_duplicate_is_reported_as_a_rule_before_it_is_refused(db_session: Session) -> None:
    """The rule gives a reviewer a sentence; the constraint is what holds under a race.

    Both exist on purpose, and this is the half a person reads.
    """
    from mailman.invoice import InvoiceFields, InvoiceRead
    from mailman.pipeline import _read_from

    first = a_judged_document(db_session)
    promote(db_session, first.id)

    second = a_judged_document(db_session)
    extraction = (
        db_session.query(Extraction)
        .filter(Extraction.document_id == second.id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    fields = InvoiceFields(InvoiceRead(**_read_from(extraction.extracted_data)))
    outcome = invoice_number_is_not_a_duplicate(db_session, fields, second.id)

    assert outcome is not None and not outcome.passed
    assert outcome.severity == st.SEVERITY_ERROR
    assert "INV-2026-0042" in outcome.message


def test_an_unjudged_document_cannot_be_approved(db_session: Session) -> None:
    """`validated` is transient. Approving a document the rules have not finished judging is
    the hole this closes."""
    document = Document(
        filename="x.pdf", storage_path=f"test/{uuid.uuid4()}.pdf",
        mime_type="application/pdf", status=st.RECEIVED, status_history=[],
    )
    db_session.add(document)
    db_session.commit()

    with pytest.raises(NotPromotable, match="only a judged document"):
        promote(db_session, document.id)


# --- corrections -----------------------------------------------------------------------


@pytest.mark.parametrize("path", ["total", "vendor_name", "line_items[0].amount"])
def test_the_correctable_paths_are_the_ones_the_harness_uses(path: str) -> None:
    assert valid_field_path(path)


@pytest.mark.parametrize("path", ["id", "status", "line_items[0].bogus", "line_items.amount"])
def test_a_path_that_is_not_a_field_is_refused(path: str) -> None:
    """A correction endpoint that accepts any key is an arbitrary write to the record."""
    assert not valid_field_path(path)


def test_a_correction_logs_a_row_and_leaves_the_original_extraction_alone(
    db_session: Session,
) -> None:
    """A correction that overwrites the model's answer destroys the measurement and destroys
    the labelled example the correction just created."""
    document = a_judged_document(db_session)
    original = (
        db_session.query(Extraction)
        .filter(Extraction.document_id == document.id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    original_data = dict(original.extracted_data)

    logged = apply_corrections(
        db_session, document.id, {"buyer_name": "Orchard Foods Ltd"}, reviewed_by="tester"
    )

    assert len(logged) == 1
    assert logged[0].field_path == "buyer_name"
    assert logged[0].corrected_value == "Orchard Foods Ltd"
    assert logged[0].reviewed_by == "tester"

    db_session.refresh(original)
    assert original.extracted_data == original_data, "the original claim must survive"

    rows = db_session.query(Correction).filter(Correction.document_id == document.id).all()
    assert len(rows) == 1


def test_a_correction_writes_a_new_extraction_and_revalidates(db_session: Session) -> None:
    """The corrected answer goes through exactly the same rules a fresh document does."""
    from mailman.models import ValidationResult

    document = a_judged_document(db_session)
    before = db_session.query(ValidationResult).filter(
        ValidationResult.document_id == document.id
    ).count()

    apply_corrections(db_session, document.id, {"buyer_name": "Orchard Foods Ltd"})

    db_session.refresh(document)
    extractions = (
        db_session.query(Extraction).filter(Extraction.document_id == document.id).all()
    )
    assert len(extractions) == 2, "a corrected answer is a new extraction, not an edit"
    assert any(e.model_name.startswith("correction:") for e in extractions)

    after = db_session.query(ValidationResult).filter(
        ValidationResult.document_id == document.id
    ).count()
    assert after > before, "re-validation writes a fresh set rather than updating"
    assert document.status in (st.AUTO_APPROVED, st.NEEDS_REVIEW)


def test_a_change_that_changes_nothing_is_not_logged_as_a_correction(
    db_session: Session,
) -> None:
    """Submitting the form unedited is not a correction, and logging it as one would poison
    the corrections log as a source of labelled examples."""
    document = a_judged_document(db_session)
    logged = apply_corrections(db_session, document.id, {"invoice_number": "INV-2026-0042"})
    assert logged == []


def test_a_correction_can_move_a_document_out_of_review(db_session: Session) -> None:
    """The point of the queue: a person fixes what the rules objected to and it clears."""
    from mailman.models import ValidationResult

    document = a_judged_document(db_session)
    # Break the total so the arithmetic rule objects, the way a misread would.
    apply_corrections(db_session, document.id, {"total": "999.00"})
    db_session.refresh(document)
    assert document.status == st.NEEDS_REVIEW

    failed = (
        db_session.query(ValidationResult)
        .filter(
            ValidationResult.document_id == document.id,
            ValidationResult.passed.is_(False),
            ValidationResult.severity == st.SEVERITY_ERROR,
        )
        .all()
    )
    assert any(r.rule_name == "subtotal_plus_tax_equals_total" for r in failed)

    apply_corrections(db_session, document.id, {"total": "270.00"})
    db_session.refresh(document)
    assert document.status == st.AUTO_APPROVED


def test_two_extractions_in_one_transaction_are_distinguishable(db_session: Session) -> None:
    """"The latest extraction" has to be an answer, not a coin flip.

    Postgres `now()` is transaction start time, so every row written in one transaction shared
    it to the microsecond. Applying a correction writes a second extraction while the first is
    being read, so both carried an identical `created_at` and the planner decided which was
    "latest" - validation ran against the uncorrected answer roughly half the time, silently.

    It surfaced as a review-queue test that passed alone and failed in the suite, which is the
    shape this class of bug always has: nothing is wrong with either run, only with the
    assumption that an ordering is total when it is not.
    """
    document = a_judged_document(db_session)
    apply_corrections(db_session, document.id, {"total": "999.00"})

    extractions = (
        db_session.query(Extraction)
        .filter(Extraction.document_id == document.id)
        .order_by(Extraction.created_at.desc())
        .all()
    )
    assert len(extractions) == 2
    assert extractions[0].created_at > extractions[1].created_at, (
        "timestamps must be distinct within a transaction, or 'latest' is arbitrary"
    )
    assert extractions[0].model_name.startswith("correction:")
    assert extractions[0].extracted_data["total"] == "999.00"


def test_the_correction_is_what_gets_validated_not_the_original(db_session: Session) -> None:
    """The consequence of the ordering bug, asserted on behaviour rather than on timestamps.

    This is what actually went wrong: the document stayed auto-approved after being broken,
    because validation read the extraction from before the correction.
    """
    document = a_judged_document(db_session)
    assert document.status == st.AUTO_APPROVED

    apply_corrections(db_session, document.id, {"total": "999.00"})
    db_session.refresh(document)
    assert document.status == st.NEEDS_REVIEW, "the corrected answer is what the rules judge"
