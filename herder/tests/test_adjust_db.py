"""Stage 7 against a real database: the adjuster, suggestions, and derive leaving held entries alone.

The most important test in this file is `test_removed_never_resurrects_end_to_end`. It goes
through the API the way a person would - paste, derive, remove, paste the same thing again,
derive - and it should never be allowed to go red.

Skips when there is no database.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select, update

from herder.domain.adjust import Refused
from herder.domain.merge import CONTRADICTION, ENTAILMENT, NEUTRAL
from herder.models import (
    Entry,
    EntryEvent,
    EntryLineage,
    EntryRevision,
    Job,
    Project,
    Suggestion,
)
from herder.services import adjust
from herder.services.derive import current_brief, render_project
from herder.services.serve import resume
from tests.test_checkpoint_db import FakeAnswerer, FakeGenerator, FakeJudge
from tests.test_derive_db import TRANSCRIPT, FakeExtractor, FakeNli, candidate, run, seeded

pytestmark = pytest.mark.asyncio


async def count(session, table, *where) -> int:
    return (await session.execute(select(func.count()).select_from(table).where(*where))).scalar_one()


async def jobs(session, project, kind: str) -> int:
    return await count(session, Job, Job.kind == kind, Job.payload["project_id"].astext == str(project.id))


async def derived(session, account, *titles: str):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(title=t, text=t) for t in (titles or ("we use Postgres",))]))
    return project


async def only_entry(session, project) -> Entry:
    return (
        await session.execute(select(Entry).where(Entry.project_id == project.id, Entry.kind != "tail").limit(1))
    ).scalars().one()


async def fresh(session, entry_id) -> Entry:
    return (
        await session.execute(select(Entry).where(Entry.id == entry_id).execution_options(populate_existing=True))
    ).scalars().one()


# ------------------------------------------------------------------ every action


async def test_an_action_writes_an_event_and_queues_a_render_never_a_derive(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    derives_before = await jobs(session, project, "derive")

    result = await adjust.act(session, entry.id, "pin", account["user"].id)

    assert result.status == "pinned"
    assert await jobs(session, project, "render") == 1
    assert await jobs(session, project, "derive") == derives_before
    event = (await session.execute(select(EntryEvent).where(EntryEvent.entry_id == entry.id))).scalars().one()
    assert event.event == "pin"
    assert event.user_id == account["user"].id
    assert event.payload["from_status"] == "active"


async def test_a_refused_action_changes_nothing_and_says_why(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    with pytest.raises(Refused, match="cannot unpin an entry that is active"):
        await adjust.act(session, entry.id, "unpin", None)

    assert await count(session, EntryEvent, EntryEvent.entry_id == entry.id) == 0
    assert await jobs(session, project, "render") == 0


async def test_a_removed_entry_leaves_the_next_brief(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    await adjust.act(session, entry.id, "remove", None)
    version = await render_project(session, project, "adjust")

    assert entry.id not in version.included_entry_ids


async def test_a_pin_is_always_in_the_brief_and_always_probed(session, account):
    project = await derived(session, account, "first thing", "second thing", "third thing", "fourth thing")
    target = await only_entry(session, project)
    await adjust.act(session, target.id, "pin", None)
    await render_project(session, project, "adjust")
    await session.commit()

    pack = await resume(session, project)
    from herder.services.checkpoint import run_checkpoint

    result = await run_checkpoint(session, pack.injection_id, FakeGenerator(), FakeAnswerer(), FakeJudge(), floor=0.5)

    assert target.id in (await current_brief(session, project.id)).included_entry_ids
    assert target.id in {r.entry_id for r in result.reports}


async def test_a_removed_entry_is_never_probed_even_from_an_older_serve(session, account):
    """Invariant 3. The pack was served while it was active; it was removed afterwards."""
    project = await derived(session, account)
    entry = await only_entry(session, project)
    pack = await resume(session, project)

    await adjust.act(session, entry.id, "remove", None)
    from herder.services.checkpoint import CheckpointError, run_checkpoint

    try:
        result = await run_checkpoint(session, pack.injection_id, FakeGenerator(), FakeAnswerer(), FakeJudge(), floor=0.5)
        probed = {r.entry_id for r in result.reports}
    except CheckpointError:
        probed = set()
    assert entry.id not in probed


# ------------------------------------------------------------------ edit, relayer, add


async def test_an_edit_is_a_new_revision_by_the_user_and_re_embeds(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    result = await adjust.edit(session, entry.id, None, text="We use Postgres 16 in production.")

    after = await fresh(session, entry.id)
    revision = await session.get(EntryRevision, (entry.id, result.revision))
    assert result.revision == 2
    assert revision.changed_by == "user"
    assert revision.text_ == "We use Postgres 16 in production."
    assert after.embedding is None
    assert await jobs(session, project, "embed") == 1


async def test_a_layer_change_is_an_event_not_a_revision(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    result = await adjust.edit(session, entry.id, None, layer="stable")

    assert result.layer == "stable"
    assert result.revision == 1
    event = (await session.execute(select(EntryEvent).where(EntryEvent.entry_id == entry.id))).scalars().one()
    assert event.event == "relayer"
    assert (event.payload["from_layer"], event.payload["to_layer"]) == ("project", "stable")


async def test_an_edit_that_changes_nothing_is_refused(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    current = await session.get(EntryRevision, (entry.id, 1))
    with pytest.raises(Refused, match="nothing changed"):
        await adjust.edit(session, entry.id, None, title=current.title, text=current.text_)


async def test_a_manual_entry_is_source_user_with_no_lineage(session, account):
    project = account["project"]
    result = await adjust.add(session, project.id, None, layer="project", kind="constraint", title="No Redis", text="We do not use Redis.")

    entry = await fresh(session, result.entry_id)
    assert entry.source == "user"
    assert await count(session, EntryLineage, EntryLineage.entry_id == entry.id) == 0
    assert await jobs(session, project, "render") == 1


# ------------------------------------------------------------------ derive respects what a person did


async def test_derive_does_not_rewrite_an_edited_entry(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    await adjust.edit(session, entry.id, None, text="Postgres, as edited by hand.")

    await seeded(session, account, text=TRANSCRIPT + "\nUser: and Postgres 16.2 specifically.")
    await session.refresh(project)
    # Forward entailment would be an UPDATE on an entry nobody held.
    await run(session, project, FakeExtractor([candidate(title="we use Postgres 16.2", text="we use Postgres 16.2")]),
              nli=FakeNli(forward=ENTAILMENT, backward=NEUTRAL))

    after = await fresh(session, entry.id)
    text = (await session.execute(select(EntryRevision.text_).where(EntryRevision.entry_id == entry.id, EntryRevision.revision == after.current_revision))).scalar_one()
    assert text == "Postgres, as edited by hand."


async def test_derive_never_gives_a_manual_entry_lineage(session, account):
    project = await seeded(session, account)
    manual = await adjust.add(session, project.id, None, layer="project", kind="decision", title="we use Postgres", text="we use Postgres")
    from herder.services.embedding import embed_missing
    from tests.test_derive_db import FakeEmbedder

    await embed_missing(session, project, FakeEmbedder())
    await session.commit()
    await run(session, project, FakeExtractor([candidate(title="we use Postgres", text="we use Postgres")]),
              nli=FakeNli(forward=ENTAILMENT, backward=ENTAILMENT))

    assert await count(session, EntryLineage, EntryLineage.entry_id == manual.entry_id) == 0


async def test_a_contradiction_of_a_pinned_entry_asks_instead_of_superseding(session, account):
    await conflicted(session, account)


async def conflicted(session, account):
    """A pinned entry, then a derive whose candidate contradicts it. Returns the pieces."""
    project = await derived(session, account)
    entry = await only_entry(session, project)
    await adjust.act(session, entry.id, "pin", None)

    await seeded(session, account, text=TRANSCRIPT + "\nUser: we switched to MySQL.")
    await session.refresh(project)
    derive_run = await run(session, project, FakeExtractor([candidate(title="we use MySQL", text="we use MySQL")]),
                           nli=FakeNli(forward=CONTRADICTION, backward=CONTRADICTION))

    assert derive_run.conflicts == 1
    assert (await fresh(session, entry.id)).status == "pinned"
    suggestion = (await session.execute(select(Suggestion).where(Suggestion.project_id == project.id, Suggestion.kind == "conflict"))).scalars().one()
    assert suggestion.related_entry_id == entry.id
    return project, entry, suggestion


async def test_accepting_a_conflict_lets_the_new_claim_supersede_the_held_one(session, account):
    project, held, suggestion = await conflicted(session, account)

    await adjust.accept(session, suggestion.id, None)

    after = await fresh(session, held.id)
    assert after.status == "superseded"
    assert after.superseded_by == suggestion.entry_id


async def test_dismissing_a_conflict_removes_the_new_claim_so_it_cannot_return(session, account):
    project, held, suggestion = await conflicted(session, account)

    await adjust.dismiss(session, suggestion.id, None)

    assert (await fresh(session, held.id)).status == "pinned"
    assert (await fresh(session, suggestion.entry_id)).status == "removed"


# ------------------------------------------------------------------ suggestions


async def test_accepting_add_back_pins_the_entry(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    suggestion = Suggestion(id=uuid.uuid4(), project_id=project.id, kind="add_back", entry_id=entry.id, text_="add it back")
    session.add(suggestion)
    await session.commit()

    await adjust.accept(session, suggestion.id, None)

    assert (await fresh(session, entry.id)).status == "pinned"
    assert (await session.get(Suggestion, suggestion.id, populate_existing=True)).status == "accepted"


async def test_accepting_extract_writes_the_message_as_a_cited_entry(session, account):
    from herder.models import Conversation, Message

    project = await seeded(session, account)
    message = (
        await session.execute(
            select(Message).join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.project_id == project.id, Message.role == "user").limit(1)
        )
    ).scalars().first()
    suggestion = Suggestion(id=uuid.uuid4(), project_id=project.id, kind="extract", message_id=message.id, text_="extract it")
    session.add(suggestion)
    await session.commit()

    result = await adjust.accept(session, suggestion.id, None)

    entry = await fresh(session, result.entry_id)
    assert entry.source == "derived"
    lineage = (await session.execute(select(EntryLineage.message_id).where(EntryLineage.entry_id == entry.id))).scalars().all()
    assert lineage == [message.id]


async def test_a_promotion_suggestion_appears_and_accepting_it_moves_to_stable(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    await session.execute(update(Entry).where(Entry.id == entry.id).values(kind="preference", seen_in_conversations=3))
    await session.commit()

    await run(session, project, FakeExtractor([]))
    suggestion = (await session.execute(select(Suggestion).where(Suggestion.project_id == project.id, Suggestion.kind == "promote"))).scalars().one()
    await adjust.accept(session, suggestion.id, None)

    assert (await fresh(session, entry.id)).layer == "stable"


async def test_a_suggestion_cannot_be_decided_twice(session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    suggestion = Suggestion(id=uuid.uuid4(), project_id=project.id, kind="add_back", entry_id=entry.id, text_="x")
    session.add(suggestion)
    await session.commit()

    await adjust.dismiss(session, suggestion.id, None)
    with pytest.raises(Refused, match="already dismissed"):
        await adjust.accept(session, suggestion.id, None)


# ------------------------------------------------------------------ the API


async def test_the_api_adjusts_and_refuses_with_409(client, session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    pinned = await client.post(f"/v1/entries/{entry.id}/pin")
    again = await client.post(f"/v1/entries/{entry.id}/pin")

    assert pinned.status_code == 200 and pinned.json()["status"] == "pinned"
    assert again.status_code == 409
    assert "pinned" in again.json()["detail"]


async def test_the_api_says_a_manual_entry_has_no_lineage(client, session, account):
    project = account["project"]
    created = await client.post(
        f"/v1/projects/{project.id}/entries",
        json={"layer": "project", "kind": "constraint", "title": "No Redis", "text": "We do not use Redis."},
    )
    assert created.status_code == 201
    entry_id = created.json()["entry_id"]

    body = (await client.get(f"/v1/entries/{entry_id}/lineage")).json()
    assert body["source"] == "user"
    assert body["messages"] == []
    assert "by hand" in body["note"]

    listed = (await client.get(f"/v1/projects/{project.id}/entries")).json()
    assert "by hand" in next(e for e in listed if e["id"] == entry_id)["lineage_note"]


async def test_the_lineage_endpoint_returns_the_messages_behind_an_entry(client, session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)

    body = (await client.get(f"/v1/entries/{entry.id}/lineage")).json()
    assert body["note"] is None
    assert len(body["messages"]) == 1
    assert body["messages"][0]["role"] == "user"


async def test_the_suggestions_inbox_and_its_decisions(client, session, account):
    project = await derived(session, account)
    entry = await only_entry(session, project)
    suggestion = Suggestion(id=uuid.uuid4(), project_id=project.id, kind="add_back", entry_id=entry.id, text_="add it back")
    session.add(suggestion)
    await session.commit()

    inbox = (await client.get(f"/v1/projects/{project.id}/suggestions")).json()
    assert [s["id"] for s in inbox] == [str(suggestion.id)]

    decided = await client.post(f"/v1/suggestions/{suggestion.id}/accept")
    assert decided.status_code == 200
    assert decided.json()["adjusted"]["status"] == "pinned"
    assert (await client.get(f"/v1/projects/{project.id}/suggestions")).json() == []


async def test_adjusting_is_scoped_to_the_workspace(client, session, account):
    from herder.core.ids import uuid7
    from herder.models import User, Workspace

    project = await derived(session, account)
    entry = await only_entry(session, project)
    stranger = User(id=uuid7(), email=f"stranger-{uuid7().hex[:8]}@localhost")
    session.add(stranger)
    await session.flush()
    elsewhere = Workspace(id=uuid7(), name="elsewhere", owner_user_id=stranger.id)
    session.add(elsewhere)
    await session.flush()
    await session.execute(update(Project).where(Project.id == project.id).values(workspace_id=elsewhere.id))
    await session.commit()

    assert (await client.post(f"/v1/entries/{entry.id}/remove")).status_code == 404
    assert (await client.get(f"/v1/entries/{entry.id}/lineage")).status_code == 404
    assert (await fresh(session, entry.id)).status == "active"


# ------------------------------------------------------------------ the one that must never go red


async def test_removed_never_resurrects_end_to_end(client, session, account):
    """Paste, derive, remove, paste the same material again, derive: still gone.

    Through the API wherever the API does the step. Derive itself is called directly, because
    over HTTP it only enqueues a job and there is no worker inside a test - but it is the same
    function the worker calls.
    """
    project = account["project"]

    pasted = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT, "vendor": "claude", "project_id": str(project.id)})
    assert pasted.status_code == 201
    await session.refresh(project)
    same = [candidate(title="we use Postgres", text="we are going with Postgres for production")]
    await run(session, project, FakeExtractor(same))
    entry = await only_entry(session, project)

    removed = await client.post(f"/v1/entries/{entry.id}/remove")
    assert removed.status_code == 200

    again = await client.post(
        "/v1/ingest/paste",
        json={"text": TRANSCRIPT + "\nUser: we are going with Postgres for production, to repeat.", "vendor": "claude", "project_id": str(project.id)},
    )
    assert again.status_code == 201
    await session.refresh(project)
    second = await run(session, project, FakeExtractor(same), nli=FakeNli(forward=ENTAILMENT, backward=ENTAILMENT))

    assert second.dropped_removed == 1
    assert second.created == 0
    assert (await fresh(session, entry.id)).status == "removed"
    live = await count(session, Entry, Entry.project_id == project.id, Entry.kind != "tail", Entry.status != "removed")
    assert live == 0
    assert entry.id not in (await current_brief(session, project.id)).included_entry_ids
