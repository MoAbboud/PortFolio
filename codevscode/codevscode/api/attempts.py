"""Starting an attempt and asking the client questions.

    POST /attempts                       {"challenge": "sample"}     -> a new attempt
    GET  /attempts/{id}                                              -> the same, to resume
    POST /attempts/{id}/questions        {"text": "..."}             -> the client's reply

Nothing from a challenge's hidden half is sent except an answer the player has just unlocked.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from codevscode.challenges import PublicChallenge, UnknownChallenge, public_view
from codevscode.client import service
from codevscode.config import settings
from codevscode.db import get_session
from codevscode.models import Attempt

router = APIRouter(prefix="/attempts", tags=["attempts"])


class StartAttempt(BaseModel):
    challenge: str = Field(min_length=1, max_length=64)


class AttemptView(BaseModel):
    """Everything the workspace needs, starting or resuming: the public half of the challenge,
    the clock, and the answers unlocked so far. Never anything else from the hidden half."""

    id: uuid.UUID
    challenge: str
    title: str
    time_limit_minutes: float
    started_at: datetime
    brief: str
    interface: str
    files: dict[str, str]
    smoke: dict | None
    answers: list[str]


class Ask(BaseModel):
    text: str


class ClientReply(BaseModel):
    reply: str
    new: bool


def _view(attempt: Attempt, challenge: PublicChallenge, answers: list[str]) -> AttemptView:
    return AttemptView(
        id=attempt.id,
        challenge=challenge.slug,
        title=challenge.title,
        time_limit_minutes=challenge.time_limit_minutes,
        started_at=attempt.started_at,
        brief=challenge.brief,
        interface=challenge.interface,
        files=challenge.files,
        smoke=challenge.smoke,
        answers=answers,
    )


@router.post("", status_code=201, response_model=AttemptView)
def start(body: StartAttempt, session: Session = Depends(get_session)) -> AttemptView:
    try:
        challenge = public_view(body.challenge)
    except UnknownChallenge:
        raise HTTPException(404, "There is no challenge by that name.") from None
    attempt = Attempt(challenge=challenge.slug, challenge_version=challenge.version, mode="practice")
    session.add(attempt)
    session.commit()
    session.refresh(attempt)
    return _view(attempt, challenge, [])


def _attempt(attempt_id: uuid.UUID, session: Session) -> Attempt:
    attempt = session.get(Attempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "There is no attempt with that id.")
    return attempt


@router.get("/{attempt_id}", response_model=AttemptView)
def state(attempt_id: uuid.UUID, session: Session = Depends(get_session)) -> AttemptView:
    attempt = _attempt(attempt_id, session)
    return _view(attempt, public_view(attempt.challenge), service.revealed_answers(session, attempt))


@router.post("/{attempt_id}/questions", response_model=ClientReply)
def ask(attempt_id: uuid.UUID, body: Ask, session: Session = Depends(get_session)) -> ClientReply:
    attempt = _attempt(attempt_id, session)
    if attempt.submitted_at is not None:
        raise HTTPException(409, "This attempt has been submitted; the client has gone home.")
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Ask a question.")
    if len(text) > settings.client_max_question_chars:
        raise HTTPException(400, f"Keep a question under {settings.client_max_question_chars} characters.")
    try:
        reply = service.ask(session, attempt, text)
    except service.LimitReached as limit:
        raise HTTPException(429, str(limit)) from None
    return ClientReply(reply=reply.text, new=reply.new)
