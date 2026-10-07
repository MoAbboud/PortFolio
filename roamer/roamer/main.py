"""The FastAPI application.

One process serves the pages and the JSON the map reads. There is no front-end build step:
the pages are server-rendered and Leaflet comes from a CDN.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from roamer import __version__, pages
from roamer.api import health, listings

app = FastAPI(
    title="roamer",
    version=__version__,
    summary="A map of lost animals, kept current by their owners.",
)

app.mount(
    "/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static"
)
app.include_router(health.router)
app.include_router(listings.router)
app.include_router(pages.router)
