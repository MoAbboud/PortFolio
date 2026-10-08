"""Photos through the form, onto the page and the map, and away again with their listing."""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from roamer import images
from roamer import listings as service
from roamer.config import settings
from roamer.models import Listing, Photo
from tests.conftest import listing_data, verify_token_for
from tests.test_images import jpeg_with_gps_and_orientation
from tests.test_pages import form_fields


def png(colour=(30, 90, 160)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (60, 40), colour).save(out, format="PNG")
    return out.getvalue()


def post_with_files(client: TestClient, files: list, **overrides):
    return client.post(
        "/listings", data=form_fields(**overrides), files=files, follow_redirects=False
    )


def listing_named(session: Session, name: str) -> Listing | None:
    return session.scalars(select(Listing).where(Listing.name == name)).one_or_none()


def test_photos_and_a_flyer_are_stored_clean_and_shown(
    client: TestClient, db_session: Session, image_store: images.MemoryImageStore
) -> None:
    response = post_with_files(
        client,
        [
            ("photos", ("dog.jpg", jpeg_with_gps_and_orientation(), "image/jpeg")),
            ("photos", ("dog2.png", png(), "image/png")),
            ("flyer", ("flyer.png", png((250, 250, 250)), "image/png")),
        ],
        name="Photodog",
    )
    assert response.status_code == 303

    listing = listing_named(db_session, "Photodog")
    assert [(p.kind, p.position) for p in listing.photos] == [
        ("flyer", 0), ("photo", 0), ("photo", 1),
    ]
    # Two files per image, every one of them free of metadata.
    assert len(image_store.files) == 6
    for data in image_store.files.values():
        assert b"Exif" not in data

    client.post(f"/verify/{verify_token_for(db_session, listing)}")
    page = client.get(f"/l/{listing.code}")
    assert listing.animal_photos[0].display_url in page.text
    assert "The owner's flyer" in page.text

    pins = client.get("/api/listings", params={"bbox": "-94.7,38.9,-94.4,39.2"}).json()
    pin = next(p for p in pins if p["code"] == listing.code)
    assert pin["thumb_url"] == listing.animal_photos[0].thumb_url


def test_a_bad_file_sends_the_form_back_and_stores_nothing(
    client: TestClient, db_session: Session, image_store: images.MemoryImageStore
) -> None:
    response = post_with_files(
        client,
        [("photos", ("dog.jpg", b"not really a picture" * 10, "image/jpeg"))],
        name="Badphotodog",
    )

    assert response.status_code == 400
    assert "dog.jpg could not be read as an image" in response.text
    assert "have to be chosen again" in response.text
    assert listing_named(db_session, "Badphotodog") is None
    assert image_store.files == {}


def test_too_many_photos_is_refused(client: TestClient, db_session: Session) -> None:
    files = [("photos", (f"p{i}.png", png(), "image/png")) for i in range(images.MAX_PHOTOS + 1)]

    response = post_with_files(client, files, name="Manyphotodog")

    assert response.status_code == 400
    assert f"at most {images.MAX_PHOTOS} photos" in response.text
    assert listing_named(db_session, "Manyphotodog") is None


def test_an_empty_file_input_is_not_a_photo(client: TestClient, db_session: Session) -> None:
    # What a browser sends for a file input left empty.
    response = post_with_files(
        client, [("photos", ("", b"", "application/octet-stream"))], name="Nophotodog"
    )
    assert response.status_code == 303
    assert listing_named(db_session, "Nophotodog").photos == []


def test_a_failed_save_leaves_no_files_behind(
    db_session: Session, image_store: images.MemoryImageStore, monkeypatch
) -> None:
    def broken(*args, **kwargs):
        raise RuntimeError("database went away")

    monkeypatch.setattr(service, "_queue_verify_email", broken)
    photo = images.process(png())

    with pytest.raises(RuntimeError):
        service.create_listing(db_session, listing_data(), photos=[photo], store=image_store)

    assert image_store.files == {}


def test_deleting_unverified_listings_deletes_their_photos(
    db_session: Session, image_store: images.MemoryImageStore
) -> None:
    listing = service.create_listing(
        db_session, listing_data(), photos=[images.process(png())], store=image_store
    )
    assert image_store.files
    listing.created_at = datetime.now(timezone.utc) - timedelta(
        days=settings.unverified_retention_days + 1
    )
    db_session.commit()
    listing_id = listing.id

    service.delete_unverified(db_session, store=image_store)

    assert image_store.files == {}
    assert db_session.scalars(select(Photo).where(Photo.listing_id == listing_id)).all() == []
