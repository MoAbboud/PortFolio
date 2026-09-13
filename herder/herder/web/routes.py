"""The pages. Every write is a form post that redirects, so a reload never repeats an action."""

from __future__ import annotations

import difflib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.api.projects import _enqueue
from herder.core.config import get_settings
from herder.core.db import get_session
from herder.core.ids import uuid7
from herder.domain.adjust import KINDS, LAYERS, Refused
from herder.domain.integrity import CATEGORIES
from herder.models import (
    ApiKey,
    BriefVersion,
    Checkpoint,
    Conversation,
    Entry,
    EntryLineage,
    EntryRevision,
    Injection,
    Job,
    Message,
    Probe,
    ProbeResult,
    Project,
    Suggestion,
)
from herder.services import adjust
from herder.services.derive import current_brief
from herder.services.ingest import IngestError, ingest_paste
from herder.services.serve import ServeError, resume
from herder.web import queries
from herder.web.support import COOKIE, back_to, form, highlight, key_for, owned_project, web_key, with_notice

router = APIRouter(include_in_schema=False)
templates = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))
templates.env.filters["highlight"] = highlight

VENDORS = ("default", "claude", "chatgpt", "gemini")


def page(request: Request, name: str, **context) -> HTMLResponse:
    return templates.TemplateResponse(request, name, {"notice": request.query_params.get("notice"), **context})


def redirect(path: str) -> RedirectResponse:
    # 303, so the browser follows with a GET and a reload does not re-post the form.
    return RedirectResponse(path, status_code=status.HTTP_303_SEE_OTHER)


def _uuid(value: str | None) -> uuid.UUID | None:
    try:
        return uuid.UUID(value) if value else None
    except ValueError:
        return None


# ------------------------------------------------------------------------ login


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return page(request, "login.html")


@router.post("/login")
async def login(request: Request, session: AsyncSession = Depends(get_session)):
    fields = await form(request)
    presented = fields.get("key", "").strip()
    # Checked before any cookie is set, so a typo gets a message instead of a redirect loop.
    if await key_for(presented, session) is None:
        return redirect(with_notice("/login", "That key is not one this herder knows."))
    response = redirect("/")
    response.set_cookie(COOKIE, presented, httponly=True, samesite="strict", max_age=60 * 60 * 24 * 30)
    return response


@router.post("/logout")
async def logout():
    response = redirect("/login")
    response.delete_cookie(COOKIE)
    return response


# ------------------------------------------------------------------------ dashboard and paste


@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)):
    projects = (
        await session.execute(select(Project).where(Project.workspace_id == key.workspace_id).order_by(Project.name))
    ).scalars().all()
    stats = [await queries.project_stats(session, p) for p in projects]
    return page(
        request,
        "dashboard.html",
        stats=stats,
        layers=LAYERS,
        failures=await queries.failed_jobs(session, key.workspace_id),
        refresh=any(s.pending_jobs for s in stats),
    )


@router.post("/paste")
async def paste(request: Request, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)):
    """A transcript in, a project chosen or named, and a derive queued - the whole loop, no terminal."""
    fields = await form(request)
    name = fields.get("new_project", "").strip()
    project_id = _uuid(fields.get("project_id"))
    # Before anything is created: an empty paste must not leave an empty project behind.
    if not fields.get("text", "").strip():
        return redirect(with_notice("/", "Nothing was stored: the transcript is empty."))

    if name:
        project = (
            await session.execute(select(Project).where(Project.workspace_id == key.workspace_id, Project.name == name))
        ).scalars().first()
        if project is None:
            settings = get_settings()
            project = Project(
                id=uuid7(), workspace_id=key.workspace_id, name=name,
                brief_budget_tokens=settings.brief_budget_tokens, session_tail_tokens=settings.session_tail_tokens,
            )
            session.add(project)
            await session.commit()
    elif project_id is not None:
        project = await owned_project(session, project_id, key)
    else:
        return redirect(with_notice("/", "Choose a project or name a new one."))

    try:
        result = await ingest_paste(
            session, key.workspace_id, text=fields.get("text", ""), vendor=fields.get("vendor") or "manual", project_id=project.id
        )
    except IngestError as exc:
        return redirect(with_notice("/", f"Nothing was stored: {exc}"))

    # Queued whether or not the paste crossed the automatic threshold: someone pasting into a
    # demo wants to see a brief, not to learn about derive thresholds.
    await session.refresh(project)
    await _enqueue(session, project, "derive")
    notice = f"Stored {result.accepted} new messages ({result.duplicates} already here). Derive queued."
    return redirect(with_notice(f"/projects/{project.id}", notice))


