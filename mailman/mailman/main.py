"""The FastAPI application.

One process serves the API and, from stage 7, the review queue. There is no separate
front-end build step and nothing to install beyond Docker.
"""

from __future__ import annotations

from fastapi import FastAPI

from mailman import __version__
from mailman.api import documents, health, review

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

# The review queue owns `/`. It redirected to `/docs` before there was a queue, which was the
# right answer then and the wrong one now: a visitor should land on the thing the system does,
# not on its API reference.
app.include_router(review.router)
