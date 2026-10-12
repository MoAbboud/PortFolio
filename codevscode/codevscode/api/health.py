"""Health check.

Green means the process is up, the database answers, and its schema is at the newest
migration. A check that only proved the web server started would be green on the day the
migrations did not run.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from codevscode import __version__
from codevscode.db import get_session

router = APIRouter(tags=["health"])

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


@cache
def migration_head() -> str | None:
    """The newest migration in the repository."""
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_INI.parent / "migrations"))
    return ScriptDirectory.from_config(config).get_current_head()


@router.get("/health")
def health(session: Session = Depends(get_session)) -> JSONResponse:
    """Return 200 when the database answers at the newest migration, 503 otherwise."""
    try:
        current = session.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except SQLAlchemyError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "version": __version__,
                "database": "unreachable",
                # The class name, not the message: a connection error can carry the
                # connection string, and that can carry a password. A missing
                # alembic_version table lands here too, as ProgrammingError.
                "error": type(exc).__name__,
            },
        )

    head = migration_head()
    if current != head:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "version": __version__,
                "database": "ok",
                # Almost always means `alembic upgrade head` has not run.
                "migrations": {"at": current, "head": head},
            },
        )

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "version": __version__, "database": "ok", "migrations": "ok"},
    )
