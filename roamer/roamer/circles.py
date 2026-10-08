"""Search circles: where most lost animals of a kind were found, according to published studies.

A circle is a base rate, drawn and labelled as one - never a prediction for a particular
animal. Every figure below was taken from the paper itself, not from a summary of it, and
every circle carries its source onto the page. A species or situation the studies do not
cover gets no circle rather than a guessed one.

These circles are also the baseline that any future model of where lost pets go has to beat
before it is shown to anyone (stage 12).

Both studies measured from the animal's home or point of escape. roamer's pin is where it was
last seen, which is often the same place and sometimes not; the caption says so.
"""

from __future__ import annotations

from dataclasses import dataclass

# How the owner described the animal's access to outdoors. Changes the circle for cats - an
# indoor-only cat is usually found within a few houses - and is kept for the future model.
OUTDOOR_ACCESS = ("indoor_only", "indoor_outdoor", "outdoor", "unknown")
OUTDOOR_ACCESS_LABELS = {
    "indoor_only": "Never goes outside on its own",
    "indoor_outdoor": "Goes outside on its own sometimes",
    "outdoor": "Lives mostly outdoors",
    "unknown": "Not sure",
}


@dataclass(frozen=True)
class Source:
    short: str
    citation: str
    url: str


HUANG_2018 = Source(
    short="Huang et al. 2018",
    citation=(
        "Huang L, Coradini M, Rand J, Morton J, Albrecht K, Wasson B, Robertson D. Search "
        "Methods Used to Locate Missing Cats and Locations Where Missing Cats Are Found. "
        "Animals 2018;8(1):5."
    ),
    url="https://doi.org/10.3390/ani8010005",
)

KREMER_2021 = Source(
    short="Kremer 2021",
    citation=(
        "Kremer T. A New Web-Based Tool for RTO-Focused Animal Shelter Data Analysis. "
        "Frontiers in Veterinary Science 2021;8:669428."
    ),
    url="https://doi.org/10.3389/fvets.2021.669428",
)


@dataclass(frozen=True)
class SearchCircle:
    outer_m: int
    outer_share: str  # "75%"
    inner_m: int
    inner_share: str
    group: str  # who the figure is about, in words: "cats that go outside on their own"
    sample: str  # "150 cats"
    source: Source


# Huang et al. 2018: 477 cats found alive, distance from the point of escape. Median and 75th
# percentile per group, as published. The outdoor-only group was 15 cats - too few to stand on
# its own - so outdoor cats use the indoor-outdoor figures, whose 75th percentile (1609 m) is
# the same as the outdoor-only group's.
CAT_CIRCLES = {
    "indoor_only": SearchCircle(137, "75%", 39, "half", "indoor-only cats", "164 cats", HUANG_2018),
    "indoor_outdoor": SearchCircle(
        1609, "75%", 300, "half", "cats that go outside on their own", "150 cats", HUANG_2018
    ),
    "outdoor": SearchCircle(
        1609, "75%", 300, "half", "cats that go outside on their own", "150 cats", HUANG_2018
    ),
    "unknown": SearchCircle(500, "75%", 50, "half", "lost cats", "477 cats", HUANG_2018),
}

# Kremer 2021: Dallas Animal Services, fiscal 2019, 10,000 stray dogs returned to owners with
# a known home address; straight-line distance from home to where the dog was found. 70%
# within one mile, 42% within 400 feet. No breakdown by outdoor access exists, so dogs get one
# circle whatever the answer.
DOG_CIRCLE = SearchCircle(1609, "70%", 122, "42%", "stray dogs", "10,000 dogs", KREMER_2021)


def circle_for(species: str, outdoor_access: str | None) -> SearchCircle | None:
    if species == "dog":
        return DOG_CIRCLE
    if species == "cat":
        return CAT_CIRCLES.get(outdoor_access or "unknown", CAT_CIRCLES["unknown"])
    return None


def describe_distance(metres: int) -> str:
    """'137 m', '1.6 km (1 mile)'. A mile is how the dog figure was published."""
    if metres == 1609:
        return "1.6 km (1 mile)"
    if metres >= 1000:
        return f"{metres / 1000:.1f} km"
    return f"{metres} m"
