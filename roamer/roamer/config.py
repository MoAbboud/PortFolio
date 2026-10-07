"""Settings, read from the environment.

Credentials never live in source. Everything here comes from the environment or from a
gitignored .env file, and anything secret defaults to empty rather than to a working value.
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

    # localhost, not the compose hostname `db`, and port 5434, not 5432.
    #
    # docker-compose sets DATABASE_URL for the container, so the container never reads this
    # default. Everything run on the host does - pytest on Windows, alembic, psql - and the
    # default belongs to the case with no other configuration. mailman learned that the hard
    # way: with `db` as its default, its database tests skipped on the host with the database
    # up and healthy.
    #
    # 5434 because mailman and herder both publish 5432. Three projects that all want the
    # same port cannot be run side by side, and the one started second fails with an error
    # that says nothing about the other two.
    database_url: str = "postgresql+psycopg://roamer:roamer@localhost:5434/roamer"

    # Where the public map opens. Kansas City, where the demo's made-up listings are.
    #
    # Configuration for now. Stage 8 moves it into the `settings` table, so the admin can
    # set it from the admin section by moving the map, and these become the fallback.
    map_center_lat: float = 39.0997
    map_center_lng: float = -94.5786
    map_zoom: int = 12


settings = Settings()
