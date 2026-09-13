"""Stage 6: checkpoints against a real database, with fake models.

The generator, the answerer and NLI are all faked, for the same reason as in the derive tests:
a real model cannot be made to answer wrongly, or to be unsure, on demand - and a test that
depended on one would be measuring the model rather than the checkpoint.

The fake answerer's words drive the fake judge: an answer containing RIGHT entails the
expected answer, PART is true but incomplete, UNSURE is below the confidence floor, and
anything else misses.

Skips when there is no database.
"""

from __future__ import annotations

import itertools

import pytest
from sqlalchemy import func, select, update

from herder.core.verify_models import CallOutcome, ProbeOutcome
from herder.domain.integrity import EXCLUDED, INCLUDED, UNCOVERED
from herder.domain.merge import ENTAILMENT, NEUTRAL, Label
from herder.models import Checkpoint, Entry, Job, ModelCall, Probe, ProbeResult, Project, Suggestion
from herder.schemas.probes import ProbeSpec
from herder.services.checkpoint import CheckpointError, run_checkpoint
from herder.services.serve import resume
from tests.test_derive_db import FakeExtractor, candidate, run, seeded

FLOOR = 0.5

TRANSCRIPT = """User: we are going with Postgres for production instead of SQLite.
Assistant: noted.
User: the confidence threshold still needs to be picked before we ship anything at all.
Assistant: understood."""


class FakeGenerator:
    name = "fake"
    model = "fake-gen"

    def __init__(self, spec=None, fail: bool = False) -> None:
        self._spec, self._fail = spec, fail
        self._numbers = itertools.count()
        self.calls = 0

    def generate(self, label: str, content: str) -> ProbeOutcome:
        self.calls += 1
        call = CallOutcome(model=self.model, prompt_version="1", content="{}", latency_ms=1)
        if self._fail:
            call.failed, call.error = True, "boom"
            return ProbeOutcome(call)
        spec = self._spec or ProbeSpec(
            has_fact=True,
            question=f"What is item {next(self._numbers)}?",
            expected_answer=f"The stored claim is: {content}",
        )
        return ProbeOutcome(call, spec)


class FakeAnswerer:
    name = "fake"
    model = "fake-answer"

    def __init__(self, *answers: str) -> None:
        self._answers = itertools.cycle(answers or ("RIGHT",))
        self.packs: list[str] = []

    def answer(self, pack: str, question: str) -> CallOutcome:
        self.packs.append(pack)
        return CallOutcome(model=self.model, prompt_version="1", content=next(self._answers), latency_ms=1)


class FakeJudge:
    name = "fake"
    model_name = "fake-nli"
    last_latency_ms = 1

    def __init__(self, grounded: bool = True) -> None:
        self._grounded = grounded

    def classify(self, pairs):
        if len(pairs) == 1:
            # The grounding check: does the entry's own content entail the expected answer.
            return [Label(ENTAILMENT, 0.99) if self._grounded else Label(NEUTRAL, 0.95)]
        (forward_premise, _), (_, backward_hypothesis) = pairs
        if "UNSURE" in forward_premise:
            return [Label(NEUTRAL, 0.3), Label(NEUTRAL, 0.3)]
        if "RIGHT" in forward_premise:
            return [Label(ENTAILMENT, 0.99), Label(NEUTRAL, 0.9)]
        if "PART" in backward_hypothesis:
            return [Label(NEUTRAL, 0.9), Label(ENTAILMENT, 0.9)]
        return [Label(NEUTRAL, 0.9), Label(NEUTRAL, 0.9)]


async def served(session, account, budget: int | None = None, entries: int = 6):
    """A derived project, a tail of one message so an uncovered user turn exists, and a serve.

    The fake extractor cites only the first message, so the third - a user turn of more than
    eight tokens - is claimed by no entry. A one-token tail keeps it out of the pack.
    """
    project = await seeded(session, account, text=TRANSCRIPT)
    await session.execute(update(Project).where(Project.id == project.id).values(session_tail_tokens=1))
    await session.commit()
    await session.refresh(project)
    await run(session, project, FakeExtractor([candidate(title=f"decision number {i} about the system") for i in range(entries)]))
    return project, await resume(session, project, budget_tokens=budget)


