"""Settings, read from the environment.

Credentials never live in source. Everything here comes from the environment or from a
gitignored .env file.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration.

    Defaults are the local Docker Compose values, so `docker compose up` works with no .env
    file at all.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # localhost and port 5435, not the compose hostname `db` and 5432. docker-compose sets
    # DATABASE_URL for the container, so only what runs on the host - pytest, alembic, psql -
    # reads this default, and that is the case it belongs to. (roamer's note on why: mailman's
    # database tests once skipped on the host with the database up, because its default was
    # `db`.)
    database_url: str = "postgresql+psycopg://codevscode:codevscode@localhost:5435/codevscode"


settings = Settings()
