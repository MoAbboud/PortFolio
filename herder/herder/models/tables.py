"""The eighteen tables.

Shape, from requirements/04-data-model.md: a message is a fact that happened, an entry is a
claim about what it meant, a brief version is a snapshot of the claims that fitted, and a
checkpoint is a measurement of one snapshot. Nothing downstream may edit anything upstream
of it.

The constraints carrying that design are declared here and repeated by hand in the first
migration, deliberately. See migrations/versions/0001_initial.py.
"""

from __future__ import annotations

import datetime as dt
import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    PrimaryKeyConstraint,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from herder.core.constants import EMBED_DIM


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    """A UUIDv7 primary key, supplied by the application. See herder.core.ids."""
    return mapped_column(UUID(as_uuid=True), primary_key=True)


def _created() -> Mapped[dt.datetime]:
    return mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


# --------------------------------------------------------------------------- accounts


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _pk()
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    display_name: Mapped[str | None] = mapped_column(Text)
    # Null until there is a login. There is one user and a bootstrap command.
    password_hash: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _created()
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Workspace(Base):
    """The tenancy anchor. One per user for now.

    Kept from the start although there is a single user, because retrofitting a tenancy
    boundary is not additive - it moves a foreign key on `projects` and touches the filter
    in every query. `workspace_members` is the part that *is* additive, and it waits.
    """

    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = _pk()
    name: Mapped[str] = mapped_column(Text, nullable=False)
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[dt.datetime] = _created()


class ApiKey(Base):
    """herder's own bearer keys, for the extension, MCP and REST.

    These are keys this system mints. There is no provider key anywhere in this project.
    """

    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = _pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    # SHA-256 of the key. The key itself is shown once, at creation, and never stored.
    key_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{ingest,read,mcp}'::text[]")
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = _created()


# --------------------------------------------------------------------------- the corpus


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("workspace_id", "name", name="uq_projects_workspace_name"),)

    id: Mapped[uuid.UUID] = _pk()
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))

    brief_budget_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("3000"))
    session_tail_tokens: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1200"))

    # {conversation_id: last_seq}. Advanced only on a successful derive, so a derive killed
    # for memory re-runs from where it was rather than silently skipping material.
    derive_cursor: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    tokens_since_derive: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    last_derived_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    # Circular with brief_versions.project_id, so the constraint is created after both
    # tables exist. use_alter is what makes that happen in the right order.
    current_brief_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("brief_versions.id", name="fk_projects_current_brief", use_alter=True),
    )
    created_at: Mapped[dt.datetime] = _created()


class Conversation(Base):
    __tablename__ = "conversations"
    __table_args__ = (
        # The same chat seen twice is the same conversation. Null vendor_conv_id (a pasted
        # transcript) does not collide, because NULL is never equal to NULL - so pasting the
        # same transcript twice makes two conversations, and the message hash then catches
        # the duplicate turns inside them.
        UniqueConstraint("vendor", "vendor_conv_id", name="uq_conversations_vendor_id"),
        Index("ix_conversations_project_last_seen", "project_id", text("last_seen_at DESC")),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    vendor: Mapped[str] = mapped_column(Text, nullable=False)
    vendor_conv_id: Mapped[str | None] = mapped_column(Text)
    title: Mapped[str | None] = mapped_column(Text)
    model_hint: Mapped[str | None] = mapped_column(Text)
    first_seen_at: Mapped[dt.datetime] = _created()
    last_seen_at: Mapped[dt.datetime] = _created()
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    token_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))


class Message(Base):
    """The spine. Append-only: no update, no delete except a cascade from deleting the user."""

    __tablename__ = "messages"
    __table_args__ = (
        # Idempotent ingest. The extension re-sends the same turn on a retry, on a reload,
        # and when the observer fires twice for one node.
        UniqueConstraint("conversation_id", "content_hash", name="uq_messages_conv_hash"),
        # Ordering.
        UniqueConstraint("conversation_id", "seq", name="uq_messages_conv_seq"),
        Index("ix_messages_conv_seq", "conversation_id", "seq"),
    )

    id: Mapped[uuid.UUID] = _pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # sha256(vendor + conversation id + role + normalised text), recomputed server-side.
    content_hash: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    client_position: Mapped[int | None] = mapped_column(Integer)
    captured_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[dt.datetime] = _created()


