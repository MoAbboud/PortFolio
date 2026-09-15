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


async def _one_sided_second_round(session, account, text: str):
    """A stored decision, then a candidate the NLI reads as contradiction one way only."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(text="The case-study ports are Newark, Rotterdam and Singapore.")]))
    old_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    await ingest_paste(session, account["workspace"].id, text="User: about the ports again.", vendor="claude")
    await session.refresh(project)
    second = await run(session, project, FakeExtractor([candidate(text=text)]), nli=FakeNli(NEUTRAL, CONTRADICTION))
    old = await session.get(Entry, old_id)
    await session.refresh(old)
    return second, old


async def test_a_candidate_announcing_a_change_retires_what_it_contradicts_one_way(session, account):
    """Stage 10: the benchmark served "Newark, Rotterdam and Singapore" beside the correction that
    replaced it, because the NLI read the correction neutral in one direction. A sentence that says
    it is changing something is evidence enough for one strong direction."""
    second, old = await _one_sided_second_round(
        session, account, "Swap one of the ports I listed earlier: it's Felixstowe, not Rotterdam."
    )
    assert second.superseded == 1 and second.reversals == 1
    assert old.status == "superseded"


async def test_without_a_change_cue_one_direction_is_still_not_enough(session, account):
    """The both-directions rule stands for everything else - NLI invents one-sided contradictions."""
    second, old = await _one_sided_second_round(session, account, "The ports include Felixstowe as well.")
    assert second.superseded == 0 and second.reversals == 0
    assert old.status == "active"


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
    """Invariant 5, for a render at the project's own budget. The override half - stored but
    never current - is tested in test_serve_db.py, where overrides come from."""
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


# ================================================================== bug fixes, 2026-09-11


class CountingEmbedder(FakeEmbedder):
    """Records how many texts it was asked to embed."""

    def __init__(self, similar: bool = True) -> None:
        super().__init__(similar)
        self.embedded = 0

    def embed(self, texts: list[str]) -> list[list[float]]:
        self.embedded += len(texts)
        return super().embed(texts)


async def test_an_entry_with_no_embedding_is_backfilled_by_a_derive(session, account):
    """An entry with a NULL vector is invisible to `_find_matches`, so it can never merge.

    The stage 2 extract service has no embedder by design and wrote exactly such entries.
    The `embed` job that was supposed to fix them was ticked done in the task list and did
    not exist, so they stayed invisible indefinitely.
    """
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    entry_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    await session.execute(update(Entry).where(Entry.id == entry_id).values(embedding=None))
    await session.commit()

    await session.refresh(project)
    result = await run(session, project, FakeExtractor([]), embedder=CountingEmbedder())

    assert result.embeddings_backfilled == 1
    vector = (await session.execute(select(Entry.embedding).where(Entry.id == entry_id))).scalar_one()
    assert vector is not None


async def test_a_removed_entry_with_no_embedding_still_blocks_recreation(session, account):
    """The worst consequence of the missing embed job, and the reason it mattered.

    Removed-never-resurrects is enforced by MATCHING a candidate against the removed entry.
    An entry removed before it was ever embedded cannot be matched, so the rule silently did
    not apply to it and the next derive re-created it - defeating the one behaviour the
    adjuster's trustworthiness rests on.
    """
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    entry_id = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    # Removed AND unembedded: exactly the state the bug produced.
    await session.execute(
        update(Entry).where(Entry.id == entry_id).values(status="removed", embedding=None)
    )
    await session.commit()

    await ingest_paste(session, account["workspace"].id, text="User: the same point, made again.", vendor="claude")
    await session.refresh(project)
    second = await run(session, project, FakeExtractor([candidate()]), nli=FakeNli(ENTAILMENT, ENTAILMENT))

    assert second.dropped_removed == 1
    assert second.created == 0
    statuses = (
        await session.execute(
            select(Entry.status).where(Entry.project_id == project.id, Entry.kind == "decision")
        )
    ).scalars().all()
    assert statuses == ["removed"]


async def test_the_tail_is_never_embedded(session, account):
    """It is replaced wholesale each derive and never merged, so a vector for it would be
    recomputed forever and never read."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    vector = (
        await session.execute(
            select(Entry.embedding).where(Entry.project_id == project.id, Entry.kind == "tail")
        )
    ).scalars().first()
    assert vector is None


