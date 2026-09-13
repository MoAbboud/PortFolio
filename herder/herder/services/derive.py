"""Steps A to F: the loop, closed.

    A chunk      new messages since the cursor, split at turn boundaries
    B extract    per chunk, candidates with lineage (services/extraction.py)
    C merge      embed, search, adjudicate, apply one of six verdicts
    D tail       the last N tokens verbatim, as one session entry, replaced wholesale
    E age        stale session entries archived; promotion suggested, never applied
    F render     a new immutable brief version under budget

**The cursor advances only on success.** A derive killed for memory re-runs from where it
was rather than silently skipping material, which is the difference between a brief that is
incomplete and a brief that is wrong without saying so.
"""

from __future__ import annotations

import datetime as dt
import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.embeddings import embedding_text
from herder.core.ids import uuid7
from herder.core.tokens import count_tokens
from herder.domain.chunking import Chunk, ChunkMessage, chunk_messages
from herder.domain.merge import Decision, Match, Verdict, choose_match, decide_against, merged_text
from herder.domain.render import RenderableEntry, render_brief
from herder.models import (
    BriefVersion,
    Conversation,
    Entry,
    EntryLineage,
    EntryRevision,
    Message,
    Project,
)
from herder.schemas.extraction import Candidate
from herder.services.embedding import embed_missing
from herder.services.extraction import extract_chunk, existing_titles

log = logging.getLogger("herder.derive")

SESSION_TTL_DAYS = 7
ARCHIVE_BELOW_CONFIDENCE = 0.7
PROMOTION_CONVERSATIONS = 3
TAIL_KIND = "tail"


@dataclass
class DeriveRun:
    chunks: int = 0
    chunks_skipped: int = 0
    candidates: int = 0
    created: int = 0
    duplicates: int = 0
    updated: int = 0
    superseded: int = 0
    dropped_removed: int = 0
    dropped_lineage: int = 0
    below_floor: int = 0
    archived: int = 0
    promotions_suggested: int = 0
    embeddings_backfilled: int = 0
    source_messages: int = 0
    source_tokens: int = 0
    brief_version: int | None = None
    brief_tokens: int = 0
    excluded: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def merged_away(self) -> int:
        """Candidates that did not become new entries. The compaction, in one number."""
        return self.duplicates + self.updated + self.dropped_removed


# --------------------------------------------------------------------- reading


