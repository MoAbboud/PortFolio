"""herder's command line.

- `bootstrap` creates the one account, its workspace, its default project and an API key,
  and prints the key once. There is no registration flow: there is one user, and a sign-up
  page for an audience of one would be ceremony.
- `extract` runs stage 2 over a project: chunk, extract, validate lineage, store.
- `compare` runs the same chunks through two extractors and prints both, which is the
  comparison the whole three-implementation arrangement exists to make possible.
- `derive` runs the whole loop, steps A to F, and prints what merged into what.
- `brief` prints the current brief and its compression ratio.
- `render` re-renders the brief from stored entries, with no inference.
- `resume` prints a pack ready to paste into a chat, and records the serve.
- `checkpoint` probes a served pack with the local model and scores its integrity.
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
from herder.models import BriefVersion
from herder.services.derive import current_brief, derive_project, render_project
from herder.services.serve import ServeError, resume as build_resume
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
        print(f"      model load        {run.load_ms / 1000:.1f}s")
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


async def derive(reference: str, max_chunks: int | None) -> int:
    """The whole loop. Chunk, extract, merge, tail, age, render."""
    from herder.core.embeddings import OllamaEmbedder
    from herder.core.nli import CrossEncoderNli

    settings = get_settings()
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        extractor = get_extractor()

        print(f"project     {project.name}  {project.id}")
        print(f"extractor   {extractor.name} ({extractor.model})")
        print(f"embeddings  {settings.embed_model_tag} at {settings.embed_dim} dimensions")
        print(f"nli         {settings.nli_model}, floor {settings.nli_floor}")
        print(f"similarity  {settings.similarity_threshold}")
        print("(the first run loads the models; that cost is reported separately)")
        print()

        run = await derive_project(
            session,
            project,
            extractor,
            OllamaEmbedder(),
            CrossEncoderNli(),
            target_tokens=settings.chunk_tokens,
            similarity_threshold=settings.similarity_threshold,
            nli_floor=settings.nli_floor,
            max_chunks=max_chunks,
        )

    print(f"  source            {run.source_messages} new messages, {run.source_tokens} tokens")
    print(f"  chunks            {run.chunks} ({run.chunks_skipped} skipped)")
    print(f"  candidates        {run.candidates}")
    print("  verdicts")
    print(f"    created         {run.created}")
    print(f"    duplicate       {run.duplicates}")
    print(f"    updated         {run.updated}")
    print(f"    superseded      {run.superseded}")
    print(f"    dropped         {run.dropped_removed} (matched a removed entry)")
    if run.dropped_lineage:
        print(f"    bad lineage     {run.dropped_lineage}")
    if run.below_floor:
        print(f"    below floor     {run.below_floor} (defaulted to distinct)")
    print(f"  merged away       {run.merged_away} of {run.candidates} candidates")
    if run.archived or run.promotions_suggested:
        print(f"  ageing            {run.archived} archived, {run.promotions_suggested} promotions suggested")
    print(f"  brief             v{run.brief_version}, {run.brief_tokens} tokens, {run.excluded} entries did not fit")
    if run.brief_tokens and run.source_tokens:
        print(f"  compression       {run.source_tokens / run.brief_tokens:.1f}x on this run's source")
    for error in run.errors[:3]:
        print(f"  ! {error}")
    return 0


async def brief(reference: str, version: int | None) -> int:
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        if version is None:
            # The pointer, not the highest version - an override's version is not the brief.
            found = await current_brief(session, project.id)
        else:
            found = (
                await session.execute(
                    select(BriefVersion).where(
                        BriefVersion.project_id == project.id, BriefVersion.version == version
                    )
                )
            ).scalars().first()

    if found is None:
        raise SystemExit(f"{project.name} has no brief yet. Run: python -m herder derive --project {project.name}")

    ratio = found.source_token_count / found.token_count if found.token_count else 0
    print(f"project      {project.name}")
    print(f"version      {found.version}  ({found.trigger})")
    print(f"tokens       {found.token_count} of a {found.budget_tokens} budget")
    print(f"source       {found.source_message_count} messages, {found.source_token_count} tokens")
    print(f"compression  {ratio:.1f}x")
    print(f"entries      {len(found.included_entry_ids)} included, {len(found.excluded_entry_ids)} did not fit")
    print()
    print("-" * 78)
    print(found.rendered_text)
    print("-" * 78)
    return 0


async def render(reference: str) -> int:
    """Re-render the brief from the stored entries. No inference, no ageing, nothing extracted.

    The CLI twin of `POST /v1/projects/{id}/render`, run inline rather than enqueued. Needed
    whenever the render itself changes: a stored version is immutable, so a brief rendered
    before a render fix keeps the old layout until something renders it again.
    """
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        previous = await current_brief(session, project.id)
        if previous is None:
            raise SystemExit(f"{project.name} has no brief yet. Run: python -m herder derive --project {project.name}")
        version = await render_project(session, project, "adjust")
        await session.commit()

    print(f"project      {project.name}")
    print(f"version      {previous.version} -> {version.version}")
    print(f"tokens       {previous.token_count} -> {version.token_count} of a {version.budget_tokens} budget")
    return 0


async def resume(reference: str, vendor: str, budget: int | None, quiet: bool) -> int:
    """Print a pack for pasting into a chat by hand.

    Nothing is sent. The text goes to stdout and a person decides what to do with it.
    """
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        try:
            pack = await build_resume(session, project, vendor=vendor, door="cli", budget_tokens=budget)
        except ServeError as exc:
            raise SystemExit(str(exc)) from exc

    if quiet:
        print(pack.text)
        return 0

    print(f"project      {project.name}")
    print(f"version      {pack.version}")
    print(f"vendor       {pack.vendor}")
    print(f"tokens       {pack.token_count} (brief budget {pack.budget_tokens})")
    print(f"integrity    {pack.integrity if pack.integrity is not None else 'never measured'}")
    if pack.rendered_fresh:
        print("             a fresh version was rendered for this budget")
    print(f"injection    {pack.injection_id}")
    print()
    print("-" * 78)
    print(pack.text)
    print("-" * 78)
    print()
    print("Paste that into a chat and press send yourself. Nothing was sent for you.")
    print("`--quiet` prints the pack alone, for piping to the clipboard:")
    # The same options as this run. Dropping --vendor here sent people who copied the hint to
    # the default preamble instead of the one they had just looked at.
    options = f"--project {project.name} --vendor {pack.vendor}"
    if budget is not None:
        options += f" --budget {budget}"
    print(f"    python -m herder resume {options} --quiet | clip")
    return 0


async def checkpoint(reference: str, injection: str | None) -> int:
    """Run one local-mode checkpoint inline and print every probe. Minutes, not seconds."""
    from herder.core.nli import CrossEncoderNli
    from herder.core.verify_models import LocalAnswerer, LocalProbeGenerator
    from herder.models import Injection
    from herder.services.checkpoint import CheckpointError, run_checkpoint

    settings = get_settings()
    sessionmaker = get_sessionmaker()

    async with sessionmaker() as session:
        project = await _find_project(session, reference)
        if injection is not None:
            injection_id = uuid.UUID(injection)
        else:
            # The most recent serve of this project - what `herder resume` just printed.
            injection_id = (
                await session.execute(
                    select(Injection.id)
                    .join(BriefVersion, BriefVersion.id == Injection.brief_version_id)
                    .where(BriefVersion.project_id == project.id)
                    .order_by(Injection.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if injection_id is None:
                raise SystemExit(
                    f"{project.name} has never been served. Run first: "
                    f"python -m herder resume --project {project.name}"
                )

        generator, answerer, nli = LocalProbeGenerator(), LocalAnswerer(), CrossEncoderNli()
        print(f"project     {project.name}")
        print(f"injection   {injection_id}")
        print(f"answers     {answerer.model} (local)")
        print(f"judge       {settings.nli_model}, floor {settings.nli_floor}")
        print("(a dozen model calls on a CPU - expect minutes, more if the model is cold)")
        print()
        try:
            generator.check_ready()
            nli.check_ready()
            run = await run_checkpoint(session, injection_id, generator, answerer, nli, floor=settings.nli_floor)
        except CheckpointError as exc:
            raise SystemExit(f"no checkpoint: {exc}") from exc

    for report in run.reports:
        shown = "inconclusive" if report.score is None else f"{report.score:g}"
        print(f"[{report.category:9s}] {shown}")
        print(f"    question  {report.question}")
        print(f"    expected  {report.expected_answer}")
        print(f"    answer    {report.answer or '(none)'}")
        print(f"    reason    {report.reason}")
        print()

    print(f"integrity   {run.integrity:.2f} over {run.graded} graded probes")
    for category in ("included", "excluded", "uncovered"):
        mean, count = run.by_category.get(category, (None, 0))
        wanted, available = run.requested.get(category, 0), run.available.get(category, 0)
        shown = f"{mean:.2f}" if mean is not None else "  - "
        print(f"  {category:9s} {shown}  {count} graded, {wanted} wanted, {available} to choose from")
    print(
        f"probes      {run.probes_generated} written, {run.probes_cached} cached, "
        f"{run.probes_missing} could not be written"
    )
    if run.inconclusive or run.unanswered:
        print(f"not scored  {run.inconclusive} inconclusive, {run.unanswered} unanswered")
    if run.transmission_failed or run.suggestions:
        print(f"effects     {run.transmission_failed} entries flagged transmission_failed, {run.suggestions} suggestions")
    print(f"wall clock  {run.latency_ms / 1000:.1f}s")
    print(f"checkpoint  {run.checkpoint_id}")
    for error in run.errors[:5]:
        print(f"  ! {error}")
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

    der = sub.add_parser("derive", help="stage 3: the whole loop, chunk to rendered brief")
    der.add_argument("--project", default="default", help="project name or id")
    der.add_argument("--max-chunks", type=int, default=None, help="stop after N chunks")

    br = sub.add_parser("brief", help="print the current brief")
    br.add_argument("--project", default="default", help="project name or id")
    br.add_argument("--version", type=int, default=None, help="a specific version")

    ren = sub.add_parser("render", help="re-render the brief from stored entries, no inference")
    ren.add_argument("--project", default="default", help="project name or id")

    res = sub.add_parser("resume", help="stage 5: a pack ready to paste into a chat")
    res.add_argument("--project", default="default", help="project name or id")
    res.add_argument("--vendor", default="default", choices=("default", "claude", "chatgpt", "gemini"))
    res.add_argument("--budget", type=int, default=None, help="override the brief budget for this pack")
    res.add_argument("--quiet", action="store_true", help="print the pack alone, nothing else")

    chk = sub.add_parser("checkpoint", help="stage 6: probe a served pack and score its integrity")
    chk.add_argument("--project", default="default", help="project name or id")
    chk.add_argument("--injection", default=None, help="a specific serve; default is the latest")

    args = parser.parse_args(argv)

    if args.command == "bootstrap":
        return asyncio.run(bootstrap(args.email, args.project))

    if args.command == "extract":
        return asyncio.run(extract(args.project, args.extractor, args.max_chunks))

    if args.command == "compare":
        return asyncio.run(compare(args.project, args.max_chunks))

    if args.command == "derive":
        return asyncio.run(derive(args.project, args.max_chunks))

    if args.command == "brief":
        return asyncio.run(brief(args.project, args.version))

    if args.command == "render":
        return asyncio.run(render(args.project))

    if args.command == "resume":
        return asyncio.run(resume(args.project, args.vendor, args.budget, args.quiet))

    if args.command == "checkpoint":
        return asyncio.run(checkpoint(args.project, args.injection))

    parser.error(f"unknown command {args.command!r}")
    return 2


if __name__ == "__main__":
    sys.exit(main())
