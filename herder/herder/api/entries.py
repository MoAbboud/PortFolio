"""The adjuster's API: changing entries, reading their lineage, and the suggestions inbox.

Every write returns the render job it queued. Nothing here runs a model or a derive.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.core.security import require_key
from herder.domain.adjust import Refused
from herder.models import ApiKey, Conversation, Entry, EntryLineage, Message, Project, Suggestion
from herder.services import adjust

router = APIRouter(prefix="/v1", tags=["adjust"])

MANUAL_NOTE = "Added by hand. There are no source messages behind it, and derive never changes it."

Action = Literal["pin", "unpin", "remove", "restore", "promote", "archive"]
LayerName = Literal["stable", "project", "session"]
KindName = Literal[
    "constraint", "decision", "open_thread", "code_state", "preference", "identity", "glossary", "fact", "artifact_ref"
]


class AdjustedOut(BaseModel):
    entry_id: uuid.UUID
    event: str
    status: str
    layer: str
    revision: int
    source: str
    render_job_id: uuid.UUID


class NewEntry(BaseModel):
    layer: LayerName
    kind: KindName
    title: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1)
    pinned: bool = False


class EntryEdit(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    text: str | None = Field(default=None, min_length=1)
    layer: LayerName | None = None
    reason: str | None = None


class LineageMessage(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    seq: int
    role: str
    content: str
    captured_at: dt.datetime


class LineageOut(BaseModel):
    entry_id: uuid.UUID
    source: str
    # Said in words for a manual entry, so a reader never has to infer "hand-written" from an
    # empty list - which looks exactly like a derived entry whose lineage went missing.
    note: str | None
    messages: list[LineageMessage]


class SuggestionOut(BaseModel):
    id: uuid.UUID
    kind: str
    status: str
    text: str
    entry_id: uuid.UUID | None
    related_entry_id: uuid.UUID | None
    message_id: uuid.UUID | None
    created_at: dt.datetime


class SuggestionResult(BaseModel):
    suggestion_id: uuid.UUID
    status: str
    adjusted: AdjustedOut | None


def _not_found(what: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"no such {what}")


def _refused(exc: Refused) -> HTTPException:
    # 409: the request is well formed, but the entry is not in a state it applies to.
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))


def _out(result: adjust.Adjusted | None) -> AdjustedOut | None:
    if result is None:
        return None
    return AdjustedOut(
        entry_id=result.entry_id,
        event=result.event,
        status=result.status,
        layer=result.layer,
        revision=result.revision,
        source=result.source,
        render_job_id=result.render_job_id,
    )


async def _owned_project(session: AsyncSession, project_id: uuid.UUID, key: ApiKey) -> Project:
    project = await session.get(Project, project_id)
    if project is None or project.workspace_id != key.workspace_id:
        raise _not_found("project")
    return project


async def _owned_entry(session: AsyncSession, entry_id: uuid.UUID, key: ApiKey) -> Entry:
    entry = await session.get(Entry, entry_id)
    if entry is None:
        raise _not_found("entry")
    project = await session.get(Project, entry.project_id)
    if project is None or project.workspace_id != key.workspace_id:
        raise _not_found("entry")
    return entry


async def _owned_suggestion(session: AsyncSession, suggestion_id: uuid.UUID, key: ApiKey) -> Suggestion:
    suggestion = await session.get(Suggestion, suggestion_id)
    if suggestion is None:
        raise _not_found("suggestion")
    await _owned_project(session, suggestion.project_id, key)
    return suggestion


@router.post("/projects/{project_id}/entries", response_model=AdjustedOut, status_code=201)
async def add_entry(
    project_id: uuid.UUID,
    body: NewEntry,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> AdjustedOut:
    project = await _owned_project(session, project_id, key)
    try:
        result = await adjust.add(
            session, project.id, key.user_id,
            layer=body.layer, kind=body.kind, title=body.title, text=body.text, pinned=body.pinned,
        )
    except Refused as exc:
        raise _refused(exc) from exc
    return _out(result)


@router.patch("/entries/{entry_id}", response_model=AdjustedOut)
async def edit_entry(
    entry_id: uuid.UUID,
    body: EntryEdit,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> AdjustedOut:
    entry = await _owned_entry(session, entry_id, key)
    try:
        result = await adjust.edit(
            session, entry.id, key.user_id, title=body.title, text=body.text, layer=body.layer, reason=body.reason
        )
    except Refused as exc:
        raise _refused(exc) from exc
    return _out(result)


@router.post("/entries/{entry_id}/{action}", response_model=AdjustedOut)
async def act_on_entry(
    entry_id: uuid.UUID,
    action: Action,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> AdjustedOut:
    entry = await _owned_entry(session, entry_id, key)
    try:
        result = await adjust.act(session, entry.id, action, key.user_id)
    except Refused as exc:
        raise _refused(exc) from exc
    return _out(result)


@router.get("/entries/{entry_id}/lineage", response_model=LineageOut)
async def lineage(
    entry_id: uuid.UUID,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> LineageOut:
    entry = await _owned_entry(session, entry_id, key)
    rows = (
        await session.execute(
            select(Message)
            .join(EntryLineage, EntryLineage.message_id == Message.id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(EntryLineage.entry_id == entry.id)
            .order_by(Conversation.id, Message.seq)
        )
    ).scalars().all()
    return LineageOut(
        entry_id=entry.id,
        source=entry.source,
        note=MANUAL_NOTE if entry.source == "user" else None,
        messages=[
            LineageMessage(
                id=m.id, conversation_id=m.conversation_id, seq=m.seq, role=m.role, content=m.content, captured_at=m.captured_at
            )
            for m in rows
        ],
    )


@router.get("/projects/{project_id}/suggestions", response_model=list[SuggestionOut])
async def suggestions(
    project_id: uuid.UUID,
    suggestion_status: Literal["open", "accepted", "dismissed"] | None = Query(default="open", alias="status"),
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> list[SuggestionOut]:
    project = await _owned_project(session, project_id, key)
    query = select(Suggestion).where(Suggestion.project_id == project.id)
    if suggestion_status is not None:
        query = query.where(Suggestion.status == suggestion_status)
    rows = (await session.execute(query.order_by(Suggestion.created_at.desc()))).scalars().all()
    return [
        SuggestionOut(
            id=s.id, kind=s.kind, status=s.status, text=s.text_, entry_id=s.entry_id,
            related_entry_id=s.related_entry_id, message_id=s.message_id, created_at=s.created_at,
        )
        for s in rows
    ]


@router.post("/suggestions/{suggestion_id}/{decision}", response_model=SuggestionResult)
async def decide_suggestion(
    suggestion_id: uuid.UUID,
    decision: Literal["accept", "dismiss"],
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> SuggestionResult:
    suggestion = await _owned_suggestion(session, suggestion_id, key)
    try:
        if decision == "accept":
            result = await adjust.accept(session, suggestion.id, key.user_id)
        else:
            result = await adjust.dismiss(session, suggestion.id, key.user_id)
    except Refused as exc:
        raise _refused(exc) from exc
    except adjust.NotFound as exc:
        raise _not_found("entry or message behind this suggestion") from exc
    return SuggestionResult(
        suggestion_id=suggestion.id,
        status="accepted" if decision == "accept" else "dismissed",
        adjusted=_out(result),
    )
