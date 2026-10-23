"""Finding a challenge folder by its slug, and the part of it a player may see.

Challenges are files in the repo (public, hidden halves included - the author's call); the
database refers to them by slug and version. A slug from a request or a job is checked against a
pattern before it touches the filesystem.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from codevscode.config import Settings, settings as default_settings

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


class UnknownChallenge(ValueError):
    pass


def challenge_path(slug: object, config: Settings | None = None) -> Path:
    """The folder for a challenge slug, refusing anything that is not a plain slug."""
    config = config or default_settings
    if not isinstance(slug, str) or not SLUG.match(slug):
        raise UnknownChallenge(f"not a challenge slug: {slug!r}")
    path = Path(config.challenges_dir) / slug
    if not (path / "challenge.json").is_file():
        raise UnknownChallenge(f"no challenge called {slug!r}")
    return path


@dataclass(frozen=True)
class PublicChallenge:
    """What a player is shown when an attempt starts. Never anything from hidden/."""

    slug: str
    version: int
    title: str
    time_limit_minutes: float
    brief: str
    interface: str
    files: dict[str, str]
    smoke: dict | None


def public_view(slug: str, config: Settings | None = None) -> PublicChallenge:
    path = challenge_path(slug, config)
    meta = json.loads((path / "challenge.json").read_text(encoding="utf-8"))
    starter = path / "public" / "starter"
    files = {name: (starter / name).read_text(encoding="utf-8") if (starter / name).is_file() else "" for name in meta["files"]}
    smoke_path = path / "public" / "smoke.json"
    return PublicChallenge(
        slug=slug,
        version=meta["version"],
        title=meta["title"],
        time_limit_minutes=meta["time_limit_minutes"],
        brief=(path / "public" / "brief.md").read_text(encoding="utf-8"),
        interface=(path / "public" / "interface.md").read_text(encoding="utf-8"),
        files=files,
        smoke=json.loads(smoke_path.read_text(encoding="utf-8")) if smoke_path.is_file() else None,
    )
