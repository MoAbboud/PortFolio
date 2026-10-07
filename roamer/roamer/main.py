"""The FastAPI application.

One process serves the pages and the JSON the map reads. There is no front-end build step;
from stage 1 the pages are server-rendered and Leaflet comes from a CDN.
"""

from __future__ import annotations

from fastapi import FastAPI

from roamer import __version__
from roamer.api import health

app = FastAPI(
    title="roamer",
    version=__version__,
    summary="A map of lost animals, kept current by their owners.",
)

app.include_router(health.router)
