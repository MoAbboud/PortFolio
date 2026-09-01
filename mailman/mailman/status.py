"""Document statuses.

The status column drives the whole system, so the legal values live in one place and the
database enforces them with a CHECK constraint. The transition rules themselves arrive in
stage 1, with the single function that is allowed to move a document.

    received -> extracting -> extracted -> validated -> auto_approved | needs_review
                                                     -> approved | rejected
    extracting -> failed

`failed` is the system's own fault: a corrupt file, a provider timeout, a response that
would not parse. `rejected` is a person deciding this should not become a record. They are
different statuses because collapsing them would hide operational problems inside business
outcomes.
"""

from __future__ import annotations

RECEIVED = "received"
EXTRACTING = "extracting"
EXTRACTED = "extracted"
VALIDATED = "validated"
AUTO_APPROVED = "auto_approved"
NEEDS_REVIEW = "needs_review"
APPROVED = "approved"
REJECTED = "rejected"
FAILED = "failed"

ALL_STATUSES: tuple[str, ...] = (
    RECEIVED,
    EXTRACTING,
    EXTRACTED,
    VALIDATED,
    AUTO_APPROVED,
    NEEDS_REVIEW,
    APPROVED,
    REJECTED,
    FAILED,
)

# Terminal states. A document here is finished and nothing further moves it.
TERMINAL_STATUSES: frozenset[str] = frozenset({APPROVED, REJECTED})

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
ALL_SEVERITIES: tuple[str, ...] = (SEVERITY_ERROR, SEVERITY_WARNING)
