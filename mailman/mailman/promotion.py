"""Stage 6: turning an approved extraction into a record, in one transaction.

Everything before this stage is an *observation* - what the extractor thought, what the rules
made of it. `invoices` and `line_items` are the record, and the difference matters: an
extraction can be re-run and disagree with itself, and a record cannot.

**Promotion and the status change are one transaction.** A half-promoted document is a state
no status describes: an `invoices` row with the document still sitting in `needs_review`, or a
document marked `approved` with nothing to show for it. Either one is a support call nobody
can answer, so both writes commit together or neither does.

**The claim and the accepted record stay in separate tables.** The extraction is never
updated, so a correction cannot destroy the measurement - `extractions` still holds what the
model originally said, and that is what the harness compares against. A reviewer's fix is a
`corrections` row plus a new record, and the pair of them is a hand-verified training example
produced by work that had to happen anyway.

Two validation rules live here rather than in `mailman/validation.py`, because they are the
two that need a database:

- **the vendor resolving against `vendors`** - a warning, because an unknown vendor is usually
  just a new vendor;
- **the invoice number not already recorded for that vendor** - an error, and the expensive
  mistake this system exists to prevent. It is checked as a rule *and* enforced by a unique
  constraint, which is not redundancy: the rule gives a reviewer a sentence, and the
  constraint is what holds when two requests arrive at once.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy.orm import Session

from mailman.invoice import InvoiceFields
from mailman.models import Correction, Document, Extraction, Invoice, LineItem, Vendor
from mailman.status import SEVERITY_ERROR, SEVERITY_WARNING
from mailman.validation import RuleOutcome

# Punctuation and the company-form words that make the same vendor look like two.
_NOISE = re.compile(r"[^a-z0-9 ]+")
_FORMS = {"ltd", "limited", "plc", "llp", "inc", "incorporated", "gmbh", "bv", "sa", "co", "corp"}


def normalise_vendor(name: str) -> str:
    """A vendor name reduced to what makes it the same vendor.

    "ACME CORP LTD", "Acme Corp Ltd." and "Acme Corp" all have to resolve to one row, or the
    duplicate-invoice check below is trivially defeated by punctuation. Deliberately crude:
    it is a lookup key, not a matcher, and anything cleverer belongs behind a reviewer
    confirming it.
    """
    words = _NOISE.sub(" ", name.casefold()).split()
    kept = [w for w in words if w not in _FORMS]
    return " ".join(kept or words)


def resolve_vendor(session: Session, name: str | None) -> Vendor | None:
    """Find the vendor for this name, by normalised name or by alias. Never creates one."""
    if not name:
        return None
    key = normalise_vendor(name)
    if not key:
        return None
    found = session.query(Vendor).filter(Vendor.normalized_name == key).one_or_none()
    if found is not None:
        return found
    return (
        session.query(Vendor)
        .filter(Vendor.aliases.any(key))  # type: ignore[attr-defined]
        .first()
    )


def vendor_is_known(session: Session, fields: InvoiceFields) -> RuleOutcome | None:
    """The vendor resolves against `vendors`. A warning: a new vendor is not a bad document."""
    name = "vendor_is_known"
    if not fields.vendor_name:
        return None
    vendor = resolve_vendor(session, fields.vendor_name)
    if vendor is None:
        return RuleOutcome(
            name, SEVERITY_WARNING, False,
            f"vendor {fields.vendor_name!r} (as {normalise_vendor(fields.vendor_name)!r}) "
            "is not in the vendor list",
        )
    return RuleOutcome(name, SEVERITY_WARNING, True, f"vendor resolves to {vendor.name!r}")


def invoice_number_is_not_a_duplicate(
    session: Session, fields: InvoiceFields, document_id: uuid.UUID | None = None
) -> RuleOutcome | None:
    """This vendor has not already had an invoice with this number recorded.

    An error, and the one this system most exists to prevent - paying the same invoice twice
    costs real money, and it is the mistake a tired person makes most reliably. Only fires
    when the vendor is known, because a number is only unique within a vendor.
    """
    name = "invoice_number_is_not_a_duplicate"
    if not fields.invoice_number or not fields.vendor_name:
        return None
    vendor = resolve_vendor(session, fields.vendor_name)
    if vendor is None:
        return None

    query = session.query(Invoice).filter(
        Invoice.vendor_id == vendor.id,
        Invoice.invoice_number == fields.invoice_number,
    )
    if document_id is not None:
        query = query.filter(Invoice.document_id != document_id)

    existing = query.first()
    if existing is not None:
        return RuleOutcome(
            name, SEVERITY_ERROR, False,
            f"invoice {fields.invoice_number} from {vendor.name} is already recorded "
            f"as document {existing.document_id}",
        )
    return RuleOutcome(
        name, SEVERITY_ERROR, True,
        f"invoice {fields.invoice_number} from {vendor.name} is not already recorded",
    )


def database_rules(
    session: Session, fields: InvoiceFields, document_id: uuid.UUID | None = None
) -> list[RuleOutcome]:
    """The rules that need a session. Run alongside `validation.validate`."""
    outcomes = [
        vendor_is_known(session, fields),
        invoice_number_is_not_a_duplicate(session, fields, document_id),
    ]
    return [o for o in outcomes if o is not None]


class NotPromotable(Exception):
    """The document cannot become a record, and the message says why."""


def promote(
    session: Session,
    document_id: uuid.UUID,
    *,
    actor: str = "reviewer",
) -> Invoice:
    """Promote the latest extraction into `invoices` and `line_items`, and approve.

    One transaction. The caller commits nothing beforehand and rolls back on any failure, so
    a document is never left approved with no record or recorded with no approval.
    """
    from mailman.invoice import InvoiceRead
    from mailman.pipeline import _read_from
    from mailman.status import APPROVED, AUTO_APPROVED, NEEDS_REVIEW
    from mailman.transitions import move

    document = session.get(Document, document_id)
    if document is None:
        raise NotPromotable("no such document")
    # Not `validated`: that status is transient and nothing is ever found sitting in it.
    # Approving a document the rules have not finished judging is the hole this closes.
    if document.status not in (AUTO_APPROVED, NEEDS_REVIEW):
        raise NotPromotable(
            f"document is {document.status}; only a judged document can be approved"
        )

    extraction = (
        session.query(Extraction)
        .filter(Extraction.document_id == document_id, Extraction.error.is_(None))
        .order_by(Extraction.created_at.desc())
        .first()
    )
    if extraction is None or not extraction.extracted_data:
        raise NotPromotable("no usable extraction to promote")

    fields = InvoiceFields(InvoiceRead(**_read_from(extraction.extracted_data)))
    missing = fields.missing_required
    if missing:
        raise NotPromotable("missing required field(s): " + ", ".join(missing))

    vendor = resolve_vendor(session, fields.vendor_name)
    if vendor is None and fields.vendor_name:
        # Created on approval, not on extraction. A reviewer approving the document is the
        # human judgement that says this vendor is real, and creating vendors from extractions
        # would fill the table with every misread name the model ever produced.
        vendor = Vendor(
            name=fields.vendor_name,
            normalized_name=normalise_vendor(fields.vendor_name),
            aliases=[],
        )
        session.add(vendor)
        session.flush()

    duplicate = invoice_number_is_not_a_duplicate(session, fields, document_id)
    if duplicate is not None and not duplicate.passed:
        raise NotPromotable(duplicate.message or "duplicate invoice")

    invoice = Invoice(
        document_id=document.id,
        extraction_id=extraction.id,
        vendor_id=vendor.id if vendor else None,
        invoice_number=fields.invoice_number,
        issue_date=fields.issue_date,
        due_date=fields.due_date,
        currency=fields.currency,
        subtotal=fields.subtotal,
        tax=fields.tax,
        total=fields.total,
    )
    session.add(invoice)
    session.flush()

    for item in fields.line_items:
        session.add(
            LineItem(
                invoice_id=invoice.id,
                line_no=item["line_no"],
                description=item["description"],
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                amount=item["amount"],
            )
        )

    move(
        document,
        APPROVED,
        actor=actor,
        detail=f"promoted invoice {invoice.invoice_number} with {len(fields.line_items)} line(s)",
    )
    session.commit()
    session.refresh(invoice)
    return invoice


# Dotted paths, the same ones the harness uses. `total`, `line_items[2].amount`. Sharing the
# vocabulary is deliberate: a correction is a hand-verified right answer, and it should become
# an expected value in the corpus without anything having to translate it first.
_PATH = re.compile(r"^(?:[a-z_]+|line_items\[\d+\]\.[a-z_]+)$")
_CORRECTABLE = {
    "invoice_number", "vendor_name", "buyer_name", "issue_date", "due_date",
    "currency", "subtotal", "tax", "total",
}
_CORRECTABLE_LINE = {"description", "quantity", "unit_price", "amount"}


def valid_field_path(path: str) -> bool:
    if not _PATH.match(path):
        return False
    if path.startswith("line_items["):
        return path.split(".", 1)[1] in _CORRECTABLE_LINE
    return path in _CORRECTABLE


def apply_corrections(
    session: Session,
    document_id: uuid.UUID,
    changes: dict[str, str | None],
    *,
    reviewed_by: str | None = None,
) -> list[Correction]:
    """Log one row per changed field, write a corrected extraction, and re-validate.

    **The original extraction is not touched.** A correction that overwrites the model's
    answer destroys the measurement and destroys the labelled example the correction just
    created. So a new `extractions` row is written with the corrected data, marked as coming
    from a reviewer, and validation runs again over that - which is why re-validation writes a
    fresh set of `validation_results` rather than updating the old ones.
    """
    from mailman.invoice import InvoiceRead
    from mailman.pipeline import _read_from, validate_document
    from mailman.status import EXTRACTED
    from mailman.transitions import move

    document = session.get(Document, document_id)
    if document is None:
        raise NotPromotable("no such document")

    bad = sorted(p for p in changes if not valid_field_path(p))
    if bad:
        raise NotPromotable("not correctable: " + ", ".join(bad))

    extraction = (
        session.query(Extraction)
        .filter(Extraction.document_id == document_id, Extraction.error.is_(None))
        .order_by(Extraction.created_at.desc())
        .first()
    )
    if extraction is None or not extraction.extracted_data:
        raise NotPromotable("no usable extraction to correct")

    data = dict(extraction.extracted_data)
    data["line_items"] = [dict(item) for item in data.get("line_items") or []]

    logged: list[Correction] = []
    for path, new_value in sorted(changes.items()):
        if path.startswith("line_items["):
            index = int(path[len("line_items[") : path.index("]")])
            key = path.split(".", 1)[1]
            if index >= len(data["line_items"]):
                raise NotPromotable(f"{path} does not exist on this extraction")
            original = data["line_items"][index].get(key)
            data["line_items"][index][key] = new_value
        else:
            original = data.get(path)
            data[path] = new_value

        if str(original) == str(new_value):
            continue  # not a correction; nothing changed
        logged.append(
            Correction(
                document_id=document.id,
                field_path=path,
                original_value=None if original is None else str(original),
                corrected_value=None if new_value is None else str(new_value),
                reviewed_by=reviewed_by,
            )
        )

    for correction in logged:
        session.add(correction)

    corrected = InvoiceFields(InvoiceRead(**_read_from(data)))
    session.add(
        Extraction(
            document_id=document.id,
            model_name=f"correction:{reviewed_by or 'reviewer'}",
            prompt_version=extraction.prompt_version,
            raw_response={"corrected_from": str(extraction.id), "changes": dict(changes)},
            extracted_data=corrected.to_json(),
            latency_ms=0,
            token_count=0,
        )
    )

    # Back to `extracted` so the same validation path runs over the corrected answer. Using
    # the pipeline's own function rather than a copy is what keeps a corrected document
    # judged by exactly the rules a fresh one is.
    move(document, EXTRACTED, actor=reviewed_by or "reviewer", detail=f"{len(logged)} correction(s)")
    session.commit()

    validate_document(session, document_id)
    return logged


def reject(
    session: Session, document_id: uuid.UUID, *, reason: str, actor: str = "reviewer"
) -> Document:
    """A person deciding this should not become a record. Files nothing.

    Kept apart from `failed` on purpose: one is the system's fault and one is a business
    outcome, and collapsing them hides operational problems inside decisions. The reason is
    required, because a rejected document with no reason is one nobody can learn from.
    """
    from mailman.status import NEEDS_REVIEW, REJECTED
    from mailman.transitions import move

    document = session.get(Document, document_id)
    if document is None:
        raise NotPromotable("no such document")
    if document.status != NEEDS_REVIEW:
        raise NotPromotable(f"document is {document.status}; only a queued document is rejected")
    if not reason or not reason.strip():
        raise NotPromotable("a rejection needs a reason")

    move(document, REJECTED, actor=actor, detail=reason.strip())
    session.commit()
    return document
