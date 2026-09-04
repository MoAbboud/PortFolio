"""Settings, read from the environment.

Credentials never live in source and never reach the database or the document store.
Everything here comes from the environment or from a gitignored .env file.
"""

from __future__ import annotations

from pydantic import AliasChoices, Field
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

    # Provider credentials.
    anthropic_api_key: str | None = None

    # Which extractor runs. "hybrid" is the default because it is strictly better than the
    # alternatives and needs nothing: it is the heuristic's reading with buyer_name taken
    # from the trained model when the weights happen to be on disk, and it degrades to
    # exactly the heuristic when they are not. On the corpus it scores 92/92 against the
    # heuristic's 82/92 and the trained model's 74/92.
    #
    # It is the default rather than something to switch on because an environment variable
    # that has to be set for the better behaviour is an environment variable somebody
    # forgets. "heuristic" forces rules only; "trained" is the model alone, kept because the
    # comparison is what says whether the weights earn their 250MB; "anthropic" needs a key
    # and is a comparison point rather than a path this project depends on.
    # Both spellings are accepted. The field is named `extractor`, so pydantic-settings
    # would read plain EXTRACTOR - but every document in this project says
    # MAILMAN_EXTRACTOR, which is the more obvious name and the one someone will type.
    # Accepting both is cheaper than an environment variable that silently does nothing.
    extractor: str = Field(
        default="hybrid",
        validation_alias=AliasChoices("MAILMAN_EXTRACTOR", "EXTRACTOR", "extractor"),
    )

    # Where a locally trained extractor's weights live, when there are any.
    model_dir: str = Field(
        default="./models/extractor",
        validation_alias=AliasChoices("MAILMAN_MODEL_DIR", "MODEL_DIR", "model_dir"),
    )

    # Only read when extractor == "anthropic". Recorded on every row either way, because two
    # runs cannot be compared without knowing what produced them.
    extraction_model: str = "claude-opus-5"
    extraction_max_tokens: int = 16000
    extraction_timeout_seconds: float = 120.0
    extraction_max_retries: int = 3

    # A cap on what one upload may be. An invoice is a few hundred kilobytes; anything at
    # this size is a mistake or an attack, and the check is cheaper than the consequences.
    max_upload_bytes: int = 20 * 1024 * 1024


settings = Settings()
