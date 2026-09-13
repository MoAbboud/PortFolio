"""Login, forms, and the highlighting the lineage panel needs.

## Why the session cookie holds the API key

There is one user and they already have a key. The login page takes it, and the cookie is the
key itself, checked against its hash on every request exactly as the API checks a bearer
header - so there is one authentication path, not two that can disagree. It is `HttpOnly`, so
page script cannot read it, and `SameSite=Strict`, so another site cannot post a form into
this one with it attached; that is the whole of the CSRF defence and it is enough for a
single-user tool on localhost. A hosted, multi-user version (stage 11) wants real sessions.

## Why forms are parsed here

`python-multipart` is not installed in the Docker image, and the pages only post short
urlencoded forms. Parsing those is `urllib.parse`, which is not worth an image rebuild.
"""

from __future__ import annotations

import hmac
import re
import uuid
from urllib.parse import parse_qs, quote

from fastapi import Depends, HTTPException, Request, status
from markupsafe import Markup, escape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.db import get_session
from herder.core.security import hash_key
from herder.models import ApiKey, Project

COOKIE = "herder_key"
MAX_FORM_BYTES = 2_000_000


class LoginRequired(Exception):
    """Raised by `web_key`; turned into a redirect to /login by the app."""


async def key_for(presented: str | None, session: AsyncSession) -> ApiKey | None:
    """The same check the API makes on a bearer header: hash, look up, not revoked."""
    if not presented:
        return None
    digest = hash_key(presented)
    key = (await session.execute(select(ApiKey).where(ApiKey.key_hash == digest))).scalar_one_or_none()
    if key is None or key.revoked_at is not None or not hmac.compare_digest(key.key_hash, digest):
        return None
    return key


async def web_key(request: Request, session: AsyncSession = Depends(get_session)) -> ApiKey:
    key = await key_for(request.cookies.get(COOKIE), session)
    if key is None:
        raise LoginRequired()
    return key


async def form(request: Request) -> dict[str, str]:
    body = await request.body()
    if len(body) > MAX_FORM_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="form too large")
    parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
    return {name: values[0] for name, values in parsed.items()}


def back_to(target: str | None, fallback: str) -> str:
    """Only a path on this site. `//evil.example` is a path to a browser too, so it is refused."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return fallback


def with_notice(path: str, notice: str) -> str:
    joiner = "&" if "?" in path else "?"
    return f"{path}{joiner}notice={quote(notice)}"


async def owned_project(session: AsyncSession, project_id: uuid.UUID, key: ApiKey) -> Project:
    project = await session.get(Project, project_id)
    if project is None or project.workspace_id != key.workspace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="no such project")
    return project


def highlight(message: str, entry_text: str) -> Markup:
    """The message, escaped, with the parts the entry was drawn from marked.

    Matched phrase by phrase rather than as one string, because a merged entry's text is
    several claims ("... Previously: ...") drawn from different messages. A message matching
    nothing is shown whole and unmarked - the lineage row is still the evidence, and marking
    text that was not actually matched would overstate it.
    """
    phrases = [p.strip() for p in re.split(r"(?:\n+|Previously:|(?<=[.!?])\s+)", entry_text) if len(p.strip()) >= 12]
    spans: list[tuple[int, int]] = []
    lowered = message.lower()
    for phrase in phrases:
        start = lowered.find(phrase.lower().rstrip(".!?"))
        if start >= 0:
            spans.append((start, start + len(phrase.rstrip(".!?"))))

    if not spans:
        return Markup(escape(message))

    spans.sort()
    merged: list[list[int]] = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    out, cursor = [], 0
    for start, end in merged:
        out.append(escape(message[cursor:start]))
        out.append(Markup("<mark>") + escape(message[start:end]) + Markup("</mark>"))
        cursor = end
    out.append(escape(message[cursor:]))
    return Markup("").join(out)
