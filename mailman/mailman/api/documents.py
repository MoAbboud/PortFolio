"""Document endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from mailman import ingest as ingest_module
from mailman import pipeline
from mailman.config import settings
from mailman.db import SessionLocal, get_session
from mailman.extractors import build_extractor
from mailman.models import Document, Extraction
from mailman.schemas import DocumentOut
from mailman.status import RECEIVED
from mailman.storage import DocumentStore, LocalDocumentStore

router = APIRouter(prefix="/documents", tags=["documents"])


def get_store() -> DocumentStore:
    """The document store, as a dependency so a test can hand in a temporary one."""
    return LocalDocumentStore(settings.storage_root)


def _extract_in_background(document_id: uuid.UUID) -> None:
    """Run extraction after the response has gone out.

    Its own session: the request's session is closed by the time this runs. No broker and no
    worker - `status` is how a caller finds out what happened, and that is what the column is
    for. A broker earns its place when a retry has to survive a restart, and not before.
    """
    session = SessionLocal()
    try:
        pipeline.extract_document(
            session,
            LocalDocumentStore(settings.storage_root),
            build_extractor(),
            document_id,
        )
    finally:
        session.close()


@router.post(
    "",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document",
)
def upload_document(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    store: DocumentStore = Depends(get_store),
) -> Document:
    """Store a document and return its row.

    Returns 201 even when the document turns out to be unreadable - the row exists, and its
    `status` says `failed` with the reason in `status_history`. That is not the same as the
    upload having failed, and conflating the two would hide a document the system is
    supposed to support later.

    Returns 415 when the bytes are a type the pipeline cannot read at all. Nothing is stored
    in that case.
    """
    data = file.file.read()

    try:
        document = ingest_module.ingest(
            session,
            store,
            filename=file.filename or "unnamed",
            data=data,
            max_bytes=settings.max_upload_bytes,
        )
    except ingest_module.EmptyUpload as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except ingest_module.UnsupportedDocument as exc:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=exc.reason,
        ) from exc

    # Only a document that got as far as `received` has text to extract from. One that
    # failed at ingestion already carries its reason and is not sent to a model.
    if document.status == RECEIVED:
        background.add_task(_process_in_background, document.id)

    return document


@router.get(
    "",
    response_model=list[DocumentOut],
    summary="List documents, optionally by status",
)
def list_documents(
    status_filter: str | None = None,
    limit: int = 50,
    session: Session = Depends(get_session),
) -> list[Document]:
    """The review queue is this, with `status_filter=needs_review`.

    A queue table would duplicate a fact `documents.status` already holds, and the two can
    disagree. Oldest first: a queue worked newest-first leaves the hardest document at the
    bottom forever.
    """
    from mailman.status import ALL_STATUSES

    query = session.query(Document)
    if status_filter is not None:
        if status_filter not in ALL_STATUSES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail=f"unknown status {status_filter!r}; expected one of {', '.join(ALL_STATUSES)}",
            )
        query = query.filter(Document.status == status_filter)
    return query.order_by(Document.uploaded_at).limit(min(limit, 200)).all()


@router.get(
    "/{document_id}",
    response_model=DocumentOut,
    summary="Read one document",
)
def get_document(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> Document:
    """The document and how it got where it is."""
    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")
    return document


@router.get(
    "/{document_id}/extraction",
    summary="The latest extraction for a document",
)
def get_extraction(
    document_id: uuid.UUID,
    session: Session = Depends(get_session),
) -> dict:
    """The most recent attempt, successful or not.

    A failed attempt is returned rather than hidden: `extracted_data` is null and `error`
    says which of the four failures it was.
    """
    if session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")

    extraction = (
        session.query(Extraction)
        .filter(Extraction.document_id == document_id)
        .order_by(Extraction.created_at.desc())
        .first()
    )
    if extraction is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="this document has not been through extraction yet",
        )

    return {
        "id": str(extraction.id),
        "document_id": str(extraction.document_id),
        "model_name": extraction.model_name,
        "prompt_version": extraction.prompt_version,
        "extracted_data": extraction.extracted_data,
        "confidence": float(extraction.confidence) if extraction.confidence is not None else None,
        "latency_ms": extraction.latency_ms,
        "token_count": extraction.token_count,
        "attempts": extraction.attempts,
        "error": extraction.error,
        "created_at": extraction.created_at.isoformat(),
    }


def _validate_in_background(document_id: uuid.UUID) -> None:
    """Validation, after extraction, in the same background pass.

    Its own session for the same reason extraction has one. Split from `_extract_in_background`
    so a failure in one is legible on its own rather than as "the background task broke".
    """
    session = SessionLocal()
    try:
        pipeline.validate_document(session, document_id)
    finally:
        session.close()


def _process_in_background(document_id: uuid.UUID) -> None:
    """Extract, then validate. What `POST /documents` sets going."""
    _extract_in_background(document_id)
    _validate_in_background(document_id)


@router.post(
    "/{document_id}/approve",
    summary="Promote an extraction into the invoice record",
)
def approve_document(
    document_id: uuid.UUID,
    reviewed_by: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    """Write the `invoices` and `line_items` rows and approve, in one transaction.

    A refusal is a 409 rather than a 500: "this document is already approved" and "this
    invoice number is already recorded for this vendor" are both answers, not faults.
    """
    from mailman.promotion import NotPromotable, promote

    if session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")

    try:
        invoice = promote(session, document_id, actor=reviewed_by or "reviewer")
    except NotPromotable as exc:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return {
        "invoice_id": str(invoice.id),
        "document_id": str(invoice.document_id),
        "invoice_number": invoice.invoice_number,
        "vendor_id": str(invoice.vendor_id) if invoice.vendor_id else None,
        "currency": invoice.currency,
        "total": str(invoice.total) if invoice.total is not None else None,
        "line_items": len(invoice.line_items),
    }


@router.post(
    "/{document_id}/corrections",
    summary="Correct fields on an extraction and re-validate",
)
def correct_document(
    document_id: uuid.UUID,
    changes: dict[str, str | None],
    reviewed_by: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    """One `corrections` row per changed field, then the rules run again.

    Keys are the dotted paths the harness uses - `total`, `line_items[2].amount` - so a
    correction can become an expected value in the corpus without translation. The original
    extraction is untouched; a new one is written carrying the corrected answer.
    """
    from mailman.promotion import NotPromotable, apply_corrections

    if session.get(Document, document_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")

    try:
        logged = apply_corrections(
            session, document_id, changes, reviewed_by=reviewed_by
        )
    except NotPromotable as exc:
        session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    document = session.get(Document, document_id)
    return {
        "document_id": str(document_id),
        "corrections": [
            {"field_path": c.field_path, "from": c.original_value, "to": c.corrected_value}
            for c in logged
        ],
        "status": document.status,
    }


@router.post(
    "/{document_id}/reprocess",
    summary="Send a document back through extraction",
)
def reprocess_document(
    document_id: uuid.UUID,
    background: BackgroundTasks,
    session: Session = Depends(get_session),
) -> dict:
    """Back to `received`, then extract and validate again.

    Nothing is deleted. The extractions already on the document are the record of what the
    previous model or prompt said, and comparing the new answer to the old one is the reason
    that table is append-only.
    """
    from mailman.status import APPROVED, RECEIVED, REJECTED
    from mailman.transitions import IllegalTransition, move

    document = session.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="no such document")
    if document.status in (APPROVED, REJECTED):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=f"document is {document.status}; a terminal document is not reprocessed",
        )

    try:
        move(document, RECEIVED, actor="api", detail="reprocess requested")
    except IllegalTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    session.commit()

    background.add_task(_process_in_background, document_id)
    return {"document_id": str(document_id), "status": document.status}
