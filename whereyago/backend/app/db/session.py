"""Engine, session factory and the request-scoped DB dependency.

``get_db`` yields a session and owns the transaction boundary: it commits on a
clean request and rolls back if anything raised. Services therefore never call
``commit`` themselves — they just ``flush`` when they need generated ids.
"""

from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings

_settings = get_settings()

# ``pool_pre_ping`` quietly recycles dead connections (e.g. after a DB restart).
engine = create_engine(_settings.DATABASE_URL, pool_pre_ping=True, echo=False, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    """Provide a transactional session for the lifetime of a request."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
