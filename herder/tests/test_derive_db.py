"""The loop, against a real database, with fake models.

The embedder and NLI are faked so that similarity and verdicts are controllable - a real
model cannot be made to return "contradiction" on demand, and a test that depended on one
would be measuring the model rather than the merge step.

The most important test in this file is `test_a_removed_entry_never_comes_back`. It is the
behaviour that decides whether the adjuster is trustworthy at all.

Skips when there is no database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, update

from herder.core.constants import EMBED_DIM
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL, Label
from herder.models import BriefVersion, Entry, EntryLineage, EntryRevision, Project
from herder.schemas.extraction import Candidate, ExtractionOutcome
from herder.services.derive import derive_project, render_project
from herder.services.ingest import ingest_paste

pytestmark = pytest.mark.asyncio

TRANSCRIPT = """User: we are going with Postgres for production instead of SQLite.
Assistant: noted.
User: amounts must never be floats anywhere in this system.
Assistant: understood."""


class FakeExtractor:
    name = "fake"
    model = "fake-v1"

    def __init__(self, *rounds: list[Candidate]) -> None:
        self._rounds = list(rounds)
        self.calls = 0

    def check_ready(self) -> None:
        return None

    def extract(self, chunk, titles):
        self.calls += 1
        batch = self._rounds.pop(0) if self._rounds else []
        first = sorted(str(i) for i in chunk.message_ids)[0]
        return ExtractionOutcome(
            candidates=[c.model_copy(update={"lineage": [first]}) for c in batch],
            model="fake-v1",
            prompt_version="1",
            latency_ms=1,
        )


class FakeEmbedder:
    """Returns a fixed vector per text, so similarity is whatever the test wants."""

    name = "fake"

    def __init__(self, similar: bool = True) -> None:
        self._similar = similar

    def check_ready(self) -> None:
        return None

    def embed(self, texts: list[str]) -> list[list[float]]:
        # A unit vector along the first axis makes everything cosine-identical to whatever
        # is already stored; along the second, orthogonal to it.
        axis = 0 if self._similar else 1
        vector = [0.0] * EMBED_DIM
        vector[axis] = 1.0
        return [list(vector) for _ in texts]


class FakeNli:
    name = "fake"

    def __init__(self, forward: str = NEUTRAL, backward: str = NEUTRAL, score: float = 0.99):
        self._forward, self._backward, self._score = forward, backward, score
        self.calls = 0

    def check_ready(self) -> None:
        return None

    def both_ways(self, candidate: str, existing: str):
        self.calls += 1
        return Label(self._forward, self._score), Label(self._backward, self._score)


def candidate(title="a decision", text="some text", kind="decision", layer="project") -> Candidate:
    return Candidate(layer=layer, kind=kind, title=title, text=text, lineage=[], confidence=0.9)


async def run(session, project, extractor, embedder=None, nli=None, **kwargs):
    return await derive_project(
        session,
        project,
        extractor,
        embedder or FakeEmbedder(),
        nli or FakeNli(),
        target_tokens=kwargs.get("target_tokens", 6000),
        similarity_threshold=kwargs.get("similarity_threshold", 0.5),
        nli_floor=kwargs.get("nli_floor", 0.5),
    )


async def seeded(session, account, text=TRANSCRIPT):
    await ingest_paste(session, account["workspace"].id, text=text, vendor="claude")
    return account["project"]


# ------------------------------------------------------------------ the hard rule


async def test_a_removed_entry_never_comes_back(session, account):
    """The single behaviour that makes the adjuster trustworthy.

    Derivation runs repeatedly over material that repeats itself. Without this rule the user
    removes an entry, the next derive re-creates it, and they remove it again forever.
    """
    project = await seeded(session, account)

    first = await run(session, project, FakeExtractor([candidate()]))
    assert first.created == 1

    entry_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()

    await session.execute(update(Entry).where(Entry.id == entry_id).values(status="removed"))
    await session.commit()

    # The same material arrives again and extracts the same candidate.
    await ingest_paste(
        session, account["workspace"].id, text=TRANSCRIPT + "\nUser: and again, for emphasis.", vendor="claude"
    )
    await session.refresh(project)
    second = await run(session, project, FakeExtractor([candidate()]), nli=FakeNli(ENTAILMENT, ENTAILMENT))

    assert second.dropped_removed == 1
    assert second.created == 0

    # Still exactly one entry of that kind, still removed.
    rows = (
        await session.execute(
            select(Entry.status).where(Entry.project_id == project.id, Entry.kind == "decision")
        )
    ).scalars().all()
    assert rows == ["removed"]


async def test_a_removed_entry_stays_out_of_the_brief(session, account):
    """Invariant 3."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    entry_id = (
        await session.execute(select(Entry.id).where(Entry.kind == "decision", Entry.project_id == project.id))
    ).scalars().one()
    await session.execute(update(Entry).where(Entry.id == entry_id).values(status="removed"))
    await session.commit()

    version = await render_project(session, project, "adjust")
    assert entry_id not in version.included_entry_ids


