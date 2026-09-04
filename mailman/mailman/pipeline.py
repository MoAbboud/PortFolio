"""Running a document through the stages.

Called by the API as a background task and by the command line directly. Same function
either way - there is no logic the HTTP path has that the terminal path lacks, which is what
lets the evaluation harness drive the real pipeline instead of a copy of it.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy.orm import Session

from mailman import storage
from mailman.extractor import Extractor, ExtractionError
from mailman.models import Document, Extraction
from mailman.status import EXTRACTED, EXTRACTING, FAILED, RECEIVED
from mailman.transitions import move

log = logging.getLogger(__name__)


def extract_document(
    session: Session,
    store: storage.DocumentStore,
    extractor: Extractor,
    document_id: uuid.UUID,
) -> Extraction | None:
    """Extract one document. Returns the extraction row, or None if it failed.

    Every path writes a row to `extractions`, success or failure. Throwing the failures away
    would remove the record of how often the model fails to produce a usable answer, which
    is one of the things the harness exists to measure.
    """
    document = session.get(Document, document_id)
    if document is None:
        log.warning("extract_document called for a document that does not exist: %s", document_id)
        return None

    if document.status != RECEIVED:
        log.info("document %s is %s, not %s - not extracting", document_id, document.status, RECEIVED)
        return None

    move(document, EXTRACTING, actor="pipeline", detail=f"model {extractor.model_name}")
    session.commit()

    text = store.get(storage.text_key_for(document.storage_path)).decode("utf-8")

    try:
        result = extractor.extract(text)
    except ExtractionError as exc:
        return _record_failure(
            session, document, extractor, exc.kind, str(exc), raw=exc.raw, attempts=exc.attempts
        )
    except Exception as exc:  # noqa: BLE001 - see below; this catch is the point
        # Deliberately broad. The document has already been moved to `extracting`, and any
        # exception escaping from here leaves it there with nothing able to move it on -
        # a hole in the state machine that no status describes and no operator can explain.
        # An unexpected failure is still a failure: it gets a row, a reason and a status.
        log.exception("unexpected failure extracting document %s", document_id)
        return _record_failure(
            session,
            document,
            extractor,
            "internal",
            f"{type(exc).__name__}: {exc}",
        )

    extraction = Extraction(
        document_id=document.id,
        model_name=result.model_name,
        prompt_version=result.prompt_version,
        raw_response=result.raw_response,
        extracted_data=result.fields.to_json(),
        # A first, crude composite. Populated fields and clean parses count; the model's own
        # number is one term among several and is the least trusted of them. Stage 5 replaces
        # this with something defensible, measured rather than guessed.
        confidence=_provisional_confidence(result),
        latency_ms=result.latency_ms,
        token_count=result.token_count,
        attempts=result.attempts,
    )
    session.add(extraction)
    move(
        document,
        EXTRACTED,
        actor="pipeline",
        detail=(
            f"{result.token_count} tokens, {result.latency_ms}ms, "
            f"{len(result.fields.line_items)} line item(s)"
        ),
    )
    session.commit()
    session.refresh(extraction)
    return extraction


def _record_failure(
    session: Session,
    document: Document,
    extractor: Extractor,
    kind: str,
    message: str,
    *,
    raw=None,
    attempts: int = 1,
) -> Extraction:
    """Write the failed attempt and move the document to `failed`.

    Rolls back first: an unexpected exception may have left the session unusable, and the
    whole point of this function is that it works when things have already gone wrong.
    """
    session.rollback()
    document = session.get(Document, document.id)

    extraction = Extraction(
        document_id=document.id,
        model_name=extractor.model_name,
        prompt_version=extractor.prompt_version,
        raw_response=raw,
        extracted_data=None,
        error=f"{kind}: {message}",
        attempts=attempts,
    )
    session.add(extraction)
    move(document, FAILED, actor="pipeline", detail=f"{kind}: {message}")
    session.commit()
    session.refresh(extraction)
    return extraction


def _provisional_confidence(result) -> float:
    """A placeholder, and labelled as one.

    Stage 5 defines the real composite and stage 8 sets the threshold from a measurement.
    Until then this exists so the column is populated and the shape is exercised - it is not
    a number anything should be routed on.
    """
    fields = result.fields
    score = 1.0
    if fields.problems:
        score -= 0.25
    if fields.ambiguous_dates:
        score -= 0.1
    if not fields.line_items:
        score -= 0.1
    # The model's own opinion counts, and counts least.
    score = 0.8 * score + 0.2 * float(fields.read.confidence)
    return round(max(0.0, min(1.0, score)), 4)


def validate_document(
    session: Session,
    document_id: uuid.UUID,
    extraction: "Extraction | None" = None,
) -> list:
    """Run the rules over an extraction, write a row per rule, and route the document.

    Returns the outcomes. Called after `extract_document` in the same background task, and
    again by the corrections endpoint in stage 6 - re-validating writes a fresh set of rows
    with a later `checked_at` rather than updating the old ones, because a correction that
    overwrites the previous verdict destroys the record of what the model originally said.

    Routing is one line: any failed error goes to a person, warnings do not. Confidence
    arrives in stage 5 and can only add documents to the queue, never remove one.
    """
    from mailman.confidence import as_decimal, score
    from mailman.promotion import database_rules
    from mailman.config import settings
    from mailman.invoice import InvoiceFields, InvoiceRead
    from mailman.models import ValidationResult
    from mailman.status import AUTO_APPROVED, NEEDS_REVIEW, VALIDATED
    from mailman.validation import failed_errors, summarise, validate

    document = session.get(Document, document_id)
    if document is None:
        log.warning("validate_document called for a document that does not exist: %s", document_id)
        return []

    if document.status != EXTRACTED:
        log.info("document %s is %s, not %s - not validating", document_id, document.status, EXTRACTED)
        return []

    if extraction is None:
        extraction = (
            session.query(Extraction)
            .filter(Extraction.document_id == document_id, Extraction.error.is_(None))
            .order_by(Extraction.created_at.desc())
            .first()
        )
    if extraction is None or not extraction.extracted_data:
        log.warning("document %s has no usable extraction to validate", document_id)
        return []

    fields = InvoiceFields(InvoiceRead(**_read_from(extraction.extracted_data)))
    # The pure rules, then the two that need a session. Kept in separate modules because one
    # set is testable with no database at all and the other is not, but they are one list by
    # the time anything routes on them.
    outcomes = validate(fields) + database_rules(session, fields, document_id)

    for outcome in outcomes:
        session.add(
            ValidationResult(
                document_id=document.id,
                extraction_id=extraction.id,
                rule_name=outcome.rule_name,
                severity=outcome.severity,
                passed=outcome.passed,
                message=outcome.message,
            )
        )

    # The composite needs the rule outcomes, so it is computed here rather than at extraction
    # time and written back to the row. That is the only column on `extractions` written after
    # the row is created: `raw_response` and `extracted_data` are the record of what happened
    # and never change, while `confidence` is a score over that record and the rules in force,
    # and the rules run at this point and not before. Re-validating after a correction writes
    # a fresh set of `validation_results` and a fresh score for the same reason.
    confidence = score(fields, outcomes)
    extraction.confidence = as_decimal(confidence)

    move(document, VALIDATED, actor="pipeline", detail=summarise(outcomes))

    # Two independent reasons to want a person, and they are kept apart in the detail so the
    # queue can say which one applied. Confidence can only ADD a document to the queue: a
    # failed error routes on its own and no score overrides it.
    errors = failed_errors(outcomes)
    below = confidence.score < settings.confidence_threshold

    if errors or below:
        reasons = []
        if errors:
            reasons.append("failed: " + ", ".join(o.rule_name for o in errors))
        if below:
            reasons.append(
                f"{confidence.explain()} < threshold {settings.confidence_threshold}"
            )
        move(document, NEEDS_REVIEW, actor="pipeline", detail=" | ".join(reasons))
    else:
        move(
            document,
            AUTO_APPROVED,
            actor="pipeline",
            detail=f"{summarise(outcomes)} | {confidence.explain()}",
        )

    session.commit()
    return outcomes


def _read_from(extracted_data: dict) -> dict:
    """Turn a stored extraction back into `InvoiceRead` keyword arguments.

    Amounts cross JSON as strings and come back as strings, which is the point - `InvoiceRead`
    holds what the document said and `InvoiceFields` does the parsing, so re-validating a
    stored extraction goes through exactly the same parser as the original run. A shortcut
    here that read the numbers directly would validate a different value from the one the
    pipeline produced.
    """
    data = dict(extracted_data)

    # `to_json` renames two fields on the way out - `confidence` is stored as
    # `model_confidence` and `unreadable` as `model_says_unreadable` - so they have to be
    # renamed back. The first version of this fabricated `confidence = 0.0` instead, and the
    # effect was quiet and wrong: the self-report term of the composite scored zero on every
    # document that went through validation, because validation always reads the stored
    # extraction rather than the live object. It dragged real routing decisions below the
    # threshold and nothing said so.
    #
    # Found by a stage 6 test asserting that correcting a broken total moves a document back
    # out of review. It did not, and the reason was here rather than in corrections.
    data["confidence"] = data.pop("model_confidence", 0.0)
    data["unreadable"] = data.pop("model_says_unreadable", [])

    # Derived, not stored input. `InvoiceFields` recomputes all of these from the values
    # above, and passing them to `InvoiceRead` would be passing an answer to the thing whose
    # job is to work the answer out.
    for derived in ("parse_problems", "ambiguous_dates", "date_conventions", "missing_required",
                    "problems"):
        data.pop(derived, None)
    return data
