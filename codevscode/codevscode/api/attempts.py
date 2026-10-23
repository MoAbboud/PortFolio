"""Starting an attempt and asking the client questions.

    POST /attempts                       {"challenge": "sample"}     -> the brief and the interface
    GET  /attempts/{id}                                              -> the answers unlocked so far
    POST /attempts/{id}/questions        {"text": "..."}             -> the client's reply

Nothing from a challenge's hidden half is sent except an answer the player has just unlocked.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from codevscode.challenges import UnknownChallenge, public_view
from codevscode.client import service
from codevscode.config import settings
from codevscode.db import get_session
from codevscode.models import Attempt

router = APIRouter(prefix="/attempts", tags=["attempts"])


class StartAttempt(BaseModel):
    challenge: str = Field(min_length=1, max_length=64)


class AttemptStarted(BaseModel):
    id: uuid.UUID
    challenge: str
    title: str
    time_limit_minutes: float
    brief: str
    interface: str


class AttemptState(BaseModel):
    id: uuid.UUID
    challenge: str
    answers: list[str]


class Ask(BaseModel):
    text: str


class ClientReply(BaseModel):
    reply: str
    new: bool


@router.post("", status_code=201, response_model=AttemptStarted)
def start(body: StartAttempt, session: Session = Depends(get_session)) -> AttemptStarted:
    try:
        challenge = public_view(body.challenge)
    except UnknownChallenge:
        raise HTTPException(404, "There is no challenge by that name.") from None
    attempt = Attempt(challenge=challenge.slug, challenge_version=challenge.version, mode="practice")
    session.add(attempt)
    session.commit()
    return AttemptStarted(
        id=attempt.id,
        challenge=challenge.slug,
        title=challenge.title,
        time_limit_minutes=challenge.time_limit_minutes,
        brief=challenge.brief,
        interface=challenge.interface,
    )


def _attempt(attempt_id: uuid.UUID, session: Session) -> Attempt:
    attempt = session.get(Attempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "There is no attempt with that id.")
    return attempt


@router.get("/{attempt_id}", response_model=AttemptState)
def state(attempt_id: uuid.UUID, session: Session = Depends(get_session)) -> AttemptState:
    attempt = _attempt(attempt_id, session)
    return AttemptState(id=attempt.id, challenge=attempt.challenge, answers=service.revealed_answers(session, attempt))


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
