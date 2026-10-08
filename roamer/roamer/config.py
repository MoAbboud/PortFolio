"""Settings, read from the environment.

Credentials never live in source. Everything here comes from the environment or from a
gitignored .env file, and anything secret defaults to empty rather than to a working value.
"""

from __future__ import annotations

from pydantic import AliasChoices, Field
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

    # The address the site is reached at, for the links inside emails and on flyers.
    base_url: str = Field(
        default="http://localhost:8010",
        validation_alias=AliasChoices("ROAMER_BASE_URL", "BASE_URL", "base_url"),
    )

    # Where email goes. In development, Mailpit, which catches everything and sends nothing.
    # The hosted demo sends nothing at all (stage 9); a real service would point these at a
    # relay, with the credentials coming from the environment and nowhere else.
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = False
    mail_from: str = "roamer <noreply@roamer.test>"

    # Where a person can read the caught mail, shown on the "check your email" page. Set
    # only in development; unset, the page does not mention it.
    mail_viewer_url: str | None = None

    # How long a verify link works, and how long an unverified listing is kept before it is
    # deleted. A day is long enough to find the email; a week is long enough to come back to it.
    verify_token_hours: int = 24
    unverified_retention_days: int = 7

    # The freshness rules behind the verified badge. The check-in emails that move
    # last_confirmed_at arrive in stage 5; the badge already reads these.
    checkin_interval_days: int = 7
    checkin_grace_days: int = 3

    # Address search. Nominatim's policy requires a User-Agent that identifies the
    # application and how to reach whoever runs it.
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_user_agent: str = "roamer-demo/0.1 (https://github.com/MoAbboud/PortFolio)"

    # Where photos are written, served at /media. Relative to the working directory, which is
    # /app in the container - and /app is the project folder mounted from the host, so in
    # development the files land in roamer/data/images, which git ignores.
    image_dir: str = "./data/images"

    # The worker: how often it looks for work, and how many times one email is tried before
    # it is marked failed.
    worker_interval_seconds: float = 5.0
    outbox_max_attempts: int = 5


settings = Settings()