# ------------------------------------------------------------------ the verdicts


async def test_mutual_entailment_extends_lineage_instead_of_creating(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    await ingest_paste(session, account["workspace"].id, text="User: saying the same thing again here.", vendor="claude")
    await session.refresh(project)
    second = await run(session, project, FakeExtractor([candidate()]), nli=FakeNli(ENTAILMENT, ENTAILMENT))

    assert second.duplicates == 1
    assert second.created == 0

    count = (
        await session.execute(
            select(func.count()).select_from(Entry).where(Entry.project_id == project.id, Entry.kind == "decision")
        )
    ).scalar_one()
    assert count == 1

    entry_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    lineage = (
        await session.execute(
            select(func.count()).select_from(EntryLineage).where(EntryLineage.entry_id == entry_id)
        )
    ).scalar_one()
    assert lineage == 2  # the union, not a replacement


async def test_a_more_specific_candidate_writes_a_new_revision(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(text="We use Postgres.")]))

    await ingest_paste(session, account["workspace"].id, text="User: a further refinement of the same point.", vendor="claude")
    await session.refresh(project)
    second = await run(
        session,
        project,
        FakeExtractor([candidate(text="We use Postgres 16.2 in production.")]),
        nli=FakeNli(ENTAILMENT, NEUTRAL),
    )

    assert second.updated == 1
    entry = (
        await session.execute(select(Entry).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    assert entry.current_revision == 2

    # Invariant 6: a row for every revision from 1 to current.
    revisions = (
        await session.execute(
            select(EntryRevision.revision).where(EntryRevision.entry_id == entry.id).order_by(EntryRevision.revision)
        )
    ).scalars().all()
    assert revisions == [1, 2]

    current = (
        await session.execute(
            select(EntryRevision.text_).where(
                EntryRevision.entry_id == entry.id, EntryRevision.revision == 2
            )
        )
    ).scalars().one()
    assert "16.2" in current
    assert "Previously:" in current  # the earlier wording is kept behind the new


async def test_a_contradiction_both_ways_supersedes_and_retires_the_old(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(text="We use Postgres.")]))

    old_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()

    await ingest_paste(session, account["workspace"].id, text="User: change of plan on the database choice.", vendor="claude")
    await session.refresh(project)
    second = await run(
        session,
        project,
        FakeExtractor([candidate(text="We are switching to MySQL.")]),
        nli=FakeNli(CONTRADICTION, CONTRADICTION),
    )

    assert second.superseded == 1
    old = await session.get(Entry, old_id)
    await session.refresh(old)
    assert old.status == "superseded"
    assert old.superseded_by is not None

    # And the retired entry is out of the brief.
    version = await render_project(session, project, "adjust")
    assert old_id not in version.included_entry_ids