async def count(session, table, *where) -> int:
    """Always filtered. The tests share a database with real work, so an unfiltered count
    includes whatever the last real checkpoint left behind - which is how these were found."""
    return (await session.execute(select(func.count()).select_from(table).where(*where))).scalar_one()


async def calls(session, purpose: str) -> int:
    return await count(session, ModelCall, ModelCall.purpose == purpose)


async def checkpoint(session, pack, generator=None, answerer=None):
    return await run_checkpoint(
        session, pack.injection_id, generator or FakeGenerator(), answerer or FakeAnswerer(), FakeJudge(), floor=FLOOR
    )


# ------------------------------------------------------------------ the run


@pytest.mark.asyncio
async def test_a_checkpoint_scores_the_pack_that_was_served(session, account):
    project, pack = await served(session, account)
    answerer = FakeAnswerer("RIGHT")

    result = await checkpoint(session, pack, answerer=answerer)

    stored = await session.get(Checkpoint, result.checkpoint_id)
    assert stored.injection_id == pack.injection_id
    assert stored.integrity == 1.0
    assert stored.probe_count == result.graded > 0
    assert stored.latency_ms is not None
    # The answerer was given the exact text that was served, not a re-render.
    assert set(answerer.packs) == {pack.text}


@pytest.mark.asyncio
async def test_every_model_call_is_recorded(session, account):
    _, pack = await served(session, account)
    purposes = ("probe_gen", "probe_check", "answer", "grade")
    before = {p: await calls(session, p) for p in purposes}

    await checkpoint(session, pack)

    for purpose in purposes:
        assert await calls(session, purpose) > before[purpose], purpose


@pytest.mark.asyncio
async def test_all_three_categories_are_probed_when_they_exist(session, account):
    _, pack = await served(session, account, budget=40)
    result = await checkpoint(session, pack)

    categories = {report.category for report in result.reports}
    assert result.available[EXCLUDED] > 0, "the fixture should exclude something at 40 tokens"
    assert categories == {INCLUDED, EXCLUDED, UNCOVERED}


@pytest.mark.asyncio
async def test_a_message_the_pack_carries_verbatim_is_not_uncovered(session, account):
    """With the default tail the whole transcript is in the pack, so extraction missed
    nothing the pack does not already carry."""
    project = await seeded(session, account, text=TRANSCRIPT)
    await run(session, project, FakeExtractor([candidate()]))
    pack = await resume(session, project)

    result = await checkpoint(session, pack)
    assert result.available[UNCOVERED] == 0


# ------------------------------------------------------------------ the cache


@pytest.mark.asyncio
async def test_probes_are_generated_once_per_revision(session, account):
    _, pack = await served(session, account)
    first = FakeGenerator()
    await checkpoint(session, pack, generator=first)

    second = FakeGenerator()
    result = await checkpoint(session, pack, generator=second)

    assert first.calls > 0
    assert second.calls == 0
    assert result.probes_cached == result.selected


@pytest.mark.asyncio
async def test_an_entry_probed_under_another_category_is_copied_not_regenerated(session, account):
    project, full = await served(session, account, entries=3)
    # Probe every included entry of the full pack, so each already has a question.
    await run_checkpoint(
        session, full.injection_id, FakeGenerator(), FakeAnswerer(), FakeJudge(), floor=FLOOR,
        counts={INCLUDED: 10, EXCLUDED: 0, UNCOVERED: 0},
    )
    already = set((await session.execute(select(Probe.entry_id).where(Probe.entry_id.is_not(None)))).scalars())

    small = await resume(session, project, budget_tokens=40)
    generator = FakeGenerator()
    result = await run_checkpoint(
        session, small.injection_id, generator, FakeAnswerer(), FakeJudge(), floor=FLOOR,
        counts={INCLUDED: 0, EXCLUDED: 10, UNCOVERED: 0},
    )

    excluded = [r for r in result.reports if r.category == EXCLUDED]
    assert excluded
    assert {r.entry_id for r in excluded} <= already
    assert generator.calls == 0


# ------------------------------------------------------------------ honesty


