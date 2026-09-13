"""Stage 6: an inconclusive grade has no score, and a checkpoint records its wall-clock.

Revision ID: 0003_checkpoint_measurement
Revises: 0002_model_call_timing
Create Date: stage 6

**`probe_results.score` becomes nullable.** An inconclusive grade is excluded from the score
and flagged, never defaulted to 0 or to 1 - both defaults are lies. With `score NOT NULL` the
only ways to store one were to invent a value or to throw the answer away, and the answer is
exactly what a person needs to see to decide whether the judge or the model was at fault. A
null score is the flag; `judge_reason` says why. The check constraint still admits only 0, 0.5
and 1, because a CHECK passes on NULL.

**`checkpoints.latency_ms`** because "the wall-clock of one checkpoint" is a stage 6 task and
the per-call rows in `model_calls` do not add up to it - probe lookups, grading and writes sit
between the calls.

**An index for the probe cache**, which is looked up by `(entry_id, entry_revision)` on every
checkpoint.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003_checkpoint_measurement"
down_revision = "0002_model_call_timing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("probe_results", "score", existing_type=sa.Float(), nullable=True)
    op.add_column("checkpoints", sa.Column("latency_ms", sa.Integer()))
    op.create_index("ix_probes_entry_revision", "probes", ["entry_id", "entry_revision"])
    op.create_index("ix_probes_message", "probes", ["message_id"])


def downgrade() -> None:
    op.drop_index("ix_probes_message", table_name="probes")
    op.drop_index("ix_probes_entry_revision", table_name="probes")
    op.drop_column("checkpoints", "latency_ms")
    # Inconclusive rows cannot survive NOT NULL, and inventing a score for them is the thing
    # this migration exists to prevent. They are deleted, not defaulted.
    op.execute("DELETE FROM probe_results WHERE score IS NULL")
    op.alter_column("probe_results", "score", existing_type=sa.Float(), nullable=False)
