"""The FastAPI application.

/health, and the client: starting an attempt and asking questions (stage 3). The workspace
(stage 4) and matches (stages 5 to 7) are added as routers here.
"""

from __future__ import annotations

from fastapi import FastAPI

from codevscode import __version__
from codevscode.api import attempts, health

app = FastAPI(
    title="codevscode",
    version=__version__,
    summary="Code vs Code: a coding duel judged on the questions you ask, the bugs you prove "
    "and how well you defend what your helper built.",
)

app.include_router(health.router)
app.include_router(attempts.router)
