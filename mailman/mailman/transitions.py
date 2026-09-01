"""The one place a document's status changes.

Nothing else assigns to `Document.status`. Every move goes through `move()`, which checks
the transition is legal and appends to `status_history` in the same breath. That is what
makes "where is this document and how did it get there" a query rather than a guess, and it
is why an illegal transition is an exception rather than a silently accepted row.
"""

from __future__ import annotations

from datetime import datetime, timezone

from mailman.models import Document
from mailman.status import (
    APPROVED,
    AUTO_APPROVED,
    EXTRACTED,
    EXTRACTING,
    FAILED,
    NEEDS_REVIEW,
    RECEIVED,
    REJECTED,
    TERMINAL_STATUSES,
    VALIDATED,
)


class IllegalTransition(RuntimeError):
    """A move the state machine does not allow."""


# received -> failed exists for a file that cannot be prepared at all: no text layer, a
# format that is not supported yet, bytes that are not what they claim to be. That failure
# happens before extraction is ever attempted, so it needs its own edge.
LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    RECEIVED: frozenset({EXTRACTING, FAILED}),
    EXTRACTING: frozenset({EXTRACTED, FAILED}),
    EXTRACTED: frozenset({VALIDATED, FAILED}),
    VALIDATED: frozenset({AUTO_APPROVED, NEEDS_REVIEW}),
    AUTO_APPROVED: frozenset({APPROVED}),
    NEEDS_REVIEW: frozenset({APPROVED, REJECTED}),
    # Reprocessing sends a failed document back to the start. The extractions it already
    # has are not deleted - they are the record of what went wrong.
    FAILED: frozenset({RECEIVED}),
    APPROVED: frozenset(),
    REJECTED: frozenset(),
}


def move(
    document: Document,
    to_status: str,
    *,
    actor: str,
    detail: str | None = None,
) -> None:
    """Move a document to a new status, recording how and why.

    `actor` is who or what caused it - "api", "pipeline", a reviewer's name. `detail` is the
    reason, and it is what someone reads a week later when they want to know why a document
    is where it is.
    """
    from_status = document.status

    allowed = LEGAL_TRANSITIONS.get(from_status)
    if allowed is None:
        raise IllegalTransition(f"unknown status on document: {from_status!r}")
    if to_status not in allowed:
        raise IllegalTransition(
            f"{from_status!r} -> {to_status!r} is not a legal transition"
        )

    now = datetime.now(timezone.utc)
    entry = {
        "from": from_status,
        "to": to_status,
        "at": now.isoformat(),
        "actor": actor,
        "detail": detail,
    }

    # Reassigned rather than appended in place. SQLAlchemy does not track mutation inside a
    # JSONB value, so `document.status_history.append(...)` writes nothing to the database
    # and the history silently stays empty.
    document.status_history = [*(document.status_history or []), entry]
    document.status = to_status

    if to_status in TERMINAL_STATUSES or to_status == FAILED:
        document.processed_at = now
    else:
        # A document sent back for reprocessing is moving again, so it is no longer done.
        document.processed_at = None
