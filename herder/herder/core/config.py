"""Settings, from the environment. Nothing in source.

There is no provider key here and there never will be - see requirements/00-plan.md. What
comes from the environment is which models to load, where they live, and the numbers that
tune the loop.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ExtractorName = Literal["heuristic", "local", "trained"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="HERDER_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        # `model_dir` and `model_calls` are ordinary names in this project and have nothing
        # to do with Pydantic's own `model_` machinery. Without this, Pydantic claims the
        # prefix and the field is rejected.
        protected_namespaces=(),
    )

    # DATABASE_URL is unprefixed because that is what every host and every tool expects to
    # set, and it is what docker-compose passes in.
    database_url: str = Field(
        default="postgresql+asyncpg://herder:herder@localhost:5432/herder",
        validation_alias=AliasChoices("DATABASE_URL", "HERDER_DATABASE_URL"),
    )

    # Which extractor runs. An unknown value is an error rather than a silent default:
    # a typo that quietly downgraded extraction would make every number after it a lie.
    extractor: ExtractorName = "heuristic"

    # Where the weights live. Gitignored, fetched on purpose, never at import time.
    model_dir: Path = Path("./models")

    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    # Fixed in the DDL. Changing it is a migration that invalidates every stored vector,
    # which is the honest place for that decision to live.
    embed_dim: int = 384
    nli_model: str = "cross-encoder/nli-deberta-v3-base"
    nli_floor: float = 0.5

    # The loop. Every one of these is an open question in 00-plan.md with a stage attached;
    # these are starting points, not answers.
    chunk_tokens: int = 6000
    derive_threshold_tokens: int = 2000
    derive_max_age_seconds: int = 600
    brief_budget_tokens: int = 3000
    session_tail_tokens: int = 1200
    similarity_threshold: float = 0.86
    probe_count: int = 6

    worker_poll_seconds: float = 2.0


@lru_cache
def get_settings() -> Settings:
    return Settings()
