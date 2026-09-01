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
