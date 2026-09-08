"""The two ingest doors.

Both write raw turns and return immediately. Nothing here calls a model: derivation is a
background job and the caller never waits on it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.core.security import require_key
from herder.domain.transcript import TranscriptError
from herder.models import ApiKey
from herder.schemas.ingest import IngestBatch, IngestResult, PasteRequest
from herder.services.ingest import IngestError, ingest_events, ingest_paste

router = APIRouter(prefix="/v1", tags=["ingest"])


@router.post("/ingest/paste", response_model=IngestResult, status_code=status.HTTP_201_CREATED)
async def paste(
    body: PasteRequest,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> IngestResult:
    """Ingest a pasted transcript.

    Idempotent by content: re-pasting the same transcript resolves to the same conversation
    and inserts nothing. Pass `conversation_id` to append a continued transcript to one
    already stored - the overlap is recognised turn by turn.
    """
    try:
        return await ingest_paste(
            session,
            key.workspace_id,
            text=body.text,
            vendor=body.vendor,
            project_id=body.project_id,
            title=body.title,
            conversation_id=body.conversation_id,
        )
    except TranscriptError as exc:
        # The transcript was not understood. 422 rather than 400: the request was
        # well-formed, its content could not be parsed, and the reason is the useful part.
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except IngestError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ingest", response_model=IngestResult, status_code=status.HTTP_202_ACCEPTED)
async def ingest(
    body: IngestBatch,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> IngestResult:
    """Ingest a batch of observed turns, as the browser extension sends them.

    Idempotent on `(conversation, content_hash)`. Re-posting a batch reports it as
    duplicates and changes nothing, which is what makes the extension's retry safe.
    """
    try:
        return await ingest_events(session, key.workspace_id, events=body.events, project_id=body.project_id)
    except IngestError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