@pytest.mark.asyncio
async def test_an_inconclusive_grade_is_stored_without_a_score_and_left_out(session, account):
    _, pack = await served(session, account)
    result = await checkpoint(session, pack, answerer=FakeAnswerer("UNSURE", "RIGHT", "RIGHT", "RIGHT"))

    assert result.inconclusive == 1
    assert result.integrity == 1.0

    nulls = (
        await session.execute(
            select(func.count()).select_from(ProbeResult).where(
                ProbeResult.checkpoint_id == result.checkpoint_id, ProbeResult.score.is_(None)
            )
        )
    ).scalar_one()
    assert nulls == 1


@pytest.mark.asyncio
async def test_nothing_graded_writes_no_checkpoint_rather_than_a_zero(session, account):
    _, pack = await served(session, account)
    with pytest.raises(CheckpointError):
        await checkpoint(session, pack, answerer=FakeAnswerer("UNSURE"))

    assert await count(session, Checkpoint, Checkpoint.injection_id == pack.injection_id) == 0


@pytest.mark.asyncio
async def test_a_failed_generation_means_fewer_probes_and_is_counted(session, account):
    _, pack = await served(session, account)
    with pytest.raises(CheckpointError):
        await checkpoint(session, pack, generator=FakeGenerator(fail=True))


@pytest.mark.asyncio
async def test_a_question_that_gives_away_its_answer_is_discarded(session, account):
    project, pack = await served(session, account)
    leaky = ProbeSpec(
        has_fact=True, question="Is the system using Postgres for production?", expected_answer="The system uses Postgres for production."
    )
    with pytest.raises(CheckpointError):
        await checkpoint(session, pack, generator=FakeGenerator(spec=leaky))

    assert await count(session, Probe, Probe.project_id == project.id) == 0


@pytest.mark.asyncio
async def test_an_expected_answer_the_content_does_not_support_is_discarded(session, account):
    """The first real run wrote "Preference lengths are stored as integers" for "I prefer
    short answers with no preamble". An invented answer is a guaranteed zero on a good entry."""
    project, pack = await served(session, account)
    before = await calls(session, "probe_check")
    with pytest.raises(CheckpointError):
        await run_checkpoint(
            session, pack.injection_id, FakeGenerator(), FakeAnswerer(), FakeJudge(grounded=False), floor=FLOOR
        )
    assert await count(session, Probe, Probe.project_id == project.id) == 0
    assert await calls(session, "probe_check") > before


@pytest.mark.asyncio
async def test_a_message_with_no_fact_gets_no_probe(session, account):
    _, pack = await served(session, account)
    empty = ProbeSpec(has_fact=False)
    with pytest.raises(CheckpointError) as exc:
        await checkpoint(session, pack, generator=FakeGenerator(spec=empty))
    assert "could not be written" in str(exc.value)


# ------------------------------------------------------------------ effects


@pytest.mark.asyncio
async def test_zeroes_flag_included_entries_and_suggest_the_rest(session, account):
    project, pack = await served(session, account, budget=40)
    result = await checkpoint(session, pack, answerer=FakeAnswerer("no idea"))

    flagged = (
        await session.execute(
            select(func.count()).select_from(Entry).where(Entry.project_id == project.id, Entry.transmission_failed.is_(True))
        )
    ).scalar_one()
    kinds = dict(
        (await session.execute(
            select(Suggestion.kind, func.count()).where(Suggestion.project_id == project.id).group_by(Suggestion.kind)
        )).all()
    )

    assert flagged == sum(1 for r in result.reports if r.category == INCLUDED)
    assert kinds.get("add_back") == sum(1 for r in result.reports if r.category == EXCLUDED)
    assert kinds.get("extract") == sum(1 for r in result.reports if r.category == UNCOVERED)


@pytest.mark.asyncio
async def test_a_later_clean_pass_clears_transmission_failed(session, account):
    project, pack = await served(session, account)
    await checkpoint(session, pack, answerer=FakeAnswerer("no idea"))
    await checkpoint(session, pack, answerer=FakeAnswerer("RIGHT"))

    flagged = (
        await session.execute(
            select(func.count()).select_from(Entry).where(Entry.project_id == project.id, Entry.transmission_failed.is_(True))
        )
    ).scalar_one()
    assert flagged == 0


