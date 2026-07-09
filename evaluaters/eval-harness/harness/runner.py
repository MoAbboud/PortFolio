"""Run a case through an LLM and return the raw response.

Design notes
------------
* We start with a single provider (Anthropic Claude) and read the API key from
  an environment variable — never hardcoded. Swapping providers later means
  writing another class with the same `run(case) -> ModelResponse` shape; the
  rest of the harness doesn't change.
* We keep the model's *raw text* output. We do NOT ask the API to force valid
  JSON (no structured-output constraint), because a core thing the eval must
  measure is whether the model returns clean, parseable JSON on its own.
* The SDK already retries transient errors, but we disable that (`max_retries=0`)
  and own the retry loop ourselves — so retries are visible, logged, and countable
  in the response metadata. That is exactly the kind of thing an eval wants to see.
"""

from __future__ import annotations

import os
import random
import time
from typing import Protocol

from .models import Case, ModelResponse

# The extraction contract. This prompt IS part of what you are evaluating —
# when you change it, scores should change. Keep it in version control and note
# prompt edits in DECISIONS.md so a score regression can be traced to a cause.
DEFAULT_SYSTEM_PROMPT = """\
You are a support-ticket triage extractor. Read the raw ticket text and return \
ONLY a JSON object with exactly these fields:

- "category": short string, the type of issue (e.g. "MES/timeout", "billing").
- "priority": one of "low", "medium", "high".
- "recurring": boolean — true if the text says the issue happened before.
- "system": the system/line/product named, or null if none.
- "summary": one-sentence plain summary of the problem.

Return the JSON object and nothing else — no prose, no code fences."""

DEFAULT_MODEL = "claude-opus-4-8"


class Runner(Protocol):
    """Anything that can turn a Case into a ModelResponse.

    Coding to this Protocol (not to the concrete class) keeps the CLI and any
    future batch/async runners decoupled from the Anthropic SDK.
    """

    def run(self, case: Case) -> ModelResponse: ...


class RunnerError(RuntimeError):
    """Raised when a case could not be run after exhausting retries."""


class AnthropicRunner:
    """Runs cases against the Anthropic Messages API with manual backoff retries."""

    def __init__(
        self,
        *,
        model: str = DEFAULT_MODEL,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        max_tokens: int = 1024,
        max_retries: int = 5,
        base_delay: float = 1.0,
        max_delay: float = 30.0,
        api_key_env: str = "ANTHROPIC_API_KEY",
    ) -> None:
        # Import the SDK lazily so the loader, storage, CLI, and scorers can all
        # be imported and tested without the anthropic package installed.
        import anthropic

        api_key = os.environ.get(api_key_env)
        if not api_key:
            raise RunnerError(
                f"environment variable {api_key_env} is not set — "
                "export your API key before running the harness"
            )
        self._anthropic = anthropic
        # max_retries=0: we run our own retry loop below so retries are observable.
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=0)
        self.model = model
        self.system_prompt = system_prompt
        self.max_tokens = max_tokens
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay

    def _backoff(self, attempt: int) -> float:
        """Exponential backoff with jitter, capped at max_delay."""
        delay = min(self.base_delay * (2**attempt), self.max_delay)
        return delay + random.uniform(0, self.base_delay)

    def run(self, case: Case) -> ModelResponse:
        last_exc: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                started = time.monotonic()
                resp = self._client.messages.create(
                    model=self.model,
                    max_tokens=self.max_tokens,
                    system=self.system_prompt,
                    messages=[{"role": "user", "content": case.input_text}],
                )
                elapsed = time.monotonic() - started
                text = "".join(
                    b.text for b in resp.content if b.type == "text"
                )
                return ModelResponse(
                    case_id=case.id,
                    model=self.model,
                    raw_text=text,
                    meta={
                        "attempts": attempt + 1,
                        "latency_s": round(elapsed, 3),
                        "input_tokens": resp.usage.input_tokens,
                        "output_tokens": resp.usage.output_tokens,
                        "stop_reason": resp.stop_reason,
                    },
                )
            except (
                self._anthropic.RateLimitError,
                self._anthropic.APIConnectionError,
            ) as exc:
                last_exc = exc
            except self._anthropic.APIStatusError as exc:
                # Retry server errors (>=500); surface client errors (4xx) immediately.
                if exc.status_code < 500:
                    raise RunnerError(
                        f"case {case.id}: non-retryable API error "
                        f"{exc.status_code}: {exc.message}"
                    ) from exc
                last_exc = exc

            time.sleep(self._backoff(attempt))

        raise RunnerError(
            f"case {case.id}: failed after {self.max_retries} attempts"
        ) from last_exc
