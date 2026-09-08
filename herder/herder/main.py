"""The FastAPI application.

The API never loads or runs a model. All inference happens in the worker process. That was
decided so a browser extension could hammer `/v1/ingest` without waiting on anything, and it
matters more now that the models are local: a derive is minutes of CPU and must never be
inside an HTTP request.
"""

from __future__ import annotations

from fastapi import FastAPI

from herder.api import health


def create_app() -> FastAPI:
    app = FastAPI(
        title="herder",
        version="0.0.1",
        summary="Portable, user-controlled memory for AI chat.",
        description=(
            "Captures conversations from any chatbot, keeps a compact layered versioned "
            "brief with lineage back to the raw messages, serves it into any other AI "
            "tool, and measures whether the model retained it.\n\n"
            "Runs no hosted model and needs no API key."
        ),
    )
    app.include_router(health.router)
    return app


app = create_app()
