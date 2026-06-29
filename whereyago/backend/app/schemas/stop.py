"""Stop schemas."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import StopType

_TIME_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"  # 24h "HH:MM"


class StopBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: StopType
    time: str | None = Field(default=None, pattern=_TIME_PATTERN)
    note: str | None = Field(default=None, max_length=2000)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    event: dict[str, Any] | None = None


class StopCreate(StopBase):
    """A stop as supplied when creating a day."""


class StopRead(StopBase):
    """A stored stop returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int
