"""Response shapes for the API.

Separate from the ORM models on purpose. What the database stores and what the API promises
are two different contracts, and letting a column rename break a caller is how they get
tangled.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class StatusEvent(BaseModel):
    """One entry from a document's status history."""

    from_status: str | None = Field(default=None, alias="from")
    to_status: str = Field(alias="to")
    at: datetime
    actor: str
    detail: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class DocumentOut(BaseModel):
    """A document as the API reports it."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    filename: str
    mime_type: str
    doc_type: str
    status: str
    uploaded_at: datetime
    processed_at: datetime | None = None
    status_history: list[dict[str, Any]] = Field(default_factory=list)


class ErrorOut(BaseModel):
    """A refusal, with enough detail to know whether to wait or to give up."""

    detail: str
    media_type: str | None = None
