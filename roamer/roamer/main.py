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
from roamer.config import settings

app = FastAPI(
    title="roamer",
    version=__version__,
    summary="A map of lost animals, kept current by their owners.",
)

app.mount(
    "/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static"
)

# Uploaded photos. Keys are random UUIDs, so a photo's address cannot be guessed. Served
# with ETag and Last-Modified by StaticFiles; no long-lived Cache-Control yet.
Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=settings.image_dir), name="media")
app.include_router(health.router)
app.include_router(listings.router)
app.include_router(pages.router)
