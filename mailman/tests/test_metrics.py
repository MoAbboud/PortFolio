"""`GET /metrics`, which was linked from every page for three stages and never existed.

The tests are written as deltas rather than as absolute counts. These run against a real
database that already has rows in it - a developer's uploads, whatever the last demo left
behind - so an assertion that the queue holds exactly one document would be testing the state
of somebody's machine. What can be asserted is that processing one more document moves the
numbers by one, which is the actual claim the endpoint makes.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from mailman import status as st
from mailman.api.metrics import EVALUATIONS_DIR, latest_evaluation
from mailman.db import get_session
from mailman.main import app
from mailman.status import ALL_STATUSES
from tests.test_promotion import a_judged_document


@pytest.fixture()
def client(db_session: Session):
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_the_link_in_the_page_nav_now_goes_somewhere(client: TestClient) -> None:
    """The bug, stated as a test. Every page carried this link to a route that was only ever
    in the plan, and a link is not a call, so nothing failed - it just 404'd at whoever
    clicked it."""
    assert client.get("/metrics").status_code == 200

    page = client.get("/").text
    assert 'href="/metrics"' in page


def test_every_status_is_reported_even_when_it_has_never_happened(client: TestClient) -> None:
    """Zero-filled, so a caller does not have to know the vocabulary to notice that nothing
    has failed. An absent key and a zero read very differently at three in the morning."""
    by_status = client.get("/metrics").json()["by_status"]

    assert set(by_status) == set(ALL_STATUSES)
    assert all(isinstance(count, int) for count in by_status.values())


def test_a_processed_document_moves_the_counts(client: TestClient, db_session: Session) -> None:
    before = client.get("/metrics").json()
    document = a_judged_document(db_session)
    after = client.get("/metrics").json()

    assert after["documents"] == before["documents"] + 1
    assert after["by_status"][document.status] == before["by_status"][document.status] + 1


def test_routing_is_counted_from_the_history_not_the_status(
    client: TestClient, db_session: Session
) -> None:
    """`status` forgets. By the time a document says `approved`, the routing decision that
    put it there - straight through, or in front of a person - is gone from the column and
    still in the history. That is what the history is for."""
    from mailman.promotion import promote

    document = a_judged_document(db_session)
    assert document.status == st.AUTO_APPROVED
    before = client.get("/metrics").json()["routing"]

    promote(db_session, document.id, actor="test")
    db_session.refresh(document)
    assert document.status == st.APPROVED

    after = client.get("/metrics").json()["routing"]
    assert after["auto_approved"] == before["auto_approved"]
    assert after["decisions"] == before["decisions"]


def test_an_auto_approval_moves_the_rate_and_carries_its_counts(
    client: TestClient, db_session: Session
) -> None:
    before = client.get("/metrics").json()["routing"]
    a_judged_document(db_session)
    after = client.get("/metrics").json()["routing"]

    assert after["auto_approved"] == before["auto_approved"] + 1
    assert after["decisions"] == before["decisions"] + 1
    assert after["auto_approval_rate"] == round(after["auto_approved"] / after["decisions"], 4)


def test_a_correction_is_a_second_routing_decision(
    client: TestClient, db_session: Session
) -> None:
    """Decisions, not documents. A corrected document was routed twice on two different sets
    of evidence, and counting documents would have to pick one and silently drop the other."""
    from mailman.promotion import apply_corrections

    document = a_judged_document(db_session)
    before = client.get("/metrics").json()["routing"]

    apply_corrections(db_session, document.id, {"total": "999.00"})
    db_session.refresh(document)
    assert document.status == st.NEEDS_REVIEW

    after = client.get("/metrics").json()["routing"]
    assert after["sent_to_review"] == before["sent_to_review"] + 1
    assert after["decisions"] == before["decisions"] + 1


def test_a_rate_with_nothing_behind_it_is_null_rather_than_zero(monkeypatch) -> None:
    """The project's own rule: no percentage without the count behind it. 0/0 reported as 0%
    would say the system auto-approves nothing, when what happened is that nobody has asked
    it to do anything yet."""
    from mailman.api import metrics as metrics_module

    class NoDecisions:
        def query(self, *args, **kwargs):
            return self

        def group_by(self, *args, **kwargs):
            return self

        def all(self):
            return []

        def execute(self, *args, **kwargs):
            return self

    payload = metrics_module.metrics(session=NoDecisions())
    assert payload["routing"]["decisions"] == 0
    assert payload["routing"]["auto_approval_rate"] is None


def test_the_accuracy_figure_comes_from_the_recorded_run(client: TestClient) -> None:
    """Read from `evaluations/` rather than recomputed. The harness is what produces these
    numbers, and an endpoint that scored the corpus its own way would be a second
    implementation free to disagree with the one in git."""
    newest = sorted(EVALUATIONS_DIR.glob("*.json"))[-1]
    recorded = json.loads(newest.read_text(encoding="utf-8"))

    reported = client.get("/metrics").json()["evaluation"]

    assert reported["run"] == newest.name
    assert reported["label"] == recorded["label"]
    assert reported["field_accuracy"] == recorded["overall"]["rate"]
    assert reported["fields_right"] == recorded["overall"]["right"]
    assert reported["fields_scored"] == recorded["overall"]["of"]


def test_an_unreadable_run_does_not_take_the_endpoint_down(monkeypatch, tmp_path) -> None:
    """A metrics endpoint that 500s because a JSON file was half-written is a monitoring
    endpoint that fails exactly when something is already wrong."""
    from mailman.api import metrics as metrics_module

    broken = tmp_path / "20260101T000000-broken.json"
    broken.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(metrics_module, "EVALUATIONS_DIR", tmp_path)

    assert metrics_module.latest_evaluation() is None


def test_no_runs_at_all_reports_null_rather_than_failing(monkeypatch, tmp_path) -> None:
    from mailman.api import metrics as metrics_module

    monkeypatch.setattr(metrics_module, "EVALUATIONS_DIR", tmp_path)
    assert metrics_module.latest_evaluation() is None
