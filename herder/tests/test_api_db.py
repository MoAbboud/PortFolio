"""The HTTP surface: auth, status codes, and reading the log back.

Skips when there is no database.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio

TRANSCRIPT = "User: we are using Postgres in production.\nAssistant: noted."


async def test_paste_round_trip(client):
    response = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT, "vendor": "claude"})
    assert response.status_code == 201
    body = response.json()
    assert body["accepted"] == 2
    assert body["duplicates"] == 0

    conversation_id = body["conversation_ids"][0]
    read = await client.get(f"/v1/conversations/{conversation_id}/messages")
    assert read.status_code == 200
    messages = read.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"].startswith("we are using Postgres")


async def test_no_key_is_401(client):
    del client.headers["X-API-Key"]
    response = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT})
    assert response.status_code == 401
    assert "API key" in response.json()["detail"]


async def test_an_unknown_key_is_401(client):
    client.headers["X-API-Key"] = "hrd_not-a-real-key"
    response = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT})
    assert response.status_code == 401


async def test_bearer_works_too(client, account):
    del client.headers["X-API-Key"]
    client.headers["Authorization"] = f"Bearer {account['key']}"
    response = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT})
    assert response.status_code == 201


async def test_health_needs_no_key(client):
    del client.headers["X-API-Key"]
    response = await client.get("/health")
    assert response.status_code == 200


async def test_an_empty_paste_is_400_not_a_conversation(client):
    response = await client.post("/v1/ingest/paste", json={"text": "   "})
    assert response.status_code == 400


async def test_an_oversize_paste_is_refused_with_the_size(client, monkeypatch):
    from herder.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_paste_bytes", 50)
    response = await client.post("/v1/ingest/paste", json={"text": TRANSCRIPT * 10})
    assert response.status_code == 400
    assert "cap is 50" in response.json()["detail"]


async def test_an_unparseable_transcript_is_422_with_a_reason(client):
    """Not 400: the request was well formed, its content was not understood."""
    response = await client.post("/v1/ingest/paste", json={"text": "just prose, no speakers here"})
    assert response.status_code == 422
    assert "no speaker markers" in response.json()["detail"]


async def test_reading_a_conversation_that_is_not_yours_is_404(client, session):
    """Not 403. Whether an id exists in someone else's workspace is not confirmed."""
    from herder.core.ids import uuid7
    from herder.models import Conversation, Project, User, Workspace

    other_user = User(id=uuid7(), email=f"other-{uuid7().hex[:6]}@localhost")
    session.add(other_user)
    await session.flush()
    other_ws = Workspace(id=uuid7(), name="other", owner_user_id=other_user.id)
    session.add(other_ws)
    await session.flush()
    other_project = Project(id=uuid7(), workspace_id=other_ws.id, name="theirs")
    session.add(other_project)
    await session.flush()
    conversation = Conversation(id=uuid7(), project_id=other_project.id, vendor="claude", vendor_conv_id="x")
    session.add(conversation)
    await session.flush()

    response = await client.get(f"/v1/conversations/{conversation.id}/messages")
    assert response.status_code == 404


async def test_batch_ingest_reports_duplicates(client):
    events = {
        "events": [
            {"vendor": "chatgpt", "vendor_conv_id": "c-9", "role": "user", "content": "hello", "position": 0}
        ]
    }
    first = await client.post("/v1/ingest", json=events)
    assert first.status_code == 202
    assert first.json()["accepted"] == 1

    second = await client.post("/v1/ingest", json=events)
    assert second.json() == {**second.json(), "accepted": 0, "duplicates": 1}


async def test_an_empty_batch_is_400(client):
    response = await client.post("/v1/ingest", json={"events": []})
    assert response.status_code == 400
