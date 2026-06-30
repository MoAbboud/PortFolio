"""Application settings.

All configuration is read from the environment (or a local ``.env``) via
``pydantic-settings``. Nothing is hard-coded: secrets like ``SECRET_KEY`` and
the database password have *no defaults*, so the app refuses to start without
them — that is intentional. Access settings through :func:`get_settings`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import computed_field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["local", "staging", "production"]


class Settings(BaseSettings):
    """Strongly-typed, validated application configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---
    PROJECT_NAME: str = "whereyago"
    ENVIRONMENT: Environment = "local"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    # Interactive API docs (Swagger UI + ReDoc + OpenAPI spec). Off by default;
    # set DOCS_ENABLED=true in the environment to turn them back on.
    DOCS_ENABLED: bool = False

    # --- Logging ---
    LOG_LEVEL: str = "INFO"
    LOG_JSON: bool = True
    # Logs at this level and above are also persisted to the DB (log_entries).
    # Keep at WARNING to avoid flooding the table with routine INFO traffic.
    DB_LOG_LEVEL: str = "WARNING"

    # --- Security (no defaults — must be supplied via env) ---
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24

    # --- CORS ---
    BACKEND_CORS_ORIGINS: list[str] = []

    # --- Database (password has no default) ---
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "whereyago"
    POSTGRES_PASSWORD: str
    POSTGRES_DB: str = "whereyago"

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def _assemble_cors(cls, value: str | list[str]) -> str | list[str]:
        """Accept either a JSON list or a comma-separated string.

        A JSON string (starts with ``[``) is passed through for pydantic to parse.
        """
        if isinstance(value, str) and not value.startswith("["):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DATABASE_URL(self) -> str:
        """SQLAlchemy URL assembled from the discrete Postgres settings."""
        return (
            f"postgresql+psycopg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == "production"


@lru_cache
def get_settings() -> Settings:
    """Return a cached, singleton ``Settings`` instance.

    Field values are populated from the environment, not constructor arguments.
    """
    return Settings()
