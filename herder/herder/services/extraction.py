"""Stage 2: chunk, extract, validate lineage, store.

**No merging.** This stage creates one entry per surviving candidate on purpose, so that the
merge step in stage 3 can be seen to do something rather than being assumed to work. Running
extraction twice over the same messages will therefore produce near-duplicate entries, and
that is the expected behaviour at this stage.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.ids import uuid7
from herder.core.modelcalls import record_extraction
from herder.core.tokens import count_tokens
from herder.domain.chunking import Chunk, ChunkMessage, chunk_messages
from herder.extractors.base import Extractor, validate_lineage
from herder.models import Conversation, Entry, EntryLineage, EntryRevision, Message, Project
from herder.schemas.extraction import Candidate, ExtractionOutcome

log = logging.getLogger("herder.extraction")


@dataclass
class ExtractionRun:
    chunks: int = 0
    chunks_skipped: int = 0
    candidates: int = 0
    stored: int = 0
    dropped_invented_lineage: int = 0
    dropped_empty_lineage: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    prompt_ms: int = 0
    generation_ms: int = 0
    source_tokens: int = 0
    errors: list[str] = field(default_factory=list)


async def load_chunks(session: AsyncSession, project: Project, target_tokens: int) -> list[Chunk]:
    """Every message in the project, in thread order, grouped into chunks.

    Ordered by `(conversation, client_position, seq)` - thread order within a conversation,
    because that is the order the extractor has to read to make sense of anything.
    """
    result = await session.execute(
        select(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project.id)
        .order_by(Conversation.id, Message.client_position.nulls_last(), Message.seq)
    )
    messages = [
        ChunkMessage(id=m.id, role=m.role, content=m.content, token_count=m.token_count)
        for m in result.scalars().all()
    ]
    return chunk_messages(messages, target_tokens)


async def existing_titles(session: AsyncSession, project: Project, limit: int = 200) -> list[str]:
    """The titles the project already knows, given to the extractor.

    Without them the model restates things the system already has in slightly different
    words on every pass, and the merge step spends its budget adjudicating near-duplicates
    it should never have been handed.
    """
    result = await session.execute(
        select(EntryRevision.title)
        .join(Entry, Entry.id == EntryRevision.entry_id)
        .where(
            Entry.project_id == project.id,
            Entry.status.in_(("active", "pinned")),
            Entry.current_revision == EntryRevision.revision,
        )
        .order_by(Entry.last_seen_at.desc())
        .limit(limit)
    )
    return [row[0] for row in result.all()]


async def store_candidates(
    session: AsyncSession, project: Project, candidates: list[Candidate]
) -> int:
    """Write entries, their first revision, and their lineage. No merging at this stage."""
    stored = 0
    for candidate in candidates:
        entry_id = uuid7()
        session.add(
            Entry(
                id=entry_id,
                project_id=project.id,
                layer=candidate.layer,
                kind=candidate.kind,
                status="active",
                source="derived",
                current_revision=1,
                confidence=candidate.confidence,
            )
        )
        session.add(
            EntryRevision(
                entry_id=entry_id,
                revision=1,
                title=candidate.title,
                text_=candidate.text,
                token_count=count_tokens(f"{candidate.title}\n\n{candidate.text}"),
                changed_by="derive",
                change_reason="extracted",
            )
        )
        for reference in dict.fromkeys(candidate.lineage):
            session.add(EntryLineage(entry_id=entry_id, message_id=uuid.UUID(reference)))
        stored += 1

    await session.flush()
    return stored


async def extract_chunk(
    session: AsyncSession,
    project: Project,
    chunk: Chunk,
    extractor: Extractor,
    titles: list[str],
) -> tuple[ExtractionOutcome, list[Candidate]]:
    """One chunk, with one retry, and a `model_calls` row for every attempt.

    Inference is CPU-bound and blocking, so it runs in a worker thread rather than on the
    event loop. On a machine with no GPU a single chunk can take minutes, and holding the
    loop for that would stall everything else the process is doing.
    """
    outcome = await asyncio.to_thread(extractor.extract, chunk, titles)
    await record_extraction(session, outcome, extractor.name)

    if outcome.failed:
        # One retry. With schema-constrained decoding a malformed response should be
        # unreachable, so if this fires the grammar and the schema disagree - which is a bug
        # here rather than a bad response, and the retry is cheap insurance either way.
        log.warning("extraction failed (%s); retrying once", outcome.error)
        outcome = await asyncio.to_thread(extractor.extract, chunk, titles)
        outcome.validated_first_try = False
        await record_extraction(session, outcome, extractor.name)

    if outcome.failed:
        return outcome, []

    kept, invented, empty = validate_lineage(outcome.candidates, chunk)
    outcome.dropped_invented_lineage = invented
    outcome.dropped_empty_lineage = empty
    return outcome, kept


async def extract_project(
    session: AsyncSession,
    project: Project,
    extractor: Extractor,
    *,
    target_tokens: int,
    max_chunks: int | None = None,
) -> ExtractionRun:
    extractor.check_ready()

    chunks = await load_chunks(session, project, target_tokens)
    if max_chunks is not None:
        chunks = chunks[:max_chunks]

    run = ExtractionRun(chunks=len(chunks))
    titles = await existing_titles(session, project)

    for index, chunk in enumerate(chunks, start=1):
        log.info("chunk %d/%d, %d messages, %d tokens", index, len(chunks), len(chunk.messages), chunk.token_count)
        run.source_tokens += chunk.token_count

        outcome, kept = await extract_chunk(session, project, chunk, extractor, titles)

        run.input_tokens += outcome.input_tokens
        run.output_tokens += outcome.output_tokens
        run.latency_ms += outcome.latency_ms
        run.prompt_ms += outcome.prompt_ms
        run.generation_ms += outcome.generation_ms

        if outcome.failed:
            # Skipped and recorded as skipped. Losing a whole run to one bad chunk would be
            # a worse trade than losing the chunk.
            run.chunks_skipped += 1
            run.errors.append(outcome.error or "unknown failure")
            continue

        run.candidates += len(outcome.candidates)
        run.dropped_invented_lineage += outcome.dropped_invented_lineage
        run.dropped_empty_lineage += outcome.dropped_empty_lineage
        run.stored += await store_candidates(session, project, kept)

        # New titles feed the next chunk, so the extractor stops restating what it has just
        # been told within the same run.
        titles.extend(c.title for c in kept)

    await session.commit()
    return run
