"""Server-rendered pages: the map, the listing form, the listing page, and email links.

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
from starlette.datastructures import UploadFile

from roamer import checkins, circles, images
from roamer import listings as service
from roamer.config import settings
from roamer.db import get_session
from roamer.models import FOUND_HOW, FOUND_HOW_LABELS
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
    OUTDOOR_ACCESS_LABELS=circles.OUTDOOR_ACCESS_LABELS,
    FOUND_HOW_LABELS=FOUND_HOW_LABELS,
    is_stale=service.is_stale,
    STALE_AFTER_DAYS=settings.stale_after_days,
    circle_for=circles.circle_for,
    describe_distance=circles.describe_distance,
    time_ago=time_ago,
    is_verified=service.is_verified,
    APPROXIMATE_RADIUS_M=service.APPROXIMATE_RADIUS_M,
    IMAGE_ACCEPT=images.ACCEPT_ATTRIBUTE,
    MAX_PHOTOS=images.MAX_PHOTOS,
    MAX_PHOTO_MB=images.MAX_BYTES // (1024 * 1024),
)


def get_image_store() -> images.ImageStore:
    """A dependency, so tests can swap in a store that never touches the disk."""
    return images.default_store()


def map_defaults() -> dict:
    return {
        "lat": settings.map_center_lat,
        "lng": settings.map_center_lng,
        "zoom": settings.map_zoom,
    }


@router.get("/", response_class=HTMLResponse)
def map_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "map.html", {"map": map_defaults()})


@router.get("/found", response_class=HTMLResponse)
def found_page(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request, "found.html", {"map": map_defaults()})


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


def _chosen(value: object) -> bool:
    # A file input left empty still sends a part, with no file name and no bytes.
    #
    # Starlette's UploadFile, not FastAPI's: request.form() returns Starlette's, and FastAPI's
    # is a subclass of it, so an isinstance check against FastAPI's is always false - which
    # silently ignored every upload the first time this was written.
    return isinstance(value, UploadFile) and bool(value.filename)


async def _read_image(upload: UploadFile) -> images.ProcessedImage:
    # One byte past the limit is enough to know it is over; no need to read a huge file.
    data = await upload.read(images.MAX_BYTES + 1)
    return images.process(data)


async def _process_uploads(
    form,
) -> tuple[list[images.ProcessedImage], images.ProcessedImage | None, dict[str, str]]:
    errors: dict[str, str] = {}
    photos: list[images.ProcessedImage] = []
    uploads = [f for f in form.getlist("photos") if _chosen(f)]
    if len(uploads) > images.MAX_PHOTOS:
        errors["photos"] = f"Choose at most {images.MAX_PHOTOS} photos."
    else:
        for upload in uploads:
            try:
                photos.append(await _read_image(upload))
            except images.ImageRejected as exc:
                errors["photos"] = f"{upload.filename} {exc}."
                break

    flyer = None
    flyer_upload = form.get("flyer")
    if _chosen(flyer_upload):
        try:
            flyer = await _read_image(flyer_upload)
        except images.ImageRejected as exc:
            errors["flyer"] = f"{flyer_upload.filename} {exc}."
    return photos, flyer, errors


@router.post("/listings", response_class=HTMLResponse)
async def create_from_form(
    request: Request,
    session: Session = Depends(get_session),
    store: images.ImageStore = Depends(get_image_store),
):
    # max_files bounds how many file parts are even parsed: the photos, the flyer, one spare.
    form = await request.form(max_files=images.MAX_PHOTOS + 2)
    values = {key: value for key, value in form.items() if isinstance(value, str)}
    # An unticked checkbox sends nothing at all, so absence is the only way to read "no".
    payload = {**values, "show_phone": "show_phone" in values}

    errors: dict[str, str] = {}
    data = None
    try:
        data = ListingCreate.model_validate(payload)
    except ValidationError as exc:
        errors.update(_form_errors(exc))
    # Images are checked even when a field failed, so every problem shows at once.
    photos, flyer, image_errors = await _process_uploads(form)
    errors.update(image_errors)

    if errors:
        # A browser cannot refill a file input, so chosen files have to be chosen again.
        had_files = any(_chosen(f) for f in [*form.getlist("photos"), form.get("flyer")])
        return templates.TemplateResponse(
            request,
            "new.html",
            {
                "map": map_defaults(),
                "values": values,
                "errors": errors,
                "files_lost": had_files,
            },
            status_code=400,
        )

    listing = service.create_listing(session, data, photos=photos, flyer=flyer, store=store)
    # 303, so a refresh of the page it lands on is a GET and does not post the form again.
    return RedirectResponse(f"/listings/sent?code={listing.code}", status_code=303)


@router.get("/listings/sent", response_class=HTMLResponse)
def check_your_email(request: Request, code: str = "", session: Session = Depends(get_session)):
    """After posting. Names the address, masked, so a typo in it is noticed now."""
    listing = service.get_by_code(session, code)
    if listing is None or listing.status != service.PENDING:
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse(
        request,
        "sent.html",
        {
            "masked": service.mask_email(listing.owner.email),
            "hours": settings.verify_token_hours,
            "mail_viewer_url": settings.mail_viewer_url,
        },
    )


@router.get("/verify/{token}", response_class=HTMLResponse)
def verify_page(request: Request, token: str, session: Session = Depends(get_session)):
    """Shows a button. Opening the link changes nothing - see check_verify_link."""
    result = service.check_verify_link(session, token)
    status = 404 if result.outcome is service.Verify.INVALID else 200
    return templates.TemplateResponse(
        request, "verify.html", {"result": result, "token": token}, status_code=status
    )


@router.post("/verify/{token}", response_class=HTMLResponse)
def verify_submit(request: Request, token: str, session: Session = Depends(get_session)):
    result = service.publish(session, token)
    if result.outcome is service.Verify.PUBLISHED:
        return RedirectResponse(f"/l/{result.listing.code}?posted=1", status_code=303)
    status = 404 if result.outcome is service.Verify.INVALID else 200
    return templates.TemplateResponse(
        request, "verify.html", {"result": result, "token": token}, status_code=status
    )


@router.post("/verify/{token}/resend", response_class=HTMLResponse)
def verify_resend(request: Request, token: str, session: Session = Depends(get_session)):
    result = service.resend_verify_link(session, token)
    if result.outcome in (service.Verify.READY, service.Verify.STALE):
        return RedirectResponse(f"/listings/sent?code={result.listing.code}", status_code=303)
    status = 404 if result.outcome is service.Verify.INVALID else 200
    return templates.TemplateResponse(
        request, "verify.html", {"result": result, "token": token}, status_code=status
    )


@router.get("/l/{code}", response_class=HTMLResponse)
def listing_page(request: Request, code: str, session: Session = Depends(get_session)):
    listing = service.get_by_code(session, code)
    if listing is None or not service.is_public(listing):
        return templates.TemplateResponse(request, "not_found.html", {}, status_code=404)
    return templates.TemplateResponse(
        request,
        "listing.html",
        {
            "listing": listing,
            "posted": request.query_params.get("posted") == "1",
            "confirmed": request.query_params.get("confirmed") == "1",
        },
    )


def _checkin_page(request: Request, token: str, result, choice="", errors=None, status=None):
    if status is None:
        status = 404 if result.outcome is checkins.Outcome.INVALID else 200
    return templates.TemplateResponse(
        request,
        "checkin.html",
        {
            "result": result,
            "token": token,
            "choice": choice,
            "errors": errors or {},
            "token_days": settings.checkin_token_days,
        },
        status_code=status,
    )


@router.get("/checkin/{token}", response_class=HTMLResponse)
def checkin_page(
    request: Request, token: str, answer: str = "", session: Session = Depends(get_session)
):
    """The check-in email's links land here. Shows the question; changes nothing.

    `answer` only highlights the choice clicked in the email - the owner still presses its
    button, because a mail scanner opening the "home" link must not end a search.
    """
    result = checkins.check(session, token)
    return _checkin_page(request, token, result, answer if answer in checkins.ANSWERS else "")


def _parse_found(form) -> tuple[checkins.Found, dict[str, str]]:
    errors: dict[str, str] = {}
    found = checkins.Found()

    how = (form.get("found_how") or "").strip()
    if how:
        if how in FOUND_HOW:
            found.how = how
        else:
            errors["found_how"] = "Choose one of the options."

    lat, lng = (form.get("found_lat") or "").strip(), (form.get("found_lng") or "").strip()
    if lat or lng:
        try:
            found.lat, found.lng = float(lat), float(lng)
            if not (-90 <= found.lat <= 90 and -180 <= found.lng <= 180):
                raise ValueError
        except ValueError:
            found.lat = found.lng = None
            errors["found_point"] = "That point is not on the map. Click the map again."

    when = (form.get("found_at") or "").strip()
    if when:
        try:
            moment = datetime.fromisoformat(when.replace("Z", "+00:00"))
            if moment.tzinfo is None or moment > datetime.now(timezone.utc):
                raise ValueError
            found.at = moment
        except ValueError:
            errors["found_at"] = "That time is not right."
    return found, errors


@router.post("/checkin/{token}", response_class=HTMLResponse)
async def checkin_answer(
    request: Request,
    token: str,
    session: Session = Depends(get_session),
    store: images.ImageStore = Depends(get_image_store),
):
    form = await request.form()
    choice = form.get("answer", "")
    if choice not in checkins.ANSWERS:
        return _checkin_page(request, token, checkins.check(session, token), status=400)

    found, errors = _parse_found(form) if choice == "home" else (None, {})
    if errors:
        result = checkins.check(session, token)
        return _checkin_page(request, token, result, choice, errors, status=400)

    result = checkins.answer(session, token, choice, found, store=store)
    if result.outcome is checkins.Outcome.CONFIRMED:
        return RedirectResponse(f"/l/{result.listing.code}?confirmed=1", status_code=303)
    if result.outcome is checkins.Outcome.HOME:
        return RedirectResponse(f"/l/{result.listing.code}", status_code=303)
    return _checkin_page(request, token, result)
