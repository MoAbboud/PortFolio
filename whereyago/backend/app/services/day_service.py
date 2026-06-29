"""Day (itinerary) business logic."""

from __future__ import annotations

from collections.abc import Sequence

from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.logging import get_logger
from app.models.day import Day
from app.models.stop import Stop
from app.repositories.day_repository import DayRepository
from app.schemas.day import DayCreate

logger = get_logger("service.day")


class DayService:
    """Create, read and delete days, enforcing ownership rules."""

    def __init__(self, days: DayRepository) -> None:
        self._days = days

    def create_day(self, owner_id: int, data: DayCreate) -> Day:
        """Persist a new day and its ordered stops for ``owner_id``."""
        day = Day(
            owner_id=owner_id,
            title=data.title,
            summary=data.summary,
            vibe=data.vibe,
            city=data.city,
            date=data.date,
            weather=data.weather,
            stops=[
                Stop(
                    position=index,
                    name=stop.name,
                    type=stop.type,
                    time=stop.time,
                    note=stop.note,
                    lat=stop.lat,
                    lon=stop.lon,
                    event=stop.event,
                )
                for index, stop in enumerate(data.stops)
            ],
        )
        self._days.add(day)
        logger.info("day.created", day_id=day.id, owner_id=owner_id, stops=len(day.stops))
        return day

    def list_my_days(self, owner_id: int) -> Sequence[Day]:
        """All days owned by a user, newest first."""
        return self._days.list_by_owner(owner_id)

    def list_discover(self) -> Sequence[Day]:
        """All days shared to the public Discover feed."""
        return self._days.list_shared()

    def get_owned(self, day_id: int, owner_id: int) -> Day:
        """Fetch a day, asserting the requester owns it."""
        day = self._days.get(day_id)
        if day is None:
            raise NotFoundError("Day not found.")
        if day.owner_id != owner_id:
            raise ForbiddenError("You can only access your own days.")
        return day

    def delete_day(self, day_id: int, owner_id: int) -> None:
        """Delete a day the requester owns."""
        day = self.get_owned(day_id, owner_id)
        self._days.delete(day)
        logger.info("day.deleted", day_id=day_id, owner_id=owner_id)
