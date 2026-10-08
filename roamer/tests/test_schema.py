"""The migration and the models agree about the vocabularies.

The migration keeps its own copy of every allowed value, so that it goes on meaning what it
meant when it was written. This fails when the model's list changes and the migration's does
not - which is the cue to write a new migration, not to edit the old one.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from roamer import models

VERSIONS = Path(__file__).parent.parent / "migrations" / "versions"


def load_migration(filename: str):
    spec = importlib.util.spec_from_file_location(filename, VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_listing_vocabularies_match_the_migration() -> None:
    migration = load_migration("0002_listings.py")
    for name in ("SOURCES", "STATUSES", "SPECIES", "SEXES", "SIZES", "PRECISIONS",
                 "EVENT_KINDS", "ACTORS"):
        assert getattr(migration, name) == getattr(models, name), name


def test_email_vocabularies_match_the_migration() -> None:
    migration = load_migration("0003_email.py")
    for name in ("TOKEN_PURPOSES", "OUTBOX_STATUSES", "OUTBOX_TEMPLATES"):
        assert getattr(migration, name) == getattr(models, name), name
