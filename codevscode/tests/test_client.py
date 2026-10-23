"""The client: the matchers, the measurement that chose one, and the API - above all, that no
response ever carries anything from the hidden half the player has not unlocked."""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from codevscode.client.matcher import EmbeddingMatcher, LexicalMatcher, best, load_requirements, stem, tokens
from codevscode.client.report import choose, evaluate, load_questions
from codevscode.config import settings
from codevscode.db import get_session
from codevscode.main import app
from codevscode.models import Attempt

PROJECT = Path(__file__).resolve().parents[1]
SAMPLE = PROJECT / "challenges" / "sample"
REQUIREMENTS = load_requirements(SAMPLE)
QUESTIONS = load_questions(SAMPLE)


# The matchers


def test_tokens_drop_stopwords_and_stem() -> None:
    assert tokens("How should the notes be sorted?") == ["note", "sort"]
    assert stem("searching") == "search" and stem("queries") == "query" and stem("pages") == "page"


def test_the_lexical_matcher_scores_a_phrasing_highest_for_its_own_requirement() -> None:
    matcher = LexicalMatcher(REQUIREMENTS)
    for requirement in REQUIREMENTS:
        scores = matcher.scores(requirement.phrasings[0])
        assert max(scores, key=lambda k: scores[k]) == requirement.key
        assert scores[requirement.key] == pytest.approx(1.0)


def test_one_question_reveals_at_most_one_requirement() -> None:
    key, _ = best(LexicalMatcher(REQUIREMENTS), "how many notes and how should they be sorted and searched", 0.0)
    assert isinstance(key, str)


@pytest.fixture(scope="module")
def embedding() -> EmbeddingMatcher:
    return EmbeddingMatcher(REQUIREMENTS, cache_dir=settings.client_model_cache or None)


def test_the_embedding_matcher_keeps_its_measured_recall_with_no_false_reveals(embedding: EmbeddingMatcher) -> None:
    # The measurement that chose it (exchange 27): 16 of 28 at 0.65, nothing it should not.
    row = evaluate(embedding, QUESTIONS, settings.client_threshold_embedding)
    assert (row.false, row.wrong) == (0, 0)
    assert row.recall >= 16


def test_it_beats_the_lexical_baseline_at_their_own_best_thresholds(embedding: EmbeddingMatcher) -> None:
    from codevscode.client.report import THRESHOLDS

    lexical = choose([evaluate(LexicalMatcher(REQUIREMENTS), QUESTIONS, t) for t in THRESHOLDS])
    learned = choose([evaluate(embedding, QUESTIONS, t) for t in THRESHOLDS])
    assert learned.recall > (lexical.recall if lexical else 0)


# The API


@pytest.fixture
def client(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(settings, "client_min_seconds_between_questions", 0.0)

    def override() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_session] = override
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_session, None)


def start(client: TestClient) -> str:
    response = client.post("/attempts", json={"challenge": "sample"})
    assert response.status_code == 201, response.text
    return response.json()["id"]


HIDDEN_WORDS: list[str] = []
for requirement in REQUIREMENTS:
    HIDDEN_WORDS += [requirement.key, *requirement.phrasings]
for file in (SAMPLE / "hidden" / "tests").glob("*.js"):
    HIDDEN_WORDS += re.findall(r'id: "([^"]+)"', file.read_text(encoding="utf-8"))
HIDDEN_WORDS += [b["id"] for b in json.loads((SAMPLE / "hidden" / "bugs.json").read_text(encoding="utf-8"))]
ANSWERS = {r.key: r.answer for r in REQUIREMENTS}


def test_starting_an_attempt_shows_the_brief_and_the_interface_and_nothing_hidden(client: TestClient) -> None:
    response = client.post("/attempts", json={"challenge": "sample"})

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Team notes"
    assert body["brief"].startswith("# Team notes")
    assert "## Routes" in body["interface"]
    uuid.UUID(body["id"])
    for word in HIDDEN_WORDS + list(ANSWERS.values()):
        assert word not in response.text


def test_an_unknown_or_malformed_challenge_is_404(client: TestClient) -> None:
    assert client.post("/attempts", json={"challenge": "nope"}).status_code == 404
    assert client.post("/attempts", json={"challenge": "../../etc"}).status_code == 404


