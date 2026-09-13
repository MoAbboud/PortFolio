"""The numbers the dashboard shows. Read-only.

Each figure is computed the same way the API or CLI computes it, so the page and the terminal
can never disagree: compression is `source_token_count / token_count` of the current brief
(the pointer, invariant 5), integrity comes from stored checkpoints only.
"""

from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.models import BriefVersion, Checkpoint, Conversation, Entry, Injection, Job, Message, Project
from herder.services.derive import current_brief


@dataclass
class ProjectStats:
    project: Project
    tokens_captured: int = 0
    messages: int = 0
    entries_by_layer: dict[str, int] = field(default_factory=dict)
    brief_version: int | None = None
    brief_tokens: int | None = None
    compression: float | None = None
    integrity_series: list[float] = field(default_factory=list)
    pending_jobs: int = 0


@dataclass
class FailedJob:
    kind: str
    error: str
    project: str | None
    created_at: dt.datetime


async def project_stats(session: AsyncSession, project: Project) -> ProjectStats:
    stats = ProjectStats(project=project)

    captured = (
        await session.execute(
            select(func.count(Message.id), func.coalesce(func.sum(Message.token_count), 0))
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.project_id == project.id)
        )
    ).one()
    stats.messages, stats.tokens_captured = int(captured[0]), int(captured[1])

    # Live entries only: what could be in a brief. Removed, superseded and archived are
    # history, and counting them would make a well-curated project look bloated.
    layers = (
        await session.execute(
            select(Entry.layer, func.count())
            .where(Entry.project_id == project.id, Entry.kind != "tail", Entry.status.in_(("active", "pinned")))
            .group_by(Entry.layer)
        )
    ).all()
    stats.entries_by_layer = {layer: int(count) for layer, count in layers}

    brief = await current_brief(session, project.id)
    if brief is not None:
        stats.brief_version, stats.brief_tokens = brief.version, brief.token_count
        stats.compression = brief.source_token_count / brief.token_count if brief.token_count else None

    stats.integrity_series = [
        float(value)
        for value in (
            await session.execute(
                select(Checkpoint.integrity)
                .join(Injection, Injection.id == Checkpoint.injection_id)
                .join(BriefVersion, BriefVersion.id == Injection.brief_version_id)
                .where(BriefVersion.project_id == project.id)
                .order_by(Checkpoint.created_at)
            )
        ).scalars()
    ]

    stats.pending_jobs = await pending_jobs(session, project.id)
    return stats


async def pending_jobs(session: AsyncSession, project_id: uuid.UUID) -> int:
    """Queued or running work for a project - derive, render, embed, and checkpoints of its serves."""
    direct = (
        await session.execute(
            select(func.count()).select_from(Job).where(
                Job.status.in_(("queued", "running")), Job.payload["project_id"].astext == str(project_id)
            )
        )
    ).scalar_one()
    checkpoints = (
        await session.execute(
            select(func.count())
            .select_from(Job)
            .join(Injection, Injection.id == func.cast(Job.payload["injection_id"].astext, Injection.id.type))
            .join(BriefVersion, BriefVersion.id == Injection.brief_version_id)
            .where(Job.kind == "checkpoint", Job.status.in_(("queued", "running")), BriefVersion.project_id == project_id)
        )
    ).scalar_one()
    return int(direct) + int(checkpoints)


async def failed_jobs(session: AsyncSession, workspace_id: uuid.UUID, limit: int = 10) -> list[FailedJob]:
    """Recent failures. Shown on the dashboard, because a job that failed in silence is the
    failure this project keeps finding - an embed never built, a checkpoint with no NLI."""
    # A job names its project directly (derive, render, embed) or through an injection
    # (checkpoint). Both paths are joined so every failure is attributed to a workspace.
    via_injection = (
        select(BriefVersion.project_id)
        .join(Injection, Injection.brief_version_id == BriefVersion.id)
        .where(Injection.id == func.cast(Job.payload["injection_id"].astext, Injection.id.type))
        .scalar_subquery()
    )
    project_id = func.coalesce(func.cast(Job.payload["project_id"].astext, Project.id.type), via_injection)
    rows = (
        await session.execute(
            select(Job, Project.name)
            .join(Project, Project.id == project_id)
            .where(Job.status == "failed", Project.workspace_id == workspace_id)
            .order_by(Job.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [FailedJob(kind=job.kind, error=job.error or "", project=name, created_at=job.created_at) for job, name in rows]
