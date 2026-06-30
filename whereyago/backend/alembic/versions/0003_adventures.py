"""rename days->adventures and add weather, stats, ratings, likes, comments, user_info

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- Rename Day -> Adventure (preserving data) ---
    op.rename_table("days", "adventures")
    op.execute("ALTER INDEX ix_days_owner_id RENAME TO ix_adventures_owner_id")
    op.alter_column("stops", "day_id", new_column_name="adventure_id")
    op.execute("ALTER INDEX ix_stops_day_id RENAME TO ix_stops_adventure_id")

    # --- New tables ---
    op.create_table(
        "weather",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "adventure_id",
            sa.Integer(),
            sa.ForeignKey("adventures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("code", sa.Integer(), nullable=True),
        sa.Column("temp_max", sa.Float(), nullable=True),
        sa.Column("temp_min", sa.Float(), nullable=True),
        sa.Column("description", sa.String(length=100), nullable=True),
        sa.UniqueConstraint("adventure_id", name="uq_weather_adventure_id"),
    )

    op.create_table(
        "adventure_stats",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "adventure_id",
            sa.Integer(),
            sa.ForeignKey("adventures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("views", sa.Integer(), server_default="0", nullable=False),
        sa.Column("likes_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("comments_count", sa.Integer(), server_default="0", nullable=False),
        sa.UniqueConstraint("adventure_id", name="uq_adventure_stats_adventure_id"),
    )

    op.create_table(
        "ratings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "adventure_id",
            sa.Integer(),
            sa.ForeignKey("adventures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("adventure_id", "user_id", name="uq_rating_user_adventure"),
    )
    op.create_index("ix_ratings_adventure_id", "ratings", ["adventure_id"])
    op.create_index("ix_ratings_user_id", "ratings", ["user_id"])

    op.create_table(
        "adventure_likes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "adventure_id",
            sa.Integer(),
            sa.ForeignKey("adventures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("adventure_id", "user_id", name="uq_like_user_adventure"),
    )
    op.create_index("ix_adventure_likes_adventure_id", "adventure_likes", ["adventure_id"])
    op.create_index("ix_adventure_likes_user_id", "adventure_likes", ["user_id"])

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "adventure_id",
            sa.Integer(),
            sa.ForeignKey("adventures.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("ix_comments_adventure_id", "comments", ["adventure_id"])
    op.create_index("ix_comments_user_id", "comments", ["user_id"])

    op.create_table(
        "user_info",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("address", sa.String(length=300), nullable=True),
        sa.Column("phone", sa.String(length=40), nullable=True),
        sa.Column("interests", sa.JSON(), nullable=True),
        sa.UniqueConstraint("user_id", name="uq_user_info_user_id"),
    )

    # --- Backfill: a stats row per existing adventure ---
    op.execute(
        "INSERT INTO adventure_stats (adventure_id, views, likes_count, comments_count) "
        "SELECT id, 0, 0, 0 FROM adventures"
    )

    # --- Migrate existing weather JSON -> weather table, then drop the column ---
    bind = op.get_bind()
    rows = (
        bind.execute(sa.text("SELECT id, weather FROM adventures WHERE weather IS NOT NULL"))
        .mappings()
        .all()
    )
    for row in rows:
        snapshot = row["weather"] or {}
        bind.execute(
            sa.text(
                "INSERT INTO weather (adventure_id, code, temp_max, temp_min) "
                "VALUES (:adventure_id, :code, :temp_max, :temp_min)"
            ),
            {
                "adventure_id": row["id"],
                "code": snapshot.get("code"),
                "temp_max": snapshot.get("max"),
                "temp_min": snapshot.get("min"),
            },
        )
    op.drop_column("adventures", "weather")


def downgrade() -> None:
    op.add_column("adventures", sa.Column("weather", sa.JSON(), nullable=True))
    op.drop_table("user_info")
    op.drop_table("comments")
    op.drop_table("adventure_likes")
    op.drop_table("ratings")
    op.drop_table("adventure_stats")
    op.drop_table("weather")
    op.execute("ALTER INDEX ix_stops_adventure_id RENAME TO ix_stops_day_id")
    op.alter_column("stops", "adventure_id", new_column_name="day_id")
    op.execute("ALTER INDEX ix_adventures_owner_id RENAME TO ix_days_owner_id")
    op.rename_table("adventures", "days")
