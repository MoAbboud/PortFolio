"""Stage 5: turning a brief into something that can be pasted into a chat.

A resume pack is a brief version plus a vendor-specific preamble, wrapped in a tag. Every
serve writes an `injections` row, and that row is the join key a checkpoint later hangs off:
it records which exact version went where, through which door, with the exact text that was
sent.

**Nothing here sends anything.** The pack comes back to the caller and stops. Auto-sending
would put words in someone's mouth in a product other people can see, and that is not a
setting.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from herder.core.ids import uuid7
from herder.core.tokens import count_tokens
from herder.models import BriefVersion, Checkpoint, Injection, Project
from herder.prompts import load_prompt
from herder.services.derive import render_project

log = logging.getLogger("herder.serve")

DOORS = ("rest", "cli", "extension", "mcp")
_VENDOR_SECTION = re.compile(r"^##\s*vendor:\s*(\S+)\s*$", re.MULTILINE)


class ServeError(ValueError):
    """Bad request. Reaches the caller as a 4xx with the reason."""


class NoBriefError(ServeError):
    """The project has never been derived. A 404 rather than a 400."""


@dataclass
class Pack:
    injection_id: uuid.UUID
    brief_version_id: uuid.UUID
    version: int
    vendor: str
    door: str
    text: str
    token_count: int
    budget_tokens: int
    integrity: float | None
    rendered_fresh: bool


def preamble_for(vendor: str) -> tuple[str, str]:
    """The preamble for a vendor, falling back to `default`. Returns (text, prompt version)."""
    body, version = load_prompt("preamble.md")

    sections: dict[str, str] = {}
    matches = list(_VENDOR_SECTION.finditer(body))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        sections[match.group(1).lower()] = body[match.end() : end].strip()

    if "default" not in sections:
        raise ServeError("preamble.md has no '## vendor: default' section")

    return sections.get((vendor or "").lower(), sections["default"]), version


def build_pack(project_name: str, version: int, brief_text: str, vendor: str,
               integrity: float | None = None) -> str:
    """Preamble, then the brief, wrapped in a tag that a model can see the edges of."""
    preamble, _ = preamble_for(vendor)

    # The project name goes into an attribute, so a quote in it would break the tag.
    safe_name = project_name.replace('"', "'")
    attributes = [f'v=1 project="{safe_name}" version={version}']
    if integrity is not None:
        # Only when it has actually been measured. Printing `integrity=0.00` for a project
        # that has never been checkpointed would be a lie with a number on it, and the
        # number is the part people believe.
        attributes.append(f"integrity={integrity:.2f}")

    return (
        f"<herder-context {' '.join(attributes)}>\n"
        f"{preamble}\n\n"
        f"{brief_text}\n"
        f"</herder-context>"
    )


async def _latest_integrity(session: AsyncSession, project_id: uuid.UUID) -> float | None:
    """The most recent checkpoint score for this project, or None if never measured.

    Stage 6 creates checkpoints; until then this is always None and the attribute is left
    off the tag entirely.
    """
    result = await session.execute(
        select(Checkpoint.integrity)
        .join(Injection, Injection.id == Checkpoint.injection_id)
        .join(BriefVersion, BriefVersion.id == Injection.brief_version_id)
        .where(BriefVersion.project_id == project_id)
        .order_by(Checkpoint.created_at.desc())
        .limit(1)
    )
    value = result.scalars().first()
    return float(value) if value is not None else None


async def resume(
    session: AsyncSession,
    project: Project,
    *,
    vendor: str = "default",
    door: str = "rest",
    budget_tokens: int | None = None,
    target_conversation_id: uuid.UUID | None = None,
) -> Pack:
    """Build a pack and record the serve.

    **A budget override renders a fresh version rather than truncating the current one.**
    Truncating the stored text would produce a pack whose content matches no version in the
    database, and a checkpoint run against it would be scored against a text that was never
    sent. Rendering is cheap - no inference at all - so the honest option is also the easy
    one.

    **The version served is the highest one only if it was rendered at the budget asked for.**
    An override's version becomes the highest version (invariant 5), so "serve the highest"
    on its own would hand every later caller the shrunken brief - the override applying to
    every serve after it, which is exactly what it must not do. The same check also re-renders
    when the project's budget has changed since the last render, and lets a repeated override
    reuse the version it already rendered instead of writing a duplicate.
    """
    if door not in DOORS:
        raise ServeError(f"unknown door {door!r}; expected one of {', '.join(DOORS)}")
    if budget_tokens is not None and budget_tokens < 1:
        raise ServeError("budget_tokens must be positive")
    # Normalised before it is stored: stage 6 groups by vendor, and "Claude" is "claude".
    vendor = (vendor or "").strip().lower() or "default"

    latest = (
        await session.execute(
            select(BriefVersion)
            .where(BriefVersion.project_id == project.id)
            .order_by(BriefVersion.version.desc())
            .limit(1)
        )
    ).scalars().first()

    # Checked before any render. A render needs no derive to run, so an override on a project
    # that was never derived would otherwise serve an empty pack and record it as sent.
    if latest is None:
        raise NoBriefError(
            f"{project.name} has no brief yet. Run a derive first: "
            f"python -m herder derive --project {project.name}"
        )

    wanted = budget_tokens if budget_tokens is not None else project.brief_budget_tokens
    rendered_fresh = latest.budget_tokens != wanted
    if rendered_fresh:
        # The budget is passed through, never written onto the project: a caller asking for a
        # smaller pack once must not quietly shrink every future derive.
        version = await render_project(session, project, "manual", budget_tokens=wanted)
    else:
        version = latest

    integrity = await _latest_integrity(session, project.id)
    text = build_pack(project.name, version.version, version.rendered_text, vendor, integrity)

    injection = Injection(
        id=uuid7(),
        brief_version_id=version.id,
        door=door,
        target_vendor=vendor,
        target_conversation_id=target_conversation_id,
        pack_text=text,
    )
    session.add(injection)
    await session.commit()

    log.info(
        "served %s v%d to %s via %s: %d tokens",
        project.name, version.version, vendor, door, count_tokens(text),
    )

    return Pack(
        injection_id=injection.id,
        brief_version_id=version.id,
        version=version.version,
        vendor=vendor,
        door=door,
        text=text,
        token_count=count_tokens(text),
        budget_tokens=version.budget_tokens,
        integrity=integrity,
        rendered_fresh=rendered_fresh,
    )