# ------------------------------------------------------------------------ the adjuster


@router.get("/projects/{project_id}", response_class=HTMLResponse)
async def adjuster(
    request: Request, project_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    project = await owned_project(session, project_id, key)
    brief = await current_brief(session, project.id)
    included = set(brief.included_entry_ids) if brief else set()

    rows = (
        await session.execute(
            select(Entry, EntryRevision.title, EntryRevision.text_)
            .join(EntryRevision, (EntryRevision.entry_id == Entry.id) & (EntryRevision.revision == Entry.current_revision))
            .where(Entry.project_id == project.id, Entry.kind != "tail", Entry.status.in_(("active", "pinned", "archived", "removed")))
            .order_by(Entry.status == "removed", Entry.kind, Entry.last_seen_at.desc())
        )
    ).all()
    columns = {layer: [] for layer in LAYERS}
    for entry, title, text in rows:
        columns[entry.layer].append({"entry": entry, "title": title, "text": text, "in_brief": entry.id in included})

    suggestions = (
        await session.execute(
            select(Suggestion).where(Suggestion.project_id == project.id, Suggestion.status == "open").order_by(Suggestion.created_at)
        )
    ).scalars().all()

    stats = await queries.project_stats(session, project)
    return page(
        request, "project.html",
        project=project, brief=brief, columns=columns, suggestions=suggestions, stats=stats,
        kinds=KINDS, layers=LAYERS, vendors=VENDORS, refresh=stats.pending_jobs > 0,
    )


@router.post("/projects/{project_id}/jobs/{job}")
async def queue_job(
    request: Request, project_id: uuid.UUID, job: str, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    if job not in ("derive", "render"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    project = await owned_project(session, project_id, key)
    queued = await _enqueue(session, project, job)
    notice = f"{job.capitalize()} queued." if not queued.already_queued else "A derive is already queued or running."
    return redirect(with_notice(f"/projects/{project.id}", notice))


@router.post("/projects/{project_id}/entries/new")
async def add_entry(
    request: Request, project_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    project = await owned_project(session, project_id, key)
    fields = await form(request)
    try:
        await adjust.add(
            session, project.id, key.user_id,
            layer=fields.get("layer", ""), kind=fields.get("kind", ""),
            title=fields.get("title", "")[:80], text=fields.get("text", ""), pinned=fields.get("pinned") == "on",
        )
    except Refused as exc:
        return redirect(with_notice(f"/projects/{project.id}", f"Not added: {exc}"))
    return redirect(with_notice(f"/projects/{project.id}", "Added. Render queued."))


# ------------------------------------------------------------------------ one entry


async def _owned_entry(session: AsyncSession, entry_id: uuid.UUID, key: ApiKey) -> tuple[Entry, Project]:
    entry = await session.get(Entry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such entry")
    return entry, await owned_project(session, entry.project_id, key)


@router.get("/entries/{entry_id}", response_class=HTMLResponse)
async def entry_page(
    request: Request, entry_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    entry, project = await _owned_entry(session, entry_id, key)
    revisions = (
        await session.execute(select(EntryRevision).where(EntryRevision.entry_id == entry.id).order_by(EntryRevision.revision.desc()))
    ).scalars().all()
    current = revisions[0]
    messages = (
        await session.execute(
            select(Message, Conversation.title)
            .join(EntryLineage, EntryLineage.message_id == Message.id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(EntryLineage.entry_id == entry.id)
            .order_by(Conversation.id, Message.seq)
        )
    ).all()
    return page(
        request, "entry.html",
        project=project, entry=entry, current=current, revisions=revisions, messages=messages, layers=LAYERS,
    )


@router.post("/entries/{entry_id}/edit")
async def edit_entry(
    request: Request, entry_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    entry, _ = await _owned_entry(session, entry_id, key)
    fields = await form(request)
    try:
        await adjust.edit(
            session, entry.id, key.user_id,
            title=fields.get("title") or None, text=fields.get("text") or None,
            layer=fields.get("layer") if fields.get("layer") in LAYERS else None,
        )
    except Refused as exc:
        return redirect(with_notice(f"/entries/{entry.id}", f"Not saved: {exc}"))
    return redirect(with_notice(f"/entries/{entry.id}", "Saved. Render queued."))


@router.post("/entries/{entry_id}/act/{action}")
async def act_on_entry(
    request: Request, entry_id: uuid.UUID, action: str, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    entry, project = await _owned_entry(session, entry_id, key)
    fields = await form(request)
    back = back_to(fields.get("back"), f"/projects/{project.id}")
    try:
        result = await adjust.act(session, entry.id, action, key.user_id)
    except Refused as exc:
        return redirect(with_notice(back, f"Refused: {exc}"))
    return redirect(with_notice(back, f"{action.capitalize()}: now {result.status}. Render queued."))


@router.post("/entries/{entry_id}/add-back")
async def add_back(
    request: Request, entry_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    """From a checkpoint: accept the open add-back suggestion if there is one, else pin directly.
    Either way the entry ends pinned, which is what "add it back" has to mean for the budget."""
    entry, project = await _owned_entry(session, entry_id, key)
    fields = await form(request)
    back = back_to(fields.get("back"), f"/projects/{project.id}")
    open_suggestion = (
        await session.execute(
            select(Suggestion.id).where(Suggestion.entry_id == entry.id, Suggestion.kind == "add_back", Suggestion.status == "open")
        )
    ).scalars().first()
    try:
        if open_suggestion is not None:
            await adjust.accept(session, open_suggestion, key.user_id)
        elif entry.status != "pinned":
            await adjust.act(session, entry.id, "pin", key.user_id)
    except Refused as exc:
        return redirect(with_notice(back, f"Refused: {exc}"))
    return redirect(with_notice(back, "Added back: pinned, so the budget cannot drop it. Render queued."))


@router.post("/suggestions/{suggestion_id}/{decision}")
async def decide(
    request: Request, suggestion_id: uuid.UUID, decision: str, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    if decision not in ("accept", "dismiss"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    suggestion = await session.get(Suggestion, suggestion_id)
    if suggestion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such suggestion")
    project = await owned_project(session, suggestion.project_id, key)
    try:
        await (adjust.accept if decision == "accept" else adjust.dismiss)(session, suggestion.id, key.user_id)
    except (Refused, adjust.NotFound) as exc:
        return redirect(with_notice(f"/projects/{project.id}", f"Refused: {exc}"))
    return redirect(with_notice(f"/projects/{project.id}", f"Suggestion {decision}ed."))


# ------------------------------------------------------------------------ the brief


@router.get("/projects/{project_id}/brief", response_class=HTMLResponse)
async def brief_page(
    request: Request, project_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    project = await owned_project(session, project_id, key)
    versions = (
        await session.execute(select(BriefVersion).where(BriefVersion.project_id == project.id).order_by(BriefVersion.version.desc()))
    ).scalars().all()
    current = await current_brief(session, project.id)
    by_number = {v.version: v for v in versions}

    def number(name: str) -> int | None:
        try:
            return int(request.query_params.get(name, ""))
        except ValueError:
            return None

    shown = by_number.get(number("version")) or current
    against = by_number.get(number("compare"))
    diff = None
    if shown is not None and against is not None and against.id != shown.id:
        diff = list(
            difflib.unified_diff(
                against.rendered_text.splitlines(), shown.rendered_text.splitlines(),
                fromfile=f"v{against.version}", tofile=f"v{shown.version}", lineterm="", n=2,
            )
        )
    return page(
        request, "brief.html",
        project=project, versions=versions, current=current, shown=shown, against=against, diff=diff, vendors=VENDORS,
    )


@router.post("/projects/{project_id}/serve")
async def serve(
    request: Request, project_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    project = await owned_project(session, project_id, key)
    fields = await form(request)
    vendor = fields.get("vendor") if fields.get("vendor") in VENDORS else "default"
    try:
        pack = await resume(session, project, vendor=vendor, door="rest")
    except ServeError as exc:
        return redirect(with_notice(f"/projects/{project.id}", str(exc)))
    return redirect(f"/packs/{pack.injection_id}")


@router.get("/packs/{injection_id}", response_class=HTMLResponse)
async def pack_page(
    request: Request, injection_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    injection = await session.get(Injection, injection_id)
    if injection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such pack")
    version = await session.get(BriefVersion, injection.brief_version_id)
    project = await owned_project(session, version.project_id, key)
    checkpoints = (
        await session.execute(select(Checkpoint).where(Checkpoint.injection_id == injection.id).order_by(Checkpoint.created_at.desc()))
    ).scalars().all()
    pending = (
        await session.execute(
            select(Job.id).where(Job.kind == "checkpoint", Job.status.in_(("queued", "running")), Job.payload["injection_id"].astext == str(injection.id))
        )
    ).first() is not None
    return page(
        request, "pack.html",
        project=project, injection=injection, version=version, checkpoints=checkpoints, refresh=pending, pending=pending,
    )


@router.post("/packs/{injection_id}/checkpoint")
async def start_checkpoint(
    request: Request, injection_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    injection = await session.get(Injection, injection_id)
    if injection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such pack")
    version = await session.get(BriefVersion, injection.brief_version_id)
    await owned_project(session, version.project_id, key)
    session.add(Job(id=uuid7(), kind="checkpoint", payload={"injection_id": str(injection.id)}, status="queued"))
    await session.commit()
    return redirect(with_notice(f"/packs/{injection.id}", "Checkpoint queued. This page refreshes until it is done."))


# ------------------------------------------------------------------------ a checkpoint


@router.get("/checkpoints/{checkpoint_id}", response_class=HTMLResponse)
async def checkpoint_page(
    request: Request, checkpoint_id: uuid.UUID, key: ApiKey = Depends(web_key), session: AsyncSession = Depends(get_session)
):
    checkpoint = await session.get(Checkpoint, checkpoint_id)
    if checkpoint is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such checkpoint")
    injection = await session.get(Injection, checkpoint.injection_id)
    version = await session.get(BriefVersion, injection.brief_version_id)
    project = await owned_project(session, version.project_id, key)

    rows = (
        await session.execute(
            select(ProbeResult, Probe, Entry.status)
            .join(Probe, Probe.id == ProbeResult.probe_id)
            .outerjoin(Entry, Entry.id == Probe.entry_id)
            .where(ProbeResult.checkpoint_id == checkpoint.id)
            .order_by(Probe.category, Probe.created_at)
        )
    ).all()
    categories = []
    for category in CATEGORIES:
        scores = [r.score for r, p, _ in rows if p.category == category and r.score is not None]
        categories.append((category, sum(scores) / len(scores) if scores else None, len(scores)))
    return page(
        request, "checkpoint.html",
        project=project, checkpoint=checkpoint, injection=injection, version=version, rows=rows, categories=categories,
    )
