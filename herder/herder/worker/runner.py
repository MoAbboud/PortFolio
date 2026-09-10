"""The job runner.

Stage 0 builds the shape and no handlers. It starts, claims nothing, and says so - which is
worth having before there is a job to run, because "the worker is alive and the queue is
empty" and "the worker is dead" look identical in a log that only speaks when it works.

Claiming uses `SELECT ... FOR UPDATE SKIP LOCKED`, so several workers can drain the queue
without coordinating. There is no broker: one earns its place when retry has to survive a
restart, and this does not yet.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import uuid

from sqlalchemy import text

from herder.core.config import get_settings
from herder.core.db import get_sessionmaker

log = logging.getLogger("herder.worker")

async def _handle_derive(session, payload: dict) -> None:
    """Steps A to F for one project."""
    from herder.core.config import get_settings
    from herder.core.embeddings import OllamaEmbedder
    from herder.core.nli import CrossEncoderNli
    from herder.extractors import get_extractor
    from herder.models import Project
    from herder.services.derive import derive_project

    settings = get_settings()
    project = await session.get(Project, uuid.UUID(payload["project_id"]))
    if project is None:
        raise ValueError(f"no project {payload['project_id']}")

    run = await derive_project(
        session,
        project,
        get_extractor(),
        OllamaEmbedder(),
        CrossEncoderNli(),
        target_tokens=settings.chunk_tokens,
        similarity_threshold=settings.similarity_threshold,
        nli_floor=settings.nli_floor,
    )
    log.info(
        "derived %s: %d candidates -> %d created, %d duplicate, %d updated, %d superseded, "
        "%d dropped; brief v%s at %d tokens",
        project.name, run.candidates, run.created, run.duplicates, run.updated,
        run.superseded, run.dropped_removed, run.brief_version, run.brief_tokens,
    )


async def _handle_render(session, payload: dict) -> None:
    """Step F only. No inference at all, which is what makes an adjust feel immediate."""
    from herder.models import Project
    from herder.services.derive import render_project

    project = await session.get(Project, uuid.UUID(payload["project_id"]))
    if project is None:
        raise ValueError(f"no project {payload['project_id']}")

    version = await render_project(session, project, "adjust")
    await session.commit()
    log.info("rendered %s: v%d at %d tokens", project.name, version.version, version.token_count)


# One handler per job kind, filled in by the stages that own them.
#   probe_gen / checkpoint  stage 6
#   delete_user             stage 14
HANDLERS: dict[str, object] = {
    "derive": _handle_derive,
    "render": _handle_render,
}

CLAIM = text(
    """
    UPDATE jobs
       SET status = 'running', locked_by = :worker, locked_at = now(), attempts = attempts + 1
     WHERE id = (
           SELECT id FROM jobs
            WHERE status = 'queued' AND run_after <= now()
            ORDER BY run_after
            FOR UPDATE SKIP LOCKED
            LIMIT 1
     )
    RETURNING id, kind, payload
    """
)


def worker_name() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


async def claim_one(session) -> object | None:
    result = await session.execute(CLAIM, {"worker": worker_name()})
    row = result.first()
    await session.commit()
    return row


async def run(stop: asyncio.Event) -> None:
    settings = get_settings()
    sessionmaker = get_sessionmaker()
    name = worker_name()

    log.info(
        "worker %s polling every %ss, extractor=%s, handlers=%d",
        name,
        settings.worker_poll_seconds,
        settings.extractor,
        len(HANDLERS),
    )

    while not stop.is_set():
        try:
            async with sessionmaker() as session:
                row = await claim_one(session)
        except Exception as exc:  # a database that is not up yet is not a crash
            log.warning("worker %s cannot reach the database (%s); retrying", name, exc)
            row = None

        if row is None:
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_seconds)
            except TimeoutError:
                pass
            continue

        handler = HANDLERS.get(row.kind)
        if handler is not None:
            try:
                async with sessionmaker() as session:
                    await handler(session, row.payload)
                    await session.commit()
                async with sessionmaker() as session:
                    await session.execute(
                        text("UPDATE jobs SET status='done', error=NULL WHERE id=:id"), {"id": row.id}
                    )
                    await session.commit()
            except Exception as exc:
                # The failure lands in jobs.error and surfaces on the dashboard. The derive
                # cursor was not advanced, so the work is retried rather than skipped.
                log.exception("job %s (%s) failed", row.id, row.kind)
                async with sessionmaker() as session:
                    await session.execute(
                        text("UPDATE jobs SET status='failed', error=:e WHERE id=:id"),
                        {"e": f"{type(exc).__name__}: {exc}"[:2000], "id": row.id},
                    )
                    await session.commit()
            continue

        if handler is None:
            # Stage 0 has no handlers. An unknown kind is recorded rather than retried
            # forever, so a job nobody can run is visible instead of invisible.
            log.error("no handler for job kind %r (job %s)", row.kind, row.id)
            async with sessionmaker() as session:
                await session.execute(
                    text("UPDATE jobs SET status='failed', error=:e WHERE id=:id"),
                    {"e": f"no handler for kind {row.kind!r}", "id": row.id},
                )
                await session.commit()

    log.info("worker %s stopping", name)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
    )
    stop = asyncio.Event()

    async def _run() -> None:
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                # Windows outside Docker. Ctrl+C still raises KeyboardInterrupt.
                pass
        await run(stop)

    try:
        asyncio.run(_run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
