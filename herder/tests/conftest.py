"""Fixtures for the tests that need a real database.

Postgres, not SQLite: this schema uses JSONB, arrays, a pgvector column and a partial unique
index on a JSONB expression. Testing it against SQLite would test a different schema and
would quietly miss exactly the constraints that carry the design.

Every test runs inside a transaction that is rolled back, so the suite leaves nothing behind
and tests do not see each other. The session joins the outer transaction with a savepoint,
so the `session.commit()` calls inside the service code behave normally and are still undone.

When there is no database, these tests skip with a reason rather than fail. The pure tests -
the parser, the hashing, the schema, the ids - always run, and they are most of the suite.
"""

from __future__ import annotations

import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from herder.core.db import get_session
from herder.core.ids import uuid7
from herder.core.security import generate_key
from herder.main import create_app
from herder.models import ApiKey, Project, User, Workspace

TEST_DATABASE_URL = os.environ.get(
    "HERDER_TEST_DATABASE_URL",
    os.environ.get("DATABASE_URL", "postgresql+asyncpg://herder:herder@localhost:5432/herder"),
)

SKIP_REASON = (
    "no database reachable at "
    f"{TEST_DATABASE_URL.rsplit('@', 1)[-1]}. Start it with `docker compose up -d` and run "
    "`docker compose exec api alembic upgrade head`."
)

# Skipping is right on a laptop with Docker down and wrong in CI, where a missing service
# container would turn the whole run green having tested almost nothing - and the badge that
# reports it would be a false claim. The workflow sets REQUIRE_DB=1, which turns the skip
# into a failure. Nothing else sets it, so the local behaviour is unchanged.
REQUIRE_DB = os.environ.get("REQUIRE_DB") == "1"


def _no_database() -> None:
    """Skip, or fail where a database was promised."""
    if REQUIRE_DB:
        pytest.fail(f"REQUIRE_DB=1 and {SKIP_REASON}")
    pytest.skip(SKIP_REASON)


# Whether the database answered, decided once per session.
#
# Without this every skipped test paid its own failed connection: with Docker down the suite
# took 3 minutes 26 seconds to skip 49 tests, about 4 seconds each. A suite that takes
# minutes to do nothing is a suite that stops being run, which this project has already
# written down as the thing that kills a harness.
_REACHABLE: bool | None = None


async def _database_reachable() -> bool:
    global _REACHABLE
    if _REACHABLE is not None:
        return _REACHABLE

    probe = create_async_engine(TEST_DATABASE_URL, poolclass=None)
    try:
        async with probe.connect() as conn:
            # Not just "does it connect" - the migration has to have run, or every test
            # below fails with an unhelpful UndefinedTable.
            await conn.execute(text("select 1 from messages limit 1"))
        _REACHABLE = True
    except Exception:
        _REACHABLE = False
    finally:
        await probe.dispose()
    return _REACHABLE


@pytest_asyncio.fixture
async def engine():
    if not await _database_reachable():
        _no_database()

    engine = create_async_engine(TEST_DATABASE_URL, poolclass=None)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def session(engine):
    connection = await engine.connect()
    transaction = await connection.begin()
    maker = async_sessionmaker(
        bind=connection,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
    async with maker() as session:
        yield session
    await transaction.rollback()
    await connection.close()


@pytest_asyncio.fixture
async def account(session):
    """A user, a workspace, a default project and an API key. Rolled back afterwards."""
    user = User(id=uuid7(), email=f"test-{uuid.uuid4().hex[:8]}@localhost")
    session.add(user)
    await session.flush()

    workspace = Workspace(id=uuid7(), name="test", owner_user_id=user.id)
    session.add(workspace)
    await session.flush()

    project = Project(id=uuid7(), workspace_id=workspace.id, name="default", is_default=True)
    session.add(project)
    await session.flush()

    plaintext, prefix, digest = generate_key()
    session.add(
        ApiKey(
            id=uuid7(),
            user_id=user.id,
            workspace_id=workspace.id,
            name="test",
            key_hash=digest,
            prefix=prefix,
        )
    )
    await session.flush()

    return {"user": user, "workspace": workspace, "project": project, "key": plaintext}


@pytest_asyncio.fixture
async def client(session, account):
    """An HTTP client whose requests run inside the test's transaction."""
    app = create_app()

    async def override():
        yield session

    app.dependency_overrides[get_session] = override
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        client.headers["X-API-Key"] = account["key"]
        yield client
