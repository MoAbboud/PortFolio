"""Check what happened to the planted cases.

The manifest says where each hard case was planted. This goes and looks for evidence that
the pipeline handled it - or did not. It reports; the judgement goes in NOTES.md by hand.

Not ground truth. A planted `rejection` says "the assistant proposed X here and the user
declined"; the check is whether X ended up in the memory, which it must not have. A planted
`restatement` says "this repeats an earlier claim"; the check is whether entry count grew.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://herder:herder@localhost:5432/herder")

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from herder.models import Entry, EntryRevision, Project  # noqa: E402

# Phrases that only ever appear in an assistant PROPOSAL. If one of these reaches an entry,
# the extractor recorded something the user explicitly declined.
PROPOSAL_MARKERS = [
    "Redis queue in front of the worker",
    "materialised view",
    "shard the database by workspace",
    "cache the rendered brief",
    "own service with its own deploy",
    "denormalised summary column",
    "proper broker with dead-letter",
    "second embedding model",
    "rolling window of the last fifty",
    "object storage and serve it from a CDN",
]

# A content-free rejection. Any of these as an entry is pure noise in a brief.
EMPTY_MARKERS = [
    "do not want that either",
    "not that one either",
    "a no from me as well",
    "would rather not, thanks",
    "Not that either",
    "same answer",
    "also out",
    "Same reason as before",
    "that is a service I would have to explain",
]


async def main(prefix: str) -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    maker = async_sessionmaker(engine, expire_on_commit=False)
    manifest = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))

    totals = {
        "projects": 0,
        "entries": 0,
        "proposal_leaks": 0,
        "empty_entries": 0,
        "reversals_planted": 0,
        "supersedes": 0,
        "code_fragments": 0,
    }
    examples: dict[str, list[str]] = {"proposal": [], "empty": [], "code": []}

    async with maker() as session:
        for stem, meta in manifest.items():
            name = f"{prefix}{stem}"
            project = (
                await session.execute(select(Project).where(Project.name == name))
            ).scalars().first()
            if project is None:
                continue

            rows = (
                await session.execute(
                    select(Entry, EntryRevision.title, EntryRevision.text_)
                    .join(
                        EntryRevision,
                        (EntryRevision.entry_id == Entry.id)
                        & (EntryRevision.revision == Entry.current_revision),
                    )
                    .where(Entry.project_id == project.id, Entry.kind != "tail")
                )
            ).all()

            totals["projects"] += 1
            live = [r for r in rows if r[0].status in ("active", "pinned")]
            totals["entries"] += len(live)
            totals["supersedes"] += sum(1 for r in rows if r[0].status == "superseded")
            totals["reversals_planted"] += sum(1 for p in meta["planted"] if p["kind"] == "reversal")

            for entry, title, text in live:
                blob = f"{title} {text}"
                for marker in PROPOSAL_MARKERS:
                    if marker.lower() in blob.lower():
                        totals["proposal_leaks"] += 1
                        if len(examples["proposal"]) < 4:
                            examples["proposal"].append(f"{stem}: {title[:76]}")
                        break
                for marker in EMPTY_MARKERS:
                    if marker.lower() in blob.lower():
                        totals["empty_entries"] += 1
                        if len(examples["empty"]) < 4:
                            examples["empty"].append(f"{stem}: {title[:76]}")
                        break
                if "```" in text or text.strip().startswith(("def ", "select ", "services:")):
                    totals["code_fragments"] += 1
                    if len(examples["code"]) < 3:
                        examples["code"].append(f"{stem}: {title[:76]}")

    await engine.dispose()

    print(f"=== planted-case check for {prefix}* ===")
    print(f"  projects examined        {totals['projects']}")
    print(f"  live entries             {totals['entries']}")
    print(f"  superseded entries       {totals['supersedes']}")
    print()
    print(f"  assistant proposals that leaked into memory   {totals['proposal_leaks']}   (must be 0)")
    for e in examples["proposal"]:
        print(f"      {e}")
    print(f"  content-free rejections stored as entries     {totals['empty_entries']}   (must be 0)")
    for e in examples["empty"]:
        print(f"      {e}")
    print(f"  entries whose text is code                    {totals['code_fragments']}")
    for e in examples["code"]:
        print(f"      {e}")
    print()
    print(f"  reversals planted in the corpus               {totals['reversals_planted']}")
    print("      (a reversal should supersede the decision it reverses; the supersede count")
    print("       above is dominated by false supersedes, so this needs reading by hand)")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "s4-h-"))
