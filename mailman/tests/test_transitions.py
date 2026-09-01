"""The state machine. One function moves a document, and it records every move."""

from __future__ import annotations

import pytest

from mailman import status as st
from mailman.models import Document
from mailman.transitions import LEGAL_TRANSITIONS, IllegalTransition, move


def a_document(current: str = st.RECEIVED) -> Document:
    return Document(
        filename="x.pdf",
        storage_path="k",
        mime_type="application/pdf",
        doc_type="invoice",
        status=current,
        status_history=[],
    )


def test_a_legal_move_is_recorded_in_the_history() -> None:
    document = a_document()
    move(document, st.EXTRACTING, actor="pipeline", detail="starting")

    assert document.status == st.EXTRACTING
    assert len(document.status_history) == 1
    entry = document.status_history[0]
    assert entry["from"] == st.RECEIVED
    assert entry["to"] == st.EXTRACTING
    assert entry["actor"] == "pipeline"
    assert entry["detail"] == "starting"
    assert entry["at"]


def test_history_is_reassigned_not_mutated() -> None:
    """SQLAlchemy does not track mutation inside a JSONB value.

    An in-place append writes nothing to the database and the history silently stays empty,
    which is the kind of bug that is only found when someone needs the history.
    """
    document = a_document()
    original = document.status_history
    move(document, st.EXTRACTING, actor="pipeline")
    assert document.status_history is not original


def test_an_illegal_move_raises_rather_than_being_accepted() -> None:
    document = a_document()
    with pytest.raises(IllegalTransition):
        move(document, st.APPROVED, actor="api")
    assert document.status == st.RECEIVED
    assert document.status_history == []


def test_terminal_states_go_nowhere() -> None:
    for terminal in (st.APPROVED, st.REJECTED):
        assert LEGAL_TRANSITIONS[terminal] == frozenset()


def test_every_status_appears_in_the_transition_map() -> None:
    """A status the map does not know about would be a document nothing can move."""
    assert set(LEGAL_TRANSITIONS) == set(st.ALL_STATUSES)
    for targets in LEGAL_TRANSITIONS.values():
        assert targets <= set(st.ALL_STATUSES)


def test_an_unreadable_file_can_fail_before_extraction() -> None:
    """received -> failed. A file that cannot be prepared never reaches the extractor."""
    document = a_document()
    move(document, st.FAILED, actor="pipeline", detail="no text layer")
    assert document.status == st.FAILED
    assert document.processed_at is not None


def test_reprocessing_reopens_a_failed_document() -> None:
    document = a_document(st.FAILED)
    document.processed_at = "set"
    move(document, st.RECEIVED, actor="api", detail="reprocess")
    assert document.status == st.RECEIVED
    assert document.processed_at is None
