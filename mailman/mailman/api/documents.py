"""Document endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from mailman import ingest as ingest_module
from mailman.config import settings
from mailman.db import get_session
from mailman.models import Document
from mailman.schemas import DocumentOut
from mailman.storage import DocumentStore, LocalDocumentStore

router = APIRouter(prefix="/documents", tags=["documents"])


def get_store() -> DocumentStore:
    """The document store, as a dependency so a test can hand in a temporary one."""
    return LocalDocumentStore(settings.storage_root)


@router.post(
    "",
    response_model=DocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a document",
)
def upload_document(
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
