"""The FastAPI application.

Stage 0 serves only /health. The client (stage 3), the workspace (stage 4) and matches
(stages 5 to 7) are added as routers here.
"""

from __future__ import annotations

from fastapi import FastAPI

from codevscode import __version__
from codevscode.api import health

app = FastAPI(
    title="codevscode",
    version=__version__,
    summary="Code vs Code: a coding duel judged on the questions you ask, the bugs you prove "
    "and how well you defend what your helper built.",
)

app.include_router(health.router)
