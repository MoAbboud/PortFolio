"""Day schemas."""

from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Vibe
from app.schemas.stop import StopCreate, StopRead


class DayBase(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    summary: str | None = Field(default=None, max_length=2000)
    vibe: Vibe
    city: str | None = Field(default=None, max_length=140)
    date: date | None = None
    weather: dict[str, Any] | None = None


class DayCreate(DayBase):
    """Payload for creating a day, with its stops in order."""

    stops: list[StopCreate] = Field(default_factory=list, max_length=50)


class DayRead(DayBase):
    """A stored day returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    is_shared: bool
    stops: list[StopRead] = Field(default_factory=list)
