"""Aggregate all v1 routers under a single ``api_router``."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import auth, days, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(days.router)
