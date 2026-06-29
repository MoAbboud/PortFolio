"""Shared enumerations for the domain.

Inheriting from ``str`` keeps values JSON-serialisable and human-readable in the
database while still being validated everywhere.
"""

from __future__ import annotations

import enum


class Vibe(str, enum.Enum):
    """The "kind of day" a logged itinerary represents."""

    chill = "chill"
    foodie = "foodie"
    family = "family"
    adventure = "adventure"
    night = "night"
    culture = "culture"
    outdoors = "outdoors"


class StopType(str, enum.Enum):
    """The category of a single stop on a day."""

    restaurant = "restaurant"
    cafe = "cafe"
    event = "event"
    attraction = "attraction"
    outdoors = "outdoors"
    shop = "shop"
    bar = "bar"
    other = "other"