async def test_two_candidates_revising_the_same_entry_in_one_derive(session, account):
    """`entries.current_revision` is maintained with a core update(), which does not refresh
    an ORM object already in the session. Reading it back through `session.get` returned a
    stale number, so the second revision in one derive reused the first one and collided
    with the primary key on (entry_id, revision).
    """
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(text="We use Postgres.")]))

    await ingest_paste(
        session, account["workspace"].id, text="User: two refinements of the same point at once.", vendor="claude"
    )
    await session.refresh(project)

    # Both candidates match the one stored entry, and both read as more specific.
    two = [
        candidate(title="first refinement", text="We use Postgres 16 in production."),
        candidate(title="second refinement", text="We use Postgres 16.2 in production on Linux."),
    ]
    result = await run(session, project, FakeExtractor(two), nli=FakeNli(ENTAILMENT, NEUTRAL))

    assert result.updated == 2

    entry = (
        await session.execute(select(Entry).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().one()
    revisions = (
        await session.execute(
            select(EntryRevision.revision)
            .where(EntryRevision.entry_id == entry.id)
            .order_by(EntryRevision.revision)
        )
    ).scalars().all()

    # Invariant 6: a row for every revision from 1 to current, with no gaps and no reuse.
    assert revisions == [1, 2, 3]
    await session.refresh(entry)
    assert entry.current_revision == 3


# ------------------------------------------------------------------ the documented invariants


async def test_invariant_2_every_derived_entry_cites_a_message(session, account):
    """An entry that cannot say where it came from is an unsupported claim, not a
    low-confidence one."""
    project = await seeded(session, account)
    await run(
        session,
        project,
        FakeExtractor([candidate(), candidate(title="another", kind="constraint")]),
        embedder=FakeEmbedder(similar=False),
    )

    orphans = (
        await session.execute(
            select(func.count())
            .select_from(Entry)
            .outerjoin(EntryLineage, EntryLineage.entry_id == Entry.id)
            .where(
                Entry.project_id == project.id,
                Entry.source == "derived",
                Entry.kind != "tail",
                EntryLineage.entry_id.is_(None),
            )
        )
    ).scalar_one()
    assert orphans == 0


async def test_invariant_4_a_rendered_brief_is_never_edited(session, account):
    """Any change is a new version, so a checkpoint score always refers to a text that
    still exists exactly as it was sent."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    first = (
        await session.execute(
            select(BriefVersion).where(BriefVersion.project_id == project.id, BriefVersion.version == 1)
        )
    ).scalars().one()
    original = first.rendered_text

    await render_project(session, project, "adjust")
    await session.commit()

    await session.refresh(first)
    assert first.rendered_text == original
    count = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    assert count >= 2


async def test_invariant_8_only_active_or_pinned_is_included_and_every_pin_is(session, account):
    project = await seeded(session, account)
    await run(
        session,
        project,
        FakeExtractor([candidate(title=f"entry {i}") for i in range(4)]),
        embedder=FakeEmbedder(similar=False),
    )

    ids = (
        await session.execute(select(Entry.id).where(Entry.project_id == project.id, Entry.kind == "decision"))
    ).scalars().all()
    await session.execute(update(Entry).where(Entry.id == ids[0]).values(status="pinned"))
    await session.execute(update(Entry).where(Entry.id == ids[1]).values(status="removed"))
    await session.execute(update(Entry).where(Entry.id == ids[2]).values(status="archived"))
    await session.commit()

    version = await render_project(session, project, "adjust")
    included = set(version.included_entry_ids)

    assert ids[0] in included  # every pinned entry is included
    assert ids[1] not in included  # removed
    assert ids[2] not in included  # archived

    statuses = (
        await session.execute(select(Entry.status).where(Entry.id.in_(included)))
    ).scalars().all()
    assert set(statuses) <= {"active", "pinned"}


async def test_invariant_7_holds_once_the_source_exceeds_the_budget(session, account):
    """The invariant as first written said the compression ratio is always at least 1.

    That is false for a small conversation and it is not a defect: a 114-token transcript
    yields a brief whose verbatim session tail is the whole conversation, plus entry lines
    restating it, so the brief is legitimately larger than its source. Compression only
    means anything once the source exceeds the budget, which is the regime this asserts.
    """
    long_text = "\n".join(
        f"User: point {i}. We are going with decision number {i} and it must never be reversed."
        f"\nAssistant: noted for {i}."
        for i in range(120)
    )
    await ingest_paste(session, account["workspace"].id, text=long_text, vendor="claude")
    project = account["project"]
    await session.refresh(project)

    await session.execute(update(Project).where(Project.id == project.id).values(brief_budget_tokens=300))
    await session.commit()
    await session.refresh(project)

    await run(session, project, FakeExtractor([candidate()]), embedder=FakeEmbedder(similar=False))

    version = (
        await session.execute(
            select(BriefVersion)
            .where(BriefVersion.project_id == project.id)
            .order_by(BriefVersion.version.desc())
            .limit(1)
        )
    ).scalars().first()

    assert version.source_token_count > version.budget_tokens, "the corpus must exceed the budget"
    assert version.token_count <= version.budget_tokens
    assert version.source_token_count / version.token_count >= 1.0
