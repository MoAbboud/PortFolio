"""herder's command line.

- `bootstrap` creates the one account, its workspace, its default project and an API key,
  and prints the key once. There is no registration flow: there is one user, and a sign-up
  page for an audience of one would be ceremony.
- `extract` runs stage 2 over a project: chunk, extract, validate lineage, store.
- `compare` runs the same chunks through two extractors and prints both, which is the
  comparison the whole three-implementation arrangement exists to make possible.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid

from sqlalchemy import select

from herder.core.config import get_settings
from herder.core.db import get_sessionmaker
from herder.core.ids import uuid7
from herder.core.security import generate_key
from herder.extractors import get_extractor
from herder.models import ApiKey, Project, User, Workspace
from herder.services.extraction import ExtractionRun, extract_project, load_chunks


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


async def _find_project(session, reference: str) -> Project:
    """Accept a project id or a name, because typing a UUID from a terminal is miserable."""
    try:
        found = await session.get(Project, uuid.UUID(reference))
        if found is not None:
            return found
    except ValueError:
        pass

    found = (await session.execute(select(Project).where(Project.name == reference))).scalars().first()
    if found is None:
        names = (await session.execute(select(Project.name))).scalars().all()
        raise SystemExit(f"no project {reference!r}. Known: {', '.join(names) or 'none'}")
    return found


def _report(run: ExtractionRun, label: str) -> None:
    print()
    print(f"  {label}")
    print(f"    chunks              {run.chunks} ({run.chunks_skipped} skipped)")
    print(f"    source tokens       {run.source_tokens}")
    print(f"    candidates          {run.candidates}")
    print(f"    stored              {run.stored}")
    if run.dropped_invented_lineage or run.dropped_empty_lineage:
        print(
            f"    dropped             {run.dropped_invented_lineage} invented lineage, "
            f"{run.dropped_empty_lineage} empty lineage"
        )
    print(f"    wall clock          {run.latency_ms / 1000:.1f}s")
    if run.prompt_ms or run.generation_ms:
        # The split stage 2 exists to measure. On a CPU, prompt processing is expected to
        # dominate - and that is what makes chunk size the biggest lever on a derive.
        print(f"      prompt eval       {run.prompt_ms / 1000:.1f}s")
        print(f"      generation        {run.generation_ms / 1000:.1f}s")
        print(f"    model tokens        {run.input_tokens} in, {run.output_tokens} out")
    if run.chunks:
        print(f"    per chunk           {run.latency_ms / run.chunks / 1000:.1f}s")
    for error in run.errors[:3]:
        print(f"    ! {error}")


async def extract(reference: str, extractor_name: str | None, max_chunks: int | None) -> int:
    settings = get_settings()
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        extractor = get_extractor(extractor_name)

        print(f"project    {project.name}  {project.id}")
        print(f"extractor  {extractor.name}  ({extractor.model})")
        print(f"chunking   target {settings.chunk_tokens} tokens")

        run = await extract_project(
            session, project, extractor, target_tokens=settings.chunk_tokens, max_chunks=max_chunks
        )
        _report(run, f"{extractor.name} run")

    print()
    print("Put the wall-clock figures in NOTES.md. That number is what stage 2 exists for.")
    return 0


async def compare(reference: str, max_chunks: int | None) -> int:
    """The same chunks through both extractors, side by side.

    This is the comparison the three-implementation arrangement exists to make possible, and
    it is the one `mailman` got its most interesting result from.
    """
    settings = get_settings()
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        chunks = await load_chunks(session, project, settings.chunk_tokens)
        if max_chunks is not None:
            chunks = chunks[:max_chunks]

        print(f"project  {project.name}")
        print(f"chunks   {len(chunks)}  ({sum(c.token_count for c in chunks)} source tokens)")

        for name in ("heuristic", "local"):
            try:
                extractor = get_extractor(name)
                extractor.check_ready()
            except Exception as exc:
                print()
                print(f"  {name}: unavailable - {exc}")
                continue

            titles: list[str] = []
            produced = []
            total_ms = prompt_ms = gen_ms = 0
            for chunk in chunks:
                outcome = await asyncio.to_thread(extractor.extract, chunk, titles)
                total_ms += outcome.latency_ms
                prompt_ms += outcome.prompt_ms
                gen_ms += outcome.generation_ms
                if outcome.failed:
                    print(f"  {name}: FAILED - {outcome.error}")
                    break
                produced.extend(outcome.candidates)
                titles.extend(c.title for c in outcome.candidates)

            print()
            print(f"  {name}  ({extractor.model})  {total_ms / 1000:.1f}s", end="")
            if prompt_ms or gen_ms:
                print(f"  [prompt {prompt_ms / 1000:.1f}s, generation {gen_ms / 1000:.1f}s]", end="")
            print(f"  {len(produced)} candidates")
            for candidate in produced:
                print(f"    [{candidate.kind:11s} {candidate.layer:7s} {candidate.confidence:.2f}] {candidate.title}")

    print()
    print("Nothing was stored. This reads only.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="herder")
    sub = parser.add_subparsers(dest="command", required=True)

    boot = sub.add_parser("bootstrap", help="create the account, workspace, default project and an API key")
    boot.add_argument("--email", default="owner@localhost")
    boot.add_argument("--project", default="default", help="name of the default project")

    ex = sub.add_parser("extract", help="stage 2: chunk, extract, validate lineage, store")
    ex.add_argument("--project", default="default", help="project name or id")
    ex.add_argument("--extractor", default=None, choices=("heuristic", "local", "trained"))
    ex.add_argument("--max-chunks", type=int, default=None, help="stop after N chunks")

    cmp_ = sub.add_parser("compare", help="run the same chunks through both extractors, storing nothing")
    cmp_.add_argument("--project", default="default", help="project name or id")
    cmp_.add_argument("--max-chunks", type=int, default=1)

    args = parser.parse_args(argv)

    if args.command == "bootstrap":
        return asyncio.run(bootstrap(args.email, args.project))

    if args.command == "extract":
        return asyncio.run(extract(args.project, args.extractor, args.max_chunks))

    if args.command == "compare":
        return asyncio.run(compare(args.project, args.max_chunks))

    parser.error(f"unknown command {args.command!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