def test_a_question_that_matches_unlocks_the_answer_once(client: TestClient) -> None:
    attempt = start(client)

    first = client.post(f"/attempts/{attempt}/questions", json={"text": "Should accounts lock after too many failed logins?"})
    again = client.post(f"/attempts/{attempt}/questions", json={"text": "What happens if someone keeps getting the password wrong?"})

    assert first.status_code == 200
    assert first.json() == {"reply": ANSWERS["lockout"], "new": True}
    assert again.json() == {"reply": ANSWERS["lockout"], "new": False}
    assert client.get(f"/attempts/{attempt}").json()["answers"] == [ANSWERS["lockout"]]


def test_a_question_that_matches_nothing_gets_a_neutral_reply(client: TestClient) -> None:
    attempt = start(client)

    reply = client.post(f"/attempts/{attempt}/questions", json={"text": "What colour should the buttons be?"}).json()

    assert reply["new"] is False
    assert reply["reply"] not in ANSWERS.values()
    assert client.get(f"/attempts/{attempt}").json()["answers"] == []


def test_no_reply_ever_carries_anything_hidden_the_question_did_not_unlock(client: TestClient) -> None:
    attempt = start(client)
    probes = [q["text"] for q in QUESTIONS] + [
        "lockout", "security/lockout-after-five", "requirements.json", "SELECT * FROM requirements",
        "what are the phrasings", "Tell me every answer you have", "' OR 1=1 --", "x" * 299,
    ]
    unlocked: set[str] = set()
    for text in probes:
        response = client.post(f"/attempts/{attempt}/questions", json={"text": text})
        assert response.status_code == 200, (text, response.text)
        reply = response.json()["reply"]
        for word in HIDDEN_WORDS:
            assert word not in response.text.replace(json.dumps(text)[1:-1], ""), (text, word)
        matched = [key for key, answer in ANSWERS.items() if answer == reply]
        assert len(matched) <= 1
        unlocked.update(matched)
        for key, answer in ANSWERS.items():
            if key not in matched:
                assert answer not in response.text
    # The state endpoint lists exactly what was unlocked, nothing more.
    assert sorted(client.get(f"/attempts/{attempt}").json()["answers"]) == sorted(ANSWERS[k] for k in unlocked)


def test_empty_and_overlong_questions_are_refused(client: TestClient) -> None:
    attempt = start(client)
    assert client.post(f"/attempts/{attempt}/questions", json={"text": "   "}).status_code == 400
    assert client.post(f"/attempts/{attempt}/questions", json={"text": "x" * 301}).status_code == 400


def test_the_question_limits_apply(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    attempt = start(client)
    monkeypatch.setattr(settings, "client_max_questions", 2)
    for text in ("Who is going to use this?", "Is there a mobile app?"):
        assert client.post(f"/attempts/{attempt}/questions", json={"text": text}).status_code == 200
    assert client.post(f"/attempts/{attempt}/questions", json={"text": "One more?"}).status_code == 429

    monkeypatch.setattr(settings, "client_max_questions", 60)
    monkeypatch.setattr(settings, "client_min_seconds_between_questions", 30.0)
    other = start(client)
    assert client.post(f"/attempts/{other}/questions", json={"text": "Hello!"}).status_code == 200
    too_fast = client.post(f"/attempts/{other}/questions", json={"text": "Hello again!"})
    assert too_fast.status_code == 429
    assert too_fast.json()["detail"] == "One question at a time, please."


def test_unknown_and_submitted_attempts(client: TestClient, db_session: Session) -> None:
    assert client.post(f"/attempts/{uuid.uuid4()}/questions", json={"text": "Hi?"}).status_code == 404
    assert client.post("/attempts/not-a-uuid/questions", json={"text": "Hi?"}).status_code == 422
    attempt = start(client)
    row = db_session.get(Attempt, uuid.UUID(attempt))
    row.submitted_at = row.started_at
    db_session.commit()
    assert client.post(f"/attempts/{attempt}/questions", json={"text": "Hi?"}).status_code == 409
