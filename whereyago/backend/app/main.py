"""FastAPI application factory & wiring.

Responsibilities kept here (and nowhere else): configure logging, build the app,
attach middleware, register the single domain-error handler, and mount the API
router. Business logic lives in services; this file just composes the web layer.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.core.logging import configure_logging, get_logger
from app.middleware.correlation import CorrelationIdMiddleware

configure_logging()
logger = get_logger("app")
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    logger.info("app.startup", environment=settings.ENVIRONMENT)
    yield
    logger.info("app.shutdown")


def create_app() -> FastAPI:
    docs_enabled = settings.DOCS_ENABLED
    app = FastAPI(
        title=settings.PROJECT_NAME,
        version="0.1.0",
        lifespan=lifespan,
        # Swagger/ReDoc/OpenAPI are disabled unless DOCS_ENABLED=true.
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url=f"{settings.API_V1_PREFIX}/openapi.json" if docs_enabled else None,
    )

    # CORS first (innermost), correlation id added last so it wraps everything.
    if settings.BACKEND_CORS_ORIGINS:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.BACKEND_CORS_ORIGINS,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    app.add_middleware(CorrelationIdMiddleware)

    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        # Expected domain errors → clean JSON, no stack trace leaked to clients.
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    return app


app = create_app()
