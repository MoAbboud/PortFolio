"""The seven tables.

The shape is: a document is the spine, an extraction is a claim, an invoice is accepted
truth, and everything a person did is written down.

Two things are deliberately not tables. There is no review-queue table - the queue is
`GET /documents?status=needs_review`, because a queue table would be a second place for the
same fact to live and the two could disagree. And there are no evaluation tables - gold
labels are JSON files beside the documents and harness results are files, because
measurement belongs in git history where it can be read in a diff.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mailman.db import Base
from mailman.status import ALL_SEVERITIES, ALL_STATUSES

# Money is exact decimal, never float, at every layer. Amounts cross the JSON boundary as
# strings, because JSON parsing is where a float actually gets in.
MONEY = Numeric(14, 2)

# Quantities are genuinely fractional - hours, kilograms - and are not money, so they get
# their own precision rather than being forced into two decimal places.
QUANTITY = Numeric(18, 6)


def _status_check(column: str, values: tuple[str, ...], name: str) -> CheckConstraint:
    allowed = ", ".join(f"'{v}'" for v in values)
    return CheckConstraint(f"{column} IN ({allowed})", name=name)


# `clock_timestamp()`, not `now()`.
#
# Postgres `now()` is TRANSACTION start time, so every row written in one transaction shares
# it to the microsecond. Two extractions in one transaction - which is exactly what applying
# a correction does - then have identical `created_at`, and "the latest extraction" is decided
# arbitrarily by the planner. Validation picked the uncorrected answer roughly half the time.
#
# It surfaced as a review-queue test that passed alone and failed in the suite, which is the
# shape this class of bug always has. `clock_timestamp()` advances within a transaction.
_ROW_TIME = text("clock_timestamp()")

class Document(Base):
    """The spine. Every other table hangs off it, and status is what the system operates on."""

    __tablename__ = "documents"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )

    # What the sender called it. Recorded, never trusted for anything.
    filename: Mapped[str] = mapped_column(Text, nullable=False)

    # Key into the document store, in an S3-shaped layout. Only the storage layer reads it.
    storage_path: Mapped[str] = mapped_column(Text, nullable=False)

    # Detected from the bytes, not from the extension.
    mime_type: Mapped[str] = mapped_column(Text, nullable=False)

    # Invoice today. This is the hook a second document type hangs on.
    doc_type: Mapped[str] = mapped_column(Text, nullable=False, default="invoice")

    status: Mapped[str] = mapped_column(Text, nullable=False, default="received")

    # One appended entry per transition: the status, when, and what caused it. A stuck
    # document has to be explainable a week later.
    status_history: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Null while the document is still moving. Set when it reaches a terminal status.
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    extractions: Mapped[list["Extraction"]] = relationship(back_populates="document")

    __table_args__ = (
        _status_check("status", ALL_STATUSES, "ck_documents_status"),
        # The queue is a status filter, so the status filter gets an index.
        Index("ix_documents_status_uploaded_at", "status", "uploaded_at"),
    )


class Extraction(Base):
    """One row per extraction attempt. Append only, never updated.

    This is the table that makes the evaluation harness possible: the same document can be
    re-run under a new prompt_version and the two answers compared, because the first one is
    still there. A failed attempt still writes a row - throwing the failures away would
    remove the record of how often the model fails to produce parseable output, which is one
    of the things worth measuring.
    """

    __tablename__ = "extractions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )

    # Without both of these, one extraction cannot be compared to another and the harness
    # has nothing to report against.
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    prompt_version: Mapped[str] = mapped_column(Text, nullable=False)

    # Exactly what came back, unmodified. When parsing breaks, this is the investigation.
    raw_response: Mapped[dict | None] = mapped_column(JSONB)

    # The parsed result. Null on a failed attempt.
    extracted_data: Mapped[dict | None] = mapped_column(JSONB)

    # Composite: required fields populated, types parsing, validation outcomes, and the
    # model's own confidence contributing least. Weakly trusted, never the only gate.
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))

    # Logged from the first extraction because they cannot be backfilled, and they are the
    # cost and speed story.
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    token_count: Mapped[int | None] = mapped_column(Integer)

    # An extraction that succeeded on the fifth try should not look like one that succeeded
    # on the first.
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Why the attempt failed, when it did. Malformed JSON, missing required field and
    # timeout are kept apart rather than collapsed into one exception.
    error: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=_ROW_TIME
    )

    document: Mapped["Document"] = relationship(back_populates="extractions")

    __table_args__ = (
        Index("ix_extractions_document_created", "document_id", "created_at"),
    )


class Vendor(Base):
    """Reference data. Small and mostly hand-maintained.

    normalized_name is the match key: lowercased, punctuation and legal suffixes stripped.
    A model returns "Acme Corp." and "ACME Corporation" interchangeably and neither is wrong
    on the document, so resolution normalises and then matches against the name or an alias.
    An unresolved vendor is a warning, not an error, because it is often just a new vendor.
    """

    __tablename__ = "vendors"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_name: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    aliases: Mapped[list[str]] = mapped_column(ARRAY(Text), nullable=False, default=list)
    tax_id: Mapped[str | None] = mapped_column(Text)


class Invoice(Base):
    """The canonical record. Accepted truth, as opposed to the extraction's claim.

    A row exists here only when a document reached `approved`, automatically or through a
    reviewer. Separate from extractions on purpose: a correction must never overwrite the
    answer being measured, and it must never destroy the labelled example it just created.
    """

    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    # Points back at the model's answer that produced this record, even after correction.
    extraction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("extractions.id", ondelete="RESTRICT")
    )
    vendor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="RESTRICT")
    )

    invoice_number: Mapped[str] = mapped_column(Text, nullable=False)
    issue_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)

    # An amount without its currency is not a number that means anything.
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    subtotal: Mapped[Decimal | None] = mapped_column(MONEY)
    tax: Mapped[Decimal | None] = mapped_column(MONEY)
    total: Mapped[Decimal | None] = mapped_column(MONEY)

    status: Mapped[str] = mapped_column(Text, nullable=False, default="approved")
    approved_by: Mapped[str | None] = mapped_column(Text)
    approved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    line_items: Mapped[list["LineItem"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Duplicate invoices are the expensive mistake in this domain. The database enforces
        # it as well as the rule does, because a reviewer can override a rule and cannot
        # override a constraint.
        UniqueConstraint("vendor_id", "invoice_number", name="uq_invoices_vendor_number"),
    )


class LineItem(Base):
    """The lines of a canonical invoice.

    A table rather than JSON on the invoice, because line items are the thing most often
    extracted wrongly, the thing the harness scores as a set, and the thing worth querying.
    """

    __tablename__ = "line_items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    quantity: Mapped[Decimal | None] = mapped_column(QUANTITY)
    unit_price: Mapped[Decimal | None] = mapped_column(MONEY)
    amount: Mapped[Decimal | None] = mapped_column(MONEY)

    invoice: Mapped["Invoice"] = relationship(back_populates="line_items")

    __table_args__ = (
        UniqueConstraint("invoice_id", "line_no", name="uq_line_items_invoice_line_no"),
    )


class ValidationResult(Base):
    """One row per rule per document. This is what routes something to review.

    Rows are written for passes as well as failures: a rule that used to pass and now fails
    is only visible if the pass was recorded. Re-validating after a correction writes a new
    set of rows with a later checked_at rather than updating the old ones.
    """

    __tablename__ = "validation_results"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    # Which extraction was judged. Needed because re-validation after a correction writes a
    # fresh set of rows, and document_id alone cannot say which answer they were about.
    extraction_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("extractions.id", ondelete="CASCADE")
    )

    rule_name: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[str] = mapped_column(Text, nullable=False)
    passed: Mapped[bool] = mapped_column(nullable=False)

    # Names the numbers involved, so a reviewer knows what to look at rather than only that
    # a rule failed.
    message: Mapped[str | None] = mapped_column(Text)

    checked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=_ROW_TIME
    )

    __table_args__ = (
        _status_check("severity", ALL_SEVERITIES, "ck_validation_results_severity"),
        Index("ix_validation_results_document", "document_id", "checked_at"),
    )


class Correction(Base):
    """Every field a person changed, with the value before and after.

    Two uses, and the second is why this table matters more than it looks. It is an audit
    trail, and it is a free labelled dataset: each row is a hand-verified right answer
    produced by work that had to happen anyway. field_path uses the same dotted paths the
    harness uses, on purpose, so a correction can become an expected value with no
    translation step.

    Values are text before and after, rather than typed per field, because that keeps the
    table readable and the diff obvious.
    """

    __tablename__ = "corrections"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    field_path: Mapped[str] = mapped_column(Text, nullable=False)
    original_value: Mapped[str | None] = mapped_column(Text)
    corrected_value: Mapped[str | None] = mapped_column(Text)
    reviewed_by: Mapped[str | None] = mapped_column(Text)
    corrected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ix_corrections_document", "document_id", "corrected_at"),)
