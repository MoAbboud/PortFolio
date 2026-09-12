"""Ingest against a real database.

Skips when there is no database. See tests/conftest.py.

**Every query here is scoped to the rows the test created.** Each test rolls its own
transaction back, but the development database also holds whatever has been put through the
running API by hand, and a test that counts all messages or all jobs silently depends on
that being empty. Two tests here did exactly that, passed against a clean database, and went
red the moment a transcript was pasted through the real API - which is a flaky suite, and a
flaky suite is one nobody believes.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select, text

from herder.models import Conversation, Job, Message, Project
from herder.schemas.ingest import IngestEvent
from herder.services.ingest import ingest_events, ingest_paste

pytestmark = pytest.mark.asyncio

TRANSCRIPT = """User: we are using Postgres, not SQLite, in production.
Assistant: noted. Concurrent writes from the worker and the API are the reason.
User: right. And amounts are always Decimal, never float.
Assistant: understood."""


async def test_a_paste_becomes_a_conversation_and_messages(session, account):
    result = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")

    assert result.accepted == 4
    assert result.duplicates == 0
    assert result.tokens > 0

    rows = (
        await session.execute(
            select(Message).where(Message.conversation_id == result.conversation_ids[0]).order_by(Message.seq)
        )
    ).scalars().all()
    assert [m.role for m in rows] == ["user", "assistant", "user", "assistant"]
    assert [m.seq for m in rows] == [1, 2, 3, 4]
    assert [m.client_position for m in rows] == [0, 1, 2, 3]
    assert all(m.token_count > 0 for m in rows)


async def test_re_pasting_the_same_transcript_adds_no_messages(session, account):
    """Stage 1's done-when criterion, in one test."""
    first = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    second = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")

    assert second.accepted == 0
    assert second.duplicates == 4
    # The same conversation, not a second one carrying a duplicate copy.
    assert second.conversation_ids == first.conversation_ids

    total = (
        await session.execute(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == first.conversation_ids[0])
        )
    ).scalar_one()
    assert total == 4


async def test_whitespace_noise_does_not_defeat_idempotency(session, account):
    await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    noisy = TRANSCRIPT.replace("\n", "\r\n") + "\n\n"
    again = await ingest_paste(session, account["workspace"].id, text=noisy, vendor="claude")
    assert again.accepted == 0


async def test_the_same_transcript_can_live_in_two_projects(session, account):
    """`unique (vendor, vendor_conv_id)` is global, so a paste reference derived from the
    text alone meant one transcript could exist in exactly one project, ever.

    The second paste silently resolved to the conversation in the first project, the
    `project_id` argument was ignored without a word, and the second project came back with
    zero messages while reporting every turn as a duplicate. Found by the stage 4 corpus run,
    which pastes the same ten transcripts into two sets of projects to compare extractors -
    and got ten empty projects and a derive that did nothing.
    """
    from herder.core.ids import uuid7
    from herder.models import Project

    other = Project(id=uuid7(), workspace_id=account["workspace"].id, name="the-other-one")
    session.add(other)
    await session.flush()

    first = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    second = await ingest_paste(
        session, account["workspace"].id, text=TRANSCRIPT, vendor="claude", project_id=other.id
    )

    assert second.accepted == 4, "the second project must get its own copy of the turns"
    assert second.conversation_ids != first.conversation_ids

    landed = (
        await session.execute(
            select(Conversation.project_id).where(
                Conversation.id.in_(second.conversation_ids)
            )
        )
    ).scalars().all()
    assert landed == [other.id], "the project_id argument must be honoured, not ignored"


async def test_re_pasting_into_the_SAME_project_is_still_idempotent(session, account):
    """The property the content-addressing existed for, kept while fixing the bug above."""
    first = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    again = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")

    assert again.accepted == 0
    assert again.duplicates == 4
    assert again.conversation_ids == first.conversation_ids


async def test_a_continued_transcript_appends_only_the_new_turns(session, account):
    first = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    continued = TRANSCRIPT + "\nUser: one more thing - the brief budget is 3000 tokens.\nAssistant: recorded."

    second = await ingest_paste(
        session,
        account["workspace"].id,
        text=continued,
        vendor="claude",
        conversation_id=first.conversation_ids[0],
    )
    assert second.accepted == 2
    assert second.duplicates == 4


async def test_a_batch_is_idempotent_on_replay(session, account):
    events = [
        IngestEvent(vendor="chatgpt", vendor_conv_id="c-1", role="user", content="hello", position=0),
        IngestEvent(vendor="chatgpt", vendor_conv_id="c-1", role="assistant", content="hi", position=1),
    ]
    first = await ingest_events(session, account["workspace"].id, events=events)
    second = await ingest_events(session, account["workspace"].id, events=events)

    assert (first.accepted, first.duplicates) == (2, 0)
    assert (second.accepted, second.duplicates) == (0, 2)


