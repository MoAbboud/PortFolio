"""Health check.

Green means the process is up and the database is reachable. A health check that only
proves the web server started is worth very little - the thing that actually breaks is the
database connection, so that is what gets checked.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from mailman import __version__
from mailman.db import get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> JSONResponse:
    """Return 200 when the database answers, 503 when it does not."""
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "version": __version__,
                "database": "unreachable",
                # The class name, not the message: a connection error can carry the
                # connection string, and that can carry a password.
                "error": type(exc).__name__,
            },
        )

    return JSONResponse(
        status_code=200,
        content={"status": "ok", "version": __version__, "database": "ok"},
    )
