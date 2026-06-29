"""Day routes — create/list/get/delete itineraries + the Discover feed."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DayServiceDep
from app.schemas.day import DayCreate, DayRead

router = APIRouter(prefix="/days", tags=["days"])


@router.post(
    "",
    response_model=DayRead,
    status_code=status.HTTP_201_CREATED,
    summary="Log a new day",
)
def create_day(data: DayCreate, current_user: CurrentUser, service: DayServiceDep) -> DayRead:
    day = service.create_day(current_user.id, data)
    return DayRead.model_validate(day)


@router.get("", response_model=list[DayRead], summary="List my logged days")
def list_my_days(current_user: CurrentUser, service: DayServiceDep) -> list[DayRead]:
    days = service.list_my_days(current_user.id)
    return [DayRead.model_validate(day) for day in days]


@router.get("/discover", response_model=list[DayRead], summary="Public Discover feed")
def discover(service: DayServiceDep) -> list[DayRead]:
    days = service.list_discover()
    return [DayRead.model_validate(day) for day in days]


@router.get("/{day_id}", response_model=DayRead, summary="Get one of my days")
def get_day(day_id: int, current_user: CurrentUser, service: DayServiceDep) -> DayRead:
    day = service.get_owned(day_id, current_user.id)
    return DayRead.model_validate(day)


@router.delete(
    "/{day_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete one of my days",
)
def delete_day(day_id: int, current_user: CurrentUser, service: DayServiceDep) -> None:
    service.delete_day(day_id, current_user.id)
