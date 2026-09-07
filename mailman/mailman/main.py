"""The FastAPI application.

One process serves the API and, from stage 7, the review queue. There is no separate
front-end build step and nothing to install beyond Docker.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from mailman import __version__
from mailman.api import documents, health, metrics, review


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Sweep up after a previous life of this process, then serve.

    Extraction runs in-process, so a restart is the moment when any document still sitting in
    `extracting` is provably not being worked on by anyone. It is also the only moment this
    system reliably gets, having deliberately not bought a broker - so it is where the
    recovery goes. The sweep still applies its age rule rather than failing everything it
    finds, because "in extracting" stops meaning "abandoned" the moment there are two
    processes, and that is a change somebody makes later without reading this file.

    It never raises. An application that will not boot because a cleanup task could not reach
    the database is a worse outage than the documents it meant to tidy.
    """
    from mailman.sweeper import sweep_quietly

    sweep_quietly()
    yield


app = FastAPI(
    title="mailman",
    version=__version__,
    summary="An intelligent document intake pipeline.",
    description=(
        "Messy documents in - PDFs, scans, spreadsheets - validated structured records out, "
        "with a review queue for anything the extraction is not confident about."
    ),
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(documents.router)
app.include_router(metrics.router)

# The review queue owns `/`. It redirected to `/docs` before there was a queue, which was the
# right answer then and the wrong one now: a visitor should land on the thing the system does,
# not on its API reference.
app.include_router(review.router)
