"""The FastAPI application.

The API never loads or runs a model. All inference happens in the worker process. That was
decided so a browser extension could hammer `/v1/ingest` without waiting on anything, and it
matters more now that the models are local: a derive is minutes of CPU and must never be
inside an HTTP request.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import RedirectResponse

from herder.api import checkpoints, conversations, entries, health, ingest, projects
from herder.web.bench_routes import router as bench_router
from herder.web.routes import router as web_router
from herder.web.support import LoginRequired


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
    # /health carries no key on purpose: it is a probe, and a health check that needs a
    # credential is a health check the orchestrator cannot use.
    app.include_router(health.router)
    app.include_router(ingest.router)
    app.include_router(conversations.router)
    app.include_router(projects.router)
    app.include_router(checkpoints.router)
    app.include_router(entries.router)
    # Stage 8: the pages. Outside /v1, and authenticated by cookie rather than header.
    app.include_router(web_router)
    # Stage 9: the benchmark's fact-list authoring pages. Off when HERDER_BENCH_AUTHORING=false.
    app.include_router(bench_router)

    @app.exception_handler(LoginRequired)
    async def _login_required(request: Request, exc: LoginRequired) -> RedirectResponse:
        return RedirectResponse("/login", status_code=303)

    return app


app = create_app()
