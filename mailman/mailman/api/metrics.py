"""What the system has done, as numbers.

This endpoint was linked in the page nav from the day the templates were written and never
existed, so every page carried a 404 to a route that was only ever in the plan. That is the
bug this file closes, and it is worth naming because of how it survived: a link is not a
call, so nothing tested it and nothing failed.

**Three things, and each one answers a question somebody actually asks.**

`by_status` is where the work is - a queue that is filling up and a pile of `failed` are the
two operational facts this system can have, and both are one column.

`routing` is the auto-approval rate, which is the number this project exists to move. It is
counted from `status_history` rather than from `status`, because `status` forgets: an
approved document was routed to a person or past one, and by the time it says `approved`
both paths look the same. The history still holds the transition, which is the whole reason
every move is appended to it.

It counts routing *decisions*, not documents. A document that was corrected and re-validated
was routed twice, and both were real decisions made on real evidence - counting documents
would have to pick one of them and would quietly drop the other.

`evaluation` is the accuracy figure from the newest run in `evaluations/`, so the measurement
is visible from the running system rather than only in a README somebody has to be persuaded
to open. It is read from the file rather than recomputed: the harness is what produces these
numbers, and an endpoint that scored the corpus its own way would be a second implementation
free to disagree with the one in git.

Every rate here carries the counts it came from, and a rate with nothing behind it is `null`
rather than zero. That is the project's own rule - "Reporting a percentage without the count
behind it" is on the list of things it does not do - and 0/0 reported as 0% would say the
system auto-approves nothing when what happened is that it has not been asked yet.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from mailman import __version__
from mailman.api import security
from mailman.db import get_session
from mailman.models import Document
from mailman.status import ALL_STATUSES, AUTO_APPROVED, NEEDS_REVIEW

router = APIRouter(tags=["metrics"])

# `mailman/api/metrics.py` -> `mailman/api` -> `mailman` -> the project root, where the
# harness writes. Derived rather than configured: one more environment variable to get wrong
# buys nothing, and the harness has never written anywhere else.
EVALUATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "evaluations"

# Counted over the whole history of every document. Postgres-specific, like the JSONB column
# it reads - this project has one database and does not pretend otherwise.
_ROUTING_DECISIONS = text(
    """
    SELECT event->>'to' AS decision, count(*) AS n
    FROM documents, jsonb_array_elements(status_history) AS event
    WHERE event->>'to' IN (:auto, :review)
    GROUP BY 1
    """
)


def latest_evaluation() -> dict | None:
    """The headline from the newest recorded run, or None when there is not one.

    Runs are named by an ISO timestamp, so the newest is the last by filename and no file
    needs opening to find it. Anything unreadable returns None: a metrics endpoint that 500s
    because a JSON file was half-written is a monitoring endpoint that fails exactly when
    something is already wrong.
    """
    try:
        runs = sorted(EVALUATIONS_DIR.glob("*.json"))
        if not runs:
            return None
        newest = runs[-1]
        run = json.loads(newest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None

    overall = run.get("overall") or {}
    return {
        "run": newest.name,
        "label": run.get("label"),
        "recorded_at": run.get("started_at"),
        "extractor": run.get("extractor"),
        "fields_right": overall.get("right"),
        "fields_scored": overall.get("of"),
        "field_accuracy": overall.get("rate"),
        "line_items": run.get("line_items"),
        "arithmetic_breaks": run.get("arithmetic_breaks"),
    }


@router.get("/metrics", summary="Counts by status, the auto-approval rate, and the last run")
def metrics(session: Session = Depends(get_session)) -> dict:
    """Everything this system knows about its own throughput."""
    counts = dict(
        session.query(Document.status, func.count(Document.id))
        .group_by(Document.status)
        .all()
    )
    # Zero-filled over every legal status, so a status that has never happened reads as 0
    # rather than being absent. A caller should not have to know the vocabulary to notice
    # that nothing has failed.
    by_status = {status_name: int(counts.get(status_name, 0)) for status_name in ALL_STATUSES}

    decisions = dict(
        session.execute(_ROUTING_DECISIONS, {"auto": AUTO_APPROVED, "review": NEEDS_REVIEW})
        .all()
    )
    auto = int(decisions.get(AUTO_APPROVED, 0))
    to_review = int(decisions.get(NEEDS_REVIEW, 0))
    total_decisions = auto + to_review

    return {
        "version": __version__,
        "documents": sum(by_status.values()),
        "by_status": by_status,
        "routing": {
            "auto_approved": auto,
            "sent_to_review": to_review,
            "decisions": total_decisions,
            "auto_approval_rate": round(auto / total_decisions, 4) if total_decisions else None,
        },
        # Whether writing to this system currently needs the shared secret. Reported because
        # an unset secret and an unchecked secret used to look identical from outside, and
        # that is precisely how this API stayed open for four stages.
        "security": {
            "api_key": "enforced" if security.is_enforced() else "not configured",
            "writes": "require the shared secret" if security.is_enforced() else "open",
        },
        "evaluation": latest_evaluation(),
    }
