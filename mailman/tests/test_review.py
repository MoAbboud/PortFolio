"""Stage 7: the review queue, driven the way a person drives it.

Stage 7's stated end is "open a browser, see the queue, fix a field, approve, and the invoice
is in the database". These tests are that sentence, through the real HTTP routes and the real
templates - not through the functions underneath, because the thing most likely to be broken
in a server-rendered page is the wiring between them.
"""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from mailman import status as st
from mailman.db import get_session
from mailman.main import app
from mailman.models import Document, Invoice
from mailman.promotion import apply_corrections
from tests.test_promotion import a_judged_document


@pytest.fixture()
def client(db_session: Session):
    """The app, talking to the test's transaction rather than its own session.

    Without the override the routes open their own connection, commit outside the test's
    savepoint, and leave rows behind - and the assertions read a different database from the
    one the request wrote to.
    """
    app.dependency_overrides[get_session] = lambda: db_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def a_queued_document(session: Session) -> Document:
    """A document sitting in the queue, put there the way a real one gets there.

    By breaking its total, so the arithmetic rule objects. Every corpus document passes every
    rule, which is the correct behaviour and means the queue has to be fed deliberately.
    """
    document = a_judged_document(session)
    apply_corrections(session, document.id, {"total": "999.00"})
    session.refresh(document)
    assert document.status == st.NEEDS_REVIEW
    return document


def test_the_front_door_is_the_queue_not_the_api_docs(client: TestClient) -> None:
    """It redirected to /docs before there was a queue. A visitor should land on the thing
    the system does, not on its API reference."""
    response = client.get("/")
    assert response.status_code == 200
    assert "Review queue" in response.text


def test_an_empty_queue_says_why_rather_than_looking_broken(
    client: TestClient, db_session: Session
) -> None:
    """The expected state on the corpus is an empty queue, and an empty page reads as a bug.

    This is the one piece of copy in the interface that earns its place before the styling
    gate lifts: it is the difference between "this works" and "this is broken".
    """
    db_session.query(Document).filter(Document.status == st.NEEDS_REVIEW).delete()
    db_session.flush()

    response = client.get("/")
    assert "Nothing is waiting" in response.text
    assert "not a bug" in response.text
    assert "corrections" in response.text, "it should say how to put something in the queue"


def test_a_queued_document_appears_with_the_reason_it_is_waiting(
    client: TestClient, db_session: Session
) -> None:
    """"Show the reason each document is waiting" - a queue of filenames makes a reviewer
    open every one to find out what it wants."""
    document = a_queued_document(db_session)

    response = client.get("/")
    assert document.filename in response.text
    assert "subtotal_plus_tax_equals_total" in response.text
    assert "999.00" in response.text, "the message names the numbers"


def test_the_review_page_shows_the_document_beside_its_fields(
    client: TestClient, db_session: Session
) -> None:
    document = a_queued_document(db_session)

    response = client.get(f"/review/{document.id}")
    assert response.status_code == 200
    assert 'name="f:total"' in response.text, "fields are editable"
    assert 'name="f:line_items[0].amount"' in response.text, "line items too"
    assert "ACME CORP LTD" in response.text, "the text layer the extractor actually saw"
    assert "subtotal_plus_tax_equals_total" in response.text


def test_a_failed_rule_marks_the_fields_it_implicates(
    client: TestClient, db_session: Session
) -> None:
    """Highlighting is driven by the rule name, not by parsing the message.

    A message is written for a person and its wording will change; highlighting that silently
    stopped working would be worse than not highlighting at all.
    """
    document = a_queued_document(db_session)
    response = client.get(f"/review/{document.id}")
    marked = [line for line in response.text.splitlines() if 'class="bad"' in line]
    assert marked, "the arithmetic failure should mark subtotal, tax and total"


def test_fix_a_field_and_approve_puts_the_invoice_in_the_database(
    client: TestClient, db_session: Session
) -> None:
    """Stage 7's stated end, in one request - which is the point of one form.

    Two passes over the same document is what makes a review queue miserable, and this queue
    is also the tool for building stage 8's corpus.
    """
    document = a_queued_document(db_session)
    before = db_session.query(Invoice).count()

    response = client.post(
        f"/review/{document.id}",
        data={
            "action": "approve",
            "reviewed_by": "tester",
            "f:invoice_number": "INV-2026-0042",
            "f:vendor_name": "ACME CORP LTD",
            "f:currency": "GBP",
            "f:subtotal": "225.00",
            "f:tax": "45.00",
            "f:total": "270.00",
        },
        follow_redirects=False,
    )

    assert response.status_code == 303, "approve returns to the queue"
    db_session.refresh(document)
    assert document.status == st.APPROVED
    assert db_session.query(Invoice).count() == before + 1

    invoice = (
        db_session.query(Invoice).filter(Invoice.document_id == document.id).one()
    )
    assert str(invoice.total) == "270.00"


def test_saving_without_approving_re_runs_the_rules_and_stays_put(
    client: TestClient, db_session: Session
) -> None:
    """"I fixed a field and want to see what the rules say now" and "file this" are different
    intentions, and a queue that conflates them makes people guess."""
    document = a_queued_document(db_session)

    response = client.post(
        f"/review/{document.id}",
        data={"action": "save", "f:total": "270.00", "f:subtotal": "225.00", "f:tax": "45.00"},
    )

    assert response.status_code == 200
    assert "correction(s) saved" in response.text
    db_session.refresh(document)
    assert document.status != st.APPROVED, "saving files nothing"


def test_rejecting_needs_a_reason_and_files_nothing(
    client: TestClient, db_session: Session
) -> None:
    """`rejected` is a person's decision and `failed` is the system's fault. A rejection with
    no reason is one nobody can learn from."""
    document = a_queued_document(db_session)
    before = db_session.query(Invoice).count()

    refused = client.post(
        f"/review/{document.id}", data={"action": "reject", "reason": "   "}
    )
    assert "a rejection needs a reason" in refused.text
    db_session.refresh(document)
    assert document.status == st.NEEDS_REVIEW

    accepted = client.post(
        f"/review/{document.id}",
        data={"action": "reject", "reason": "duplicate of last month", "reviewed_by": "tester"},
        follow_redirects=False,
    )
    assert accepted.status_code == 303
    db_session.refresh(document)
    assert document.status == st.REJECTED
    assert db_session.query(Invoice).count() == before, "a rejection files nothing"
    assert document.status_history[-1]["detail"] == "duplicate of last month"


def test_a_review_page_for_a_document_that_does_not_exist_is_a_404(
    client: TestClient,
) -> None:
    assert client.get(f"/review/{uuid.uuid4()}").status_code == 404
