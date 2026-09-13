"""Stage 7: a person changing the memory, and the suggestions they accept or dismiss.

Three rules hold for every function here:

- **Every change writes an `entry_events` row**, and a revision whenever title or text changed.
  The adjuster is where a person overrules the system, and an override with no record is one
  nobody can later explain.
- **Every change enqueues a `render`, never a `derive`.** A render is milliseconds and runs no
  model; a derive is minutes. Adjusting has to feel immediate, and it must not re-extract -
  the person is correcting what was extracted.
- **A refused action raises `Refused` with the reason** (from `domain/adjust.py`), so the
  caller can tell the person why rather than appearing to succeed.

What derive does with the result - never changing an entry a person holds - lives in
`domain/merge.py`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.ids import uuid7
from herder.core.tokens import count_tokens
from herder.domain import adjust as rules
from herder.domain.adjust import Refused
from herder.extractors.base import make_title
from herder.models import Entry, EntryEvent, EntryLineage, EntryRevision, Job, Message, Suggestion
from herder.services.derive import CHANGED_BY_USER, _next_revision


class NotFound(LookupError):
    """No such entry or suggestion."""


@dataclass
class Adjusted:
    entry_id: uuid.UUID
    project_id: uuid.UUID
    event: str
    status: str
    layer: str
    revision: int
    source: str
    render_job_id: uuid.UUID


# ------------------------------------------------------------------------ helpers


async def _enqueue(session: AsyncSession, project_id: uuid.UUID, kind: str) -> uuid.UUID:
    job_id = uuid7()
    session.add(Job(id=job_id, kind=kind, payload={"project_id": str(project_id)}, status="queued"))
    await session.flush()
    return job_id


async def _event(session: AsyncSession, entry_id: uuid.UUID, user_id: uuid.UUID | None, event: str, **payload) -> None:
    session.add(EntryEvent(id=uuid7(), entry_id=entry_id, user_id=user_id, event=event, payload=payload or None))


async def _entry(session: AsyncSession, entry_id: uuid.UUID) -> Entry:
    # Read with a fresh query rather than `session.get`: every change below is a core
    # `update()`, which does not refresh an object already in the identity map.
    entry = (
        await session.execute(select(Entry).where(Entry.id == entry_id).execution_options(populate_existing=True))
    ).scalars().first()
    if entry is None:
        raise NotFound(f"no entry {entry_id}")
    return entry


async def _finish(session: AsyncSession, entry_id: uuid.UUID, event: str) -> Adjusted:
    entry = await _entry(session, entry_id)
    job = await _enqueue(session, entry.project_id, "render")
    await session.commit()
    return Adjusted(
        entry_id=entry.id,
        project_id=entry.project_id,
        event=event,
        status=entry.status,
        layer=entry.layer,
        revision=entry.current_revision,
        source=entry.source,
        render_job_id=job,
    )


# ------------------------------------------------------------------------ actions


async def act(session: AsyncSession, entry_id: uuid.UUID, action: str, user_id: uuid.UUID | None) -> Adjusted:
    """pin, unpin, remove, restore, archive, promote."""
    entry = await _entry(session, entry_id)
    # Read before the update. A bulk `update()` also rewrites the object already in the session,
    # so reading `entry.status` afterwards records the new state as the old one - which is what
    # the first test of this function found.
    before_status, before_layer = entry.status, entry.layer
    change = rules.apply(action, status=before_status, layer=before_layer, kind=entry.kind)

    values: dict = {"status": change.status, "layer": change.layer}
    if action == "promote":
        # Answered: whether it came from a suggestion or not, it is no longer waiting on one.
        values["promotion_suggested"] = True
    await session.execute(update(Entry).where(Entry.id == entry.id).values(**values))
    await _event(
        session, entry.id, user_id, action,
        from_status=before_status, to_status=change.status, from_layer=before_layer, to_layer=change.layer,
    )
    return await _finish(session, entry.id, action)


async def edit(
    session: AsyncSession,
    entry_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    title: str | None = None,
    text: str | None = None,
    layer: str | None = None,
    reason: str | None = None,
) -> Adjusted:
    """Change title, text or layer. A text change is a new revision; a layer change is not."""
    entry = await _entry(session, entry_id)
    rules.check_edit(status=entry.status, kind=entry.kind, layer=layer)
    # Before any update, for the same reason as in `act`.
    before_layer, before_revision = entry.layer, entry.current_revision

    current = await session.get(EntryRevision, (entry.id, before_revision))
    new_title = title.strip() if title is not None else current.title
    new_text = text.strip() if text is not None else current.text_
    if not new_title or not new_text:
        raise Refused("title and text cannot be blank")

    events: list[str] = []
    if (new_title, new_text) != (current.title, current.text_):
        revision = await _next_revision(session, entry.id)
        session.add(
            EntryRevision(
                entry_id=entry.id,
                revision=revision,
                title=new_title,
                text_=new_text,
                token_count=count_tokens(f"{new_title}\n\n{new_text}"),
                # `user` is also what makes derive treat this entry as held from now on.
                changed_by=CHANGED_BY_USER,
                change_reason=reason or "edited by hand",
            )
        )
        # The vector described the old text. Cleared rather than left stale: a stale vector
        # would let similarity search keep matching what the entry no longer says. The
        # `embed` job fills it, and derive backfills before merging if that has not run.
        await session.execute(update(Entry).where(Entry.id == entry.id).values(current_revision=revision, embedding=None))
        await _enqueue(session, entry.project_id, "embed")
        await _event(session, entry.id, user_id, "edit", from_revision=before_revision, to_revision=revision)
        events.append("edit")

    if layer is not None and layer != before_layer:
        await session.execute(update(Entry).where(Entry.id == entry.id).values(layer=layer))
        await _event(session, entry.id, user_id, "relayer", from_layer=before_layer, to_layer=layer)
        events.append("relayer")

    if not events:
        raise Refused("nothing changed")
    return await _finish(session, entry.id, "+".join(events))


async def add(
    session: AsyncSession,
    project_id: uuid.UUID,
    user_id: uuid.UUID | None,
    *,
    layer: str,
    kind: str,
    title: str,
    text: str,
    pinned: bool = False,
) -> Adjusted:
    """An entry written by hand: `source = user`, no lineage, and derive never changes it."""
    if layer not in rules.LAYERS:
        raise Refused(f"unknown layer {layer!r}; expected one of {', '.join(rules.LAYERS)}")
    if kind not in rules.KINDS:
        raise Refused(f"unknown kind {kind!r}; expected one of {', '.join(rules.KINDS)}")
    title, text = title.strip(), text.strip()
    if not title or not text:
        raise Refused("title and text cannot be blank")

    entry_id = uuid7()
    session.add(
        Entry(
            id=entry_id,
            project_id=project_id,
            layer=layer,
            kind=kind,
            status="pinned" if pinned else "active",
            source="user",
            current_revision=1,
            # A person said it directly. Confidence is about how sure extraction was, and
            # nothing was extracted.
            confidence=1.0,
        )
    )
    await session.flush()
    session.add(
        EntryRevision(
            entry_id=entry_id,
            revision=1,
            title=title,
            text_=text,
            token_count=count_tokens(f"{title}\n\n{text}"),
            changed_by=CHANGED_BY_USER,
            change_reason="added by hand",
        )
    )
    await _enqueue(session, project_id, "embed")
    await _event(session, entry_id, user_id, "add", layer=layer, kind=kind, pinned=pinned)
    return await _finish(session, entry_id, "add")


# ------------------------------------------------------------------------ suggestions


async def _suggestion(session: AsyncSession, suggestion_id: uuid.UUID) -> Suggestion:
    suggestion = await session.get(Suggestion, suggestion_id)
    if suggestion is None:
        raise NotFound(f"no suggestion {suggestion_id}")
    if suggestion.status != "open":
        raise Refused(f"this suggestion was already {suggestion.status}")
    return suggestion


async def accept(session: AsyncSession, suggestion_id: uuid.UUID, user_id: uuid.UUID | None) -> Adjusted | None:
    """Do what the suggestion proposed (UC-6), then close it.

    add_back  pin the entry, so the budget can never drop it again
    extract   write the message as an entry, citing that message
    promote   move the entry to Stable
    conflict  let the new claim supersede the entry the person held
    """
    suggestion = await _suggestion(session, suggestion_id)
    result: Adjusted | None = None

    if suggestion.kind == "add_back":
        entry = await _entry(session, suggestion.entry_id)
        if entry.status == "pinned":
            result = await _finish(session, entry.id, "already pinned")
        else:
            result = await act(session, entry.id, "pin", user_id)

    elif suggestion.kind == "promote":
        result = await act(session, suggestion.entry_id, "promote", user_id)

    elif suggestion.kind == "extract":
        result = await _extract_message(session, suggestion, user_id)

    elif suggestion.kind == "conflict":
        new = await _entry(session, suggestion.entry_id)
        held = await _entry(session, suggestion.related_entry_id)
        before_status = held.status
        if before_status != "superseded":
            await session.execute(
                update(Entry).where(Entry.id == held.id).values(status="superseded", superseded_by=new.id)
            )
            await _event(session, held.id, user_id, "superseded_by_person", by=str(new.id), from_status=before_status)
        result = await _finish(session, new.id, "conflict accepted")

    else:
        raise Refused(f"no accept action for a {suggestion.kind!r} suggestion")

    await session.execute(update(Suggestion).where(Suggestion.id == suggestion.id).values(status="accepted"))
    await session.commit()
    return result


async def _extract_message(session: AsyncSession, suggestion: Suggestion, user_id: uuid.UUID | None) -> Adjusted:
    """The message, as an entry. Derived - it cites a real message, so invariant 2 holds - and
    held, because a person chose to keep it."""
    message = await session.get(Message, suggestion.message_id)
    if message is None:
        raise NotFound("the message this suggestion points at no longer exists")

    text = " ".join(message.content.split())
    entry_id = uuid7()
    session.add(
        Entry(
            id=entry_id,
            project_id=suggestion.project_id,
            layer="project",
            kind="fact",
            status="active",
            source="derived",
            current_revision=1,
            confidence=1.0,
        )
    )
    await session.flush()
    session.add(
        EntryRevision(
            entry_id=entry_id,
            revision=1,
            title=make_title(text),
            text_=text,
            token_count=count_tokens(text),
            changed_by=CHANGED_BY_USER,
            change_reason="extracted by hand from a checkpoint suggestion",
        )
    )
    session.add(EntryLineage(entry_id=entry_id, message_id=message.id))
    await _enqueue(session, suggestion.project_id, "embed")
    await _event(session, entry_id, user_id, "extract", message_id=str(message.id), suggestion_id=str(suggestion.id))
    return await _finish(session, entry_id, "extract")


async def dismiss(session: AsyncSession, suggestion_id: uuid.UUID, user_id: uuid.UUID | None) -> Adjusted | None:
    """Close without acting - except a conflict, where dismissing means "mine is right".

    For a conflict the new claim is removed, not just left beside the held entry: left active,
    it would sit in the brief contradicting what the person just confirmed, and removed, the
    merge step's hard rule keeps it from coming back on the next derive.
    """
    suggestion = await _suggestion(session, suggestion_id)
    result: Adjusted | None = None

    if suggestion.kind == "conflict" and suggestion.entry_id is not None:
        new = await _entry(session, suggestion.entry_id)
        if new.status in rules.STATUS_ACTIONS["remove"][0]:
            result = await act(session, new.id, "remove", user_id)

    await session.execute(update(Suggestion).where(Suggestion.id == suggestion.id).values(status="dismissed"))
    await session.commit()
    return result
