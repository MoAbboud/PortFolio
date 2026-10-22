"""The judge's queue and worker, against the real database.

The queue tests need PostgreSQL; the worker tests also need Docker and the judge image. Rows a
test creates are deleted afterwards, so a developer's own queue is left alone.
"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, sessionmaker

from codevscode.config import Settings
from codevscode.db import engine
from codevscode.judge import queue, worker
from codevscode.models import Job

PROJECT = Path(__file__).resolve().parents[1]
TINY_REFERENCE = PROJECT / "test" / "fixtures" / "tiny" / "hidden" / "reference"


@pytest.fixture
def sessions() -> Iterator[sessionmaker[Session]]:
    """A session factory on the real database; every job created through it is deleted after."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1 FROM jobs LIMIT 1"))
    except SQLAlchemyError as exc:
        if os.environ.get("REQUIRE_DB") == "1":
            pytest.fail(f"REQUIRE_DB=1 and no migrated database: {exc}")
        pytest.skip(f"no migrated database: {type(exc).__name__}")
    with engine.connect() as connection:
        before = connection.execute(text("SELECT coalesce(max(id), 0) FROM jobs")).scalar()
        # Jobs left queued by anything else would be claimed by these tests; park them.
        parked = connection.execute(text("UPDATE jobs SET status = 'failed' WHERE status = 'queued' RETURNING id")).scalars().all()
        connection.commit()
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        with engine.connect() as connection:
            connection.execute(text("DELETE FROM jobs WHERE id > :before"), {"before": before})
            if parked:
                connection.execute(text("UPDATE jobs SET status = 'queued' WHERE id = ANY(:ids)"), {"ids": parked})
            connection.commit()


def get(sessions: sessionmaker[Session], job_id: int) -> Job:
    with sessions() as session:
        return session.get(Job, job_id)


def test_jobs_are_claimed_oldest_first_and_only_once(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        first = queue.enqueue(session, "judge", {"n": 1})
        second = queue.enqueue(session, "judge", {"n": 2})
        assert queue.claim(session, "a").id == first
        assert queue.claim(session, "b").id == second
        assert queue.claim(session, "c") is None
    job = get(sessions, first)
    assert (job.status, job.attempts, job.locked_by) == ("running", 1, "a")
    assert job.locked_at is not None and job.started_at is not None


def test_a_job_locked_by_another_worker_is_skipped_not_waited_for(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        first = queue.enqueue(session, "judge", {"n": 1})
        second = queue.enqueue(session, "judge", {"n": 2})
    # Another worker is mid-claim on the first job: its row lock is held, uncommitted.
    with engine.connect() as other:
        other.execute(text("SELECT id FROM jobs WHERE id = :id FOR UPDATE"), {"id": first})
        with sessions() as session:
            assert queue.claim(session, "me").id == second
        other.rollback()


def test_a_failed_run_is_retried_until_max_attempts_then_failed(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        job_id = queue.enqueue(session, "judge", {}, max_attempts=2)
        queue.claim(session, "w")
        assert queue.fail(session, job_id, "docker was down") == "queued"
        assert queue.claim(session, "w").id == job_id
        assert queue.fail(session, job_id, "docker was down again") == "failed"
        assert queue.claim(session, "w") is None
    job = get(sessions, job_id)
    assert (job.status, job.attempts, job.error) == ("failed", 2, "docker was down again")
    assert job.finished_at is not None and job.locked_at is None


def test_the_reaper_requeues_a_job_whose_worker_died_and_fails_it_at_the_limit(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        job_id = queue.enqueue(session, "judge", {}, max_attempts=2)
        queue.claim(session, "dead-worker")
        # Nothing is stale yet.
        assert queue.reap(session, 300) == 0
        session.execute(text("UPDATE jobs SET locked_at = now() - interval '10 minutes' WHERE id = :id"), {"id": job_id})
        session.commit()
        assert queue.reap(session, 300) == 1
        assert get(sessions, job_id).status == "queued"
        queue.claim(session, "another-dead-worker")
        session.execute(text("UPDATE jobs SET locked_at = now() - interval '10 minutes' WHERE id = :id"), {"id": job_id})
        session.commit()
        assert queue.reap(session, 300) == 1
    job = get(sessions, job_id)
    assert (job.status, job.attempts) == ("failed", 2)
    assert "lock expired" in job.error


def test_completing_stores_the_result(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        job_id = queue.enqueue(session, "house", {})
        queue.claim(session, "w")
        queue.complete(session, job_id, {"verdict": "ran", "results": []})
    job = get(sessions, job_id)
    assert (job.status, job.result, job.locked_at) == ("done", {"verdict": "ran", "results": []}, None)


def test_an_unknown_kind_is_refused(sessions: sessionmaker[Session]) -> None:
    with sessions() as session, pytest.raises(ValueError):
        queue.enqueue(session, "mine-bitcoin", {})


def test_a_job_naming_no_real_challenge_is_done_with_an_error_not_retried(sessions: sessionmaker[Session]) -> None:
    with sessions() as session:
        job_id = queue.enqueue(session, "judge", {"challenge": "../../etc", "files": {}})
    assert worker.run_once(sessions, name="t") == job_id
    job = get(sessions, job_id)
    assert job.status == "done"
    assert job.result["verdict"] == "error"
    assert "not a challenge slug" in job.result["detail"]


def _judge_image_ready() -> bool:
    try:
        return subprocess.run(["docker", "image", "inspect", "codevscode-judge"], capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


needs_docker = pytest.mark.skipif(
    not _judge_image_ready() and os.environ.get("REQUIRE_DOCKER") != "1",
    reason="Docker and the codevscode-judge image are needed",
)


@needs_docker
def test_the_worker_judges_a_queued_submission_end_to_end(sessions: sessionmaker[Session]) -> None:
    files = {name: (TINY_REFERENCE / name).read_text(encoding="utf-8") for name in ("app.js", "schema.sql")}
    config = Settings(challenges_dir=str(PROJECT / "test" / "fixtures"))
    with sessions() as session:
        job_id = queue.enqueue(session, "judge", {"challenge": "tiny", "files": files})

    assert worker.run_once(sessions, name="t", config=config) == job_id

    job = get(sessions, job_id)
    assert job.status == "done"
    assert job.result["verdict"] == "ran"
    assert [r["status"] for r in job.result["results"]] == ["pass"] * 4


@needs_docker
def test_the_worker_retries_when_the_sandbox_itself_fails(sessions: sessionmaker[Session]) -> None:
    config = Settings(challenges_dir=str(PROJECT / "test" / "fixtures"), judge_image="codevscode-judge-missing")
    with sessions() as session:
        job_id = queue.enqueue(session, "judge", {"challenge": "tiny", "files": {"app.js": "", "schema.sql": ""}}, max_attempts=2)

    worker.run_once(sessions, name="t", config=config)
    job = get(sessions, job_id)
    assert (job.status, job.attempts) == ("queued", 1)
    worker.run_once(sessions, name="t", config=config)
    job = get(sessions, job_id)
    assert (job.status, job.attempts) == ("failed", 2)
    assert "image" in job.error.lower() or "docker" in job.error.lower()
