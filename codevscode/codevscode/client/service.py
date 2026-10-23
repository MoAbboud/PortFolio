"""Answering one question.

The client's reply is one of two things, and nothing else: the author's own answer for the
requirement the question matched, or a neutral line. It never names the requirement, never
quotes its phrasings, never mentions a test - none of that reaches the browser.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from codevscode.challenges import challenge_path
from codevscode.client.matcher import MATCHERS, Matcher, Requirement, best, load_requirements
from codevscode.config import Settings, settings as default_settings
from codevscode.models import Attempt, Question

NEUTRAL = (
    "That's up to you.",
    "I don't have anything to add on that - use your judgement.",
    "No strong feelings there. Whatever you think is best.",
)


class LimitReached(Exception):
    """Too many questions, or too fast."""


@dataclass(frozen=True)
class Reply:
    text: str
    new: bool  # True the first time a question unlocks this answer


@lru_cache(maxsize=32)
def _client(slug: str, version: int, matcher_name: str, cache_dir: str) -> tuple[Matcher, dict[str, Requirement]]:
    """One matcher per challenge version, built once: embedding the phrasings is the slow part."""
    requirements = load_requirements(challenge_path(slug))
    matcher = MATCHERS[matcher_name](requirements, cache_dir=cache_dir or None)
    return matcher, {r.key: r for r in requirements}


def client_for(attempt: Attempt, config: Settings) -> tuple[Matcher, dict[str, Requirement]]:
    return _client(attempt.challenge, attempt.challenge_version, config.client_matcher, config.client_model_cache)


def threshold(config: Settings) -> float:
    return config.client_threshold_embedding if config.client_matcher == "embedding" else config.client_threshold_lexical


def neutral(text: str) -> str:
    """A neutral line, chosen by the question so the same question always gets the same one."""
    return NEUTRAL[int(hashlib.sha256(text.encode()).hexdigest(), 16) % len(NEUTRAL)]


def revealed_answers(session: Session, attempt: Attempt, config: Settings | None = None) -> list[str]:
    """The answers this attempt has unlocked, in the order it unlocked them."""
    config = config or default_settings
    _, requirements = client_for(attempt, config)
    keys = session.scalars(
        select(Question.requirement)
        .where(Question.attempt_id == attempt.id, Question.revealed.is_(True))
        .order_by(Question.asked_at, Question.id)
    ).all()
    seen: list[str] = []
    for key in keys:
        if key not in seen:
            seen.append(key)
    return [requirements[key].answer for key in seen if key in requirements]


def ask(session: Session, attempt: Attempt, text: str, config: Settings | None = None) -> Reply:
    """Match a question, record it, and reply."""
    config = config or default_settings
    count, last = session.execute(
        select(func.count(Question.id), func.max(Question.asked_at)).where(Question.attempt_id == attempt.id)
    ).one()
    if count >= config.client_max_questions:
        raise LimitReached(f"This attempt has asked its {config.client_max_questions} questions.")
    now = datetime.now(timezone.utc)
    if last is not None and now - last < timedelta(seconds=config.client_min_seconds_between_questions):
        raise LimitReached("One question at a time, please.")

    matcher, requirements = client_for(attempt, config)
    key, score = best(matcher, text, threshold(config))
    best_key = key
    if best_key is None:
        scores = matcher.scores(text)
        best_key = max(scores, key=lambda k: scores[k]) if scores else None
    already = key is not None and session.scalar(
        select(func.count(Question.id)).where(
            Question.attempt_id == attempt.id, Question.requirement == key, Question.revealed.is_(True)
        )
    )
    session.add(
        Question(
            attempt_id=attempt.id,
            text=text,
            requirement=best_key,
            score=float(score),
            revealed=key is not None,
            matcher=matcher.name,
            asked_at=now,
        )
    )
    session.commit()
    if key is None:
        return Reply(neutral(text), new=False)
    return Reply(requirements[key].answer, new=not already)
