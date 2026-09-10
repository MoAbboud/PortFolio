"""Extraction persistence, against a real database, driven by fake extractors.

The real model is never loaded. Every failure row in requirements/03-architecture.md is
exercised here with a fake, which is the only way to test them reliably - a real model
cannot be made to time out or fabricate a message id on demand.

Skips when there is no database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from herder.core.ids import uuid7
from herder.domain.chunking import Chunk
from herder.models import Entry, EntryLineage, EntryRevision, ModelCall
from herder.schemas.extraction import Candidate, ExtractionOutcome
from herder.services.extraction import extract_project, load_chunks
from herder.services.ingest import ingest_paste

pytestmark = pytest.mark.asyncio

TRANSCRIPT = """User: we are going with Postgres for production instead of SQLite.
Assistant: noted, because the worker and the API write concurrently.
User: amounts must never be floats anywhere in this system.
Assistant: understood."""


class FakeExtractor:
    """Returns whatever it was given. `lineage_from` picks ids out of the real chunk."""

    name = "fake"
    model = "fake-v1"

    def __init__(self, builder, ready_error: Exception | None = None):
        self._builder = builder
        self._ready_error = ready_error
        self.calls = 0

    def check_ready(self) -> None:
        if self._ready_error:
            raise self._ready_error

    def extract(self, chunk: Chunk, existing_titles: list[str]) -> ExtractionOutcome:
        self.calls += 1
        return self._builder(chunk, existing_titles, self.calls)


def one_good(chunk, titles, calls):
    real = str(sorted(str(i) for i in chunk.message_ids)[0])
    return ExtractionOutcome(
        candidates=[
            Candidate(
                layer="project",
                kind="decision",
                title="Postgres in production",
                text="Production uses Postgres rather than SQLite.",
                lineage=[real],
                confidence=0.9,
            )
        ],
        model="fake-v1",
        prompt_version="1",
        input_tokens=100,
        output_tokens=20,
        latency_ms=42,
        prompt_ms=30,
        generation_ms=12,
        raw_output='{"entries": [...]}',
    )


async def seeded(session, account):
    await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    return account["project"]


async def test_candidates_become_entries_revisions_and_lineage(session, account):
    project = await seeded(session, account)
    run = await extract_project(session, project, FakeExtractor(one_good), target_tokens=6000)

    assert run.chunks == 1
    assert run.stored == 1

    entry = (await session.execute(select(Entry).where(Entry.project_id == project.id))).scalar_one()
    assert entry.status == "active"
    assert entry.source == "derived"
    assert entry.current_revision == 1

    revision = (
        await session.execute(select(EntryRevision).where(EntryRevision.entry_id == entry.id))
    ).scalar_one()
    assert revision.revision == 1
    assert revision.title == "Postgres in production"
    assert revision.token_count > 0
    assert revision.changed_by == "derive"

    lineage = (
        await session.execute(select(func.count()).select_from(EntryLineage).where(EntryLineage.entry_id == entry.id))
    ).scalar_one()
    assert lineage == 1


async def test_an_invented_message_id_is_dropped_and_counted(session, account):
    """Fabricated evidence never reaches the database."""
    project = await seeded(session, account)

    def invents(chunk, titles, calls):
        return ExtractionOutcome(
            candidates=[
                Candidate(
                    layer="project", kind="fact", title="invented", text="from nowhere",
                    lineage=[str(uuid7())], confidence=0.9,
                )
            ],
            model="fake-v1",
        )

    run = await extract_project(session, project, FakeExtractor(invents), target_tokens=6000)

    assert run.dropped_invented_lineage == 1
    assert run.stored == 0
    count = (await session.execute(select(func.count()).select_from(Entry).where(Entry.project_id == project.id))).scalar_one()
    assert count == 0


async def test_empty_lineage_is_dropped_and_counted(session, account):
    project = await seeded(session, account)

    def no_lineage(chunk, titles, calls):
        return ExtractionOutcome(
            candidates=[
                Candidate(layer="project", kind="fact", title="unsupported", text="claim", lineage=[])
            ],
            model="fake-v1",
        )

    run = await extract_project(session, project, FakeExtractor(no_lineage), target_tokens=6000)
    assert run.dropped_empty_lineage == 1
    assert run.stored == 0


async def test_a_failure_is_retried_once_then_the_chunk_is_skipped(session, account):
    project = await seeded(session, account)

    def always_fails(chunk, titles, calls):
        return ExtractionOutcome(failed=True, error="boom", model="fake-v1", raw_output="{{{")

    extractor = FakeExtractor(always_fails)
    run = await extract_project(session, project, extractor, target_tokens=6000)

    assert extractor.calls == 2  # one attempt, one retry
    assert run.chunks_skipped == 1
    assert run.stored == 0
    assert "boom" in run.errors[0]


async def test_a_retry_that_succeeds_stores_the_candidates(session, account):
    project = await seeded(session, account)

    def fails_then_works(chunk, titles, calls):
        if calls == 1:
            return ExtractionOutcome(failed=True, error="transient", model="fake-v1")
        return one_good(chunk, titles, calls)

    extractor = FakeExtractor(fails_then_works)
    run = await extract_project(session, project, extractor, target_tokens=6000)

    assert extractor.calls == 2
    assert run.stored == 1
    assert run.chunks_skipped == 0


async def test_every_attempt_writes_a_model_call_including_the_failures(session, account):
    """A failed call with no row is time nobody can account for."""
    project = await seeded(session, account)

    def always_fails(chunk, titles, calls):
        return ExtractionOutcome(failed=True, error="boom", model="fake-v1", raw_output="{{{")

    await extract_project(session, project, FakeExtractor(always_fails), target_tokens=6000)

    rows = (await session.execute(select(ModelCall).where(ModelCall.implementation == "fake"))).scalars().all()
    assert len(rows) == 2
    assert all(row.purpose == "extract" for row in rows)
    assert all(row.error == "boom" for row in rows)
    # The raw output is kept: a validation failure with it thrown away is unfixable.
    assert all(row.raw_output == "{{{" for row in rows)


async def test_a_model_call_records_which_implementation_produced_it(session, account):
    """Comparing three extractors is the entire point of having three."""
    project = await seeded(session, account)
    await extract_project(session, project, FakeExtractor(one_good), target_tokens=6000)

    row = (await session.execute(select(ModelCall).where(ModelCall.implementation == "fake"))).scalars().first()
    assert row.implementation == "fake"
    assert row.model == "fake-v1"
    assert row.prompt_version == "1"
    assert row.input_tokens == 100 and row.output_tokens == 20
    assert row.latency_ms == 42
    assert row.validated_first_try is True


async def test_an_unavailable_extractor_stops_before_anything_is_written(session, account):
    """No silent fallback to the heuristic. It refuses to run."""
    from herder.extractors.base import ExtractorUnavailable

    project = await seeded(session, account)
    extractor = FakeExtractor(one_good, ready_error=ExtractorUnavailable("model not pulled"))

    with pytest.raises(ExtractorUnavailable):
        await extract_project(session, project, extractor, target_tokens=6000)

    assert extractor.calls == 0


async def test_the_real_heuristic_runs_end_to_end(session, account):
    """No fake anywhere in this one."""
    from herder.extractors import get_extractor

    project = await seeded(session, account)
    run = await extract_project(session, project, get_extractor("heuristic"), target_tokens=6000)

    assert run.stored >= 2  # the decision and the constraint, both from user turns
    titles = (
        await session.execute(
            select(EntryRevision.title).join(Entry, Entry.id == EntryRevision.entry_id).where(Entry.project_id == project.id)
        )
    ).scalars().all()
    assert any("Postgres" in t for t in titles)


async def test_chunking_covers_every_message_in_the_project(session, account):
    project = await seeded(session, account)
    chunks = await load_chunks(session, project, 6000)
    assert sum(len(c.messages) for c in chunks) == 4


async def test_small_chunks_produce_several_calls(session, account):
    """Chunk size is the biggest lever on how long a derive takes."""
    project = await seeded(session, account)
    extractor = FakeExtractor(one_good)
    run = await extract_project(session, project, extractor, target_tokens=1)

    assert run.chunks == 4
    assert extractor.calls == 4


async def test_the_timing_split_is_stored_not_just_the_total(session, account):
    """A single total hid the fact that 121 s of a 125.6 s call was loading the model.

    The point of this table is that re-scoring is a re-read rather than a re-run, and
    "did a bigger chunk change the prefill-to-generation ratio" has to be answerable from
    these rows without touching a model again.
    """
    project = await seeded(session, account)

    def timed(chunk, titles, calls):
        outcome = one_good(chunk, titles, calls)
        outcome.load_ms = 121_000
        return outcome

    await extract_project(session, project, FakeExtractor(timed), target_tokens=6000)

    row = (
        await session.execute(select(ModelCall).where(ModelCall.implementation == "fake"))
    ).scalars().first()
    assert row.load_ms == 121_000
    assert row.prompt_ms == 30
    assert row.generation_ms == 12
    assert row.latency_ms == 42


async def test_an_extractor_that_does_no_inference_stores_no_timing_split(session, account):
    """Null means "not applicable", which is a different thing from zero."""
    from herder.extractors import get_extractor

    project = await seeded(session, account)
    await extract_project(session, project, get_extractor("heuristic"), target_tokens=6000)

    row = (
        await session.execute(select(ModelCall).where(ModelCall.implementation == "heuristic"))
    ).scalars().first()
    assert row.load_ms is None
    assert row.prompt_ms is None
    assert row.generation_ms is None
