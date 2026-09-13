"""Stage 5: resume packs.

The pure parts - preamble selection and pack assembly - need no database. The serve itself
does, because the point of a serve is the `injections` row it leaves behind.

Skips the database half when there is no database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from herder.models import BriefVersion, Injection, Project
from herder.services.derive import current_brief, render_project
from herder.services.serve import ServeError, build_pack, preamble_for, resume
from tests.test_derive_db import FakeExtractor, candidate, run, seeded  # noqa: F401

# No module-level `pytestmark = pytest.mark.asyncio`: half this file is synchronous, and the
# mark on a plain function is a warning today and an error in a later pytest-asyncio.


# ------------------------------------------------------------------ pure: the preamble


def test_each_vendor_gets_its_own_preamble() -> None:
    claude, _ = preamble_for("claude")
    chatgpt, _ = preamble_for("chatgpt")
    gemini, _ = preamble_for("gemini")
    assert claude != chatgpt != gemini


def test_an_unknown_vendor_falls_back_to_default() -> None:
    unknown, _ = preamble_for("some-new-chatbot")
    default, _ = preamble_for("default")
    assert unknown == default


def test_the_vendor_is_matched_case_insensitively() -> None:
    assert preamble_for("Claude")[0] == preamble_for("claude")[0]


@pytest.mark.parametrize("vendor", ["default", "claude", "chatgpt", "gemini"])
def test_every_variant_carries_the_two_lines_that_matter(vendor: str) -> None:
    """Stale context is what makes a memory system worse than no memory system, and a model
    reciting the block back wastes the first reply and leaks it on a shared screen."""
    # Whitespace-collapsed, because the preamble is wrapped prose and the phrase can fall
    # across a line break - "the user\nwins" is the same instruction as "the user wins".
    text, _ = preamble_for(vendor)
    flat = " ".join(text.lower().split())
    assert "user wins" in flat or "user is right" in flat
    assert "not summarise" in flat or "not repeat" in flat


def test_the_preamble_is_versioned() -> None:
    _, version = preamble_for("default")
    assert version == "1"


# ------------------------------------------------------------------ pure: the pack


def test_the_pack_wraps_the_brief_in_a_tag() -> None:
    pack = build_pack("demo", 7, "## Project\n- [fact] something", "default")
    assert pack.startswith('<herder-context v=1 project="demo" version=7>')
    assert pack.rstrip().endswith("</herder-context>")
    assert "- [fact] something" in pack


def test_integrity_is_omitted_when_it_has_never_been_measured() -> None:
    """Printing `integrity=0.00` for a project that was never checkpointed would be a lie
    with a number on it, and the number is the part people believe."""
    assert "integrity" not in build_pack("demo", 1, "body", "default")


def test_integrity_is_included_once_it_exists() -> None:
    assert "integrity=0.91" in build_pack("demo", 1, "body", "default", integrity=0.9123)


def test_a_quote_in_the_project_name_cannot_break_the_tag() -> None:
    pack = build_pack('the "big" one', 1, "body", "default")
    header = pack.splitlines()[0]
    assert header.count('"') == 2
    assert header.endswith(">")


# ------------------------------------------------------------------ the serve


@pytest.mark.asyncio
async def test_a_serve_records_an_injection(session, account):
    """The injection is the join key a checkpoint hangs off: which version went where, with
    the exact text that was sent."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    pack = await resume(session, project, vendor="claude", door="cli")

    injection = await session.get(Injection, pack.injection_id)
    assert injection is not None
    assert injection.door == "cli"
    assert injection.target_vendor == "claude"
    # The stored text is the text that was served, not a re-derivation of it.
    assert injection.pack_text == pack.text