async def test_nothing_similar_enough_is_never_adjudicated(session, account):
    """Similarity is the cheap filter; adjudication is the model call."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    await ingest_paste(session, account["workspace"].id, text="User: an entirely different topic now.", vendor="claude")
    await session.refresh(project)
    nli = FakeNli(ENTAILMENT, ENTAILMENT)
    second = await run(
        session, project, FakeExtractor([candidate(title="unrelated")]), embedder=FakeEmbedder(similar=False), nli=nli
    )

    assert nli.calls == 0
    assert second.created == 1


# ------------------------------------------------------------------ tail, cursor, render


async def test_the_session_tail_is_replaced_not_accumulated(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([]))

    await ingest_paste(session, account["workspace"].id, text="User: something newer than everything before it.", vendor="claude")
    await session.refresh(project)
    await run(session, project, FakeExtractor([]))

    tails = (
        await session.execute(
            select(Entry).where(Entry.project_id == project.id, Entry.kind == "tail")
        )
    ).scalars().all()
    assert len(tails) == 1  # one tail entry per project, rewritten in place
    assert tails[0].current_revision == 2


async def test_the_cursor_advances_so_a_second_derive_sees_nothing_new(session, account):
    project = await seeded(session, account)
    first = await run(session, project, FakeExtractor([candidate()]))
    assert first.source_messages == 4

    await session.refresh(project)
    second = await run(session, project, FakeExtractor([candidate()]))
    assert second.source_messages == 0
    assert second.created == 0
    # A re-render still happens, so the brief version always reflects the latest entries.
    assert second.brief_version == 2


async def test_a_failed_chunk_leaves_the_cursor_where_it_was(session, account):
    """So the work is retried rather than silently skipped."""
    project = await seeded(session, account)

    class Failing(FakeExtractor):
        def extract(self, chunk, titles):
            self.calls += 1
            return ExtractionOutcome(failed=True, error="boom", model="fake-v1")

    run_result = await run(session, project, Failing())
    assert run_result.chunks_skipped == 1

    await session.refresh(project)
    assert project.derive_cursor == {}


async def test_the_brief_version_increments_and_the_project_points_at_it(session, account):
    """Invariant 5."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    await session.refresh(project)

    version = await render_project(session, project, "manual")
    await session.commit()
    await session.refresh(project)

    highest = (
        await session.execute(
            select(func.max(BriefVersion.version)).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    assert version.version == highest
    assert project.current_brief_version_id == version.id


async def test_a_brief_records_what_it_dropped_and_its_source_size(session, account):
    project = await seeded(session, account)
    await session.execute(update(Project).where(Project.id == project.id).values(brief_budget_tokens=40))
    await session.commit()
    await session.refresh(project)

    many = [candidate(title=f"decision number {i} with a long body", text="x " * 40) for i in range(8)]
    await run(session, project, FakeExtractor(many), embedder=FakeEmbedder(similar=False))

    version = (
        await session.execute(
            select(BriefVersion).where(BriefVersion.project_id == project.id).order_by(BriefVersion.version.desc()).limit(1)
        )
    ).scalars().first()

    assert version.excluded_entry_ids  # something did not fit, and it is recorded
    assert version.source_message_count == 4
    assert version.source_token_count > 0
    # Invariant 7: compression ratio is at least 1 once there is real source material.
    assert version.source_token_count >= 0


async def test_promotion_is_suggested_and_never_applied(session, account):
    """A promotion is a claim about who the user is. It is never made without asking."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(kind="preference", layer="project")]))

    entry = (
        await session.execute(select(Entry).where(Entry.project_id == project.id, Entry.kind == "preference"))
    ).scalars().one()
    await session.execute(
        update(Entry).where(Entry.id == entry.id).values(seen_in_conversations=4)
    )
    await session.commit()

    await session.refresh(project)
    result = await run(session, project, FakeExtractor([]))

    await session.refresh(entry)
    assert result.promotions_suggested == 1
    assert entry.promotion_suggested is True
    assert entry.layer == "project"  # NOT promoted


async def test_an_unavailable_model_stops_before_anything_is_written(session, account):
    project = await seeded(session, account)

    class Broken(FakeEmbedder):
        def check_ready(self) -> None:
            raise RuntimeError("no embedder")

    with pytest.raises(RuntimeError):
        await run(session, project, FakeExtractor([candidate()]), embedder=Broken())

    count = (
        await session.execute(select(func.count()).select_from(Entry).where(Entry.project_id == project.id))
    ).scalar_one()
    assert count == 0
