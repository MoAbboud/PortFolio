"""Getting a document out of a transient status when nothing is going to move it on.

Extraction runs in the request process with no broker, which is a decision the plan makes and
defends: `POST /documents` returns immediately, `status` is how a caller finds out, and a
broker earns its place when a retry has to survive a restart. What that decision did not come
with is a way back. If the process dies partway through, the document stops in whichever
transient status it had reached and nothing moves it again.

**Two statuses, not one.** The obvious one is `extracting`, where a document that was being
read when the process died has nothing to show for it. The one found by looking was
`extracted`: the pipeline extracts and then validates, so a death between those two steps
leaves a document that has an extraction and never got judged. Both are dead ends in the same
way -

    extracting  -> extracted, failed        no route back to received
    extracted   -> validated, failed        no route back to received

so `reprocess` answers `409 'extracted' -> 'received' is not a legal transition` on either.
`failed -> received` exists for exactly this shape of problem, and neither status could reach
`failed` to use it.

That is the whole design: move to `failed`, with a reason that says what happened, and let the
reprocess path that already exists take it from there. No new status, no new edge, no column.

**`validated` is the one this does not fix.** It is transient too and it has no `failed` edge,
so a document stopped there would need the state machine changed rather than swept. The
documentation says nothing is ever found sitting in it, because `validate_document` moves
through it to one side or the other inside a single call - a much narrower window than the two
this file covers. Adding an edge to close it is a design decision, not a cleanup task.

**Age, not presence.** The tempting rule at startup is "anything mid-pipeline is dead, because
this process is the only thing that runs the pipeline and it has just started". That is true of
one process and false of two, and the second one is a scaling decision somebody makes later
without reading this file. Age is the signal that stays correct: extraction and validation take
milliseconds, so a document that has been mid-pipeline for a quarter of an hour is not slow, it
is gone.

**Where it runs.** At startup, so a crash and restart cleans up after itself, and from the
command line - `python -m mailman.sweeper` - so it can be put on whatever schedule the host
offers. Neither is a broker and neither pretends to be.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from mailman.config import settings
from mailman.models import Document
from mailman.status import EXTRACTED, EXTRACTING, FAILED
from mailman.transitions import LEGAL_TRANSITIONS, move

log = logging.getLogger(__name__)

# The transient statuses a document can be abandoned in, and what to say about each. The
# wording differs because the two situations differ for whoever reads the history later: one
# document has nothing, the other has an extraction that was never judged.
SWEEPABLE: dict[str, str] = {
    EXTRACTING: (
        "stuck in extracting for {age}s with nothing to show for it - whatever started the "
        "extraction did not finish it, and nothing is still working on it. Reprocess to try "
        "again"
    ),
    EXTRACTED: (
        "stuck in extracted for {age}s - the document was extracted and then never validated, "
        "which is what a process dying between the two steps leaves behind. The extraction is "
        "kept; reprocess to run it through the rules"
    ),
}

# The sweeper can only move a document somewhere the state machine already allows. Asserted
# here rather than discovered as an IllegalTransition in production, and it is what would fail
# first if `validated` were ever added to SWEEPABLE without giving it an edge.
assert all(FAILED in LEGAL_TRANSITIONS[status] for status in SWEEPABLE)


def entered_at(document: Document, status: str) -> datetime | None:
    """When this document last entered `status`, from its own history.

    Read from `status_history` rather than from a column, because the history is already the
    record of when every transition happened and a second copy of that fact is a second thing
    that can disagree with it. `uploaded_at` would be the wrong answer anyway: a reprocessed
    document was uploaded days before it entered the pipeline again.
    """
    for entry in reversed(document.status_history or []):
        if entry.get("to") != status:
            continue
        raw = entry.get("at")
        if not raw:
            return None
        try:
            at = datetime.fromisoformat(raw)
        except ValueError:
            return None
        # Everything `move` writes is timezone-aware. A naive value would be from an older
        # row, and it is read as UTC rather than crashing the sweep over one document.
        return at if at.tzinfo else at.replace(tzinfo=timezone.utc)
    return None


def find_stuck(
    session: Session,
    *,
    older_than_seconds: float,
    now: datetime | None = None,
) -> list[tuple[Document, datetime]]:
    """Documents that have been mid-pipeline longer than they are allowed to be.

    The age test is done in Python rather than as jsonb date arithmetic in the query. The set
    being filtered is every document currently in a transient status - the ones being
    processed right now, a handful at most, and the status column is indexed. A clever query
    here would buy nothing and would have to be read by somebody one day.
    """
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=older_than_seconds)

    stuck = []
    for document in (
        session.query(Document).filter(Document.status.in_(sorted(SWEEPABLE))).all()
    ):
        entered = entered_at(document, document.status)
        # No readable timestamp means no evidence it is stuck, and it is left alone
        # deliberately: the sweeper killing live work is worse than a stuck document
        # surviving one pass.
        if entered is not None and entered < cutoff:
            stuck.append((document, entered))
    return stuck


def sweep(
    session: Session,
    *,
    older_than_seconds: float | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Move every stuck document to `failed`, and return what was moved.

    One commit for the sweep rather than one per document: they are all being failed for the
    same reason at the same moment, and a half-applied sweep is a state nobody would think to
    look for.
    """
    older_than_seconds = (
        settings.stuck_document_seconds if older_than_seconds is None else older_than_seconds
    )
    now = now or datetime.now(timezone.utc)

    swept = []
    for document, entered in find_stuck(session, older_than_seconds=older_than_seconds, now=now):
        was = document.status
        age = int((now - entered).total_seconds())
        move(document, FAILED, actor="sweeper", detail=SWEEPABLE[was].format(age=age))
        swept.append(
            {
                "document_id": str(document.id),
                "filename": document.filename,
                "was": was,
                "age_seconds": age,
            }
        )

    if swept:
        session.commit()
        log.warning("sweeper failed %d document(s) stuck mid-pipeline", len(swept))
    return swept