@pytest.mark.asyncio
async def test_the_pack_carries_the_current_version(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    highest = (
        await session.execute(
            select(func.max(BriefVersion.version)).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    pack = await resume(session, project)
    assert pack.version == highest


@pytest.mark.asyncio
async def test_a_budget_override_renders_a_fresh_version(session, account):
    """Truncating the stored text would produce a pack matching no version in the database,
    and a checkpoint against it would be scored on a text that was never sent."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(title=f"entry {i}") for i in range(6)]))

    before = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()

    pack = await resume(session, project, budget_tokens=200)

    after = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()

    assert pack.rendered_fresh is True
    assert after == before + 1
    assert pack.budget_tokens == 200

    stored = await session.get(BriefVersion, pack.brief_version_id)
    assert stored.rendered_text in pack.text


@pytest.mark.asyncio
async def test_a_budget_override_does_not_change_the_project(session, account):
    """A caller asking for a smaller pack once must not quietly shrink every future derive."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    original = project.brief_budget_tokens

    await resume(session, project, budget_tokens=150)

    await session.refresh(project)
    assert project.brief_budget_tokens == original


@pytest.mark.asyncio
async def test_an_override_does_not_leak_into_the_next_plain_serve(session, account):
    """The override's version is the highest version, so a plain serve that took the highest
    handed every later caller the shrunken brief. Found reviewing stage 5. The plain serve
    reads the pointer now, so it gets the brief from before the override - not a re-render of
    it, which is what the first fix did and which wrote a duplicate version."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(title=f"entry {i}") for i in range(6)]))
    before = await resume(session, project)

    await resume(session, project, budget_tokens=150)
    plain = await resume(session, project)

    assert plain.budget_tokens == project.brief_budget_tokens
    assert plain.rendered_fresh is False
    assert plain.brief_version_id == before.brief_version_id


@pytest.mark.asyncio
async def test_an_override_is_stored_but_does_not_become_the_current_brief(session, account):
    """Invariant 5. Stored, because the injection points at it and stage 6 scores its text.
    Not current, because the brief is what the project's own budget produces."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    brief_before = await current_brief(session, project.id)

    pack = await resume(session, project, budget_tokens=150)

    assert await session.get(BriefVersion, pack.brief_version_id) is not None
    assert pack.version > brief_before.version
    assert (await current_brief(session, project.id)).id == brief_before.id


@pytest.mark.asyncio
async def test_an_override_rendered_before_the_current_brief_is_not_reused(session, account):
    """It was rendered from entries that have changed since, so serving it would be stale."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    old = await resume(session, project, budget_tokens=150)
    await render_project(session, project, "adjust")
    new = await resume(session, project, budget_tokens=150)

    assert new.rendered_fresh is True
    assert new.brief_version_id != old.brief_version_id


@pytest.mark.asyncio
async def test_the_brief_endpoint_shows_the_brief_not_the_override(client, account, session):
    from herder.services.ingest import ingest_paste

    project = account["project"]
    await ingest_paste(session, account["workspace"].id, text="User: we use Postgres.\nAssistant: ok.", vendor="claude")
    await session.refresh(project)
    await run(session, project, FakeExtractor([candidate()]))

    await resume(session, project, budget_tokens=150)
    body = (await client.get(f"/v1/projects/{project.id}/brief")).json()
    assert body["budget_tokens"] == project.brief_budget_tokens


@pytest.mark.asyncio
async def test_repeating_an_override_reuses_the_version_it_rendered(session, account):
    """Nothing changed between the two serves, so a second render would be a duplicate."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    first = await resume(session, project, budget_tokens=150)
    second = await resume(session, project, budget_tokens=150)

    assert second.rendered_fresh is False
    assert second.brief_version_id == first.brief_version_id


@pytest.mark.asyncio
async def test_an_override_on_a_project_with_no_brief_still_says_derive(session, account):
    """The override path used to render regardless, so a never-derived project served an
    empty pack and recorded an injection for it instead of saying what to do."""
    project = account["project"]
    with pytest.raises(ServeError) as exc:
        await resume(session, project, budget_tokens=150)
    assert "derive" in str(exc.value)

    versions = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    assert versions == 0


@pytest.mark.asyncio
async def test_the_vendor_is_stored_normalised(session, account):
    """Stage 6 groups checkpoints by vendor, and "Claude" and "claude" are one vendor."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    pack = await resume(session, project, vendor=" Claude ")
    injection = await session.get(Injection, pack.injection_id)
    assert injection.target_vendor == "claude"


@pytest.mark.asyncio
async def test_the_same_budget_reuses_the_current_version(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    before = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    pack = await resume(session, project, budget_tokens=project.brief_budget_tokens)
    after = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()

    assert pack.rendered_fresh is False
    assert after == before


@pytest.mark.asyncio
async def test_serving_a_project_with_no_brief_says_what_to_do(session, account):
    project = account["project"]
    with pytest.raises(ServeError) as exc:
        await resume(session, project)
    assert "derive" in str(exc.value)


@pytest.mark.asyncio
async def test_an_unknown_door_is_refused(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    with pytest.raises(ServeError):
        await resume(session, project, door="carrier-pigeon")


@pytest.mark.asyncio
async def test_integrity_is_none_until_a_checkpoint_exists(session, account):
    """Stage 6 creates checkpoints. Until then the tag carries no integrity attribute."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    pack = await resume(session, project)
    assert pack.integrity is None
    assert "integrity" not in pack.text


@pytest.mark.asyncio
async def test_the_endpoint_returns_a_pack_and_records_the_door(client, account, session):
    from herder.services.ingest import ingest_paste

    project = account["project"]
    await ingest_paste(session, account["workspace"].id, text="User: we use Postgres.\nAssistant: ok.", vendor="claude")
    await session.refresh(project)
    await run(session, project, FakeExtractor([candidate()]))

    response = await client.get(f"/v1/projects/{project.id}/resume?vendor=gemini")
    assert response.status_code == 200
    body = response.json()

    assert body["vendor"] == "gemini"
    assert body["door"] == "rest"
    assert body["pack_text"].startswith("<herder-context")
    assert body["token_count"] > 0
    assert body["integrity"] is None


@pytest.mark.asyncio
async def test_the_endpoint_404s_for_a_project_with_no_brief(client, account):
    response = await client.get(f"/v1/projects/{account['project'].id}/resume")
    assert response.status_code == 404
    assert "derive" in response.json()["detail"]


@pytest.mark.asyncio
async def test_the_endpoint_is_scoped_to_the_workspace(client, session, account):
    """The project has to really exist, in someone else's workspace. An id that was never
    stored 404s whether or not the tenancy check is there, so it proved nothing - and the
    detail is asserted because "no brief yet" is also a 404."""
    from herder.core.ids import uuid7
    from herder.models import User, Workspace

    stranger = User(id=uuid7(), email=f"stranger-{uuid7().hex[:8]}@localhost")
    session.add(stranger)
    await session.flush()
    elsewhere = Workspace(id=uuid7(), name="elsewhere", owner_user_id=stranger.id)
    session.add(elsewhere)
    await session.flush()
    other = Project(id=uuid7(), workspace_id=elsewhere.id, name="not-yours")
    session.add(other)
    await session.flush()

    response = await client.get(f"/v1/projects/{other.id}/resume")
    assert response.status_code == 404
    assert response.json()["detail"] == "no such project"
