"""Correlation-ID + request-logging middleware.

Every request is tagged with a correlation id (taken from an inbound
``X-Request-ID`` header or freshly generated). The id is bound into the
structlog context so *all* log lines for that request carry it, and is echoed
back in the response header so clients/mobile can report it in bug reports.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import structlog
from starlette.requests import Request
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logging import get_logger

logger = get_logger("request")

_REQUEST_ID_HEADER = "X-Request-ID"

RequestResponseCall = Callable[[Request], Awaitable[Response]]


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseCall) -> Response:
        correlation_id = request.headers.get(_REQUEST_ID_HEADER) or uuid.uuid4().hex

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            correlation_id=correlation_id,
            method=request.method,
            path=request.url.path,
        )

        logger.info("request.started")
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("request.failed")
            raise

        response.headers[_REQUEST_ID_HEADER] = correlation_id
        logger.info("request.completed", status_code=response.status_code)
        return response