def sweep_quietly() -> list[dict]:
    """Run a sweep on its own session, surviving a database that is not there.

    This is the startup path. An application that refuses to boot because a cleanup task could
    not reach the database is a worse outage than the documents it meant to tidy, and
    `/health` already reports the database honestly.
    """
    from sqlalchemy.exc import SQLAlchemyError

    from mailman.db import SessionLocal

    session = SessionLocal()
    try:
        return sweep(session)
    except SQLAlchemyError as exc:
        log.warning("startup sweep skipped: %s", type(exc).__name__)
        return []
    finally:
        session.close()


def main(argv: list[str] | None = None) -> int:
    """`python -m mailman.sweeper` - one pass, printed."""
    import argparse

    from mailman.db import SessionLocal

    parser = argparse.ArgumentParser(
        description="Fail documents abandoned in a transient status."
    )
    parser.add_argument(
        "--older-than",
        type=float,
        default=None,
        help="seconds mid-pipeline before a document is called stuck "
        f"(default {settings.stuck_document_seconds:g})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be failed and change nothing",
    )
    args = parser.parse_args(argv)

    older_than = (
        args.older_than if args.older_than is not None else settings.stuck_document_seconds
    )
    session = SessionLocal()
    try:
        if args.dry_run:
            stuck = find_stuck(session, older_than_seconds=older_than)
            for document, _ in stuck:
                print(f"would fail  {document.id}  {document.status:11} {document.filename}")
            print(f"{len(stuck)} document(s) stuck longer than {older_than:g}s")
            return 0

        swept = sweep(session, older_than_seconds=older_than)
        for entry in swept:
            print(
                f"failed  {entry['document_id']}  {entry['was']:11} "
                f"{entry['filename']}  after {entry['age_seconds']}s"
            )
        print(f"{len(swept)} document(s) swept")
        return 0
    finally:
        session.close()


if __name__ == "__main__":
    raise SystemExit(main())
