"""Stage 0 smoke tests.

These do not need a running database. create_engine does not connect, so the models and the
app can be imported and inspected offline - which is the same property that keeps most of
this system testable without a provider key later.
"""

from __future__ import annotations

from mailman.db import Base
from mailman.main import app
from mailman.status import ALL_STATUSES, TERMINAL_STATUSES

# Imported for the side effect of registering every table on Base.metadata. Importing the
# app alone does not do it, because the HTTP layer has no reason to know the schema.
from mailman import models  # noqa: F401

EXPECTED_TABLES = {
    "documents",
    "extractions",
    "invoices",
    "line_items",
    "vendors",
    "validation_results",
    "corrections",
}


def test_schema_is_the_seven_tables() -> None:
    """Seven tables, no more. An eighth appearing should be a deliberate decision."""
    assert set(Base.metadata.tables) == EXPECTED_TABLES


def test_root_redirects_rather_than_404s() -> None:
    """The bare host is the front door.

    Clicking the port in Docker Desktop lands here, and a 404 there reads as "the thing is
    broken" when the thing is fine. Stage 7 replaces the target with the review queue.
    """
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        response = client.get("/", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "/docs"


def test_health_route_is_registered() -> None:
    # Checked through the OpenAPI schema rather than app.routes, because that is the
    # contract a caller actually sees, and because app.routes keeps included routers
    # nested rather than flattened.
    assert "/health" in app.openapi()["paths"]


def test_documents_status_check_covers_every_status() -> None:
    """The database rejects a status the application does not know about."""
    documents = Base.metadata.tables["documents"]
    checks = [c for c in documents.constraints if c.name == "ck_documents_status"]
    assert len(checks) == 1
    clause = str(checks[0].sqltext)
    for status in ALL_STATUSES:
        assert f"'{status}'" in clause


def test_terminal_statuses_are_a_subset_of_all_statuses() -> None:
    assert TERMINAL_STATUSES <= set(ALL_STATUSES)


def test_money_columns_are_exact_decimal() -> None:
    """No float touches money. This test is here so that stays true by accident-proofing."""
    invoices = Base.metadata.tables["invoices"]
    for column_name in ("subtotal", "tax", "total"):
        column = invoices.columns[column_name]
        assert column.type.__class__.__name__ == "Numeric"
        assert column.type.scale == 2

    line_items = Base.metadata.tables["line_items"]
    for column_name in ("unit_price", "amount"):
        assert line_items.columns[column_name].type.scale == 2


def test_duplicate_invoice_is_a_database_constraint() -> None:
    """A reviewer can override a rule. They cannot override a unique key."""
    invoices = Base.metadata.tables["invoices"]
    names = {c.name for c in invoices.constraints}
    assert "uq_invoices_vendor_number" in names