@pytest.mark.asyncio
async def test_the_same_miss_does_not_stack_suggestions(session, account):
    project, pack = await served(session, account, budget=40)
    await checkpoint(session, pack, answerer=FakeAnswerer("no idea"))
    before = await count(session, Suggestion, Suggestion.project_id == project.id)
    await checkpoint(session, pack, answerer=FakeAnswerer("no idea"))
    after = await count(session, Suggestion, Suggestion.project_id == project.id)
    assert before > 0
    assert after == before


@pytest.mark.asyncio
async def test_a_half_score_neither_flags_nor_suggests(session, account):
    project, pack = await served(session, account, budget=40)
    await checkpoint(session, pack, answerer=FakeAnswerer("PART"))
    assert await count(session, Suggestion, Suggestion.project_id == project.id) == 0


@pytest.mark.asyncio
async def test_the_next_serve_carries_the_measured_integrity(session, account):
    """Stage 5 left the attribute off until something had been measured. Now it has."""
    project, pack = await served(session, account)
    await checkpoint(session, pack, answerer=FakeAnswerer("RIGHT"))

    again = await resume(session, project)
    assert again.integrity == 1.0
    assert "integrity=1.00" in again.text


# ------------------------------------------------------------------ the API


@pytest.mark.asyncio
async def test_starting_a_checkpoint_enqueues_a_job(client, session, account):
    _, pack = await served(session, account)
    response = await client.post(f"/v1/injections/{pack.injection_id}/checkpoint", json={"mode": "local"})

    assert response.status_code == 202
    job = await session.get(Job, __import__("uuid").UUID(response.json()["job_id"]))
    assert job.kind == "checkpoint"
    assert job.payload == {"injection_id": str(pack.injection_id)}


@pytest.mark.asyncio
async def test_in_chat_mode_is_refused_until_the_extension_exists(client, session, account):
    _, pack = await served(session, account)
    response = await client.post(f"/v1/injections/{pack.injection_id}/checkpoint", json={"mode": "in_chat"})
    assert response.status_code == 501


@pytest.mark.asyncio
async def test_reading_a_checkpoint_shows_every_probe_and_each_category(client, session, account):
    project, pack = await served(session, account, budget=40)
    result = await checkpoint(session, pack, answerer=FakeAnswerer("UNSURE", "RIGHT"))

    body = (await client.get(f"/v1/checkpoints/{result.checkpoint_id}")).json()

    assert body["integrity"] == pytest.approx(result.integrity)
    assert len(body["probes"]) == len(result.reports)
    assert {c["category"] for c in body["categories"]} == {INCLUDED, EXCLUDED, UNCOVERED}
    assert any(p["inconclusive"] and p["score"] is None for p in body["probes"])
    assert all(p["reason"] for p in body["probes"])


@pytest.mark.asyncio
async def test_the_integrity_series_lists_checkpoints_in_order(client, session, account):
    project, pack = await served(session, account)
    await checkpoint(session, pack, answerer=FakeAnswerer("RIGHT"))
    await checkpoint(session, pack, answerer=FakeAnswerer("no idea"))

    series = (await client.get(f"/v1/projects/{project.id}/integrity")).json()
    assert [round(p["integrity"], 2) for p in series] == [1.0, 0.0]


@pytest.mark.asyncio
async def test_checkpoints_are_scoped_to_the_workspace(client, session, account):
    """Real rows in someone else's workspace - ids that were never stored 404 either way and
    would prove nothing."""
    from herder.core.ids import uuid7
    from herder.models import User, Workspace

    project, pack = await served(session, account)
    result = await checkpoint(session, pack)

    stranger = User(id=uuid7(), email=f"stranger-{uuid7().hex[:8]}@localhost")
    session.add(stranger)
    await session.flush()
    elsewhere = Workspace(id=uuid7(), name="elsewhere", owner_user_id=stranger.id)
    session.add(elsewhere)
    await session.flush()
    await session.execute(update(Project).where(Project.id == project.id).values(workspace_id=elsewhere.id))
    await session.commit()

    assert (await client.post(f"/v1/injections/{pack.injection_id}/checkpoint", json={"mode": "local"})).status_code == 404
    assert (await client.get(f"/v1/checkpoints/{result.checkpoint_id}")).status_code == 404
    assert (await client.get(f"/v1/projects/{project.id}/integrity")).status_code == 404
