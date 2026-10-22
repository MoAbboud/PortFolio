"""Settings, read from the environment.

Credentials never live in source. Everything here comes from the environment or from a
gitignored .env file.
"""

from __future__ import annotations

from pathlib import Path

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

    # The judge (stage 2). Each job runs in a fresh container from judge_image, built from
    # judge/Dockerfile. The limits are per job.
    judge_image: str = "codevscode-judge"
    judge_timeout_seconds: float = 90.0
    judge_memory: str = "384m"
    judge_pids: int = 64
    judge_cpus: str = "1"
    # stdout beyond this is not read: the container is stopped and the job is "output_limit".
    judge_output_limit_bytes: int = 2_000_000
    # Where each job's files are written for the container to mount. Empty means the system's
    # temporary folder. Docker Desktop on Windows can mount anything under C:\Users.
    judge_work_dir: str = ""
    # The challenge folders the judge reads from.
    challenges_dir: str = str(Path(__file__).resolve().parents[1] / "challenges")
    # A running job whose lock is older than this is assumed orphaned (its worker died) and the
    # reaper puts it back in the queue. Longer than any judge run.
    job_lock_seconds: int = 300
    job_max_attempts: int = 3
    worker_interval_seconds: float = 2.0


settings = Settings()
