"""Adventure (itinerary) business logic."""

from __future__ import annotations

from collections.abc import Sequence

from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.logging import get_logger
from app.models.adventure import Adventure
from app.models.adventure_stats import AdventureStats
from app.models.stop import Stop
from app.models.weather import Weather
from app.repositories.adventure_repository import AdventureRepository
from app.schemas.adventure import AdventureCreate

logger = get_logger("service.adventure")


class AdventureService:
    """Create, read and delete adventures, enforcing ownership rules."""

    def __init__(self, adventures: AdventureRepository) -> None:
        self._adventures = adventures

    def create_adventure(self, owner_id: int, data: AdventureCreate) -> Adventure:
        """Persist a new adventure with its stops, a stats row, and weather."""
        adventure = Adventure(
            owner_id=owner_id,
            title=data.title,
            summary=data.summary,
            vibe=data.vibe,
            city=data.city,
            date=data.date,
            stats=AdventureStats(),
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
        if data.weather is not None:
            adventure.weather = Weather(
                code=data.weather.code,
                temp_max=data.weather.temp_max,
                temp_min=data.weather.temp_min,
                description=data.weather.description,
            )
        self._adventures.add(adventure)
        logger.info(
            "adventure.created",
            adventure_id=adventure.id,
            owner_id=owner_id,
            stops=len(adventure.stops),
        )
        return adventure

    def list_my_adventures(self, owner_id: int) -> Sequence[Adventure]:
        return self._adventures.list_by_owner(owner_id)

    def list_discover(self) -> Sequence[Adventure]:
        return self._adventures.list_shared()

    def get_owned(self, adventure_id: int, owner_id: int) -> Adventure:
        adventure = self._adventures.get(adventure_id)
        if adventure is None:
            raise NotFoundError("Adventure not found.")
        if adventure.owner_id != owner_id:
            raise ForbiddenError("You can only access your own adventures.")
        return adventure

    def delete_adventure(self, adventure_id: int, owner_id: int) -> None:
        adventure = self.get_owned(adventure_id, owner_id)
        self._adventures.delete(adventure)
        logger.info("adventure.deleted", adventure_id=adventure_id, owner_id=owner_id)