async def messages_after_cursor(
    session: AsyncSession, project: Project
) -> list[tuple[uuid.UUID, ChunkMessage, int]]:
    """New messages, in thread order, with the conversation and seq each came from."""
    cursor: dict[str, int] = dict(project.derive_cursor or {})

    result = await session.execute(
        select(Message, Conversation.id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(Conversation.project_id == project.id)
        .order_by(Conversation.id, Message.client_position.nulls_last(), Message.seq)
    )

    rows = []
    for message, conversation_id in result.all():
        if message.seq <= cursor.get(str(conversation_id), 0):
            continue
        rows.append(
            (
                conversation_id,
                ChunkMessage(
                    id=message.id,
                    role=message.role,
                    content=message.content,
                    token_count=message.token_count,
                ),
                message.seq,
            )
        )
    return rows


async def _conversation_count(session: AsyncSession, entry_id: uuid.UUID) -> int:
    """How many distinct conversations an entry's lineage touches.

    This is what promotion keys on: something said in three separate conversations is a
    better candidate for the stable layer than something said three times in one.
    """
    result = await session.execute(
        select(func.count(func.distinct(Message.conversation_id)))
        .select_from(EntryLineage)
        .join(Message, Message.id == EntryLineage.message_id)
        .where(EntryLineage.entry_id == entry_id)
    )
    return int(result.scalar_one() or 0)


async def _find_matches(
    session: AsyncSession, project: Project, vector: list[float], limit: int = 10
) -> list[Match]:
    """Nearest entries by cosine distance, using the HNSW index.

    **Removed entries are included on purpose.** They are the reason this query exists in
    this shape: the merge step has to be able to see that a candidate matches something the
    user deleted, and filtering them out here would make that impossible and quietly
    re-create every removed entry on the next derive.
    """
    distance = Entry.embedding.cosine_distance(vector).label("distance")
    result = await session.execute(
        select(Entry, EntryRevision.title, EntryRevision.text_, distance)
        .join(
            EntryRevision,
            (EntryRevision.entry_id == Entry.id)
            & (EntryRevision.revision == Entry.current_revision),
        )
        .where(
            Entry.project_id == project.id,
            Entry.embedding.isnot(None),
            Entry.kind != TAIL_KIND,
            Entry.status.in_(("active", "pinned", "removed")),
        )
        .order_by(distance)
        .limit(limit)
    )

    return [
        Match(
            entry_id=entry.id,
            status=entry.status,
            title=title,
            text=text,
            similarity=1.0 - float(dist),
        )
        for entry, title, text, dist in result.all()
    ]


# --------------------------------------------------------------------- writing


async def _write_entry(
    session: AsyncSession,
    project: Project,
    candidate: Candidate,
    vector: list[float],
    superseding: uuid.UUID | None = None,
) -> uuid.UUID:
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
            embedding=vector,
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
            change_reason="superseded an earlier entry" if superseding else "extracted",
        )
    )
    cited = {uuid.UUID(r) for r in dict.fromkeys(candidate.lineage)}

    if superseding is not None:
        # **The superseded entry's evidence carries forward.** A reversal changes what is
        # true; it does not unsay the messages that established the earlier claim, and those
        # messages are still the reason the project once believed it. Without this the new
        # entry cites only the turn that reversed the decision, and "why did we ever think
        # that" becomes unanswerable - which is the question lineage exists to answer.
        #
        # Found at stage 4: 156 of 276 candidates were superseded, so 156 entries' worth of
        # lineage was being dropped on the floor.
        inherited = (
            await session.execute(
                select(EntryLineage.message_id).where(EntryLineage.entry_id == superseding)
            )
        ).scalars().all()
        cited.update(inherited)

    for message_id in cited:
        session.add(EntryLineage(entry_id=entry_id, message_id=message_id))
    await session.flush()

    if superseding is not None:
        # The conversation count carries too. It is what promotion to the stable layer keys
        # on, and resetting it to 1 on every supersede meant a preference restated across
        # five conversations never reached the threshold - it was superseded back to one
        # each time.
        old = (
            await session.execute(
                select(Entry.seen_in_conversations).where(Entry.id == superseding)
            )
        ).scalar_one()
        await session.execute(
            update(Entry)
            .where(Entry.id == entry_id)
            .values(seen_in_conversations=max(int(old), 1))
        )
        await session.execute(
            update(Entry)
            .where(Entry.id == superseding)
            .values(status="superseded", superseded_by=entry_id)
        )
        await session.flush()
    return entry_id


async def _extend_lineage(session: AsyncSession, entry_id: uuid.UUID, lineage: list[str]) -> None:
    """Add citations an entry does not already have. The union, never a replacement."""
    existing = set(
        (
            await session.execute(
                select(EntryLineage.message_id).where(EntryLineage.entry_id == entry_id)
            )
        ).scalars().all()
    )
    for reference in dict.fromkeys(lineage):
        message_id = uuid.UUID(reference)
        if message_id not in existing:
            session.add(EntryLineage(entry_id=entry_id, message_id=message_id))
    await session.flush()


async def _touch(session: AsyncSession, entry_id: uuid.UUID, seen: int) -> None:
    await session.execute(
        update(Entry)
        .where(Entry.id == entry_id)
        .values(last_seen_at=func.now(), seen_in_conversations=seen)
    )


async def _next_revision(session: AsyncSession, entry_id: uuid.UUID) -> int:
    """The next revision number, read from `entry_revisions` rather than from the counter.

    `entries.current_revision` is maintained with a core `update()`, which does **not**
    refresh an ORM object already in the session's identity map. So reading it back through
    `session.get` can return a stale value - and if two candidates in one derive both revise
    the same entry, the second computes a revision number the first has already used, which
    collides with the primary key on `(entry_id, revision)`.

    The revisions table is the source of truth and cannot go stale. Reading from it also
    means invariant 6 - a row for every revision from 1 to current - cannot be broken by a
    stale counter.
    """
    highest = (
        await session.execute(
            select(func.coalesce(func.max(EntryRevision.revision), 0)).where(
                EntryRevision.entry_id == entry_id
            )
        )
    ).scalar_one()
    return int(highest) + 1


