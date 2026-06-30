"""Adventure schemas (+ nested weather and stats)."""

from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import Vibe
from app.schemas.stop import StopCreate, StopRead


class WeatherIn(BaseModel):
    code: int | None = None
    temp_max: float | None = None
    temp_min: float | None = None
    description: str | None = Field(default=None, max_length=100)


class WeatherRead(WeatherIn):
    model_config = ConfigDict(from_attributes=True)


class StatsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    views: int = 0
    likes_count: int = 0
    comments_count: int = 0


class AdventureBase(BaseModel):
    title: str = Field(min_length=1, max_length=140)
    summary: str | None = Field(default=None, max_length=2000)
    vibe: Vibe
    city: str | None = Field(default=None, max_length=140)
    date: datetime.date | None = None


class AdventureCreate(AdventureBase):
    """Payload for creating an adventure, with its stops in order."""

    stops: list[StopCreate] = Field(default_factory=list, max_length=50)
    weather: WeatherIn | None = None


class AdventureRead(AdventureBase):
    """A stored adventure returned to clients."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    is_shared: bool
    stops: list[StopRead] = Field(default_factory=list)
    weather: WeatherRead | None = None
    stats: StatsRead | None = None
