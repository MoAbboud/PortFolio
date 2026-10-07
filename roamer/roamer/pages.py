"""Server-rendered pages: the map, the listing form, and the listing page.

The form posts to the same service as `POST /api/listings` and is validated by the same
model, so the two can never accept different things. On a validation error the form is
shown again with what was typed still in it and the problem beside the field.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer.config import settings
from roamer.db import get_session
from roamer.schemas import ListingCreate

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

router = APIRouter(tags=["pages"])

# The labels a person reads for the codes the database stores.
SPECIES_LABELS = {"dog": "Dog", "cat": "Cat", "other": "Other animal"}
SEX_LABELS = {"male": "Male", "female": "Female", "unknown": "Not sure"}
SIZE_LABELS = {"small": "Small", "medium": "Medium", "large": "Large"}


def time_ago(moment: datetime, now: datetime | None = None) -> str:
    """'just now', '3 hours ago', '2 days ago'. Coarse on purpose; the exact time is beside it."""
    now = now or datetime.now(timezone.utc)
    seconds = max(0, int((now - moment).total_seconds()))
    for unit, size in (("day", 86400), ("hour", 3600), ("minute", 60)):
        if seconds >= size:
            count = seconds // size
            return f"{count} {unit}{'' if count == 1 else 's'} ago"
    return "just now"


templates.env.globals.update(
    SPECIES_LABELS=SPECIES_LABELS,
    SEX_LABELS=SEX_LABELS,
    SIZE_LABELS=SIZE_LABELS,
    time_ago=time_ago,
    APPROXIMATE_RADIUS_M=service.APPROXIMATE_RADIUS_M,
)


def map_defaults() -> dict:
    return {
        "lat": settings.map_center_lat,
        "lng": settings.map_center_lng,
        "zoom": settings.map_zoom,
    }


@router.get("/", response_class=HTMLResponse)
def map_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "map.html", {"map": map_defaults()})


@router.get("/listings/new", response_class=HTMLResponse)
def new_listing_form(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request, "new.html", {"map": map_defaults(), "values": {}, "errors": {}}
    )


def _form_errors(exc: ValidationError) -> dict[str, str]:
    errors: dict[str, str] = {}
    for error in exc.errors():
        field = str(error["loc"][0]) if error["loc"] else "form"
        message = error["msg"].removeprefix("Value error, ")
        errors.setdefault(field, message)
    return errors


@router.post("/listings", response_class=HTMLResponse)
async def create_from_form(request: Request, session: Session = Depends(get_session)):
    form = await request.form()
    values = {key: value for key, value in form.items() if isinstance(value, str)}
    # An unticked checkbox sends nothing at all, so absence is the only way to read "no".
    payload = {**values, "show_phone": "show_phone" in values}

    try:
        data = ListingCreate.model_validate(payload)
    except ValidationError as exc:
        return templates.TemplateResponse(
            request,
            "new.html",
            {"map": map_defaults(), "values": values, "errors": _form_errors(exc)},
            status_code=400,
        )

    listing = service.create_listing(session, data)
    # 303, so a refresh of the page it lands on is a GET and does not post the form again.
    return RedirectResponse(f"/l/{listing.code}?posted=1", status_code=303)


@router.get("/l/{code}", response_class=HTMLResponse)
def listing_page(request: Request, code: str, session: Session = Depends(get_session)):
    listing = service.get_by_code(session, code)
    if listing is None or not service.is_public(listing):
        return templates.TemplateResponse(request, "not_found.html", {}, status_code=404)
    return templates.TemplateResponse(
        request,
        "listing.html",
        {"listing": listing, "posted": request.query_params.get("posted") == "1"},
    )