# --------------------------------------------------------------------------- the memory


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (
        Index("ix_entries_project_status_layer", "project_id", "status", "layer"),
        Index(
            "ix_entries_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        CheckConstraint(
            "layer in ('stable','project','session')", name="ck_entries_layer"
        ),
        CheckConstraint(
            "status in ('active','pinned','removed','superseded','archived')",
            name="ck_entries_status",
        ),
        CheckConstraint("source in ('derived','user')", name="ck_entries_source"),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    layer: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'active'"))
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'derived'"))
    current_revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    confidence: Mapped[float] = mapped_column(Float, nullable=False, server_default=text("0.5"))
    first_seen_at: Mapped[dt.datetime] = _created()
    last_seen_at: Mapped[dt.datetime] = _created()
    seen_in_conversations: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    superseded_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id"))
    # Set when an entry has been seen in three or more conversations. It is a suggestion.
    # Nothing is ever promoted to the stable layer without a person confirming it.
    promotion_suggested: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    # Set when a checkpoint proved the model did not receive something the brief contained.
    transmission_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    created_at: Mapped[dt.datetime] = _created()


class EntryRevision(Base):
    """The text of an entry at each revision. Never overwritten.

    A checkpoint scored against revision 3 still means something after somebody edits the
    entry into revision 4, and that is the entire reason this table is separate.
    """

    __tablename__ = "entry_revisions"
    __table_args__ = (PrimaryKeyConstraint("entry_id", "revision", name="pk_entry_revisions"),)

    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    text_: Mapped[str] = mapped_column("text", Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    changed_by: Mapped[str] = mapped_column(Text, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _created()


class EntryLineage(Base):
    """Two columns, and the reason the whole project is defensible.

    Every derived entry has at least one row here pointing at a real message in the same
    project. An entry that cannot say where it came from is a failed extraction, not a
    low-confidence entry.
    """

    __tablename__ = "entry_lineage"
    __table_args__ = (PrimaryKeyConstraint("entry_id", "message_id", name="pk_entry_lineage"),)

    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )


class EntryEvent(Base):
    __tablename__ = "entry_events"

    id: Mapped[uuid.UUID] = _pk()
    entry_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    event: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = _created()


# --------------------------------------------------------------------------- serving


class BriefVersion(Base):
    """Immutable. Any change is a new version, never an edit."""

    __tablename__ = "brief_versions"
    __table_args__ = (UniqueConstraint("project_id", "version", name="uq_brief_versions_project_version"),)

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    rendered_text: Mapped[str] = mapped_column(Text, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    budget_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    included_entry_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    # The interesting column. What did not fit is what the UI reports and what the
    # `excluded` probes in a checkpoint are drawn from. A render that recorded only what it
    # kept could never measure what the budget cost.
    excluded_entry_ids: Mapped[list[uuid.UUID]] = mapped_column(ARRAY(UUID(as_uuid=True)), nullable=False)
    source_message_count: Mapped[int] = mapped_column(Integer, nullable=False)
    source_token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    trigger: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = _created()


class Injection(Base):
    """One serve. The join key between what was sent and what came back."""

    __tablename__ = "injections"

    id: Mapped[uuid.UUID] = _pk()
    brief_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("brief_versions.id", ondelete="CASCADE"), nullable=False
    )
    door: Mapped[str] = mapped_column(Text, nullable=False)
    target_vendor: Mapped[str | None] = mapped_column(Text)
    target_conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id")
    )
    pack_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = _created()


# --------------------------------------------------------------------------- measurement


class Probe(Base):
    __tablename__ = "probes"
    __table_args__ = (
        CheckConstraint("category in ('included','excluded','uncovered')", name="ck_probes_category"),
        Index("ix_probes_entry_revision", "entry_id", "entry_revision"),
        Index("ix_probes_message", "message_id"),
    )

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    # Null for an uncovered probe, which is generated from raw material no entry claims -
    # the only way to measure what extraction missed.
    entry_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id", ondelete="CASCADE"))
    entry_revision: Mapped[int | None] = mapped_column(Integer)
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("messages.id", ondelete="CASCADE")
    )
    category: Mapped[str] = mapped_column(Text, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[dt.datetime] = _created()


class Checkpoint(Base):
    """Hangs off an injection, not off a project or a version.

    A score has to refer to the exact text that was sent, and the brief may have been
    re-rendered since.
    """

    __tablename__ = "checkpoints"
    __table_args__ = (CheckConstraint("mode in ('local','in_chat')", name="ck_checkpoints_mode"),)

    id: Mapped[uuid.UUID] = _pk()
    injection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("injections.id", ondelete="CASCADE"), nullable=False
    )
    mode: Mapped[str] = mapped_column(Text, nullable=False)
    judge_model: Mapped[str] = mapped_column(Text, nullable=False)
    answer_model: Mapped[str | None] = mapped_column(Text)
    integrity: Mapped[float] = mapped_column(Float, nullable=False)
    # Reported beside the score on purpose. A checkpoint that says how many probes are
    # behind it can be believed; one that does not, cannot.
    probe_count: Mapped[int] = mapped_column(Integer, nullable=False)
    # The whole checkpoint, not the sum of its model calls. A stage 6 task on its own.
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = _created()


