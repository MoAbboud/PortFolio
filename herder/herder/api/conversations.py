"""Reading the raw log back.

Exists at stage 1 so an ingest can be checked from PowerShell. It is also, later, what the
lineage panel reads when somebody asks why an entry says what it says.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.core.security import require_key
from herder.models import ApiKey, Conversation, Message, Project
from herder.schemas.ingest import ConversationMessages, MessageOut

router = APIRouter(prefix="/v1", tags=["conversations"])


@router.get("/conversations/{conversation_id}/messages", response_model=ConversationMessages)
async def messages(
    conversation_id: uuid.UUID,
    after_seq: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=1000),
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> ConversationMessages:
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such conversation")

    project = await session.get(Project, conversation.project_id)
    if project is None or project.workspace_id != key.workspace_id:
        # Same answer as a missing conversation on purpose: whether an id exists in someone
        # else's workspace is not something this endpoint should confirm.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such conversation")

    result = await session.execute(
        select(Message)
        .where(Message.conversation_id == conversation_id, Message.seq > after_seq)
        # Thread order, not arrival order. `seq` is when it reached us and never changes;
        # `client_position` is where it sits in the conversation. They differ only when
        # something arrived late, and then this ordering is the one that is right.
        .order_by(Message.client_position.nulls_last(), Message.seq)
        .limit(limit)
    )
    rows = result.scalars().all()

    return ConversationMessages(
        conversation_id=conversation.id,
        vendor=conversation.vendor,
        title=conversation.title,
        message_count=conversation.message_count,
        token_count=conversation.token_count,
        messages=[
            MessageOut(
                id=m.id,
                seq=m.seq,
                position=m.client_position,
                role=m.role,
                content=m.content,
                token_count=m.token_count,
                captured_at=m.captured_at,
            )
            for m in rows
        ],
    )
