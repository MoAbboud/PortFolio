"""Ingest: normalise, dedupe, append, and decide whether to wake the worker.

The one rule underneath all of it: **`messages` is append-only.** Nothing here updates a
message, and `seq` is never renumbered - see the note on ordering below, which resolves a
contradiction between two documents rather than picking one and hoping.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import uuid

from sqlalchemy import func, literal_column, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.config import get_settings
from herder.core.ids import uuid7
from herder.core.tokens import count_tokens
from herder.domain.hashing import content_hash, normalise
from herder.domain.transcript import parse_transcript
from herder.models import Conversation, Job, Message, Project
from herder.schemas.ingest import IngestEvent, IngestResult


class IngestError(ValueError):
    """Bad input. Reaches the caller as a 4xx with the reason."""


def paste_reference(text: str) -> str:
    """A conversation identity derived from the transcript itself.

    A pasted transcript has no vendor conversation id, so without this every paste would be
    a new conversation and re-pasting would double the corpus. Content-addressing makes the
    plan's requirement - "re-pasting the same transcript adds no messages" - true by
    construction: the same text resolves to the same conversation, and then every turn
    collides on its content hash and nothing is inserted.

    A *continued* transcript hashes differently and would resolve to a second conversation,
    which is why `conversation_id` exists on the paste request: append to the original and
    the overlap dedupes turn by turn.
    """
    return "paste:" + hashlib.sha256(normalise(text).encode("utf-8")).hexdigest()[:32]


async def resolve_project(session: AsyncSession, workspace_id: uuid.UUID, project_id: uuid.UUID | None) -> Project:
    if project_id is not None:
        project = await session.get(Project, project_id)
        if project is None or project.workspace_id != workspace_id:
            raise IngestError("no such project in this workspace")
        return project

    result = await session.execute(
        select(Project)
        .where(Project.workspace_id == workspace_id, Project.is_default.is_(True))
        .limit(1)
    )
    project = result.scalar_one_or_none()
    if project is None:
        raise IngestError("this workspace has no default project; run `python -m herder bootstrap`")
    return project


async def resolve_conversation(
    session: AsyncSession,
    project: Project,
    vendor: str,
    vendor_conv_id: str | None,
    title: str | None = None,
    model_hint: str | None = None,
) -> Conversation:
    """Find the conversation for (vendor, vendor_conv_id), creating it on first sight."""
    if vendor_conv_id is not None:
        result = await session.execute(
            select(Conversation).where(
                Conversation.vendor == vendor, Conversation.vendor_conv_id == vendor_conv_id
            )
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            return existing

    conversation = Conversation(
        id=uuid7(),
        project_id=project.id,
        vendor=vendor,
        vendor_conv_id=vendor_conv_id,
        title=title,
        model_hint=model_hint,
    )
    session.add(conversation)
    await session.flush()
    return conversation


async def _next_seq(session: AsyncSession, conversation_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.coalesce(func.max(Message.seq), 0)).where(Message.conversation_id == conversation_id)
    )
    return int(result.scalar_one()) + 1


async def _append(
    session: AsyncSession,
    conversation: Conversation,
    turns: list[tuple[str, str, int | None, dt.datetime | None, str | None]],
) -> tuple[int, int, int, list[str]]:
    """Insert turns. Returns (accepted, duplicates, tokens, notes).

    ## Ordering, and a contradiction resolved

    The specification said `seq` should be recomputed for the tail when a turn arrives out
    of order. Invariant 1 says `messages` is append-only - no UPDATE. Those cannot both be
    true, and the invariant is the one with a test and with the whole audit story behind it.

    So: **`seq` is arrival order and is never renumbered.** `client_position` carries the
    vendor's own position in the thread, and reads order by `(client_position, seq)`. An
    out-of-order arrival lands with a later `seq` and its correct `position`, and every
    reader still sees the conversation in the order it happened. Gaps in `seq` are fine -
    nothing requires it to be contiguous, only unique and increasing.
    """
    ref = conversation.vendor_conv_id or ""
    seq = await _next_seq(session, conversation.id)
    now = dt.datetime.now(dt.UTC)

    rows = []
    tokens = 0
    notes: list[str] = []

    # Ordered by the client's position where it has one, so that arrival order and thread
    # order agree in the normal case and `seq` is a useful tiebreak in the abnormal one.
    ordered = sorted(enumerate(turns), key=lambda pair: (pair[1][2] if pair[1][2] is not None else pair[0], pair[0]))

    for _, (role, content, position, captured_at, claimed_hash) in ordered:
        digest = content_hash(conversation.vendor, ref, role, content)
        if claimed_hash and claimed_hash != digest:
            notes.append(
                "a client-supplied content_hash did not match the server's and was ignored"
            )
        count = count_tokens(content)
        tokens += count
        rows.append(
            {
                "id": uuid7(),
                "conversation_id": conversation.id,
                "seq": seq,
                "role": role,
                "content": content,
                "content_hash": digest,
                "token_count": count,
                "client_position": position,
                "captured_at": captured_at or now,
            }
        )
        seq += 1

    if not rows:
        return 0, 0, 0, notes

    # Idempotency lives in the database, not in a prior SELECT. A check-then-insert races
    # with the extension re-sending a batch; ON CONFLICT does not.
    statement = (
        pg_insert(Message)
        .values(rows)
        .on_conflict_do_nothing(index_elements=["conversation_id", "content_hash"])
        .returning(Message.id, Message.token_count)
    )
    result = await session.execute(statement)
    inserted = result.all()

    accepted = len(inserted)
    accepted_tokens = sum(row.token_count for row in inserted)
    duplicates = len(rows) - accepted

    if accepted:
        await session.execute(
            update(Conversation)
            .where(Conversation.id == conversation.id)
            .values(
                message_count=Conversation.message_count + accepted,
                token_count=Conversation.token_count + accepted_tokens,
                last_seen_at=func.now(),
            )
        )

    # Deduplicate the note; one line is enough however many events were wrong.
    notes = list(dict.fromkeys(notes))
    return accepted, duplicates, accepted_tokens, notes


async def _maybe_enqueue_derive(session: AsyncSession, project: Project, new_tokens: int) -> bool:
    """Add to the project's counter and enqueue a derive if it has earned one.

    The enqueue is `ON CONFLICT DO NOTHING` against the partial unique index on `jobs`, so a
    second enqueue while one is queued or running is a no-op rather than a duplicate job or
    a lock. Two derives for one project would extract the same messages twice and merge each
    other's output.
    """
    settings = get_settings()

    result = await session.execute(
        update(Project)
        .where(Project.id == project.id)
        .values(tokens_since_derive=Project.tokens_since_derive + new_tokens)
        .returning(Project.tokens_since_derive, Project.last_derived_at)
    )
    pending, last_derived_at = result.one()

    over_threshold = pending >= settings.derive_threshold_tokens
    stale = (
        pending > 0
        and last_derived_at is not None
        and (dt.datetime.now(dt.UTC) - last_derived_at).total_seconds() >= settings.derive_max_age_seconds
    )
    if not (over_threshold or stale):
        return False

    statement = (
        pg_insert(Job)
        .values(
            id=uuid7(),
            kind="derive",
            payload={"project_id": str(project.id)},
            status="queued",
        )
        # The index is on an expression and is partial, so both the expression and the
        # predicate have to be given for Postgres to infer it - and the expression has to
        # render literally. `Job.payload["project_id"].astext` renders the key as a bound
        # parameter, which is valid SQLAlchemy and invalid SQL in an ON CONFLICT target.
        .on_conflict_do_nothing(
            index_elements=[literal_column("(payload->>'project_id')")],
            index_where=text("kind = 'derive' AND status IN ('queued','running')"),
        )
        .returning(Job.id)
    )
    enqueued = (await session.execute(statement)).first()
    return enqueued is not None


async def ingest_paste(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    text: str,
    vendor: str = "manual",
    project_id: uuid.UUID | None = None,
    title: str | None = None,
    conversation_id: uuid.UUID | None = None,
) -> IngestResult:
    settings = get_settings()

    if not text or not text.strip():
        raise IngestError("the transcript is empty")
    size = len(text.encode("utf-8"))
    if size > settings.max_paste_bytes:
        raise IngestError(
            f"the transcript is {size} bytes and the cap is {settings.max_paste_bytes}. "
            "Split it, or capture it with the extension."
        )

    parsed = parse_transcript(text)
    project = await resolve_project(session, workspace_id, project_id)

    if conversation_id is not None:
        conversation = await session.get(Conversation, conversation_id)
        if conversation is None or conversation.project_id != project.id:
            raise IngestError("no such conversation in this project")
    else:
        conversation = await resolve_conversation(
            session, project, vendor, paste_reference(text), title=title
        )

    turns: list[tuple[str, str, int | None, dt.datetime | None, str | None]] = [
        (turn.role, turn.content, turn.position, None, None) for turn in parsed.turns
    ]
    accepted, duplicates, tokens, notes = await _append(session, conversation, turns)
    enqueued = await _maybe_enqueue_derive(session, project, tokens) if accepted else False

    await session.commit()
    return IngestResult(
        accepted=accepted,
        duplicates=duplicates,
        conversation_ids=[conversation.id],
        tokens=tokens,
        notes=parsed.notes + notes,
        derive_enqueued=enqueued,
    )


async def ingest_events(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    events: list[IngestEvent],
    project_id: uuid.UUID | None = None,
) -> IngestResult:
    settings = get_settings()

    if not events:
        raise IngestError("the batch is empty")
    if len(events) > settings.max_batch_events:
        raise IngestError(f"a batch may carry at most {settings.max_batch_events} events")

    project = await resolve_project(session, workspace_id, project_id)

    grouped: dict[tuple[str, str | None], list[IngestEvent]] = {}
    for event in events:
        grouped.setdefault((event.vendor, event.vendor_conv_id), []).append(event)

    accepted = duplicates = tokens = 0
    ids: list[uuid.UUID] = []
    notes: list[str] = []

    for (vendor, vendor_conv_id), group in grouped.items():
        conversation = await resolve_conversation(
            session,
            project,
            vendor,
            vendor_conv_id,
            title=next((e.title for e in group if e.title), None),
            model_hint=next((e.model_hint for e in group if e.model_hint), None),
        )
        turns = [(e.role, e.content, e.position, e.captured_at, e.content_hash) for e in group]
        a, d, t, group_notes = await _append(session, conversation, turns)
        accepted += a
        duplicates += d
        tokens += t
        ids.append(conversation.id)
        notes.extend(group_notes)

    enqueued = await _maybe_enqueue_derive(session, project, tokens) if accepted else False

    await session.commit()
    return IngestResult(
        accepted=accepted,
        duplicates=duplicates,
        conversation_ids=ids,
        tokens=tokens,
        notes=list(dict.fromkeys(notes)),
        derive_enqueued=enqueued,
    )