async def test_a_wrong_client_hash_cannot_slip_a_duplicate_past(session, account):
    """The server recomputes and its hash wins. The mismatch is reported, not trusted."""
    event = IngestEvent(vendor="chatgpt", vendor_conv_id="c-2", role="user", content="hello", position=0)
    await ingest_events(session, account["workspace"].id, events=[event])

    lying = event.model_copy(update={"content_hash": "0" * 64})
    result = await ingest_events(session, account["workspace"].id, events=[lying])

    assert result.accepted == 0
    assert result.duplicates == 1
    assert any("content_hash" in note for note in result.notes)


async def test_out_of_order_arrival_keeps_thread_order(session, account):
    """`seq` is arrival order and is never renumbered. `client_position` is thread order."""
    await ingest_events(
        session,
        account["workspace"].id,
        events=[IngestEvent(vendor="chatgpt", vendor_conv_id="c-3", role="user", content="third", position=2)],
    )
    await ingest_events(
        session,
        account["workspace"].id,
        events=[IngestEvent(vendor="chatgpt", vendor_conv_id="c-3", role="user", content="first", position=0)],
    )

    conversation = (
        await session.execute(select(Conversation).where(Conversation.vendor_conv_id == "c-3"))
    ).scalar_one()
    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            .order_by(Message.client_position.nulls_last(), Message.seq)
        )
    ).scalars().all()

    assert [m.content for m in rows] == ["first", "third"]
    # The late arrival kept a later seq: nothing was updated.
    assert [m.seq for m in rows] == [2, 1]


async def test_conversation_counters_follow_the_inserts(session, account):
    result = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    conversation = await session.get(Conversation, result.conversation_ids[0])
    assert conversation.message_count == 4
    assert conversation.token_count == result.tokens


async def test_a_derive_is_enqueued_once_the_threshold_is_crossed(session, account, monkeypatch):
    from herder.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "derive_threshold_tokens", 1)

    result = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    assert result.derive_enqueued is True

    jobs = (
        await session.execute(
            select(Job).where(
                Job.kind == "derive",
                Job.payload["project_id"].astext == str(account["project"].id),
            )
        )
    ).scalars().all()
    assert len(jobs) == 1


async def test_a_second_derive_enqueue_is_a_no_op(session, account, monkeypatch):
    """The partial unique index, tested directly.

    Two derives for one project would extract the same messages twice and merge each
    other's output. This is the constraint that makes that impossible under load, rather
    than merely unlikely.
    """
    from herder.core.config import get_settings

    monkeypatch.setattr(get_settings(), "derive_threshold_tokens", 1)

    first = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    assert first.derive_enqueued is True

    more = "User: and one more decision.\nAssistant: recorded."
    second = await ingest_paste(session, account["workspace"].id, text=more, vendor="claude")

    assert second.accepted == 2
    assert second.derive_enqueued is False  # a job is already queued

    jobs = (
        await session.execute(
            select(Job).where(
                Job.kind == "derive",
                Job.payload["project_id"].astext == str(account["project"].id),
            )
        )
    ).scalars().all()
    assert len(jobs) == 1


async def test_the_index_still_allows_a_derive_for_a_different_project(session, account):
    from herder.core.ids import uuid7

    other = Project(id=uuid7(), workspace_id=account["workspace"].id, name="other")
    session.add(other)
    await session.flush()

    for project_id in (account["project"].id, other.id):
        await session.execute(
            text(
                "insert into jobs (id, kind, payload, status) "
                "values (:id, 'derive', :payload, 'queued')"
            ),
            {"id": uuid7(), "payload": f'{{"project_id": "{project_id}"}}'},
        )
    count = (
        await session.execute(
            select(func.count())
            .select_from(Job)
            .where(Job.payload["project_id"].astext.in_([str(account["project"].id), str(other.id)]))
        )
    ).scalar_one()
    assert count == 2


async def test_tokens_since_derive_accumulates(session, account, monkeypatch):
    from herder.core.config import get_settings

    monkeypatch.setattr(get_settings(), "derive_threshold_tokens", 10_000_000)

    result = await ingest_paste(session, account["workspace"].id, text=TRANSCRIPT, vendor="claude")
    assert result.derive_enqueued is False

    project = await session.get(Project, account["project"].id)
    await session.refresh(project)
    assert project.tokens_since_derive == result.tokens