async def _revise(
    session: AsyncSession,
    entry_id: uuid.UUID,
    candidate: Candidate,
    match: Match,
    vector: list[float],
) -> None:
    """A new revision on the same entry. The old revision is never overwritten."""
    revision = await _next_revision(session, entry_id)
    # Read confidence fresh for the same reason: a core update() earlier in this derive
    # leaves any ORM copy behind.
    stored_confidence = float(
        (
            await session.execute(select(Entry.confidence).where(Entry.id == entry_id))
        ).scalar_one()
    )
    text = merged_text(match.text, candidate.text)

    session.add(
        EntryRevision(
            entry_id=entry_id,
            revision=revision,
            title=candidate.title,
            text_=text,
            token_count=count_tokens(f"{candidate.title}\n\n{text}"),
            changed_by="derive",
            change_reason="the candidate was more specific than the stored entry",
        )
    )
    await session.execute(
        update(Entry)
        .where(Entry.id == entry_id)
        .values(
            current_revision=revision,
            last_seen_at=func.now(),
            # The embedding follows the revision, or similarity search keeps matching text
            # that is no longer what the entry says.
            embedding=vector,
            confidence=max(stored_confidence, candidate.confidence),
        )
    )
    await session.flush()


async def apply_decision(
    session: AsyncSession,
    project: Project,
    candidate: Candidate,
    vector: list[float],
    decision: Decision,
    run: DeriveRun,
) -> None:
    if decision.verdict is Verdict.DROP:
        run.dropped_removed += 1
        log.info("dropped a candidate matching a removed entry: %s", candidate.title)
        return

    if decision.verdict in (Verdict.CREATE, Verdict.DISTINCT):
        await _write_entry(session, project, candidate, vector)
        run.created += 1
        return

    match = decision.match
    assert match is not None

    if decision.verdict is Verdict.DUPLICATE:
        await _extend_lineage(session, match.entry_id, candidate.lineage)
        await _touch(session, match.entry_id, await _conversation_count(session, match.entry_id))
        run.duplicates += 1
        return

    if decision.verdict is Verdict.UPDATE:
        await _extend_lineage(session, match.entry_id, candidate.lineage)
        await _revise(session, match.entry_id, candidate, match, vector)
        await _touch(session, match.entry_id, await _conversation_count(session, match.entry_id))
        run.updated += 1
        return

    if decision.verdict is Verdict.SUPERSEDE:
        await _write_entry(session, project, candidate, vector, superseding=match.entry_id)
        run.superseded += 1
        return


# --------------------------------------------------------------------- steps D, E, F


