"""End-to-end auth + adventures vertical slice."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _register_and_login(client: TestClient) -> dict[str, str]:
    client.post(
        "/api/v1/auth/register",
        json={"email": "maya@example.com", "username": "maya", "password": "supersecret1"},
    )
    response = client.post(
        "/api/v1/auth/login",
        json={"email": "maya@example.com", "password": "supersecret1"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_register_rejects_duplicate_email(client: TestClient) -> None:
    payload = {"email": "a@example.com", "username": "alice", "password": "password123"}
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201

    dup = {"email": "a@example.com", "username": "alice2", "password": "password123"}
    assert client.post("/api/v1/auth/register", json=dup).status_code == 409


def test_adventures_require_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/adventures").status_code == 401


def test_create_and_list_adventure(client: TestClient) -> None:
    headers = _register_and_login(client)
    payload = {
        "title": "Lazy Sunday Reset",
        "vibe": "chill",
        "city": "Kansas City, MO",
        "weather": {"code": 1, "temp_max": 74, "temp_min": 58},
        "stops": [
            {"name": "City Market Brunch", "type": "cafe", "time": "10:00"},
            {
                "name": "Nelson-Atkins Museum",
                "type": "attraction",
                "time": "12:00",
                "lat": 39.0454,
                "lon": -94.5810,
            },
        ],
    }

    created = client.post("/api/v1/adventures", json=payload, headers=headers)
    assert created.status_code == 201
    body = created.json()
    assert body["title"] == "Lazy Sunday Reset"
    assert body["is_shared"] is False
    assert [stop["position"] for stop in body["stops"]] == [0, 1]
    # New: a stats row and a weather row come back with the adventure.
    assert body["stats"] == {"views": 0, "likes_count": 0, "comments_count": 0}
    assert body["weather"]["code"] == 1
    assert body["weather"]["temp_max"] == 74

    listed = client.get("/api/v1/adventures", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1


def test_create_adventure_rejects_invalid_vibe(client: TestClient) -> None:
    headers = _register_and_login(client)
    bad = {"title": "Mystery day", "vibe": "party", "stops": []}
    assert client.post("/api/v1/adventures", json=bad, headers=headers).status_code == 422