class ProbeResult(Base):
    __tablename__ = "probe_results"
    __table_args__ = (PrimaryKeyConstraint("checkpoint_id", "probe_id", name="pk_probe_results"),)

    checkpoint_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("checkpoints.id", ondelete="CASCADE"), nullable=False
    )
    probe_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("probes.id", ondelete="CASCADE"), nullable=False
    )
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    # Exactly 0, 0.5 or 1. Three values a person can argue with, rather than a continuous
    # number a model would be inventing. NULL when the grade was inconclusive: excluded from
    # the score and flagged, never defaulted to 0 or 1 (migration 0003).
    score: Mapped[float | None] = mapped_column(Float)
    judge_reason: Mapped[str | None] = mapped_column(Text)


class Suggestion(Base):
    __tablename__ = "suggestions"

    id: Mapped[uuid.UUID] = _pk()
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    entry_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("entries.id"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("messages.id"))
    text_: Mapped[str] = mapped_column("text", Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'open'"))
    created_at: Mapped[dt.datetime] = _created()


# --------------------------------------------------------------------------- machinery


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_status_run_after", "status", "run_after"),
        # Two derives running for one project would extract the same messages twice and
        # merge each other's output. Debouncing in application code mostly works; a partial
        # unique index cannot be got wrong under load, and it makes the second enqueue a
        # no-op rather than a lock.
        Index(
            "one_derive_per_project",
            text("(payload->>'project_id')"),
            unique=True,
            postgresql_where=text("kind = 'derive' AND status IN ('queued','running')"),
        ),
    )

    id: Mapped[uuid.UUID] = _pk()
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'queued'"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"))
    run_after: Mapped[dt.datetime] = _created()
    locked_by: Mapped[str | None] = mapped_column(Text)
    locked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _created()


class ModelCall(Base):
    """Every inference call, including the ones that fail.

    `implementation` matters as much as `model`: comparing three extractors is the entire
    point of having three, and a row that cannot say whether it came from `heuristic` or
    `local` proves nothing.

    `raw_output` is the bulky column and the only one that matters when something breaks -
    a validation failure with the output thrown away is unfixable.
    """

    __tablename__ = "model_calls"

    id: Mapped[uuid.UUID] = _pk()
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    implementation: Mapped[str | None] = mapped_column(Text)
    prompt_version: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    # The split, not just the total. A cold call at stage 2 spent 121 s of a 125.6 s wall
    # clock loading the model and 4.8 s doing the work; with one number that is invisible in
    # the data. Nullable because the heuristic extractor does no inference, and null there
    # means "not applicable" rather than "zero".
    load_ms: Mapped[int | None] = mapped_column(Integer)
    prompt_ms: Mapped[int | None] = mapped_column(Integer)
    generation_ms: Mapped[int | None] = mapped_column(Integer)
    validated_first_try: Mapped[bool | None] = mapped_column(Boolean)
    raw_output: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = _created()
