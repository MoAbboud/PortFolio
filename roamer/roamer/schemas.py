"""What comes in from the form and the API, and what goes out to the map.

The input model is shared by the HTML form and `POST /api/listings`, so the two can never
accept different things. The output model is what a pin needs and nothing more: no email,
no phone, no owner. The listing page is where the phone number is shown, and only there.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Species = Literal["dog", "cat", "other"]
Sex = Literal["male", "female", "unknown"]
Size = Literal["small", "medium", "large"]
Precision = Literal["exact", "approximate"]
OutdoorAccess = Literal["indoor_only", "indoor_outdoor", "outdoor", "unknown"]

# A clock a few minutes fast in the owner's phone must not make "I saw her just now" an
# error. Ten minutes covers that and still refuses a date in the future by mistake.
CLOCK_SKEW = timedelta(minutes=10)

PHONE_CHARACTERS = re.compile(r"^[0-9+()\-. ]+$")
MIN_PHONE_DIGITS = 7


class ListingCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    species: Species
    name: str | None = Field(default=None, max_length=60)
    sex: Sex = "unknown"
    breed: str | None = Field(default=None, max_length=120)
    colours: str | None = Field(default=None, max_length=120)
    size: Size | None = None
    age_text: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=2000)
    approach_advice: str | None = Field(default=None, max_length=500)
    outdoor_access: OutdoorAccess = "unknown"

    last_seen_at: datetime
    last_seen_lat: float = Field(ge=-90, le=90)
    last_seen_lng: float = Field(ge=-180, le=180)
    location_precision: Precision = "exact"
    area_label: str | None = Field(default=None, max_length=120)

    contact_name: str | None = Field(default=None, max_length=80)
    contact_phone: str = Field(max_length=40)
    show_phone: bool = True
    email: EmailStr

    @field_validator(
        "name",
        "breed",
        "colours",
        "size",
        "age_text",
        "description",
        "approach_advice",
        "area_label",
        "contact_name",
        mode="before",
    )
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        # A form sends every field, and an untouched optional field arrives as "". Stored as
        # NULL, so "not given" has one representation rather than two.
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("last_seen_at")
    @classmethod
    def not_in_the_future(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            # Ambiguous: whose midnight? The form sends a UTC ISO string built in the browser,
            # so a naive value here is a client bug, and guessing would be wrong by hours.
            raise ValueError("must include a timezone")
        if value > datetime.now(timezone.utc) + CLOCK_SKEW:
            raise ValueError("is in the future")
        return value

    @field_validator("contact_phone")
    @classmethod
    def phone_is_dialable(cls, value: str) -> str:
        if not PHONE_CHARACTERS.match(value):
            raise ValueError("may only contain digits, spaces and + ( ) - .")
        if sum(c.isdigit() for c in value) < MIN_PHONE_DIGITS:
            raise ValueError(f"needs at least {MIN_PHONE_DIGITS} digits")
        return value


class ListingPin(BaseModel):
    """One pin on the public map."""

    code: str
    species: Species
    name: str | None
    lat: float
    lng: float
    approximate: bool
    last_seen_at: datetime
    area_label: str | None
    verified: bool
    stale: bool
    last_confirmed_at: datetime | None
    thumb_url: str | None
    url: str


class NearPin(ListingPin):
    """A pin from the finder's search: the same, plus how far away it is."""

    distance_m: float


class PlaceOut(BaseModel):
    label: str
    lat: float
    lng: float


class ListingCreated(BaseModel):
    code: str
    status: str
    message: str
