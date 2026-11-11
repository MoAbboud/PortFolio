"""The job queue, in PostgreSQL.

A worker claims the oldest queued job with SELECT ... FOR UPDATE SKIP LOCKED, so two workers
never take the same job and neither waits for the other. A claimed job carries `locked_at`;
the reaper puts a job back in the queue when that lock is older than any run could take - its
worker was killed mid-job. herder's derive jobs had no reaper and no retries: a worker killed
mid-derive wedged that project forever, silently. Both are here from the first version.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from codevscode.models import JOB_KINDS, Job


def enqueue(session: Session, kind: str, payload: dict[str, Any], *, max_attempts: int = 3) -> int:
    """Add a job; return its id."""
    if kind not in JOB_KINDS:
        raise ValueError(f"unknown job kind {kind!r}")
    job = Job(kind=kind, payload=payload, max_attempts=max_attempts)
    session.add(job)
    session.commit()
    return job.id


def claim(session: Session, worker: str) -> Job | None:
    """Take the oldest queued job, mark it running and locked by `worker`, and return it."""
    job_id = session.execute(
        text(
            """
            UPDATE jobs
               SET status = 'running', attempts = attempts + 1, locked_at = now(), locked_by = :worker,
                   started_at = coalesce(started_at, now()), error = NULL
             WHERE id = (SELECT id FROM jobs WHERE status = 'queued'
                          ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING id
            """
        ),
        {"worker": worker},
    ).scalar()
    session.commit()
    if job_id is None:
        return None
    job = session.get(Job, job_id)
    session.refresh(job)
    return job


def complete(session: Session, job_id: int, result: dict[str, Any]) -> None:
    """The job ran - whatever the app did. Store the result."""
    session.execute(
        text(
            """
            UPDATE jobs SET status = 'done', result = CAST(:result AS jsonb), finished_at = now(),
                            locked_at = NULL, locked_by = NULL
             WHERE id = :id
            """
        ),
        {"id": job_id, "result": json.dumps(result)},
    )
    session.commit()


def fail(session: Session, job_id: int, error: str) -> str:
    """The job could not run (the sandbox, not the app). Queue it again, or give up after
    max_attempts. Returns the job's new status."""
    status = session.execute(
        text(
            """
            UPDATE jobs
               SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
                   finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
                   error = :error, locked_at = NULL, locked_by = NULL
             WHERE id = :id
            RETURNING status
            """
        ),
        {"id": job_id, "error": error[:2000]},
    ).scalar()
    session.commit()
    return status


def reap(session: Session, older_than_seconds: int) -> int:
    """Running jobs whose lock is older than `older_than_seconds` lost their worker. Queue them
    again, or fail them after max_attempts. Returns how many were reaped."""
    count = session.execute(
        text(
            """
            UPDATE jobs
               SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
                   finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
                   error = 'the worker stopped before finishing (lock expired)',
                   locked_at = NULL, locked_by = NULL
             WHERE status = 'running' AND locked_at < now() - make_interval(secs => :seconds)
            """
        ),
        {"seconds": older_than_seconds},
    ).rowcount
    session.commit()
    return count

