"""Request and response shapes for the two ingest doors."""

from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, Field

VENDORS = ("chatgpt", "claude", "gemini", "copilot", "api", "manual", "other")


class PasteRequest(BaseModel):
    text: str = Field(description="The transcript. 'User:'/'Assistant:' markers, or JSON turns.")
    vendor: str = "manual"
    project_id: uuid.UUID | None = None
    title: str | None = None
    conversation_id: uuid.UUID | None = Field(
        default=None,
        description=(
            "Append to an existing conversation instead of resolving a new one. Use this to "
            "paste a continued transcript: the turns already stored are recognised by their "
            "content hash and only the new ones are added."
        ),
    )


class IngestEvent(BaseModel):
    """One observed turn, as the browser extension will send it."""

    vendor: str
    vendor_conv_id: str | None = None
    role: str
    content: str
    # The client computes a hash too. The server recomputes it and the server's wins - a
    # client that hashed differently must not be able to slip a duplicate past the unique
    # constraint. A mismatch is reported rather than trusted or silently ignored.
    content_hash: str | None = None
    position: int | None = None
    captured_at: dt.datetime | None = None
    title: str | None = None
    model_hint: str | None = None


class IngestBatch(BaseModel):
    events: list[IngestEvent]
    project_id: uuid.UUID | None = None


class IngestResult(BaseModel):
    accepted: int
    duplicates: int
    conversation_ids: list[uuid.UUID]
    tokens: int
    # Anything the caller should know: a dropped preamble, a hash the client got wrong, a
    # marker with nothing after it. Reported rather than swallowed.
    notes: list[str] = []
    derive_enqueued: bool = False


class MessageOut(BaseModel):
    id: uuid.UUID
    seq: int
    position: int | None
    role: str
    content: str
    token_count: int
    captured_at: dt.datetime

    model_config = {"from_attributes": True}


class ConversationMessages(BaseModel):
    conversation_id: uuid.UUID
    vendor: str
    title: str | None
    message_count: int
    token_count: int
    messages: list[MessageOut]
