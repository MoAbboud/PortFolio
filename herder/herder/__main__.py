"""herder's command line.

`python -m herder bootstrap` creates the one account, its workspace, its default project and
an API key, and prints the key once. There is no registration flow: there is one user, and a
sign-up page for an audience of one would be ceremony.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from herder.core.config import get_settings
from herder.core.db import get_sessionmaker
from herder.core.ids import uuid7
from herder.core.security import generate_key
from herder.models import ApiKey, Project, User, Workspace


async def bootstrap(email: str, project_name: str) -> int:
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        created_user = user is None
        if user is None:
            user = User(id=uuid7(), email=email, display_name=email.split("@")[0])
            session.add(user)
            await session.flush()

        workspace = (
            await session.execute(select(Workspace).where(Workspace.owner_user_id == user.id))
        ).scalar_one_or_none()
        if workspace is None:
            workspace = Workspace(id=uuid7(), name="default", owner_user_id=user.id)
            session.add(workspace)
            await session.flush()

        project = (
            await session.execute(
                select(Project).where(Project.workspace_id == workspace.id, Project.is_default.is_(True))
            )
        ).scalar_one_or_none()
        if project is None:
            settings = get_settings()
            project = Project(
                id=uuid7(),
                workspace_id=workspace.id,
                name=project_name,
                is_default=True,
                brief_budget_tokens=settings.brief_budget_tokens,
                session_tail_tokens=settings.session_tail_tokens,
            )
            session.add(project)
            await session.flush()

        plaintext, prefix, digest = generate_key()
        session.add(
            ApiKey(
                id=uuid7(),
                user_id=user.id,
                workspace_id=workspace.id,
                name="bootstrap",
                key_hash=digest,
                prefix=prefix,
            )
        )
        await session.commit()

        print(f"{'created' if created_user else 'found'} user     {user.email}")
        print(f"workspace          {workspace.id}")
        print(f"default project    {project.name}  {project.id}")
        print()
        print("API key, shown once and not recoverable:")
        print()
        print(f"    {plaintext}")
        print()
        print("PowerShell:")
        print(f'    $env:HERDER_KEY = "{plaintext}"')
        print('    Invoke-RestMethod http://localhost:8000/v1/projects -Headers @{ "X-API-Key" = $env:HERDER_KEY }')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="herder")
    sub = parser.add_subparsers(dest="command", required=True)

    boot = sub.add_parser("bootstrap", help="create the account, workspace, default project and an API key")
    boot.add_argument("--email", default="owner@localhost")
    boot.add_argument("--project", default="default", help="name of the default project")

    args = parser.parse_args(argv)

    if args.command == "bootstrap":
        return asyncio.run(bootstrap(args.email, args.project))

    parser.error(f"unknown command {args.command!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
