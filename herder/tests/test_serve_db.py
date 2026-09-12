"""Stage 5: resume packs.

The pure parts - preamble selection and pack assembly - need no database. The serve itself
does, because the point of a serve is the `injections` row it leaves behind.

Skips the database half when there is no database.
"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from herder.domain.merge import ENTAILMENT, NEUTRAL  # noqa: F401  (kept for parity with siblings)
from herder.models import BriefVersion, Injection, Project
from herder.services.serve import ServeError, build_pack, preamble_for, resume
from tests.test_derive_db import FakeExtractor, candidate, run, seeded  # noqa: F401

pytestmark = pytest.mark.asyncio


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


async def test_a_budget_override_does_not_change_the_project(session, account):
    """A caller asking for a smaller pack once must not quietly shrink every future derive."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    original = project.brief_budget_tokens

    await resume(session, project, budget_tokens=150)

    await session.refresh(project)
    assert project.brief_budget_tokens == original


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


async def test_serving_a_project_with_no_brief_says_what_to_do(session, account):
    project = account["project"]
    with pytest.raises(ServeError) as exc:
        await resume(session, project)
    assert "derive" in str(exc.value)


async def test_an_unknown_door_is_refused(session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))
    with pytest.raises(ServeError):
        await resume(session, project, door="carrier-pigeon")


async def test_integrity_is_none_until_a_checkpoint_exists(session, account):
    """Stage 6 creates checkpoints. Until then the tag carries no integrity attribute."""
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate()]))

    pack = await resume(session, project)
    assert pack.integrity is None
    assert "integrity" not in pack.text


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


async def test_the_endpoint_404s_for_a_project_with_no_brief(client, account):
    response = await client.get(f"/v1/projects/{account['project'].id}/resume")
    assert response.status_code == 404
    assert "derive" in response.json()["detail"]


async def test_the_endpoint_is_scoped_to_the_workspace(client, session):
    from herder.core.ids import uuid7

    other = Project(id=uuid7(), workspace_id=uuid7(), name="not-yours")
    response = await client.get(f"/v1/projects/{other.id}/resume")
    assert response.status_code == 404
