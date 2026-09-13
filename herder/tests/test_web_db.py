"""Stage 8: the pages, through HTTP, against a real database.

These check that each page shows what the task list says it shows and that each button does
what it says - not how anything looks, which is deliberately nothing yet.

Skips when there is no database.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, update

from herder.core.db import get_session
from herder.main import create_app
from herder.models import Entry, Job, Project, Suggestion
from herder.services.checkpoint import run_checkpoint
from herder.services.derive import render_project
from herder.services.serve import resume
from tests.test_checkpoint_db import FakeAnswerer, FakeGenerator, FakeJudge
from tests.test_derive_db import FakeExtractor, candidate, run, seeded

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def browser(session, account):
    """A client that follows no redirects and is logged in by cookie, as a browser would be."""
    app = create_app()

    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("herder_key", account["key"])
        yield client


@pytest_asyncio.fixture
async def anonymous(session):
    app = create_app()

    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client


async def derived(session, account, *titles):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(title=t, text=t) for t in (titles or ("we use Postgres",))]))
    return project


async def an_entry(session, project) -> Entry:
    return (await session.execute(select(Entry).where(Entry.project_id == project.id, Entry.kind != "tail").limit(1))).scalars().one()


# ------------------------------------------------------------------ login


async def test_every_page_sends_a_stranger_to_login(anonymous, account):
    for path in ("/", f"/projects/{account['project'].id}", f"/projects/{account['project'].id}/brief"):
        response = await anonymous.get(path)
        assert response.status_code == 303
        assert response.headers["location"] == "/login"


async def test_a_form_post_without_the_cookie_does_nothing(anonymous, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    response = await anonymous.post(f"/entries/{entry.id}/act/remove", data={"back": "/"})
    assert response.status_code == 303 and response.headers["location"] == "/login"
    assert (await session.execute(select(Entry.status).where(Entry.id == entry.id))).scalar_one() == "active"


async def test_logging_in_sets_a_strict_http_only_cookie(anonymous, account):
    response = await anonymous.post("/login", data={"key": account["key"]})
    assert response.status_code == 303 and response.headers["location"] == "/"
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie


async def test_a_wrong_key_is_told_so_and_gets_no_cookie(anonymous):
    response = await anonymous.post("/login", data={"key": "hrd_not-a-real-key"})
    assert response.headers["location"].startswith("/login?notice=")
    assert "set-cookie" not in response.headers


# ------------------------------------------------------------------ dashboard and paste


async def test_the_dashboard_shows_the_numbers(browser, session, account):
    project = await derived(session, account)
    body = (await browser.get("/")).text

    assert project.name in body
    for heading in ("Tokens captured", "Stable", "Project", "Session", "Brief tokens", "Compression", "Integrity over time", "Job failures"):
        assert heading in body
    assert "never measured" in body


async def test_the_dashboard_lists_job_failures(browser, session, account):
    project = await derived(session, account)
    session.add(Job(id=uuid.uuid4(), kind="derive", payload={"project_id": str(project.id)}, status="failed", error="boom: the model fell over"))
    await session.commit()
    assert "boom: the model fell over" in (await browser.get("/")).text


async def test_pasting_into_a_new_project_stores_it_and_queues_a_derive(browser, session, account):
    response = await browser.post(
        "/paste", data={"text": "User: we use Postgres.\nAssistant: ok.", "new_project": "from-the-page", "vendor": "claude"}
    )
    assert response.status_code == 303

    project = (await session.execute(select(Project).where(Project.name == "from-the-page"))).scalars().one()
    assert response.headers["location"].startswith(f"/projects/{project.id}")
    assert "Stored 2 new messages" in response.headers["location"].replace("%20", " ")
    jobs =(await session.execute(select(Job).where(Job.kind == "derive", Job.payload["project_id"].astext == str(project.id)))).scalars().all()
    assert len(jobs) == 1


async def test_an_empty_paste_stores_nothing_and_creates_no_project(browser, session):
    response = await browser.post("/paste", data={"text": "   ", "new_project": "empty-one"})
    assert response.headers["location"].startswith("/?notice=Nothing%20was%20stored")
    assert (await session.execute(select(Project).where(Project.name == "empty-one"))).scalars().first() is None


# ------------------------------------------------------------------ the adjuster


async def test_the_adjuster_has_three_columns_suggestions_and_entry_details(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    session.add(Suggestion(id=uuid.uuid4(), project_id=project.id, kind="add_back", entry_id=entry.id, text_="bring this back please"))
    await session.commit()

    body = (await browser.get(f"/projects/{project.id}")).text

    assert body.index("Suggestions") < body.index("Entries")
    assert "bring this back please" in body
    for column in ("Stable (", "Project (", "Session ("):
        assert column in body
    assert "we use Postgres" in body
    assert "confidence 0.90" in body
    assert "in brief" in body
    assert f"/entries/{entry.id}/act/pin" in body and f"/entries/{entry.id}/act/remove" in body


async def test_the_pin_button_pins_and_comes_back(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)

    response = await browser.post(f"/entries/{entry.id}/act/pin", data={"back": f"/projects/{project.id}"})

    assert response.status_code == 303
    assert response.headers["location"].startswith(f"/projects/{project.id}?notice=")
    assert (await session.execute(select(Entry.status).where(Entry.id == entry.id).execution_options(populate_existing=True))).scalar_one() == "pinned"


async def test_a_refused_button_says_why(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    response = await browser.post(f"/entries/{entry.id}/act/unpin", data={"back": f"/projects/{project.id}"})
    assert "Refused" in response.headers["location"]


async def test_back_cannot_send_the_browser_off_site(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    response = await browser.post(f"/entries/{entry.id}/act/pin", data={"back": "//evil.example/"})
    assert response.headers["location"].startswith(f"/projects/{project.id}")


async def test_the_edit_form_saves_a_revision(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    response = await browser.post(f"/entries/{entry.id}/edit", data={"title": "Postgres", "text": "Production runs on Postgres 16.", "layer": "project"})
    assert response.headers["location"].startswith(f"/entries/{entry.id}?notice=Saved")
    assert "Production runs on Postgres 16." in (await browser.get(f"/entries/{entry.id}")).text


async def test_accepting_a_suggestion_from_the_page_acts_on_it(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    suggestion = Suggestion(id=uuid.uuid4(), project_id=project.id, kind="add_back", entry_id=entry.id, text_="x")
    session.add(suggestion)
    await session.commit()

    await browser.post(f"/suggestions/{suggestion.id}/accept")
    assert (await session.execute(select(Entry.status).where(Entry.id == entry.id).execution_options(populate_existing=True))).scalar_one() == "pinned"


async def test_adding_an_entry_by_hand_from_the_page(browser, session, account):
    project = account["project"]
    await browser.post(f"/projects/{project.id}/entries/new", data={"layer": "project", "kind": "constraint", "title": "No Redis", "text": "We do not use Redis."})
    body = (await browser.get(f"/projects/{project.id}")).text
    assert "No Redis" in body and "added by hand" in body


# ------------------------------------------------------------------ lineage


async def test_the_lineage_panel_shows_the_message_with_the_entry_highlighted(browser, session, account):
    project = await seeded(session, account)
    await run(session, project, FakeExtractor([candidate(title="Postgres", text="we are going with Postgres for production instead of SQLite")]))
    entry = await an_entry(session, project)

    body = (await browser.get(f"/entries/{entry.id}")).text
    assert "<mark>we are going with Postgres for production instead of SQLite</mark>" in body


async def test_a_manual_entry_says_it_has_no_lineage(browser, session, account):
    from herder.services import adjust

    result = await adjust.add(session, account["project"].id, None, layer="project", kind="fact", title="By hand", text="Typed in.")
    assert "Added by hand." in (await browser.get(f"/entries/{result.entry_id}")).text


# ------------------------------------------------------------------ brief, pack, checkpoint


async def test_the_brief_page_has_the_text_a_copy_button_versions_and_a_diff(browser, session, account):
    project = await derived(session, account)
    entry = await an_entry(session, project)
    await session.execute(update(Entry).where(Entry.id == entry.id).values(status="removed"))
    await render_project(session, project, "adjust")
    await session.commit()

    plain = (await browser.get(f"/projects/{project.id}/brief")).text
    assert 'data-copy="brief-text"' in plain
    assert "v1" in plain and "v2" in plain and "current" in plain

    diffed = (await browser.get(f"/projects/{project.id}/brief?version=2&compare=1")).text
    assert "Changes from v1 to v2" in diffed
    assert 'class="del"' in diffed


async def test_serving_from_the_page_shows_a_copyable_pack(browser, session, account):
    project = await derived(session, account)
    response = await browser.post(f"/projects/{project.id}/serve", data={"vendor": "claude"})
    assert response.status_code == 303 and response.headers["location"].startswith("/packs/")

    body = (await browser.get(response.headers["location"])).text
    assert "&lt;herder-context" in body
    assert 'data-copy="pack-text"' in body
    assert "Run a checkpoint" in body


async def test_running_a_checkpoint_from_the_page_queues_a_job(browser, session, account):
    project = await derived(session, account)
    pack = await resume(session, project)
    response = await browser.post(f"/packs/{pack.injection_id}/checkpoint")
    assert response.status_code == 303
    jobs = (await session.execute(select(Job).where(Job.kind == "checkpoint", Job.payload["injection_id"].astext == str(pack.injection_id)))).scalars().all()
    assert len(jobs) == 1


async def test_the_checkpoint_page_shows_every_probe_and_adds_back(browser, session, account):
    project = await derived(session, account, *[f"decision number {i} about the system" for i in range(6)])
    small = await resume(session, project, budget_tokens=40)
    result = await run_checkpoint(session, small.injection_id, FakeGenerator(), FakeAnswerer("no idea"), FakeJudge(), floor=0.5)

    body = (await browser.get(f"/checkpoints/{result.checkpoint_id}")).text
    for word in ("Question", "Expected", "Answer", "Score", "Reason", "included", "excluded"):
        assert word in body
    assert "one system checking itself" in body

    excluded = next(r for r in result.reports if r.category == "excluded")
    assert f"/entries/{excluded.entry_id}/add-back" in body
    await browser.post(f"/entries/{excluded.entry_id}/add-back", data={"back": f"/checkpoints/{result.checkpoint_id}"})
    status = (await session.execute(select(Entry.status).where(Entry.id == excluded.entry_id).execution_options(populate_existing=True))).scalar_one()
    assert status == "pinned"


async def test_pages_are_scoped_to_the_workspace(browser, session, account):
    from herder.core.ids import uuid7
    from herder.models import User, Workspace

    project = await derived(session, account)
    entry = await an_entry(session, project)
    stranger = User(id=uuid7(), email=f"stranger-{uuid7().hex[:8]}@localhost")
    session.add(stranger)
    await session.flush()
    elsewhere = Workspace(id=uuid7(), name="elsewhere", owner_user_id=stranger.id)
    session.add(elsewhere)
    await session.flush()
    await session.execute(update(Project).where(Project.id == project.id).values(workspace_id=elsewhere.id))
    await session.commit()

    assert (await browser.get(f"/projects/{project.id}")).status_code == 404
    assert (await browser.get(f"/entries/{entry.id}")).status_code == 404
    assert (await browser.post(f"/entries/{entry.id}/act/remove", data={})).status_code == 404
    assert project.name not in (await browser.get("/")).text


async def test_user_text_is_escaped_on_the_adjuster(browser, session, account):
    project = await derived(session, account, "<img src=x onerror=alert(1)>")
    body = (await browser.get(f"/projects/{project.id}")).text
    assert "<img src=x" not in body
    assert "&lt;img src=x" in body
