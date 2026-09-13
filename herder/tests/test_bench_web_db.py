"""The fact-list authoring pages and the create-project endpoint. Against a temporary datasets
folder, so the tests never touch the real fact lists a person is writing.

Skips when there is no database.
"""

from __future__ import annotations

import json

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from bench import facts as F
from herder.core.db import get_session
from herder.main import create_app

pytestmark = pytest.mark.asyncio

CONVERSATION = "User: We store stock in SQLite.\n\nAssistant: Noted.\n\nUser: No Redis, please.\n\nAssistant: Understood."


@pytest.fixture
def datasets(tmp_path, monkeypatch):
    folder = tmp_path / "demo-convo"
    folder.mkdir()
    (folder / "conversation.txt").write_text(CONVERSATION, encoding="utf-8")
    (folder / "meta.json").write_text(json.dumps({"name": "demo-convo", "archetype": "coding", "title": "Demo", "tokens": 20, "turns": 4}))
    import herder.web.bench_routes as routes

    monkeypatch.setattr(routes, "DATASETS", tmp_path)
    return tmp_path


@pytest_asyncio.fixture
async def browser(session, account):
    app = create_app()

    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        client.cookies.set("herder_key", account["key"])
        yield client


async def test_the_list_shows_each_conversation_and_its_count(browser, datasets):
    body = (await browser.get("/bench")).text
    assert "Demo" in body and "coding" in body


async def test_the_author_page_shows_numbered_turns_and_no_derived_material(browser, datasets):
    body = (await browser.get("/bench/demo-convo")).text
    assert "#1 You:" in body and "#4 Assistant:" in body
    # Written from reading, never from an extraction: nothing herder derived is on this page.
    for derived in ("in brief", "confidence", "lineage", "[decision]"):
        assert derived not in body


async def test_adding_editing_and_deleting_a_fact_writes_the_file(browser, datasets):
    await browser.post("/bench/demo-convo/facts", data={"statement": "Stock is stored in SQLite.", "kind": "decision", "truth": "true", "turns": "1"})
    await browser.post("/bench/demo-convo/facts", data={"statement": "The service uses Redis.", "kind": "decision", "truth": "false", "turns": "3"})
    saved = F.load(datasets, "demo-convo")
    assert [(f.id, f.truth) for f in saved.facts] == [("f001", "true"), ("f002", "false")]

    await browser.post("/bench/demo-convo/facts", data={"fact_id": "f001", "statement": "Stock lives in SQLite.", "kind": "decision", "truth": "true", "turns": "1"})
    assert F.load(datasets, "demo-convo").facts[0].statement == "Stock lives in SQLite."

    await browser.post("/bench/demo-convo/facts/f002/delete")
    assert [f.id for f in F.load(datasets, "demo-convo").facts] == ["f001"]


async def test_a_bad_fact_is_refused_with_the_reason_and_not_saved(browser, datasets):
    response = await browser.post("/bench/demo-convo/facts", data={"statement": "x", "kind": "decision", "truth": "true", "turns": "99"})
    assert "out%20of%20range" in response.headers["location"]
    assert F.load(datasets, "demo-convo").facts == []


async def test_a_path_cannot_escape_the_datasets_folder(browser, datasets):
    # Encoded, so the client does not normalise them away before they reach the route - a
    # bare "/bench/.." is turned into "/" by the client and would test nothing.
    for name in ("%2E%2E%2Fdemo-convo", "..%2F..%2Fherder", "Demo-Convo", "demo-convo..", "%2E%2E"):
        response = await browser.get(f"/bench/{name}")
        assert response.status_code == 404, name


async def test_the_pages_are_off_when_authoring_is_disabled(browser, datasets, monkeypatch):
    from herder.core import config

    monkeypatch.setattr(config.get_settings(), "bench_authoring", False)
    assert (await browser.get("/bench")).status_code == 404


async def test_creating_a_project_through_the_api(client, account):
    created = await client.post("/v1/projects", json={"name": "bench-demo"})
    assert created.status_code == 201
    assert created.json()["name"] == "bench-demo"
    again = await client.post("/v1/projects", json={"name": "bench-demo"})
    assert again.status_code == 409
