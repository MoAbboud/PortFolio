"""Reading the brief and the entries, and forcing a derive or a render by hand.

`derive` and `render` enqueue rather than run. A derive is minutes of CPU and must never sit
inside an HTTP request - the API in this system never loads a model.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func, literal_column, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.config import get_settings
from herder.core.db import get_session
from herder.core.ids import uuid7
from herder.core.security import require_key
from herder.models import ApiKey, BriefVersion, Entry, EntryLineage, EntryRevision, Job, Project
from herder.services.derive import current_brief
from herder.services.serve import NoBriefError, ServeError, resume as build_resume

router = APIRouter(prefix="/v1", tags=["projects"])


class BriefOut(BaseModel):
    project_id: uuid.UUID
    version: int
    rendered_text: str
    token_count: int
    budget_tokens: int
    included: int
    excluded: int
    source_message_count: int
    source_token_count: int
    compression_ratio: float
    trigger: str
    created_at: dt.datetime


class EntryOut(BaseModel):
    id: uuid.UUID
    layer: str
    kind: str
    status: str
    source: str
    revision: int
    title: str
    text: str
    confidence: float
    seen_in_conversations: int
    promotion_suggested: bool
    transmission_failed: bool
    lineage: list[uuid.UUID]
    # "The API says so": an empty lineage list alone reads the same as a derived entry whose
    # lineage went missing, so a hand-written entry is named as one.
    lineage_note: str | None = None
    in_current_brief: bool
    last_seen_at: dt.datetime


class ResumeOut(BaseModel):
    injection_id: uuid.UUID
    brief_version_id: uuid.UUID
    version: int
    vendor: str
    door: str
    pack_text: str
    token_count: int
    budget_tokens: int
    integrity: float | None
    rendered_fresh: bool


class Enqueued(BaseModel):
    job_id: uuid.UUID | None
    kind: str
    already_queued: bool


async def _project_for(session: AsyncSession, project_id: uuid.UUID, key: ApiKey) -> Project:
    project = await session.get(Project, project_id)
    if project is None or project.workspace_id != key.workspace_id:
        # Same answer either way: whether an id exists in another workspace is not something
        # this endpoint should confirm.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such project")
    return project


@router.get("/projects/{project_id}/brief", response_model=BriefOut)
async def brief(
    project_id: uuid.UUID,
    version: int | None = Query(default=None, description="a specific version; default is current"),
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> BriefOut:
    project = await _project_for(session, project_id, key)

    if version is None:
        # The pointer, not the highest version: a serve-time budget override stores a version
        # that is higher but is not the project's brief.
        found = await current_brief(session, project.id)
    else:
        found = (
            await session.execute(
                select(BriefVersion).where(
                    BriefVersion.project_id == project.id, BriefVersion.version == version
                )
            )
        ).scalars().first()
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="this project has no brief yet; run a derive",
        )

    return BriefOut(
        project_id=project.id,
        version=found.version,
        rendered_text=found.rendered_text,
        token_count=found.token_count,
        budget_tokens=found.budget_tokens,
        included=len(found.included_entry_ids),
        excluded=len(found.excluded_entry_ids),
        source_message_count=found.source_message_count,
        source_token_count=found.source_token_count,
        # The headline number, computed here rather than left to the caller so that every
        # reader of this endpoint computes it the same way.
        compression_ratio=(
            found.source_token_count / found.token_count if found.token_count else 0.0
        ),
        trigger=found.trigger,
        created_at=found.created_at,
    )


@router.get("/projects/{project_id}/entries", response_model=list[EntryOut])
async def entries(
    project_id: uuid.UUID,
    layer: str | None = None,
    kind: str | None = None,
    entry_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=200, ge=1, le=1000),
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> list[EntryOut]:
    project = await _project_for(session, project_id, key)

    current = await current_brief(session, project.id)
    included = set(current.included_entry_ids) if current is not None else set()

    query = (
        select(Entry, EntryRevision.title, EntryRevision.text_)
        .join(
            EntryRevision,
            (EntryRevision.entry_id == Entry.id)
            & (EntryRevision.revision == Entry.current_revision),
        )
        .where(Entry.project_id == project.id)
    )
    if layer:
        query = query.where(Entry.layer == layer)
    if kind:
        query = query.where(Entry.kind == kind)
    if entry_status:
        query = query.where(Entry.status == entry_status)

    rows = (await session.execute(query.order_by(Entry.last_seen_at.desc()).limit(limit))).all()

    # Lineage for every entry in one query rather than one query per entry. At the 1000-row
    # limit this endpoint was issuing 1001 round trips, and it is what the adjuster reads on
    # every page load.
    lineage_by_entry: dict[uuid.UUID, list[uuid.UUID]] = {}
    if rows:
        pairs = (
            await session.execute(
                select(EntryLineage.entry_id, EntryLineage.message_id).where(
                    EntryLineage.entry_id.in_([entry.id for entry, _, _ in rows])
                )
            )
        ).all()
        for entry_id, message_id in pairs:
            lineage_by_entry.setdefault(entry_id, []).append(message_id)

    out: list[EntryOut] = []
    for entry, title, body in rows:
        lineage = lineage_by_entry.get(entry.id, [])
        out.append(
            EntryOut(
                id=entry.id,
                layer=entry.layer,
                kind=entry.kind,
                status=entry.status,
                source=entry.source,
                revision=entry.current_revision,
                title=title,
                text=body,
                confidence=entry.confidence,
                seen_in_conversations=entry.seen_in_conversations,
                promotion_suggested=entry.promotion_suggested,
                transmission_failed=entry.transmission_failed,
                lineage=list(lineage),
                lineage_note=(
                    "Added by hand. There are no source messages behind it, and derive never changes it."
                    if entry.source == "user"
                    else None
                ),
                in_current_brief=entry.id in included,
                last_seen_at=entry.last_seen_at,
            )
        )
    return out


@router.get("/projects/{project_id}/resume", response_model=ResumeOut)
async def resume(
    project_id: uuid.UUID,
    vendor: str = Query(default="default", description="claude, chatgpt, gemini, or default"),
    door: str = Query(default="rest", description="rest, cli, extension or mcp"),
    budget: int | None = Query(default=None, description="override the project budget for this pack"),
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> ResumeOut:
    """Build a resume pack and record the serve.

    The pack comes back to the caller and stops there. Nothing is ever sent on the user's
    behalf - the text lands in a composer and a person presses send.

    A `budget` different from the project's renders a fresh brief version rather than
    truncating the current one, so the injection always points at a version whose stored text
    is exactly what was sent.
    """
    project = await _project_for(session, project_id, key)
    try:
        pack = await build_resume(
            session, project, vendor=vendor, door=door, budget_tokens=budget
        )
    except NoBriefError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ServeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return ResumeOut(
        injection_id=pack.injection_id,
        brief_version_id=pack.brief_version_id,
        version=pack.version,
        vendor=pack.vendor,
        door=pack.door,
        pack_text=pack.text,
        token_count=pack.token_count,
        budget_tokens=pack.budget_tokens,
        integrity=pack.integrity,
        rendered_fresh=pack.rendered_fresh,
    )


async def _enqueue(session: AsyncSession, project: Project, kind: str) -> Enqueued:
    statement = pg_insert(Job).values(
        id=uuid7(), kind=kind, payload={"project_id": str(project.id)}, status="queued"
    )
    if kind == "derive":
        # The partial unique index makes a second enqueue a no-op rather than a duplicate
        # job. Two derives for one project would extract the same messages twice.
        statement = statement.on_conflict_do_nothing(
            index_elements=[literal_column("(payload->>'project_id')")],
            index_where=text("kind = 'derive' AND status IN ('queued','running')"),
        )
    row = (await session.execute(statement.returning(Job.id))).first()
    await session.commit()
    return Enqueued(job_id=row[0] if row else None, kind=kind, already_queued=row is None)


@router.post("/projects/{project_id}/derive", response_model=Enqueued, status_code=202)
async def derive(
    project_id: uuid.UUID,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> Enqueued:
    project = await _project_for(session, project_id, key)
    return await _enqueue(session, project, "derive")


@router.post("/projects/{project_id}/render", response_model=Enqueued, status_code=202)
async def render(
    project_id: uuid.UUID,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> Enqueued:
    """Re-render without re-extracting.

    This is what makes the adjuster feel immediate: a render runs no inference at all, so
    pinning or removing an entry changes the brief in milliseconds.
    """
    project = await _project_for(session, project_id, key)
    return await _enqueue(session, project, "render")


class NewProject(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    brief_budget_tokens: int | None = Field(default=None, ge=1)


class ProjectCreated(BaseModel):
    id: uuid.UUID
    name: str
    brief_budget_tokens: int


@router.post("/projects", response_model=ProjectCreated, status_code=201)
async def create_project(
    body: NewProject,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> ProjectCreated:
    """Listed in the architecture's API surface since the start and built at stage 9, when the
    benchmark needed a fresh project per conversation through the API rather than the database."""
    name = body.name.strip()
    taken = (
        await session.execute(select(Project.id).where(Project.workspace_id == key.workspace_id, Project.name == name))
    ).first()
    if taken is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"a project named {name!r} already exists")
    settings = get_settings()
    project = Project(
        id=uuid7(),
        workspace_id=key.workspace_id,
        name=name,
        brief_budget_tokens=body.brief_budget_tokens or settings.brief_budget_tokens,
        session_tail_tokens=settings.session_tail_tokens,
    )
    session.add(project)
    await session.commit()
    return ProjectCreated(id=project.id, name=project.name, brief_budget_tokens=project.brief_budget_tokens)


@router.get("/projects", response_model=list[dict])
async def projects(
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (
        await session.execute(
            select(Project).where(Project.workspace_id == key.workspace_id).order_by(Project.name)
        )
    ).scalars().all()

    out = []
    for project in rows:
        counts = (
            await session.execute(
                select(Entry.status, func.count())
                .where(Entry.project_id == project.id)
                .group_by(Entry.status)
            )
        ).all()
        out.append(
            {
                "id": str(project.id),
                "name": project.name,
                "is_default": project.is_default,
                "entries": {status: count for status, count in counts},
                "tokens_since_derive": project.tokens_since_derive,
                "last_derived_at": project.last_derived_at.isoformat() if project.last_derived_at else None,
            }
        )
    return out
