"""Health check.

Green means the process is up, the database answers, and the extensions the distance query
needs are installed. A check that only proved the web server started would be green on the
day the migrations did not run, and the first sign would be the finder's search failing.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from roamer import __version__
from roamer.db import REQUIRED_EXTENSIONS, get_session

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(get_session)) -> JSONResponse:
    """Return 200 when the database answers with every extension, 503 otherwise."""
    try:
        installed = set(
            session.execute(
                text("SELECT extname FROM pg_extension WHERE extname = ANY(:names)"),
                {"names": list(REQUIRED_EXTENSIONS)},
            ).scalars()
        )
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

    missing = [name for name in REQUIRED_EXTENSIONS if name not in installed]
    if missing:
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "version": __version__,
                "database": "ok",
                # Almost always means `alembic upgrade head` has not run against this
                # database. Named, so the fix is obvious from the response.
                "extensions": {"missing": missing},
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "version": __version__,
            "database": "ok",
            "extensions": "ok",
        },
    )
