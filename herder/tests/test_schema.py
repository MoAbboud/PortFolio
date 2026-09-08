"""The schema is what requirements/04-data-model.md says it is.

These names are typed out here on purpose rather than imported from the code. A test that
derives its expectation from the thing it is testing proves only that the code equals
itself. This list is the document, written down independently, so that adding a table
without deciding to add a table fails here.

Runs with no database.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from herder.core.constants import EMBED_DIM
from herder.models import Base

# requirements/04-data-model.md, "Eighteen tables".
DOCUMENTED_TABLES = {
    "users",
    "workspaces",
    "api_keys",
    "projects",
    "conversations",
    "messages",
    "entries",
    "entry_revisions",
    "entry_lineage",
    "entry_events",
    "brief_versions",
    "injections",
    "probes",
    "checkpoints",
    "probe_results",
    "suggestions",
    "jobs",
    "model_calls",
}

MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "0001_initial.py"


def test_exactly_the_documented_tables() -> None:
    assert set(Base.metadata.tables) == DOCUMENTED_TABLES


def test_there_are_eighteen_of_them() -> None:
    # Stated as a number in three documents. If this fails, one of them is now wrong.
    assert len(DOCUMENTED_TABLES) == 18


def test_migration_creates_every_table() -> None:
    """The models and the migration are written by hand and can drift. They must not."""
    source = MIGRATION.read_text(encoding="utf-8")
    created = set(re.findall(r'op\.create_table\(\s*"([a-z_]+)"', source))
    assert created == DOCUMENTED_TABLES


def test_no_provider_table_survived() -> None:
    """`vendor_accounts` held encrypted provider keys. It was cut, not deferred.

    Checked as a created table rather than as a string, because the migration's docstring
    names it on purpose - saying why it is absent is the point of writing it down.
    """
    assert "vendor_accounts" not in Base.metadata.tables
    source = MIGRATION.read_text(encoding="utf-8")
    assert "vendor_accounts" not in set(re.findall(r'op\.create_table\(\s*"([a-z_]+)"', source))


@pytest.mark.parametrize(
    ("table", "columns"),
    [
        # Idempotent ingest, and ordering. The two constraints ingest depends on.
        ("messages", ("conversation_id", "content_hash")),
        ("messages", ("conversation_id", "seq")),
        # The same chat seen twice is the same conversation.
        ("conversations", ("vendor", "vendor_conv_id")),
        ("projects", ("workspace_id", "name")),
        ("brief_versions", ("project_id", "version")),
    ],
)
def test_unique_constraints_that_carry_the_design(table: str, columns: tuple[str, ...]) -> None:
    found = {
        tuple(c.name for c in constraint.columns)
        for constraint in Base.metadata.tables[table].constraints
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    assert columns in found


def test_one_derive_per_project_index_exists() -> None:
    """Two derives for one project would extract the same messages twice.

    Application-level debouncing mostly works. This index cannot be got wrong under load,
    which is why the rule lives here rather than in a service.
    """
    names = {i.name for i in Base.metadata.tables["jobs"].indexes}
    assert "one_derive_per_project" in names

    source = MIGRATION.read_text(encoding="utf-8")
    assert "one_derive_per_project" in source
    assert "payload->>'project_id'" in source
    assert "kind = 'derive'" in source


def test_embedding_dimension_agrees_everywhere() -> None:
    """The column width and the constant must not drift. The migration hardcodes it too."""
    column = Base.metadata.tables["entries"].columns["embedding"]
    assert column.type.dim == EMBED_DIM == 384
    assert f"EMBED_DIM = {EMBED_DIM}" in MIGRATION.read_text(encoding="utf-8")


def test_brief_versions_records_what_it_dropped() -> None:
    """A render that only recorded what it kept could never measure what the budget cost."""
    columns = Base.metadata.tables["brief_versions"].columns
    assert "included_entry_ids" in columns
    assert "excluded_entry_ids" in columns
    assert not columns["excluded_entry_ids"].nullable


def test_model_calls_records_which_implementation() -> None:
    """Comparing three extractors is the point of having three."""
    assert "implementation" in Base.metadata.tables["model_calls"].columns
