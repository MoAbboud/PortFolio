"""The extensions the schema is built on.

No tables yet - those arrive in stage 1.

Who may run this matters. citext and cube are trusted extensions, so a login that owns its
database creates them itself. earthdistance is not: on the production server, where each
app's login is not a superuser, it fails with "permission denied to create extension".
The server's init script creates earthdistance as the superuser first, and IF NOT EXISTS
makes this line a no-op there. Locally and in CI the login is the superuser and all three
succeed. See roamer/requirements/03-architecture.md, Deployment.

Revision ID: 0001_extensions
Revises:
Create Date: 2026-10-07
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

revision: str = "0001_extensions"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    # earthdistance's ll_to_earth() returns a cube, so cube has to exist first.
    op.execute("CREATE EXTENSION IF NOT EXISTS cube")
    op.execute("CREATE EXTENSION IF NOT EXISTS earthdistance")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS earthdistance")
    op.execute("DROP EXTENSION IF EXISTS cube")
    op.execute("DROP EXTENSION IF EXISTS citext")
