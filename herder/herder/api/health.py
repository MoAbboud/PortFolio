"""GET /health.

Green when the database answers, 503 when it does not. `database_status` is a dependency
rather than a direct call so that both paths can be exercised in the test suite without a
container - the red path is the one that matters and it is the one nobody ever checks.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from herder.core.config import get_settings
from herder.core.db import database_status

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(database: str = Depends(database_status)) -> JSONResponse:
    settings = get_settings()
    body = {
        "status": "ok" if database == "ok" else "unhealthy",
        "database": database,
        # Which extractor is configured is part of the health of this system, not a detail.
        # The heuristic and the local model produce briefs of different quality, and an
        # operator who does not know which one is running cannot interpret anything else.
        "extractor": settings.extractor,
        "stage": 0,
    }
    return JSONResponse(status_code=200 if database == "ok" else 503, content=body)
