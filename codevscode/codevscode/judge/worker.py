"""The judge's worker: reap orphaned jobs, claim one, run it in the sandbox, record the outcome.

    python -m codevscode.judge.worker            run until stopped
    python -m codevscode.judge.worker --once     one job, then exit (tests, debugging)

It runs where it can start containers - on the host in development. It only ever runs trusted
code itself; the submissions run in the containers it starts.
"""

from __future__ import annotations

import argparse
import logging
import os
import socket
import time

from sqlalchemy.orm import Session, sessionmaker

from codevscode.challenges import UnknownChallenge, challenge_path
from codevscode.config import Settings, settings as default_settings
from codevscode.db import SessionLocal
from codevscode.judge import queue, sandbox

log = logging.getLogger("codevscode.judge")


def worker_name() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def run_once(sessions: sessionmaker[Session] = SessionLocal, *, name: str | None = None, config: Settings | None = None) -> int | None:
    """Reap, then claim and run one job. Returns the job's id, or None when the queue is empty."""
    config = config or default_settings
    name = name or worker_name()
    with sessions() as session:
        reaped = queue.reap(session, config.job_lock_seconds)
        if reaped:
            log.warning("reaped %d job(s) whose worker stopped", reaped)
    with sessions() as session:
        job = queue.claim(session, name)
        if job is None:
            return None
        job_id, kind, payload = job.id, job.kind, job.payload
    try:
        directory = challenge_path(payload.get("challenge"), config)
        files = payload.get("files")
        if not isinstance(files, dict) or not all(isinstance(v, str) for v in files.values()):
            raise ValueError("payload.files must map file names to text")
    except (UnknownChallenge, ValueError) as error:
        # A job that can never run is not retried.
        with sessions() as session:
            queue.complete(session, job_id, {"verdict": "error", "detail": str(error)})
        return job_id
    try:
        outcome = sandbox.run(directory, files, kind, config=config)
    except sandbox.SandboxError as error:
        with sessions() as session:
            status = queue.fail(session, job_id, str(error))
        log.error("job %d could not run (%s): %s", job_id, status, error)
        return job_id
    with sessions() as session:
        queue.complete(session, job_id, outcome.as_dict())
    log.info("job %d: %s in %.1f s", job_id, outcome.verdict, outcome.seconds)
    return job_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--once", action="store_true", help="run one job, then exit")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.once:
        run_once()
        return
    log.info("judge worker %s started", worker_name())
    while True:
        try:
            if run_once() is None:
                time.sleep(default_settings.worker_interval_seconds)
        except Exception:  # keep the worker alive; the job's lock lets the reaper recover it
            log.exception("worker loop error")
            time.sleep(default_settings.worker_interval_seconds)


if __name__ == "__main__":
    main()
