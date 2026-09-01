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
        background.add_task(_extract_in_background, document.id)

    return document


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
