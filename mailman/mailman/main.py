"""The FastAPI application.

One process serves the API and, from stage 7, the review queue. There is no separate
front-end build step and nothing to install beyond Docker.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from mailman import __version__
from mailman.api import documents, health

app = FastAPI(
    title="mailman",
    version=__version__,
    summary="An intelligent document intake pipeline.",
    description=(
        "Messy documents in - PDFs, scans, spreadsheets - validated structured records out, "
        "with a review queue for anything the extraction is not confident about."
    ),
)

app.include_router(health.router)
app.include_router(documents.router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    """Send the front door somewhere useful.

    Clicking the port in Docker Desktop, or typing the bare host, lands here. Without this
    it is a 404, which reads as "the thing is broken" when the thing is fine.

    Redirects to the generated API docs for now. From stage 7 this becomes the review queue,
    which is the page a visitor should actually land on.
    """
    return RedirectResponse(url="/docs")