async def write_session_tail(session: AsyncSession, project: Project) -> str | None:
    """The last N tokens of the most recent conversation, verbatim, as one entry.

    Replaced wholesale each derive rather than merged. It is recent text, it has no business
    being deduplicated against durable entries, and treating it as a normal entry would fill
    the store with near-identical tails.
    """
    conversation = (
        await session.execute(
            select(Conversation)
            .where(Conversation.project_id == project.id)
            .order_by(Conversation.last_seen_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if conversation is None:
        return None

    rows = (
        await session.execute(
            select(Message)
            .where(Message.conversation_id == conversation.id)
            # `.desc().nulls_last()`, not `.nulls_last().desc()` - the latter renders
            # "NULLS LAST DESC", which Postgres rejects. The modifier follows the direction.
            .order_by(Message.client_position.desc().nulls_last(), Message.seq.desc())
            .limit(200)
        )
    ).scalars().all()
    if not rows:
        return None

    budget = project.session_tail_tokens
    picked: list[Message] = []
    used = 0
    for message in rows:  # newest first
        if used + message.token_count > budget and picked:
            break
        picked.append(message)
        used += message.token_count

    picked.reverse()
    text = "\n".join(f"{m.role}: {m.content}" for m in picked)

    # One tail entry per project, rewritten in place.
    existing = (
        await session.execute(
            select(Entry).where(Entry.project_id == project.id, Entry.kind == TAIL_KIND).limit(1)
        )
    ).scalars().first()

    if existing is None:
        entry_id = uuid7()
        session.add(
            Entry(
                id=entry_id,
                project_id=project.id,
                layer="session",
                kind=TAIL_KIND,
                status="active",
                source="derived",
                current_revision=1,
                confidence=1.0,
            )
        )
        session.add(
            EntryRevision(
                entry_id=entry_id,
                revision=1,
                title="Most recent conversation",
                text_=text,
                token_count=count_tokens(text),
                changed_by="derive",
                change_reason="session tail",
            )
        )
    else:
        revision = await _next_revision(session, existing.id)
        session.add(
            EntryRevision(
                entry_id=existing.id,
                revision=revision,
                title="Most recent conversation",
                text_=text,
                token_count=count_tokens(text),
                changed_by="derive",
                change_reason="session tail replaced",
            )
        )
        await session.execute(
            update(Entry)
            .where(Entry.id == existing.id)
            .values(current_revision=revision, last_seen_at=func.now())
        )

    await session.flush()
    return text


async def age_and_propose(session: AsyncSession, project: Project, run: DeriveRun) -> None:
    """Step E. Archive stale session entries; suggest promotions, never apply one."""
    cutoff = dt.datetime.now(dt.UTC) - dt.timedelta(days=SESSION_TTL_DAYS)

    archived = await session.execute(
        update(Entry)
        .where(
            Entry.project_id == project.id,
            Entry.layer == "session",
            Entry.kind != TAIL_KIND,
            Entry.status == "active",
            Entry.last_seen_at < cutoff,
            Entry.confidence < ARCHIVE_BELOW_CONFIDENCE,
        )
        .values(status="archived")
        .returning(Entry.id)
    )
    run.archived = len(archived.all())

    # Suggested only. Promotion is a claim about who the user is, and making it without
    # asking is what turns a memory system into something that feels like it is watching.
    candidates = (
        await session.execute(
            select(Entry).where(
                Entry.project_id == project.id,
                Entry.layer == "project",
                Entry.kind.in_(("preference", "identity")),
                Entry.status.in_(("active", "pinned")),
                Entry.promotion_suggested.is_(False),
                Entry.seen_in_conversations >= PROMOTION_CONVERSATIONS,
            )
        )
    ).scalars().all()

    for entry in candidates:
        await session.execute(
            update(Entry).where(Entry.id == entry.id).values(promotion_suggested=True)
        )
        run.promotions_suggested += 1


async def render_project(
    session: AsyncSession,
    project: Project,
    trigger: str,
    tail_text: str | None = None,
    budget_tokens: int | None = None,
) -> BriefVersion:
    """Step F. A new immutable version, every time.

    `budget_tokens` overrides the project's budget for this render only. It is a parameter
    rather than a temporary edit to `project.brief_budget_tokens`, because an edited ORM object
    is flushed with the render and the override would be written to the project row.
    """
    rows = (
        await session.execute(
            select(Entry, EntryRevision.title, EntryRevision.text_)
            .join(
                EntryRevision,
                (EntryRevision.entry_id == Entry.id)
                & (EntryRevision.revision == Entry.current_revision),
            )
            .where(Entry.project_id == project.id, Entry.status.in_(("active", "pinned")))
        )
    ).all()

    entries: list[RenderableEntry] = []
    tail_id: uuid.UUID | None = None
    for entry, title, text in rows:
        if entry.kind == TAIL_KIND:
            tail_id = entry.id
            if tail_text is None:
                tail_text = text
            continue
        entries.append(
            RenderableEntry(
                id=entry.id,
                layer=entry.layer,
                kind=entry.kind,
                status=entry.status,
                title=title,
                text=text,
                last_seen_at=entry.last_seen_at,
            )
        )

    rendered = render_brief(
        entries,
        budget_tokens if budget_tokens is not None else project.brief_budget_tokens,
        count_tokens,
        tail_text=tail_text,
        tail_entry_id=tail_id,
    )

    covered = (
        await session.execute(
            select(func.count(Message.id), func.coalesce(func.sum(Message.token_count), 0))
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.project_id == project.id)
        )
    ).one()

    # `max + 1` is a race without this. Since stage 5 a render can run inside an HTTP request
    # (a resume with a budget override) while a derive or render job is running for the same
    # project, and both would pick the same number and one would die on the unique constraint.
    # The project row is updated below anyway, so this only takes that lock earlier.
    await session.execute(select(Project.id).where(Project.id == project.id).with_for_update())

    next_version = int(
        (
            await session.execute(
                select(func.coalesce(func.max(BriefVersion.version), 0)).where(
                    BriefVersion.project_id == project.id
                )
            )
        ).scalar_one()
    ) + 1

    version = BriefVersion(
        id=uuid7(),
        project_id=project.id,
        version=next_version,
        rendered_text=rendered.text,
        token_count=rendered.token_count,
        budget_tokens=rendered.budget_tokens,
        included_entry_ids=rendered.included_entry_ids,
        excluded_entry_ids=rendered.excluded_entry_ids,
        source_message_count=int(covered[0]),
        source_token_count=int(covered[1]),
        trigger=trigger,
    )
    session.add(version)
    await session.flush()

    # Invariant 5: this always points at the highest version for the project.
    await session.execute(
        update(Project).where(Project.id == project.id).values(current_brief_version_id=version.id)
    )
    await session.flush()
    return version


# --------------------------------------------------------------------- the loop


async def derive_project(
    session: AsyncSession,
    project: Project,
    extractor,
    embedder,
    nli,
    *,
    target_tokens: int,
    similarity_threshold: float,
    nli_floor: float,
    max_chunks: int | None = None,
) -> DeriveRun:
    extractor.check_ready()
    embedder.check_ready()
    nli.check_ready()

    run = DeriveRun()

    # Self-healing, before anything is matched. An entry with no vector is invisible to
    # `_find_matches`, so it can never be merged - and a REMOVED entry with no vector
    # silently escapes the removed-never-resurrects rule and gets re-created. Backfilling
    # here means the loop repairs that itself rather than depending on a job having been
    # enqueued at the right moment.
    run.embeddings_backfilled = await embed_missing(session, project, embedder)

    rows = await messages_after_cursor(session, project)

    if not rows:
        # Steps A to C have nothing to do, but D, E and F still must run. Staleness is a
        # function of elapsed time rather than of new messages, so a project that has gone
        # quiet is exactly the one whose session entries are due to be archived - skipping
        # ageing here would mean stale entries survive precisely because nothing happened.
        log.info("nothing new for project %s; ageing and re-rendering", project.name)
        tail = await write_session_tail(session, project)
        await age_and_propose(session, project, run)
        version = await render_project(session, project, "derive", tail)
        run.brief_version = version.version
        run.brief_tokens = version.token_count
        run.excluded = len(version.excluded_entry_ids)
        await session.commit()
        return run

    run.source_messages = len(rows)
    chunks: list[Chunk] = chunk_messages([m for _, m, _ in rows], target_tokens)
    if max_chunks is not None:
        chunks = chunks[:max_chunks]

    run.chunks = len(chunks)
    titles = await existing_titles(session, project)
    reached: dict[str, int] = dict(project.derive_cursor or {})
    seq_of = {message.id: (str(conversation_id), seq) for conversation_id, message, seq in rows}

    for index, chunk in enumerate(chunks, start=1):
        log.info("chunk %d/%d, %d messages, %d tokens", index, len(chunks), len(chunk.messages), chunk.token_count)
        run.source_tokens += chunk.token_count

        outcome, kept = await extract_chunk(session, project, chunk, extractor, titles)
        if outcome.failed:
            run.chunks_skipped += 1
            run.errors.append(outcome.error or "unknown failure")
            # The cursor does not advance past a chunk that failed, so it is retried rather
            # than skipped. That is why this breaks instead of continuing.
            break

        run.candidates += len(outcome.candidates)
        run.dropped_lineage += outcome.dropped_invented_lineage + outcome.dropped_empty_lineage

        vectors = embedder.embed([embedding_text(c.title, c.text) for c in kept]) if kept else []

        for candidate, vector in zip(kept, vectors, strict=True):
            matches = choose_match(
                await _find_matches(session, project, vector), similarity_threshold
            )

            decision = Decision(Verdict.CREATE, None, "nothing similar enough to adjudicate")
            for match in matches:
                forward, backward = nli.both_ways(candidate.text, match.text)
                decision = decide_against(match, forward, backward, nli_floor)
                if decision.below_floor:
                    run.below_floor += 1
                # The first match that is not merely `distinct` decides. Otherwise keep
                # looking: a candidate can be distinct from the nearest entry and a
                # duplicate of the second nearest.
                if decision.verdict is not Verdict.DISTINCT:
                    break

            await apply_decision(session, project, candidate, vector, decision, run)
            titles.append(candidate.title)

        for message in chunk.messages:
            conversation_id, seq = seq_of[message.id]
            reached[conversation_id] = max(reached.get(conversation_id, 0), seq)

    tail = await write_session_tail(session, project)
    await age_and_propose(session, project, run)
    version = await render_project(session, project, "derive", tail)

    run.brief_version = version.version
    run.brief_tokens = version.token_count
    run.excluded = len(version.excluded_entry_ids)

    await session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(derive_cursor=reached, tokens_since_derive=0, last_derived_at=func.now())
    )
    await session.commit()
    return run
