"""Adventure routes — create/list/get/delete itineraries + the Discover feed."""

from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import AdventureServiceDep, CurrentUser
from app.schemas.adventure import AdventureCreate, AdventureRead

router = APIRouter(prefix="/adventures", tags=["adventures"])


@router.post(
    "",
    response_model=AdventureRead,
    status_code=status.HTTP_201_CREATED,
    summary="Log a new adventure",
)
def create_adventure(
    data: AdventureCreate, current_user: CurrentUser, service: AdventureServiceDep
) -> AdventureRead:
    adventure = service.create_adventure(current_user.id, data)
    return AdventureRead.model_validate(adventure)


@router.get("", response_model=list[AdventureRead], summary="List my logged adventures")
def list_my_adventures(
    current_user: CurrentUser, service: AdventureServiceDep
) -> list[AdventureRead]:
    adventures = service.list_my_adventures(current_user.id)
    return [AdventureRead.model_validate(adventure) for adventure in adventures]


@router.get("/discover", response_model=list[AdventureRead], summary="Public Discover feed")
def discover(service: AdventureServiceDep) -> list[AdventureRead]:
    adventures = service.list_discover()
    return [AdventureRead.model_validate(adventure) for adventure in adventures]


@router.get("/{adventure_id}", response_model=AdventureRead, summary="Get one of my adventures")
def get_adventure(
    adventure_id: int, current_user: CurrentUser, service: AdventureServiceDep
) -> AdventureRead:
    adventure = service.get_owned(adventure_id, current_user.id)
    return AdventureRead.model_validate(adventure)


@router.delete(
    "/{adventure_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete one of my adventures",
)
def delete_adventure(
    adventure_id: int, current_user: CurrentUser, service: AdventureServiceDep
) -> None:
    service.delete_adventure(adventure_id, current_user.id)
