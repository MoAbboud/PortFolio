"""Settings, read from the environment.

Credentials never live in source and never reach the database or the document store.
Everything here comes from the environment or from a gitignored .env file.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Defaults are the local Docker Compose values, so `docker compose up` works with no
    .env file at all. Anything secret defaults to empty rather than to a working value.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://mailman:mailman@db:5432/mailman"

    # Where document bytes are written. An S3-shaped path layout lives under this root,
    # so moving to object storage later is a different client rather than a new schema.
    storage_root: str = "/data/documents"

    # Shared secret for the API. One reviewer, so one secret. Not enforced until stage 6.
    mailman_api_key: str | None = None

    # Provider credentials. Not needed until stage 2.
    anthropic_api_key: str | None = None

    # A cap on what one upload may be. An invoice is a few hundred kilobytes; anything at
    # this size is a mistake or an attack, and the check is cheaper than the consequences.
    max_upload_bytes: int = 20 * 1024 * 1024


settings = Settings()
