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

    # The local extractor talks to Ollama over HTTP. `llama-cpp-python` has no wheel for
    # Python 3.13 on Windows and building it needs an MSVC toolchain, and requiring a C++
    # compiler to run this project is a bad trade. Ollama runs llama.cpp underneath and
    # enforces the JSON schema during decoding, which is the part that matters.
    ollama_url: str = "http://localhost:11434"
    llm_model: str = "qwen2.5:3b"
    llm_timeout_seconds: int = 900
    # **Ollama gives the prompt only HALF of num_ctx**, reserving the rest for generation.
    # Measured 2026-09-12: num_ctx 4096 -> 2050 prompt tokens, 8192 -> 4098, 16384 -> 8194.
    #
    # At the old default of 8192 a 6000-token chunk plus ~1,570 tokens of instructions and
    # ~1,000 of message ids was cut to 4,098 before the model ever saw it, with no error
    # anywhere - the local extractor returned 3 candidates from a transcript where the
    # heuristic found 31, and looked merely bad rather than broken.
    #
    # So this must be at least 2x the largest prompt. For a 6000-token chunk that is roughly
    # 2 x 8,600, rounded up with room to spare. qwen2.5:3b supports 32768.
    llm_num_ctx: int = 24576
    # How long Ollama holds the model in memory after a call. Its default is 5 minutes,
    # which is the wrong default here: loading a 3B model costs ~2 minutes of wall clock
    # against ~5 seconds of actual inference, so a derive running less often than every
    # 5 minutes would pay 20x its own cost in reloading. Measured at stage 2.
    llm_keep_alive: str = "30m"

    # The Ollama tag, not the HuggingFace name: `all-minilm` is the same
    # all-MiniLM-L6-v2 model at the same 384 dimensions, served by a runtime already
    # installed for the extractor rather than a second inference stack in the worker.
    embed_model_tag: str = "all-minilm"
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
    # 0.50, not the 0.86 the specification named. Measured on 2026-09-10 against
    # all-minilm over eleven labelled pairs, and the finding was that **no threshold
    # separates them cleanly** - "No Redis" against "we will not introduce a message
    # broker" is the same claim and scores 0.179, below an unrelated-topic pair at 0.548.
    #
    # So this is tuned for RECALL, not precision, because the costs are asymmetric. A false
    # positive is one wasted NLI call that then returns neutral and keeps both entries. A
    # false negative is a duplicate entry that lives forever and makes the memory grow
    # linearly - the silent failure the whole compaction claim dies of. Similarity is a
    # cheap pre-filter to keep the cost sub-quadratic; NLI is what actually decides.
    #
    # 0.86 was calibrated for a 1536-dimension model. The model changed and the scale
    # changed with it, which is the kind of thing that has to be re-measured rather than
    # carried over. Provisional until stage 4 calibrates it on ten real conversations.
    similarity_threshold: float = 0.50
    probe_count: int = 6

    # Ingest limits. An empty paste is a 400 rather than a conversation, and a paste
    # larger than this is refused with the size in the message rather than silently
    # chewing through it.
    max_paste_bytes: int = 2_000_000
    max_batch_events: int = 200

    worker_poll_seconds: float = 2.0

    # Stage 9: the pages at /bench write ground-truth fact lists into bench/datasets. A local
    # authoring tool, not a feature - any hosted deployment sets HERDER_BENCH_AUTHORING=false.
    bench_authoring: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
