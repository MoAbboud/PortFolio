"""Checkpoints: running one, reading one, and the integrity time series.

Running one enqueues a job and returns 202. A checkpoint is a dozen local model calls - minutes
on a CPU - and the API in this system never loads a model.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.core.ids import uuid7
from herder.core.security import require_key
from herder.domain.integrity import CATEGORIES, WEIGHTS
from herder.models import ApiKey, BriefVersion, Checkpoint, Injection, Job, Probe, ProbeResult, Project

router = APIRouter(prefix="/v1", tags=["checkpoints"])


class CheckpointRequest(BaseModel):
    mode: Literal["local", "in_chat"] = "local"


class CheckpointQueued(BaseModel):
    job_id: uuid.UUID
    injection_id: uuid.UUID
    mode: str


class CategoryOut(BaseModel):
    category: str
    weight: float
    score: float | None
    graded: int
    inconclusive: int


class ProbeResultOut(BaseModel):
    probe_id: uuid.UUID
    category: str
    entry_id: uuid.UUID | None
    entry_revision: int | None
    message_id: uuid.UUID | None
    question: str
    expected_answer: str
    answer: str
    score: float | None
    inconclusive: bool
    reason: str | None


class CheckpointOut(BaseModel):
    id: uuid.UUID
    injection_id: uuid.UUID
    project_id: uuid.UUID
    brief_version: int
    target_vendor: str | None
    mode: str
    judge_model: str
    answer_model: str | None
    integrity: float
    probe_count: int
    latency_ms: int | None
    categories: list[CategoryOut]
    probes: list[ProbeResultOut]
    created_at: dt.datetime


class IntegrityPoint(BaseModel):
    checkpoint_id: uuid.UUID
    injection_id: uuid.UUID
    brief_version: int
    target_vendor: str | None
    integrity: float
    probe_count: int
    created_at: dt.datetime


def _not_found(what: str) -> HTTPException:
    # The same answer for "does not exist" and "exists in another workspace": whether an id
    # exists elsewhere is not something these endpoints should confirm.
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"no such {what}")


async def _project_of_version(session: AsyncSession, version_id: uuid.UUID, key: ApiKey) -> tuple[BriefVersion, Project] | None:
    version = await session.get(BriefVersion, version_id)
    project = await session.get(Project, version.project_id) if version is not None else None
    if project is None or project.workspace_id != key.workspace_id:
        return None
    return version, project


@router.post("/injections/{injection_id}/checkpoint", response_model=CheckpointQueued, status_code=202)
async def start_checkpoint(
    injection_id: uuid.UUID,
    request: CheckpointRequest | None = None,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> CheckpointQueued:
    mode = (request or CheckpointRequest()).mode
    injection = await session.get(Injection, injection_id)
    if injection is None or await _project_of_version(session, injection.brief_version_id, key) is None:
        raise _not_found("injection")

    if mode == "in_chat":
        # Captured answers come from the browser extension, which is stage 12. Refused rather
        # than accepted and ignored.
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="in_chat checkpoints arrive with the browser extension at stage 12; use mode=local",
        )

    job = Job(id=uuid7(), kind="checkpoint", payload={"injection_id": str(injection.id)}, status="queued")
    session.add(job)
    await session.commit()
    return CheckpointQueued(job_id=job.id, injection_id=injection.id, mode=mode)


@router.get("/checkpoints/{checkpoint_id}", response_model=CheckpointOut)
async def read_checkpoint(
    checkpoint_id: uuid.UUID,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> CheckpointOut:
    checkpoint = await session.get(Checkpoint, checkpoint_id)
    injection = await session.get(Injection, checkpoint.injection_id) if checkpoint is not None else None
    owned = await _project_of_version(session, injection.brief_version_id, key) if injection is not None else None
    if owned is None:
        raise _not_found("checkpoint")
    version, project = owned

    rows = (
        await session.execute(
            select(ProbeResult, Probe)
            .join(Probe, Probe.id == ProbeResult.probe_id)
            .where(ProbeResult.checkpoint_id == checkpoint.id)
            .order_by(Probe.category, Probe.created_at)
        )
    ).all()

    probes = [
        ProbeResultOut(
            probe_id=probe.id,
            category=probe.category,
            entry_id=probe.entry_id,
            entry_revision=probe.entry_revision,
            message_id=probe.message_id,
            question=probe.question,
            expected_answer=probe.expected_answer,
            answer=result.answer,
            score=result.score,
            inconclusive=result.score is None,
            reason=result.judge_reason,
        )
        for result, probe in rows
    ]

    categories = []
    for category in CATEGORIES:
        mine = [p for p in probes if p.category == category]
        scored = [p.score for p in mine if p.score is not None]
        categories.append(
            CategoryOut(
                category=category,
                weight=WEIGHTS[category],
                score=sum(scored) / len(scored) if scored else None,
                graded=len(scored),
                inconclusive=len(mine) - len(scored),
            )
        )

    return CheckpointOut(
        id=checkpoint.id,
        injection_id=injection.id,
        project_id=project.id,
        brief_version=version.version,
        target_vendor=injection.target_vendor,
        mode=checkpoint.mode,
        judge_model=checkpoint.judge_model,
        answer_model=checkpoint.answer_model,
        integrity=checkpoint.integrity,
        probe_count=checkpoint.probe_count,
        latency_ms=checkpoint.latency_ms,
        categories=categories,
        probes=probes,
        created_at=checkpoint.created_at,
    )


@router.get("/projects/{project_id}/integrity", response_model=list[IntegrityPoint])
async def integrity_series(
    project_id: uuid.UUID,
    key: ApiKey = Depends(require_key),
    session: AsyncSession = Depends(get_session),
) -> list[IntegrityPoint]:
    project = await session.get(Project, project_id)
    if project is None or project.workspace_id != key.workspace_id:
        raise _not_found("project")

    rows = (
        await session.execute(
            select(Checkpoint, Injection, BriefVersion)
            .join(Injection, Injection.id == Checkpoint.injection_id)
            .join(BriefVersion, BriefVersion.id == Injection.brief_version_id)
            .where(BriefVersion.project_id == project.id)
            .order_by(Checkpoint.created_at)
        )
    ).all()

    return [
        IntegrityPoint(
            checkpoint_id=checkpoint.id,
            injection_id=injection.id,
            brief_version=version.version,
            target_vendor=injection.target_vendor,
            integrity=checkpoint.integrity,
            probe_count=checkpoint.probe_count,
            created_at=checkpoint.created_at,
        )
        for checkpoint, injection, version in rows
    ]
