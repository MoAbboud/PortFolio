"""The local extractor: a quantised instruction model, running on this machine.

## Why Ollama rather than llama.cpp in-process

`03-architecture.md` said "llama.cpp through a Python binding, or Ollama". The binding is not
available here: `llama-cpp-python` publishes no wheel for Python 3.13 on Windows, and
building it from source needs an MSVC toolchain that is not installed. Requiring a C++
compiler to run a portfolio project is a bad trade.

Ollama is a normal Windows install, exposes an HTTP API on localhost, runs llama.cpp
underneath, and - the part that matters most here - **enforces a JSON schema during
decoding** through the same GBNF grammar machinery. So valid JSON stays a property of
decoding rather than something to hope for and repair afterwards.

It also reports `prompt_eval_duration` and `eval_duration` separately, which is exactly the
split the stage 2 task list asks to be measured: on a machine with no GPU, prompt processing
is expected to dominate, and knowing that is what makes chunk size the lever to reach for.

The cost is one more thing to install and a model that lives outside the container. The
worker reaches it at `host.docker.internal` from Docker and `localhost` otherwise.
"""

from __future__ import annotations

import time

import httpx
from pydantic import ValidationError

from herder.core.config import get_settings
from herder.domain.chunking import Chunk
from herder.extractors.base import ExtractorUnavailable
from herder.prompts import load_prompt
from herder.schemas.extraction import CandidateList, ExtractionOutcome

NAME = "local"


class LocalExtractor:
    name = NAME

    def __init__(self) -> None:
        settings = get_settings()
        self.model = settings.llm_model
        self._url = settings.ollama_url.rstrip("/")
        self._timeout = settings.llm_timeout_seconds
        self._num_ctx = settings.llm_num_ctx
        self._prompt, self.prompt_version = load_prompt("extract.md")

    # ------------------------------------------------------------------ readiness

    def check_ready(self) -> None:
        """Raise with the exact command to fix it. Never fall back to the heuristic."""
        try:
            response = httpx.get(f"{self._url}/api/tags", timeout=5)
            response.raise_for_status()
        except Exception as exc:
            raise ExtractorUnavailable(
                f"HERDER_EXTRACTOR=local but no Ollama at {self._url}. Install it from "
                "https://ollama.com, then `ollama serve`. From inside Docker the host is "
                "http://host.docker.internal:11434 - set HERDER_OLLAMA_URL."
            ) from exc

        available = [m.get("name", "") for m in response.json().get("models", [])]
        if not any(name == self.model or name.startswith(f"{self.model}:") for name in available):
            raise ExtractorUnavailable(
                f"HERDER_EXTRACTOR=local but the model {self.model!r} is not pulled. Run:\n"
                f"    ollama pull {self.model}\n"
                f"Available: {', '.join(available) or 'none'}"
            )

    # ------------------------------------------------------------------ extraction

    def extract(self, chunk: Chunk, existing_titles: list[str]) -> ExtractionOutcome:
        prompt = self._render(chunk, existing_titles)
        schema = CandidateList.model_json_schema()

        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self._prompt},
                {"role": "user", "content": prompt},
            ],
            # The schema is enforced during decoding. This is the whole reason a 3B model is
            # usable for structured extraction at all.
            "format": schema,
            "stream": False,
            "options": {"temperature": 0, "num_ctx": self._num_ctx},
        }

        started = time.perf_counter()
        try:
            response = httpx.post(f"{self._url}/api/chat", json=body, timeout=self._timeout)
            response.raise_for_status()
            payload = response.json()
        except httpx.TimeoutException:
            return self._failure(f"inference timed out after {self._timeout}s", started)
        except Exception as exc:
            return self._failure(f"{type(exc).__name__}: {exc}", started)

        raw = (payload.get("message") or {}).get("content", "")
        elapsed = int((time.perf_counter() - started) * 1000)

        # Nanoseconds, and both are reported. The split is the point.
        prompt_ms = int(payload.get("prompt_eval_duration", 0) / 1_000_000)
        gen_ms = int(payload.get("eval_duration", 0) / 1_000_000)

        try:
            parsed = CandidateList.model_validate_json(raw)
        except ValidationError as exc:
            # Should be unreachable: decoding was schema-constrained. If it fires, the
            # schema and the grammar disagree, which is a bug here and not a bad response.
            return ExtractionOutcome(
                failed=True,
                error=f"schema-constrained output did not validate: {exc}",
                raw_output=raw,
                validated_first_try=False,
                model=self.model,
                prompt_version=self.prompt_version,
                input_tokens=int(payload.get("prompt_eval_count", 0)),
                output_tokens=int(payload.get("eval_count", 0)),
                latency_ms=elapsed,
            )

        outcome = ExtractionOutcome(
            candidates=parsed.entries,
            raw_output=raw,
            model=self.model,
            prompt_version=self.prompt_version,
            input_tokens=int(payload.get("prompt_eval_count", 0)),
            output_tokens=int(payload.get("eval_count", 0)),
            latency_ms=elapsed,
            prompt_ms=prompt_ms,
            generation_ms=gen_ms,
        )
        return outcome

    # ------------------------------------------------------------------ internals

    def _render(self, chunk: Chunk, existing_titles: list[str]) -> str:
        known = "\n".join(f"- {t}" for t in existing_titles[:200]) or "(none yet)"
        return (
            "Entry titles this project already has. Do not restate these; if something here "
            "is contradicted, use supersedes_title.\n"
            f"{known}\n\n"
            "Conversation chunk. Every id in square brackets is a message id you may cite in "
            "lineage. Cite only ids that appear here.\n\n"
            f"{chunk.render()}"
        )

    def _failure(self, error: str, started: float) -> ExtractionOutcome:
        return ExtractionOutcome(
            failed=True,
            error=error,
            model=self.model,
            prompt_version=self.prompt_version,
            latency_ms=int((time.perf_counter() - started) * 1000),
            validated_first_try=False,
        )
