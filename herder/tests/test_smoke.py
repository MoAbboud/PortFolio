"""Settings, ids, and the shape of the package. No database.

The uuid7 tests are here because the ordering property is relied on by the schema and would
otherwise be assumed rather than checked.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from herder.core.config import Settings
from herder.core.ids import timestamp_ms, uuid7


def test_defaults_are_the_documented_ones() -> None:
    s = Settings(_env_file=None)
    assert s.extractor == "heuristic"
    assert s.embed_dim == 384
    assert s.chunk_tokens == 6000
    assert s.brief_budget_tokens == 3000
    assert s.session_tail_tokens == 1200
    # 0.50, not the 0.86 the specification named: measured against all-minilm at stage 3,
    # where 0.86 turned out to be so high the merge step would never have fired.
    assert s.similarity_threshold == 0.50
    assert s.probe_count == 6


def test_unknown_extractor_is_an_error_not_a_silent_default() -> None:
    """A typo that quietly downgraded extraction would make every later number a lie."""
    with pytest.raises(ValidationError):
        Settings(_env_file=None, extractor="gpt")


def test_extractor_comes_from_the_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HERDER_EXTRACTOR", "local")
    assert Settings(_env_file=None).extractor == "local"


def test_database_url_is_read_unprefixed(monkeypatch: pytest.MonkeyPatch) -> None:
    """DATABASE_URL is what every host and docker-compose actually sets."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    assert Settings(_env_file=None).database_url == "postgresql+asyncpg://u:p@h:5432/d"


def test_no_api_key_setting_exists() -> None:
    """There is no provider key in this project and there is not going to be one.

    This test exists so that adding one is a deliberate act that breaks a test with a name
    explaining why, rather than a quiet convenience during a stage that felt hard.
    """
    fields = set(Settings.model_fields)
    assert not [f for f in fields if "api_key" in f or "llm_key" in f or "token" == f]


def test_uuid7_is_version_7_and_the_right_variant() -> None:
    value = uuid7()
    assert value.version == 7
    assert (value.bytes[8] & 0xC0) == 0x80


def test_uuid7_carries_the_current_time() -> None:
    import time

    before = time.time_ns() // 1_000_000
    value = uuid7()
    after = time.time_ns() // 1_000_000
    assert before <= timestamp_ms(value) <= after + 1


def test_uuid7_sorts_in_creation_order() -> None:
    """Generated fast enough to land in one millisecond, which is the interesting case.

    Without the counter in rand_a these would sort arbitrarily, and "ordered by id" would
    silently stop meaning "in the order it happened".
    """
    made = [uuid7() for _ in range(2000)]
    assert made == sorted(made)
    assert len(set(made)) == len(made)


def test_app_exposes_health() -> None:
    """Asserted against the OpenAPI schema rather than by walking `.routes`.

    This FastAPI version wraps an included router in an object with no `.path`, so walking
    the route list finds only the docs endpoints. The schema is the contract the extension,
    the MCP server and the harness will all read, so it is the right thing to assert on.
    """
    from herder.main import create_app

    assert "/health" in create_app().openapi()["paths"]


def test_the_worker_has_a_handler_for_every_kind_it_enqueues() -> None:
    """Stage 0 built the shape; stage 3 filled in derive and render.

    An unknown kind is marked failed with a reason rather than retried forever, so a job
    nobody can run is visible instead of invisible - but a kind this system *enqueues* and
    cannot handle would be a bug, so the two lists are checked against each other.
    """
    from herder.worker.runner import HANDLERS, worker_name

    assert set(HANDLERS) == {"derive", "render"}
    assert ":" in worker_name()
