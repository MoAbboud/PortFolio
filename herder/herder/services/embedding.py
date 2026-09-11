"""Backfilling embeddings for entries that do not have one.

## Why this exists, and why its absence was a real bug

`_find_matches` searches with `embedding IS NOT NULL`, because a NULL vector has no distance
to anything. So **an entry without an embedding is invisible to the merge step** - it can
never be matched, deduplicated, updated or superseded.

Two paths create entries with no vector: the stage 2 `extract` service, which has no embedder
by design, and (later) a user adding an entry by hand in the adjuster. The task list claimed
an `embed` job existed. It did not - no handler, never enqueued - so those entries stayed
invisible indefinitely and the memory grew linearly for every one of them.

**The worse consequence is on removed entries.** The hard rule that a removed entry never
comes back is enforced by matching a candidate against it. An entry removed before it was
embedded cannot be matched, so the rule silently does not apply to it and the next derive
re-creates it. That is the one behaviour the adjuster's trustworthiness rests on, defeated by
a missing vector. Removed entries are therefore embedded like any other.

`derive` calls this before it merges, so the loop self-heals rather than depending on a job
having been enqueued at the right moment.
"""

from __future__ import annotations

import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.embeddings import embedding_text
from herder.models import Entry, EntryRevision, Project

log = logging.getLogger("herder.embedding")

TAIL_KIND = "tail"
BATCH = 32


async def embed_missing(
    session: AsyncSession, project: Project, embedder, *, batch: int = BATCH
) -> int:
    """Give every entry in the project that lacks a vector one. Returns how many.

    The session tail is excluded: it is replaced wholesale each derive and is never merged
    against anything, so a vector for it would be computed repeatedly and never read.
    """
    rows = (
        await session.execute(
            select(Entry.id, EntryRevision.title, EntryRevision.text_)
            .join(
                EntryRevision,
                (EntryRevision.entry_id == Entry.id)
                & (EntryRevision.revision == Entry.current_revision),
            )
            .where(
                Entry.project_id == project.id,
                Entry.embedding.is_(None),
                Entry.kind != TAIL_KIND,
                # Removed entries included deliberately - see the module docstring. Without
                # a vector the removed-never-resurrects rule cannot fire for them.
                Entry.status.in_(("active", "pinned", "removed", "archived")),
            )
        )
    ).all()

    if not rows:
        return 0

    log.info("embedding %d entries in %s that had no vector", len(rows), project.name)
    done = 0

    for start in range(0, len(rows), batch):
        window = rows[start : start + batch]
        vectors = embedder.embed([embedding_text(title, text) for _, title, text in window])
        for (entry_id, _, _), vector in zip(window, vectors, strict=True):
            await session.execute(
                update(Entry).where(Entry.id == entry_id).values(embedding=vector)
            )
            done += 1
        await session.flush()

    return done
