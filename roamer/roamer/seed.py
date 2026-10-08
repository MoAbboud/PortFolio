"""Put the demo's made-up listings on the map.

    docker compose exec web python -m roamer.seed

Every animal here is invented. The places are real Kansas City parks and neighbourhoods,
because a map of made-up places would not show what the site does; the phone numbers are in
555-0100 to 555-0199, the range reserved for fiction; the email addresses are at
example.com, which is reserved for examples and receives no mail; and every description
says it is a demo.

Running it again replaces the seeded listings rather than adding a second set. Listings a
person posted are never touched. Stage 9's daily demo reset will call `reseed()`.

The listings go through the same validation and the same service as the form, so a seed that
the form would refuse fails here too.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, exists, select
from sqlalchemy.orm import Session

from roamer import listings as service
from roamer.db import SessionLocal
from roamer.models import Listing, Owner
from roamer.schemas import ListingCreate

DEMO_NOTE = "This is a demo listing. The animal is made up."

# (hours since last seen, fields). Spread from two hours to forty days, so the map's
# "missing since" filter has something to filter: the forty-day one only shows under
# "Any time".
SEEDS: list[tuple[float, dict]] = [
    (2, dict(species="dog", name="Biscuit", sex="female", size="medium", age_text="About 3",
             breed="Beagle mix", colours="Tan, white chest",
             description="Red collar with a bell. Very friendly but nervous of traffic.",
             approach_advice="She comes to her name and loves cheese. Please do not chase her.",
             last_seen_lat=39.0329, last_seen_lng=-94.5936, area_label="Loose Park",
             contact_name="Dana", contact_phone="(816) 555-0101")),
    (5, dict(species="cat", name="Pepper", sex="male", size="small", age_text="7",
             colours="Black, one white paw",
             description="Indoor cat, got out through a window. Microchipped.",
             outdoor_access="indoor_only",
             approach_advice="Will hide under porches. Leave food out and call us.",
             last_seen_lat=39.0533, last_seen_lng=-94.5913, area_label="Westport",
             contact_name="Sam", contact_phone="(816) 555-0102")),
    (26, dict(species="dog", name="Moose", sex="male", size="large", age_text="5",
              breed="Bernese mountain dog", colours="Black, rust and white",
              description="Huge and gentle. Blue harness, no tag.",
              approach_advice="Safe to approach. He will probably lean on you.",
              last_seen_lat=39.0122, last_seen_lng=-94.5911, area_label="Brookside",
              contact_name="Priya", contact_phone="(816) 555-0103")),
    (50, dict(species="dog", name="Juniper", sex="female", size="small", age_text="Puppy",
              breed="Terrier mix", colours="Grey and white, wiry coat",
              description="Five months old, pink collar.",
              approach_advice="Very shy. Do not reach for her - sit down and wait.",
              last_seen_lat=39.0418, last_seen_lng=-94.5935, area_label="Country Club Plaza",
              location_precision="approximate",
              contact_name="Alex", contact_phone="(816) 555-0104")),
    (75, dict(species="cat", name="Miso", sex="female", size="small", age_text="2",
              colours="Calico",
              description="Slim, very talkative. No collar.",
              outdoor_access="indoor_outdoor",
              last_seen_lat=39.0822, last_seen_lng=-94.5823, area_label="Crown Center",
              contact_name="Jordan", contact_phone="(816) 555-0105")),
    (100, dict(species="dog", name="Rocket", sex="male", size="medium", age_text="4",
               breed="Australian shepherd", colours="Blue merle, one blue eye",
               description="Slipped his lead near the river. Green collar.",
               approach_advice="Fast and wary of men. Crouch, turn sideways, toss treats.",
               last_seen_lat=39.1097, last_seen_lng=-94.5826, area_label="River Market",
               contact_name="Chris", contact_phone="(816) 555-0106")),
    (144, dict(species="other", name="Clover", sex="female", size="small",
               breed="Holland lop rabbit", colours="White with brown ears",
               description="Pet rabbit, escaped from a garden hutch.",
               approach_advice="Easiest caught with a towel. Do not lift by the ears.",
               last_seen_lat=39.0441, last_seen_lng=-94.5762, area_label="Hyde Park",
               contact_name="Morgan", contact_phone="(816) 555-0107")),
    (216, dict(species="dog", name="Duchess", sex="female", size="large", age_text="10",
               breed="Greyhound", colours="Brindle",
               description="Retired racer, thin coat, may be cold. Purple martingale collar.",
               approach_advice="She will run if startled. Please call rather than approach.",
               last_seen_lat=39.0003, last_seen_lng=-94.5303, area_label="Swope Park",
               location_precision="approximate",
               contact_name="Riley", contact_phone="(816) 555-0108")),
    (288, dict(species="cat", name="Waffles", sex="male", size="medium", age_text="5",
               colours="Orange tabby",
               description="Big orange cat, very food-motivated.",
               outdoor_access="indoor_outdoor",
               last_seen_lat=38.9853, last_seen_lng=-94.5947, area_label="Waldo",
               contact_name="Taylor", contact_phone="(816) 555-0109")),
    (432, dict(species="dog", name=None, sex="unknown", size="small",
               breed="Chihuahua mix", colours="Fawn",
               description="Name not known - fostered for two days before it escaped. "
                           "Tiny, wearing a yellow sweater.",
               last_seen_lat=39.1105, last_seen_lng=-94.5694, area_label="Columbus Park",
               contact_name="Casey", contact_phone="(816) 555-0110")),
    (600, dict(species="cat", name="Ghost", sex="female", size="small", age_text="12",
               colours="White, deaf",
               description="Deaf, so she will not come when called. Thin, older cat.",
               outdoor_access="indoor_only",
               approach_advice="Approach from the front so she can see you.",
               last_seen_lat=39.0772, last_seen_lng=-94.5893, area_label="Penn Valley Park",
               contact_name="Jamie", contact_phone="(816) 555-0111")),
    (960, dict(species="dog", name="Otis", sex="male", size="medium", age_text="8",
               breed="Basset hound", colours="Tricolour",
               description="Follows his nose. Missing for weeks, still looking.",
               last_seen_lat=39.0450, last_seen_lng=-94.5809,
               area_label="Near the Nelson-Atkins museum",
               contact_name="Avery", contact_phone="(816) 555-0112")),
]


def clear(session: Session) -> int:
    """Delete every seeded listing, and demo owners left with nothing. Returns the count."""
    seeded_ids = session.scalars(select(Listing.id).where(Listing.seeded.is_(True))).all()
    removed = service.delete_listings(session, seeded_ids)
    session.execute(
        delete(Owner).where(
            Owner.email.like("demo-%@example.com"),
            ~exists().where(Listing.owner_id == Owner.id),
        )
    )
    return removed


def reseed(session: Session, now: datetime | None = None) -> list[Listing]:
    now = now or datetime.now(timezone.utc)
    clear(session)
    session.commit()

    created = []
    for number, (hours_ago, fields) in enumerate(SEEDS, start=1):
        description = f"{fields.get('description', '')} {DEMO_NOTE}".strip()
        data = ListingCreate(
            **{**fields, "description": description},
            last_seen_at=now - timedelta(hours=hours_ago),
            email=f"demo-{number:02d}@example.com",
        )
        created.append(
            service.create_listing(session, data, seeded=True, pre_verified=True, now=now)
        )
    return created


def main() -> None:
    with SessionLocal() as session:
        created = reseed(session)
        print(f"Seeded {len(created)} demo listings:")
        for listing in created:
            print(f"  /l/{listing.code}  {listing.species:<5}  {listing.name or '(no name)'}")


if __name__ == "__main__":
    main()
