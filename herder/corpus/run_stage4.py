"""Run the stage 4 corpus through the whole loop, both extractors, and report.

Stage 4 exists to break the pipeline and produce a written failure list, so this reports
numbers rather than asserting them. Nothing here passes or fails - it measures, and the
judgement goes in NOTES.md by hand.

The stop-and-fix check is the one to read first: **entry count against source tokens**. A
linear relationship means the merge step is not working and the compaction claim has failed,
and it fails with no error message because the brief still renders, it just drops more every
time.

Resumable: a project that already has a brief is skipped, so a slow `local` run can be
interrupted and continued.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://herder:herder@localhost:5432/herder")

from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from herder.core.config import get_settings  # noqa: E402
from herder.core.embeddings import OllamaEmbedder  # noqa: E402
from herder.core.ids import uuid7  # noqa: E402
from herder.core.nli import CrossEncoderNli  # noqa: E402
from herder.core.tokens import count_tokens  # noqa: E402
from herder.extractors import get_extractor  # noqa: E402
from herder.models import BriefVersion, Entry, ModelCall, Project  # noqa: E402
from herder.services.derive import derive_project  # noqa: E402
from herder.services.ingest import ingest_paste  # noqa: E402

RESULTS = HERE / "stage4-results.json"


async def one(session, workspace_id, extractor_name: str, path: Path, embedder, nli) -> dict:
    settings = get_settings()
    project_name = f"s4-{extractor_name[0]}-{path.stem}"

    project = (
        await session.execute(select(Project).where(Project.name == project_name))
    ).scalars().first()

    if project is None:
        project = Project(id=uuid7(), workspace_id=workspace_id, name=project_name)
        session.add(project)
        await session.commit()

    already = (
        await session.execute(
            select(func.count()).select_from(BriefVersion).where(BriefVersion.project_id == project.id)
        )
    ).scalar_one()
    if already:
        print(f"  {project_name:34s} already derived, skipping")
        return {}

    text = path.read_text(encoding="utf-8")
    ingested = await ingest_paste(
        session, workspace_id, text=text, vendor="manual", project_id=project.id
    )

    started = time.perf_counter()
    run = await derive_project(
        session,
        project,
        get_extractor(extractor_name),
        embedder,
        nli,
        target_tokens=settings.chunk_tokens,
        similarity_threshold=settings.similarity_threshold,
        nli_floor=settings.nli_floor,
    )
    wall = time.perf_counter() - started

    version = (
        await session.execute(
            select(BriefVersion)
            .where(BriefVersion.project_id == project.id)
            .order_by(BriefVersion.version.desc())
            .limit(1)
        )
    ).scalars().first()

    live = (
        await session.execute(
            select(func.count())
            .select_from(Entry)
            .where(
                Entry.project_id == project.id,
                Entry.kind != "tail",
                Entry.status.in_(("active", "pinned")),
            )
        )
    ).scalar_one()

    timing = (
        await session.execute(
            select(
                func.coalesce(func.sum(ModelCall.load_ms), 0),
                func.coalesce(func.sum(ModelCall.prompt_ms), 0),
                func.coalesce(func.sum(ModelCall.generation_ms), 0),
                func.count(),
            ).where(ModelCall.implementation == extractor_name)
        )
    ).one()

    record = {
        "project": project_name,
        "extractor": extractor_name,
        "transcript": path.stem,
        "source_tokens": ingested.tokens,
        "messages": ingested.accepted,
        "duplicates_at_ingest": ingested.duplicates,
        "chunks": run.chunks,
        "chunks_skipped": run.chunks_skipped,
        "candidates": run.candidates,
        "created": run.created,
        "duplicates": run.duplicates,
        "updated": run.updated,
        "superseded": run.superseded,
        "dropped_removed": run.dropped_removed,
        "dropped_lineage": run.dropped_lineage,
        "below_floor": run.below_floor,
        "live_entries": live,
        "brief_tokens": version.token_count if version else 0,
        "brief_excluded": len(version.excluded_entry_ids) if version else 0,
        "compression": round(ingested.tokens / version.token_count, 2) if version and version.token_count else 0,
        "wall_seconds": round(wall, 1),
        "cumulative_model_calls": timing[3],
    }
    print(
        f"  {project_name:34s} {record['source_tokens']:6,d} src -> "
        f"{record['candidates']:3d} cand, {record['created']:3d} new, "
        f"{record['live_entries']:3d} live, {record['brief_tokens']:5,d} brief, "
        f"{record['compression']:5.1f}x, {record['wall_seconds']:6.1f}s"
    )
    return record


async def main(extractors: list[str]) -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)

    files = sorted(HERE.glob("*.txt"))
    if not files:
        raise SystemExit("no transcripts; run corpus/generate.py first")

    results = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else []
    done = {(r["project"]) for r in results}

    # Loaded once and reused across every transcript, so the model-load cost is paid once
    # rather than ten times. That cost was measured at stage 2 as 121 seconds.
    embedder = OllamaEmbedder()
    nli = CrossEncoderNli()

    async with maker() as session:
        workspace_id = (
            await session.execute(select(Project.workspace_id).where(Project.is_default.is_(True)))
        ).scalars().first()
        if workspace_id is None:
            raise SystemExit("no default project; run `python -m herder bootstrap`")

        for extractor_name in extractors:
            print(f"\n=== {extractor_name} ===")
            for path in files:
                if f"s4-{extractor_name[0]}-{path.stem}" in done:
                    print(f"  {path.stem:34s} already recorded, skipping")
                    continue
                record = await one(session, workspace_id, extractor_name, path, embedder, nli)
                if record:
                    results.append(record)
                    RESULTS.write_text(json.dumps(results, indent=2), encoding="utf-8")

    await engine.dispose()
    print(f"\nwrote {RESULTS}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--extractors", default="heuristic", help="comma separated")
    args = parser.parse_args()
    asyncio.run(main([e.strip() for e in args.extractors.split(",") if e.strip()]))
