"""The recovery path for a document nothing is going to move on.

The hole this closes is specific and worth stating: a transient status had no way out except
the pipeline that had already died. `failed -> received` exists for reprocessing, and a
document stuck in `extracting` or `extracted` can never reach `failed` to use it, because
neither has an edge back to `received` either - `reprocess` answers 409 on both.

Both statuses are covered because both were found. `extracting` is the one the design predicted;
`extracted` is the one a running database had twenty-four of, from a pipeline that extracts and
then validates in two steps with a window in between. So the tests run over `SWEEPABLE` rather
than naming a status, and adding a third would have to add its tests here to pass.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from mailman import status as st
from mailman.models import Document
from mailman.sweeper import SWEEPABLE, entered_at, find_stuck, sweep
from mailman.transitions import LEGAL_TRANSITIONS, move

# How each transient status is reached, so a test can put a document in one the way the
# pipeline does rather than by assigning to the column.
ROUTE_TO: dict[str, tuple[str, ...]] = {
    st.EXTRACTING: (st.EXTRACTING,),
    st.EXTRACTED: (st.EXTRACTING, st.EXTRACTED),
}


def a_stuck_document(session: Session, *, status: str, age_seconds: float) -> Document:
    """A document that entered `status` however long ago and never came out.

    Carried there through the real state machine and then aged by rewriting the history entry,
    rather than inserted with the status set directly: the sweeper reads the history to decide,
    so a document whose history was never written would prove nothing.
    """
    document = Document(
        filename=f"stuck-{uuid.uuid4()}.pdf",
        storage_path=f"test/{uuid.uuid4()}.pdf",
        mime_type="application/pdf",
        status=st.RECEIVED,
        status_history=[],
    )
    session.add(document)
    session.commit()

    for step in ROUTE_TO[status]:
        move(document, step, actor="pipeline", detail="model test")

    entered = datetime.now(timezone.utc) - timedelta(seconds=age_seconds)
    document.status_history = [
        {**entry, "at": entered.isoformat()} if entry["to"] == status else entry
        for entry in document.status_history
    ]
    session.commit()
    assert document.status == status
    return document


@pytest.mark.parametrize("status", sorted(SWEEPABLE))
def test_a_document_stuck_past_the_timeout_is_failed(db_session: Session, status: str) -> None:
    document = a_stuck_document(db_session, status=status, age_seconds=3600)

    swept = sweep(db_session, older_than_seconds=900)

    assert str(document.id) in [entry["document_id"] for entry in swept]
    db_session.refresh(document)
    assert document.status == st.FAILED


@pytest.mark.parametrize("status", sorted(SWEEPABLE))
def test_the_reason_says_which_status_and_how_long(db_session: Session, status: str) -> None:
    """A status with no explanation is a mystery a week later, which is the whole reason every
    transition appends to the history. The two reasons differ because the two situations do -
    one document has nothing, the other has an extraction that was never judged."""
    document = a_stuck_document(db_session, status=status, age_seconds=3600)
    sweep(db_session, older_than_seconds=900)
    db_session.refresh(document)

    last = document.status_history[-1]
    assert last["to"] == st.FAILED
    assert last["actor"] == "sweeper"
    assert f"stuck in {status}" in last["detail"]
    assert "reprocess" in last["detail"].lower()


@pytest.mark.parametrize("status", sorted(SWEEPABLE))
def test_a_document_still_being_worked_on_is_left_alone(
    db_session: Session, status: str
) -> None:
    """The failure mode that would be worse than the bug: a sweeper that kills live work. Age
    is the whole test, because being mid-pipeline stops meaning `abandoned` the moment there
    is more than one process."""
    document = a_stuck_document(db_session, status=status, age_seconds=30)

    assert sweep(db_session, older_than_seconds=900) == []
    db_session.refresh(document)
    assert document.status == status


@pytest.mark.parametrize("status", sorted(SWEEPABLE))
def test_a_swept_document_can_be_reprocessed(db_session: Session, status: str) -> None:
    """The point of choosing `failed` rather than inventing a status: the way back already
    existed, and these were the places that could not reach it."""
    assert st.RECEIVED not in LEGAL_TRANSITIONS[status]
    assert st.RECEIVED in LEGAL_TRANSITIONS[st.FAILED]

    document = a_stuck_document(db_session, status=status, age_seconds=3600)
    sweep(db_session, older_than_seconds=900)
    db_session.refresh(document)

    move(document, st.RECEIVED, actor="api", detail="reprocess requested")
    db_session.commit()
    assert document.status == st.RECEIVED


def test_a_document_with_no_readable_start_time_is_left_alone(db_session: Session) -> None:
    """No evidence it is stuck is not evidence it is stuck."""
    document = a_stuck_document(db_session, status=st.EXTRACTING, age_seconds=3600)
    document.status_history = [
        {**entry, "at": "not a timestamp"} if entry["to"] == st.EXTRACTING else entry
        for entry in document.status_history
    ]
    db_session.commit()

    assert find_stuck(db_session, older_than_seconds=900) == []


def test_a_document_waiting_for_a_person_is_not_stuck(db_session: Session) -> None:
    """A document in the queue is waiting for a reviewer, however long it has been there.
    Only the statuses nothing can move a document out of are swept."""
    from tests.test_promotion import a_judged_document

    document = a_judged_document(db_session)
    before = document.status

    sweep(db_session, older_than_seconds=0)

    db_session.refresh(document)
    assert document.status == before


def test_the_sweeper_only_moves_where_the_state_machine_allows() -> None:
    """`validated` is transient too and has no `failed` edge, so it cannot be swept - closing
    that one means changing the state machine, which is a design decision rather than a
    cleanup task. This is the assertion that would fail if it were added to SWEEPABLE
    anyway."""
    assert all(st.FAILED in LEGAL_TRANSITIONS[status] for status in SWEEPABLE)
    assert st.FAILED not in LEGAL_TRANSITIONS[st.VALIDATED]
    assert st.VALIDATED not in SWEEPABLE


def test_a_sweep_with_nothing_to_do_writes_nothing(db_session: Session) -> None:
    assert sweep(db_session, older_than_seconds=999_999) == []


@pytest.mark.parametrize(
    "history",
    [
        [],
        [{"to": "received", "at": "2026-09-07T10:00:00+00:00"}],
        [{"to": "extracting"}],
        [{"to": "extracting", "at": "nonsense"}],
    ],
)
def test_unreadable_histories_yield_no_start_time(history: list) -> None:
    """No database needed: the parsing is where a stray value would crash a sweep that was
    supposed to be tidying up after one."""
    document = Document(filename="x", storage_path="x", mime_type="application/pdf")
    document.status_history = history
    assert entered_at(document, st.EXTRACTING) is None


def test_a_naive_timestamp_is_read_as_utc() -> None:
    """Everything `move` writes is timezone-aware, so a naive value is from an older row.
    Reading it as UTC beats raising, because the alternative is one bad row stopping the sweep
    for every other document."""
    document = Document(filename="x", storage_path="x", mime_type="application/pdf")
    document.status_history = [{"to": st.EXTRACTING, "at": "2026-09-07T10:00:00"}]

    at = entered_at(document, st.EXTRACTING)
    assert at is not None and at.tzinfo is not None


def test_the_latest_entry_into_a_status_is_the_one_that_counts() -> None:
    """A reprocessed document has been in `extracting` twice, and the first time is not how
    long it has been stuck now."""
    document = Document(filename="x", storage_path="x", mime_type="application/pdf")
    document.status_history = [
        {"to": st.EXTRACTING, "at": "2026-09-01T10:00:00+00:00"},
        {"to": st.FAILED, "at": "2026-09-01T10:05:00+00:00"},
        {"to": st.RECEIVED, "at": "2026-09-07T09:00:00+00:00"},
        {"to": st.EXTRACTING, "at": "2026-09-07T10:00:00+00:00"},
    ]

    at = entered_at(document, st.EXTRACTING)
    assert at == datetime(2026, 9, 7, 10, 0, tzinfo=timezone.utc)
